// POST /api/login — valida credenciais e cria a sessão em cookie.
import { NextRequest, NextResponse } from 'next/server';
import { getMaster } from '@/lib/config';
import { criarSessao, conferirSenha, COOKIE_SESSAO } from '@/lib/auth';
import { buscarUsuario } from '@/lib/sheets';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let email = '';
  let senha = '';
  try {
    const body = await req.json();
    email = String(body.email ?? '').trim().toLowerCase();
    senha = String(body.senha ?? '');
  } catch {
    return Response.json({ erro: 'Dados inválidos.' }, { status: 400 });
  }
  if (!email || !senha) return Response.json({ erro: 'Informe e-mail e senha.' }, { status: 400 });

  const master = getMaster();
  let sessao: { email: string; nome: string; role: 'master' | 'usuario' } | null = null;

  if (email === master.email && senha === master.senha) {
    sessao = { email, nome: 'Administrador', role: 'master' };
  } else {
    try {
      const u = await buscarUsuario(email);
      if (u && u.salt && u.hash && (await conferirSenha(senha, u.salt, u.hash))) {
        sessao = { email: u.email, nome: u.nome, role: u.role };
      }
    } catch {
      // planilha indisponível — cai no erro de credenciais abaixo
    }
  }

  if (!sessao) return Response.json({ erro: 'E-mail ou senha incorretos.' }, { status: 401 });

  const token = await criarSessao(sessao);
  const res = NextResponse.json({ ok: true, nome: sessao.nome, role: sessao.role });
  res.cookies.set(COOKIE_SESSAO, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return res;
}
