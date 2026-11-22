// Extrato bancário no Livro Caixa (Sprint 17, Frente D) — a parte com banco.
//
// A regra é pura e mora em lib/extratoBancario.ts. Aqui: o modo da empresa, as
// marcas das linhas já tratadas (0035), os lançamentos do período para casar, os
// meses fechados e a gravação do lote. A autorização é da rota (exigirGestor +
// motivoNegado) — nada aqui confere sessão.
//
// Isolamento: toda leitura parte de UMA empresa (os exercícios dela); as marcas
// filtram por `empresa_id`.
import { getDb, lerTudo, LOTE_IN } from './db';
import { ErroCaixa } from './caixa';
import { MODO_PADRAO, MODOS, type LancamentoConciliacao, type Marca, type ModoExtrato } from './extratoBancario';

const num = (v: unknown): number => (v == null ? 0 : Number(v));

/** A tabela da 0035 ainda não existe? (código publicado antes da migração) */
export const semTabelaExtrato = (e: { code?: string; message?: string } | null | undefined): boolean =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /caixa_extrato_(linhas|config)/.test(String(e.message ?? '')));

export const ERRO_SEM_0035 = 'Esta parte da importação ainda não está instalada (falta a migração 0035). Peça ao suporte para atualizar o banco.';

/** Modo da empresa (padrão 'par' — a conta bancária fora do caixa). `instalada` = existe a 0035. */
export async function lerModoExtrato(empresaId: string): Promise<{ modo: ModoExtrato; instalada: boolean }> {
  const { data, error } = await getDb().from('caixa_extrato_config').select('modo').eq('empresa_id', empresaId).maybeSingle();
  if (error) {
    if (semTabelaExtrato(error)) return { modo: MODO_PADRAO, instalada: false };
    throw new ErroCaixa(`caixa_extrato_config: ${error.message}`, 502);
  }
  const modo = MODOS.includes(data?.modo as ModoExtrato) ? (data!.modo as ModoExtrato) : MODO_PADRAO;
  return { modo, instalada: true };
}

export async function salvarModoExtrato(empresaId: string, escritorioId: string | null, modo: ModoExtrato, por: string): Promise<void> {
  const { error } = await getDb().from('caixa_extrato_config').upsert({
    empresa_id: empresaId, escritorio_id: escritorioId, modo, atualizado_por: por, atualizado_em: new Date().toISOString(),
  }, { onConflict: 'empresa_id' });
  if (error) {
    if (semTabelaExtrato(error)) throw new ErroCaixa(ERRO_SEM_0035, 503);
    throw new ErroCaixa(`caixa_extrato_config: ${error.message}`, 502);
  }
}

/** Marcas das chaves (em lotes de `LOTE_IN`). `null` = sem a 0035. */
export async function marcasDoExtrato(empresaId: string, chaves: string[]): Promise<Map<string, Marca> | null> {
  const r = new Map<string, Marca>();
  for (let i = 0; i < chaves.length; i += LOTE_IN) {
    const { data, error } = await getDb().from('caixa_extrato_linhas')
      .select('chave, situacao, lancamento_ids').eq('empresa_id', empresaId).in('chave', chaves.slice(i, i + LOTE_IN));
    if (error) {
      if (semTabelaExtrato(error)) return null;
      throw new ErroCaixa(`caixa_extrato_linhas: ${error.message}`, 502);
    }
    for (const m of data ?? []) {
      r.set(String(m.chave), { situacao: m.situacao as Marca['situacao'], lancamentoIds: ((m.lancamento_ids as string[] | null) ?? []).map(String) });
    }
  }
  return r;
}

async function exerciciosDa(empresaId: string): Promise<{ id: string; ano: number }[]> {
  const { data, error } = await getDb().from('exercicios').select('id, ano').eq('empresa_id', empresaId);
  if (error) throw new ErroCaixa(`exercicios: ${error.message}`, 502);
  return (data ?? []).map((e) => ({ id: String(e.id), ano: Number(e.ano) }));
}

/** Lançamentos da empresa entre `de` e `ate` (sem criar exercício). */
export async function lancamentosDoPeriodo(empresaId: string, de: string, ate: string): Promise<LancamentoConciliacao[]> {
  const anos = new Set<number>();
  for (let a = Number(de.slice(0, 4)); a <= Number(ate.slice(0, 4)); a++) anos.add(a);
  const ids = (await exerciciosDa(empresaId)).filter((e) => anos.has(e.ano)).map((e) => e.id);
  if (ids.length === 0) return [];
  const db = getDb();
  const linhas = await lerTudo<Record<string, unknown>>((i, f) => db.from('lancamentos')
    .select('id, data, historico, complemento, conta_id, entrada, saida, juros, multa')
    .in('exercicio_id', ids).gte('data', de).lte('data', ate)
    .order('data').order('criado_em').order('id').range(i, f),
  { falhar: (e) => new ErroCaixa(`lancamentos: ${e.message}`, 502) });
  return linhas.map((l) => ({
    id: String(l.id), data: String(l.data), historico: String(l.historico ?? ''),
    complemento: (l.complemento as string | null) ?? null, contaId: (l.conta_id as string | null) ?? null,
    entrada: num(l.entrada), saida: num(l.saida) + num(l.juros) + num(l.multa),
  }));
}

/** Meses fechados (`meses_confirmados`) por ano, para os anos citados. */
export async function fechadosPorAno(empresaId: string, anos: number[]): Promise<Record<number, number[]>> {
  const exs = (await exerciciosDa(empresaId)).filter((e) => anos.includes(e.ano));
  if (exs.length === 0) return {};
  const { data, error } = await getDb().from('meses_confirmados').select('exercicio_id, mes').in('exercicio_id', exs.map((e) => e.id));
  if (error) throw new ErroCaixa(`meses_confirmados: ${error.message}`, 502);
  const anoDe = new Map(exs.map((e) => [e.id, e.ano]));
  const r: Record<number, number[]> = {};
  for (const m of data ?? []) {
    const ano = anoDe.get(String(m.exercicio_id));
    if (ano != null) (r[ano] ??= []).push(Number(m.mes));
  }
  return r;
}

/** Dos ids informados, os que são lançamentos DESTA empresa (com ano e mês). */
export async function lancamentosDaEmpresa(empresaId: string, ids: string[]): Promise<{ id: string; exercicioId: string; ano: number; mes: number }[]> {
  if (ids.length === 0) return [];
  const exs = new Map((await exerciciosDa(empresaId)).map((e) => [e.id, e.ano]));
  const r: { id: string; exercicioId: string; ano: number; mes: number }[] = [];
  for (let i = 0; i < ids.length; i += LOTE_IN) {
    const { data, error } = await getDb().from('lancamentos').select('id, exercicio_id, data').in('id', ids.slice(i, i + LOTE_IN));
    if (error) throw new ErroCaixa(`lancamentos: ${error.message}`, 502);
    for (const l of data ?? []) {
      const ano = exs.get(String(l.exercicio_id));
      if (ano == null) continue; // de outra empresa: fica de fora
      r.push({ id: String(l.id), exercicioId: String(l.exercicio_id), ano, mes: Number(String(l.data).slice(5, 7)) });
    }
  }
  return r;
}

export interface MarcaNova {
  chave: string; situacao: Marca['situacao']; lancamentoIds: string[];
  data: string; valor: number; sentido: 'credito' | 'debito'; historicoBanco: string;
}

/**
 * Reserva as marcas do lote ANTES de gravar os lançamentos (a unique
 * (empresa_id, chave) barra o clique duplo). `false` = sem a 0035.
 */
export async function reservarMarcas(p: {
  empresaId: string; escritorioId: string | null; lote: string; autor: string; marcas: MarcaNova[];
}): Promise<boolean> {
  if (p.marcas.length === 0) return true;
  const db = getDb();
  // Conferência antes (o banco falso dos testes não tem unique; o real tem).
  const ja = await marcasDoExtrato(p.empresaId, p.marcas.map((m) => m.chave));
  if (ja === null) return false;
  if (ja.size > 0) throw new ErroCaixa('Parte destas linhas já foi importada (talvez em outra aba). Leia o extrato de novo.', 409);
  const { error } = await db.from('caixa_extrato_linhas').insert(p.marcas.map((m) => ({
    empresa_id: p.empresaId, escritorio_id: p.escritorioId, chave: m.chave, lote: p.lote, situacao: m.situacao,
    lancamento_ids: m.lancamentoIds, data: m.data, valor: m.valor, sentido: m.sentido,
    historico_banco: m.historicoBanco || null, criado_por: p.autor,
  })));
  if (error) {
    if (semTabelaExtrato(error)) return false;
    if (error.code === '23505') throw new ErroCaixa('Parte destas linhas já foi importada (talvez em outra aba). Leia o extrato de novo.', 409);
    throw new ErroCaixa(`caixa_extrato_linhas: ${error.message}`, 502);
  }
  return true;
}

/** Ids dos lançamentos criados por um lote (pelas marcas). `null` = sem a 0035. */
export async function lancamentosDoLote(empresaId: string, lote: string): Promise<string[] | null> {
  const { data, error } = await getDb().from('caixa_extrato_linhas')
    .select('situacao, lancamento_ids').eq('empresa_id', empresaId).eq('lote', lote);
  if (error) {
    if (semTabelaExtrato(error)) return null;
    throw new ErroCaixa(`caixa_extrato_linhas: ${error.message}`, 502);
  }
  return (data ?? []).filter((m) => m.situacao === 'lancada').flatMap((m) => ((m.lancamento_ids as string[] | null) ?? []).map(String));
}

export async function apagarMarcasDoLote(empresaId: string, lote: string): Promise<void> {
  const { error } = await getDb().from('caixa_extrato_linhas').delete().eq('empresa_id', empresaId).eq('lote', lote);
  if (error && !semTabelaExtrato(error)) throw new ErroCaixa(`caixa_extrato_linhas: ${error.message}`, 502);
}
