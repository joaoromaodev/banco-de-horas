// Acesso à configuração. A chave do Gemini pertence a quem opera o sistema
// (contadora) — nunca fica embutida no código. Fontes, em ordem de precedência:
//   1) aba "Config" da planilha Google (preenchida na tela de Configurações)  [futuro]
//   2) variável de ambiente GEMINI_API_KEY (deploy)
//
// Por ora usamos a variável de ambiente; a leitura da planilha entra junto com
// a persistência no Google Sheets.
//
// Módulo apenas de servidor (usa fs/process.env) — nunca importado por Client Components.
import fs from 'fs';
import path from 'path';

export function getGeminiApiKey(): string | null {
  return process.env.GEMINI_API_KEY?.trim() || null;
}

export function getGeminiModelo(): string {
  return process.env.GEMINI_MODELO?.trim() || 'gemini-2.5-flash';
}

export function getSpreadsheetId(): string | null {
  return process.env.GOOGLE_SHEETS_ID?.trim() || null;
}

export interface ContaServico {
  client_email: string;
  private_key: string;
}

/**
 * Credenciais da conta de serviço do Google. Fontes, em ordem:
 *   1) GOOGLE_SERVICE_ACCOUNT_JSON — JSON inline (ideal p/ Vercel)
 *   2) GOOGLE_SERVICE_ACCOUNT_FILE — caminho do arquivo .json (ideal local)
 */
export function getContaServico(): ContaServico | null {
  const inline = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  const arquivo = process.env.GOOGLE_SERVICE_ACCOUNT_FILE?.trim();

  let raw: string | null = null;
  if (inline) {
    raw = inline;
  } else if (arquivo) {
    try {
      const abs = path.isAbsolute(arquivo) ? arquivo : path.join(/* turbopackIgnore: true */ process.cwd(), arquivo);
      if (!fs.existsSync(abs)) return null;
      raw = fs.readFileSync(abs, 'utf8');
    } catch {
      return null;
    }
  }
  if (!raw) return null;

  try {
    const obj = JSON.parse(raw);
    if (!obj.client_email || !obj.private_key) return null;
    return { client_email: obj.client_email, private_key: String(obj.private_key).replace(/\\n/g, '\n') };
  } catch {
    return null;
  }
}
