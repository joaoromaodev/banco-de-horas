// POST/DELETE /api/caixa/meses — confirmação do mês pela contabilidade.
//
// Confirmar **não trava a edição** (decisão dela): serve para liberar o resumo
// do mês ao cliente. Por isso é só um registro em `meses_confirmados`, sem
// nenhum efeito sobre os lançamentos.
import { NextRequest } from 'next/server';
import { exigirGestor, podeVerEmpresa } from '@/lib/acesso';
import { Sessao } from '@/lib/auth';
import { ErroCaixa, garantirExercicio } from '@/lib/caixa';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';

function falha(e: unknown) {
  if (e instanceof ErroCaixa) return Response.json({ erro: e.message }, { status: e.status });
  return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao confirmar o mês.' }, { status: 502 });
}

async function alvo(req: NextRequest, sessao: Sessao) {
  const body = await req.json();
  const empresa = String(body.empresa ?? '').trim();
  if (!empresa) throw new ErroCaixa('Informe a empresa.');
  if (!podeVerEmpresa(sessao, empresa)) throw new ErroCaixa('Acesso restrito a esta empresa.', 403);

  const ano = Number(body.ano);
  const mes = Number(body.mes);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new ErroCaixa('Ano inválido.');
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) throw new ErroCaixa('Mês inválido.');

  const ex = await garantirExercicio(empresa, ano);
  return { exercicioId: ex.id, mes };
}

export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const { exercicioId, mes } = await alvo(req, g.sessao);
    const { error } = await getDb().from('meses_confirmados').upsert(
      { exercicio_id: exercicioId, mes, confirmado_por: g.sessao.email, confirmado_em: new Date().toISOString() },
      { onConflict: 'exercicio_id,mes' },
    );
    if (error) throw new ErroCaixa(`meses_confirmados: ${error.message}`, 502);
    return Response.json({ ok: true, confirmado: true });
  } catch (e) {
    return falha(e);
  }
}

export async function DELETE(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const { exercicioId, mes } = await alvo(req, g.sessao);
    const { error } = await getDb().from('meses_confirmados')
      .delete().eq('exercicio_id', exercicioId).eq('mes', mes);
    if (error) throw new ErroCaixa(`meses_confirmados: ${error.message}`, 502);
    return Response.json({ ok: true, confirmado: false });
  } catch (e) {
    return falha(e);
  }
}
