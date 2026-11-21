// GET /api/config/ambiente — "O que está desligado" (só o master).
//
// Diz, sem revelar valor nenhum, quais variáveis de ambiente da plataforma estão
// configuradas e o que cada uma destrava (lib/ambiente.ts). Guarda: `exigirMaster`
// (além do `/api/config` em SOMENTE_MASTER no proxy).
import { NextRequest } from 'next/server';
import { exigirMaster } from '@/lib/acesso';
import { resumoDoAmbiente, situacaoDoAmbiente } from '@/lib/ambiente';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const g = await exigirMaster(req);
  if (!g.ok) return g.resposta;
  const itens = situacaoDoAmbiente();
  return Response.json({ itens, resumo: resumoDoAmbiente(itens) }, { headers: { 'Cache-Control': 'no-store' } });
}
