// GET /api/gerar-lote?ano=&mes= — gera 1 .xlsx por funcionário do mês (dados do
// Sheets) e devolve tudo num .zip.
import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { gerarPlanilha } from '@/lib/planilha';
import { lerFrequenciasDoMes, lerFeriados, lerFuncionarios } from '@/lib/sheets';
import { MESES } from '@/lib/calendario';

export const runtime = 'nodejs';
export const maxDuration = 60;

function slug(s: string): string {
  return s.normalize('NFD').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ano = Number(searchParams.get('ano'));
  const mes = Number(searchParams.get('mes'));
  if (!ano || !mes || mes < 1 || mes > 12) {
    return Response.json({ erro: 'Parâmetros ano/mes inválidos.' }, { status: 400 });
  }

  try {
    const [freqs, feriadosArr, funcs] = await Promise.all([
      lerFrequenciasDoMes(ano, mes),
      lerFeriados(),
      lerFuncionarios(),
    ]);
    if (!freqs.length) {
      return Response.json({ erro: `Nenhuma frequência salva para ${MESES[mes]}/${ano}.` }, { status: 404 });
    }

    const feriados = new Set(feriadosArr.map((f) => f.data));
    const jornadaPorNome = new Map(
      funcs.map((f) => [f.nome, { utilMin: f.jornadaUtilMin ?? 480, sabadoMin: f.jornadaSabadoMin ?? 240 }]),
    );

    const zip = new JSZip();
    for (const freq of freqs) {
      const wb = gerarPlanilha(freq, feriados, jornadaPorNome.get(freq.funcionario));
      const buf = await wb.xlsx.writeBuffer();
      zip.file(`${slug(freq.funcionario)}_${MESES[mes]}_${ano}.xlsx`, buf as ArrayBuffer);
    }
    const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });

    return new Response(zipBuf as unknown as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="planilhas_${MESES[mes]}_${ano}.zip"`,
      },
    });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao gerar lote.' }, { status: 502 });
  }
}
