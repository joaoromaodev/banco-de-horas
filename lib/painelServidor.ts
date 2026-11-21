// Painel do contador — consultas (Postgres). Só leitura. Cada função recebe os
// ids das empresas que a sessão enxerga e o escritório (null = master/plataforma)
// e filtra por eles na própria consulta. Quem decide o acesso é a rota
// (exigirGestor + empresasVisiveis). Ver docs/painel.md.
import { emLotes, getDb, lerAteTeto } from './db';

/** Teto por consulta: o painel mostra poucos itens; passou disso, o número é "pelo menos".
 *  Lido por páginas de 1.000 (lib/db): um `.limit(2000)` solto voltava 1.000 sem avisar
 *  e o `truncado` nunca acendia. */
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

/**
 * Lê uma tabela por empresa do recorte: ids em lotes (a URL não estoura com
 * centenas de empresas) e páginas de 1.000, até `TETO` no total. `montar` recebe o
 * builder da tabela. Ordem total por `id` para a paginação não repetir linha.
 */
async function lerPorEmpresas<T>(
  r: Recorte,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- builder do PostgREST
  montar: (q: any) => any, tabela: string,
): Promise<{ linhas: T[]; truncado: boolean }> {
  const db = getDb();
  const partes = await emLotes(r.empresaIds, async (lote) => {
    const { linhas } = await lerAteTeto<T>((de, ate) => {
      let q = montar(db.from(tabela)).in('empresa_id', lote);
      if (r.escritorioId) q = q.eq('escritorio_id', r.escritorioId);
      return q.order('id').range(de, ate);
    }, TETO, { falhar: lancar });
    return linhas;
  });
  return { linhas: partes.slice(0, TETO), truncado: partes.length > TETO };
}

/** Documentos enviados e ainda não conferidos (`status = recebido`). */
export async function documentosAConferir(r: Recorte): Promise<{ linhas: { empresaId: string; enviadoEm: string }[]; truncado: boolean }> {
  if (!r.empresaIds.length) return { linhas: [], truncado: false };
  const { linhas, truncado } = await lerPorEmpresas<Linha>(r, (q) => q.select('id, empresa_id, enviado_em')
    .eq('status', 'recebido').is('excluido_em', null), 'documentos');
  return {
    linhas: linhas.map((l) => ({ empresaId: String(l.empresa_id), enviadoEm: String(l.enviado_em) })),
    truncado,
  };
}

/** Pendências abertas com prazo até `ate` (inclui as já vencidas). */
export async function pendenciasComPrazo(r: Recorte, ate: string) {
  if (!r.empresaIds.length) return [];
  const { linhas } = await lerPorEmpresas<Linha>(r, (q) => q.select('id, empresa_id, titulo, prazo, status')
    .eq('status', 'aberta').is('excluido_em', null).not('prazo', 'is', null).lte('prazo', ate), 'pendencias');
  return linhas.sort((a, b) => String(a.prazo).localeCompare(String(b.prazo))).slice(0, TETO).map((l: Linha) => ({
    id: String(l.id), empresaId: String(l.empresa_id), titulo: String(l.titulo), prazo: l.prazo as string | null, status: String(l.status),
  }));
}

/**
 * Lançamentos do caixa sem `conferido_em` (a fila da contadora — ver
 * app/api/caixa/atividade). Olha o ano corrente e o anterior.
 */
export async function lancamentosAConferir(r: Recorte, ano: number): Promise<{ linhas: { empresaId: string; criadoEm: string }[]; truncado: boolean }> {
  if (!r.empresaIds.length) return { linhas: [], truncado: false };
  const db = getDb();
  // Lotes de empresas (URL curta) × páginas de 1.000; junta e ordena do mais novo.
  const partes = await emLotes(r.empresaIds, async (lote) => (await lerAteTeto<Linha>((de, ate) => db.from('lancamentos')
    .select('id, criado_em, exercicios!inner(empresa_id, ano)')
    .is('conferido_em', null).gte('exercicios.ano', ano - 1)
    .in('exercicios.empresa_id', lote)
    .order('criado_em', { ascending: false }).order('id').range(de, ate), TETO, { falhar: lancar })).linhas);
  partes.sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
  return {
    linhas: partes.slice(0, TETO).map((l: Linha) => {
      const ex = Array.isArray(l.exercicios) ? l.exercicios[0] : l.exercicios;
      return { empresaId: String(ex.empresa_id), criadoEm: String(l.criado_em) };
    }),
    truncado: partes.length > TETO,
  };
}
