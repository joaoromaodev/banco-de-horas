// /api/caixa/lancamentos — o movimento do caixa: ler o mês, lançar, editar,
// conferir e excluir.
//
// Lançamento é **sempre editável e excluível**, inclusive retroativo e inclusive
// depois do mês confirmado — decisão da contadora. Por isso não há nenhuma
// checagem de "mês fechado" aqui.
import { NextRequest } from 'next/server';
import { ehGestor, exigirEmpresa, exigirSessao, podeVerEmpresa } from '@/lib/acesso';
import {
  empresaDoLancamento, ErroCaixa, garantirExercicio, HISTORICO_RETIRADA_CHEQUE,
  lancamentosDoMes, mesesConfirmados, saldoTransportado, validarLancamento, vincularConta,
} from '@/lib/caixa';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';

function falha(e: unknown) {
  if (e instanceof ErroCaixa) return Response.json({ erro: e.message }, { status: e.status });
  return Response.json({ erro: e instanceof Error ? e.message : 'Falha no lançamento.' }, { status: 502 });
}

function anoDe(v: unknown): number {
  const ano = Number(v);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new ErroCaixa('Ano inválido.');
  return ano;
}

function mesDe(v: unknown): number {
  const mes = Number(v);
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) throw new ErroCaixa('Mês inválido.');
  return mes;
}

// ---------------------------------------------------------------------- ler
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const empresa = p.get('empresa') ?? '';
  const g = await exigirEmpresa(req, empresa);
  if (!g.ok) return g.resposta;

  try {
    const ano = anoDe(p.get('ano'));
    const mes = mesDe(p.get('mes'));
    const ex = await garantirExercicio(empresa, ano);

    const [lancamentos, transportado, confirmados] = await Promise.all([
      lancamentosDoMes(ex.id, mes),
      saldoTransportado(ex, mes),
      mesesConfirmados(ex.id),
    ]);

    const entradas = lancamentos.reduce((s, l) => s + l.entrada, 0);
    const saidas = lancamentos.reduce((s, l) => s + l.saida, 0);

    return Response.json({
      exercicio: { id: ex.id, ano: ex.ano, saldoInicial: ex.saldoInicial },
      mes,
      lancamentos,
      saldoTransportado: transportado,
      entradas,
      saidas,
      saldoFinal: transportado + entradas - saidas,
      confirmado: confirmados.includes(mes),
    });
  } catch (e) {
    return falha(e);
  }
}

// --------------------------------------------------------------------- criar
export async function POST(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;

  try {
    const body = await req.json();
    const empresa = String(body.empresa ?? '').trim();
    if (!empresa) throw new ErroCaixa('Informe a empresa.');
    if (!podeVerEmpresa(g.sessao, empresa)) throw new ErroCaixa('Acesso restrito a esta empresa.', 403);

    const ano = anoDe(body.ano);
    const ex = await garantirExercicio(empresa, ano);
    const l = validarLancamento(body, ano);
    const autor = g.sessao.email;

    // Pagamento em cheque: o dinheiro sai da conta corrente (entra no caixa) e
    // só então paga a despesa. São dois lançamentos, gravados juntos para não
    // sobrar a retirada sozinha se o segundo falhar.
    const cheque = Boolean(body.cheque);
    if (cheque && l.saida <= 0) throw new ErroCaixa('O atalho de cheque vale para pagamento (saída).');

    const linhas: Record<string, unknown>[] = [];
    if (cheque) {
      // `criado_em` explícito porque as duas linhas nascem na mesma transação e
      // o now() sairia idêntico — a retirada precisa vir antes do pagamento na
      // ordenação do livro, senão o saldo corrido mergulha sem motivo.
      const t = Date.now();
      linhas.push({
        exercicio_id: ex.id, data: l.data, historico: HISTORICO_RETIRADA_CHEQUE,
        complemento: `Cheque — ${l.complemento || l.historico}`, conta_id: null,
        entrada: l.saida, saida: 0, criado_por: autor, criado_em: new Date(t).toISOString(),
      });
      linhas.push({
        exercicio_id: ex.id, data: l.data, historico: l.historico, complemento: l.complemento,
        conta_id: l.contaId, entrada: 0, saida: l.saida,
        criado_por: autor, criado_em: new Date(t + 1).toISOString(),
      });
    } else {
      linhas.push({
        exercicio_id: ex.id, data: l.data, historico: l.historico, complemento: l.complemento,
        conta_id: l.contaId, entrada: l.entrada, saida: l.saida, criado_por: autor,
      });
    }

    const { data, error } = await getDb().from('lancamentos').insert(linhas).select('id');
    if (error) throw new ErroCaixa(traduzir(error.message), 400);

    // É isto que mantém a lista de contas aberta: usou, entrou na lista da empresa.
    if (l.contaId) await vincularConta(empresa, l.contaId);

    return Response.json({ ok: true, criados: data?.length ?? 0 });
  } catch (e) {
    return falha(e);
  }
}

// -------------------------------------------------------------------- editar
/** Edita o lançamento ou marca/desmarca a conferência (`{ id, conferido }`). */
export async function PATCH(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;

  try {
    const body = await req.json();
    const id = String(body.id ?? '').trim();
    if (!id) throw new ErroCaixa('Informe o lançamento.');

    const dono = await empresaDoLancamento(id);
    if (!podeVerEmpresa(g.sessao, dono.empresaId)) throw new ErroCaixa('Acesso restrito a esta empresa.', 403);

    const db = getDb();

    // Conferir é trabalho da contabilidade — o cliente não marca o próprio lançamento.
    if ('conferido' in body) {
      if (!ehGestor(g.sessao)) throw new ErroCaixa('Só a contabilidade confere lançamentos.', 403);
      const marcar = Boolean(body.conferido);
      const { error } = await db.from('lancamentos').update({
        conferido_por: marcar ? g.sessao.email : null,
        conferido_em: marcar ? new Date().toISOString() : null,
      }).eq('id', id);
      if (error) throw new ErroCaixa(`lancamentos: ${error.message}`, 502);
      return Response.json({ ok: true });
    }

    const l = validarLancamento(body, dono.ano);
    const { error } = await db.from('lancamentos').update({
      data: l.data, historico: l.historico, complemento: l.complemento, conta_id: l.contaId,
      entrada: l.entrada, saida: l.saida,
      atualizado_por: g.sessao.email, atualizado_em: new Date().toISOString(),
      // O que ela conferiu mudou: a conferência cai e o lançamento volta para a fila.
      conferido_por: null, conferido_em: null,
    }).eq('id', id);
    if (error) throw new ErroCaixa(traduzir(error.message), 400);

    if (l.contaId) await vincularConta(dono.empresaId, l.contaId);
    return Response.json({ ok: true });
  } catch (e) {
    return falha(e);
  }
}

// ------------------------------------------------------------------- excluir
export async function DELETE(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;

  try {
    const id = req.nextUrl.searchParams.get('id') ?? '';
    if (!id) throw new ErroCaixa('Informe o lançamento.');

    const dono = await empresaDoLancamento(id);
    if (!podeVerEmpresa(g.sessao, dono.empresaId)) throw new ErroCaixa('Acesso restrito a esta empresa.', 403);

    const { error } = await getDb().from('lancamentos').delete().eq('id', id);
    if (error) throw new ErroCaixa(`lancamentos: ${error.message}`, 502);
    return Response.json({ ok: true });
  } catch (e) {
    return falha(e);
  }
}

/** As travas do banco falam em SQL; quem lança, não. */
function traduzir(msg: string): string {
  if (msg.includes('entrada_xor_saida')) return 'O lançamento é entrada ou saída, não os dois.';
  if (msg.includes('fora do exercício')) return msg.replace(/^.*?(Lançamento de)/, '$1');
  return msg;
}
