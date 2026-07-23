// Guardas de autorização das rotas de API.
//
// O `proxy.ts` já barra quem não tem sessão e faz o recorte grosso por papel.
// Aqui fica a checagem fina — em especial "este usuário pode mexer NESTA
// empresa?" —, aplicada dentro de cada rota. Defesa em profundidade: uma rota
// nova que esqueça de chamar estas funções não vaza dados de outra empresa
// porque o `cliente` já não alcança as rotas de gestão.
import { NextRequest } from 'next/server';
import { COOKIE_SESSAO, lerSessao, Sessao } from './auth';

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

/** Empresas que a sessão alcança. `null` = todas. */
export function empresasPermitidas(s: Sessao): string[] | null {
  return ehGestor(s) ? null : [s.empresa ?? ''];
}

export function podeVerEmpresa(s: Sessao, empresaId: string): boolean {
  if (ehGestor(s)) return true;
  return Boolean(s.empresa) && s.empresa === empresaId;
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
  if (!podeVerEmpresa(sessao, empresaId)) return negar('Acesso restrito a esta empresa.', 403);
  return { ok: true, sessao };
}
