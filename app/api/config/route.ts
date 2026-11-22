// GET /api/config — situação da leitura por IA (só o master): qual provedor está
// ativo (lib/ia/config), o modelo e, na Cloudflare, a cota de neurônios do dia.
//
// As credenciais da IA são da PLATAFORMA: vêm só das variáveis de ambiente
// (CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_AI_TOKEN ou GEMINI_API_KEY). Não se guarda
// chave na planilha nem no banco, e nada a devolve — só se existe.
// POST deixou de existir: a troca de chave é feita no painel da Vercel.
import { NextRequest } from 'next/server';
import { exigirMaster } from '@/lib/acesso';
import { situacaoIa } from '@/lib/ia/cota';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const g = await exigirMaster(req);
  if (!g.ok) return g.resposta;
  const ia = await situacaoIa();
  return Response.json({
    temChave: ia.configurado,
    gemini_modelo: ia.modelo,
    origem: 'plataforma',
    ia,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const g = await exigirMaster(req);
  if (!g.ok) return g.resposta;
  return Response.json(
    { erro: 'As credenciais da leitura por IA são da plataforma: troque as variáveis (IA_PROVEDOR, CLOUDFLARE_*, GEMINI_*) na Vercel.' },
    { status: 410 },
  );
}
