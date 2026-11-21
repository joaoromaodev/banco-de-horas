// GET /api/me — dados da sessão atual (para a UI).
import { NextRequest } from 'next/server';
import { resolverModulos } from '@/lib/auth';
import { sessaoDe } from '@/lib/acesso';
import { lerEscritorio } from '@/lib/escritorios';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const s = await sessaoDe(req);
  if (!s) return Response.json({ autenticado: false }, { status: 401 });
  // O escritório alimenta o aviso de fim do teste no layout. Falha de leitura
  // não derruba a sessão — só some o aviso.
  const escritorio = s.escritorioId ? await lerEscritorio(s.escritorioId).catch(() => null) : null;
  return Response.json({
    autenticado: true,
    email: s.email,
    nome: s.nome,
    role: s.role,
    empresa: s.empresa ?? null,
    // `resolverModulos` cobre sessões antigas (emitidas antes deste campo).
    modulos: resolverModulos(s.role, s.modulos),
    adminEscritorio: Boolean(s.adminEscritorio),
    escritorio: escritorio && {
      id: escritorio.id, nome: escritorio.nome, plano: escritorio.plano,
      situacao: escritorio.situacao, testeAte: escritorio.testeAte,
    },
  });
}
