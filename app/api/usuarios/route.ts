// GET/POST/DELETE /api/usuarios — cadastro de usuários (somente master).
import { NextRequest } from 'next/server';
import { lerSessao, hashSenha, COOKIE_SESSAO } from '@/lib/auth';
import { lerUsuarios, salvarUsuario, removerUsuario } from '@/lib/sheets';

export const runtime = 'nodejs';

async function exigirMaster(req: NextRequest) {
  const s = await lerSessao(req.cookies.get(COOKIE_SESSAO)?.value);
  return s?.role === 'master' ? s : null;
}

export async function GET(req: NextRequest) {
  if (!(await exigirMaster(req))) return Response.json({ erro: 'Acesso negado.' }, { status: 403 });
  try {
    const users = (await lerUsuarios()).map((u) => ({ email: u.email, nome: u.nome, role: u.role }));
    return Response.json({ usuarios: users });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao ler.' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await exigirMaster(req))) return Response.json({ erro: 'Acesso negado.' }, { status: 403 });
  try {
    const body = await req.json();
    const email = String(body.email ?? '').trim().toLowerCase();
    const nome = String(body.nome ?? '').trim();
    const senha = String(body.senha ?? '');
    const role: 'master' | 'usuario' = body.role === 'master' ? 'master' : 'usuario';
    if (!email || !nome || senha.length < 4) {
      return Response.json({ erro: 'E-mail, nome e senha (mín. 4) são obrigatórios.' }, { status: 400 });
    }
    const { salt, hash } = await hashSenha(senha);
    await salvarUsuario({ email, nome, role, salt, hash });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao salvar.' }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await exigirMaster(req))) return Response.json({ erro: 'Acesso negado.' }, { status: 403 });
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get('email') ?? '';
    if (!email) return Response.json({ erro: 'E-mail não informado.' }, { status: 400 });
    await removerUsuario(email);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao remover.' }, { status: 502 });
  }
}
