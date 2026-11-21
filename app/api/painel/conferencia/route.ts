// GET /api/painel/conferencia — o que não bate entre Departamento Pessoal, ponto,
// contratos de experiência e férias (lib/conferenciaModulos.ts). Só leitura, só alerta.
//
// Só gestor (`exigirGestor`), recortado pelas empresas visíveis (arquivadas não
// entram) e pelo escritório. Exige o módulo `ponto` (o DP anda atrás dele): sem ele
// devolve `disponivel: false` e a tela esconde o bloco. Cada fonte falha sozinha
// (vira `indisponiveis`); se a leitura inteira falhar, o painel segue sem este bloco.
import { NextRequest } from 'next/server';
import { temModulo } from '@/lib/auth';
import { empresasVisiveis, exigirGestor } from '@/lib/acesso';
import { hojeBelem } from '@/lib/agenda';
import { fraseConferencia } from '@/lib/conferenciaModulos';
import { conferirEmpresas } from '@/lib/conferenciaModulosServidor';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  const { sessao } = g;
  if (!temModulo(sessao, 'ponto')) {
    return Response.json({ disponivel: false, achados: [], indisponiveis: [], frase: '' }, { headers: { 'Cache-Control': 'no-store' } });
  }
  try {
    const empresas = await empresasVisiveis(sessao);
    const escritorioId = sessao.role === 'master' ? null : sessao.escritorioId ?? null;
    // Contador sem escritório não enxerga nada (falha fechada, como nas outras rotas).
    const visiveis = sessao.role !== 'master' && !escritorioId ? [] : empresas;
    const r = await conferirEmpresas(escritorioId, new Map(visiveis.map((e) => [e.id, e.nome])), hojeBelem());
    return Response.json({ disponivel: true, ...r, frase: fraseConferencia(r) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[painel/conferencia]', e instanceof Error ? e.message.slice(0, 120) : 'falha');
    return Response.json({ erro: 'Não foi possível conferir os módulos agora.' }, { status: 502 });
  }
}
