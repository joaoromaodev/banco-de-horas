// Caixa inteligente (Sprint 5, Frente A) — a parte com banco.
//
// As regras são puras e moram em lib/sugestaoConta.ts e lib/revisaoCaixa.ts; aqui
// só se carrega o que elas precisam e se grava o registro das sugestões
// (`caixa_sugestoes`, migração 0017). A autorização é da rota (lib/acesso).
//
// Isolamento: toda leitura parte de UMA empresa (os exercícios dela) — nunca de
// um escritório inteiro nem de outra empresa. O catálogo usado para nomear as
// contas na revisão é resolvido só para os ids que os lançamentos já citam.
import { getDb, lerTudo } from './db';
import { ErroCaixa } from './caixa';
import { lerEmpresa } from './cadastro';
import { compactarExemplos, exemploDe, sugestaoAceita, type ExemploConferido, type OrigemSugestao } from './sugestaoConta';
import { revisarLancamentos, type LancamentoRevisao, type ResultadoRevisao } from './revisaoCaixa';
import { iaConfigurada } from './ia/config';

const num = (v: unknown): number => (v == null ? 0 : Number(v));

/** Quantos lançamentos, no máximo, a sugestão lê (os mais recentes). */
export const MAX_EXEMPLOS = 3000;
/** Chamadas de IA por escritório por dia (fuso de Belém). */
export const LIMITE_IA_DIA = 200;
/** …e por empresa quando quem pergunta é o cliente (um cliente não esgota o escritório). */
export const LIMITE_IA_EMPRESA_CLIENTE = 30;

/** A tabela da 0017 ainda não existe? (código publicado antes da migração) */
export const faltaTabela = (msg: string | undefined) =>
  /caixa_sugestoes/.test(String(msg)) && /does not exist|schema cache|could not find/i.test(String(msg));

/** Hoje em Belém (UTC−3, sem horário de verão), AAAA-MM-DD. */
export function hojeBelem(agora: Date = new Date()): string {
  return new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

/** Lê todas as páginas (lib/db → lerTudo), traduzindo o erro do banco. */
const paginado = <T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  max: number,
): Promise<T[]> => lerTudo(consulta, { max, falhar: (e) => new ErroCaixa(`lancamentos: ${e.message}`, 502) });

async function exerciciosDa(empresaId: string): Promise<{ id: string; ano: number; saldoInicial: number }[]> {
  const { data, error } = await getDb().from('exercicios').select('id, ano, saldo_inicial').eq('empresa_id', empresaId);
  if (error) throw new ErroCaixa(`exercicios: ${error.message}`, 502);
  return (data ?? []).map((e) => ({ id: e.id as string, ano: Number(e.ano), saldoInicial: num(e.saldo_inicial) }));
}

// ------------------------------------------------------------------ sugestão

/**
 * Os lançamentos da empresa (os mais recentes), reduzidos a exemplos e
 * compactados — é o que a tela usa para sugerir. Cada um leva se já foi
 * conferido (pesa 1) ou não (pesa 0,3) e se a contabilidade o corrigiu antes de
 * conferir (pesa 2). O nome/CPF do pagador vira pseudônimo aqui, no servidor
 * (`exemploDe` → `chavePagador`); as palavras do complemento vão como estão (quem
 * recebe já vê esses lançamentos).
 */
export async function exemplosDaEmpresa(empresaId: string): Promise<{ exemplos: ExemploConferido[]; total: number; conferidos: number }> {
  const ids = (await exerciciosDa(empresaId)).map((e) => e.id);
  if (ids.length === 0) return { exemplos: [], total: 0, conferidos: 0 };
  const db = getDb();
  const linhas = await paginado<Record<string, unknown>>((de, ate) =>
    db.from('lancamentos')
      .select('complemento, conta_id, historico, entrada, saida, juros, multa, pagador_nome, pagador_documento, criado_por, atualizado_por, conferido_em')
      .in('exercicio_id', ids)
      .order('data', { ascending: false }).order('id').range(de, ate), MAX_EXEMPLOS);
  let conferidos = 0;
  const exemplos = linhas.map((l) => {
    const conferido = !!l.conferido_em;
    if (conferido) conferidos++;
    // Corrigido = alterado por outra pessoa (a contabilidade) e então conferido.
    const corrigido = conferido && !!l.atualizado_por && l.atualizado_por !== l.criado_por;
    return exemploDe({
      complemento: l.complemento as string | null, contaId: l.conta_id as string | null,
      historico: String(l.historico ?? ''), entrada: num(l.entrada), saida: num(l.saida),
      juros: num(l.juros), multa: num(l.multa),
      pagadorNome: l.pagador_nome as string | null, pagadorDocumento: l.pagador_documento as string | null,
      conferido, corrigido,
    });
  });
  return { exemplos: compactarExemplos(exemplos), total: linhas.length, conferidos };
}

/**
 * A IA pode ser oferecida para esta empresa? Desligada por padrão:
 * - só liga com `CAIXA_IA_SUGESTAO=ligada` e a IA configurada (Cloudflare Workers AI
 *   ou Gemini pago — lib/ia/config; ver docs/livro-caixa.md, "Para o integrador");
 * - nunca para empresa que identifica pagador (clínica/saúde, Carnê-Leão): o
 *   complemento pode trazer nome de paciente e procedimento — dado sensível.
 */
export function iaPermitida(empresa: { identificaPagador?: boolean } | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (String(env.CAIXA_IA_SUGESTAO ?? '').trim().toLowerCase() !== 'ligada') return false;
  if (!iaConfigurada('sugestao', env)) return false;
  return !!empresa && !empresa.identificaPagador;
}

export interface RegistroSugestao {
  /** Linha já criada pela chamada da IA (para ligar ao lançamento). */
  id?: string | null;
  origem: OrigemSugestao;
  contaId: string | null;
  historico: string;
  confianca: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida o que a tela mandou como "sugestão mostrada". Lixo vira `null` (não registra). */
export function lerRegistroSugestao(v: unknown): RegistroSugestao | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!['analitica', 'historico', 'ia'].includes(String(o.origem))) return null;
  const historico = String(o.historico ?? '').trim().slice(0, 200);
  if (!historico) return null;
  const contaId = o.contaId == null || o.contaId === '' ? null : String(o.contaId);
  if (contaId && !UUID.test(contaId)) return null;
  const id = o.id && UUID.test(String(o.id)) ? String(o.id) : null;
  const c = Number(o.confianca);
  return {
    id, origem: o.origem as OrigemSugestao, contaId, historico,
    confianca: Number.isFinite(c) ? Math.max(0, Math.min(1, Math.round(c * 1000) / 1000)) : null,
  };
}

/**
 * Registra a sugestão que estava na tela quando o lançamento foi gravado, e se
 * quem lançou ficou com ela. Nunca derruba o lançamento: sem a 0017, ou com o
 * banco reclamando, só não registra.
 */
export async function registrarSugestao(p: {
  sugestao: RegistroSugestao; empresaId: string; lancamentoId: string; autor: string;
  final: { contaId: string | null; historico: string };
}): Promise<void> {
  try {
    const db = getDb();
    const aceita = sugestaoAceita(p.sugestao, p.final);
    if (p.sugestao.origem === 'ia') {
      // Sugestão "da IA" sem o id da chamada é forjada (ou perdida): não registra —
      // senão contaria na cota do escritório e sujaria a medição.
      if (!p.sugestao.id) return;
      // A linha da IA já existe (é a cota). Só se for desta empresa e ainda solta.
      const { error } = await db.from('caixa_sugestoes')
        .update({ lancamento_id: p.lancamentoId, aceita })
        .eq('id', p.sugestao.id).eq('empresa_id', p.empresaId).is('lancamento_id', null);
      if (error && !faltaTabela(error.message)) console.error('[caixa] sugestão (IA)', error.message);
      return;
    }
    const empresa = await lerEmpresa(p.empresaId);
    const { error } = await db.from('caixa_sugestoes').insert({
      escritorio_id: empresa?.escritorioId ?? null, empresa_id: p.empresaId, lancamento_id: p.lancamentoId,
      origem: p.sugestao.origem, conta_id: p.sugestao.contaId, historico: p.sugestao.historico,
      confianca: p.sugestao.confianca, aceita, criado_por: p.autor,
    });
    if (error && !faltaTabela(error.message)) console.error('[caixa] sugestão', error.message);
  } catch (e) {
    console.error('[caixa] sugestão', e);
  }
}

/**
 * Na conferência: a conta que a sugestão propôs ficou (`confirmada`) ou a
 * contadora trocou (`corrigida`)? A correção em si já ensina a sugestão — o
 * lançamento conferido, com a conta certa, vira exemplo; isto só mede.
 */
export async function avaliarNaConferencia(lancamentoId: string): Promise<void> {
  try {
    const db = getDb();
    const { data: sugs, error } = await db.from('caixa_sugestoes')
      .select('id, conta_id, historico').eq('lancamento_id', lancamentoId);
    if (error || !sugs?.length) return;
    const { data: l } = await db.from('lancamentos').select('conta_id, historico').eq('id', lancamentoId).maybeSingle();
    if (!l) return;
    for (const s of sugs) {
      const ok = sugestaoAceita({ contaId: s.conta_id, historico: s.historico ?? '' }, { contaId: l.conta_id, historico: l.historico });
      await db.from('caixa_sugestoes')
        .update({ resultado: ok ? 'confirmada' : 'corrigida', avaliado_em: new Date().toISOString() })
        .eq('id', s.id);
    }
  } catch (e) {
    console.error('[caixa] avaliar sugestão', e);
  }
}

/**
 * Chamadas de IA hoje: do escritório, ou só da empresa (`empresaId`). `null` = não
 * dá para contar (sem 0017): a IA fica desligada.
 */
export async function chamadasIaHoje(escopo: { escritorioId: string | null } | { empresaId: string }): Promise<number | null> {
  const desde = new Date(`${hojeBelem()}T03:00:00Z`).toISOString(); // 00:00 em Belém
  let q = getDb().from('caixa_sugestoes').select('id', { count: 'exact', head: true })
    .eq('origem', 'ia').gte('criado_em', desde);
  if ('empresaId' in escopo) q = q.eq('empresa_id', escopo.empresaId);
  else q = escopo.escritorioId ? q.eq('escritorio_id', escopo.escritorioId) : q.is('escritorio_id', null);
  const { count, error } = await q;
  if (error) return null;
  return count ?? 0;
}

/** Grava a chamada da IA (conta na cota) e devolve o id para ligar ao lançamento. */
export async function registrarChamadaIa(p: {
  escritorioId: string | null; empresaId: string; autor: string;
  contaId: string | null; historico: string | null; confianca: number | null;
}): Promise<string | null> {
  const { data, error } = await getDb().from('caixa_sugestoes').insert({
    escritorio_id: p.escritorioId, empresa_id: p.empresaId, origem: 'ia',
    conta_id: p.contaId, historico: p.historico, confianca: p.confianca, criado_por: p.autor,
  }).select('id').single();
  if (error) {
    if (!faltaTabela(error.message)) console.error('[caixa] chamada IA', error.message);
    return null;
  }
  return data.id as string;
}

// ------------------------------------------------------------------ revisão

/**
 * Revisa o exercício de uma empresa (lib/revisaoCaixa.ts). Uma consulta de
 * lançamentos (o ano e o anterior, para o padrão de valor), uma do catálogo (só
 * as contas citadas) e uma dos meses confirmados. Não cria exercício: ano sem
 * livro volta vazio.
 *
 * **Para o painel (integrador):** é esta a função a chamar para expor "pedem
 * atenção" por empresa — `resumo` traz as contagens por nível.
 */
export async function revisarExercicio(empresaId: string, ano: number, hoje = hojeBelem()): Promise<ResultadoRevisao> {
  const [exercicios, empresa] = await Promise.all([exerciciosDa(empresaId), lerEmpresa(empresaId)]);
  const ex = exercicios.find((e) => e.ano === ano);
  if (!ex) return { porLancamento: {}, gerais: [], resumo: { alto: 0, medio: 0, baixo: 0, lancamentos: 0 } };
  const anterior = exercicios.find((e) => e.ano === ano - 1);

  const db = getDb();
  const colunas = 'id, exercicio_id, data, historico, complemento, conta_id, entrada, saida, juros, multa, pagador_nome, pagador_documento, criado_em, atualizado_em';
  const linhas = await paginado<Record<string, unknown>>((de, ate) =>
    db.from('lancamentos').select(colunas)
      .in('exercicio_id', anterior ? [ex.id, anterior.id] : [ex.id])
      .order('data').order('criado_em').order('id').range(de, ate), 50_000);

  const paraRevisao = (l: Record<string, unknown>): LancamentoRevisao => ({
    id: l.id as string, data: l.data as string, historico: String(l.historico ?? ''),
    complemento: l.complemento as string | null, contaId: l.conta_id as string | null,
    entrada: num(l.entrada), saida: num(l.saida), juros: num(l.juros), multa: num(l.multa),
    pagadorNome: l.pagador_nome as string | null, pagadorDocumento: l.pagador_documento as string | null,
    criadoEm: l.criado_em as string, atualizadoEm: (l.atualizado_em as string | null) ?? null,
  });
  const doAno = linhas.filter((l) => l.exercicio_id === ex.id).map(paraRevisao);
  const anteriores = linhas.filter((l) => l.exercicio_id !== ex.id).map(paraRevisao);

  const ids = [...new Set(linhas.map((l) => l.conta_id as string | null).filter((x): x is string => !!x))];
  let contas: { id: string; codigo: string; nome: string; natureza: 'receita' | 'despesa' }[] = [];
  if (ids.length > 0) {
    const { data, error } = await db.from('plano_contas').select('id, codigo, nome, natureza').in('id', ids);
    if (error) throw new ErroCaixa(`plano_contas: ${error.message}`, 502);
    contas = data ?? [];
  }

  const { data: conf, error: errConf } = await db.from('meses_confirmados').select('mes, confirmado_em').eq('exercicio_id', ex.id);
  if (errConf) throw new ErroCaixa(`meses_confirmados: ${errConf.message}`, 502);

  return revisarLancamentos(doAno, contas, {
    ano, saldoInicial: ex.saldoInicial, identificaPagador: !!empresa?.identificaPagador, hoje, anteriores,
    confirmados: (conf ?? []).map((c) => ({ mes: Number(c.mes), em: String(c.confirmado_em) })),
  });
}
