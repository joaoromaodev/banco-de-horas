// GET /api/caixa/resumo — o resumo do exercício, mês a mês e no ano.
//
// Não é balanço patrimonial: ela **dispensou** o detalhamento em débitos ×
// créditos. O que ela analisa é entradas, saídas e o saldo de um mês para o
// outro — é isso que sai daqui, direto da view `resumo_mensal`.
//
// A regra do cliente: o resumo **só fica visível depois do mês confirmado**.
// Como o livro é sequencial (o saldo de um mês abre o seguinte), liberar um mês
// solto entregaria o saldo dos meses anteriores junto. Então o cliente enxerga o
// bloco fechado do começo do ano: janeiro até o último mês confirmado sem buraco.
import { NextRequest } from 'next/server';
import { ehGestor, exigirEmpresa } from '@/lib/acesso';
import { ErroCaixa, garantirExercicio, mesesConfirmados, resumoDoExercicio } from '@/lib/caixa';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const empresa = req.nextUrl.searchParams.get('empresa') ?? '';
  const g = await exigirEmpresa(req, empresa);
  if (!g.ok) return g.resposta;

  try {
    const ano = Number(req.nextUrl.searchParams.get('ano'));
    if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new ErroCaixa('Ano inválido.');

    const ex = await garantirExercicio(empresa, ano);
    const [resumo, confirmados] = await Promise.all([resumoDoExercicio(ex.id), mesesConfirmados(ex.id)]);

    // Até onde o cliente enxerga: o último mês de uma sequência confirmada
    // começando em janeiro. Para a contabilidade, o ano inteiro.
    let liberadoAte = 12;
    if (!ehGestor(g.sessao)) {
      liberadoAte = 0;
      while (liberadoAte < 12 && confirmados.includes(liberadoAte + 1)) liberadoAte++;
    }

    const meses = resumo.map((m, i) => {
      const liberado = m.mes <= liberadoAte;
      const anterior = i === 0 ? ex.saldoInicial : resumo[i - 1].saldoFinal;
      return liberado
        ? { ...m, saldoTransportado: anterior, confirmado: confirmados.includes(m.mes), liberado }
        : { mes: m.mes, entradas: null, saidas: null, saldoFinal: null, saldoTransportado: null,
            confirmado: confirmados.includes(m.mes), liberado };
    });

    const visiveis = resumo.filter((m) => m.mes <= liberadoAte);
    return Response.json({
      ano: ex.ano,
      saldoInicial: ex.saldoInicial,
      meses,
      liberadoAte,
      total: {
        entradas: visiveis.reduce((s, m) => s + m.entradas, 0),
        saidas: visiveis.reduce((s, m) => s + m.saidas, 0),
        saldoFinal: visiveis.length ? visiveis[visiveis.length - 1].saldoFinal : ex.saldoInicial,
      },
    });
  } catch (e) {
    if (e instanceof ErroCaixa) return Response.json({ erro: e.message }, { status: e.status });
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha no resumo.' }, { status: 502 });
  }
}
