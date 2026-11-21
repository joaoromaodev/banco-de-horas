// GET/POST /api/feriados?empresa=<id> — feriados do ESCRITÓRIO (Postgres, 0012).
//
// Cada escritório tem a sua lista (antes era uma só, global, na planilha). O
// escritório vem da empresa informada; sem empresa, do contador logado. O master
// não tem escritório: precisa informar a empresa.
import { NextRequest } from 'next/server';
import { exigirGestor } from '@/lib/acesso';
import { exigirEmpresaPonto, respostaErroPonto } from '@/lib/pontoAcesso';
import { lerFeriados, salvarFeriados, Feriado } from '@/lib/pontoDb';

export const runtime = 'nodejs';

type Alvo = { ok: true; escritorioId: string } | { ok: false; resposta: Response };

async function escritorioAlvo(req: NextRequest, empresa: string | null | undefined): Promise<Alvo> {
  if (empresa) {
    const g = await exigirEmpresaPonto(req, empresa);
    return g.ok ? { ok: true, escritorioId: g.escritorioId } : g;
  }
  const g = await exigirGestor(req);
  if (!g.ok) return g;
  if (!g.sessao.escritorioId) {
    return { ok: false, resposta: Response.json({ erro: 'Escolha a empresa para ver os feriados do escritório dela.' }, { status: 400 }) };
  }
  return { ok: true, escritorioId: g.sessao.escritorioId };
}

export async function GET(req: NextRequest) {
  const alvo = await escritorioAlvo(req, new URL(req.url).searchParams.get('empresa'));
  if (!alvo.ok) return alvo.resposta;
  try {
    return Response.json({ feriados: await lerFeriados(alvo.escritorioId) });
  } catch (e) {
    return respostaErroPonto(e, 'Falha ao ler os feriados.');
  }
}

export async function POST(req: NextRequest) {
  let body: { empresa?: string; feriados?: Feriado[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ erro: 'JSON inválido.' }, { status: 400 });
  }
  const alvo = await escritorioAlvo(req, body?.empresa);
  if (!alvo.ok) return alvo.resposta;
  try {
    const n = await salvarFeriados(alvo.escritorioId, Array.isArray(body.feriados) ? body.feriados : []);
    return Response.json({ ok: true, total: n });
  } catch (e) {
    return respostaErroPonto(e, 'Falha ao salvar os feriados.');
  }
}
