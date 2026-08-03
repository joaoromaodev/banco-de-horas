// GET/POST/DELETE /api/usuarios — cadastro de usuários.
//
// Dois donos, um endpoint:
//  - master governa todos os papéis (contador, cliente, outro master);
//  - contador (papel `usuario`) governa só os `cliente` (administradores das
//    empresas dele) que ele mesmo cadastrou — nunca cria contador/master.
// O papel `cliente` nem alcança esta rota (recorte no proxy).
import { NextRequest } from 'next/server';
import { hashSenha, Papel, Modulo, MODULOS, resolverModulos, Sessao } from '@/lib/auth';
import { exigirGestor } from '@/lib/acesso';
import { lerEmpresas, lerUsuarios, buscarUsuario, salvarUsuario, removerUsuario, UsuarioRec } from '@/lib/sheets';
import { Empresa } from '@/lib/tipos';

export const runtime = 'nodejs';

/** As empresas que este contador governa (dono ou legado sem dono). */
function empresasDoContador(email: string, empresas: Empresa[]): Set<string> {
  const e = email.toLowerCase();
  return new Set(empresas.filter((x) => !x.contador || x.contador === e).map((x) => x.id));
}

/**
 * Um contador enxerga/gerencia um `cliente` quando: ele é o dono registrado, ou
 * (legado, sem dono) é dono da empresa vinculada a esse cliente.
 */
function contadorGerenciaCliente(email: string, u: UsuarioRec, minhas: Set<string>): boolean {
  if (u.role !== 'cliente') return false;
  if (u.dono) return u.dono === email.toLowerCase();
  return Boolean(u.empresa) && minhas.has(u.empresa!);
}

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const todos = await lerUsuarios();
    let lista = todos;
    if (g.sessao.role === 'usuario') {
      // Contador só vê os administradores (cliente) das empresas dele.
      const minhas = empresasDoContador(g.sessao.email, await lerEmpresas());
      lista = todos.filter((u) => contadorGerenciaCliente(g.sessao.email, u, minhas));
    }
    // `modulos` volta já resolvido (o efetivo), para a tela mostrar o que vale de
    // fato — inclusive o legado (vazio = tudo) e o cliente (sempre só caixa).
    const users = lista.map((u) => ({
      email: u.email, nome: u.nome, role: u.role, empresa: u.empresa ?? null,
      modulos: resolverModulos(u.role, u.modulos), dono: u.dono ?? null,
    }));
    return Response.json({ usuarios: users });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao ler.' }, { status: 502 });
  }
}

/** Cadastro por um contador: só cria/atualiza `cliente` das empresas dele. */
async function postContador(sessao: Sessao, body: Record<string, unknown>) {
  const email = String(body.email ?? '').trim().toLowerCase();
  const nome = String(body.nome ?? '').trim();
  const senha = String(body.senha ?? '');
  const empresa = String(body.empresa ?? '').trim();
  if (!email || !nome || senha.length < 4) {
    return Response.json({ erro: 'E-mail, nome e senha (mín. 4) são obrigatórios.' }, { status: 400 });
  }
  const empresas = await lerEmpresas();
  const minhas = empresasDoContador(sessao.email, empresas);
  if (!empresa || !minhas.has(empresa)) {
    return Response.json({ erro: 'Escolha uma empresa sua para o administrador.' }, { status: 400 });
  }
  // Não deixa reivindicar um e-mail que já é de outra pessoa (contador/master ou
  // cliente de outro dono) — evita sequestro de conta por upsert.
  const existente = await buscarUsuario(email);
  if (existente && !contadorGerenciaCliente(sessao.email, existente, minhas)) {
    return Response.json({ erro: 'Este e-mail já pertence a outro usuário.' }, { status: 409 });
  }
  const { salt, hash } = await hashSenha(senha);
  await salvarUsuario({
    email, nome, role: 'cliente', salt, hash, empresa, modulos: [],
    dono: sessao.email.toLowerCase(),
  });
  return Response.json({ ok: true });
}

/** Cadastro pelo master: qualquer papel. */
async function postMaster(body: Record<string, unknown>) {
  const email = String(body.email ?? '').trim().toLowerCase();
  const nome = String(body.nome ?? '').trim();
  const senha = String(body.senha ?? '');
  const role: Papel = body.role === 'master' ? 'master' : body.role === 'cliente' ? 'cliente' : 'usuario';
  const empresa = String(body.empresa ?? '').trim();
  const modulos: Modulo[] = role === 'usuario'
    ? (Array.isArray(body.modulos) ? (body.modulos as unknown[]).filter((m): m is Modulo => (MODULOS as string[]).includes(m as string)) : [])
    : [];
  if (!email || !nome || senha.length < 4) {
    return Response.json({ erro: 'E-mail, nome e senha (mín. 4) são obrigatórios.' }, { status: 400 });
  }
  if (role === 'usuario' && modulos.length === 0) {
    return Response.json({ erro: 'Habilite ao menos um módulo (Folha de Ponto ou Livro Caixa).' }, { status: 400 });
  }
  let dono: string | null = null;
  if (role === 'cliente') {
    if (!empresa) return Response.json({ erro: 'Escolha a empresa do cliente.' }, { status: 400 });
    const emp = (await lerEmpresas()).find((e) => e.id === empresa);
    if (!emp) return Response.json({ erro: 'Empresa não encontrada.' }, { status: 400 });
    // Dá a titularidade ao contador dono da empresa (se houver), para ele também
    // gerenciar o administrador; senão fica só com o master (dono vazio).
    dono = emp.contador?.trim().toLowerCase() || null;
  }
  const { salt, hash } = await hashSenha(senha);
  await salvarUsuario({ email, nome, role, salt, hash, empresa: role === 'cliente' ? empresa : null, modulos, dono });
  return Response.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json();
    return g.sessao.role === 'master' ? postMaster(body) : postContador(g.sessao, body);
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao salvar.' }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const { searchParams } = new URL(req.url);
    const email = (searchParams.get('email') ?? '').trim().toLowerCase();
    if (!email) return Response.json({ erro: 'E-mail não informado.' }, { status: 400 });
    if (g.sessao.role === 'usuario') {
      // Contador só remove administradores (cliente) das empresas dele.
      const alvo = await buscarUsuario(email);
      const minhas = empresasDoContador(g.sessao.email, await lerEmpresas());
      if (!alvo || !contadorGerenciaCliente(g.sessao.email, alvo, minhas)) {
        return Response.json({ erro: 'Acesso restrito a este usuário.' }, { status: 403 });
      }
    }
    await removerUsuario(email);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao remover.' }, { status: 502 });
  }
}
