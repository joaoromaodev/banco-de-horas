// Painel do contador — consultas (Postgres). Só leitura. Cada função recebe os
// ids das empresas que a sessão enxerga e o escritório (null = master/plataforma)
// e filtra por eles na própria consulta. Quem decide o acesso é a rota
// (exigirGestor + empresasVisiveis). Ver docs/painel.md.
import { getDb } from './db';

/** Teto por consulta: o painel mostra poucos itens; passou disso, o número é "pelo menos". */
export const TETO = 2000;

export interface Recorte {
  empresaIds: string[];
  /** null = master (a plataforma inteira). */
  escritorioId: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- linhas cruas do PostgREST
type Linha = any;

function lancar(e: { code?: string; message?: string }): never {
  throw Object.assign(new Error(e.message ?? 'falha no banco'), { code: e.code });
}

/** Documentos enviados e ainda não conferidos (`status = recebido`). */
export async function documentosAConferir(r: Recorte): Promise<{ linhas: { empresaId: string; enviadoEm: string }[]; truncado: boolean }> {
  if (!r.empresaIds.length) return { linhas: [], truncado: false };
  let q = getDb().from('documentos').select('empresa_id, enviado_em')
    .eq('status', 'recebido').is('excluido_em', null).in('empresa_id', r.empresaIds);
  if (r.escritorioId) q = q.eq('escritorio_id', r.escritorioId);
  const { data, error } = await q.limit(TETO);
  if (error) lancar(error);
  return {
    linhas: (data ?? []).map((l: Linha) => ({ empresaId: String(l.empresa_id), enviadoEm: String(l.enviado_em) })),
    truncado: (data?.length ?? 0) >= TETO,
  };
}

/** Pendências abertas com prazo até `ate` (inclui as já vencidas). */
export async function pendenciasComPrazo(r: Recorte, ate: string) {
  if (!r.empresaIds.length) return [];
  let q = getDb().from('pendencias').select('id, empresa_id, titulo, prazo, status')
    .eq('status', 'aberta').is('excluido_em', null).not('prazo', 'is', null).lte('prazo', ate)
    .in('empresa_id', r.empresaIds);
  if (r.escritorioId) q = q.eq('escritorio_id', r.escritorioId);
  const { data, error } = await q.order('prazo').limit(TETO);
  if (error) lancar(error);
  return (data ?? []).map((l: Linha) => ({
    id: String(l.id), empresaId: String(l.empresa_id), titulo: String(l.titulo), prazo: l.prazo as string | null, status: String(l.status),
  }));
}

/**
 * Lançamentos do caixa sem `conferido_em` (a fila da contadora — ver
 * app/api/caixa/atividade). Olha o ano corrente e o anterior.
 */
export async function lancamentosAConferir(r: Recorte, ano: number): Promise<{ linhas: { empresaId: string; criadoEm: string }[]; truncado: boolean }> {
  if (!r.empresaIds.length) return { linhas: [], truncado: false };
  const { data, error } = await getDb().from('lancamentos')
    .select('criado_em, exercicios!inner(empresa_id, ano)')
    .is('conferido_em', null).gte('exercicios.ano', ano - 1)
    .in('exercicios.empresa_id', r.empresaIds)
    .order('criado_em', { ascending: false }).limit(TETO);
  if (error) lancar(error);
  return {
    linhas: (data ?? []).map((l: Linha) => {
      const ex = Array.isArray(l.exercicios) ? l.exercicios[0] : l.exercicios;
      return { empresaId: String(ex.empresa_id), criadoEm: String(l.criado_em) };
    }),
    truncado: (data?.length ?? 0) >= TETO,
  };
}
