// Montagem da sessão a partir do cadastro — usada pelo login e pelo cadastro
// self-service (/api/criar-conta), que já entra logado.
import { NextResponse } from 'next/server';
import { COOKIE_SESSAO, criarSessao, resolverModulos, Sessao } from './auth';
import type { UsuarioRec } from './cadastro';

/** O que vai no cookie: módulos já resolvidos (o proxy checa sem I/O), empresa só
 *  no `cliente`, escritório em todos menos no `master`. */
export function sessaoDoUsuario(u: UsuarioRec): Omit<Sessao, 'exp'> {
  return {
    email: u.email,
    nome: u.nome,
    role: u.role,
    modulos: resolverModulos(u.role, u.modulos),
    ...(u.role === 'cliente' ? { empresa: u.empresa ?? '' } : {}),
    ...(u.role !== 'master' && u.escritorioId ? { escritorioId: u.escritorioId } : {}),
    ...(u.role === 'usuario' && u.adminEscritorio ? { adminEscritorio: true } : {}),
  };
}

/** Assina a sessão e grava o cookie na resposta. */
export async function gravarSessao(res: NextResponse, sessao: Omit<Sessao, 'exp'>): Promise<NextResponse> {
  const token = await criarSessao(sessao);
  res.cookies.set(COOKIE_SESSAO, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return res;
}
