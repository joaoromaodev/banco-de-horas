// Foto girada: o celular grava a foto deitada e marca no EXIF "gire 90°". Tirar o
// EXIF (minimização) levava a marca junto e a foto chegava girada ao Gemini. Aqui as
// imagens de exemplo são geradas no próprio teste (sharp), com as orientações 1, 3,
// 6 e 8, e conferimos que o que vai para a IA já está em pé e sem metadados.
import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { orientacaoExif } from '@/lib/documentoLancamento';
import { endireitarFoto, fotoParaIa } from '@/lib/fotoParaIa';
import { prepararParaIa } from '@/lib/documentoLancamentoServidor';

/**
 * 80 × 40 gravada: metade esquerda vermelha, direita azul. É assim que o sensor
 * "vê"; a orientação diz como mostrar.
 */
async function fotoDeExemplo(orientacao: number, formato: 'jpeg' | 'png' | 'webp' = 'jpeg'): Promise<Uint8Array> {
  const W = 80, H = 40;
  const px = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      if (x < W / 2) px[o] = 255; else px[o + 2] = 255;
    }
  }
  const img = sharp(px, { raw: { width: W, height: H, channels: 3 } })
    // GPS de mentira: o que não pode chegar ao Google.
    .withMetadata({ orientation: orientacao, exif: { IFD0: { Make: 'CelularSecreto' }, IFD3: { GPSLatitudeRef: 'S' } } });
  const out = formato === 'png' ? img.png() : formato === 'webp' ? img.webp({ quality: 95 }) : img.jpeg({ quality: 95 });
  return new Uint8Array(await out.toBuffer());
}

/** Cor dominante ('vermelho' | 'azul') num ponto relativo (0–1) da imagem decodificada. */
async function corEm(bytes: Uint8Array, fx: number, fy: number) {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const x = Math.min(info.width - 1, Math.floor(info.width * fx));
  const y = Math.min(info.height - 1, Math.floor(info.height * fy));
  const o = (y * info.width + x) * info.channels;
  return data[o] > data[o + 2] ? 'vermelho' : 'azul';
}

const dimensoes = async (b: Uint8Array) => { const m = await sharp(b).metadata(); return [m.width, m.height]; };
const temTexto = (b: Uint8Array, t: string) => Buffer.from(b).includes(Buffer.from(t));

describe('orientação EXIF (leitura pura)', () => {
  it('lê a orientação de JPEG, PNG e WEBP gerados com ela', async () => {
    for (const o of [1, 3, 6, 8]) expect(orientacaoExif(await fotoDeExemplo(o), 'image/jpeg')).toBe(o);
    expect(orientacaoExif(await fotoDeExemplo(6, 'png'), 'image/png')).toBe(6);
    expect(orientacaoExif(await fotoDeExemplo(8, 'webp'), 'image/webp')).toBe(8);
  });
  it('arquivo sem EXIF, torto ou de outro tipo → 1 (nada a girar)', async () => {
    const semExif = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).jpeg().toBuffer());
    expect(orientacaoExif(semExif, 'image/jpeg')).toBe(1);
    expect(orientacaoExif(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]), 'image/jpeg')).toBe(1);
    expect(orientacaoExif(new Uint8Array([1, 2, 3]), 'image/png')).toBe(1);
    expect(orientacaoExif(await fotoDeExemplo(6), 'image/heic')).toBe(1);
  });
});

describe('foto em pé antes de tirar os metadados', () => {
  // [orientação, dimensões esperadas em pé, onde fica o vermelho]
  const casos: [number, [number, number], [number, number]][] = [
    [1, [80, 40], [0.25, 0.5]], // como gravada: vermelho à esquerda
    [3, [80, 40], [0.75, 0.5]], // 180°: vermelho à direita
    [6, [40, 80], [0.5, 0.25]], // 90° horário: a esquerda vai para cima
    [8, [40, 80], [0.5, 0.75]], // 90° anti-horário: a esquerda vai para baixo
  ];
  for (const [o, dim, vermelho] of casos) {
    it(`orientação ${o}: chega em pé, sem EXIF e sem a marca`, async () => {
      const foto = await fotoDeExemplo(o);
      const pronta = (await fotoParaIa(foto, 'image/jpeg'))!;
      expect(pronta).not.toBeNull();
      expect(await dimensoes(pronta)).toEqual(dim);
      expect(await corEm(pronta, vermelho[0], vermelho[1])).toBe('vermelho');
      expect(await corEm(pronta, 1 - vermelho[0], 1 - vermelho[1])).toBe('azul');
      expect(orientacaoExif(pronta, 'image/jpeg')).toBe(1);
      expect((await sharp(pronta).metadata()).exif).toBeUndefined();
      expect(temTexto(pronta, 'CelularSecreto')).toBe(false);
    });
  }

  it('orientação 1 não recodifica: só tira os metadados (a foto não perde qualidade)', async () => {
    const foto = await fotoDeExemplo(1);
    expect(await endireitarFoto(foto, 'image/jpeg')).toBe(foto);
  });

  it('PNG e WEBP também são endireitados', async () => {
    const png = (await fotoParaIa(await fotoDeExemplo(6, 'png'), 'image/png'))!;
    expect(await dimensoes(png)).toEqual([40, 80]);
    expect(await corEm(png, 0.5, 0.25)).toBe('vermelho');
    const webp = (await fotoParaIa(await fotoDeExemplo(8, 'webp'), 'image/webp'))!;
    expect(await dimensoes(webp)).toEqual([40, 80]);
    expect(await corEm(webp, 0.5, 0.75)).toBe('vermelho');
    expect(orientacaoExif(webp, 'image/webp')).toBe(1);
  });

  it('leitura de documento do caixa: prepararParaIa manda a foto em pé', async () => {
    const pronta = await prepararParaIa(await fotoDeExemplo(6), 'image/jpeg');
    expect(await dimensoes(pronta)).toEqual([40, 80]);
    expect(temTexto(pronta, 'CelularSecreto')).toBe(false);
  });

  it('HEIC (que a biblioteca não abre) não é girado: volta como veio', async () => {
    const b = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);
    expect(await endireitarFoto(b, 'image/heic')).toBe(b);
    expect(await fotoParaIa(b, 'image/heic')).toBeNull();
  });
});

describe('folha de ponto (lib/ocr.ts): a foto vai em pé à IA (Gemini e Cloudflare)', () => {
  it('Timesheet e envio do cliente passam por extrairFolha, que endireita e limpa', async () => {
    const recebido = vi.fn();
    vi.doMock('@google/genai', async (orig) => {
      const real = await orig<typeof import('@google/genai')>();
      class GoogleGenAI { models = { generateContent: async (p: unknown) => { recebido(p); return { text: JSON.stringify({ funcionario: '', dias: [], incertos: [] }) }; } }; }
      return { ...real, GoogleGenAI };
    });
    vi.resetModules();
    const { extrairFolha } = await import('@/lib/ocr');
    const foto = await fotoDeExemplo(6);
    await extrairFolha({
      imagemBase64: Buffer.from(foto).toString('base64'), mimeType: 'image/jpeg', ano: 2026, mes: 3,
      env: { IA_PROVEDOR: 'gemini', GEMINI_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv,
    }).catch(() => {});
    const parte = (recebido.mock.calls[0][0] as { contents: { parts: { inlineData?: { data: string } }[] }[] }).contents[0].parts[0];
    const enviada = new Uint8Array(Buffer.from(parte.inlineData!.data, 'base64'));
    expect(await dimensoes(enviada)).toEqual([40, 80]);
    expect(await corEm(enviada, 0.5, 0.25)).toBe('vermelho');
    expect(temTexto(enviada, 'CelularSecreto')).toBe(false);
    vi.doUnmock('@google/genai');
  });

  it('na Cloudflare (fetch simulado) a imagem do data URL também vai em pé e sem EXIF', async () => {
    vi.resetModules();
    const { extrairFolha } = await import('@/lib/ocr');
    const corpos: string[] = [];
    const fetchFalso = (async (_url: string, init: { body: string }) => {
      corpos.push(init.body);
      return new Response(JSON.stringify({ success: true, errors: [], result: { response: { dias: [] }, usage: { prompt_tokens: 10, completion_tokens: 5 } } }), { status: 200 });
    }) as unknown as typeof fetch;
    const foto = await fotoDeExemplo(6);
    await extrairFolha({
      imagemBase64: Buffer.from(foto).toString('base64'), mimeType: 'image/jpeg', ano: 2026, mes: 3,
      env: { CLOUDFLARE_ACCOUNT_ID: 'conta', CLOUDFLARE_AI_TOKEN: 'tok' } as unknown as NodeJS.ProcessEnv, fetch: fetchFalso,
    });
    const url = JSON.parse(corpos[0]).messages[0].content[1].image_url.url as string;
    const enviada = new Uint8Array(Buffer.from(url.split(',')[1], 'base64'));
    expect(await dimensoes(enviada)).toEqual([40, 80]);
    expect(await corEm(enviada, 0.5, 0.25)).toBe('vermelho');
    expect(temTexto(enviada, 'CelularSecreto')).toBe(false);
  });
});
