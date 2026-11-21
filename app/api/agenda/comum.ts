// Peças comuns das rotas da agenda (não é rota: só `route.ts` vira endpoint).
import type { Sessao } from '@/lib/auth';
import { motivoNegado } from '@/lib/acesso';
import { lerEmpresa } from '@/lib/cadastro';
import { ErroAgenda, Escopo, obrigacaoPorId } from '@/lib/agendaServidor';

export function falha(e: unknown) {
  if (e instanceof ErroAgenda) return Response.json({ erro: e.message }, { status: e.status });
  console.error('[agenda]', e);
  return Response.json({ erro: 'Falha ao processar a agenda.' }, { status: 502 });
}


/** Master vê a plataforma; contador, o próprio escritório; sem escritório, nada. */
export function escopoDe(s: Sessao): Escopo | null {
  if (s.role === 'master') return 'plataforma';
  return s.escritorioId ? { escritorioId: s.escritorioId } : null;
}

/**
 * Escritório de uma empresa que a sessão pode acessar. A obrigação herda o
 * escritório da EMPRESA (não da sessão): assim o master também grava no lugar certo.
 */
export async function escritorioDaEmpresa(s: Sessao, empresaId: string): Promise<string> {
  { const n = await motivoNegado(s, empresaId); if (n) throw new ErroAgenda(n.erro, n.status); }
  const e = await lerEmpresa(empresaId);
  if (!e?.escritorioId) throw new ErroAgenda('Empresa sem escritório vinculado.', 400);
  return e.escritorioId;
}

/** Carrega a obrigação e confere o acesso pela empresa dela (404 se não existe, 403 se é de outro). */
export async function obrigacaoAcessivel(s: Sessao, id: string, incluirExcluida = false) {
  const o = await obrigacaoPorId(id, incluirExcluida);
  if (!o) throw new ErroAgenda('Obrigação não encontrada.', 404);
  { const n = await motivoNegado(s, o.empresaId); if (n) throw new ErroAgenda(n.erro, n.status); }
  return o;
}
