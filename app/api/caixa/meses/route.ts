// /api/caixa/meses — fechamento do mês pela contabilidade (Sprint 17, frente C).
//
//   GET    ?empresa=&ano=               → meses fechados (quem e quando) e o histórico
//   POST   { empresa, ano, mes }         → fecha (confirma) o mês
//   DELETE { empresa, ano, mes, motivo } → reabre o mês E os fechados depois dele,
//                                          com motivo obrigatório
//
// Fechar (o antigo "confirmar") libera o resumo e o Demonstrativo ao cliente E TRAVA
// o mês: nenhum lançamento dele é criado, alterado ou excluído — nem pelo cliente,
// nem pela contabilidade — até alguém da contabilidade reabrir informando o motivo
// (lib/caixa.ts → exigirMesAberto, nas rotas de lançamento e de saldo inicial).
// O saldo transportado faz parte do mês fechado: os meses fecham EM ORDEM e reabrir
// um mês reabre os fechados depois dele (o saldo deles vem deste).
// Quem fechou, quem reabriu, quando e por quê ficam em `caixa_meses_historico` (0034).
// Tudo aqui é só da contabilidade (exigirGestor); o cliente vê só "mês fechado".
import { NextRequest } from 'next/server';
import { exigirEmpresa, exigirGestor, motivoNegado } from '@/lib/acesso';
import { Sessao } from '@/lib/auth';
import {
  ERRO_SEM_0034, ErroCaixa, fechamentosDoExercicio, garantirExercicio, historicoDoExercicio, mesesConfirmados,
  semTabelaHistorico,
} from '@/lib/caixa';
import { ERRO_MOTIVO, mensagemFecharEmOrdem, motivoReabertura } from '@/lib/mesFechado';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';

/** Detalhe do banco só no log; quem usa recebe a mensagem genérica. */
function falha(e: unknown) {
  if (e instanceof ErroCaixa && e.status < 500) return Response.json({ erro: e.message }, { status: e.status });
  console.error('[caixa/meses]', e instanceof Error ? e.message.slice(0, 160) : e);
  const status = e instanceof ErroCaixa ? e.status : 502;
  const erro = e instanceof ErroCaixa && e.message === ERRO_SEM_0034 ? ERRO_SEM_0034 : 'Não foi possível concluir o fechamento do mês. Tente de novo.';
  return Response.json({ erro }, { status });
}

const erroBanco = (onde: string, e: { message: string }) => new ErroCaixa(`${onde}: ${e.message}`, 502);

function anoDe(v: unknown): number {
  const ano = Number(v);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new ErroCaixa('Ano inválido.');
  return ano;
}

async function alvo(body: Record<string, unknown>, sessao: Sessao) {
  const empresa = String(body.empresa ?? '').trim();
  if (!empresa) throw new ErroCaixa('Informe a empresa.');
  { const n = await motivoNegado(sessao, empresa); if (n) throw new ErroCaixa(n.erro, n.status); }

  const ano = anoDe(body.ano);
  const mes = Number(body.mes);
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) throw new ErroCaixa('Mês inválido.');

  const ex = await garantirExercicio(empresa, ano);
  return { exercicioId: ex.id, ano, mes };
}

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  const empresa = req.nextUrl.searchParams.get('empresa') ?? '';
  const e = await exigirEmpresa(req, empresa);
  if (!e.ok) return e.resposta;
  try {
    const ano = anoDe(req.nextUrl.searchParams.get('ano'));
    const ex = await garantirExercicio(empresa, ano);
    const [fechados, historico] = await Promise.all([fechamentosDoExercicio(ex.id), historicoDoExercicio(ex.id)]);
    return Response.json({ fechados, historico: historico ?? [], historicoDisponivel: historico !== null });
  } catch (err) {
    return falha(err);
  }
}

export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const { exercicioId, ano, mes } = await alvo(await req.json().catch(() => ({})), g.sessao);
    const db = getDb();
    const fechados = await mesesConfirmados(exercicioId);
    // Já fechado: nada muda (quem fechou e quando continuam os de antes).
    if (fechados.includes(mes)) return Response.json({ ok: true, confirmado: true, jaFechado: true });
    // Em ordem: o saldo transportado deste mês vem dos anteriores.
    const abertos = Array.from({ length: mes - 1 }, (_, i) => i + 1).filter((m) => !fechados.includes(m));
    if (abertos.length) throw new ErroCaixa(mensagemFecharEmOrdem(ano, abertos), 409);

    const em = new Date().toISOString();
    const { error } = await db.from('meses_confirmados').upsert(
      { exercicio_id: exercicioId, mes, confirmado_por: g.sessao.email, confirmado_em: em },
      { onConflict: 'exercicio_id,mes' },
    );
    if (error) throw erroBanco('meses_confirmados', error);
    // Histórico: sem a 0034 o fechamento vale assim mesmo (quem e quando já ficam em meses_confirmados).
    const { error: eh } = await db.from('caixa_meses_historico')
      .insert({ exercicio_id: exercicioId, mes, acao: 'fechou', por: g.sessao.email, em });
    if (eh && !semTabelaHistorico(eh)) console.error('[caixa/meses] histórico do fechamento:', eh.message.slice(0, 120));
    return Response.json({ ok: true, confirmado: true });
  } catch (e) {
    return falha(e);
  }
}

/** Reabre o mês e os fechados depois dele. Só a contabilidade, e sempre com o motivo (fica no histórico). */
export async function DELETE(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json().catch(() => ({}));
    const { exercicioId, mes } = await alvo(body, g.sessao);
    const motivo = motivoReabertura(body.motivo);
    if (!motivo) throw new ErroCaixa(ERRO_MOTIVO, 400);

    const db = getDb();
    const reabrir = (await mesesConfirmados(exercicioId)).filter((m) => m >= mes);
    if (!reabrir.includes(mes)) return Response.json({ ok: true, confirmado: false, jaAberto: true, reabertos: [] });

    // Primeiro o registro (sem ele não reabre: o motivo não pode se perder), depois a reabertura.
    const em = new Date().toISOString();
    const { data: regs, error: eh } = await db.from('caixa_meses_historico')
      .insert(reabrir.map((m) => ({ exercicio_id: exercicioId, mes: m, acao: 'reabriu', por: g.sessao.email, em, motivo })))
      .select('id');
    if (eh) throw semTabelaHistorico(eh) ? new ErroCaixa(ERRO_SEM_0034, 503) : erroBanco('caixa_meses_historico', eh);

    const { error } = await db.from('meses_confirmados').delete().eq('exercicio_id', exercicioId).in('mes', reabrir);
    if (error) {
      const ids = (regs ?? []).map((r: { id: string }) => r.id);
      if (ids.length) await db.from('caixa_meses_historico').delete().in('id', ids);
      throw erroBanco('meses_confirmados', error);
    }
    return Response.json({ ok: true, confirmado: false, reabertos: reabrir });
  } catch (e) {
    return falha(e);
  }
}
