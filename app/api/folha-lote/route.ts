// GET /api/folha-lote?empresa=<id>&ano=&mes= — folhas de ponto em branco de
// TODOS os funcionários da empresa (do cadastro), num .zip.
import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { gerarFolhaPonto } from '@/lib/folhaPonto';
import { lerEmpresa, lerFeriados, lerFuncionarios, lerJornadaEmpresa } from '@/lib/sheets';
import { MESES } from '@/lib/calendario';

export const runtime = 'nodejs';
export const maxDuration = 60;

function slug(s: string): string {
  return s.normalize('NFD').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const empresa = (searchParams.get('empresa') || '').trim();
  const ano = Number(searchParams.get('ano'));
  const mes = Number(searchParams.get('mes'));

  if (!empresa) return Response.json({ erro: 'Informe a empresa.' }, { status: 400 });
  if (!ano || !mes || mes < 1 || mes > 12) return Response.json({ erro: 'Mês/ano inválidos.' }, { status: 400 });

  try {
    const [emp, feriadosArr, funcs, jornada] = await Promise.all([
      lerEmpresa(empresa),
      lerFeriados(),
      lerFuncionarios(empresa),
      lerJornadaEmpresa(empresa),
    ]);
    const nomeEmpresa = emp?.nome ?? '';
    if (!funcs.length) {
      return Response.json({ erro: `Nenhum funcionário cadastrado em ${nomeEmpresa || 'a empresa'}.` }, { status: 404 });
    }

    const feriados = new Set(feriadosArr.map((f) => f.data));
    const zip = new JSZip();
    for (const f of funcs) {
      const wb = gerarFolhaPonto({ nomeEmpresa, funcionario: f.nome, cargo: f.cargo, ano, mes, feriados, jornada });
      const buf = await wb.xlsx.writeBuffer();
      zip.file(`folha_${slug(f.nome)}_${MESES[mes]}_${ano}.xlsx`, buf as ArrayBuffer);
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
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao gerar folhas.' }, { status: 502 });
  }
}
