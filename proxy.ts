// Gate de sessão: exige login (cookie assinado) para tudo, exceto /login, /criar-conta e assets.
// Rotas de master (/configuracoes, /api/usuarios, /api/config) exigem role 'master'.
// O papel 'cliente' (administrativo da empresa) segue lista de permissão: só
// alcança o que estiver em CLIENTE_PODE — todo o resto é do gestor.
import { NextRequest, NextResponse } from 'next/server';
import { lerSessao, temModulo, COOKIE_SESSAO } from '@/lib/auth';
import { escritaBarrada } from '@/lib/cobranca';
import { barreiraSomenteLeitura } from '@/lib/acesso';
import { citaArquivada, ehEscritaDeDados, empresasCitadas, MENSAGEM_ARQUIVADA } from '@/lib/arquivamento';
import { lerEmpresasComArquivadas } from '@/lib/cadastro';
import { HOME_CLIENTE, HOME_CONTADOR, inicioDoPapel, ROTA_PONTO } from '@/lib/inicio';

// Site público + `/criar-conta` (cadastro self-service do escritório, teste grátis).
const PUBLICO = [
  '/login', '/api/login', '/api/logout',
  '/conheca', '/planos', '/termos', '/privacidade',
  '/criar-conta', '/api/criar-conta',
  // Webhook do gateway: sem sessão, autenticado pelo token no header (ver a rota).
  '/api/cobranca/webhook',
  // Cron da Vercel: sem cookie; cada rota exige `Authorization: Bearer CRON_SECRET`.
  '/api/cron',
];
// `/api/usuarios` NÃO entra aqui de propósito: ela agora atende master e contador
// e faz o recorte fino por papel/dono internamente (ver a rota). O `cliente` já é
// barrado por não constar em CLIENTE_PODE.
const SOMENTE_MASTER = ['/configuracoes', '/api/config'];
/** Único caminho do papel `cliente`. Negar por padrão: o que não está aqui, ele não vê.
 *  `/api/empresas` entra porque devolve só a empresa da própria sessão (ver lib/acesso). */
const CLIENTE_PODE = ['/caixa', '/api/caixa', '/api/me', '/api/logout', '/api/empresas', '/documentos', '/api/documentos', '/api/pendencias'];

/** Rotas do módulo Folha de Ponto (timesheet em `/ponto` + folhas em branco).
 *  `/` NÃO é mais do ponto: é só um redirecionamento por papel (ver lib/inicio). */
const ROTAS_PONTO = [
  ROTA_PONTO, '/folhas', '/ponto-cadastros',
  '/api/salvar', '/api/extrair', '/api/gerar', '/api/gerar-lote',
  '/api/folha', '/api/folha-lote', '/api/funcionarios', '/api/feriados', '/api/revisao-ponto',
  // Contrato de experiência: departamento pessoal, da mesma contadora do ponto.
  '/contratos', '/api/contratos',
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
    // Visitante na raiz vê o site público; qualquer outro caminho protegido pede login.
    url.pathname = pathname === '/' ? '/conheca' : '/login';
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // Raiz: sem tela própria — cada papel cai no seu início (contador/master → /painel,
  // cliente → /caixa). Links e favoritos antigos de `/` continuam funcionando.
  if (pathname === '/') {
    const url = req.nextUrl.clone();
    url.pathname = inicioDoPapel(sessao.role);
    url.search = '';
    return NextResponse.redirect(url);
  }

  const casaCom = (lista: string[]) =>
    lista.some((p) => pathname === p || pathname.startsWith(p + '/'));

  if (casaCom(SOMENTE_MASTER) && sessao.role !== 'master') {
    if (ehApi) return NextResponse.json({ erro: 'Acesso restrito ao administrador.' }, { status: 403 });
    const url = req.nextUrl.clone();
    url.pathname = inicioDoPapel(sessao.role);
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
      url.pathname = temModulo(sessao, 'caixa') ? '/caixa' : HOME_CONTADOR;
      return NextResponse.redirect(url);
    }
  }

  // Somente leitura (cobrança): teste vencido sem assinatura ou inadimplência
  // além da carência → toda escrita em /api/* vira 402, para qualquer papel do
  // escritório (inclusive o `cliente`). Leitura e exportação seguem livres;
  // login, logout e /api/cobranca também. Regra em lib/cobranca.ts.
  if (ehApi && escritaBarrada(req.method, pathname)) {
    const barreira = await barreiraSomenteLeitura(sessao);
    if (barreira) {
      return NextResponse.json({ erro: barreira.erro, codigo: barreira.codigo, motivo: barreira.motivo }, { status: barreira.status });
    }
  }

  // Empresa arquivada é só consulta: escrita que cita uma arquivada (`?empresa=` ou
  // corpo JSON) vira 409. Rotas que só acham a empresa pelo id do registro caem na
  // rede de segurança de `podeAcessarEmpresa` (lib/acesso.ts), que também nega.
  if (ehApi && ehEscritaDeDados(req.method, pathname)) {
    const ids = await empresasDaRequisicao(req);
    if (ids.length) {
      try {
        if (citaArquivada(ids, await lerEmpresasComArquivadas())) {
          return NextResponse.json({ erro: MENSAGEM_ARQUIVADA, codigo: 'empresa_arquivada' }, { status: 409 });
        }
      } catch { /* banco indisponível: a própria rota falha ao gravar */ }
    }
  }

  return NextResponse.next();
}

/** Empresas citadas na consulta e no corpo JSON (pequeno) da requisição. */
async function empresasDaRequisicao(req: NextRequest): Promise<string[]> {
  let corpo: unknown = null;
  const tipo = req.headers.get('content-type') ?? '';
  const tamanho = Number(req.headers.get('content-length') ?? '0');
  if (tipo.includes('application/json') && tamanho > 0 && tamanho <= 200_000) {
    try { corpo = await req.clone().json(); } catch { /* corpo inválido: a rota responde 400 */ }
  }
  return empresasCitadas(req.nextUrl.searchParams, corpo);
}

export const config = {
  // Exclui também os assets estáticos de imagem (logo-*.svg, favicon etc.): sem
  // isso o proxy redireciona a logo ao /login quando não há sessão, e ela não
  // carrega na própria tela de login. Rotas de API não têm extensão de arquivo,
  // então continuam passando pelo proxy normalmente.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
