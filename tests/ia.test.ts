// IA plugável (Sprint 17, frente F): lib/ia — esquema, escolha do provedor, o
// provedor Cloudflare (com o fetch SIMULADO: nada vai à API real), a cota diária
// de neurônios e a leitura de documento em PDF pelo texto.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';

// O contador (lib/ia/cota) com o banco simulado: uso do dia e gravações.
const uso = { hoje: 0 as number | null, gravados: [] as Record<string, unknown>[] };
vi.mock('@/lib/ia/cota', async (orig) => ({
  ...(await orig<typeof import('@/lib/ia/cota')>()),
  usoHoje: vi.fn(async () => uso.hoje),
  registrarUso: vi.fn(async (u: Record<string, unknown>) => { uso.gravados.push(u); }),
}));

const { extrairJson, paraGemini, paraJsonSchema } = await import('@/lib/ia/esquema');
const config = await import('@/lib/ia/config');
const { chamarCloudflare, estimarNeuronios } = await import('@/lib/ia/cloudflare');
const { ErroIa, lerComIa } = await import('@/lib/ia');
const { avaliarCotaDiaria, diaUtc } = await import('@/lib/ia/cota');
const { lerDocumentoPelaIa, minimizarTextoPdf } = await import('@/lib/documentoLancamentoServidor');

const ENV_CF = { CLOUDFLARE_ACCOUNT_ID: 'conta-teste', CLOUDFLARE_AI_TOKEN: 'token-secreto' } as unknown as NodeJS.ProcessEnv;
const ESQ = { type: 'object' as const, properties: { indice: { type: 'integer' as const, nullable: true }, confianca: { type: 'number' as const } }, required: ['indice', 'confianca'] };

interface Chamada { url: string; init: { headers: Record<string, string>; body: string } }
function fetchFalso(resposta: { status?: number; corpo?: unknown; cabecalhos?: Record<string, string>; atraso?: number }) {
  const chamadas: Chamada[] = [];
  const f = (async (url: string, init: Chamada['init'] & { signal?: AbortSignal }) => {
    chamadas.push({ url, init });
    if (resposta.atraso) {
      await new Promise((ok, falha) => {
        const t = setTimeout(ok, resposta.atraso);
        init.signal?.addEventListener('abort', () => { clearTimeout(t); falha(Object.assign(new Error('abortado'), { name: 'AbortError' })); });
      });
    }
    return new Response(typeof resposta.corpo === 'string' ? resposta.corpo : JSON.stringify(resposta.corpo ?? {}), {
      status: resposta.status ?? 200, headers: resposta.cabecalhos,
    });
  }) as unknown as typeof fetch;
  return { f, chamadas };
}
const ok = (response: unknown, usage?: Record<string, number>) => ({ success: true, errors: [], result: { response, usage } });

beforeEach(() => { uso.hoje = 0; uso.gravados = []; });

describe('esquema', () => {
  it('traduz para o Gemini (maiúsculas, nullable) e para JSON Schema (tipo com null)', () => {
    expect(paraGemini(ESQ)).toEqual({
      type: 'OBJECT', properties: { indice: { type: 'INTEGER', nullable: true }, confianca: { type: 'NUMBER' } }, required: ['indice', 'confianca'],
    });
    expect(paraJsonSchema(ESQ)).toEqual({
      type: 'object', properties: { indice: { type: ['integer', 'null'] }, confianca: { type: 'number' } }, required: ['indice', 'confianca'],
    });
    expect(paraJsonSchema({ type: 'string', nullable: true, enum: ['a', 'b'] })).toEqual({ type: ['string', 'null'], enum: ['a', 'b', null] });
  });

  it('extrairJson: puro, com cerca ```json, com frase em volta; sem JSON → null', () => {
    expect(extrairJson('{"a":1}')).toBe('{"a":1}');
    expect(JSON.parse(extrairJson('```json\n{"a": [1, 2]}\n```')!)).toEqual({ a: [1, 2] });
    expect(JSON.parse(extrairJson('Aqui está: {"a": "x}y"} pronto.')!)).toEqual({ a: 'x}y' });
    expect(extrairJson('não consegui ler')).toBeNull();
    expect(extrairJson('{"a": ')).toBeNull();
    expect(extrairJson(null)).toBeNull();
  });
});

describe('escolha do provedor', () => {
  it('padrão: Cloudflare com as duas variáveis; senão Gemini; IA_PROVEDOR manda', () => {
    expect(config.provedorEscolhido(ENV_CF)).toBe('cloudflare');
    expect(config.provedorEscolhido({ CLOUDFLARE_ACCOUNT_ID: 'x' } as unknown as NodeJS.ProcessEnv)).toBe('gemini');
    expect(config.provedorEscolhido({ ...ENV_CF, IA_PROVEDOR: 'gemini' })).toBe('gemini');
    expect(config.provedorEscolhido({ IA_PROVEDOR: 'CloudFlare' } as unknown as NodeJS.ProcessEnv)).toBe('cloudflare');
    expect(config.provedorEscolhido({ IA_PROVEDOR: 'outro' } as unknown as NodeJS.ProcessEnv)).toBe('gemini');
  });

  it('configurada só com as variáveis do provedor escolhido; documento aceita a chave própria do caixa', () => {
    expect(config.iaConfigurada('ponto', ENV_CF)).toBe(true);
    expect(config.iaConfigurada('ponto', { IA_PROVEDOR: 'cloudflare', GEMINI_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(config.iaConfigurada('ponto', { GEMINI_API_KEY_CAIXA: 'k' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(config.iaConfigurada('documento', { GEMINI_API_KEY_CAIXA: 'k' } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(config.iaConfigurada('ponto', {} as unknown as NodeJS.ProcessEnv)).toBe(false);
  });

  it('modelo e cota configuráveis, com padrão', () => {
    expect(config.modeloCloudflare(ENV_CF)).toBe(config.MODELO_CLOUDFLARE_PADRAO);
    expect(config.modeloCloudflare({ IA_MODELO_CLOUDFLARE: '@cf/x/y' } as unknown as NodeJS.ProcessEnv)).toBe('@cf/x/y');
    expect(config.cotaDiariaCloudflare(ENV_CF)).toBe(10_000);
    expect(config.cotaDiariaCloudflare({ IA_COTA_DIARIA: '5000' } as unknown as NodeJS.ProcessEnv)).toBe(5000);
    expect(config.cotaDiariaCloudflare({ IA_COTA_DIARIA: 'abc' } as unknown as NodeJS.ProcessEnv)).toBe(10_000);
  });

  it('a descrição nunca leva o valor das variáveis', () => {
    expect(JSON.stringify(config.descricaoProvedor(ENV_CF))).not.toMatch(/conta-teste|token-secreto/);
  });
});

describe('chamarCloudflare (fetch simulado)', () => {
  const base = { conta: 'conta-teste', token: 'token-secreto', modelo: '@cf/meta/llama-4-scout-17b-16e-instruct', prompt: 'Escolha.', esquema: ESQ };

  it('monta o pedido: URL da conta e do modelo, token no cabeçalho, esquema no response_format e no texto, imagem em data URL', async () => {
    const { f, chamadas } = fetchFalso({ corpo: ok({ indice: 1, confianca: 0.9 }), cabecalhos: { 'cf-ai-neurons': '74.4' } });
    const r = await chamarCloudflare({ ...base, imagem: { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }, fetch: f });
    expect(chamadas[0].url).toBe('https://api.cloudflare.com/client/v4/accounts/conta-teste/ai/run/@cf/meta/llama-4-scout-17b-16e-instruct');
    expect(chamadas[0].init.headers.Authorization).toBe('Bearer token-secreto');
    const corpo = JSON.parse(chamadas[0].init.body);
    expect(corpo.temperature).toBe(0);
    expect(corpo.response_format).toEqual({ type: 'json_schema', json_schema: paraJsonSchema(ESQ) });
    expect(corpo.messages[0].content[0].text).toMatch(/^Escolha\.[\s\S]*JSON Schema/);
    expect(corpo.messages[0].content[1].image_url.url).toBe('data:image/png;base64,AQID');
    expect(JSON.parse(r.texto)).toEqual({ indice: 1, confianca: 0.9 });
    expect(r).toMatchObject({ neuronios: 74.4, estimado: false });
  });

  it('neurônios: do cabeçalho, senão de usage.neurons, senão estimados pelos tokens (marcado)', async () => {
    let { f } = fetchFalso({ corpo: ok({ indice: 0, confianca: 1 }, { neurons: 12.5, prompt_tokens: 1, completion_tokens: 1 }) });
    expect(await chamarCloudflare({ ...base, fetch: f })).toMatchObject({ neuronios: 12.5, estimado: false });
    ({ f } = fetchFalso({ corpo: ok({ indice: 0, confianca: 1 }, { prompt_tokens: 2400, completion_tokens: 1500 }) }));
    const r = await chamarCloudflare({ ...base, fetch: f });
    expect(r.estimado).toBe(true);
    expect(r.neuronios).toBeCloseTo(estimarNeuronios(base.modelo, { entrada: 2400, saida: 1500 }), 2);
    // US$ 0,27/M + 0,85/M → (2400×0,27 + 1500×0,85)/1e6 US$ ÷ 0,011/1000
    expect(r.neuronios).toBeCloseTo(174.8, 0);
  });

  it('pede stream e junta o fluxo SSE (texto em pedaços; neurônios do último evento)', async () => {
    const sse = [
      'data: {"response":"{\\"indice\\": "}\n\n',
      'data: {"response":"3, \\"confianca\\": 0.7}"}\n\ndata: {"response":"","usage":{"prompt_tokens":40,"completion_tokens":9,"neurons":3.3}}\n\n',
      'data: [DONE]\n\n',
    ];
    const chamadas: string[] = [];
    const f = (async (_u: string, init: { body: string }) => {
      chamadas.push(init.body);
      const corpo = new ReadableStream({ start(c) { for (const s of sse) c.enqueue(new TextEncoder().encode(s)); c.close(); } });
      return new Response(corpo, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as unknown as typeof fetch;
    const r = await chamarCloudflare({ ...base, fetch: f });
    expect(JSON.parse(chamadas[0]).stream).toBe(true);
    expect(JSON.parse(r.texto)).toEqual({ indice: 3, confianca: 0.7 });
    expect(r).toMatchObject({ neuronios: 3.3, estimado: false });
  });

  it('resposta em texto com cerca ```json é aceita (choices[0].message.content)', async () => {
    const { f } = fetchFalso({ corpo: { success: true, result: { choices: [{ message: { content: 'Claro!\n```json\n{"indice": 2, "confianca": 0.5}\n```' } }] } } });
    expect(JSON.parse((await chamarCloudflare({ ...base, fetch: f })).texto)).toEqual({ indice: 2, confianca: 0.5 });
  });

  it('erros viram ErroIa com mensagem para gente — nunca a crua nem o token', async () => {
    const casos: [Parameters<typeof fetchFalso>[0], string][] = [
      [{ status: 429, corpo: { success: false, errors: [{ code: 4006, message: 'you have used up your daily free allocation of 10,000 neurons' }] } }, 'cota_diaria'],
      [{ status: 429, corpo: { success: false, errors: [{ code: 3040, message: 'Capacity temporarily exceeded' }] } }, 'ocupada'],
      [{ status: 401, corpo: { success: false, errors: [{ code: 10000, message: 'Authentication error token-secreto' }] } }, 'indisponivel'],
      [{ status: 500, corpo: 'erro interno' }, 'indisponivel'],
      [{ status: 403, corpo: { success: false, errors: [{ code: 5016, message: 'AiError: Model Agreement: submit the prompt agree' }] } }, 'indisponivel'],
      [{ status: 400, corpo: { success: false, errors: [{ code: 5006, message: 'bad input' }] } }, 'resposta'],
    ];
    for (const [resposta, tipo] of casos) {
      const { f } = fetchFalso(resposta);
      const e = await chamarCloudflare({ ...base, fetch: f }).catch((x) => x);
      expect(e).toBeInstanceOf(ErroIa);
      expect(e.tipo).toBe(tipo);
      expect(e.mensagem).not.toMatch(/token-secreto|neurons|Authentication|Capacity/);
      expect(e.detalhe).not.toMatch(/token-secreto/);
    }
    const { f } = fetchFalso({ status: 429, corpo: { success: false, errors: [{ code: 4006, message: 'daily free allocation' }] } });
    const e = await chamarCloudflare({ ...base, fetch: f }).catch((x) => x);
    expect(e.status).toBe(429);
    expect(e.mensagem).toMatch(/limite diário da IA foi atingido. Tente amanhã/);
  });

  it('tempo esgotado → ErroIa "tempo"', async () => {
    const { f } = fetchFalso({ corpo: ok({}), atraso: 200 });
    const e = await chamarCloudflare({ ...base, fetch: f, timeoutMs: 20 }).catch((x) => x);
    expect(e).toBeInstanceOf(ErroIa);
    expect(e.tipo).toBe('tempo');
    expect(e.status).toBe(504);
  });

  it('resposta sem JSON → ErroIa "resposta", que ainda leva os neurônios gastos', async () => {
    const { f } = fetchFalso({ corpo: ok('Não consigo ler esta imagem.'), cabecalhos: { 'cf-ai-neurons': '30' } });
    const e = await chamarCloudflare({ ...base, fetch: f }).catch((x) => x);
    expect(e.tipo).toBe('resposta');
    expect(e.neuronios).toBe(30);
  });
});

describe('cota diária', () => {
  it('80% avisa, 100% esgota; o dia é o UTC', () => {
    expect(avaliarCotaDiaria(7999, 10_000).nivel).toBe('ok');
    expect(avaliarCotaDiaria(7999, 10_000).mensagem).toBe('');
    const aviso = avaliarCotaDiaria(8000, 10_000);
    expect(aviso).toMatchObject({ nivel: 'aviso', percentual: 80 });
    expect(aviso.mensagem).toMatch(/80% do limite de hoje/);
    const fim = avaliarCotaDiaria(10_400, 10_000);
    expect(fim).toMatchObject({ nivel: 'esgotada', percentual: 100 });
    expect(fim.mensagem).toMatch(/limite diário da IA foi atingido/);
    expect(diaUtc(new Date('2026-11-21T23:30:00-03:00'))).toBe('2026-11-22');
  });
});

describe('lerComIa (Cloudflare, cota simulada)', () => {
  it('lê, e grava o gasto da chamada (provedor, modelo, finalidade, neurônios) — sem conteúdo', async () => {
    const { f } = fetchFalso({ corpo: ok({ indice: 0, confianca: 1 }), cabecalhos: { 'cf-ai-neurons': '2.4' } });
    const r = await lerComIa({ finalidade: 'sugestao', prompt: 'p', esquema: ESQ, env: ENV_CF, fetch: f });
    expect(r.provedor).toBe('cloudflare');
    expect(uso.gravados).toEqual([{
      provedor: 'cloudflare', modelo: config.MODELO_CLOUDFLARE_PADRAO, finalidade: 'sugestao', neuronios: 2.4, estimado: false, ok: true,
    }]);
  });

  it('cota do dia esgotada: recusa ANTES de chamar a API, com a mensagem humana', async () => {
    uso.hoje = 10_000;
    const { f, chamadas } = fetchFalso({ corpo: ok({}) });
    const e = await lerComIa({ finalidade: 'ponto', prompt: 'p', esquema: ESQ, env: ENV_CF, fetch: f }).catch((x) => x);
    expect(e).toBeInstanceOf(ErroIa);
    expect(e.tipo).toBe('cota_diaria');
    expect(chamadas).toHaveLength(0);
  });

  it('a Cloudflare recusou por cota: grava o que faltava para o limite (as próximas param antes)', async () => {
    uso.hoje = 9_700;
    const { f } = fetchFalso({ status: 429, corpo: { success: false, errors: [{ code: 4006, message: 'daily free allocation' }] } });
    const e = await lerComIa({ finalidade: 'ponto', prompt: 'p', esquema: ESQ, env: ENV_CF, fetch: f }).catch((x) => x);
    expect(e.tipo).toBe('cota_diaria');
    expect(uso.gravados[0]).toMatchObject({ neuronios: 300, ok: false, estimado: true });
  });

  it('sem medição (sem a 0036): a leitura segue', async () => {
    uso.hoje = null;
    const { f } = fetchFalso({ corpo: ok({ indice: null, confianca: 0 }) });
    await expect(lerComIa({ finalidade: 'sugestao', prompt: 'p', esquema: ESQ, env: ENV_CF, fetch: f })).resolves.toMatchObject({ provedor: 'cloudflare' });
  });

  it('PDF e HEIC não vão para a Cloudflare (erro "arquivo", sem chamar a API)', async () => {
    const { f, chamadas } = fetchFalso({ corpo: ok({}) });
    for (const mime of ['application/pdf', 'image/heic']) {
      const e = await lerComIa({ finalidade: 'documento', prompt: 'p', esquema: ESQ, arquivo: { bytes: new Uint8Array([1]), mime }, env: ENV_CF, fetch: f }).catch((x) => x);
      expect(e.tipo).toBe('arquivo');
      expect(e.status).toBe(415);
    }
    expect(chamadas).toHaveLength(0);
  });

  it('sem variáveis: "indisponível"', async () => {
    const e = await lerComIa({ finalidade: 'ponto', prompt: 'p', esquema: ESQ, env: { IA_PROVEDOR: 'cloudflare' } as unknown as NodeJS.ProcessEnv }).catch((x) => x);
    expect(e.tipo).toBe('indisponivel');
  });
});

async function pdfCom(linhas: string[]): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const fonte = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([595, 842]);
  linhas.forEach((l, i) => p.drawText(l, { x: 40, y: 800 - i * 18, size: 11, font: fonte }));
  return d.save();
}

describe('documento em PDF na Cloudflare: vai só o texto, minimizado', () => {
  it('manda o texto extraído com CPF, CNPJ, e-mail e telefone mascarados — e nenhum arquivo', async () => {
    const pdf = await pdfCom([
      'RECIBO No 45', 'Padaria Ficticia LTDA - CNPJ 12.345.678/0001-90',
      'Recebi de Fulano Teste, CPF 123.456.789-09, fone (91) 98765-4321, fulano@exemplo.com',
      'a importancia de R$ 350,00 em 10/03/2026',
    ]);
    const { f, chamadas } = fetchFalso({ corpo: ok({ confianca: 0.8, legivel: true, valor: 350 }) });
    const texto = await lerDocumentoPelaIa({ bytes: pdf, mime: 'application/pdf', prompt: 'Leia.', env: ENV_CF, fetch: f });
    expect(JSON.parse(texto)).toMatchObject({ valor: 350 });
    const corpo = JSON.parse(chamadas[0].init.body);
    expect(corpo.messages[0].content).toHaveLength(1); // só texto, nenhuma imagem/arquivo
    const enviado = corpo.messages[0].content[0].text as string;
    expect(enviado).toMatch(/R\$ 350,00/);
    expect(enviado).toMatch(/Padaria Ficticia/);
    expect(enviado).not.toMatch(/123\.456\.789-09|12\.345\.678\/0001-90|98765-4321|fulano@exemplo\.com/);
    expect(enviado).toMatch(/\[cpf\]/);
  });

  it('PDF escaneado (sem texto) é recusado com mensagem, sem chamar a API', async () => {
    const d = await PDFDocument.create(); d.addPage([595, 842]);
    const { f, chamadas } = fetchFalso({ corpo: ok({}) });
    const e = await lerDocumentoPelaIa({ bytes: await d.save(), mime: 'application/pdf', prompt: 'Leia.', env: ENV_CF, fetch: f }).catch((x) => x);
    expect(e).toBeInstanceOf(ErroIa);
    expect(e.mensagem).toMatch(/imagem escaneada/);
    expect(chamadas).toHaveLength(0);
  });

  it('minimizarTextoPdf não trava com texto montado (milhares de "@") — corta antes de mascarar', () => {
    const t0 = Date.now();
    const r = minimizarTextoPdf(`${'@'.repeat(50_000)} a@b ${'1'.repeat(50_000)}`);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(r.length).toBeLessThanOrEqual(6000);
  });

  it('minimizarTextoPdf mantém nº da nota e valor', () => {
    expect(minimizarTextoPdf('NF 1234 valor R$ 1.234,56 chave 3526 0312 3456 7800 0190 5500 1000')).toBe('NF 1234 valor R$ 1.234,56 chave [número]');
  });
});
