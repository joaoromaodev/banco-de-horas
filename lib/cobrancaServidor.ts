// Cobrança — I/O no Postgres (migração 0011). Só de servidor (secret key).
// As regras ficam em lib/cobranca.ts; o gateway em lib/gatewayAsaas.ts;
// a autorização em lib/acesso.ts.
import { getDb } from './db';
import { lerEscritorio, type Escritorio } from './escritorios';
import {
  comGateway, consolidarAgendamento, ehCiclo, periodoDoPagamento, planoEfetivo, ehPlanoPago, hojeEm, recalcularAssinatura, situacaoEfetiva,
  type AssinaturaRef, type Ciclo, type Plano, type EstadoCobranca, type PagamentoRef, type PlanoPago, type Situacao,
  type StatusAssinatura, type StatusPagamento,
} from './cobranca';
import { cobrancaConfigurada, configGateway, type AmbienteGateway, type PagamentoGateway } from './gatewayAsaas';

export interface Assinatura extends AssinaturaRef {
  escritorioId: string;
  ambiente: AmbienteGateway;
  clienteGatewayId: string | null;
  assinaturaGatewayId: string | null;
  valor: number;
  canceladaEm: string | null;
}

export interface PagamentoSalvo {
  id: string;
  descricao: string | null;
  valor: number;
  vencimento: string | null;
  status: StatusPagamento;
  forma: string | null;
  linkFatura: string | null;
  pagoEm: string | null;
  daAssinatura: boolean;
  periodoAte: string | null;
  ambiente: AmbienteGateway;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const STATUS: StatusAssinatura[] = ['pendente', 'ativa', 'inadimplente', 'cancelada'];
const STATUS_PAG: StatusPagamento[] = ['pendente', 'pago', 'vencido', 'estornado', 'removido'];

/** Tabela ainda não existe (migração 0011 não aplicada): tratamos como "sem assinatura". */
const semTabela = (e: { code?: string; message?: string }) =>
  e.code === '42P01' || e.code === 'PGRST205' || /does not exist|could not find the table/i.test(e.message ?? '');

function linhaParaAssinatura(r: any): Assinatura {
  return {
    escritorioId: String(r.escritorio_id),
    ambiente: r.ambiente === 'producao' ? 'producao' : 'sandbox',
    clienteGatewayId: r.cliente_gateway_id ?? null,
    assinaturaGatewayId: r.assinatura_gateway_id ?? null,
    plano: (ehPlanoPago(r.plano) ? r.plano : 'essencial') as PlanoPago,
    ciclo: (ehCiclo(r.ciclo) ? r.ciclo : 'mensal') as Ciclo,
    valor: Number(r.valor ?? 0),
    status: (STATUS.includes(r.status) ? r.status : 'pendente') as StatusAssinatura,
    proximoVencimento: r.proximo_vencimento ?? null,
    pagoAte: r.pago_ate ?? null,
    inadimplenteDesde: r.inadimplente_desde ?? null,
    planoAgendado: ehPlanoPago(r.plano_agendado) ? r.plano_agendado : null,
    cicloAgendado: ehCiclo(r.ciclo_agendado) ? r.ciclo_agendado : null,
    agendadoAPartir: r.agendado_a_partir ?? null,
    canceladaEm: r.cancelada_em ?? null,
  };
}

export async function lerAssinatura(escritorioId: string): Promise<Assinatura | null> {
  const { data, error } = await getDb().from('assinaturas').select('*').eq('escritorio_id', escritorioId).maybeSingle();
  if (error) { if (semTabela(error)) return null; throw new Error(error.message); }
  return data ? linhaParaAssinatura(data) : null;
}

export async function assinaturaPorGateway(assinaturaGatewayId: string): Promise<Assinatura | null> {
  const { data, error } = await getDb().from('assinaturas').select('*').eq('assinatura_gateway_id', assinaturaGatewayId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? linhaParaAssinatura(data) : null;
}

export async function assinaturaPorCliente(clienteGatewayId: string): Promise<Assinatura | null> {
  const { data, error } = await getDb().from('assinaturas').select('*').eq('cliente_gateway_id', clienteGatewayId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? linhaParaAssinatura(data) : null;
}

/** Grava (insere ou substitui) a assinatura do escritório. */
export async function salvarAssinatura(a: Assinatura): Promise<void> {
  const { error } = await getDb().from('assinaturas').upsert({
    escritorio_id: a.escritorioId,
    ambiente: a.ambiente,
    cliente_gateway_id: a.clienteGatewayId,
    assinatura_gateway_id: a.assinaturaGatewayId,
    plano: a.plano,
    ciclo: a.ciclo,
    valor: a.valor,
    status: a.status,
    proximo_vencimento: a.proximoVencimento,
    pago_ate: a.pagoAte,
    inadimplente_desde: a.inadimplenteDesde,
    plano_agendado: a.planoAgendado ?? null,
    ciclo_agendado: a.cicloAgendado ?? null,
    agendado_a_partir: a.agendadoAPartir ?? null,
    cancelada_em: a.canceladaEm,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: 'escritorio_id' });
  if (error) throw new Error(error.message);
  invalidarSituacao(a.escritorioId);
}

// ---------------------------------------------------------------- Pagamentos
export class ErroAtribuicao extends Error {}

/**
 * Grava a cobrança espelhada. Regras de segurança:
 * - uma cobrança já gravada nunca muda de escritório;
 * - `periodo_ate` (até quando ela cobre) é calculado quando ela é PAGA, com o
 *   ciclo daquele vencimento, e fica congelado — trocar de ciclo depois não
 *   estica o que já foi pago;
 * - guarda o ambiente (sandbox/produção) para um nunca valer no outro.
 */
export async function salvarPagamento(escritorioId: string, p: PagamentoGateway, a: Assinatura | null, ambiente: AmbienteGateway): Promise<void> {
  const db = getDb();
  const { data: existente, error: eLer } = await db.from('cobranca_pagamentos')
    .select('escritorio_id, status, periodo_ate').eq('id', p.id).maybeSingle();
  if (eLer) throw new Error(eLer.message);
  if (existente && existente.escritorio_id && existente.escritorio_id !== escritorioId) {
    throw new ErroAtribuicao('Cobrança já pertence a outro escritório.');
  }
  let periodoAte: string | null = existente?.status === 'pago' && existente.periodo_ate ? existente.periodo_ate : null;
  if (!periodoAte && p.status === 'pago' && p.assinatura && p.vencimento && a) {
    periodoAte = periodoDoPagamento(p.vencimento, a);
  }
  const { error } = await db.from('cobranca_pagamentos').upsert({
    id: p.id,
    escritorio_id: escritorioId,
    ambiente,
    assinatura_gateway_id: p.assinatura,
    periodo_ate: periodoAte,
    descricao: p.descricao,
    valor: p.valor,
    vencimento: p.vencimento,
    status: p.status,
    forma: p.forma,
    link_fatura: p.linkFatura,
    pago_em: p.pagoEm,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

/** Cobranças do escritório; com `ambiente`, só as daquele ambiente. */
export async function lerPagamentos(escritorioId: string, ambiente?: AmbienteGateway): Promise<PagamentoSalvo[]> {
  let q = getDb().from('cobranca_pagamentos').select('*').eq('escritorio_id', escritorioId);
  if (ambiente) q = q.eq('ambiente', ambiente);
  const { data, error } = await q.order('vencimento', { ascending: false }).limit(200);
  if (error) { if (semTabela(error)) return []; throw new Error(error.message); }
  return (data ?? []).map((r: any) => ({
    id: String(r.id),
    descricao: r.descricao ?? null,
    valor: Number(r.valor ?? 0),
    vencimento: r.vencimento ?? null,
    status: (STATUS_PAG.includes(r.status) ? r.status : 'pendente') as StatusPagamento,
    forma: r.forma ?? null,
    linkFatura: r.link_fatura ?? null,
    pagoEm: r.pago_em ?? null,
    daAssinatura: Boolean(r.assinatura_gateway_id),
    periodoAte: r.periodo_ate ?? null,
    ambiente: r.ambiente === 'producao' ? 'producao' : 'sandbox',
  }));
}

/** Ao cancelar, o Asaas apaga as cobranças em aberto da assinatura; espelhamos já. */
export async function marcarAbertasRemovidas(escritorioId: string, assinaturaGatewayId: string): Promise<void> {
  const { error } = await getDb().from('cobranca_pagamentos')
    .update({ status: 'removido', atualizado_em: new Date().toISOString() })
    .eq('escritorio_id', escritorioId).eq('assinatura_gateway_id', assinaturaGatewayId)
    .in('status', ['pendente', 'vencido']);
  if (error) throw new Error(error.message);
}

/**
 * Recalcula a assinatura a partir de todas as cobranças guardadas (ver
 * `recalcularAssinatura`) e espelha no escritório: com algo pago, ele vira
 * `ativo` no plano vigente. O `fundador` nunca é tocado.
 */
export async function recalcular(escritorioId: string, extra?: Partial<Assinatura>): Promise<Assinatura | null> {
  const atual = await lerAssinatura(escritorioId);
  if (!atual) return null;
  // Só as cobranças do MESMO ambiente da assinatura contam.
  const pagamentos = await lerPagamentos(escritorioId, atual.ambiente);
  const refs: PagamentoRef[] = pagamentos.map((p) => ({
    id: p.id, daAssinatura: p.daAssinatura, status: p.status, vencimento: p.vencimento, valor: p.valor, periodoAte: p.periodoAte,
  }));
  const base = consolidarAgendamento({ ...atual, ...extra }, hojeEm());
  const novo: Assinatura = { ...base, ...recalcularAssinatura(base, refs) };
  await salvarAssinatura(novo);

  const esc = await lerEscritorio(escritorioId);
  if (esc && esc.plano !== 'fundador' && novo.pagoAte && (esc.plano !== novo.plano || esc.situacao !== 'ativo')) {
    const { error } = await getDb().from('escritorios')
      .update({ plano: novo.plano, situacao: 'ativo' })
      .eq('id', escritorioId).neq('plano', 'fundador');
    if (error) throw new Error(error.message);
  }
  invalidarSituacao(escritorioId);
  return novo;
}

// ---------------------------------------------------------------- Eventos
/**
 * Registra o evento do webhook. `novo` = primeira vez; `repetido` = já
 * processado (ignorar); `reprocessar` = chegou antes, mas não terminou.
 */
export async function registrarEvento(d: {
  id: string; evento: string; pagamentoId?: string | null; assinaturaId?: string | null; payload: unknown;
}): Promise<'novo' | 'repetido' | 'reprocessar'> {
  const db = getDb();
  const { error } = await db.from('cobranca_eventos').insert({
    id: d.id, evento: d.evento, pagamento_id: d.pagamentoId ?? null, assinatura_id: d.assinaturaId ?? null, payload: d.payload,
  });
  if (!error) return 'novo';
  if (error.code !== '23505') throw new Error(error.message);
  const { data, error: e2 } = await db.from('cobranca_eventos').select('processado_em').eq('id', d.id).maybeSingle();
  if (e2) throw new Error(e2.message);
  return data?.processado_em ? 'repetido' : 'reprocessar';
}

export async function concluirEvento(id: string, d: { escritorioId?: string | null; erro?: string | null }): Promise<void> {
  const { error } = await getDb().from('cobranca_eventos').update({
    escritorio_id: d.escritorioId ?? null,
    erro: d.erro ? d.erro.slice(0, 500) : null,
    processado_em: d.erro ? null : new Date().toISOString(),
  }).eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------- Situação
export async function estadoCobranca(escritorioId: string): Promise<{ escritorio: Escritorio; assinatura: Assinatura | null } | null> {
  const [escritorio, assinatura] = await Promise.all([lerEscritorio(escritorioId), lerAssinatura(escritorioId)]);
  return escritorio ? { escritorio, assinatura } : null;
}

/**
 * A assinatura só vale se for do ambiente de cobrança em uso: uma assinatura de
 * sandbox nunca libera acesso com o app em produção (nem sem gateway nenhum).
 */
export function assinaturaVigente(a: Assinatura | null, ambiente: AmbienteGateway | null = configGateway()?.ambiente ?? null): Assinatura | null {
  return a && ambiente && a.ambiente === ambiente ? a : null;
}

export function paraEstado(escritorio: Escritorio, assinatura: Assinatura | null): EstadoCobranca {
  return { plano: escritorio.plano, situacao: escritorio.situacao, testeAte: escritorio.testeAte, assinatura: assinaturaVigente(assinatura) };
}

// Cache curto: o proxy consulta a situação a cada ESCRITA (não a cada leitura).
// Pagou? O webhook invalida na mesma instância; nas demais, até 30 s.
const cache = new Map<string, { em: number; situacao: Situacao }>();
const TTL_MS = 30_000;

export function invalidarSituacao(escritorioId: string) { cache.delete(escritorioId); }

/**
 * Situação de acesso do escritório (cacheada). Se o banco falhar, devolve a
 * última conhecida; sem nenhuma, devolve `null` (o chamador decide).
 */
export async function situacaoDoEscritorio(escritorioId: string): Promise<Situacao | null> {
  const c = cache.get(escritorioId);
  if (c && Date.now() - c.em < TTL_MS) return c.situacao;
  try {
    const est = await estadoCobranca(escritorioId);
    // Escritório que não existe: falha fechada (não há o que liberar).
    const situacao: Situacao = est
      ? comGateway(situacaoEfetiva(paraEstado(est.escritorio, est.assinatura)), cobrancaConfigurada())
      : { somenteLeitura: true, motivo: 'suspenso' };
    cache.set(escritorioId, { em: Date.now(), situacao });
    return situacao;
  } catch {
    return c?.situacao ?? null;
  }
}

/** Plano que vale hoje para os limites (fundador, assinatura ou teste). */
export async function planoDoEscritorio(escritorioId: string): Promise<Plano | null> {
  const est = await estadoCobranca(escritorioId);
  return est ? planoEfetivo(paraEstado(est.escritorio, est.assinatura)) : null;
}

/** Empresas-clientes do escritório (para o limite do plano). */
export async function contarEmpresas(escritorioId: string): Promise<number> {
  const { count, error } = await getDb().from('empresas').select('id', { count: 'exact', head: true }).eq('escritorio_id', escritorioId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

// ---------------------------------------------------------------- Trava
const TRAVA_VALIDADE_MS = 2 * 60_000;

/**
 * Trava de operação de assinatura por escritório, no banco (vale entre
 * instâncias). Travas com mais de 2 minutos são de requisição que morreu.
 */
export async function adquirirTrava(escritorioId: string): Promise<boolean> {
  const db = getDb();
  await db.from('cobranca_travas').delete().eq('escritorio_id', escritorioId)
    .lt('em', new Date(Date.now() - TRAVA_VALIDADE_MS).toISOString());
  const { error } = await db.from('cobranca_travas').insert({ escritorio_id: escritorioId });
  if (!error) return true;
  if (error.code === '23505') return false;
  throw new Error(error.message);
}

export async function liberarTrava(escritorioId: string): Promise<void> {
  await getDb().from('cobranca_travas').delete().eq('escritorio_id', escritorioId);
}
