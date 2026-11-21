// GET/POST/DELETE /api/usuarios — cadastro de usuários.
//
// Multi-escritório — três níveis, um endpoint (regras em lib/visibilidade.ts):
//  - master (plataforma) governa todos os papéis, de qualquer escritório;
//  - o administrador do escritório governa os contadores e os clientes dele;
//  - o contador comum governa só os `cliente` (administradores das empresas) do
//    escritório — nunca cria contador/master.
// O papel `cliente` nem alcança esta rota (recorte no proxy).
//
// Excluir devolve uma ficha cifrada (`desfazer`) que, enviada de volta em
// POST { restaurar }, recria o usuário com a mesma senha (lib/restauracao.ts).
import { NextRequest } from 'next/server';
import { emailValido, hashSenha, Modulo, MODULOS, Papel, resolverModulos, SENHA_MIN, Sessao } from '@/lib/auth';
import { exigirGestor, podeAcessarEmpresa } from '@/lib/acesso';
import {
  buscarUsuario, criarUsuario, ErroEmailEmUso, lerEmpresa, lerUsuarios, removerUsuario, salvarUsuario,
} from '@/lib/cadastro';
import { lerEscritorio } from '@/lib/escritorios';
import { abrirUsuario, selarUsuario } from '@/lib/restauracao';
import { gerenciaUsuario, papeisQueCria } from '@/lib/visibilidade';

export const runtime = 'nodejs';

const erro = (msg: string, status = 400) => Response.json({ erro: msg }, { status });

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const eu = g.sessao.email.toLowerCase();
    // O próprio usuário entra na lista (a tela de Equipe o mostra como "você").
    const lista = (await lerUsuarios()).filter((u) => gerenciaUsuario(g.sessao, u) || u.email === eu);
    // `modulos` volta já resolvido (o efetivo), para a tela mostrar o que vale de
    // fato — inclusive o legado (vazio = tudo) e o cliente (sempre só caixa).
    const usuarios = lista.map((u) => ({
      email: u.email, nome: u.nome, role: u.role, empresa: u.empresa ?? null,
      modulos: resolverModulos(u.role, u.modulos), dono: u.dono ?? null,
      escritorioId: u.escritorioId ?? null, adminEscritorio: Boolean(u.adminEscritorio),
    }));
    return Response.json({ usuarios });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao ler.' }, { status: 502 });
  }
}

/** Módulos pedidos, limitados ao que existe e — fora o master — ao que quem cria tem. */
function modulosPedidos(sessao: Sessao, bruto: unknown): Modulo[] {
  const pedidos = Array.isArray(bruto) ? bruto.filter((m): m is Modulo => (MODULOS as unknown[]).includes(m)) : [];
  if (sessao.role === 'master') return [...new Set(pedidos)];
  const meus = resolverModulos(sessao.role, sessao.modulos);
  return [...new Set(pedidos)].filter((m) => meus.includes(m));
}

async function cadastrar(sessao: Sessao, body: Record<string, unknown>) {
  const email = String(body.email ?? '').trim().toLowerCase();
  const nome = String(body.nome ?? '').trim();
  const senha = String(body.senha ?? '');
  const role: Papel = body.role === 'master' ? 'master' : body.role === 'cliente' ? 'cliente' : 'usuario';

  if (!emailValido(email) || !nome) return erro('Informe nome e um e-mail válido.');
  if (senha.length < SENHA_MIN) return erro(`A senha precisa de ao menos ${SENHA_MIN} caracteres.`);
  if (!papeisQueCria(sessao).includes(role)) {
    return erro(role === 'usuario'
      ? 'Só o administrador do escritório cadastra contadores.'
      : 'Você não pode cadastrar este tipo de usuário.', 403);
  }

  // Onde o usuário novo mora.
  let escritorioId: string | null = null;
  let empresa: string | null = null;
  let modulos: Modulo[] = [];
  if (role === 'cliente') {
    empresa = String(body.empresa ?? '').trim();
    if (!empresa) return erro('Escolha a empresa do administrador.');
    const emp = await lerEmpresa(empresa);
    if (!emp || !(await podeAcessarEmpresa(sessao, empresa))) return erro('Escolha uma empresa do seu escritório.');
    if (!emp.escritorioId) return erro('Esta empresa não está vinculada a um escritório.');
    escritorioId = emp.escritorioId;
  } else if (role === 'usuario') {
    escritorioId = sessao.role === 'master' ? String(body.escritorioId ?? '').trim() : sessao.escritorioId ?? '';
    if (!escritorioId || !(await lerEscritorio(escritorioId))) return erro('Escolha o escritório do contador.');
    modulos = modulosPedidos(sessao, body.modulos);
    if (modulos.length === 0) return erro('Habilite ao menos um módulo (Folha de Ponto ou Livro Caixa).');
  }

  // E-mail já existente: só atualiza quem esta sessão gerencia, e sem trocar o
  // papel (um upsert cego permitiria sequestrar a conta de outra pessoa).
  const existente = await buscarUsuario(email);
  if (existente && (!gerenciaUsuario(sessao, existente) || existente.role !== role)) {
    return erro('Este e-mail já pertence a outro usuário.', 409);
  }

  // O primeiro contador de um escritório é o administrador dele.
  let adminEscritorio = Boolean(existente?.adminEscritorio);
  if (!existente && role === 'usuario') {
    adminEscritorio = !(await lerUsuarios()).some((u) => u.role === 'usuario' && u.escritorioId === escritorioId);
  }

  const { salt, hash } = await hashSenha(senha);
  await salvarUsuario({
    email, nome, role, salt, hash, empresa, modulos, escritorioId, adminEscritorio,
    dono: existente?.dono ?? sessao.email.toLowerCase(),
  });
  return Response.json({ ok: true });
}

/** Desfazer de uma exclusão: recria o usuário a partir da ficha cifrada. */
async function restaurar(sessao: Sessao, ficha: unknown) {
  const u = await abrirUsuario(String(ficha ?? ''));
  if (!u) return erro('Não foi possível desfazer: a ficha venceu ou é inválida.', 410);
  if (!gerenciaUsuario(sessao, u)) return erro('Acesso restrito a este usuário.', 403);
  if (u.role === 'cliente' && (!u.empresa || !(await podeAcessarEmpresa(sessao, u.empresa)))) {
    return erro('A empresa deste administrador não existe mais.', 409);
  }
  await criarUsuario(u);
  return Response.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json();
    // await aqui é essencial: sem ele, um erro do banco dentro do helper escaparia
    // do try/catch (500 vazio → "Unexpected end of JSON input" no cliente).
    if (body?.restaurar) return await restaurar(g.sessao, body.restaurar);
    return await cadastrar(g.sessao, body ?? {});
  } catch (e) {
    if (e instanceof ErroEmailEmUso) return erro('Este e-mail já foi cadastrado de novo — não dá para desfazer.', 409);
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao salvar.' }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const email = (req.nextUrl.searchParams.get('email') ?? '').trim().toLowerCase();
    if (!email) return erro('E-mail não informado.');
    const alvo = await buscarUsuario(email);
    if (!alvo) return erro('Usuário não encontrado.', 404);
    if (!gerenciaUsuario(g.sessao, alvo)) return erro('Acesso restrito a este usuário.', 403);
    const desfazer = await selarUsuario(alvo);
    await removerUsuario(email);
    return Response.json({ ok: true, desfazer });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao remover.' }, { status: 502 });
  }
}
