// Regras puras de multi-escritório: quem vê qual empresa, quem gerencia qual
// usuário e quando avisar do fim do teste. Sem I/O e sem imports de runtime —
// por isso dá para testar isoladamente (e o Vitest da Frente C pode cobrir).
//
// O inquilino é o ESCRITÓRIO contábil. `master` é o administrador da
// plataforma e enxerga tudo; `usuario` (contador) e `cliente` (empresa) só
// alcançam o que é do próprio escritório.
import type { Papel } from './auth';

/** O mínimo da sessão de que as regras precisam. */
export interface Quem {
  email: string;
  role: Papel;
  escritorioId?: string | null;
  adminEscritorio?: boolean;
  /** Só no papel `cliente`: a empresa vinculada. */
  empresa?: string | null;
}

export interface EmpresaRef { id: string; escritorioId?: string | null }

export interface UsuarioRef {
  email: string;
  role: Papel;
  escritorioId?: string | null;
  empresa?: string | null;
}

const mesmoEscritorio = (a?: string | null, b?: string | null) => Boolean(a) && a === b;

/**
 * - `master` vê todas.
 * - `usuario` vê as do próprio escritório (todas — o escritório é a unidade).
 * - `cliente` vê só a empresa vinculada, e só se ela for do escritório dele.
 * Empresa sem escritório (não deveria existir depois do backfill) só o master vê.
 */
export function empresaVisivel(q: Quem, e: EmpresaRef): boolean {
  if (q.role === 'master') return true;
  if (!mesmoEscritorio(q.escritorioId, e.escritorioId)) return false;
  if (q.role === 'usuario') return true;
  return Boolean(q.empresa) && q.empresa === e.id;
}

/**
 * Quem pode ver/editar/remover um usuário:
 * - `master` gerencia todos;
 * - o administrador do escritório gerencia contadores e clientes do escritório
 *   (nunca a si mesmo por esta via, nem um master);
 * - o contador comum gerencia só os `cliente` do escritório;
 * - `cliente` não gerencia ninguém.
 */
export function gerenciaUsuario(q: Quem, alvo: UsuarioRef): boolean {
  if (q.role === 'master') return true;
  if (q.role !== 'usuario') return false;
  if (alvo.role === 'master') return false;
  if (!mesmoEscritorio(q.escritorioId, alvo.escritorioId)) return false;
  if (alvo.email.toLowerCase() === q.email.toLowerCase()) return false;
  if (alvo.role === 'cliente') return true;
  return Boolean(q.adminEscritorio);
}

/** Que papéis esta sessão pode criar. */
export function papeisQueCria(q: Quem): Papel[] {
  if (q.role === 'master') return ['master', 'usuario', 'cliente'];
  if (q.role !== 'usuario' || !q.escritorioId) return [];
  return q.adminEscritorio ? ['usuario', 'cliente'] : ['cliente'];
}

// ---------------------------------------------------------------- Teste grátis
export type SituacaoEscritorio = 'teste' | 'ativo' | 'suspenso';

export interface EstadoTeste { situacao: SituacaoEscritorio; testeAte: string | null }

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Aviso de fim de teste: só para escritório em `teste`, quando faltam ≤ 3 dias
 * (contados em dias corridos, arredondando para cima: 1h restante = "1 dia") ou
 * quando já acabou. Devolve `null` quando não há o que avisar.
 */
export function avisoTeste(e: EstadoTeste | null | undefined, agora: number = Date.now()):
  { acabou: boolean; dias: number } | null {
  if (!e || e.situacao !== 'teste' || !e.testeAte) return null;
  const fim = Date.parse(e.testeAte);
  if (Number.isNaN(fim)) return null;
  const resta = fim - agora;
  if (resta <= 0) return { acabou: true, dias: 0 };
  const dias = Math.ceil(resta / DIA_MS);
  return dias <= 3 ? { acabou: false, dias } : null;
}
