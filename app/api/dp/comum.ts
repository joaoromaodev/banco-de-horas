// Peças comuns das rotas do Departamento Pessoal (/api/dp/*).
//
// Acesso: só a contabilidade. O `cliente` não alcança (fora de CLIENTE_PODE no
// proxy.ts) e o DP anda atrás do módulo `ponto` (ROTAS_PONTO). Cada rota resolve a
// empresa e o escritório por `exigirEmpresaPonto` — o escritório vem do cadastro da
// empresa, nunca do corpo. Rotas por id carregam o registro e conferem a empresa dele.
import { NextRequest } from 'next/server';
import { exigirGestor } from '@/lib/acesso';
import { exigirEmpresaPonto, type GuardaPonto } from '@/lib/pontoAcesso';
import { ErroBancoPendente, lerFeriados } from '@/lib/pontoDb';
import { ErroDp, lerEmpregado } from '@/lib/dpServidor';
import type { Empregado } from '@/lib/dp';
import { conjuntoFeriados } from '@/lib/ferias';

export function respostaErroDp(e: unknown, padrao = 'Falha no Departamento Pessoal.'): Response {
  if (e instanceof ErroDp) {
    return Response.json({ erro: e.message, ...(e.status === 503 ? { aguardandoBanco: true } : {}) }, { status: e.status });
  }
  if (e instanceof ErroBancoPendente) return Response.json({ erro: e.message, aguardandoBanco: true }, { status: 503 });
  console.error('[dp]', padrao, e instanceof Error ? e.message.slice(0, 160) : '');
  return Response.json({ erro: padrao }, { status: 502 });
}

/** Carrega o empregado e confere o acesso pela empresa dele. */
export async function exigirEmpregado(req: NextRequest, id: string | null | undefined):
  Promise<{ ok: true; guarda: Extract<GuardaPonto, { ok: true }>; empregado: Empregado } | { ok: false; resposta: Response }> {
  // Sem sessão de gestor, a guarda responde antes de qualquer leitura (não diz se o id existe).
  const g0 = await exigirGestor(req);
  if (!g0.ok) return g0;
  let e: Empregado | null;
  try { e = await lerEmpregado(String(id ?? '')); } catch (err) { return { ok: false, resposta: respostaErroDp(err) }; }
  if (!e) return { ok: false, resposta: Response.json({ erro: 'Empregado não encontrado.' }, { status: 404 }) };
  const g = await exigirEmpresaPonto(req, e.empresaId);
  if (!g.ok) return g;
  if (e.escritorioId !== g.escritorioId) return { ok: false, resposta: Response.json({ erro: 'Acesso restrito a esta empresa.' }, { status: 403 }) };
  return { ok: true, guarda: g, empregado: e };
}

/** Feriados do escritório (ponto) — sem a tabela, segue só com os legais. */
export async function feriadosDoEscritorio(escritorioId: string): Promise<string[]> {
  try {
    return (await lerFeriados(escritorioId)).map((f) => f.data);
  } catch {
    return [];
  }
}

export async function conjuntoDoEscritorio(escritorioId: string, hoje: string): Promise<Set<string>> {
  const ano = Number(hoje.slice(0, 4));
  return conjuntoFeriados([ano - 1, ano, ano + 1, ano + 2], await feriadosDoEscritorio(escritorioId));
}
