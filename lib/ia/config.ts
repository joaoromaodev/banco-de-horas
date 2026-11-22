// Qual IA está ligada (Sprint 17, frente F) — só lê variáveis de ambiente; puro.
//
// Dois provedores atrás da mesma interface (lib/ia/index.ts):
//   - `cloudflare` — Cloudflare Workers AI. Gratuito até 10.000 neurônios/dia e
//     não treina com os dados (docs/empresa/ia-gratuita.md). Variáveis
//     CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_AI_TOKEN.
//   - `gemini` — Google Gemini (GEMINI_API_KEY). No nível gratuito o Google pode
//     usar o conteúdo; por isso deixou de ser o padrão.
// `IA_PROVEDOR` escolhe; sem ela, Cloudflare quando as duas variáveis existem,
// senão Gemini. Os valores das variáveis nunca saem daqui (só "tem ou não tem").

export type NomeProvedor = 'cloudflare' | 'gemini';

/** Para que a IA é chamada — separa a medição e a escolha da chave. */
export type FinalidadeIa = 'ponto' | 'documento' | 'sugestao';

/**
 * Modelo padrão de visão da Cloudflare, escolhido pelo comparativo de 21/11/2026
 * (scripts/ia-comparativo, tabela em docs/empresa/ia-gratuita.md).
 */
export const MODELO_CLOUDFLARE_PADRAO = '@cf/mistralai/mistral-small-3.1-24b-instruct';
export const MODELO_GEMINI_PADRAO = 'gemini-2.5-flash';

/** Cota diária gratuita da Workers AI (neurônios; renova 00:00 UTC). */
export const COTA_CLOUDFLARE_PADRAO = 10_000;

export const NOME_PROVEDOR: Record<NomeProvedor, string> = {
  cloudflare: 'Cloudflare Workers AI',
  gemini: 'Google Gemini',
};

const t = (v: string | undefined) => String(v ?? '').trim();

export function cloudflareConfigurada(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!t(env.CLOUDFLARE_ACCOUNT_ID) && !!t(env.CLOUDFLARE_AI_TOKEN);
}

/** Chave do Gemini para a finalidade (o caixa pode ter uma chave própria, GEMINI_API_KEY_CAIXA). */
export function chaveGemini(finalidade: FinalidadeIa, env: NodeJS.ProcessEnv = process.env): string | null {
  if (finalidade === 'documento') return t(env.GEMINI_API_KEY_CAIXA) || t(env.GEMINI_API_KEY) || null;
  return t(env.GEMINI_API_KEY) || null;
}

/** O provedor escolhido (configurado ou não). */
export function provedorEscolhido(env: NodeJS.ProcessEnv = process.env): NomeProvedor {
  const v = t(env.IA_PROVEDOR).toLowerCase();
  if (v === 'cloudflare' || v === 'gemini') return v;
  return cloudflareConfigurada(env) ? 'cloudflare' : 'gemini';
}

/** O provedor escolhido tem as variáveis para a finalidade? */
export function iaConfigurada(finalidade: FinalidadeIa, env: NodeJS.ProcessEnv = process.env): boolean {
  return provedorEscolhido(env) === 'cloudflare' ? cloudflareConfigurada(env) : !!chaveGemini(finalidade, env);
}

export function modeloCloudflare(env: NodeJS.ProcessEnv = process.env): string {
  return t(env.IA_MODELO_CLOUDFLARE) || MODELO_CLOUDFLARE_PADRAO;
}

/** Modelo de texto (sugestão de conta e PDF com texto). Padrão: o mesmo da visão. */
export function modeloCloudflareTexto(env: NodeJS.ProcessEnv = process.env): string {
  return t(env.IA_MODELO_CLOUDFLARE_TEXTO) || modeloCloudflare(env);
}

export function modeloGemini(env: NodeJS.ProcessEnv = process.env): string {
  return t(env.GEMINI_MODELO) || MODELO_GEMINI_PADRAO;
}

/** Cota diária da Cloudflare em neurônios (`IA_COTA_DIARIA`, padrão 10.000). */
export function cotaDiariaCloudflare(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(t(env.IA_COTA_DIARIA));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : COTA_CLOUDFLARE_PADRAO;
}

/**
 * Parte da cota diária que UM escritório pode gastar sozinho (Sprint 18 · A), em % —
 * `IA_COTA_ESCRITORIO_PCT` (1 a 100; padrão 40). A cota da Cloudflare é da plataforma
 * inteira: sem teto, um escritório com muitas folhas esgotaria o dia de todos. 100 =
 * sem teto por escritório (só o limite do dia vale).
 */
export const COTA_ESCRITORIO_PCT_PADRAO = 40;

export function percentualCotaEscritorio(env: NodeJS.ProcessEnv = process.env): number {
  const v = t(env.IA_COTA_ESCRITORIO_PCT).replace('%', '').replace(',', '.');
  const n = Number(v);
  if (!v || !Number.isFinite(n) || n <= 0) return COTA_ESCRITORIO_PCT_PADRAO;
  return Math.min(100, Math.max(1, Math.round(n)));
}

/** Teto diário de um escritório em neurônios (a parte dele da cota do dia). */
export function tetoDiarioEscritorio(env: NodeJS.ProcessEnv = process.env): number {
  return Math.floor((cotaDiariaCloudflare(env) * percentualCotaEscritorio(env)) / 100);
}

/** Resumo para o painel do master e para a política de privacidade (sem valor de variável). */
export function descricaoProvedor(env: NodeJS.ProcessEnv = process.env): {
  provedor: NomeProvedor; nome: string; configurado: boolean; modelo: string; explicito: boolean;
} {
  const provedor = provedorEscolhido(env);
  return {
    provedor,
    nome: NOME_PROVEDOR[provedor],
    configurado: iaConfigurada('ponto', env),
    modelo: provedor === 'cloudflare' ? modeloCloudflare(env) : modeloGemini(env),
    explicito: !!t(env.IA_PROVEDOR),
  };
}
