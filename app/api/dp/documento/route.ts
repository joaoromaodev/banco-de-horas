// GET /api/dp/documento?ferias=<id>&doc=aviso|recibo — aviso de férias ou recibo de
// férias em PDF (lib/feriasPdf.ts, mesmo estilo dos contratos). GET porque só gera o
// arquivo a partir do que está gravado: funciona também em somente leitura e com a
// empresa arquivada (consulta).
import { NextRequest } from 'next/server';
import { exigirGestor } from '@/lib/acesso';
import { exigirEmpresaPonto } from '@/lib/pontoAcesso';
import { lerFiscal } from '@/lib/caixa';
import { hojeBelem } from '@/lib/agenda';
import { lerEmpregado, lerFerias } from '@/lib/dpServidor';
import { baseAquisitivo, periodosAquisitivos, somarAnos, somarDias } from '@/lib/ferias';
import { gerarPdfFerias, NOME_DOCUMENTO_FERIAS, type DocumentoFerias } from '@/lib/feriasPdf';
import { respostaErroDp } from '../comum';

export const runtime = 'nodejs';

const limpar = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
function anexo(nome: string) {
  const ascii = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}

export async function GET(req: NextRequest) {
  const g0 = await exigirGestor(req);
  if (!g0.ok) return g0.resposta;
  const doc = req.nextUrl.searchParams.get('doc') as DocumentoFerias;
  if (doc !== 'aviso' && doc !== 'recibo') return Response.json({ erro: 'Documento inválido.' }, { status: 400 });
  try {
    const f = await lerFerias(req.nextUrl.searchParams.get('ferias') ?? '');
    if (!f || f.excluida) return Response.json({ erro: 'Férias não encontradas.' }, { status: 404 });
    const g = await exigirEmpresaPonto(req, f.empresaId);
    if (!g.ok) return g.resposta;
    const e = await lerEmpregado(f.empregadoId);
    if (!e || e.escritorioId !== g.escritorioId || f.escritorioId !== g.escritorioId) {
      return Response.json({ erro: 'Acesso restrito a esta empresa.' }, { status: 403 });
    }
    const base = baseAquisitivo(e);
    const periodo = base ? periodosAquisitivos(base, somarAnos(f.inicio, 1)).find((p) => p.inicio === f.aquisitivoInicio) : undefined;
    const fiscal = await lerFiscal(f.empresaId).catch(() => null);
    const pdf = await gerarPdfFerias(doc, {
      empresa: { nome: g.empresa.nome, cnpj: g.empresa.cnpj ?? null, cidade: fiscal?.municipio || fiscal?.cidadeTermo || null },
      empregado: { nome: e.nome, cpf: e.cpf, cargo: e.cargo, admissao: e.admissao },
      periodo: periodo ?? { inicio: f.aquisitivoInicio, fim: somarDias(somarAnos(f.aquisitivoInicio, 1), -1) },
      ferias: f,
      data: doc === 'aviso' ? (f.avisoEm ?? hojeBelem()) : (f.pagamentoEm ?? hojeBelem()),
    });
    const nome = `${NOME_DOCUMENTO_FERIAS[doc]} - ${limpar(e.nome.toUpperCase())}.pdf`;
    return new Response(new Uint8Array(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': anexo(nome), 'Cache-Control': 'no-store' },
    });
  } catch (err) { return respostaErroDp(err, 'Falha ao gerar o documento.'); }
}
