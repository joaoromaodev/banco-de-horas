// Guardas de autorização das rotas de API.
//
// O `proxy.ts` já barra quem não tem sessão e faz o recorte grosso por papel.
// Aqui fica a checagem fina — em especial "este usuário pode mexer NESTA
// empresa?" —, aplicada dentro de cada rota. Defesa em profundidade: uma rota
// nova que esqueça de chamar estas funções não vaza dados de outra empresa
// porque o `cliente` já não alcança as rotas de gestão.
//
// Multi-escritório: o inquilino é o escritório contábil. As regras puras estão
// em lib/visibilidade.ts; aqui elas ganham a sessão e o I/O.
import { NextRequest } from 'next/server';
import { COOKIE_SESSAO, lerSessao, Sessao } from './auth';
import { buscarUsuario, lerEmpresas, lerEmpresasComArquivadas } from './cadastro';
import { acessoAArquivada, ehEscritaDeDados, estaArquivada, soArquivadas } from './arquivamento';
import { empresaVisivel } from './visibilidade';
import { Empresa } from './tipos';
import { mensagemSomenteLeitura, type MotivoBloqueio } from './cobranca';
import { situacaoDoEscritorio } from './cobrancaServidor';

export type Guarda =
  | { ok: true; sessao: Sessao }
  | { ok: false; resposta: Response };

// Sessões emitidas antes do multi-escritório (cookie de até 12h) não carregam o
// escritório. Em vez de derrubar quem já estava logado (a Edilce e o NÉLIO),
// completamos do banco — com cache curto, porque uma tela dispara várias rotas.
const cacheVinculo = new Map<string, { em: number; escritorioId?: string; admin: boolean }>();
const TTL_VINCULO_MS = 60_000;

export async function completarEscritorio(s: Sessao): Promise<Sessao> {
  if (s.role === 'master' || s.escritorioId) return s;
  const chave = s.email.toLowerCase();
  let v = cacheVinculo.get(chave);
  if (!v || Date.now() - v.em > TTL_VINCULO_MS) {
    try {
      const u = await buscarUsuario(chave);
      v = { em: Date.now(), escritorioId: u?.escritorioId ?? undefined, admin: Boolean(u?.adminEscritorio) };
      cacheVinculo.set(chave, v);
    } catch {
      return s; // banco indisponível: segue sem escritório (não enxerga nada)
    }
  }
  return v.escritorioId ? { ...s, escritorioId: v.escritorioId, adminEscritorio: v.admin } : s;
}

export async function sessaoDe(req: NextRequest): Promise<Sessao | null> {
  const s = await lerSessao(req.cookies.get(COOKIE_SESSAO)?.value);
  if (!s) return null;
  // Marca (só em memória) se esta requisição grava dados: `podeAcessarEmpresa` usa
  // para deixar a empresa arquivada ser CONSULTADA, mas nunca alterada.
  const c = await completarEscritorio(s);
  return ehEscritaDeDados(req.method, req.nextUrl.pathname) ? { ...c, escrita: true } : c;
}

/** Master ou contador — a "contabilidade" (cadastros, ponto, conferência). */
export function ehGestor(s: Sessao | null | undefined): boolean {
  return s?.role === 'master' || s?.role === 'usuario';
}

/**
 * Visibilidade a partir do objeto empresa já carregado (sem I/O). Ver
 * `empresaVisivel` em lib/visibilidade.ts: master vê todas; contador, as do
 * escritório; cliente, só a vinculada (e do escritório dele).
 */
export function empresaVisivelPara(s: Sessao, e: Pick<Empresa, 'id' | 'escritorioId'>): boolean {
  return empresaVisivel(s, e);
}

/** As empresas que esta sessão enxerga. */
export async function empresasVisiveis(s: Sessao): Promise<Empresa[]> {
  return (await lerEmpresas()).filter((e) => empresaVisivelPara(s, e));
}

/** As empresas **arquivadas** que esta sessão enxerga (só a gestão usa: reativar). */
export async function empresasArquivadasVisiveis(s: Sessao): Promise<Empresa[]> {
  return soArquivadas(await lerEmpresasComArquivadas()).filter((e) => empresaVisivelPara(s, e));
}

/**
 * Mesma decisão, mas só com o id da empresa. O master resolve sem I/O; os
 * demais consultam o escritório da empresa (leitura cacheada em lib/cadastro).
 */
export async function podeAcessarEmpresa(s: Sessao, empresaId: string): Promise<boolean> {
  if (!empresaId?.trim()) return false;
  // Master em leitura resolve sem I/O.
  if (s.role === 'master' && !s.escrita) return true;
  if (s.role === 'cliente' && s.empresa !== empresaId) return false;
  // Inclui arquivadas: a contabilidade as consulta (só leitura); o resto é barrado aqui.
  const e = (await lerEmpresasComArquivadas()).find((x) => x.id === empresaId);
  if (!e) return s.role === 'master';
  if (estaArquivada(e) && !acessoAArquivada(s.role, Boolean(s.escrita))) return false;
  return s.role === 'master' || empresaVisivelPara(s, e);
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

/** Exige master ou contador — usado nos cadastros e no módulo de ponto. */
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

/** Exige o administrador do escritório (contador com `adminEscritorio`) — cobrança e equipe. */
export async function exigirAdminEscritorio(req: NextRequest, oQue = 'cuida da assinatura'): Promise<Guarda> {
  const sessao = await sessaoDe(req);
  if (!sessao) return negar('Não autenticado.', 401);
  if (sessao.role !== 'usuario' || !sessao.escritorioId) return negar('Acesso restrito ao escritório.', 403);
  if (!sessao.adminEscritorio) return negar(`Só o administrador do escritório ${oQue}.`, 403);
  // O cookie vale 12 h: confere no banco se ainda é admin DESTE escritório
  // (quem perdeu o papel não cancela nem troca o plano nesse intervalo).
  try {
    const u = await buscarUsuario(sessao.email.toLowerCase());
    if (!u || u.role !== 'usuario' || !u.adminEscritorio || u.escritorioId !== sessao.escritorioId) {
      return negar(`Só o administrador do escritório ${oQue}.`, 403);
    }
  } catch {
    return negar('Não foi possível conferir o acesso agora.', 503);
  }
  return { ok: true, sessao };
}

// ---------------------------------------------------------------- Somente leitura
export interface Barreira { status: 402; erro: string; codigo: 'somente_leitura'; motivo: MotivoBloqueio }

/**
 * Modo somente leitura (cobrança): o escritório da sessão está com o teste
 * vencido sem assinatura, inadimplente além da carência, cancelado depois do
 * período pago ou suspenso? Então a escrita é barrada com 402.
 *
 * Chamada pelo `proxy.ts` em toda escrita de `/api/*` (ver `escritaBarrada` em
 * lib/cobranca.ts para a lista do que fica livre) — por isso cobre todas as
 * rotas, inclusive as que vierem depois, e também o papel `cliente`, que herda
 * a situação do escritório da contabilidade dele. O `master` nunca é barrado.
 *
 * Banco indisponível sem situação em cache: deixa passar (a própria rota vai
 * falhar ao gravar; barrar aqui só trocaria um erro por outro).
 */
export async function barreiraSomenteLeitura(sessao: Sessao): Promise<Barreira | null> {
  if (sessao.role === 'master') return null;
  const s = await completarEscritorio(sessao);
  if (!s.escritorioId) return null; // sem escritório a sessão não alcança dado nenhum
  const situacao = await situacaoDoEscritorio(s.escritorioId);
  if (!situacao?.somenteLeitura) return null;
  return {
    status: 402,
    codigo: 'somente_leitura',
    motivo: situacao.motivo,
    erro: mensagemSomenteLeitura(situacao.motivo, s.role),
  };
}
