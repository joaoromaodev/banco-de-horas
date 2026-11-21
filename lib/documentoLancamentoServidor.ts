// Documento → lançamento por IA — preparar o arquivo e chamar o Gemini (só servidor).
//
// O que vai para o Google: os bytes do documento já MINIMIZADOS (PDF regravado só
// com as primeiras páginas e sem os metadados do original; foto já em pé — a
// orientação do EXIF aplicada nos pixels — e sem EXIF/XMP: localização, aparelho,
// horário) e o texto de `montarPromptDocumento` (exercício,
// direção informada e a lista de contas da empresa). NÃO vão: nome/CNPJ da
// empresa, e-mail de quem lança, nome do arquivo, observação do envio nem
// lançamentos anteriores. Ver docs/livro-caixa.md, "Documento → lançamento por IA".
import { GoogleGenAI, Type } from '@google/genai';
import { PDFDocument } from 'pdf-lib';
import { PAGINAS_PDF_PARA_IA } from './documentoLancamento';
import { fotoParaIa } from './fotoParaIa';

export const SCHEMA_DOCUMENTO = {
  type: Type.OBJECT,
  properties: {
    data: { type: Type.STRING, nullable: true },
    valor: { type: Type.NUMBER, nullable: true },
    direcao: { type: Type.STRING, nullable: true, enum: ['entrada', 'saida'] },
    complemento: { type: Type.STRING, nullable: true },
    indice: { type: Type.INTEGER, nullable: true },
    confianca: { type: Type.NUMBER },
    legivel: { type: Type.BOOLEAN },
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

/** Manda o documento (já preparado) e o prompt ao Gemini e devolve o texto (JSON) da resposta. */
export async function lerDocumentoNoGemini(p: {
  apiKey: string; modelo: string; bytes: Uint8Array; mime: string; prompt: string;
}): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: p.apiKey });
  const res = await ai.models.generateContent({
    model: p.modelo,
    contents: [{
      role: 'user',
      parts: [
        { inlineData: { mimeType: p.mime, data: Buffer.from(p.bytes).toString('base64') } },
        { text: p.prompt },
      ],
    }],
    config: { responseMimeType: 'application/json', responseSchema: SCHEMA_DOCUMENTO, temperature: 0 },
  });
  const texto = res.text;
  if (!texto) throw new Error('Gemini não retornou conteúdo.');
  return texto;
}
