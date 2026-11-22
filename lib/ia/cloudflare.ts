// Provedor Cloudflare Workers AI (REST) — só servidor.
//
// POST https://api.cloudflare.com/client/v4/accounts/{conta}/ai/run/{modelo}
// com `messages` no formato do chat (texto + imagem em data URL) e o esquema em
// `response_format` e no próprio texto (nem todo modelo respeita o primeiro).
//
// Neurônios: a resposta informa — cabeçalho `cf-ai-neurons` e `result.usage.neurons`.
// Sem isso, estima pelos tokens (`usage`) com o preço do catálogo do modelo; sem
// tokens, pelo tamanho do texto (ver `estimarNeuronios`). A estimativa vai marcada.
import { ErroIa } from './erros';
import { extrairJson, paraJsonSchema, type Esquema } from './esquema';

export interface ArquivoIa { bytes: Uint8Array; mime: string }

export interface ResultadoProvedor {
  /** O JSON da resposta, como texto (quem chama valida). */
  texto: string;
  modelo: string;
  /** Neurônios gastos (Cloudflare) — `null` no Gemini. */
  neuronios: number | null;
  /** `true` quando os neurônios foram estimados (a API não informou). */
  estimado: boolean;
}

/**
 * Preço por milhão de tokens (US$) do catálogo da Workers AI em 21/11/2026, para
 * estimar quando a API não informa os neurônios. 1.000 neurônios = US$ 0,011.
 */
export const PRECO_MODELOS: Record<string, { entrada: number; saida: number }> = {
  '@cf/meta/llama-4-scout-17b-16e-instruct': { entrada: 0.27, saida: 0.85 },
  '@cf/mistralai/mistral-small-3.1-24b-instruct': { entrada: 0.351, saida: 0.555 },
  '@cf/meta/llama-3.2-11b-vision-instruct': { entrada: 0.0485, saida: 0.676 },
  '@cf/google/gemma-4-26b-a4b-it': { entrada: 0.1, saida: 0.3 },
  '@cf/qwen/qwen3.8-27b': { entrada: 0.45, saida: 3.2 },
};
/** Modelo fora da tabela: o mais caro dela (melhor errar para cima). */
const PRECO_CONSERVADOR = { entrada: 0.45, saida: 3.2 };
const USD_POR_NEURONIO = 0.011 / 1000;
/** Tokens de uma imagem quando a API não diz (folha A4 a ~2.000 px ficou em ~2.400). */
export const TOKENS_IMAGEM_ESTIMADOS = 2500;

export function estimarNeuronios(modelo: string, tokens: { entrada: number; saida: number }): number {
  const p = PRECO_MODELOS[modelo] ?? PRECO_CONSERVADOR;
  const usd = (tokens.entrada * p.entrada + tokens.saida * p.saida) / 1e6;
  return Math.round((usd / USD_POR_NEURONIO) * 100) / 100;
}

export interface PedidoCloudflare {
  conta: string;
  token: string;
  modelo: string;
  prompt: string;
  esquema: Esquema;
  imagem?: ArquivoIa;
  maxTokens?: number;
  timeoutMs?: number;
  /** Para teste: o fetch simulado. */
  fetch?: typeof fetch;
}

/** O texto com o formato pedido — para os modelos que ignoram o `response_format`. */
export function promptComEsquema(prompt: string, esquema: Esquema): string {
  return `${prompt}\n\nFormato da resposta (JSON Schema). Responda só o JSON, sem texto antes ou depois:\n${JSON.stringify(paraJsonSchema(esquema))}`;
}

const numero = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};

export async function chamarCloudflare(p: PedidoCloudflare): Promise<ResultadoProvedor> {
  const prompt = promptComEsquema(p.prompt, p.esquema);
  const content: unknown[] = [{ type: 'text', text: prompt }];
  if (p.imagem) {
    const b64 = Buffer.from(p.imagem.bytes).toString('base64');
    content.push({ type: 'image_url', image_url: { url: `data:${p.imagem.mime};base64,${b64}` } });
  }
  const corpo = {
    messages: [{ role: 'user', content }],
    response_format: { type: 'json_schema', json_schema: paraJsonSchema(p.esquema) },
    max_tokens: p.maxTokens ?? 4096,
    temperature: 0,
    // Com stream a Cloudflare não corta pedido longo (sem stream, a folha inteira
    // estourava o tempo do lado dela: 408). O texto é juntado aqui.
    stream: true,
  };
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(p.conta)}/ai/run/${p.modelo}`;
  const f = p.fetch ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), p.timeoutMs ?? 55_000);
  let res: Response;
  let bruto = '';
  let fluxo: Fluxo | null = null;
  try {
    res = await f(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
      signal: ctl.signal,
    });
    if (res.ok && /event-stream/i.test(res.headers.get('content-type') ?? '')) {
      fluxo = { texto: '', usage: undefined };
      await lerFluxo(res, fluxo);
    } else {
      bruto = await res.text();
    }
  } catch (e) {
    if (ctl.signal.aborted || (e as { name?: string })?.name === 'AbortError') {
      // A chamada gastou mesmo cortada: estima o que já foi (entrada + o recebido).
      const erro = new ErroIa('tempo', `cloudflare ${p.modelo}: tempo esgotado`);
      erro.neuronios = estimarNeuronios(p.modelo, {
        entrada: Math.ceil(prompt.length / 4) + (p.imagem ? TOKENS_IMAGEM_ESTIMADOS : 0),
        saida: Math.ceil((fluxo?.texto.length ?? 0) / 4),
      });
      throw erro;
    }
    throw new ErroIa('indisponivel', `cloudflare: rede (${(e as Error)?.message ?? 'erro'})`);
  } finally {
    clearTimeout(timer);
  }

  let j: {
    success?: boolean;
    errors?: { code?: number; message?: string }[];
    result?: {
      response?: unknown;
      choices?: { message?: { content?: unknown } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; neurons?: number };
    };
  } = {};
  if (fluxo) j = { success: true, result: { response: fluxo.texto, usage: fluxo.usage } };
  else try { j = JSON.parse(bruto); } catch { /* corpo não-JSON: trata pelo status abaixo */ }

  if (!res.ok || j.success === false) {
    const erro = j.errors?.[0];
    const msg = String(erro?.message ?? '').slice(0, 160);
    // 4006 = cota diária gratuita esgotada ("daily free allocation").
    if (erro?.code === 4006 || /daily free allocation|neurons/i.test(msg)) throw new ErroIa('cota_diaria', `cloudflare: ${msg}`);
    if (res.status === 429 || erro?.code === 3040) throw new ErroIa('ocupada', `cloudflare 429: ${msg}`);
    // 5016 = o modelo exige aceitar a licença antes (ex.: Llama 3.2 Vision) — não aceitamos por código.
    if (erro?.code === 5016 || /Model Agreement/i.test(msg)) throw new ErroIa('indisponivel', `cloudflare ${p.modelo}: modelo exige aceite de licença`);
    if (res.status === 401 || res.status === 403) throw new ErroIa('indisponivel', `cloudflare ${res.status}: credencial recusada`);
    if (res.status === 408 || res.status === 504) throw new ErroIa('tempo', `cloudflare ${res.status}`);
    throw new ErroIa(res.status >= 500 ? 'indisponivel' : 'resposta', `cloudflare ${res.status} ${erro?.code ?? ''}: ${msg}`);
  }

  const r = j.result ?? {};
  const cru = r.response ?? r.choices?.[0]?.message?.content;
  const textoCru = typeof cru === 'string' ? cru : cru && typeof cru === 'object' ? JSON.stringify(cru) : '';
  const texto = extrairJson(textoCru);

  const doCabecalho = numero(res.headers.get('cf-ai-neurons'));
  const doCorpo = numero(r.usage?.neurons);
  let neuronios = doCabecalho ?? doCorpo;
  let estimado = false;
  if (neuronios === null) {
    estimado = true;
    const entrada = numero(r.usage?.prompt_tokens) ?? Math.ceil(prompt.length / 4) + (p.imagem ? TOKENS_IMAGEM_ESTIMADOS : 0);
    const saida = numero(r.usage?.completion_tokens) ?? Math.ceil(textoCru.length / 4);
    neuronios = estimarNeuronios(p.modelo, { entrada, saida });
  }
  if (!texto) {
    const erro = new ErroIa('resposta', `cloudflare ${p.modelo}: resposta sem JSON`);
    erro.neuronios = neuronios;
    throw erro;
  }
  return { texto, modelo: p.modelo, neuronios, estimado };
}

interface Fluxo { texto: string; usage: { prompt_tokens?: number; completion_tokens?: number; neurons?: number } | undefined }

/** Junta o texto de um fluxo SSE da Workers AI (`data: {"response": "..."}` … `data: [DONE]`). */
async function lerFluxo(res: Response, fluxo: Fluxo): Promise<void> {
  if (!res.body) return;
  const leitor = res.body.getReader();
  const dec = new TextDecoder();
  let resto = '';
  const linha = (l: string) => {
    const t = l.trim();
    if (!t.startsWith('data:')) return;
    const dado = t.slice(5).trim();
    if (!dado || dado === '[DONE]') return;
    try {
      const ev = JSON.parse(dado) as {
        response?: unknown; choices?: { delta?: { content?: unknown } }[];
        usage?: Fluxo['usage'];
      };
      // Uns modelos mandam o pedaço em `response`, outros em `choices[0].delta.content`
      // (às vezes os dois iguais, às vezes um vazio): usa um só, o que tiver texto.
      const delta = ev.choices?.[0]?.delta?.content;
      const parte = typeof delta === 'string' && delta ? delta : typeof ev.response === 'string' ? ev.response : '';
      fluxo.texto += parte;
      if (ev.usage) fluxo.usage = ev.usage;
    } catch { /* evento torto: ignora */ }
  };
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    resto += dec.decode(value, { stream: true });
    const linhas = resto.split('\n');
    resto = linhas.pop() ?? '';
    linhas.forEach(linha);
  }
  linha(resto + dec.decode());
}
