// POST /api/gerar — recebe a frequência revisada e devolve o .xlsx (anexo 2).
import { NextRequest } from 'next/server';
import { gerarPlanilha } from '@/lib/planilha';
import { Frequencia } from '@/lib/tipos';
import { MESES } from '@/lib/calendario';
import { lerEmpresa } from '@/lib/sheets';
import { JORNADA_PADRAO } from '@/lib/calendario';

export const runtime = 'nodejs';

interface Body {
  frequencia: Frequencia;
  feriados?: string[];
  jornada?: { utilMin: number; sabadoMin: number };
}

function slug(s: string): string {
  return s.normalize('NFD').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ erro: 'JSON inválido.' }, { status: 400 });
  }

  const freq = body.frequencia;
  if (!freq || !freq.empresa || !freq.funcionario || !freq.ano || !freq.mes) {
    return Response.json({ erro: 'Frequência incompleta (empresa, funcionário, mês e ano são obrigatórios).' }, { status: 400 });
  }

  const feriados = new Set(body.feriados ?? []);
  // Empresa (por id): jornada + razão social para o cabeçalho da planilha.
  const emp = await lerEmpresa(freq.empresa);
  const base = emp
    ? { utilMin: emp.jornadaUtilMin ?? JORNADA_PADRAO.utilMin, sabadoMin: emp.jornadaSabadoMin ?? JORNADA_PADRAO.sabadoMin, trabalhaSabado: emp.trabalhaSabado }
    : { ...JORNADA_PADRAO };
  // O body pode sobrescrever só os minutos por dia (jornada por funcionário).
  const jornada = body.jornada
    ? { ...base, utilMin: body.jornada.utilMin, sabadoMin: body.jornada.sabadoMin }
    : base;
  const wb = gerarPlanilha(freq, feriados, jornada, emp?.nome ?? '');
  const buffer = await wb.xlsx.writeBuffer();

  const nome = `${slug(freq.funcionario)}_${MESES[freq.mes]}_${freq.ano}.xlsx`;
  return new Response(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${nome}"`,
    },
  });
}
