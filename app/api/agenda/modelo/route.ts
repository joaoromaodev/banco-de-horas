// POST /api/agenda/modelo — aplica o modelo padrão de um regime numa empresa.
// Cria só os tipos que a empresa ainda não tem; devolve os ids criados (a tela
// oferece "Desfazer", que exclui esses ids).
import { NextRequest } from 'next/server';
import { exigirGestor } from '@/lib/acesso';
import { aplicarModelo, hojeBelem, isoValida, MODELOS, Regime } from '@/lib/agenda';
import { criarObrigacoes, ErroAgenda, listarObrigacoes } from '@/lib/agendaServidor';
import { escritorioDaEmpresa, falha } from '../comum';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json();
    const empresa = String(body.empresa ?? '');
    const regime = String(body.regime ?? '') as Regime;
    if (!MODELOS.some((m) => m.regime === regime)) throw new ErroAgenda('Modelo inválido.');
    const inicio = isoValida(body.inicio) ? body.inicio : hojeBelem();
    const escritorio = await escritorioDaEmpresa(g.sessao, empresa);
    const existentes = await listarObrigacoes({ escritorioId: escritorio }, empresa);
    const novas = aplicarModelo(regime, empresa, inicio, existentes.map((o) => o.tipo));
    const criadas = await criarObrigacoes(novas, escritorio, g.sessao.email);
    return Response.json({ obrigacoes: criadas, puladas: MODELOS.find((m) => m.regime === regime)!.tipos.length - criadas.length });
  } catch (e) { return falha(e); }
}
