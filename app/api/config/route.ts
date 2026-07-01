// GET/POST /api/config — configurações (chave Gemini, modelo).
// GET nunca devolve a chave em si, só se ela existe.
import { NextRequest } from 'next/server';
import { lerConfig, salvarConfig } from '@/lib/sheets';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const cfg = await lerConfig();
    return Response.json({
      temChave: Boolean(cfg['gemini_api_key']),
      gemini_modelo: cfg['gemini_modelo'] ?? '',
    });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao ler.' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const entradas: Record<string, string> = {};
    if (typeof body.gemini_api_key === 'string' && body.gemini_api_key.trim()) {
      entradas['gemini_api_key'] = body.gemini_api_key.trim();
    }
    if (typeof body.gemini_modelo === 'string') {
      entradas['gemini_modelo'] = body.gemini_modelo.trim();
    }
    await salvarConfig(entradas);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao salvar.' }, { status: 502 });
  }
}
