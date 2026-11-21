// Cliente do Supabase (Postgres) — banco do módulo Livro Caixa.
//
// Só de servidor. Usa a *secret key*, que ignora RLS: a autorização é feita nas
// rotas de API por lib/acesso.ts, do mesmo jeito que a conta de serviço do
// Google já funciona no módulo de ponto. A publishable key nunca é usada aqui —
// as tabelas têm RLS ligada sem policies justamente para que ela não leia nada.
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let cliente: SupabaseClient | null = null;

export function getDb(): SupabaseClient {
  if (cliente) return cliente;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secret = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL não configurada.');
  if (!secret) throw new Error('SUPABASE_SECRET_KEY não configurada.');

  cliente = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cliente;
}

// ---------------------------------------------------------------- Leitura paginada
//
// O PostgREST do Supabase responde no máximo `max_rows` linhas (1000 por padrão)
// e **não avisa** quando corta: `.limit(2000)` volta 1000 sem erro, e um SELECT
// sem limite também. Toda leitura que pode passar disso usa estas funções.
//
// Regras para quem chama:
//  - a consulta precisa de uma ordem TOTAL (termine com `.order('id')` ou a chave
//    primária), senão linhas empatadas podem repetir ou sumir entre páginas;
//  - a função recebe `(de, ate)` e devolve a consulta já com `.range(de, ate)`.

/** Linhas por página — igual ao `max_rows` padrão do Supabase. */
export const PAGINA = 1000;
/** Teto de segurança de `lerTudo` (evita laço sem fim se algo estiver errado). */
export const MAX_LINHAS = 100_000;
/** Ids por `.in(...)`: a URL do PostgREST tem limite (~8 KB); 100 uuids ≈ 3,7 KB. */
export const LOTE_IN = 100;

interface RespostaPagina<T> {
  data: T[] | null;
  error: { message: string; code?: string } | null;
}

export interface OpcoesLeitura {
  /** Quantas linhas, no máximo (padrão `MAX_LINHAS`). */
  max?: number;
  /** Como transformar o erro do banco (padrão: `Error` com `code`). */
  falhar?: (e: { message: string; code?: string }) => Error;
}

/** Lê todas as páginas de uma consulta ordenada, até `max` linhas. */
export async function lerTudo<T>(
  consulta: (de: number, ate: number) => PromiseLike<RespostaPagina<T>>,
  opcoes: OpcoesLeitura = {},
): Promise<T[]> {
  const max = opcoes.max ?? MAX_LINHAS;
  const todas: T[] = [];
  for (let de = 0; de < max; de += PAGINA) {
    const ate = Math.min(de + PAGINA, max) - 1;
    const { data, error } = await consulta(de, ate);
    if (error) {
      throw opcoes.falhar ? opcoes.falhar(error) : Object.assign(new Error(error.message), { code: error.code });
    }
    todas.push(...(data ?? []));
    if (!data || data.length < ate - de + 1) break;
  }
  return todas;
}

/**
 * Lê até `teto` linhas e diz se havia mais (`truncado`). Para telas que mostram
 * "pelo menos N": lê uma a mais só para saber.
 */
export async function lerAteTeto<T>(
  consulta: (de: number, ate: number) => PromiseLike<RespostaPagina<T>>,
  teto: number,
  opcoes: Omit<OpcoesLeitura, 'max'> = {},
): Promise<{ linhas: T[]; truncado: boolean }> {
  const lidas = await lerTudo(consulta, { ...opcoes, max: teto + 1 });
  return { linhas: lidas.slice(0, teto), truncado: lidas.length > teto };
}

/**
 * Roda `fn` para cada lote de ids (em paralelo) e junta os resultados — para
 * `.in('coluna', ids)` com muitos ids, que estouraria o tamanho da URL.
 */
export async function emLotes<I, R>(
  ids: readonly I[],
  fn: (lote: I[]) => Promise<R[]>,
  tamanho: number = LOTE_IN,
): Promise<R[]> {
  if (ids.length === 0) return [];
  const lotes: I[][] = [];
  for (let i = 0; i < ids.length; i += tamanho) lotes.push(ids.slice(i, i + tamanho));
  return (await Promise.all(lotes.map(fn))).flat();
}
