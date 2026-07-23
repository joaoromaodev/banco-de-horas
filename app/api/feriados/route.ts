// GET/POST /api/feriados — lista e salva o cadastro de feriados.
import { NextRequest } from 'next/server';
import { exigirGestor } from '@/lib/acesso';
import { lerFeriados, salvarFeriados, Feriado } from '@/lib/sheets';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    return Response.json({ feriados: await lerFeriados() });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao ler.' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json();
    const lista: Feriado[] = body.feriados ?? [];
    const n = await salvarFeriados(lista);
    return Response.json({ ok: true, total: n });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao salvar.' }, { status: 502 });
  }
}
