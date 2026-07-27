// GET /api/me — dados da sessão atual (para a UI).
import { NextRequest } from 'next/server';
import { lerSessao, resolverModulos, COOKIE_SESSAO } from '@/lib/auth';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const s = await lerSessao(req.cookies.get(COOKIE_SESSAO)?.value);
  if (!s) return Response.json({ autenticado: false }, { status: 401 });
  return Response.json({
    autenticado: true,
    email: s.email,
    nome: s.nome,
    role: s.role,
    empresa: s.empresa ?? null,
    // `resolverModulos` cobre sessões antigas (emitidas antes deste campo).
    modulos: resolverModulos(s.role, s.modulos),
  });
}
