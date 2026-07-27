// GET/POST/DELETE /api/usuarios — cadastro de usuários (somente master).
import { NextRequest } from 'next/server';
import { hashSenha, Papel, Modulo, MODULOS, resolverModulos } from '@/lib/auth';
import { exigirMaster } from '@/lib/acesso';
import { lerEmpresas, lerUsuarios, salvarUsuario, removerUsuario } from '@/lib/sheets';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirMaster(req);
  if (!g.ok) return g.resposta;
  try {
    // `modulos` volta já resolvido (o efetivo), para a tela mostrar o que vale de
    // fato — inclusive o legado (vazio = tudo) e o cliente (sempre só caixa).
    const users = (await lerUsuarios()).map((u) => ({
      email: u.email, nome: u.nome, role: u.role, empresa: u.empresa ?? null,
      modulos: resolverModulos(u.role, u.modulos),
    }));
    return Response.json({ usuarios: users });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao ler.' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const g = await exigirMaster(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json();
    const email = String(body.email ?? '').trim().toLowerCase();
    const nome = String(body.nome ?? '').trim();
    const senha = String(body.senha ?? '');
    const role: Papel = body.role === 'master' ? 'master' : body.role === 'cliente' ? 'cliente' : 'usuario';
    const empresa = String(body.empresa ?? '').trim();
    // Só o papel `usuario` (contador) tem módulos configuráveis; master tem tudo e
    // cliente é só caixa (resolvido no login), então aqui gravamos vazio para eles.
    const modulos: Modulo[] = role === 'usuario'
      ? (Array.isArray(body.modulos) ? body.modulos.filter((m: unknown): m is Modulo => (MODULOS as string[]).includes(m as string)) : [])
      : [];
    if (!email || !nome || senha.length < 4) {
      return Response.json({ erro: 'E-mail, nome e senha (mín. 4) são obrigatórios.' }, { status: 400 });
    }
    if (role === 'usuario' && modulos.length === 0) {
      return Response.json({ erro: 'Habilite ao menos um módulo (Folha de Ponto ou Livro Caixa).' }, { status: 400 });
    }
    if (role === 'cliente') {
      if (!empresa) return Response.json({ erro: 'Escolha a empresa do cliente.' }, { status: 400 });
      const existe = (await lerEmpresas()).some((e) => e.id === empresa);
      if (!existe) return Response.json({ erro: 'Empresa não encontrada.' }, { status: 400 });
    }
    const { salt, hash } = await hashSenha(senha);
    await salvarUsuario({ email, nome, role, salt, hash, empresa: role === 'cliente' ? empresa : null, modulos });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao salvar.' }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const g = await exigirMaster(req);
  if (!g.ok) return g.resposta;
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
