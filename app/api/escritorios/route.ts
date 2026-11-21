// GET /api/escritorios — escritórios contábeis (inquilinos).
// O master vê todos (para cadastrar contador num escritório); o contador, só o seu.
import { NextRequest } from 'next/server';
import { exigirGestor } from '@/lib/acesso';
import { lerEscritorio, lerEscritorios } from '@/lib/escritorios';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    if (g.sessao.role === 'master') return Response.json({ escritorios: await lerEscritorios() });
    const meu = g.sessao.escritorioId ? await lerEscritorio(g.sessao.escritorioId) : null;
    return Response.json({ escritorios: meu ? [meu] : [] });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao ler.' }, { status: 502 });
  }
}
