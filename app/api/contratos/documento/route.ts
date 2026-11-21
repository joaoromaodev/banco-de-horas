// POST /api/contratos/documento — gera o .docx ou o PDF (`formato`; padrão .docx),
// ou um .zip com os três, a partir dos dados do formulário. Não depende do contrato estar salvo: os
// documentos saem mesmo que a migração 0003 ainda não tenha sido aplicada.
import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { exigirGestor, podeAcessarEmpresa } from '@/lib/acesso';
import { DadosContrato, Documento, NOME_DOCUMENTO, normalizarDados, validar } from '@/lib/contratos';
import { gerarPdf } from '@/lib/contratosPdf';
import { ErroContrato, gerarDocx } from '@/lib/contratosServidor';

export const runtime = 'nodejs';

const DOCS: Documento[] = ['contrato', 'vale', 'encerramento'];

/** Nome de arquivo seguro, preservando acentos (vai em filename*=UTF-8''). */
const limpar = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

function anexo(nome: string) {
  const ascii = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}

export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json();
    const empresa = String(body.empresa ?? '');
    if (!(await podeAcessarEmpresa(g.sessao, empresa))) {
      return Response.json({ erro: 'Acesso restrito a esta empresa.' }, { status: 403 });
    }
    const dados = normalizarDados((body.dados ?? {}) as Partial<DadosContrato>);
    const erros = validar(dados);
    if (erros.length) throw new ErroContrato(erros.join(' '));

    const pedido = String(body.documento ?? '');
    const pessoa = limpar(dados.nome.toUpperCase());
    const pdf = body.formato === 'pdf';
    const ext = pdf ? 'pdf' : 'docx';
    const gerar = async (d: Documento): Promise<Uint8Array> => (pdf ? gerarPdf(d, dados) : gerarDocx(d, dados));

    if (pedido === 'todos') {
      const zip = new JSZip();
      for (const doc of DOCS) zip.file(`${NOME_DOCUMENTO[doc]} - ${pessoa}.${ext}`, await gerar(doc));
      const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      return new Response(new Uint8Array(buf), {
        headers: { 'Content-Type': 'application/zip', 'Content-Disposition': anexo(`ADMISSÃO - ${pessoa}.zip`) },
      });
    }

    if (!DOCS.includes(pedido as Documento)) throw new ErroContrato('Documento inválido.');
    const doc = pedido as Documento;
    const buf = await gerar(doc);
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': anexo(`${NOME_DOCUMENTO[doc]} - ${pessoa}.${ext}`),
      },
    });
  } catch (e) {
    if (e instanceof ErroContrato) return Response.json({ erro: e.message }, { status: e.status });
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao gerar.' }, { status: 502 });
  }
}
