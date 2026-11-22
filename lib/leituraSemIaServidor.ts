// Nota e boleto sem IA (Sprint 17, Frente B) — a parte com I/O, só no servidor:
// o texto do PDF (unpdf, que embute o pdf.js e roda em função serverless, sem
// binário nem serviço externo) e a procura de lançamentos do mesmo documento
// (duplicidade). As regras ficam em lib/leituraSemIa.ts.
import { ErroCaixa } from './caixa';
import { getDb } from './db';
import { PAGINAS_PDF_SEM_IA, type LancamentoAnterior } from './leituraSemIa';

/** O PDF não pôde ser lido (com senha, torto). */
export class ErroPdf extends Error {}

/**
 * O texto das primeiras páginas do PDF, uma linha por linha do documento. Nada
 * sai do servidor. PDF escaneado (só imagem) devolve texto vazio ou quase.
 */
export async function textoDoPdf(bytes: Uint8Array, paginas = PAGINAS_PDF_SEM_IA): Promise<string> {
  const { getDocumentProxy } = await import('unpdf');
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // Cópia: o pdf.js toma posse do buffer.
    pdf = await getDocumentProxy(new Uint8Array(bytes), { isEvalSupported: false, stopAtErrors: false });
  } catch (e) {
    const nome = (e as { name?: string })?.name ?? '';
    throw new ErroPdf(/Password/i.test(nome)
      ? 'Este PDF tem senha. Salve o PDF sem senha e envie de novo — ou preencha à mão.'
      : 'Não foi possível abrir este PDF. Confira o arquivo ou preencha à mão.');
  }
  try {
    const linhas: string[] = [];
    const n = Math.min(paginas, pdf.numPages);
    for (let i = 1; i <= n; i++) {
      const conteudo = await (await pdf.getPage(i)).getTextContent();
      let linha = '';
      for (const item of conteudo.items as { str?: string; hasEOL?: boolean }[]) {
        linha += item.str ?? '';
        if (item.hasEOL) { linhas.push(linha); linha = ''; }
      }
      if (linha) linhas.push(linha);
      linhas.push('');
    }
    return linhas.join('\n');
  } finally {
    await pdf.destroy().catch(() => {});
  }
}

export type { LancamentoAnterior } from './leituraSemIa';

/** A coluna da 0033 ainda não existe? (PostgREST: 42703 ou "chave_documento"). */
export const semColunaChave = (e: { message?: string; code?: string } | null | undefined): boolean =>
  !!e && (e.code === '42703' || /chave_documento/.test(String(e.message ?? '')));

/**
 * Lançamentos da MESMA empresa (todos os exercícios dela) que já vieram deste
 * documento: pela chave da nota/boleto (`chave_documento`, 0033) ou pelo próprio
 * documento do portal (`documento_id`, 0029). `verificado` = a chave pôde ser
 * procurada (sem a 0033, só o documento do portal é conferido).
 */
export async function lancamentosDoDocumento(empresaId: string, p: { chave: string | null; documentoId: string | null }):
  Promise<{ verificado: boolean; encontrados: LancamentoAnterior[] }> {
  const db = getDb();
  const { data: ex, error: e1 } = await db.from('exercicios').select('id').eq('empresa_id', empresaId);
  if (e1) throw new ErroCaixa(`exercicios: ${e1.message}`, 502);
  const ids = (ex ?? []).map((x) => x.id as string);
  if (ids.length === 0) return { verificado: true, encontrados: [] };

  const linhas = new Map<string, Record<string, unknown>>();
  let verificado = true;
  const procurar = async (coluna: 'chave_documento' | 'documento_id', valor: string) => {
    const { data, error } = await db.from('lancamentos')
      .select('id, data, complemento, entrada, saida, juros, multa')
      .in('exercicio_id', ids).eq(coluna, valor).order('data').limit(5);
    if (error) {
      // Coluna ausente (migração não aplicada): não dá para conferir por ela.
      if (error.code === '42703' || new RegExp(coluna).test(error.message ?? '')) { if (coluna === 'chave_documento') verificado = false; return; }
      throw new ErroCaixa(`lancamentos: ${error.message}`, 502);
    }
    for (const l of data ?? []) linhas.set(l.id as string, l);
  };
  if (p.chave) await procurar('chave_documento', p.chave);
  else verificado = false;
  if (p.documentoId) await procurar('documento_id', p.documentoId);

  const num = (v: unknown) => Number(v ?? 0) || 0;
  const encontrados = [...linhas.values()].map((l) => ({
    data: String(l.data ?? ''), complemento: (l.complemento as string | null) ?? null,
    valor: num(l.entrada) || num(l.saida) + num(l.juros) + num(l.multa),
  })).sort((a, b) => a.data.localeCompare(b.data));
  return { verificado, encontrados };
}
