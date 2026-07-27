// Gate de sessão: exige login (cookie assinado) para tudo, exceto /login e assets.
// Rotas de master (/configuracoes, /api/usuarios, /api/config) exigem role 'master'.
// O papel 'cliente' (administrativo da empresa) segue lista de permissão: só
// alcança o que estiver em CLIENTE_PODE — todo o resto é do gestor.
import { NextRequest, NextResponse } from 'next/server';
import { lerSessao, temModulo, COOKIE_SESSAO } from '@/lib/auth';

const PUBLICO = ['/login', '/api/login', '/api/logout'];
const SOMENTE_MASTER = ['/configuracoes', '/api/usuarios', '/api/config'];
/** Único caminho do papel `cliente`. Negar por padrão: o que não está aqui, ele não vê.
 *  `/api/empresas` entra porque devolve só a empresa da própria sessão (ver lib/acesso). */
const CLIENTE_PODE = ['/caixa', '/api/caixa', '/api/me', '/api/logout', '/api/empresas'];
/** Para onde o cliente é mandado quando tenta alcançar área de gestão. */
const HOME_CLIENTE = '/caixa';

/** Rotas do módulo Folha de Ponto (timesheet + folhas em branco). `/` é o
 *  timesheet: casa só na raiz exata, não vira prefixo de tudo. */
const ROTAS_PONTO = [
  '/', '/folhas',
  '/api/salvar', '/api/extrair', '/api/gerar', '/api/gerar-lote',
  '/api/folha', '/api/folha-lote', '/api/funcionarios', '/api/feriados',
];
/** Rotas do módulo Livro Caixa. */
const ROTAS_CAIXA = ['/caixa', '/api/caixa'];

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

  const casaCom = (lista: string[]) =>
    lista.some((p) => pathname === p || pathname.startsWith(p + '/'));

  if (casaCom(SOMENTE_MASTER) && sessao.role !== 'master') {
    if (ehApi) return NextResponse.json({ erro: 'Acesso restrito ao administrador.' }, { status: 403 });
    const url = req.nextUrl.clone();
    url.pathname = sessao.role === 'cliente' ? HOME_CLIENTE : '/';
    return NextResponse.redirect(url);
  }

  if (sessao.role === 'cliente' && !casaCom(CLIENTE_PODE)) {
    if (ehApi) return NextResponse.json({ erro: 'Acesso restrito.' }, { status: 403 });
    const url = req.nextUrl.clone();
    url.pathname = HOME_CLIENTE;
    return NextResponse.redirect(url);
  }

  // Feature gating por módulo (só para gestores; o cliente já foi recortado acima,
  // e o master tem todos os módulos). Um contador só-caixa não alcança a folha de
  // ponto, e vice-versa. `/cadastros` e `/api/empresas` são compartilhados e ficam
  // de fora das duas listas de propósito.
  if (sessao.role === 'usuario') {
    const semPonto = casaCom(ROTAS_PONTO) && !temModulo(sessao, 'ponto');
    const semCaixa = casaCom(ROTAS_CAIXA) && !temModulo(sessao, 'caixa');
    if (semPonto || semCaixa) {
      if (ehApi) return NextResponse.json({ erro: 'Módulo não habilitado.' }, { status: 403 });
      const url = req.nextUrl.clone();
      url.pathname = temModulo(sessao, 'caixa') ? '/caixa' : '/';
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
