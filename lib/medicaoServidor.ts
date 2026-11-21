// Medição própria — gravação e leitura (só servidor). Tabela `medicoes` (migração 0031).
//
// Regras de ouro:
//  - gravar NUNCA atrasa nem derruba a resposta: quem chama usa `after` (ou não
//    espera), e tudo aqui engole o erro;
//  - sem a migração 0031 (tabela ausente) não grava e não quebra: lembra por
//    alguns minutos que a tabela falta, para não insistir a cada chamada;
//  - retenção barata: de vez em quando (≈1 a cada 50 gravações) apaga o que tem
//    mais de `RETENCAO_DIAS` dias — sem cron.
import { getDb, lerAteTeto } from './db';
import { classificarRota } from './medicaoRotas';
import { resumirMedicoes, TAXA_AMOSTRA, type ItemMedicao, type LinhaMedicao, type ResumoMedicao, type TipoMedicao } from './medicao';
import type { Papel } from './auth';

export const TABELA = 'medicoes';
export const RETENCAO_DIAS = 30;
const CHANCE_FAXINA = 1 / 50;
const PAUSA_SEM_TABELA_MS = 10 * 60_000;
/** Banco lento ou fora do ar: desiste da gravação depois disso e pausa um pouco. */
const PRAZO_MS = 2_000;
const PAUSA_FALHA_MS = 60_000;
/** Teto de leitura do resumo (7 dias de amostra cabem com folga). Lê das mais novas para as mais velhas. */
export const TETO_LEITURA = 50_000;

let pausaAte = 0;
let avisou = false;

/** Tabela ausente (migração não aplicada): Postgres 42P01 ou PostgREST PGRST205. */
export function ehTabelaAusente(e: { code?: string; message?: string } | null | undefined): boolean {
  if (!e) return false;
  return e.code === '42P01' || e.code === 'PGRST205' || /relation .*medicoes.* does not exist|Could not find the table/i.test(e.message ?? '');
}

/** Só para teste: esquece a pausa (tabela ausente ou banco fora). */
export function _reiniciarMedicao() { pausaAte = 0; avisou = false; }

export interface LinhaNova {
  tipo: TipoMedicao;
  rota: string;
  metodo?: string | null;
  status?: number | null;
  ms?: number | null;
  metrica?: string | null;
  erro?: string | null;
  papel?: Papel | null;
  taxa: number;
  amostra: boolean;
}

/** Item validado do navegador → linha da tabela (rota conferida contra a lista fechada). */
export function linhaDoItem(i: ItemMedicao, papel: Papel | null): LinhaNova {
  return {
    tipo: i.tipo,
    rota: classificarRota(i.rota),
    metodo: i.metodo ?? null,
    status: i.status ?? null,
    ms: i.ms ?? null,
    metrica: i.metrica ?? null,
    erro: i.erro ?? null,
    papel,
    taxa: TAXA_AMOSTRA,
    amostra: i.amostra,
  };
}

/**
 * Grava as linhas. Nunca lança e nunca demora mais que `PRAZO_MS` por consulta
 * (o `onRequestError` espera esta promessa). Devolve se gravou (para teste).
 */
export async function gravarMedicoes(linhas: LinhaNova[], sorteio: () => number = Math.random): Promise<boolean> {
  if (!linhas.length || Date.now() < pausaAte) return false;
  try {
    const db = getDb();
    const { error } = await db.from(TABELA).insert(linhas).abortSignal(AbortSignal.timeout(PRAZO_MS));
    if (error) {
      if (ehTabelaAusente(error)) pausaAte = Date.now() + PAUSA_SEM_TABELA_MS;
      else {
        pausaAte = Date.now() + PAUSA_FALHA_MS; // prazo estourado, rede, CHECK: não insiste agora
        if (!avisou) { avisou = true; console.warn('[medicao] não gravou:', error.code ?? 'erro'); }
      }
      return false;
    }
    if (sorteio() < CHANCE_FAXINA) {
      const corte = new Date(Date.now() - RETENCAO_DIAS * 86_400_000).toISOString();
      try { await db.from(TABELA).delete().lt('em', corte).abortSignal(AbortSignal.timeout(PRAZO_MS)); }
      catch { /* a faxina tenta de novo numa próxima gravação */ }
    }
    return true;
  } catch {
    pausaAte = Date.now() + PAUSA_FALHA_MS; // sem banco configurado, rede etc.: medição nunca derruba nada
    return false;
  }
}

export type LeituraResumo =
  | { ok: true; resumo: ResumoMedicao; truncado: boolean; dias: number }
  | { ok: false; semTabela: true };

/** Resumo dos últimos `dias` dias para a seção do master. Lança em erro que não seja tabela ausente. */
export async function lerResumo(dias = 7): Promise<LeituraResumo> {
  const desde = new Date(Date.now() - dias * 86_400_000).toISOString();
  try {
    const { linhas, truncado } = await lerAteTeto<LinhaMedicao>((de, ate) =>
      getDb().from(TABELA).select('tipo, rota, metodo, status, ms, metrica, erro, taxa, amostra')
        .gte('em', desde).order('id', { ascending: false }).range(de, ate), TETO_LEITURA);
    return { ok: true, resumo: resumirMedicoes(linhas), truncado, dias };
  } catch (e) {
    if (ehTabelaAusente(e as { code?: string; message?: string })) return { ok: false, semTabela: true };
    throw e;
  }
}
