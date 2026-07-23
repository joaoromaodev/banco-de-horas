// GET /api/gerar-lote?ano=&mes= — gera 1 .xlsx por funcionário do mês (dados do
// Sheets) e devolve tudo num .zip.
import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { exigirGestor } from '@/lib/acesso';
import { gerarPlanilha } from '@/lib/planilha';
import { lerFrequenciasDoMes, lerFeriados, lerFuncionarios, lerJornadaEmpresa, lerEmpresa } from '@/lib/sheets';
import { MESES } from '@/lib/calendario';

export const runtime = 'nodejs';
export const maxDuration = 60;

function slug(s: string): string {
  return s.normalize('NFD').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  const { searchParams } = new URL(req.url);
  const empresa = (searchParams.get('empresa') || '').trim();
  const ano = Number(searchParams.get('ano'));
  const mes = Number(searchParams.get('mes'));
  if (!empresa) {
    return Response.json({ erro: 'Informe a empresa.' }, { status: 400 });
  }
  if (!ano || !mes || mes < 1 || mes > 12) {
    return Response.json({ erro: 'Parâmetros ano/mes inválidos.' }, { status: 400 });
  }

  try {
    const [freqs, feriadosArr, funcs, jornadaEmpresa, emp] = await Promise.all([
      lerFrequenciasDoMes(empresa, ano, mes),
      lerFeriados(),
      lerFuncionarios(empresa),
      lerJornadaEmpresa(empresa),
      lerEmpresa(empresa),
    ]);
    const nomeEmpresa = emp?.nome ?? '';
    if (!freqs.length) {
      return Response.json({ erro: `Nenhuma frequência salva para ${nomeEmpresa || 'a empresa'} em ${MESES[mes]}/${ano}.` }, { status: 404 });
    }

    const feriados = new Set(feriadosArr.map((f) => f.data));
    // Minutos por dia podem variar por funcionário; "trabalha aos sábados" é da empresa.
    const jornadaPorNome = new Map(
      funcs.map((f) => [f.nome, {
        utilMin: f.jornadaUtilMin ?? jornadaEmpresa.utilMin,
        sabadoMin: f.jornadaSabadoMin ?? jornadaEmpresa.sabadoMin,
        trabalhaSabado: jornadaEmpresa.trabalhaSabado,
      }]),
    );

    const zip = new JSZip();
    for (const freq of freqs) {
      const wb = gerarPlanilha(freq, feriados, jornadaPorNome.get(freq.funcionario), nomeEmpresa);
      const buf = await wb.xlsx.writeBuffer();
      zip.file(`${slug(freq.funcionario)}_${MESES[mes]}_${ano}.xlsx`, buf as ArrayBuffer);
    }
    const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });

    return new Response(zipBuf as unknown as ArrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${slug(nomeEmpresa || empresa)}_${MESES[mes]}_${ano}.zip"`,
      },
    });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao gerar lote.' }, { status: 502 });
  }
}
