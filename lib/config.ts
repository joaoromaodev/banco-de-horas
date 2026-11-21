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

export function getMaster(): { email: string; senha: string } {
  return {
    email: (process.env.MASTER_EMAIL || 'joaoromaodev@gmail.com').trim().toLowerCase(),
    senha: process.env.MASTER_PASSWORD || 'admin1234',
  };
}
