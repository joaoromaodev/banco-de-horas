// Contador da cota diária da IA (Sprint 17, frente F) — tabela `ia_uso` (0036).
//
// A Cloudflare Workers AI dá 10.000 neurônios por dia (dia UTC) e é uma conta só
// para a plataforma inteira: folha de ponto, documentos do caixa e sugestão de
// conta dividem a mesma cota. Cada chamada grava o que gastou; antes de chamar,
// o app confere o total do dia. A cota mensal de leituras por escritório
// (lib/cotaOcr.ts) continua valendo à parte — esta é a do provedor.
//
// Teto por escritório (Sprint 18 · A, migração 0037): cada chamada grava também o
// escritório que pediu, e um escritório gasta no máximo `IA_COTA_ESCRITORIO_PCT`% do
// dia (padrão 40%) — um escritório não esgota a IA dos outros. Sem a 0037 o teto
// por escritório fica desligado e só o limite do dia vale.
//
// Sem a 0036 o contador fica "sem medição": a leitura segue (a própria Cloudflare
// recusa ao estourar, e esse erro vira a mesma mensagem humana).
import { getDb } from '../db';
import {
  cotaDiariaCloudflare, descricaoProvedor, percentualCotaEscritorio, tetoDiarioEscritorio, type FinalidadeIa, type NomeProvedor,
} from './config';

export const TABELA_USO = 'ia_uso';
export const VIEW_USO_DIARIO = 'ia_uso_diario';
/** A partir de quanto do dia a tela e o master são avisados. */
export const AVISO_COTA = 0.8;
const RETENCAO_DIAS = 90;
const CHANCE_FAXINA = 1 / 50;
const PRAZO_MS = 4000;

export type NivelCotaIa = 'ok' | 'aviso' | 'esgotada';

/** Dia da cota da Cloudflare: AAAA-MM-DD em UTC. */
export function diaUtc(agora: Date = new Date()): string {
  return agora.toISOString().slice(0, 10);
}

export interface AvaliacaoCotaIa {
  usados: number;
  limite: number;
  /** 0–100, arredondado. */
  percentual: number;
  nivel: NivelCotaIa;
  /** Para a tela; vazio quando está tudo bem. */
  mensagem: string;
}

/** Regra pura: ≥ 80% avisa, ≥ 100% esgota. */
export function avaliarCotaDiaria(usados: number, limite: number): AvaliacaoCotaIa {
  const u = Math.max(0, Number.isFinite(usados) ? usados : 0);
  const fr = limite > 0 ? u / limite : 1;
  const nivel: NivelCotaIa = fr >= 1 ? 'esgotada' : fr >= AVISO_COTA ? 'aviso' : 'ok';
  const percentual = Math.min(100, Math.round(fr * 100));
  const mensagem = nivel === 'esgotada'
    ? 'O limite diário da IA foi atingido. As leituras voltam amanhã (a cota renova às 21h, horário de Brasília); enquanto isso, dá para preencher à mão.'
    : nivel === 'aviso'
      ? `A IA já usou ${percentual}% do limite de hoje. Se acabar, as leituras voltam amanhã.`
      : '';
  return { usados: Math.round(u * 100) / 100, limite, percentual, nivel, mensagem };
}

/**
 * Regra pura do teto por escritório (Sprint 18 · A): a cota do dia é da plataforma e é
 * repartida — cada escritório gasta até `pct`% dela. ≥ 80% da parte dele avisa; ≥ 100%
 * esgota, com mensagem que explica que o limite é repartido (não é defeito).
 */
export function avaliarCotaEscritorio(usados: number, teto: number, pct: number): AvaliacaoCotaIa & { pct: number } {
  const base = avaliarCotaDiaria(usados, teto);
  const mensagem = base.nivel === 'esgotada'
    ? `O seu escritório já usou a parte dele da IA hoje (cada escritório pode usar até ${pct}% do limite diário, `
      + 'que é dividido entre os escritórios da plataforma). As leituras voltam amanhã (a cota renova às 21h, horário de Brasília); '
      + 'enquanto isso, dá para preencher à mão.'
    : base.nivel === 'aviso'
      ? `O seu escritório já usou ${base.percentual}% da parte dele da IA hoje. Se acabar, as leituras voltam amanhã.`
      : '';
  return { ...base, mensagem, pct };
}

/**
 * O aviso do dia para a tela: o pior entre o limite da plataforma e a parte do escritório
 * (esgotada > aviso > nada). Puro.
 */
export function avisoIaDoDia(
  plataforma: AvaliacaoCotaIa | null | undefined, escritorio: AvaliacaoCotaIa | null | undefined,
): { nivel: Exclude<NivelCotaIa, 'ok'>; mensagem: string } | null {
  const peso = (a: AvaliacaoCotaIa | null | undefined) => (!a ? 0 : a.nivel === 'esgotada' ? 2 : a.nivel === 'aviso' ? 1 : 0);
  // Empate: a da plataforma (afeta todos; é a que explica melhor o "volta amanhã").
  const pior = peso(escritorio) > peso(plataforma) ? escritorio : plataforma;
  return pior && pior.nivel !== 'ok' ? { nivel: pior.nivel, mensagem: pior.mensagem } : null;
}

const semTabela = (e: { message?: string; code?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /ia_uso/.test(String(e.message ?? '')));

/** Coluna `escritorio_id` ainda não existe (falta a 0037). */
const semColunaEscritorio = (e: { message?: string; code?: string } | null | undefined) =>
  !!e && (e.code === '42703' || e.code === 'PGRST204' || /escritorio_id/.test(String(e.message ?? '')));

/** Sem a 0037, não insiste a cada chamada: lembra por 5 min. */
let sem0037Ate = 0;
const SEM_0037_MS = 5 * 60_000;
/** Para teste. */
export function esquecerSem0037(): void { sem0037Ate = 0; }

/**
 * Neurônios gastos hoje (UTC) na Cloudflare por UM escritório. `null` = não deu para
 * medir (sem a 0036/0037, banco fora) — quem chama segue sem o teto por escritório.
 */
export async function usoHojeEscritorio(escritorioId: string, agora = new Date()): Promise<number | null> {
  if (!escritorioId || Date.now() < sem0037Ate) return null;
  try {
    const { data, error } = await getDb().from(TABELA_USO).select('neuronios')
      .eq('dia', diaUtc(agora)).eq('provedor', 'cloudflare').eq('escritorio_id', escritorioId)
      .limit(5000).abortSignal(AbortSignal.timeout(PRAZO_MS));
    if (error) {
      if (semColunaEscritorio(error)) sem0037Ate = Date.now() + SEM_0037_MS;
      else if (!semTabela(error)) console.warn('[ia] cota: não leu o uso do escritório:', error.code ?? 'erro');
      return null;
    }
    return ((data ?? []) as { neuronios: unknown }[]).reduce((s, l) => s + (Number(l.neuronios) || 0), 0);
  } catch {
    return null;
  }
}

/** Neurônios gastos hoje (UTC) no provedor. `null` = não deu para medir (sem 0036, banco fora). */
export async function usoHoje(provedor: NomeProvedor = 'cloudflare', agora = new Date()): Promise<number | null> {
  try {
    const { data, error } = await getDb().from(VIEW_USO_DIARIO).select('neuronios')
      .eq('dia', diaUtc(agora)).eq('provedor', provedor).abortSignal(AbortSignal.timeout(PRAZO_MS)).maybeSingle();
    if (error) {
      if (!semTabela(error)) console.warn('[ia] cota: não leu o uso do dia:', error.code ?? 'erro');
      return null;
    }
    return data ? Number(data.neuronios) || 0 : 0;
  } catch {
    return null;
  }
}

/** Grava uma chamada. Nunca lança (a leitura não pode cair por causa do contador). */
export async function registrarUso(u: {
  provedor: NomeProvedor; modelo: string; finalidade: FinalidadeIa;
  neuronios: number | null; estimado: boolean; ok: boolean;
  /** Escritório que pediu (0037) — para o teto por escritório. Sem ele, conta só no dia da plataforma. */
  escritorioId?: string | null;
}, sorteio: () => number = Math.random): Promise<void> {
  try {
    const db = getDb();
    const linha: Record<string, unknown> = {
      provedor: u.provedor, modelo: u.modelo.slice(0, 80), finalidade: u.finalidade,
      neuronios: u.neuronios === null ? null : Math.round(u.neuronios * 100) / 100,
      estimado: u.estimado, ok: u.ok, dia: diaUtc(),
    };
    const comEscritorio = !!u.escritorioId && Date.now() >= sem0037Ate;
    let { error } = await db.from(TABELA_USO).insert(comEscritorio ? { ...linha, escritorio_id: u.escritorioId } : linha)
      .abortSignal(AbortSignal.timeout(PRAZO_MS));
    if (error && comEscritorio && semColunaEscritorio(error)) {
      // Sem a 0037: grava sem o escritório (o dia da plataforma continua contando).
      sem0037Ate = Date.now() + SEM_0037_MS;
      ({ error } = await db.from(TABELA_USO).insert(linha).abortSignal(AbortSignal.timeout(PRAZO_MS)));
    }
    if (error) {
      if (!semTabela(error)) console.warn('[ia] cota: não gravou o uso:', error.code ?? 'erro');
      return;
    }
    if (sorteio() < CHANCE_FAXINA) {
      const corte = new Date(Date.now() - RETENCAO_DIAS * 86_400_000).toISOString();
      try { await db.from(TABELA_USO).delete().lt('em', corte).abortSignal(AbortSignal.timeout(PRAZO_MS)); }
      catch { /* tenta de novo numa próxima gravação */ }
    }
  } catch { /* sem banco configurado: não mede */ }
}

export interface SituacaoIa {
  provedor: NomeProvedor;
  /** Nome para gente ("Cloudflare Workers AI"). */
  nome: string;
  modelo: string;
  configurado: boolean;
  /** Só a Cloudflare tem cota diária medida aqui. */
  cota: (AvaliacaoCotaIa & { medida: true }) | { medida: false; faltaMigracao: boolean } | null;
  /** Teto por escritório (Sprint 18 · A): a % configurada e o teto em neurônios. */
  tetoEscritorio: { pct: number; neuronios: number } | null;
  /** A parte do escritório pedido (só com `escritorioId`, Cloudflare e a 0037). */
  escritorio: (AvaliacaoCotaIa & { pct: number }) | null;
}

/** Qual IA está ativa e, na Cloudflare, a cota do dia — para o master e as telas. */
export async function situacaoIa(env: NodeJS.ProcessEnv = process.env, escritorioId?: string | null): Promise<SituacaoIa> {
  const d = descricaoProvedor(env);
  let cota: SituacaoIa['cota'] = null;
  let tetoEscritorio: SituacaoIa['tetoEscritorio'] = null;
  let escritorio: SituacaoIa['escritorio'] = null;
  if (d.provedor === 'cloudflare' && d.configurado) {
    const pct = percentualCotaEscritorio(env);
    const teto = tetoDiarioEscritorio(env);
    const [usados, doEscritorio] = await Promise.all([
      usoHoje('cloudflare'),
      escritorioId && pct < 100 ? usoHojeEscritorio(escritorioId) : Promise.resolve(null),
    ]);
    cota = usados === null
      ? { medida: false, faltaMigracao: true }
      : { ...avaliarCotaDiaria(usados, cotaDiariaCloudflare(env)), medida: true };
    if (pct < 100) tetoEscritorio = { pct, neuronios: teto };
    if (doEscritorio !== null) escritorio = avaliarCotaEscritorio(doEscritorio, teto, pct);
  }
  return { provedor: d.provedor, nome: d.nome, modelo: d.modelo, configurado: d.configurado, cota, tetoEscritorio, escritorio };
}
