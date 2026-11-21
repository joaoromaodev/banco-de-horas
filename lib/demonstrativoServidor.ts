// Demonstrativo de caixa — leitura do banco e registro de envio. Só de servidor.
// A regra está em lib/demonstrativo.ts. A autorização é da rota (exigirEmpresa /
// exigirGestor): cada função aqui recebe a empresa já autorizada.
import { Calendario, chaveConclusao, ocorrenciasDe, somarDias } from './agenda';
import { listarConclusoes, listarObrigacoes } from './agendaServidor';
import { lerEmpresa } from './cadastro';
import { contasDaEmpresa, lancamentosDoMes, mesesConfirmados, resumoDoExercicio, saidaEfetiva } from './caixa';
import {
  Demonstrativo, liberadoAte, MesDaSerie, mesLiberado, montarDemonstrativo, ObrigacaoDemonstrativo,
  PendenciaDemonstrativo, SaidaPorConta,
} from './demonstrativo';
import { getDb } from './db';

/** Janela das obrigações: atrasadas até 1 ano atrás (como o painel) e as que vencem em 30 dias. */
const ATRASO_MAX_DIAS = 365;
const ADIANTE_DIAS = 30;

export type ResultadoDemonstrativo =
  | { situacao: 'ok'; demonstrativo: Demonstrativo; indisponiveis: ('pendencias' | 'obrigacoes')[] }
  /** O mês não está confirmado em sequência desde janeiro: nada é mostrado (nem para a prévia). */
  | { situacao: 'nao_liberado'; liberadoAte: number; confirmado: boolean };

/** Exercício existente (sem criar) — olhar o demonstrativo não pode gravar nada. */
async function exercicioExistente(empresaId: string, ano: number): Promise<{ id: string } | null> {
  const { data, error } = await getDb().from('exercicios').select('id')
    .eq('empresa_id', empresaId).eq('ano', ano).maybeSingle();
  if (error) throw new Error(`exercicios: ${error.message}`);
  return data ? { id: String(data.id) } : null;
}

async function serieDoAno(empresaId: string, ano: number): Promise<{ meses: MesDaSerie[]; confirmados: number[]; exercicioId: string } | null> {
  const ex = await exercicioExistente(empresaId, ano);
  if (!ex) return null;
  const [resumo, confirmados] = await Promise.all([resumoDoExercicio(ex.id), mesesConfirmados(ex.id)]);
  const ate = liberadoAte(confirmados);
  const meses = resumo.filter((m) => m.mes <= ate).map((m) => ({ ano, mes: m.mes, entradas: m.entradas, saidas: m.saidas, saldoFinal: m.saldoFinal }));
  return { meses, confirmados, exercicioId: ex.id };
}

async function pendenciasAbertas(empresaId: string): Promise<PendenciaDemonstrativo[]> {
  const { data, error } = await getDb().from('pendencias').select('titulo, prazo')
    .eq('empresa_id', empresaId).eq('status', 'aberta').is('excluido_em', null)
    .order('prazo', { ascending: true, nullsFirst: false }).order('criado_em').limit(20);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return (data ?? []).map((p) => ({ titulo: String(p.titulo), prazo: p.prazo ? String(p.prazo).slice(0, 10) : null }));
}

async function obrigacoesQueVencem(empresaId: string, escritorioId: string, hoje: string): Promise<ObrigacaoDemonstrativo[]> {
  const escopo = { escritorioId };
  const [obrigacoes, conclusoes] = await Promise.all([
    listarObrigacoes(escopo, empresaId), listarConclusoes(escopo, Number(hoje.slice(0, 4)) - 2, empresaId),
  ]);
  const feitas = new Set(conclusoes.map((c) => chaveConclusao(c.obrigacaoId, c.competencia)));
  const porId = new Map(obrigacoes.map((o) => [o.id, o]));
  return ocorrenciasDe(obrigacoes, somarDias(hoje, -ATRASO_MAX_DIAS), somarDias(hoje, ADIANTE_DIAS), new Calendario())
    .filter((oc) => !feitas.has(chaveConclusao(oc.obrigacaoId, oc.competencia)))
    .slice(0, 15)
    .map((oc) => ({
      nome: porId.get(oc.obrigacaoId)?.nome ?? 'Obrigação', competencia: oc.competencia,
      vencimento: oc.vencimento, atrasada: oc.vencimento < hoje,
    }));
}

/**
 * Lê tudo do demonstrativo de um mês. Só funciona para mês liberado (confirmado em
 * sequência desde janeiro) — vale também para a contadora: a prévia mostra
 * exatamente o que o cliente vai ver. Pendências e obrigações falham sozinhas
 * (tabela de migração pendente): a seção vira "indisponível", o resto segue.
 */
export async function lerDemonstrativo(empresaId: string, ano: number, mes: number, hoje: string): Promise<ResultadoDemonstrativo> {
  const [atual, anterior] = await Promise.all([serieDoAno(empresaId, ano), serieDoAno(empresaId, ano - 1)]);
  if (!atual || !mesLiberado(atual.confirmados, mes)) {
    return { situacao: 'nao_liberado', liberadoAte: atual ? liberadoAte(atual.confirmados) : 0, confirmado: atual?.confirmados.includes(mes) ?? false };
  }
  const indisponiveis: ('pendencias' | 'obrigacoes')[] = [];
  const emp = await lerEmpresa(empresaId);

  const [lancs, contas, pendencias, obrigacoes] = await Promise.all([
    lancamentosDoMes(atual.exercicioId, mes),
    contasDaEmpresa(empresaId, { todos: true }),
    pendenciasAbertas(empresaId).catch((e) => { indisponiveis.push('pendencias'); console.error('[demonstrativo] pendências:', e?.code ?? '', e?.message); return []; }),
    emp?.escritorioId
      ? obrigacoesQueVencem(empresaId, emp.escritorioId, hoje).catch((e) => { indisponiveis.push('obrigacoes'); console.error('[demonstrativo] agenda:', e?.code ?? '', e?.message); return []; })
      : Promise.resolve([] as ObrigacaoDemonstrativo[]),
  ]);

  const nomes = new Map(contas.map((c) => [c.id, c.nome]));
  const saidasPorConta: SaidaPorConta[] = [];
  let movimentacaoBancaria = 0;
  for (const l of lancs) {
    const v = saidaEfetiva(l);
    if (!(v > 0)) continue;
    // Saída sem conta é movimentação bancária (depósito, perna do cheque): não é gasto.
    if (!l.contaId) movimentacaoBancaria += v;
    else saidasPorConta.push({ conta: nomes.get(l.contaId) ?? 'Conta não identificada', valor: v });
  }

  const d = montarDemonstrativo({
    ano, mes, serie: [...(anterior?.meses ?? []), ...atual.meses],
    saidasPorConta, movimentacaoBancaria, pendencias, obrigacoes,
  });
  if (!d) return { situacao: 'nao_liberado', liberadoAte: liberadoAte(atual.confirmados), confirmado: true };
  return { situacao: 'ok', demonstrativo: d, indisponiveis };
}

// ----------------------------------------------------------------- envio

export interface RegistroEnvio {
  situacao: 'enviando' | 'enviado' | 'registrado' | 'falhou';
  destinatarios: number;
  enviadoPor: string;
  enviadoEm: string;
  reenvios: number;
  erro: string | null;
}

export async function lerEnvio(empresaId: string, ano: number, mes: number): Promise<RegistroEnvio | null> {
  const { data, error } = await getDb().from('demonstrativos_enviados')
    .select('situacao, destinatarios, enviado_por, enviado_em, reenvios, erro')
    .eq('empresa_id', empresaId).eq('ano', ano).eq('mes', mes).maybeSingle();
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  if (!data) return null;
  return {
    situacao: data.situacao, destinatarios: Number(data.destinatarios), enviadoPor: String(data.enviado_por),
    enviadoEm: String(data.enviado_em), reenvios: Number(data.reenvios), erro: data.erro ? String(data.erro) : null,
  };
}

/**
 * Trava de idempotência: reserva (empresa, ano, mês) antes de mandar. Devolve false
 * se já foi enviado (ou está sendo enviado agora) e a contadora não pediu reenvio.
 * Envio que falhou ou que só foi registrado (sem provedor) pode ser tentado de novo
 * sem pedir reenvio — nada chegou ao cliente.
 */
export async function reservarEnvio(
  r: { empresaId: string; escritorioId: string; ano: number; mes: number; por: string }, reenviar: boolean,
): Promise<boolean> {
  const db = getDb();
  const { error } = await db.from('demonstrativos_enviados').insert({
    empresa_id: r.empresaId, escritorio_id: r.escritorioId, ano: r.ano, mes: r.mes, enviado_por: r.por, situacao: 'enviando',
  });
  if (!error) return true;
  if (error.code !== '23505') throw Object.assign(new Error(error.message), { code: error.code });

  const atual = await lerEnvio(r.empresaId, r.ano, r.mes);
  const jaChegou = atual?.situacao === 'enviado' || atual?.situacao === 'enviando';
  if (jaChegou && !reenviar) return false;
  // Atualização condicionada ao que lemos: duas contadoras clicando juntas — só uma ganha.
  let q = db.from('demonstrativos_enviados')
    .update({ situacao: 'enviando', enviado_por: r.por, enviado_em: new Date().toISOString(), erro: null, reenvios: (atual?.reenvios ?? 0) + (jaChegou ? 1 : 0) })
    .eq('empresa_id', r.empresaId).eq('ano', r.ano).eq('mes', r.mes);
  if (atual) q = q.eq('situacao', atual.situacao);
  const { data, error: e2 } = await q.select('empresa_id');
  if (e2) throw Object.assign(new Error(e2.message), { code: e2.code });
  return (data ?? []).length > 0;
}

export async function concluirEnvio(
  empresaId: string, ano: number, mes: number,
  r: { situacao: 'enviado' | 'registrado' | 'falhou'; destinatarios: number; erro?: string },
): Promise<void> {
  const { error } = await getDb().from('demonstrativos_enviados')
    .update({ situacao: r.situacao, destinatarios: r.destinatarios, erro: r.erro ?? null })
    .eq('empresa_id', empresaId).eq('ano', ano).eq('mes', mes);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
}

/** E-mails dos logins `cliente` da empresa (o login é o e-mail). Só os que parecem e-mail. */
export async function emailsDoCliente(empresaId: string): Promise<string[]> {
  const { data, error } = await getDb().from('usuarios').select('email').eq('role', 'cliente').eq('empresa', empresaId);
  if (error) throw new Error(`usuarios: ${error.message}`);
  return [...new Set((data ?? []).map((u) => String(u.email).trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
}

export async function nomeDoEscritorio(escritorioId: string): Promise<string> {
  const { data } = await getDb().from('escritorios').select('nome').eq('id', escritorioId).maybeSingle();
  return String(data?.nome ?? 'Seu escritório contábil');
}
