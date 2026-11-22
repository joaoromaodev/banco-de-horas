// Provedor Google Gemini (@google/genai) — só servidor. É o que já se usava:
// mesmo modelo padrão, `responseSchema` e temperatura 0. Lê imagem e PDF.
import { GoogleGenAI } from '@google/genai';
import type { ArquivoIa, ResultadoProvedor } from './cloudflare';
import { ErroIa } from './erros';
import { extrairJson, paraGemini, type Esquema } from './esquema';

export interface PedidoGemini {
  apiKey: string;
  modelo: string;
  prompt: string;
  esquema: Esquema;
  arquivo?: ArquivoIa;
  timeoutMs?: number;
}

export async function chamarGemini(p: PedidoGemini): Promise<ResultadoProvedor> {
  const ai = new GoogleGenAI({ apiKey: p.apiKey });
  const parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] = [];
  if (p.arquivo) parts.push({ inlineData: { mimeType: p.arquivo.mime, data: Buffer.from(p.arquivo.bytes).toString('base64') } });
  parts.push({ text: p.prompt });
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tempo = new Promise<never>((_, rejeitar) => {
    timer = setTimeout(() => { ctl.abort(); rejeitar(new ErroIa('tempo', `gemini ${p.modelo}: tempo esgotado`)); }, p.timeoutMs ?? 55_000);
  });
  let texto: string | undefined;
  try {
    const res = await Promise.race([
      ai.models.generateContent({
        model: p.modelo,
        contents: [{ role: 'user', parts }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: paraGemini(p.esquema),
          temperature: 0,
          abortSignal: ctl.signal,
        },
      }),
      tempo,
    ]);
    texto = res.text;
  } catch (e) {
    if (e instanceof ErroIa) throw e;
    const status = Number((e as { status?: number })?.status ?? 0);
    const msg = String((e as Error)?.message ?? '').slice(0, 160);
    if (status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) throw new ErroIa('ocupada', `gemini 429: ${msg}`);
    if (ctl.signal.aborted) throw new ErroIa('tempo', `gemini ${p.modelo}: tempo esgotado`);
    throw new ErroIa('indisponivel', `gemini ${status || ''}: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
  const json = extrairJson(texto);
  if (!json) throw new ErroIa('resposta', `gemini ${p.modelo}: resposta sem JSON`);
  return { texto: json, modelo: p.modelo, neuronios: null, estimado: false };
}
