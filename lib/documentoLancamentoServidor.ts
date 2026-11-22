// Documento → lançamento por IA — preparar o arquivo e chamar a IA (só servidor).
// O provedor (Cloudflare Workers AI ou Gemini) é escolhido em lib/ia.
//
// O que vai para a IA: os bytes do documento já MINIMIZADOS (PDF regravado só
// com as primeiras páginas e sem os metadados do original; foto já em pé — a
// orientação do EXIF aplicada nos pixels — e sem EXIF/XMP: localização, aparelho,
// horário) e o texto de `montarPromptDocumento` (exercício,
// direção informada e a lista de contas da empresa). NÃO vão: nome/CNPJ da
// empresa, e-mail de quem lança, nome do arquivo, observação do envio nem
// lançamentos anteriores. Ver docs/livro-caixa.md, "Documento → lançamento por IA".
//
// PDF na Cloudflare (que não lê PDF): vai só o TEXTO das primeiras páginas, lido
// aqui no servidor (unpdf) e com CPF/CNPJ, e-mail e telefone mascarados — o
// arquivo não sai. PDF escaneado (sem texto) é recusado com mensagem.
import { PDFDocument } from 'pdf-lib';
import { PAGINAS_PDF_PARA_IA } from './documentoLancamento';
import { fotoParaIa } from './fotoParaIa';
import { ErroIa, lerComIa, provedorLePdf, type Esquema } from './ia';
import { ErroPdf, textoDoPdf } from './leituraSemIaServidor';

export const SCHEMA_DOCUMENTO: Esquema = {
  type: 'object',
  properties: {
    data: { type: 'string', nullable: true },
    valor: { type: 'number', nullable: true },
    direcao: { type: 'string', nullable: true, enum: ['entrada', 'saida'] },
    complemento: { type: 'string', nullable: true },
    indice: { type: 'integer', nullable: true },
    confianca: { type: 'number' },
    legivel: { type: 'boolean' },
  },
  required: ['confianca', 'legivel'],
};

/** O arquivo não pôde ser preparado para a IA (PDF com senha, imagem fora do formato). */
export class ErroArquivoIa extends Error {}

/**
 * Regrava o PDF com só as primeiras páginas (nota, recibo e boleto cabem nelas) —
 * o documento novo não leva os metadados do original (autor, título, programa).
 * PDF que o pdf-lib não abre (com senha, torto) é RECUSADO: mandar inteiro furaria
 * a minimização e o custo (centenas de páginas por uma leitura).
 */
export async function reduzirPdf(bytes: Uint8Array, paginas = PAGINAS_PDF_PARA_IA): Promise<Uint8Array> {
  try {
    const origem = await PDFDocument.load(bytes, { updateMetadata: false });
    const n = Math.min(paginas, origem.getPageCount());
    if (n === 0) throw new Error('PDF sem páginas');
    const novo = await PDFDocument.create();
    const copiadas = await novo.copyPages(origem, Array.from({ length: n }, (_, i) => i));
    copiadas.forEach((p) => novo.addPage(p));
    return await novo.save();
  } catch {
    // Com senha (o pdf-lib recusa), torto ou vazio: não vai.
    throw new ErroArquivoIa('Não foi possível abrir este PDF (ele tem senha?). Salve o PDF sem senha ou envie uma foto.');
  }
}

/** O que de fato vai para a IA: PDF reduzido ou foto em pé e sem metadados. */
export async function prepararParaIa(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  if (mime === 'application/pdf') return reduzirPdf(bytes);
  const limpa = await fotoParaIa(bytes, mime);
  if (!limpa) throw new ErroArquivoIa('Não foi possível preparar esta imagem para a leitura. Envie como JPG ou PDF.');
  return limpa;
}

/** Caracteres de texto do PDF que vão para a IA (nota/recibo cabem com folga). */
export const MAX_TEXTO_PDF = 6000;
/** Menos que isto de texto (sem espaços) = PDF escaneado, só imagem. */
const MIN_TEXTO_PDF = 30;

/**
 * Minimiza o texto do PDF antes de mandar: e-mail, CPF/CNPJ (formatados ou em
 * 11+ dígitos — inclui linha digitável e chave de acesso) e telefone viram
 * marcadores. Valor, data, número da nota e nome do estabelecimento ficam.
 */
export function minimizarTextoPdf(texto: string): string {
  // Corta ANTES de mascarar: as regras abaixo não podem rodar sobre um texto enorme
  // (um PDF montado com milhares de "@" travaria a função — revisão do escudo).
  return String(texto ?? '').slice(0, MAX_TEXTO_PDF + 2000)
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ')
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[e-mail]')
    .replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, '[cpf]')
    .replace(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g, '[cnpj]')
    .replace(/\(?\b\d{2}\)?\s*\d{4,5}-\d{4}\b/g, '[telefone]')
    .replace(/\d[\d.\-/ ]{9,}\d/g, (m) => (m.replace(/\D/g, '').length >= 11 ? '[número]' : m))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXTO_PDF);
}

/**
 * Manda o documento (já preparado) e o prompt à IA ativa e devolve o texto (JSON)
 * da resposta. Erros saem como `ErroIa` (mensagem para gente).
 */
export async function lerDocumentoPelaIa(p: {
  bytes: Uint8Array; mime: string; prompt: string; env?: NodeJS.ProcessEnv; fetch?: typeof fetch;
  /** Escritório dono da empresa (teto diário por escritório da IA — Sprint 18 · A). */
  escritorioId?: string | null;
}): Promise<string> {
  if (p.mime === 'application/pdf' && !provedorLePdf(p.env)) {
    let texto: string;
    try {
      texto = minimizarTextoPdf(await textoDoPdf(p.bytes));
    } catch (e) {
      if (e instanceof ErroPdf) throw new ErroIa('arquivo', 'pdf ilegível', e.message);
      throw e;
    }
    if (texto.replace(/\s/g, '').length < MIN_TEXTO_PDF) {
      throw new ErroIa('arquivo', 'pdf sem texto',
        'Este PDF é uma imagem escaneada, e a IA desta plataforma não lê PDF assim. Envie uma foto do documento (JPG) ou lance à mão.');
    }
    const prompt = `${p.prompt}\n\nO documento é um PDF; segue o TEXTO extraído dele (dados pessoais mascarados):\n<<<\n${texto}\n>>>`;
    return (await lerComIa({ finalidade: 'documento', prompt, esquema: SCHEMA_DOCUMENTO, escritorioId: p.escritorioId, env: p.env, fetch: p.fetch })).texto;
  }
  return (await lerComIa({
    finalidade: 'documento', prompt: p.prompt, esquema: SCHEMA_DOCUMENTO,
    arquivo: { bytes: p.bytes, mime: p.mime }, escritorioId: p.escritorioId, env: p.env, fetch: p.fetch,
  })).texto;
}
