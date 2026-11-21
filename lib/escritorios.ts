// Escritórios contábeis — o inquilino do SaaS (migração 0010).
//
// Só de servidor (secret key). Autorização fica em lib/acesso.ts.
import { getDb } from './db';
import type { SituacaoEscritorio } from './visibilidade';

/** Escritório da Edilce (cliente fundadora). Id fixo, criado pelo backfill da 0010. */
export const ESCRITORIO_FUNDADOR_ID = '00000000-0000-4000-8000-000000000001';

export type Plano = 'teste' | 'essencial' | 'escritorio' | 'ilimitado' | 'fundador';

export interface Escritorio {
  id: string;
  nome: string;
  cnpj: string | null;
  plano: Plano;
  testeAte: string | null;
  situacao: SituacaoEscritorio;
  criadoEm: string | null;
  /** Responsável técnico — padrão do Termo de Abertura (0017). */
  contabilistaNome: string;
  contabilistaCrc: string;
  /** Dia (1–28) sugerido como prazo dos pedidos mensais novos (0019). */
  prazoPedidosPadrao: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function linhaParaEscritorio(r: any): Escritorio {
  return {
    id: String(r.id),
    nome: String(r.nome ?? ''),
    cnpj: r.cnpj ? String(r.cnpj) : null,
    plano: (r.plano ?? 'teste') as Plano,
    testeAte: r.teste_ate ?? null,
    situacao: (['teste', 'ativo', 'suspenso'].includes(r.situacao) ? r.situacao : 'teste') as SituacaoEscritorio,
    criadoEm: r.criado_em ?? null,
    contabilistaNome: String(r.contabilista_nome ?? '').trim(),
    contabilistaCrc: String(r.contabilista_crc ?? '').trim(),
    // sem a 0019 a coluna não existe: vale o padrão de sempre
    prazoPedidosPadrao: Number.isInteger(r.prazo_pedidos_padrao) ? Number(r.prazo_pedidos_padrao) : 10,
  };
}

export async function lerEscritorio(id: string): Promise<Escritorio | null> {
  if (!id) return null;
  const { data, error } = await getDb().from('escritorios').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? linhaParaEscritorio(data) : null;
}

export async function lerEscritorios(): Promise<Escritorio[]> {
  const { data, error } = await getDb().from('escritorios').select('*').order('criado_em', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(linhaParaEscritorio);
}

/** Cria um escritório em teste (plano, situação e `teste_ate` vêm dos defaults do banco). */
export async function criarEscritorio(nome: string): Promise<Escritorio> {
  const { data, error } = await getDb().from('escritorios').insert({ nome: nome.trim() }).select('*').single();
  if (error) throw new Error(error.message);
  return linhaParaEscritorio(data);
}

/** Desfaz um cadastro que falhou no meio (só apaga escritório vazio — FK é restrict). */
export async function removerEscritorio(id: string): Promise<void> {
  const { error } = await getDb().from('escritorios').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
