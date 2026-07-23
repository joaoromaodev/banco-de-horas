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
import { exigirEmpresa, exigirGestor, podeVerEmpresa } from '@/lib/acesso';
import { contasDaEmpresa, ErroCaixa, historicosPadrao, vincularConta } from '@/lib/caixa';
import { getDb } from '@/lib/db';

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
    const [contas, historicos] = await Promise.all([contasDaEmpresa(empresa), historicosPadrao()]);
    return Response.json({ contas, historicos });
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
    if (!podeVerEmpresa(g.sessao, empresa)) throw new ErroCaixa('Acesso restrito a esta empresa.', 403);
    if (!grupo) throw new ErroCaixa('Escolha o grupo da conta.');
    if (!nome) throw new ErroCaixa('Informe o nome da conta.');

    const db = getDb();
    const { data: irmas, error } = await db
      .from('plano_contas').select('codigo, natureza, ordem').eq('grupo', grupo);
    if (error) throw new ErroCaixa(`plano_contas: ${error.message}`, 502);
    if (!irmas?.length) throw new ErroCaixa('Grupo não encontrado no catálogo.');

    // Todas as contas do grupo compartilham o prefixo N.GG e a natureza.
    const prefixo = (irmas[0].codigo as string).slice(0, 4);
    const proximo = Math.max(...irmas.map((c) => Number((c.codigo as string).slice(5)) || 0)) + 1;
    const codigo = `${prefixo}.${String(proximo).padStart(2, '0')}`;
    const ordem = Math.max(...irmas.map((c) => Number(c.ordem) || 0));

    const { data: nova, error: errIns } = await db.from('plano_contas')
      .insert({ codigo, nome, grupo, natureza: irmas[0].natureza, linha_balanco: null, ordem })
      .select('id, codigo, nome, grupo, natureza').single();
    if (errIns) throw new ErroCaixa(`plano_contas: ${errIns.message}`, 502);

    await vincularConta(empresa, nova.id);
    return Response.json({ ok: true, conta: { ...nova, daEmpresa: true } });
  } catch (e) {
    return falha(e);
  }
}
