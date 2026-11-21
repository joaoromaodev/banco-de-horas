// GET/POST /api/feriados — lista e salva o cadastro de feriados.
//
// A lista ainda é GLOBAL (aba do Google Sheets, a de Belém, da Edilce) — sai para
// o Postgres por escritório na Sprint 2. Até lá, ler é livre para a
// contabilidade, mas gravar fica com o master e o escritório fundador: um
// escritório novo não pode reescrever o calendário da Edilce.
import { NextRequest } from 'next/server';
import { exigirGestor } from '@/lib/acesso';
import { ESCRITORIO_FUNDADOR_ID } from '@/lib/escritorios';
import { lerFeriados, salvarFeriados, Feriado } from '@/lib/sheets';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    return Response.json({ feriados: await lerFeriados() });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao ler.' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  if (g.sessao.role !== 'master' && g.sessao.escritorioId !== ESCRITORIO_FUNDADOR_ID) {
    return Response.json({ erro: 'Os feriados ainda são compartilhados e só o administrador da plataforma os altera.' }, { status: 403 });
  }
  try {
    const body = await req.json();
    const lista: Feriado[] = body.feriados ?? [];
    const n = await salvarFeriados(lista);
    return Response.json({ ok: true, total: n });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao salvar.' }, { status: 502 });
  }
}
