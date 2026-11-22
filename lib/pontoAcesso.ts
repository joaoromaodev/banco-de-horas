// Guardas da Folha de Ponto: além de "pode mexer nesta empresa?" (lib/acesso.ts),
// resolvem DE QUAL ESCRITÓRIO são os dados — é por ele que lib/pontoDb.ts filtra.
//
// O escritório vem sempre do cadastro da empresa (nunca do corpo da requisição).
// Para contador, ele tem de ser o mesmo da sessão (empresaVisivel já garante; aqui
// conferimos de novo, de graça). O master não tem escritório: usa o da empresa.
import { NextRequest } from 'next/server';
import { exigirGestor, motivoNegado, podeAcessarEmpresa } from './acesso';
import type { Sessao } from './auth';
import { lerEmpresa } from './cadastro';
import type { Empresa } from './tipos';
import { ErroBancoPendente, ErroMesFechado } from './pontoDb';

export type GuardaPonto =
  | { ok: true; sessao: Sessao; empresa: Empresa; escritorioId: string }
  | { ok: false; resposta: Response };

const negar = (erro: string, status: number): GuardaPonto =>
  ({ ok: false, resposta: Response.json({ erro }, { status }) });

/** Escritório dono da empresa, se a sessão puder acessá-la. */
export async function escritorioDaEmpresa(sessao: Sessao, empresaId: string): Promise<{ empresa: Empresa; escritorioId: string } | null> {
  if (!(await podeAcessarEmpresa(sessao, empresaId))) return null;
  const empresa = await lerEmpresa(empresaId);
  const escritorioId = empresa?.escritorioId ?? null;
  if (!empresa || !escritorioId) return null; // empresa sem escritório: falha fechada
  if (sessao.role !== 'master' && sessao.escritorioId !== escritorioId) return null;
  return { empresa, escritorioId };
}

/** Gestor (master/contador) com acesso à empresa; devolve o escritório dela. */
export async function exigirEmpresaPonto(req: NextRequest, empresaId: string | null | undefined): Promise<GuardaPonto> {
  const g = await exigirGestor(req);
  if (!g.ok) return g;
  const id = String(empresaId ?? '').trim();
  if (!id) return negar('Informe a empresa.', 400);
  // Empresa arquivada + gravação: 409 com a mensagem de reativar (não o 403 genérico).
  const n = await motivoNegado(g.sessao, id);
  if (n) return negar(n.erro, n.status);
  const r = await escritorioDaEmpresa(g.sessao, id);
  if (!r) return negar('Acesso restrito a esta empresa.', 403);
  return { ok: true, sessao: g.sessao, ...r };
}

/**
 * Resposta padrão de erro das rotas do ponto. Banco sem a 0012 → 503 com
 * `aguardandoBanco` (a tela mostra o aviso); o resto → 502 com mensagem genérica
 * (o detalhe do banco vai só para o log do servidor).
 */
export function respostaErroPonto(e: unknown, padrao: string): Response {
  if (e instanceof ErroBancoPendente) {
    return Response.json({ erro: e.message, aguardandoBanco: true }, { status: 503 });
  }
  // Mês fechado (0034): a mensagem é para quem usa, não detalhe do banco.
  if (e instanceof ErroMesFechado) return Response.json({ erro: e.message, mesFechado: true }, { status: 409 });
  console.error(`[ponto] ${padrao}`, e);
  return Response.json({ erro: padrao }, { status: 502 });
}
