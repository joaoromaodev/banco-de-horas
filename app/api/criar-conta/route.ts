// POST /api/criar-conta — cadastro self-service (rota pública, ver PUBLICO no proxy).
//
// Cria o escritório em teste grátis (14 dias, defaults da tabela) e o primeiro
// usuário dele como administrador do escritório, com Livro Caixa e Folha de
// Ponto. Já devolve a sessão no cookie: a pessoa sai do formulário logada.
import { NextRequest, NextResponse } from 'next/server';
import { emailValido, hashSenha, SENHA_MIN } from '@/lib/auth';
import { buscarUsuario, criarUsuario, ErroEmailEmUso, UsuarioRec } from '@/lib/cadastro';
import { getMaster } from '@/lib/config';
import { criarEscritorio, removerEscritorio } from '@/lib/escritorios';
import { ipDe, Limitador } from '@/lib/limite';
import { gravarSessao, sessaoDoUsuario } from '@/lib/sessao';

export const runtime = 'nodejs';

// 5 tentativas por IP a cada 30 min — sobra para quem erra a senha, freia robô.
const limitador = new Limitador(5, 30 * 60 * 1000);

const erro = (msg: string, status = 400) => Response.json({ erro: msg }, { status });

export async function POST(req: NextRequest) {
  if (!limitador.tentar(ipDe(req.headers))) {
    return erro('Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.', 429);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return erro('Dados inválidos.');
  }
  const escritorio = String(body.escritorio ?? '').trim();
  const nome = String(body.nome ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const senha = String(body.senha ?? '');

  if (escritorio.length < 2 || escritorio.length > 120) return erro('Informe o nome do escritório.');
  if (nome.length < 2 || nome.length > 120) return erro('Informe o seu nome.');
  if (!emailValido(email)) return erro('Informe um e-mail válido.');
  if (senha.length < SENHA_MIN) return erro(`A senha precisa de ao menos ${SENHA_MIN} caracteres.`);
  if (senha.length > 200) return erro('Senha longa demais.');

  try {
    if (email === getMaster().email || (await buscarUsuario(email))) {
      return erro('Este e-mail já tem conta. Entre pela tela de login.', 409);
    }

    const esc = await criarEscritorio(escritorio);
    const { salt, hash } = await hashSenha(senha);
    const usuario: UsuarioRec = {
      email, nome, role: 'usuario', salt, hash, empresa: null,
      modulos: ['caixa', 'ponto'], dono: null,
      escritorioId: esc.id, adminEscritorio: true,
    };
    try {
      // INSERT (não upsert): uma corrida com o mesmo e-mail vira 409, nunca sobrescreve.
      await criarUsuario(usuario);
    } catch (e) {
      await removerEscritorio(esc.id).catch(() => {}); // não deixa escritório órfão
      throw e;
    }

    const res = NextResponse.json({ ok: true });
    return gravarSessao(res, sessaoDoUsuario(usuario));
  } catch (e) {
    if (e instanceof ErroEmailEmUso) return erro('Este e-mail já tem conta. Entre pela tela de login.', 409);
    // Rota pública: não expõe a mensagem do banco, só registra no log do servidor.
    console.error('[criar-conta]', e);
    return erro('Não foi possível criar a conta agora. Tente de novo em instantes.', 502);
  }
}
