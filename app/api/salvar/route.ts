// POST /api/salvar — grava a frequência revisada no Google Sheets.
import { NextRequest } from 'next/server';
import { salvarFrequencia } from '@/lib/sheets';
import { Frequencia } from '@/lib/tipos';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let freq: Frequencia;
  try {
    const body = await req.json();
    freq = body.frequencia;
  } catch {
    return Response.json({ erro: 'JSON inválido.' }, { status: 400 });
  }

  if (!freq || !freq.empresa || !freq.funcionario || !freq.ano || !freq.mes) {
    return Response.json({ erro: 'Frequência incompleta (empresa, funcionário, mês e ano).' }, { status: 400 });
  }

  try {
    const dias = await salvarFrequencia(freq);
    return Response.json({ ok: true, dias });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao salvar.' }, { status: 502 });
  }
}
