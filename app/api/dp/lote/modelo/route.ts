// GET /api/dp/lote/modelo?empresa=&formato=xlsx|csv — planilha modelo da importação em
// lote, com os empregados da empresa e o que já está no cadastro. Só leitura (funciona
// também em somente leitura e em empresa arquivada).
import { NextRequest } from 'next/server';
import { exigirEmpresaPonto } from '@/lib/pontoAcesso';
import { gerarModelo } from '@/lib/dpLoteArquivo';
import { listarEmpregados } from '@/lib/dpServidor';
import { respostaErroDp } from '../../comum';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirEmpresaPonto(req, req.nextUrl.searchParams.get('empresa'));
  if (!g.ok) return g.resposta;
  const formato = req.nextUrl.searchParams.get('formato') === 'csv' ? 'csv' : 'xlsx';
  try {
    const lista = await listarEmpregados(g.escritorioId, [g.empresa.id]);
    const { bytes, tipo, arquivo } = await gerarModelo(lista, formato);
    return new Response(bytes as BodyInit, {
      headers: {
        'Content-Type': tipo,
        'Content-Disposition': `attachment; filename="${arquivo}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) { return respostaErroDp(e, 'Falha ao gerar o modelo.'); }
}
