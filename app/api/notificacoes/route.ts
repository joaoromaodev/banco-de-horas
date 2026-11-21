// /api/notificacoes — o sino do topo (docs/notificacoes.md).
//
// GET  [?desde=ISO]                    → { disponivel, itens, naoLidas, persistido, indisponiveis }
//                                        `desde` só vale sem a migração 0027 (o navegador lembra).
// POST { acao: 'lida', chave }         → marca um item como lido.
// POST { acao: 'todas' }               → marca tudo como lido (a "última visita" passa a ser agora).
//
// Dois públicos, a mesma rota (o papel decide; nunca o corpo nem a query):
// - Contabilidade de um escritório (`usuario`, `exigirGestor`): o que os clientes
//   fizeram. O master não tem escritório e recebe `disponivel: false`.
// - Cliente (`exigirClienteDaEmpresa`, Sprint 13): avisos SÓ da empresa da sessão —
//   folha devolvida, pedido de documento, Demonstrativo pronto (lib/avisosCliente.ts).
//   `/api/notificacoes` está em CLIENTE_PODE (proxy.ts). Nada do cliente é gravado em
//   `notificacoes`, então a contabilidade não passa a ver estes avisos.
// A leitura é por pessoa; o escritório vem da sessão, nunca do corpo. Só leitura do que
// já existe, mais o `notificacoes`/`notificacoes_leitura` da 0027 — nada de dado pessoal
// na resposta.
import { NextRequest } from 'next/server';
import { temModulo } from '@/lib/auth';
import { empresasVisiveis, exigirClienteDaEmpresa, exigirGestor, sessaoDe } from '@/lib/acesso';
import { lerAvisosCliente, usuarioLeituraCliente } from '@/lib/avisosClienteServidor';
import { hojeBelem } from '@/lib/agenda';
import { lerNotificacoes, marcarLidas } from '@/lib/notificacoesServidor';

export const runtime = 'nodejs';
const SEM_CACHE = { 'Cache-Control': 'no-store' };

const vistoValido = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

/** O papel decide o ramo; cada ramo chama a própria guarda de lib/acesso.ts. */
async function ehCliente(req: NextRequest): Promise<boolean> {
  return (await sessaoDe(req))?.role === 'cliente';
}

async function getCliente(req: NextRequest) {
  const g = await exigirClienteDaEmpresa(req);
  if (!g.ok) return g.resposta;
  const { sessao, empresaId } = g;
  try {
    const r = await lerAvisosCliente({
      escritorioId: sessao.escritorioId!, empresaId: empresaId!, email: sessao.email,
      vistoNoNavegador: vistoValido(req.nextUrl.searchParams.get('desde')),
    });
    return Response.json({ disponivel: true, ...r }, { headers: SEM_CACHE });
  } catch (e) {
    console.error('[notificacoes] cliente', e instanceof Error ? e.message.slice(0, 120) : 'falha');
    return Response.json({ erro: 'Não foi possível carregar os avisos agora.' }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  if (await ehCliente(req)) return getCliente(req);
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  const { sessao } = g;
  if (sessao.role !== 'usuario' || !sessao.escritorioId) {
    return Response.json({ disponivel: false, itens: [], naoLidas: 0, persistido: false, indisponiveis: [] }, { headers: SEM_CACHE });
  }
  try {
    const empresas = await empresasVisiveis(sessao);
    const r = await lerNotificacoes({
      escritorioId: sessao.escritorioId, usuario: sessao.email,
      empresas: new Map(empresas.map((e) => [e.id, e.nome])),
      temPonto: temModulo(sessao, 'ponto'), temCaixa: temModulo(sessao, 'caixa'), hoje: hojeBelem(),
      vistoNoNavegador: vistoValido(req.nextUrl.searchParams.get('desde')),
    });
    return Response.json({ disponivel: true, ...r }, { headers: SEM_CACHE });
  } catch (e) {
    console.error('[notificacoes]', e instanceof Error ? e.message.slice(0, 120) : 'falha');
    return Response.json({ erro: 'Não foi possível carregar as notificações agora.' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  // Quem lê: o cliente grava a leitura dele (chave com a empresa da sessão); a contabilidade, pelo e-mail.
  let escritorioId: string;
  let usuario: string;
  if (await ehCliente(req)) {
    const c = await exigirClienteDaEmpresa(req);
    if (!c.ok) return c.resposta;
    escritorioId = c.sessao.escritorioId!;
    usuario = usuarioLeituraCliente(c.empresaId!, c.sessao.email);
  } else {
    const g = await exigirGestor(req);
    if (!g.ok) return g.resposta;
    const { sessao } = g;
    if (sessao.role !== 'usuario' || !sessao.escritorioId) return Response.json({ erro: 'Sem escritório.' }, { status: 403 });
    escritorioId = sessao.escritorioId;
    usuario = sessao.email;
  }
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ erro: 'Corpo inválido.' }, { status: 400 }); }
  const acao = String(body.acao ?? '');
  if (acao === 'lida') {
    const chave = String(body.chave ?? '').trim();
    if (!chave || chave.length > 200) return Response.json({ erro: 'Item inválido.' }, { status: 400 });
    return Response.json({ persistido: await marcarLidas(escritorioId, usuario, chave) }, { headers: SEM_CACHE });
  }
  if (acao === 'todas') {
    return Response.json({ persistido: await marcarLidas(escritorioId, usuario) }, { headers: SEM_CACHE });
  }
  return Response.json({ erro: 'Ação inválida.' }, { status: 400 });
}
