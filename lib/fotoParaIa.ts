// Foto pronta para a IA (só servidor): em pé e sem metadados.
//
// O celular grava a foto "deitada" e põe no EXIF uma marca de orientação ("gire
// 90°"). Tirar o EXIF (localização, aparelho, horário — minimização para o Google)
// leva a marca junto, e a foto chegava girada ao Gemini. Por isso a rotação é
// aplicada nos PIXELS antes (sharp), e só então os metadados saem.
//
// Usado pela leitura de documento do caixa (lib/documentoLancamentoServidor.ts) e
// pela leitura da folha de ponto (lib/ocr.ts — Timesheet e envio do cliente).
import { imagemSemMetadados, orientacaoExif } from './documentoLancamento';

/** Tipos que a biblioteca de imagem gira (HEIC não: o sharp pré-compilado não o abre). */
const GIRAVEIS = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * A foto com a orientação do EXIF aplicada nos pixels. Sem marca (ou orientação 1)
 * volta a mesma, sem recodificar. Se a biblioteca de imagem faltar ou falhar,
 * volta a original — a leitura segue como antes (pode chegar girada), nunca trava.
 */
export async function endireitarFoto(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  if (!GIRAVEIS.includes(mime) || orientacaoExif(bytes, mime) === 1) return bytes;
  try {
    const { default: sharp } = await import('sharp');
    // `.rotate()` sem ângulo = aplica a orientação do EXIF (os 8 casos, com espelho).
    // A saída do sharp não leva metadados (EXIF, XMP, ICC) — só os que se pedir.
    const img = sharp(bytes, { failOn: 'none' }).rotate();
    const saida = mime === 'image/png' ? img.png()
      : mime === 'image/webp' ? img.webp({ quality: 90 })
      : img.jpeg({ quality: 90 });
    return new Uint8Array(await saida.toBuffer());
  } catch (e) {
    console.error('[foto-ia] não foi possível endireitar a foto:', e instanceof Error ? e.message : e);
    return bytes;
  }
}

/**
 * O que vai para a IA: a foto em pé e sem metadados. `null` = não deu para limpar
 * (arquivo fora do formato, HEIC) — quem chama decide (o caixa recusa).
 */
export async function fotoParaIa(bytes: Uint8Array, mime: string): Promise<Uint8Array | null> {
  return imagemSemMetadados(await endireitarFoto(bytes, mime), mime);
}
