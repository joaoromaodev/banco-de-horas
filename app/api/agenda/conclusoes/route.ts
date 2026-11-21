// /api/agenda/conclusoes — marcar uma competência como feita (POST) e desfazer (DELETE).
import { NextRequest } from 'next/server';
import { exigirGestor } from '@/lib/acesso';
import { competenciaValida } from '@/lib/agenda';
import { desmarcar, ErroAgenda, marcarFeita } from '@/lib/agendaServidor';
import { falha, obrigacaoAcessivel } from '../comum';

export const runtime = 'nodejs';

async function alvo(req: NextRequest, obrigacaoId: string, competencia: string) {
  const g = await exigirGestor(req);
  if (!g.ok) return { resposta: g.resposta } as const;
  const o = await obrigacaoAcessivel(g.sessao, obrigacaoId);
  if (!competenciaValida(competencia, o.recorrencia)) throw new ErroAgenda('Competência inválida para esta obrigação.');
  return { o, sessao: g.sessao } as const;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const a = await alvo(req, String(body.obrigacaoId ?? ''), String(body.competencia ?? ''));
    if ('resposta' in a) return a.resposta;
    const conclusao = await marcarFeita(a.o.id, a.o.escritorioId, String(body.competencia), a.sessao.email);
    return Response.json({ conclusao });
  } catch (e) { return falha(e); }
}

export async function DELETE(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams;
    const competencia = p.get('competencia') ?? '';
    const a = await alvo(req, p.get('obrigacao') ?? '', competencia);
    if ('resposta' in a) return a.resposta;
    await desmarcar(a.o.id, a.o.escritorioId, competencia);
    return Response.json({ ok: true });
  } catch (e) { return falha(e); }
}
