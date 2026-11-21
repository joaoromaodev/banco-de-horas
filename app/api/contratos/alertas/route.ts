// GET /api/contratos/alertas — vencimentos de experiência de TODAS as empresas
// que a sessão enxerga (recorte de lib/acesso.ts: master vê tudo; contador, as
// do escritório dele). Alimenta a faixa do topo de /contratos.
import { NextRequest } from 'next/server';
import { empresasVisiveis, exigirGestor } from '@/lib/acesso';
import { alertasConsolidados, hojeBelem } from '@/lib/contratos';
import { ErroContrato, listarEmExperiencia } from '@/lib/contratosServidor';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const empresas = await empresasVisiveis(g.sessao);
    const nomes = new Map(empresas.map((e) => [e.id, e.nome]));
    const contratos = await listarEmExperiencia(empresas.map((e) => e.id)).catch((e) => {
      if (e instanceof ErroContrato && e.status === 503) return null; // migração 0009 pendente
      throw e;
    });
    const alertas = alertasConsolidados(
      (contratos ?? []).map((c) => ({ ...c, empresaNome: nomes.get(c.empresa) ?? '' })),
      hojeBelem(),
    );
    return Response.json({ alertas, semTabela: contratos === null });
  } catch (e) {
    if (e instanceof ErroContrato) return Response.json({ erro: e.message }, { status: e.status });
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha.' }, { status: 502 });
  }
}
