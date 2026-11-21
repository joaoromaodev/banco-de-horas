// Cadastro — empresas e usuários — no Supabase (Postgres).
//
// Migrado do Google Sheets (Fase 6). Estes dados vivem no mesmo banco do Livro
// Caixa; a Folha de Ponto veio para o Postgres na Sprint 2 (lib/pontoDb.ts).
//
// Autorização não é por RLS: as rotas usam a secret key (ignora RLS) e aplicam a
// checagem em lib/acesso.ts, igual ao resto do módulo caixa. Empresas e usuários
// pertencem a um escritório (`escritorio_id`, migração 0010) — `lerEmpresas` e
// `lerUsuarios` devolvem tudo; o recorte por escritório é de quem chama.
import { randomUUID } from 'crypto';
import { getDb } from './db';
import { Empresa } from './tipos';
import { Papel, Modulo, MODULOS } from './auth';
import { Jornada, JORNADA_PADRAO } from './calendario';
import { ESCRITORIO_FUNDADOR_ID } from './escritorios';
import { soAtivas } from './arquivamento';

// Id/empresa das linhas legadas (antes do multiempresa). A importação do ponto
// (lib/pontoImportacao.ts) resolve esse vínculo antigo para a empresa atual.
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
  /** E-mail de quem criou este `cliente` (informativo desde o multi-escritório). */
  dono?: string | null;
  /** Escritório contábil do usuário. Nulo só para `master` (administra a plataforma). */
  escritorioId?: string | null;
  /** Administrador do escritório: cadastra contadores e clientes dele. */
  adminEscritorio?: boolean;
}

/** E-mail já cadastrado (corrida no INSERT de `criarUsuario`). */
export class ErroEmailEmUso extends Error {
  constructor() { super('Este e-mail já está cadastrado.'); }
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
    identificaPagador: Boolean(r.identifica_pagador),
    trabalhaSabado: Boolean(r.trabalha_sabado),
    jornadaUtilMin: r.jornada_util_min ?? undefined,
    jornadaSabadoMin: r.jornada_sabado_min ?? undefined,
    ordem: r.ordem ?? null,
    contador: r.contador ? String(r.contador).trim().toLowerCase() : null,
    escritorioId: r.escritorio_id ? String(r.escritorio_id) : null,
    arquivadaEm: r.arquivada_em ? String(r.arquivada_em) : null,
    arquivadaPor: r.arquivada_por ? String(r.arquivada_por) : null,
    arquivadaMotivo: r.arquivada_motivo ? String(r.arquivada_motivo) : null,
  };
}

/**
 * Todas as empresas, **inclusive as arquivadas**. Só para quem precisa saber que
 * o id existe (checar dono antes de um upsert, reativar). Telas, painel, agenda e
 * cron usam `lerEmpresas`, que as esconde.
 */
export async function lerEmpresasComArquivadas(): Promise<Empresa[]> {
  if (cacheEmpresas && Date.now() - cacheEmpresas.em < TTL_EMPRESAS_MS) return cacheEmpresas.lista;
  const db = getDb();
  const { data, error } = await db.from('empresas').select('*').order('ordem', { ascending: true });
  if (error) throw new Error(error.message);
  const lista = (data ?? []).map(linhaParaEmpresa).filter((e) => e.nome);
  cacheEmpresas = { em: Date.now(), lista };
  return lista;
}

/** As empresas ativas (arquivadas ficam de fora de toda lista e guarda). */
export async function lerEmpresas(): Promise<Empresa[]> {
  return soAtivas(await lerEmpresasComArquivadas());
}

export async function lerEmpresa(id: string): Promise<Empresa | null> {
  return (await lerEmpresas()).find((e) => e.id === id) ?? null;
}

/**
 * Para onde vai um salvamento do cadastro de empresas:
 * - `{ escritorioId }` — as enviadas são gravadas naquele escritório;
 * - `'plataforma'` — o master: grava como veio (cada empresa mantém o
 *   `escritorioId` que trouxer).
 */
export type EscopoEmpresas = { escritorioId: string } | 'plataforma';

/**
 * Faz upsert das empresas enviadas (não remove nenhuma). Ids são imutáveis — mantém o existente e gera um novo
 * (uuid) para empresas sem id. Quem chama garante que nenhum id enviado é de
 * outro escritório (ver /api/empresas).
 */
export async function salvarEmpresas(lista: Empresa[], escopo: EscopoEmpresas): Promise<number> {
  const db = getDb();
  const escritorio = escopo === 'plataforma' ? null : escopo.escritorioId;
  const linhas = lista
    .filter((e) => e.nome?.trim())
    .map((e, i) => ({
      // O id legado de VAZ E VOUZELA só vale no escritório da Edilce.
      id: e.id?.trim()
        || (e.nome.trim() === EMPRESA_PADRAO && escritorio === ESCRITORIO_FUNDADOR_ID ? EMPRESA_PADRAO_ID : randomUUID()),
      nome: e.nome.trim(),
      tipo_pessoa: e.tipoPessoa === 'fisica' ? 'fisica' : 'juridica',
      cnpj: e.cnpj?.trim() || null,
      identifica_pagador: Boolean(e.identificaPagador),
      trabalha_sabado: Boolean(e.trabalhaSabado),
      jornada_util_min: e.jornadaUtilMin ?? null,
      jornada_sabado_min: e.jornadaSabadoMin ?? null,
      ordem: e.ordem ?? i + 1,
      contador: e.contador?.trim().toLowerCase() || null,
      escritorio_id: escritorio ?? e.escritorioId ?? null,
    }));

  // Nunca apaga: o que sumiu da lista NÃO é removido (excluir virou arquivar, ver
  // `arquivarEmpresa`). Colunas de arquivamento ficam fora do upsert, então
  // salvar não reativa nem arquiva nada.
  if (linhas.length) {
    const { error } = await db.from('empresas').upsert(linhas, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }
  cacheEmpresas = null; // cadastro mudou: força releitura
  return linhas.length;
}

/** Arquiva (`arquivada: true`) ou reativa uma empresa. Dados dela ficam intactos. */
export async function definirArquivamento(
  id: string, arquivada: boolean, por: string, motivo: string | null,
): Promise<void> {
  const { error } = await getDb().from('empresas').update(
    arquivada
      ? { arquivada_em: new Date().toISOString(), arquivada_por: por.toLowerCase(), arquivada_motivo: motivo }
      : { arquivada_em: null, arquivada_por: null, arquivada_motivo: null },
  ).eq('id', id);
  if (error) throw new Error(error.message);
  cacheEmpresas = null;
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
    escritorioId: r.escritorio_id ? String(r.escritorio_id) : null,
    adminEscritorio: Boolean(r.admin_escritorio),
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

function usuarioParaLinha(u: UsuarioRec) {
  return {
    email: u.email.trim().toLowerCase(),
    nome: u.nome,
    role: u.role,
    salt: u.salt,
    hash: u.hash,
    empresa: u.empresa ?? null,
    modulos: u.modulos ?? [],
    dono: u.dono ?? null,
    // master administra a plataforma: nunca tem escritório
    escritorio_id: u.role === 'master' ? null : u.escritorioId ?? null,
    admin_escritorio: u.role === 'usuario' && Boolean(u.adminEscritorio),
  };
}

/** Adiciona/atualiza um usuário (upsert por email). */
export async function salvarUsuario(u: UsuarioRec): Promise<void> {
  const { error } = await getDb().from('usuarios').upsert(usuarioParaLinha(u), { onConflict: 'email' });
  if (error) throw new Error(error.message);
}

/** Cria um usuário novo; e-mail já existente vira `ErroEmailEmUso` (nunca sobrescreve). */
export async function criarUsuario(u: UsuarioRec): Promise<void> {
  const { error } = await getDb().from('usuarios').insert(usuarioParaLinha(u));
  if (error) {
    if (error.code === '23505') throw new ErroEmailEmUso(); // unique_violation (PK email)
    throw new Error(error.message);
  }
}

export async function removerUsuario(email: string): Promise<void> {
  const db = getDb();
  const { error } = await db.from('usuarios').delete().eq('email', email.trim().toLowerCase());
  if (error) throw new Error(error.message);
}
