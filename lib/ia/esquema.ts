// Esquema da saída JSON da IA, escrito uma vez e traduzido para cada provedor.
//
// O Gemini quer o "responseSchema" no formato OpenAPI dele (tipos em maiúsculas,
// `nullable`); a Cloudflare Workers AI aceita JSON Schema em `response_format` e
// também lê o esquema no texto do pedido (nem todo modelo respeita o
// `response_format`). Puro: sem I/O, testado em tests/ia.test.ts.

export type TipoCampo = 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';

export interface Esquema {
  type: TipoCampo;
  nullable?: boolean;
  enum?: string[];
  items?: Esquema;
  properties?: Record<string, Esquema>;
  required?: string[];
}

/** Formato do `responseSchema` do Gemini (`Type.STRING` = 'STRING', etc.). */
export function paraGemini(e: Esquema): Record<string, unknown> {
  const s: Record<string, unknown> = { type: e.type.toUpperCase() };
  if (e.nullable) s.nullable = true;
  if (e.enum) s.enum = e.enum;
  if (e.items) s.items = paraGemini(e.items);
  if (e.properties) s.properties = Object.fromEntries(Object.entries(e.properties).map(([k, v]) => [k, paraGemini(v)]));
  if (e.required) s.required = e.required;
  return s;
}

/** JSON Schema (draft 7) — `nullable` vira `type: [t, "null"]`. */
export function paraJsonSchema(e: Esquema): Record<string, unknown> {
  const s: Record<string, unknown> = { type: e.nullable ? [e.type, 'null'] : e.type };
  if (e.enum) s.enum = e.nullable ? [...e.enum, null] : e.enum;
  if (e.items) s.items = paraJsonSchema(e.items);
  if (e.properties) s.properties = Object.fromEntries(Object.entries(e.properties).map(([k, v]) => [k, paraJsonSchema(v)]));
  if (e.required) s.required = e.required;
  return s;
}

/**
 * Tira o JSON de uma resposta em texto: aceita o JSON puro, cercado de ```json …```
 * ou com frase antes/depois. Devolve o primeiro objeto (ou lista) balanceado, como
 * texto, para quem chama validar como sempre (JSON.parse + regras). Sem JSON → null.
 */
export function extrairJson(texto: string | null | undefined): string | null {
  const s = String(texto ?? '').trim();
  if (!s) return null;
  try { JSON.parse(s); return s; } catch { /* segue */ }
  const cerca = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cerca) {
    try { JSON.parse(cerca[1].trim()); return cerca[1].trim(); } catch { /* segue */ }
  }
  const inicio = s.search(/[{[]/);
  if (inicio < 0) return null;
  const abre = s[inicio];
  const fecha = abre === '{' ? '}' : ']';
  let nivel = 0; let emTexto = false; let escape = false;
  for (let i = inicio; i < s.length; i++) {
    const c = s[i];
    if (emTexto) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') emTexto = false;
      continue;
    }
    if (c === '"') emTexto = true;
    else if (c === abre) nivel++;
    else if (c === fecha && --nivel === 0) {
      const trecho = s.slice(inicio, i + 1);
      try { JSON.parse(trecho); return trecho; } catch { return null; }
    }
  }
  return null;
}
