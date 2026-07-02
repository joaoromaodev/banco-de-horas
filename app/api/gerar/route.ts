// POST /api/gerar — recebe a frequência revisada e devolve o .xlsx (anexo 2).
import { NextRequest } from 'next/server';
import { gerarPlanilha } from '@/lib/planilha';
import { Frequencia } from '@/lib/tipos';
import { MESES } from '@/lib/calendario';
import { lerJornada } from '@/lib/sheets';

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
  if (!freq || !freq.funcionario || !freq.ano || !freq.mes) {
    return Response.json({ erro: 'Frequência incompleta (funcionário, mês e ano são obrigatórios).' }, { status: 400 });
  }

  const feriados = new Set(body.feriados ?? []);
  // A jornada (inclui "trabalha aos sábados") vem da config da empresa; o body
  // pode sobrescrever só os minutos por dia (jornada por funcionário).
  const cfg = await lerJornada();
  const jornada = body.jornada
    ? { ...cfg, utilMin: body.jornada.utilMin, sabadoMin: body.jornada.sabadoMin }
    : cfg;
  const wb = gerarPlanilha(freq, feriados, jornada);
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
