// GET/POST /api/caixa/contas — plano de contas para a tela de lançamento.
//
// A lista é **aberta**: o GET devolve o catálogo inteiro com as contas daquela
// empresa marcadas (a UI as sobe para o topo, e é essa a "lista dela" na
// prática). Escolher uma conta nova durante o lançamento já a inclui na empresa
// — isso acontece na rota de lançamentos, não aqui.
//
// O POST é outra coisa: **criar conta que não existe no catálogo** continua
// sendo só da contadora.
import { NextRequest } from 'next/server';
import { exigirEmpresa, exigirGestor, podeAcessarEmpresa } from '@/lib/acesso';
import { contasDaEmpresa, criarConta, ErroCaixa, historicosDaEmpresa, vincularConta } from '@/lib/caixa';
import { donoDaCriacao, visaoDoCatalogo } from '@/lib/visibilidadeCatalogo';

export const runtime = 'nodejs';

function falha(e: unknown) {
  if (e instanceof ErroCaixa) return Response.json({ erro: e.message }, { status: e.status });
  return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao ler as contas.' }, { status: 502 });
}

export async function GET(req: NextRequest) {
  const empresa = req.nextUrl.searchParams.get('empresa') ?? '';
  const g = await exigirEmpresa(req, empresa);
  if (!g.ok) return g.resposta;
  try {
    // Catálogo base + as extensões do escritório da sessão (o master vê tudo).
    const visao = visaoDoCatalogo(g.sessao);
    const [todas, historicosTodos] = await Promise.all([
      contasDaEmpresa(empresa, visao), historicosDaEmpresa(empresa, visao),
    ]);

    // O cliente não navega o catálogo inteiro: ele só usa as contas titulares e
    // as analíticas da própria empresa. A lista aberta (o catálogo completo) é só
    // da contabilidade.
    if (g.sessao.role === 'cliente') {
      const contas = todas.filter((c) => c.daEmpresa);
      const dela = new Set(contas.map((c) => c.id));
      // Só as analíticas dele; e se alguma apontar para titular fora do conjunto
      // dele, some a titular sugerida (não vaza) — ele escolhe entre as próprias.
      const historicos = historicosTodos
        .filter((h) => h.daEmpresa)
        .map((h) => (h.contaId && dela.has(h.contaId) ? h : { ...h, contaId: null }));
      return Response.json({ contas, historicos });
    }

    return Response.json({ contas: todas, historicos: historicosTodos });
  } catch (e) {
    return falha(e);
  }
}

/**
 * Cria uma conta nova no catálogo, dentro de um grupo existente, e já a vincula
 * à empresa. O código sai do grupo: N.GG.CC com CC = próximo livre.
 */
export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;

  try {
    const body = await req.json();
    const empresa = String(body.empresa ?? '').trim();
    const grupo = String(body.grupo ?? '').trim();
    const nome = String(body.nome ?? '').trim();
    if (!empresa) throw new ErroCaixa('Informe a empresa.');
    if (!(await podeAcessarEmpresa(g.sessao, empresa))) throw new ErroCaixa('Acesso restrito a esta empresa.', 403);
    if (!grupo) throw new ErroCaixa('Escolha o grupo da conta.');
    if (!nome) throw new ErroCaixa('Informe o nome da conta.');

    // A conta nova pertence ao escritório da sessão; o master cria no catálogo base.
    const dono = donoDaCriacao(g.sessao);
    if (dono === undefined) throw new ErroCaixa('Seu usuário não está vinculado a um escritório.', 403);

    const nova = await criarConta(dono, grupo, nome);
    await vincularConta(empresa, nova.id);
    return Response.json({ ok: true, conta: { ...nova, daEmpresa: true } });
  } catch (e) {
    return falha(e);
  }
}
