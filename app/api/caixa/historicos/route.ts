// POST /api/caixa/historicos — cria uma Conta Analítica nova no catálogo, sob
// uma Conta Titular, e já a vincula à empresa. Espelha o POST de /contas:
// **criar analítica que não existe no catálogo continua sendo só da contadora**.
//
// A leitura das analíticas mora em /contas (o GET devolve contas + historicos
// juntos, que a tela carrega de uma vez).
import { NextRequest } from 'next/server';
import { exigirGestor, podeAcessarEmpresa } from '@/lib/acesso';
import { criarAnalitica, ErroCaixa } from '@/lib/caixa';

export const runtime = 'nodejs';

function falha(e: unknown) {
  if (e instanceof ErroCaixa) return Response.json({ erro: e.message }, { status: e.status });
  return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao criar a analítica.' }, { status: 502 });
}

export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;

  try {
    const body = await req.json();
    const empresa = String(body.empresa ?? '').trim();
    const texto = String(body.texto ?? '').trim();
    const contaId = String(body.contaId ?? '').trim();
    if (!empresa) throw new ErroCaixa('Informe a empresa.');
    if (!(await podeAcessarEmpresa(g.sessao, empresa))) throw new ErroCaixa('Acesso restrito a esta empresa.', 403);
    if (!texto) throw new ErroCaixa('Informe o texto da conta analítica.');
    // A natureza da analítica sai da titular, então a titular é obrigatória ao criar.
    if (!contaId) throw new ErroCaixa('Escolha a conta titular antes de criar a analítica.');

    const analitica = await criarAnalitica(empresa, texto, contaId);
    return Response.json({ ok: true, historico: analitica });
  } catch (e) {
    return falha(e);
  }
}
