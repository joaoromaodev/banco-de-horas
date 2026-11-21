// GET /api/config — situação da leitura por IA (só o master).
//
// Desde a Sprint 2 a chave do Gemini é da PLATAFORMA: vem só da variável de
// ambiente GEMINI_API_KEY (e o modelo, de GEMINI_MODELO). Não se guarda chave na
// planilha nem no banco, e nada a devolve — só se ela existe.
// POST deixou de existir: a troca de chave é feita no painel da Vercel.
import { NextRequest } from 'next/server';
import { exigirMaster } from '@/lib/acesso';
import { getGeminiApiKey, getGeminiModelo } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirMaster(req);
  if (!g.ok) return g.resposta;
  return Response.json({
    temChave: Boolean(getGeminiApiKey()),
    gemini_modelo: getGeminiModelo(),
    origem: 'plataforma',
  });
}

export async function POST(req: NextRequest) {
  const g = await exigirMaster(req);
  if (!g.ok) return g.resposta;
  return Response.json(
    { erro: 'A chave da leitura por IA agora é da plataforma: troque as variáveis GEMINI_API_KEY e GEMINI_MODELO na Vercel.' },
    { status: 410 },
  );
}
