// Cadastro — empresas e usuários — no Supabase (Postgres).
//
// Migrado do Google Sheets (Fase 6). Estes dados vivem agora no mesmo banco do
// Livro Caixa; funcionários, feriados e config (Folha de Ponto) seguem no Sheets.
// As assinaturas e tipos são idênticos aos de antes — `lib/sheets.ts` reexporta
// estas funções, então os call sites (login, acesso, rotas, ponto) não mudam.
//
// Autorização não é por RLS: as rotas usam a secret key (ignora RLS) e aplicam a
// checagem em lib/acesso.ts, igual ao resto do módulo caixa.
import { randomUUID } from 'crypto';
import { getDb } from './db';
import { Empresa } from './tipos';
import { Papel, Modulo, MODULOS } from './auth';
import { Jornada, JORNADA_PADRAO } from './calendario';

// Id/empresa das linhas legadas (antes do multiempresa). Mantidos para a
// resolução de vínculos antigos em lib/sheets.ts (funcionários/frequências).
export const EMPRESA_PADRAO = 'VAZ E VOUZELA';
export const EMPRESA_PADRAO_ID = 'empresa-vaz-e-vouzela';

export interface UsuarioRec {
  email: string;
  nome: string;
  role: Papel;
  salt: string;
  hash: string;
  /** Id da empresa que o usuário enxerga. Só se aplica ao papel `cliente`. */
  empresa?: string | null;
  /** Módulos habilitados pelo master. Vazio = legado (ver `resolverModulos`). */
  modulos?: Modulo[];
  /** E-mail do contador que criou este `cliente` (escopo de gestão). */
  dono?: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------- Empresas
// Cache curto: a autorização por dono (lib/acesso) lê as empresas a cada request
// de contador e uma tela do caixa dispara várias rotas de uma vez. `salvarEmpresas`
// invalida na hora.
let cacheEmpresas: { em: number; lista: Empresa[] } | null = null;
const TTL_EMPRESAS_MS = 8_000;

function linhaParaEmpresa(r: any): Empresa {
  return {
    id: String(r.id ?? '').trim(),
    nome: String(r.nome ?? ''),
    tipoPessoa: r.tipo_pessoa === 'fisica' ? 'fisica' : 'juridica',
    cnpj: r.cnpj ? String(r.cnpj) : null,
    trabalhaSabado: Boolean(r.trabalha_sabado),
    jornadaUtilMin: r.jornada_util_min ?? undefined,
    jornadaSabadoMin: r.jornada_sabado_min ?? undefined,
    ordem: r.ordem ?? null,
    contador: r.contador ? String(r.contador).trim().toLowerCase() : null,
  };
}

export async function lerEmpresas(): Promise<Empresa[]> {
  if (cacheEmpresas && Date.now() - cacheEmpresas.em < TTL_EMPRESAS_MS) return cacheEmpresas.lista;
  const db = getDb();
  const { data, error } = await db.from('empresas').select('*').order('ordem', { ascending: true });
  if (error) throw new Error(error.message);
  const lista = (data ?? []).map(linhaParaEmpresa).filter((e) => e.nome);
  cacheEmpresas = { em: Date.now(), lista };
  return lista;
}

export async function lerEmpresa(id: string): Promise<Empresa | null> {
  return (await lerEmpresas()).find((e) => e.id === id) ?? null;
}

/**
 * Substitui o conjunto de empresas (mesma semântica de antes): faz upsert das
 * enviadas e remove as que sumiram da lista. Ids são imutáveis — mantém o
 * existente e gera um novo (uuid) para empresas sem id.
 */
export async function salvarEmpresas(lista: Empresa[]): Promise<number> {
  const db = getDb();
  const linhas = lista
    .filter((e) => e.nome?.trim())
    .map((e, i) => ({
      id: e.id?.trim() || (e.nome.trim() === EMPRESA_PADRAO ? EMPRESA_PADRAO_ID : randomUUID()),
      nome: e.nome.trim(),
      tipo_pessoa: e.tipoPessoa === 'fisica' ? 'fisica' : 'juridica',
      cnpj: e.cnpj?.trim() || null,
      trabalha_sabado: Boolean(e.trabalhaSabado),
      jornada_util_min: e.jornadaUtilMin ?? null,
      jornada_sabado_min: e.jornadaSabadoMin ?? null,
      ordem: e.ordem ?? i + 1,
      contador: e.contador?.trim().toLowerCase() || null,
    }));

  const manter = new Set(linhas.map((e) => e.id));
  // remove o que não veio na lista (equivale ao "reescrever tudo" do Sheets)
  const { data: existentes, error: eLer } = await db.from('empresas').select('id');
  if (eLer) throw new Error(eLer.message);
  const remover = (existentes ?? []).map((r: any) => String(r.id)).filter((id) => !manter.has(id));

  if (linhas.length) {
    const { error } = await db.from('empresas').upsert(linhas, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }
  if (remover.length) {
    const { error } = await db.from('empresas').delete().in('id', remover);
    if (error) throw new Error(error.message);
  }
  cacheEmpresas = null; // cadastro mudou: força releitura
  return linhas.length;
}

/** Jornada de uma empresa (por id; inclui "trabalha aos sábados"). */
export async function lerJornadaEmpresa(id: string): Promise<Jornada> {
  const e = await lerEmpresa(id);
  if (!e) return { ...JORNADA_PADRAO };
  return {
    utilMin: e.jornadaUtilMin ?? JORNADA_PADRAO.utilMin,
    sabadoMin: e.jornadaSabadoMin ?? JORNADA_PADRAO.sabadoMin,
    trabalhaSabado: e.trabalhaSabado,
  };
}

// ---------------------------------------------------------------- Usuários
function normalizaModulos(v: unknown): Modulo[] {
  const arr = Array.isArray(v) ? v : String(v ?? '').split(',');
  return arr.map((m) => String(m).trim()).filter((m): m is Modulo => (MODULOS as string[]).includes(m));
}

function linhaParaUsuario(r: any): UsuarioRec {
  return {
    email: String(r.email ?? '').toLowerCase(),
    nome: String(r.nome ?? ''),
    role: (r.role === 'master' ? 'master' : r.role === 'cliente' ? 'cliente' : 'usuario') as Papel,
    salt: String(r.salt ?? ''),
    hash: String(r.hash ?? ''),
    empresa: r.empresa ? String(r.empresa).trim() : null,
    modulos: normalizaModulos(r.modulos),
    dono: r.dono ? String(r.dono).trim().toLowerCase() : null,
  };
}

export async function lerUsuarios(): Promise<UsuarioRec[]> {
  const db = getDb();
  const { data, error } = await db.from('usuarios').select('*');
  if (error) throw new Error(error.message);
  return (data ?? []).map(linhaParaUsuario).filter((u) => u.email);
}

export async function buscarUsuario(email: string): Promise<UsuarioRec | null> {
  const alvo = email.trim().toLowerCase();
  const db = getDb();
  const { data, error } = await db.from('usuarios').select('*').eq('email', alvo).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? linhaParaUsuario(data) : null;
}

/** Adiciona/atualiza um usuário (upsert por email). */
export async function salvarUsuario(u: UsuarioRec): Promise<void> {
  const db = getDb();
  const linha = {
    email: u.email.trim().toLowerCase(),
    nome: u.nome,
    role: u.role,
    salt: u.salt,
    hash: u.hash,
    empresa: u.empresa ?? null,
    modulos: u.modulos ?? [],
    dono: u.dono ?? null,
  };
  const { error } = await db.from('usuarios').upsert(linha, { onConflict: 'email' });
  if (error) throw new Error(error.message);
}

export async function removerUsuario(email: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from('usuarios').delete().eq('email', email.trim().toLowerCase());
  if (error) throw new Error(error.message);
}
