// Regras do Livro Caixa que as rotas de API compartilham.
//
// Tudo aqui é de servidor (usa lib/db). A autorização não mora aqui: cada rota
// chama a guarda de lib/acesso antes de encostar nestas funções.
import { getDb } from './db';

/** Conta do catálogo, com a marca de já ser usada por aquela empresa. */
export interface ContaCaixa {
  id: string;
  codigo: string;
  nome: string;
  grupo: string;
  natureza: 'receita' | 'despesa';
  daEmpresa: boolean;
}

export interface LancamentoCaixa {
  id: string;
  data: string; // AAAA-MM-DD
  historico: string;
  complemento: string | null;
  contaId: string | null;
  entrada: number;
  saida: number;
  criadoPor: string;
  criadoEm: string;
  atualizadoPor: string | null;
  conferidoPor: string | null;
  conferidoEm: string | null;
}

export interface ExercicioCaixa {
  id: string;
  empresaId: string;
  ano: number;
  saldoInicial: number;
}

/** Histórico que a UI oferece pronto, já com a conta que ele sugere. */
export interface HistoricoCaixa {
  texto: string;
  natureza: 'receita' | 'despesa';
  contaId: string | null;
}

// Numeric do Postgres pode chegar como string dependendo do driver — normaliza.
const num = (v: unknown): number => (v == null ? 0 : Number(v));

export class ErroCaixa extends Error {
  constructor(msg: string, readonly status = 400) {
    super(msg);
  }
}

/**
 * Devolve o exercício da empresa no ano, criando-o se ainda não existir.
 *
 * Cria sob demanda de propósito: a contadora não quer etapa de configuração
 * antes do primeiro lançamento. O saldo inicial nasce zero e é editável (é uma
 * das pendências com ela — ver docs/livro-caixa.md).
 */
export async function garantirExercicio(empresaId: string, ano: number): Promise<ExercicioCaixa> {
  const db = getDb();
  const busca = () =>
    db.from('exercicios').select('id, empresa_id, ano, saldo_inicial')
      .eq('empresa_id', empresaId).eq('ano', ano).maybeSingle();

  const { data, error } = await busca();
  if (error) throw new ErroCaixa(`exercicios: ${error.message}`, 502);
  if (data) {
    return { id: data.id, empresaId: data.empresa_id, ano: data.ano, saldoInicial: num(data.saldo_inicial) };
  }

  const { data: novo, error: errIns } = await db
    .from('exercicios').insert({ empresa_id: empresaId, ano }).select('id, empresa_id, ano, saldo_inicial').single();
  if (novo) {
    return { id: novo.id, empresaId: novo.empresa_id, ano: novo.ano, saldoInicial: num(novo.saldo_inicial) };
  }
  // Corrida: outra requisição criou o mesmo exercício entre a busca e o insert.
  // O unique (empresa_id, ano) barrou — basta reler.
  const { data: agora } = await busca();
  if (agora) {
    return { id: agora.id, empresaId: agora.empresa_id, ano: agora.ano, saldoInicial: num(agora.saldo_inicial) };
  }
  throw new ErroCaixa(`Não foi possível abrir o exercício de ${ano}: ${errIns?.message ?? 'erro desconhecido'}`, 502);
}

/** Catálogo inteiro, com as contas da empresa marcadas e no topo. */
export async function contasDaEmpresa(empresaId: string): Promise<ContaCaixa[]> {
  const db = getDb();
  const [cat, vinculos] = await Promise.all([
    // `codigo` desempata: contas criadas depois entram no fim do próprio grupo,
    // com a mesma `ordem` da última conta dele.
    db.from('plano_contas').select('id, codigo, nome, grupo, natureza').eq('ativa', true)
      .order('ordem').order('codigo'),
    db.from('empresa_contas').select('conta_id').eq('empresa_id', empresaId),
  ]);
  if (cat.error) throw new ErroCaixa(`plano_contas: ${cat.error.message}`, 502);
  if (vinculos.error) throw new ErroCaixa(`empresa_contas: ${vinculos.error.message}`, 502);

  const usadas = new Set((vinculos.data ?? []).map((v) => v.conta_id as string));
  return (cat.data ?? []).map((c) => ({
    id: c.id, codigo: c.codigo, nome: c.nome, grupo: c.grupo,
    natureza: c.natureza, daEmpresa: usadas.has(c.id),
  }));
}

/**
 * Põe a conta na lista da empresa. É o que torna a lista **aberta**: escolher
 * uma conta nova durante o lançamento já a inclui, sem cadastro prévio.
 */
export async function vincularConta(empresaId: string, contaId: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('empresa_contas')
    .upsert({ empresa_id: empresaId, conta_id: contaId }, { onConflict: 'empresa_id,conta_id', ignoreDuplicates: true });
  if (error) throw new ErroCaixa(`empresa_contas: ${error.message}`, 502);
}

export async function historicosPadrao(): Promise<HistoricoCaixa[]> {
  const db = getDb();
  const { data, error } = await db.from('historicos_padrao').select('texto, natureza, conta_id').order('ordem');
  if (error) throw new ErroCaixa(`historicos_padrao: ${error.message}`, 502);
  return (data ?? []).map((h) => ({ texto: h.texto, natureza: h.natureza, contaId: h.conta_id }));
}

/** Lançamentos de um mês, na ordem em que aparecem no livro. */
export async function lancamentosDoMes(exercicioId: string, mes: number): Promise<LancamentoCaixa[]> {
  const db = getDb();
  const { data, error } = await db
    .from('lancamentos')
    .select('id, data, historico, complemento, conta_id, entrada, saida, criado_por, criado_em, atualizado_por, conferido_por, conferido_em')
    .eq('exercicio_id', exercicioId).eq('mes', mes)
    .order('data').order('criado_em');
  if (error) throw new ErroCaixa(`lancamentos: ${error.message}`, 502);
  return (data ?? []).map((l) => ({
    id: l.id, data: l.data, historico: l.historico, complemento: l.complemento,
    contaId: l.conta_id, entrada: num(l.entrada), saida: num(l.saida),
    criadoPor: l.criado_por, criadoEm: l.criado_em, atualizadoPor: l.atualizado_por,
    conferidoPor: l.conferido_por, conferidoEm: l.conferido_em,
  }));
}

/**
 * Saldo que o mês recebe do anterior — o "saldo transportado" da planilha.
 * É o saldo inicial do exercício mais tudo que se moveu nos meses anteriores.
 */
export async function saldoTransportado(ex: ExercicioCaixa, mes: number): Promise<number> {
  if (mes <= 1) return ex.saldoInicial;
  const db = getDb();
  const { data, error } = await db
    .from('lancamentos').select('entrada, saida').eq('exercicio_id', ex.id).lt('mes', mes);
  if (error) throw new ErroCaixa(`lancamentos: ${error.message}`, 502);
  return (data ?? []).reduce((s, l) => s + num(l.entrada) - num(l.saida), ex.saldoInicial);
}

/** Meses já confirmados pela contabilidade (libera o resumo para o cliente). */
export async function mesesConfirmados(exercicioId: string): Promise<number[]> {
  const db = getDb();
  const { data, error } = await db.from('meses_confirmados').select('mes').eq('exercicio_id', exercicioId);
  if (error) throw new ErroCaixa(`meses_confirmados: ${error.message}`, 502);
  return (data ?? []).map((m) => m.mes as number).sort((a, b) => a - b);
}

/** De qual empresa é este lançamento — usado para autorizar edição e exclusão. */
export async function empresaDoLancamento(id: string): Promise<{ empresaId: string; exercicioId: string; ano: number }> {
  const db = getDb();
  const { data, error } = await db
    .from('lancamentos').select('exercicio_id, exercicios!inner(empresa_id, ano)').eq('id', id).maybeSingle();
  if (error) throw new ErroCaixa(`lancamentos: ${error.message}`, 502);
  if (!data) throw new ErroCaixa('Lançamento não encontrado.', 404);
  // O join volta como objeto (inner, um-para-um) ou array, conforme a versão.
  const ex = (Array.isArray(data.exercicios) ? data.exercicios[0] : data.exercicios) as { empresa_id: string; ano: number };
  return { empresaId: ex.empresa_id, exercicioId: data.exercicio_id, ano: ex.ano };
}

// ------------------------------------------------------------------ validação

/** Aceita "1234,56", "1.234,56" e "1234.56" — o administrativo digita como quiser. */
export function paraValor(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v ?? '').trim();
  if (!s) return 0;
  const limpo = s.replace(/\s|R\$/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = Number(limpo);
  return Number.isFinite(n) ? n : NaN;
}

export interface EntradaLancamento {
  data: string;
  historico: string;
  complemento: string | null;
  contaId: string | null;
  entrada: number;
  saida: number;
}

/** Valida o que o formulário mandou. O banco reforça o resto (xor, ano, sinal). */
export function validarLancamento(body: Record<string, unknown>, ano: number): EntradaLancamento {
  const data = String(body.data ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new ErroCaixa('Informe a data no formato AAAA-MM-DD.');
  if (Number(data.slice(0, 4)) !== ano) throw new ErroCaixa(`A data tem que ser do exercício de ${ano}.`);

  const historico = String(body.historico ?? '').trim();
  if (!historico) throw new ErroCaixa('Informe o histórico.');

  const entrada = paraValor(body.entrada);
  const saida = paraValor(body.saida);
  if (Number.isNaN(entrada) || Number.isNaN(saida)) throw new ErroCaixa('Valor inválido.');
  if (entrada < 0 || saida < 0) throw new ErroCaixa('O valor não pode ser negativo.');
  if (entrada > 0 && saida > 0) throw new ErroCaixa('O lançamento é entrada ou saída, não os dois.');
  if (entrada === 0 && saida === 0) throw new ErroCaixa('Informe o valor da entrada ou da saída.');

  const complemento = String(body.complemento ?? '').trim() || null;
  const contaId = String(body.contaId ?? '').trim() || null;
  return {
    data, historico, complemento, contaId,
    entrada: Math.round(entrada * 100) / 100,
    saida: Math.round(saida * 100) / 100,
  };
}

/**
 * Histórico da perna bancária do pagamento em cheque.
 *
 * Regra que a contadora confirmou: **pagamento com cheque gera dois
 * lançamentos** — o dinheiro sai da conta corrente (entra no caixa) e depois
 * paga a despesa (sai do caixa). A perna bancária fica sem conta de propósito:
 * transferência não é receita nem despesa, e o catálogo dela não tem linha para
 * isso (é por isso que os históricos de depósito e retirada também não têm).
 */
export const HISTORICO_RETIRADA_CHEQUE = 'Retirada de conta corrente';
