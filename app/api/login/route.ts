// POST /api/login — valida credenciais e cria a sessão em cookie.
import { NextRequest, NextResponse } from 'next/server';
import { getMaster } from '@/lib/config';
import { conferirSenha, Sessao, resolverModulos } from '@/lib/auth';
import { buscarUsuario } from '@/lib/cadastro';
import { gravarSessao, sessaoDoUsuario } from '@/lib/sessao';

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
  let sessao: Omit<Sessao, 'exp'> | null = null;

  if (email === master.email && senha === master.senha) {
    sessao = { email, nome: 'Administrador', role: 'master', modulos: resolverModulos('master') };
  } else {
    try {
      const u = await buscarUsuario(email);
      if (u && u.salt && u.hash && (await conferirSenha(senha, u.salt, u.hash))) {
        // Empresa (cliente), escritório (todos menos master) e módulos entram na
        // sessão para o proxy e as guardas decidirem sem I/O.
        sessao = sessaoDoUsuario(u);
      }
    } catch {
      // banco indisponível — cai no erro de credenciais abaixo
    }
  }

  if (!sessao) return Response.json({ erro: 'E-mail ou senha incorretos.' }, { status: 401 });
  // Cliente sem empresa vinculada não enxergaria nada: barra no login, com motivo claro.
  if (sessao.role === 'cliente' && !sessao.empresa) {
    return Response.json({ erro: 'Usuário sem empresa vinculada. Procure o administrador.' }, { status: 403 });
  }
  // Contador/cliente sem escritório também não enxergaria nada (só acontece se a
  // migração 0010 não tiver rodado ou o cadastro estiver incompleto).
  if (sessao.role !== 'master' && !sessao.escritorioId) {
    return Response.json({ erro: 'Usuário sem escritório vinculado. Procure o administrador.' }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true, nome: sessao.nome, role: sessao.role });
  return gravarSessao(res, sessao);
}
