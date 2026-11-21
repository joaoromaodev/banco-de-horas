// /api/dp/ferias — programação de férias.
//
// POST  { empregadoId, aquisitivoInicio, inicio, dias, abonoDias?, avisoEm?, pagamentoEm?, observacao? }
//       → valida no servidor com as mesmas regras da tela (lib/ferias.ts: fracionamento,
//         art. 134 §3º, saldo do período) e grava. Erros de regra → 400 com a lista.
// DELETE ?id=            → exclusão lógica (a tela oferece "Desfazer").
// PATCH { id, restaurar } → desfaz a exclusão.
import { NextRequest } from 'next/server';
import { hojeBelem } from '@/lib/agenda';
import { isoOk } from '@/lib/dp';
import { criarFerias, excluirFerias, lerFaltas, lerFerias, listarFerias } from '@/lib/dpServidor';
import { baseAquisitivo, fimDoGozo, periodosAquisitivos, situacaoDoPeriodo, somarAnos, validarProgramacao } from '@/lib/ferias';
import { exigirGestor } from '@/lib/acesso';
import { exigirEmpresaPonto } from '@/lib/pontoAcesso';
import { conjuntoDoEscritorio, exigirEmpregado, respostaErroDp } from '../comum';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ erro: 'Corpo inválido.' }, { status: 400 }); }
  const r = await exigirEmpregado(req, String(body.empregadoId ?? ''));
  if (!r.ok) return r.resposta;
  const { empregado: e, guarda: g } = r;
  try {
    const hoje = hojeBelem();
    const base = baseAquisitivo(e);
    if (!base) return Response.json({ erro: 'Cadastre a data de admissão antes de programar férias.' }, { status: 400 });
    const aquisitivoInicio = String(body.aquisitivoInicio ?? '');
    // Períodos até 1 ano à frente (permite programar o período em aquisição).
    const periodo = periodosAquisitivos(base, somarAnos(hoje, 1)).find((p) => p.inicio === aquisitivoInicio);
    if (!periodo) return Response.json({ erro: 'Período aquisitivo inválido.' }, { status: 400 });

    const [todas, faltas, feriados] = await Promise.all([
      listarFerias(g.escritorioId, { empregadoId: e.id }),
      lerFaltas(g.escritorioId, [e]),
      conjuntoDoEscritorio(g.escritorioId, hoje),
    ]);
    const pedido = {
      aquisitivoInicio, inicio: String(body.inicio ?? ''), dias: Number(body.dias), abonoDias: Number(body.abonoDias ?? 0),
      avisoEm: isoOk(body.avisoEm) ? body.avisoEm : null,
    };
    const v = validarProgramacao(pedido, {
      empregado: e, periodo: situacaoDoPeriodo(periodo, faltas.get(e.id) ?? [], todas, hoje), todas, feriados, hoje,
    });
    if (v.erros.length) return Response.json({ erro: v.erros.join(' '), erros: v.erros, avisos: v.avisos }, { status: 400 });

    const ferias = await criarFerias(g.escritorioId, {
      empregadoId: e.id, empresaId: e.empresaId, aquisitivoInicio, inicio: pedido.inicio, dias: pedido.dias,
      abonoDias: pedido.abonoDias, avisoEm: pedido.avisoEm,
      pagamentoEm: isoOk(body.pagamentoEm) ? body.pagamentoEm : v.pagamentoAte,
      observacao: String(body.observacao ?? '').trim().slice(0, 300) || null,
    }, g.sessao.email);
    return Response.json({ ferias, avisos: v.avisos });
  } catch (err) { return respostaErroDp(err, 'Falha ao programar as férias.'); }
}

/** Carrega a programação e confere o acesso pela empresa dela. */
async function exigirFerias(req: NextRequest, id: string) {
  const g0 = await exigirGestor(req);
  if (!g0.ok) return { ok: false as const, resposta: g0.resposta };
  const f = await lerFerias(id);
  if (!f) return { ok: false as const, resposta: Response.json({ erro: 'Férias não encontradas.' }, { status: 404 }) };
  const g = await exigirEmpresaPonto(req, f.empresaId);
  if (!g.ok) return g;
  if (g.escritorioId !== f.escritorioId) return { ok: false as const, resposta: Response.json({ erro: 'Acesso restrito a esta empresa.' }, { status: 403 }) };
  return { ok: true as const, ferias: f, guarda: g };
}

export async function DELETE(req: NextRequest) {
  try {
    const r = await exigirFerias(req, req.nextUrl.searchParams.get('id') ?? '');
    if (!r.ok) return r.resposta;
    await excluirFerias(r.guarda.escritorioId, r.ferias.id, r.guarda.sessao.email);
    return Response.json({ ok: true });
  } catch (err) { return respostaErroDp(err, 'Falha ao excluir as férias.'); }
}

export async function PATCH(req: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return Response.json({ erro: 'Corpo inválido.' }, { status: 400 }); }
    if (!body.restaurar) return Response.json({ erro: 'Nada a fazer.' }, { status: 400 });
    const r = await exigirFerias(req, String(body.id ?? ''));
    if (!r.ok) return r.resposta;
    if (r.ferias.excluida) {
      // Desfazer não pode criar sobreposição com o que foi programado no meio tempo.
      const ativas = await listarFerias(r.guarda.escritorioId, { empregadoId: r.ferias.empregadoId });
      const choque = ativas.find((f) => f.inicio <= fimDoGozo(r.ferias) && fimDoGozo(f) >= r.ferias.inicio);
      if (choque) return Response.json({ erro: 'Não dá para desfazer: já há outras férias programadas nesse intervalo.' }, { status: 409 });
    }
    await excluirFerias(r.guarda.escritorioId, r.ferias.id, r.guarda.sessao.email, true);
    return Response.json({ ok: true });
  } catch (err) { return respostaErroDp(err, 'Falha ao desfazer.'); }
}
