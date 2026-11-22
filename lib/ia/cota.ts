// Contador da cota diária da IA (Sprint 17, frente F) — tabela `ia_uso` (0036).
//
// A Cloudflare Workers AI dá 10.000 neurônios por dia (dia UTC) e é uma conta só
// para a plataforma inteira: folha de ponto, documentos do caixa e sugestão de
// conta dividem a mesma cota. Cada chamada grava o que gastou; antes de chamar,
// o app confere o total do dia. A cota mensal de leituras por escritório
// (lib/cotaOcr.ts) continua valendo à parte — esta é a do provedor.
//
// Sem a 0036 o contador fica "sem medição": a leitura segue (a própria Cloudflare
// recusa ao estourar, e esse erro vira a mesma mensagem humana).
import { getDb } from '../db';
import { cotaDiariaCloudflare, descricaoProvedor, type FinalidadeIa, type NomeProvedor } from './config';

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

const semTabela = (e: { message?: string; code?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /ia_uso/.test(String(e.message ?? '')));

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
}, sorteio: () => number = Math.random): Promise<void> {
  try {
    const db = getDb();
    const { error } = await db.from(TABELA_USO).insert({
      provedor: u.provedor, modelo: u.modelo.slice(0, 80), finalidade: u.finalidade,
      neuronios: u.neuronios === null ? null : Math.round(u.neuronios * 100) / 100,
      estimado: u.estimado, ok: u.ok, dia: diaUtc(),
    }).abortSignal(AbortSignal.timeout(PRAZO_MS));
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
}

/** Qual IA está ativa e, na Cloudflare, a cota do dia — para o master e as telas. */
export async function situacaoIa(env: NodeJS.ProcessEnv = process.env): Promise<SituacaoIa> {
  const d = descricaoProvedor(env);
  let cota: SituacaoIa['cota'] = null;
  if (d.provedor === 'cloudflare' && d.configurado) {
    const usados = await usoHoje('cloudflare');
    cota = usados === null
      ? { medida: false, faltaMigracao: true }
      : { ...avaliarCotaDiaria(usados, cotaDiariaCloudflare(env)), medida: true };
  }
  return { provedor: d.provedor, nome: d.nome, modelo: d.modelo, configurado: d.configurado, cota };
}
