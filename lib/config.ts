// Acesso à configuração. Módulo apenas de servidor (process.env) — nunca
// importado por Client Components.
//
// A chave do Gemini é da PLATAFORMA (Sprint 2): vem só de GEMINI_API_KEY, nunca
// de planilha, banco ou tela, e não é devolvida por nenhuma rota. O Google Sheets
// deixou de ser usado pelo app; as variáveis GOOGLE_SHEETS_ID e
// GOOGLE_SERVICE_ACCOUNT_* só servem ao script de importação
// (scripts/importar-ponto.mjs) e podem sair da Vercel depois dela.

export function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null;
}

export function getGeminiModelo(): string {
  return process.env.GEMINI_MODELO?.trim() || 'gemini-2.5-flash';
}

/** Ambiente publicado (Vercel produção/preview ou `next start`). */
export function emProducao(): boolean {
  return process.env.NODE_ENV === 'production' || !!process.env.VERCEL_ENV;
}

/** Senhas que nunca valem para o administrador publicado. */
const SENHAS_PROIBIDAS = new Set(['admin1234', 'admin', '12345678', 'senha123', 'troque-isto']);
export const SENHA_MASTER_MIN = 12;

/** A senha do master é aceitável no ambiente atual? Em produção: definida, ≥ 12
 *  caracteres e fora da lista de padrões conhecidos. No dev, qualquer uma. */
export function senhaMasterAceitavel(senha: string | undefined, producao = emProducao()): boolean {
  if (!senha) return false;
  if (!producao) return true;
  return senha.length >= SENHA_MASTER_MIN && !SENHAS_PROIBIDAS.has(senha.toLowerCase());
}

/**
 * Login do administrador da plataforma. `senha` é `null` quando o master está
 * DESLIGADO: em produção sem `MASTER_PASSWORD` forte, ninguém entra como master
 * (antes caía em `admin1234`). No dev, sem a variável, vale `admin1234`.
 */
export function getMaster(): { email: string; senha: string | null } {
  const email = (process.env.MASTER_EMAIL || 'joaoromaodev@gmail.com').trim().toLowerCase();
  const definida = process.env.MASTER_PASSWORD;
  if (emProducao()) return { email, senha: senhaMasterAceitavel(definida, true) ? definida! : null };
  return { email, senha: definida || 'admin1234' };
}
