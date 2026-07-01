// Gate de autenticação (HTTP Basic Auth) para todo o app.
// Credenciais em APP_USER / APP_PASSWORD. Sem elas configuradas, não bloqueia.
import { NextRequest, NextResponse } from 'next/server';

export function proxy(req: NextRequest) {
  const user = process.env.APP_USER;
  const pass = process.env.APP_PASSWORD;
  if (!user || !pass) return NextResponse.next();

  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Basic ')) {
    const decoded = atob(auth.slice(6));
    const i = decoded.indexOf(':');
    const u = decoded.slice(0, i);
    const p = decoded.slice(i + 1);
    if (u === user && p === pass) return NextResponse.next();
  }

  return new NextResponse('Autenticação necessária.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Banco de Horas", charset="UTF-8"' },
  });
}

export const config = {
  // protege tudo, menos assets estáticos do Next
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
