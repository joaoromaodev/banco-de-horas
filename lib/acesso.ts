// Guardas de autorização das rotas de API.
//
// O `proxy.ts` já barra quem não tem sessão e faz o recorte grosso por papel.
// Aqui fica a checagem fina — em especial "este usuário pode mexer NESTA
// empresa?" —, aplicada dentro de cada rota. Defesa em profundidade: uma rota
// nova que esqueça de chamar estas funções não vaza dados de outra empresa
// porque o `cliente` já não alcança as rotas de gestão.
import { NextRequest } from 'next/server';
import { COOKIE_SESSAO, lerSessao, Sessao } from './auth';
import { lerEmpresa } from './sheets';
import { Empresa } from './tipos';

export type Guarda =
  | { ok: true; sessao: Sessao }
  | { ok: false; resposta: Response };

export async function sessaoDe(req: NextRequest): Promise<Sessao | null> {
  return lerSessao(req.cookies.get(COOKIE_SESSAO)?.value);
}

/** Administra o sistema e enxerga todas as empresas (master ou contadora). */
export function ehGestor(s: Sessao | null | undefined): boolean {
  return s?.role === 'master' || s?.role === 'usuario';
}

/**
 * Visibilidade a partir do objeto empresa já carregado (sem I/O).
 *
 * - `master` vê todas.
 * - `usuario` (contador) vê só as suas — as que têm o e-mail dele como dono, ou
 *   as ainda sem dono (legado), que ele reivindica ao salvar o cadastro.
 * - `cliente` vê só a empresa vinculada à sessão.
 */
export function empresaVisivelPara(s: Sessao, e: Pick<Empresa, 'id' | 'contador'>): boolean {
  if (s.role === 'master') return true;
  if (s.role === 'usuario') return !e.contador || e.contador === s.email.toLowerCase();
  return Boolean(s.empresa) && s.empresa === e.id;
}

/**
 * Mesma decisão, mas só com o id da empresa. `master`/`cliente` resolvem sem
 * tocar no Sheets; o contador precisa consultar o dono (leitura cacheada).
 */
export async function podeAcessarEmpresa(s: Sessao, empresaId: string): Promise<boolean> {
  if (!empresaId?.trim()) return false;
  if (s.role === 'master') return true;
  if (s.role === 'cliente') return s.empresa === empresaId;
  const e = await lerEmpresa(empresaId);
  return e ? empresaVisivelPara(s, e) : false;
}

function negar(msg: string, status: number): Guarda {
  return { ok: false, resposta: Response.json({ erro: msg }, { status }) };
}

/** Só exige sessão válida. */
export async function exigirSessao(req: NextRequest): Promise<Guarda> {
  const sessao = await sessaoDe(req);
  if (!sessao) return negar('Não autenticado.', 401);
  return { ok: true, sessao };
}

/** Exige master ou contadora — usado nos cadastros e no módulo de ponto. */
export async function exigirGestor(req: NextRequest): Promise<Guarda> {
  const sessao = await sessaoDe(req);
  if (!sessao) return negar('Não autenticado.', 401);
  if (!ehGestor(sessao)) return negar('Acesso restrito.', 403);
  return { ok: true, sessao };
}

export async function exigirMaster(req: NextRequest): Promise<Guarda> {
  const sessao = await sessaoDe(req);
  if (!sessao) return negar('Não autenticado.', 401);
  if (sessao.role !== 'master') return negar('Acesso restrito ao administrador.', 403);
  return { ok: true, sessao };
}

/** Exige sessão com acesso à empresa informada. */
export async function exigirEmpresa(req: NextRequest, empresaId: string): Promise<Guarda> {
  const sessao = await sessaoDe(req);
  if (!sessao) return negar('Não autenticado.', 401);
  if (!empresaId?.trim()) return negar('Informe a empresa.', 400);
  if (!(await podeAcessarEmpresa(sessao, empresaId))) return negar('Acesso restrito a esta empresa.', 403);
  return { ok: true, sessao };
}
