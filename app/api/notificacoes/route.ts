// /api/notificacoes — o sino do topo (docs/notificacoes.md).
//
// GET  [?desde=ISO]                    → { disponivel, itens, naoLidas, persistido, indisponiveis }
//                                        `desde` só vale sem a migração 0027 (o navegador lembra).
// POST { acao: 'lida', chave }         → marca um item como lido.
// POST { acao: 'todas' }               → marca tudo como lido (a "última visita" passa a ser agora).
//
// Só a contabilidade de um escritório (`usuario`). O master não tem escritório e o
// `cliente` não alcança (fora de CLIENTE_PODE em proxy.ts). A leitura é por pessoa
// (e-mail da sessão); o escritório vem da sessão, nunca do corpo. Só leitura do que
// já existe, mais o `notificacoes` da 0027 — nada de dado pessoal na resposta.
import { NextRequest } from 'next/server';
import { temModulo } from '@/lib/auth';
import { empresasVisiveis, exigirGestor } from '@/lib/acesso';
import { hojeBelem } from '@/lib/agenda';
import { lerNotificacoes, marcarLidas } from '@/lib/notificacoesServidor';

export const runtime = 'nodejs';
const SEM_CACHE = { 'Cache-Control': 'no-store' };

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  const { sessao } = g;
  if (sessao.role !== 'usuario' || !sessao.escritorioId) {
    return Response.json({ disponivel: false, itens: [], naoLidas: 0, persistido: false, indisponiveis: [] }, { headers: SEM_CACHE });
  }
  try {
    const empresas = await empresasVisiveis(sessao);
    const desde = req.nextUrl.searchParams.get('desde') ?? '';
    const r = await lerNotificacoes({
      escritorioId: sessao.escritorioId, usuario: sessao.email,
      empresas: new Map(empresas.map((e) => [e.id, e.nome])),
      temPonto: temModulo(sessao, 'ponto'), temCaixa: temModulo(sessao, 'caixa'), hoje: hojeBelem(),
      vistoNoNavegador: /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(desde) && !Number.isNaN(Date.parse(desde)) ? desde : null,
    });
    return Response.json({ disponivel: true, ...r }, { headers: SEM_CACHE });
  } catch (e) {
    console.error('[notificacoes]', e instanceof Error ? e.message.slice(0, 120) : 'falha');
    return Response.json({ erro: 'Não foi possível carregar as notificações agora.' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  const { sessao } = g;
  if (sessao.role !== 'usuario' || !sessao.escritorioId) return Response.json({ erro: 'Sem escritório.' }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ erro: 'Corpo inválido.' }, { status: 400 }); }
  const acao = String(body.acao ?? '');
  if (acao === 'lida') {
    const chave = String(body.chave ?? '').trim();
    if (!chave || chave.length > 200) return Response.json({ erro: 'Item inválido.' }, { status: 400 });
    return Response.json({ persistido: await marcarLidas(sessao.escritorioId, sessao.email, chave) }, { headers: SEM_CACHE });
  }
  if (acao === 'todas') {
    return Response.json({ persistido: await marcarLidas(sessao.escritorioId, sessao.email) }, { headers: SEM_CACHE });
  }
  return Response.json({ erro: 'Ação inválida.' }, { status: 400 });
}
