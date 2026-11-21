// GET /api/config/medicao — "Como o app está respondendo" (só o master).
//
// Resume a amostra dos últimos 7 dias (tabela `medicoes`, migração 0031): as 10
// rotas e telas mais lentas (p50/p95), os erros mais frequentes e o volume por
// tela. Sem a migração aplicada devolve `semTabela` (a tela explica). Guarda:
// `exigirMaster` (além do `/api/config` em SOMENTE_MASTER no proxy).
import { NextRequest } from 'next/server';
import { exigirMaster } from '@/lib/acesso';
import { lerResumo } from '@/lib/medicaoServidor';
import { TAXA_AMOSTRA } from '@/lib/medicao';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const g = await exigirMaster(req);
  if (!g.ok) return g.resposta;
  const semCache = { 'Cache-Control': 'no-store' };
  try {
    const r = await lerResumo(7);
    if (!r.ok) return Response.json({ semTabela: true, taxa: TAXA_AMOSTRA }, { headers: semCache });
    return Response.json({ ...r.resumo, truncado: r.truncado, dias: r.dias, taxa: TAXA_AMOSTRA }, { headers: semCache });
  } catch {
    return Response.json({ erro: 'Não foi possível ler a medição agora.' }, { status: 500, headers: semCache });
  }
}
