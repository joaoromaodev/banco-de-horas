// GET/PATCH /api/caixa/exercicio — o livro de uma empresa num ano.
//
// O GET **abre o exercício se ele ainda não existir**: a contadora não quer
// etapa de configuração antes do primeiro lançamento.
import { NextRequest } from 'next/server';
import { exigirEmpresa, exigirGestor, podeVerEmpresa } from '@/lib/acesso';
import { ErroCaixa, garantirExercicio, mesesConfirmados, paraValor, resumoDoExercicio } from '@/lib/caixa';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';

function falha(e: unknown) {
  if (e instanceof ErroCaixa) return Response.json({ erro: e.message }, { status: e.status });
  return Response.json({ erro: e instanceof Error ? e.message : 'Falha no exercício.' }, { status: 502 });
}

function anoDe(v: string | null): number {
  const ano = Number(v);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new ErroCaixa('Ano inválido.');
  return ano;
}

export async function GET(req: NextRequest) {
  const empresa = req.nextUrl.searchParams.get('empresa') ?? '';
  const g = await exigirEmpresa(req, empresa);
  if (!g.ok) return g.resposta;

  try {
    const ano = anoDe(req.nextUrl.searchParams.get('ano'));
    const ex = await garantirExercicio(empresa, ano);
    const [resumo, confirmados] = await Promise.all([resumoDoExercicio(ex.id), mesesConfirmados(ex.id)]);

    return Response.json({
      exercicio: { id: ex.id, ano: ex.ano, saldoInicial: ex.saldoInicial },
      resumo,
      confirmados,
    });
  } catch (e) {
    return falha(e);
  }
}

/** Saldo que abre janeiro. É decisão da contabilidade — o cliente não mexe. */
export async function PATCH(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;

  try {
    const body = await req.json();
    const empresa = String(body.empresa ?? '').trim();
    if (!empresa) throw new ErroCaixa('Informe a empresa.');
    if (!podeVerEmpresa(g.sessao, empresa)) throw new ErroCaixa('Acesso restrito a esta empresa.', 403);

    const ano = anoDe(String(body.ano ?? ''));
    const saldo = paraValor(body.saldoInicial);
    if (Number.isNaN(saldo)) throw new ErroCaixa('Saldo inicial inválido.');

    const ex = await garantirExercicio(empresa, ano);
    const { error } = await getDb().from('exercicios')
      .update({ saldo_inicial: Math.round(saldo * 100) / 100 }).eq('id', ex.id);
    if (error) throw new ErroCaixa(`exercicios: ${error.message}`, 502);

    return Response.json({ ok: true, saldoInicial: Math.round(saldo * 100) / 100 });
  } catch (e) {
    return falha(e);
  }
}
