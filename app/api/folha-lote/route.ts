// GET /api/folha-lote?empresa=<id>&ano=&mes= — folhas de ponto em branco de
// TODOS os funcionários da empresa (do cadastro), num .zip.
import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { exigirEmpresaPonto, respostaErroPonto } from '@/lib/pontoAcesso';
import { gerarFolhaPontoPDF } from '@/lib/folhaPonto';
import { lerFeriados, lerFuncionarios } from '@/lib/pontoDb';
import { lerJornadaEmpresa } from '@/lib/cadastro';
import { MESES } from '@/lib/calendario';

export const runtime = 'nodejs';
export const maxDuration = 60;

function slug(s: string): string {
  return s.normalize('NFD').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const g = await exigirEmpresaPonto(req, searchParams.get('empresa'));
  if (!g.ok) return g.resposta;
  const ano = Number(searchParams.get('ano'));
  const mes = Number(searchParams.get('mes'));
  if (!ano || !mes || mes < 1 || mes > 12) return Response.json({ erro: 'Mês/ano inválidos.' }, { status: 400 });
  const empresa = g.empresa.id;
  const nomeEmpresa = g.empresa.nome;

  try {
    const [feriadosArr, funcs, jornada] = await Promise.all([
      lerFeriados(g.escritorioId),
      lerFuncionarios(g.escritorioId, empresa),
      lerJornadaEmpresa(empresa),
    ]);
    if (!funcs.length) {
      return Response.json({ erro: `Nenhum funcionário cadastrado em ${nomeEmpresa || 'a empresa'}.` }, { status: 404 });
    }

    const feriados = new Set(feriadosArr.map((f) => f.data));
    const zip = new JSZip();
    for (const f of funcs) {
      const pdf = await gerarFolhaPontoPDF({ nomeEmpresa, funcionario: f.nome, cargo: f.cargo, ano, mes, feriados, jornada });
      zip.file(`folha_${slug(f.nome)}_${MESES[mes]}_${ano}.pdf`, pdf as Uint8Array);
    }
    const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });

    return new Response(zipBuf as unknown as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="folhas_${slug(nomeEmpresa || empresa)}_${MESES[mes]}_${ano}.zip"`,
      },
    });
  } catch (e) {
    return respostaErroPonto(e, 'Falha ao gerar as folhas.');
  }
}
