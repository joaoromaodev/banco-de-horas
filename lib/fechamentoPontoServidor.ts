// Mês de ponto fechado e aceite do cliente (migração 0034) — só de servidor.
//
// A autorização é das rotas: /api/resumo-folha/fechamento (contabilidade,
// exigirEmpresaPonto) e /api/envio-ponto/aceite (cliente, exigirClienteDaEmpresa).
// Toda função recebe o escritório e a empresa JÁ validados e filtra pelos dois.
// Regras puras em lib/mesFechado.ts. A trava das frequências está em
// lib/pontoDb.ts (salvarFrequencia → exigirMesPontoAberto).
//
// Sem a 0034: a leitura devolve "nada fechado" e as gravações lançam
// `ErroBancoPendente` (503 "aguardando o banco").
import { getDb } from './db';
import { ehTabelaInexistente, ErroBancoPendente } from './pontoDb';
import {
  type AceiteRegistro, DECLARACAO_ACEITE, type EventoMes, type FotoResumo, ordenarHistorico, type RespostaAceite, situacaoAceite,
  type SituacaoAceite,
} from './mesFechado';

/** Teto de respostas por mês (dúvidas repetidas): acima disso, fale com a contabilidade. */
export const MAX_RESPOSTAS_MES = 30;

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface FechamentoPonto {
  ano: number;
  mes: number;
  por: string;
  em: string;
  assinatura: string;
  resumo: FotoResumo;
}

export class ErroFechamento extends Error {
  constructor(msg: string, readonly status = 400) { super(msg); }
}

function falhar(e: { code?: string; message: string }): never {
  if (ehTabelaInexistente(e)) throw new ErroBancoPendente();
  throw new Error(e.message);
}

const paraFechamento = (r: any): FechamentoPonto => ({
  ano: Number(r.ano), mes: Number(r.mes), por: String(r.fechado_por), em: String(r.fechado_em),
  assinatura: String(r.assinatura), resumo: r.resumo as FotoResumo,
});

const paraAceite = (r: any): AceiteRegistro => ({
  assinatura: String(r.assinatura), resposta: r.resposta === 'aceito' ? 'aceito' : 'duvida',
  duvida: r.duvida ? String(r.duvida) : null, por: String(r.por), em: String(r.em),
});

/** O fechamento do mês, ou `null` (aberto ou sem a 0034). */
export async function lerFechamento(escritorioId: string, empresaId: string, ano: number, mes: number): Promise<FechamentoPonto | null> {
  const { data, error } = await getDb().from('ponto_meses_fechados')
    .select('ano, mes, fechado_por, fechado_em, assinatura, resumo')
    .eq('escritorio_id', escritorioId).eq('empresa_id', empresaId).eq('ano', ano).eq('mes', mes).maybeSingle();
  if (error) {
    if (ehTabelaInexistente(error)) return null;
    falhar(error);
  }
  return data ? paraFechamento(data) : null;
}

/** Histórico de fechar/reabrir do mês (mais recente primeiro). Sem a 0034: vazio. */
export async function historicoPonto(escritorioId: string, empresaId: string, ano: number, mes: number): Promise<EventoMes[]> {
  const { data, error } = await getDb().from('ponto_meses_historico')
    .select('acao, por, em, motivo')
    .eq('escritorio_id', escritorioId).eq('empresa_id', empresaId).eq('ano', ano).eq('mes', mes)
    .order('em', { ascending: false }).limit(100);
  if (error) {
    if (ehTabelaInexistente(error)) return [];
    falhar(error);
  }
  return ordenarHistorico((data ?? []).map((h: any) => ({
    acao: h.acao === 'reabriu' ? 'reabriu' as const : 'fechou' as const,
    por: String(h.por), em: String(h.em), motivo: h.motivo ? String(h.motivo) : null,
  })));
}

/** Aceites e dúvidas do cliente no mês (todas as assinaturas, mais recente primeiro). */
export async function aceitesDoMes(escritorioId: string, empresaId: string, ano: number, mes: number): Promise<AceiteRegistro[]> {
  const { data, error } = await getDb().from('ponto_aceites')
    .select('assinatura, resposta, duvida, por, em')
    .eq('escritorio_id', escritorioId).eq('empresa_id', empresaId).eq('ano', ano).eq('mes', mes)
    .order('em', { ascending: false }).limit(100);
  if (error) {
    if (ehTabelaInexistente(error)) return [];
    falhar(error);
  }
  return ordenarHistorico((data ?? []).map(paraAceite));
}

/** Fecha o mês com a foto do resumo. Já fechado: 409 (reabra antes de fechar de novo). */
export async function fecharMesPonto(n: {
  escritorioId: string; empresaId: string; ano: number; mes: number; por: string; assinatura: string; resumo: FotoResumo;
}): Promise<FechamentoPonto> {
  const db = getDb();
  if (await lerFechamentoOuPendente(n.escritorioId, n.empresaId, n.ano, n.mes)) {
    throw new ErroFechamento('Este mês já está fechado.', 409);
  }
  const em = new Date().toISOString();
  const { error } = await db.from('ponto_meses_fechados').insert({
    escritorio_id: n.escritorioId, empresa_id: n.empresaId, ano: n.ano, mes: n.mes,
    fechado_por: n.por, fechado_em: em, assinatura: n.assinatura, resumo: n.resumo,
  });
  if (error) {
    // Corrida: outro clique fechou primeiro (chave primária).
    if (error.code === '23505') throw new ErroFechamento('Este mês já está fechado.', 409);
    falhar(error);
  }
  const { error: eh } = await db.from('ponto_meses_historico').insert({
    escritorio_id: n.escritorioId, empresa_id: n.empresaId, ano: n.ano, mes: n.mes,
    acao: 'fechou', por: n.por, em, assinatura: n.assinatura,
  });
  if (eh) console.error('[ponto] histórico do fechamento:', eh.message.slice(0, 120));
  return { ano: n.ano, mes: n.mes, por: n.por, em, assinatura: n.assinatura, resumo: n.resumo };
}

/** Como lerFechamento, mas sem a 0034 lança ErroBancoPendente (para gravar). */
async function lerFechamentoOuPendente(escritorioId: string, empresaId: string, ano: number, mes: number): Promise<FechamentoPonto | null> {
  const { data, error } = await getDb().from('ponto_meses_fechados')
    .select('ano, mes, fechado_por, fechado_em, assinatura, resumo')
    .eq('escritorio_id', escritorioId).eq('empresa_id', empresaId).eq('ano', ano).eq('mes', mes).maybeSingle();
  if (error) falhar(error);
  return data ? paraFechamento(data) : null;
}

/** Reabre o mês. O motivo (já validado) vai para o histórico ANTES de reabrir. */
export async function reabrirMesPonto(n: {
  escritorioId: string; empresaId: string; ano: number; mes: number; por: string; motivo: string;
}): Promise<void> {
  const db = getDb();
  const atual = await lerFechamentoOuPendente(n.escritorioId, n.empresaId, n.ano, n.mes);
  if (!atual) throw new ErroFechamento('Este mês não está fechado.', 409);
  const { data: reg, error: eh } = await db.from('ponto_meses_historico').insert({
    escritorio_id: n.escritorioId, empresa_id: n.empresaId, ano: n.ano, mes: n.mes,
    acao: 'reabriu', por: n.por, em: new Date().toISOString(), motivo: n.motivo, assinatura: atual.assinatura,
  }).select('id').maybeSingle();
  if (eh) falhar(eh);
  const { error } = await db.from('ponto_meses_fechados').delete()
    .eq('escritorio_id', n.escritorioId).eq('empresa_id', n.empresaId).eq('ano', n.ano).eq('mes', n.mes);
  if (error) {
    if (reg?.id) await db.from('ponto_meses_historico').delete().eq('id', reg.id);
    falhar(error);
  }
}

/**
 * Registra a resposta do cliente para o fechamento ATUAL (a assinatura que ele viu).
 * "Aceito" é definitivo para aquela assinatura; depois de uma dúvida ele ainda pode aceitar.
 */
export async function registrarAceite(n: {
  escritorioId: string; empresaId: string; ano: number; mes: number; por: string;
  assinatura: string; resposta: RespostaAceite; duvida: string | null;
}): Promise<AceiteRegistro> {
  const f = await lerFechamentoOuPendente(n.escritorioId, n.empresaId, n.ano, n.mes);
  if (!f) throw new ErroFechamento('Este mês não está fechado para aceite (a contabilidade pode tê-lo reaberto). Atualize a página.', 409);
  if (f.assinatura !== n.assinatura) {
    throw new ErroFechamento('Os números deste mês mudaram desde que a página abriu. Atualize e confira de novo.', 409);
  }
  const anteriores = await aceitesDoMes(n.escritorioId, n.empresaId, n.ano, n.mes);
  const { situacao } = situacaoAceite(f.assinatura, anteriores);
  if (situacao === 'aceito') throw new ErroFechamento('Este resumo já foi aceito.', 409);
  if (anteriores.length >= MAX_RESPOSTAS_MES) {
    throw new ErroFechamento('Muitas respostas para este mês. Fale com a contabilidade pelo canal de costume.', 429);
  }
  const em = new Date().toISOString();
  const { error } = await getDb().from('ponto_aceites').insert({
    escritorio_id: n.escritorioId, empresa_id: n.empresaId, ano: n.ano, mes: n.mes, assinatura: f.assinatura,
    resposta: n.resposta, duvida: n.resposta === 'duvida' ? n.duvida : null, por: n.por, em,
    // O texto que o "Aceito" declara, pela versão (o texto muda, o registro antigo não).
    declaracao: n.resposta === 'aceito' ? DECLARACAO_ACEITE.versao : null,
  });
  if (error) falhar(error);
  return { assinatura: f.assinatura, resposta: n.resposta, duvida: n.resposta === 'duvida' ? n.duvida : null, por: n.por, em };
}

export interface FechamentoCliente {
  ano: number;
  mes: number;
  fechadoEm: string;
  assinatura: string;
  resumo: FotoResumo;
  situacao: SituacaoAceite;
  /** Última resposta para ESTE fechamento (quem, quando, a dúvida). */
  resposta: AceiteRegistro | null;
}

/**
 * Meses fechados da empresa a partir de `desde` (o cliente vê os últimos 13 meses),
 * com a situação do aceite. Sem a 0034: lista vazia. O nome de quem FECHOU não vai.
 */
export async function fechamentosParaCliente(escritorioId: string, empresaId: string, desde: { ano: number; mes: number }): Promise<FechamentoCliente[]> {
  const db = getDb();
  const { data, error } = await db.from('ponto_meses_fechados')
    .select('ano, mes, fechado_por, fechado_em, assinatura, resumo')
    .eq('escritorio_id', escritorioId).eq('empresa_id', empresaId).gte('ano', desde.ano)
    .order('ano', { ascending: false }).order('mes', { ascending: false }).limit(60);
  if (error) {
    if (ehTabelaInexistente(error)) return [];
    falhar(error);
  }
  const fechados = (data ?? []).map(paraFechamento)
    .filter((f) => f.ano * 12 + f.mes >= desde.ano * 12 + desde.mes);
  if (!fechados.length) return [];
  const { data: ac, error: ea } = await db.from('ponto_aceites')
    .select('ano, mes, assinatura, resposta, duvida, por, em')
    .eq('escritorio_id', escritorioId).eq('empresa_id', empresaId).gte('ano', desde.ano).limit(1000);
  if (ea && !ehTabelaInexistente(ea)) falhar(ea);
  const aceites = (ac ?? []) as any[];
  return fechados.map((f) => {
    const doMes = aceites.filter((a) => Number(a.ano) === f.ano && Number(a.mes) === f.mes).map(paraAceite);
    const s = situacaoAceite(f.assinatura, doMes);
    return { ano: f.ano, mes: f.mes, fechadoEm: f.em, assinatura: f.assinatura, resumo: f.resumo, situacao: s.situacao, resposta: s.ultimo };
  });
}
