// Gate de sessão: exige login (cookie assinado) para tudo, exceto /login e assets.
// Rotas de master (/configuracoes, /api/usuarios) exigem role 'master'.
import { NextRequest, NextResponse } from 'next/server';
import { lerSessao, COOKIE_SESSAO } from '@/lib/auth';

const PUBLICO = ['/login', '/api/login', '/api/logout'];
const SOMENTE_MASTER = ['/configuracoes', '/api/usuarios'];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLICO.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const sessao = await lerSessao(req.cookies.get(COOKIE_SESSAO)?.value);
  const ehApi = pathname.startsWith('/api/');

  if (!sessao) {
    if (ehApi) return NextResponse.json({ erro: 'Não autenticado.' }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (SOMENTE_MASTER.some((p) => pathname === p || pathname.startsWith(p + '/')) && sessao.role !== 'master') {
    if (ehApi) return NextResponse.json({ erro: 'Acesso restrito ao administrador.' }, { status: 403 });
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
