// /api/caixa/lancamentos — o movimento do caixa: ler o mês, lançar, editar,
// conferir e excluir.
//
// Lançamento é **sempre editável e excluível**, inclusive retroativo e inclusive
// depois do mês confirmado — decisão da contadora. Por isso não há nenhuma
// checagem de "mês fechado" aqui.
import { NextRequest } from 'next/server';
import { ehGestor, exigirEmpresa, exigirSessao, motivoNegado } from '@/lib/acesso';
import {
  empresaDoLancamento, ErroCaixa, exigirCatalogoVisivel, garantirExercicio, HISTORICO_RETIRADA_CHEQUE,
  lancamentosDoMes, mesesConfirmados, saldoTransportado, semColunaDocumento, validarLancamento,
  vincularConta, vincularHistorico,
} from '@/lib/caixa';
import { podeVerRegistro } from '@/lib/documentos';
import { lerDocumento } from '@/lib/documentosServidor';
import { getDb } from '@/lib/db';
import { avaliarNaConferencia, lerRegistroSugestao, registrarSugestao } from '@/lib/caixaInteligente';
import { visaoDoCatalogo } from '@/lib/visibilidadeCatalogo';

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
    // Saída efetiva inclui juros e multa (ver migração 0005).
    const saidas = lancamentos.reduce((s, l) => s + l.saida + l.juros + l.multa, 0);

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
    { const n = await motivoNegado(g.sessao, empresa); if (n) throw new ErroCaixa(n.erro, n.status); }

    const ano = anoDe(body.ano);
    const ex = await garantirExercicio(empresa, ano);
    const l = validarLancamento(body, ano);
    // A conta e a analítica têm que ser do catálogo base ou do escritório de quem lança.
    await exigirCatalogoVisivel(visaoDoCatalogo(g.sessao), l.contaId, l.historicoId);
    const autor = g.sessao.email;

    // Pagamento em cheque: o dinheiro sai da conta corrente (entra no caixa) e
    // só então paga a despesa. São dois lançamentos, gravados juntos para não
    // sobrar a retirada sozinha se o segundo falhar.
    const cheque = Boolean(body.cheque);
    if (cheque && l.saida <= 0) throw new ErroCaixa('O atalho de cheque vale para pagamento (saída).');

    // Documento de onde o lançamento veio (rascunho da IA, 0029): tem que ser da
    // MESMA empresa, do escritório da sessão, recebido e não excluído.
    let documentoId: string | null = null;
    if (body.documentoId) {
      const d = await lerDocumento(String(body.documentoId));
      if (!d || d.excluidoEm || d.empresaId !== empresa || !podeVerRegistro(g.sessao, d)
        || (d.status !== 'recebido' && d.status !== 'conferido')) {
        throw new ErroCaixa('O documento anexado não é desta empresa (ou foi excluído).', 400);
      }
      documentoId = d.id;
    }
    const comDocumento = documentoId ? { documento_id: documentoId } : {};

    const linhas: Record<string, unknown>[] = [];
    if (cheque) {
      // `criado_em` explícito porque as duas linhas nascem na mesma transação e
      // o now() sairia idêntico — a retirada precisa vir antes do pagamento na
      // ordenação do livro, senão o saldo corrido mergulha sem motivo.
      const t = Date.now();
      // A retirada traz do banco o valor TOTAL do pagamento (principal + juros +
      // multa), para o par ficar neutro no caixa; as penalidades ficam na perna
      // do pagamento.
      linhas.push({
        exercicio_id: ex.id, data: l.data, historico: HISTORICO_RETIRADA_CHEQUE,
        complemento: `Cheque — ${l.complemento || l.historico}`, conta_id: null,
        entrada: l.saida + l.juros + l.multa, saida: 0, juros: 0, multa: 0,
        criado_por: autor, criado_em: new Date(t).toISOString(),
      });
      linhas.push({
        exercicio_id: ex.id, data: l.data, historico: l.historico, complemento: l.complemento,
        conta_id: l.contaId, entrada: 0, saida: l.saida, juros: l.juros, multa: l.multa,
        criado_por: autor, criado_em: new Date(t + 1).toISOString(), ...comDocumento,
      });
    } else {
      linhas.push({
        exercicio_id: ex.id, data: l.data, historico: l.historico, complemento: l.complemento,
        conta_id: l.contaId, entrada: l.entrada, saida: l.saida, juros: l.juros, multa: l.multa,
        pagador_nome: l.pagadorNome, pagador_documento: l.pagadorDocumento,
        criado_por: autor, ...comDocumento,
      });
    }

    const { data, error } = await getDb().from('lancamentos').insert(linhas).select('id, historico, conta_id');
    if (error && documentoId && semColunaDocumento(error)) {
      throw new ErroCaixa('O vínculo com o documento ainda não está instalado (falta a migração 0029). Lance sem o anexo.', 503);
    }
    if (error) throw new ErroCaixa(traduzir(error.message), 400);

    // A sugestão de conta que estava na tela (se havia): registra se foi aceita.
    // Nunca derruba o lançamento (ver lib/caixaInteligente).
    const sugestao = lerRegistroSugestao(body.sugestao);
    const principal = (data ?? []).find((x) => x.historico === l.historico && x.conta_id === l.contaId) ?? data?.at(-1);
    if (sugestao && principal) {
      await registrarSugestao({
        sugestao, empresaId: empresa, lancamentoId: principal.id, autor,
        final: { contaId: l.contaId, historico: l.historico },
      });
    }

    // É isto que mantém as listas abertas: usou, entrou na lista da empresa —
    // tanto a titular (conta) quanto a analítica (histórico).
    await Promise.all([
      l.contaId ? vincularConta(empresa, l.contaId) : null,
      l.historicoId ? vincularHistorico(empresa, l.historicoId) : null,
    ]);

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
    { const n = await motivoNegado(g.sessao, dono.empresaId); if (n) throw new ErroCaixa(n.erro, n.status); }

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
      // Mede a sugestão: a conta ficou ou a contadora trocou? (o conferido já ensina)
      if (marcar) await avaliarNaConferencia(id);
      return Response.json({ ok: true });
    }

    const l = validarLancamento(body, dono.ano);
    await exigirCatalogoVisivel(visaoDoCatalogo(g.sessao), l.contaId, l.historicoId);
    const { error } = await db.from('lancamentos').update({
      data: l.data, historico: l.historico, complemento: l.complemento, conta_id: l.contaId,
      entrada: l.entrada, saida: l.saida, juros: l.juros, multa: l.multa,
      pagador_nome: l.pagadorNome, pagador_documento: l.pagadorDocumento,
      atualizado_por: g.sessao.email, atualizado_em: new Date().toISOString(),
      // O que ela conferiu mudou: a conferência cai e o lançamento volta para a fila.
      conferido_por: null, conferido_em: null,
    }).eq('id', id);
    if (error) throw new ErroCaixa(traduzir(error.message), 400);

    await Promise.all([
      l.contaId ? vincularConta(dono.empresaId, l.contaId) : null,
      l.historicoId ? vincularHistorico(dono.empresaId, l.historicoId) : null,
    ]);
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
    { const n = await motivoNegado(g.sessao, dono.empresaId); if (n) throw new ErroCaixa(n.erro, n.status); }

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
