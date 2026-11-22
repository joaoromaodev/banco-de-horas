// IA plugável (Sprint 17, frente F) — a ÚNICA porta do app para a IA. Só servidor.
//
// Duas operações, o mesmo contrato nos dois provedores (lib/ia/config.ts):
//   - `lerComIa` com `arquivo` — visão: foto (ou PDF, só no Gemini) → JSON no esquema;
//   - `lerComIa` sem arquivo  — texto: escolha numa lista (sugestão de conta) → JSON.
// Quem chama monta o prompt, passa o esquema e valida a resposta como sempre fez
// (lib/ocr.ts, lib/documentoLancamento.ts, lib/sugestaoConta.ts) — a troca de
// provedor não mexe nas regras.
//
// O que é garantido aqui, para qualquer provedor:
//   - a imagem já chega em pé e sem EXIF (fotoParaIa, feito por quem chama); na
//     Cloudflare ela ainda é reduzida a no máximo 2.048 px (menos neurônios);
//   - tempo-limite por finalidade (folha 110 s, documento 60 s, sugestão 25 s),
//     abaixo do maxDuration das rotas (120–300 s);
//   - erro sempre como `ErroIa`, com mensagem para gente — nunca a crua;
//   - na Cloudflare, a cota diária é conferida ANTES (lib/ia/cota.ts) e o gasto,
//     gravado DEPOIS (mesmo quando a resposta não serviu).
import { chamarCloudflare, type ArquivoIa, type ResultadoProvedor } from './cloudflare';
import {
  chaveGemini, cotaDiariaCloudflare, iaConfigurada, modeloCloudflare, modeloCloudflareTexto, modeloGemini,
  provedorEscolhido, type FinalidadeIa, type NomeProvedor,
} from './config';
import { registrarUso, usoHoje } from './cota';
import { ErroIa } from './erros';
import type { Esquema } from './esquema';
import { chamarGemini } from './gemini';

export { ErroIa } from './erros';
export type { ArquivoIa } from './cloudflare';
export type { Esquema } from './esquema';

/** Lado maior da imagem enviada à Cloudflare. */
export const LADO_MAX_CLOUDFLARE = 2048;
/** Tempo-limite por finalidade: a folha inteira leva ~40–55 s no modelo padrão (comparativo). */
const TIMEOUT: Record<FinalidadeIa, number> = { ponto: 110_000, documento: 60_000, sugestao: 25_000 };
const MAX_TOKENS: Record<FinalidadeIa, number> = { ponto: 4096, documento: 1024, sugestao: 256 };

export interface PedidoIa {
  finalidade: FinalidadeIa;
  prompt: string;
  esquema: Esquema;
  /** Foto (já em pé e sem EXIF) ou, só no Gemini, PDF já reduzido. */
  arquivo?: ArquivoIa;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /** Para teste: o fetch simulado da Cloudflare. */
  fetch?: typeof fetch;
}

export interface RespostaIa {
  /** JSON da resposta, em texto. */
  texto: string;
  provedor: NomeProvedor;
  modelo: string;
}

/** O provedor ativo lê PDF direto? (a Cloudflare não: o caixa manda o texto do PDF.) */
export function provedorLePdf(env: NodeJS.ProcessEnv = process.env): boolean {
  return provedorEscolhido(env) === 'gemini';
}

/** Reduz a foto (lado maior ≤ 2.048 px). Falhou ou já é pequena: volta a mesma. */
export async function reduzirImagem(a: ArquivoIa): Promise<ArquivoIa> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(a.mime)) return a;
  try {
    const { default: sharp } = await import('sharp');
    const img = sharp(a.bytes, { failOn: 'none' });
    const m = await img.metadata();
    if (!m.width || !m.height || Math.max(m.width, m.height) <= LADO_MAX_CLOUDFLARE) return a;
    const saida = await img.resize({ width: LADO_MAX_CLOUDFLARE, height: LADO_MAX_CLOUDFLARE, fit: 'inside' })
      .jpeg({ quality: 88 }).toBuffer();
    return { bytes: new Uint8Array(saida), mime: 'image/jpeg' };
  } catch {
    return a;
  }
}

export async function lerComIa(p: PedidoIa): Promise<RespostaIa> {
  const env = p.env ?? process.env;
  const provedor = provedorEscolhido(env);
  if (!iaConfigurada(p.finalidade, env)) throw new ErroIa('indisponivel', `${provedor} sem variáveis`);
  const timeoutMs = p.timeoutMs ?? TIMEOUT[p.finalidade];

  if (provedor === 'gemini') {
    const modelo = modeloGemini(env);
    try {
      const r = await chamarGemini({
        apiKey: chaveGemini(p.finalidade, env)!, modelo, prompt: p.prompt, esquema: p.esquema, arquivo: p.arquivo, timeoutMs,
      });
      await registrarUso({ provedor, modelo, finalidade: p.finalidade, neuronios: null, estimado: false, ok: true });
      return { texto: r.texto, provedor, modelo };
    } catch (e) {
      throw e instanceof ErroIa ? e : new ErroIa('indisponivel', `gemini: ${(e as Error)?.message ?? 'erro'}`);
    }
  }

  // ---- Cloudflare
  if (p.arquivo?.mime === 'application/pdf') {
    throw new ErroIa('arquivo', 'cloudflare não lê PDF', 'Esta IA lê fotos (JPG, PNG, WEBP), não PDF.');
  }
  if (p.arquivo && !['image/jpeg', 'image/png', 'image/webp'].includes(p.arquivo.mime)) {
    throw new ErroIa('arquivo', `cloudflare: tipo ${p.arquivo.mime}`,
      'A IA lê fotos em JPG, PNG ou WEBP. No iPhone, envie a foto como JPG (Ajustes › Câmera › Formatos › Mais compatível).');
  }
  const limite = cotaDiariaCloudflare(env);
  const usados = await usoHoje('cloudflare');
  if (usados !== null && usados >= limite) throw new ErroIa('cota_diaria', `cloudflare: ${usados}/${limite} neurônios hoje`);

  const modelo = p.arquivo ? modeloCloudflare(env) : modeloCloudflareTexto(env);
  const imagem = p.arquivo ? await reduzirImagem(p.arquivo) : undefined;
  let r: ResultadoProvedor;
  try {
    r = await chamarCloudflare({
      conta: String(env.CLOUDFLARE_ACCOUNT_ID).trim(), token: String(env.CLOUDFLARE_AI_TOKEN).trim(),
      modelo, prompt: p.prompt, esquema: p.esquema, imagem, maxTokens: MAX_TOKENS[p.finalidade], timeoutMs, fetch: p.fetch,
    });
  } catch (e) {
    const erro = e instanceof ErroIa ? e : new ErroIa('indisponivel', `cloudflare: ${(e as Error)?.message ?? 'erro'}`);
    if (erro.tipo === 'cota_diaria') {
      // A Cloudflare recusou por cota: grava o que falta para o limite, e as próximas
      // chamadas (deste e de outros servidores) param antes de ir à rede.
      await registrarUso({
        provedor, modelo, finalidade: p.finalidade, neuronios: Math.max(0, limite - (usados ?? 0)), estimado: true, ok: false,
      });
    } else if (erro.neuronios !== null) {
      await registrarUso({ provedor, modelo, finalidade: p.finalidade, neuronios: erro.neuronios, estimado: false, ok: false });
    }
    throw erro;
  }
  await registrarUso({ provedor, modelo, finalidade: p.finalidade, neuronios: r.neuronios, estimado: r.estimado, ok: true });
  return { texto: r.texto, provedor, modelo };
}
