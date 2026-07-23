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
