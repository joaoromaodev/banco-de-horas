// GET /api/caixa/revisao?empresa=&ano= — revisão do exercício antes da conferência.
//
// Regras determinísticas de lib/revisaoCaixa.ts: duplicidade, valor fora do
// padrão da conta, natureza invertida, pagador faltando/inválido, juros/multa
// recorrentes, mês sem lançamento e saldo negativo. Só alerta, nunca bloqueia.
// É trabalho da contabilidade: o cliente não recebe (403).
import { NextRequest } from 'next/server';
import { exigirGestor, podeAcessarEmpresa } from '@/lib/acesso';
import { ErroCaixa } from '@/lib/caixa';
import { revisarExercicio } from '@/lib/caixaInteligente';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const empresa = req.nextUrl.searchParams.get('empresa') ?? '';
    if (!(await podeAcessarEmpresa(g.sessao, empresa))) throw new ErroCaixa('Acesso restrito a esta empresa.', 403);
    const ano = Number(req.nextUrl.searchParams.get('ano'));
    if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new ErroCaixa('Ano inválido.');
    return Response.json(await revisarExercicio(empresa, ano));
  } catch (e) {
    if (e instanceof ErroCaixa) return Response.json({ erro: e.message }, { status: e.status });
    console.error('[caixa] revisão', e);
    return Response.json({ erro: 'Não foi possível revisar o exercício agora.' }, { status: 502 });
  }
}
