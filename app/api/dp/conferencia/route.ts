// GET /api/dp/conferencia?empresa= — divergências entre DP, ponto, contratos e férias
// de UMA empresa (lib/conferenciaModulos.ts). Só leitura, só alerta; a tela do DP
// mostra na lista e na ficha. Contabilidade apenas (exigirEmpresaPonto).
import { NextRequest } from 'next/server';
import { exigirEmpresaPonto } from '@/lib/pontoAcesso';
import { hojeBelem } from '@/lib/agenda';
import { fraseConferencia } from '@/lib/conferenciaModulos';
import { conferirEmpresas } from '@/lib/conferenciaModulosServidor';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirEmpresaPonto(req, req.nextUrl.searchParams.get('empresa'));
  if (!g.ok) return g.resposta;
  try {
    const r = await conferirEmpresas(g.escritorioId, new Map([[g.empresa.id, g.empresa.nome]]), hojeBelem());
    return Response.json({ ...r, frase: fraseConferencia(r) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[dp/conferencia]', e instanceof Error ? e.message.slice(0, 120) : 'falha');
    return Response.json({ erro: 'Não foi possível conferir os módulos agora.' }, { status: 502 });
  }
}
