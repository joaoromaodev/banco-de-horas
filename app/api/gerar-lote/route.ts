// GET /api/gerar-lote?empresa=&ano=&mes= — gera 1 .xlsx por funcionário do mês
// (frequências salvas) e devolve tudo num .zip.
import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import { exigirEmpresaPonto, respostaErroPonto } from '@/lib/pontoAcesso';
import { gerarPlanilha } from '@/lib/planilha';
import { lerFeriados, lerFrequenciasDoMes, lerFuncionarios } from '@/lib/pontoDb';
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
  if (!ano || !mes || mes < 1 || mes > 12) {
    return Response.json({ erro: 'Parâmetros ano/mes inválidos.' }, { status: 400 });
  }
  const empresa = g.empresa.id;
  const nomeEmpresa = g.empresa.nome;

  try {
    const [freqs, feriadosArr, funcs, jornadaEmpresa] = await Promise.all([
      lerFrequenciasDoMes(g.escritorioId, empresa, ano, mes),
      lerFeriados(g.escritorioId),
      lerFuncionarios(g.escritorioId, empresa),
      lerJornadaEmpresa(empresa),
    ]);
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
    return respostaErroPonto(e, 'Falha ao gerar o lote.');
  }
}
