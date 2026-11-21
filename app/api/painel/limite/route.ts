// GET /api/painel/limite — alerta de limite de faturamento (MEI/Simples) das empresas
// que a sessão enxerga. Só gestor, só leitura. Quem estoura primeiro vem primeiro.
// Estimativa pelo caixa — a tela repete "confirme" (lib/limiteFaturamento.ts).
import { NextRequest } from 'next/server';
import { temModulo } from '@/lib/auth';
import { empresasVisiveis, exigirGestor } from '@/lib/acesso';
import { hojeBelem } from '@/lib/agenda';
import { ORDEM_NIVEL } from '@/lib/limiteFaturamento';
import { alertasDasEmpresas } from '@/lib/limiteFaturamentoServidor';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  const { sessao } = g;
  // Sem o módulo do caixa não há de onde tirar a receita: bloco fora.
  if (!temModulo(sessao, 'caixa')) return Response.json({ aplica: false });

  try {
    const empresas = await empresasVisiveis(sessao);
    const escritorioId = sessao.role === 'master' ? null : sessao.escritorioId ?? null;
    // Contador sem escritório não enxerga nada (falha fechada, como no resto do painel).
    if (sessao.role !== 'master' && !escritorioId) return Response.json({ aplica: true, hoje: hojeBelem(), itens: [] });
    const nomes = new Map(empresas.map((e) => [e.id, e.nome]));
    const hoje = hojeBelem();
    const itens = (await alertasDasEmpresas([...nomes.keys()], escritorioId, hoje))
      .map((i) => ({ ...i, nome: nomes.get(i.empresaId) ?? '—' }))
      .sort((a, b) => ORDEM_NIVEL[b.alerta.nivel] - ORDEM_NIVEL[a.alerta.nivel]
        || Math.max(...b.alerta.medidas.map((m) => m.percentual)) - Math.max(...a.alerta.medidas.map((m) => m.percentual))
        || a.nome.localeCompare(b.nome, 'pt-BR'));
    return Response.json({ aplica: true, hoje, itens }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[painel/limite]', e instanceof Error ? e.message : e);
    return Response.json({ erro: 'Não foi possível calcular os limites agora.' }, { status: 502 });
  }
}
