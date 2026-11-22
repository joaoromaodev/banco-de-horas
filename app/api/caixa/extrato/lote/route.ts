// /api/caixa/extrato/lote — confirmação EM LOTE do extrato (Sprint 17, Frente D).
//
// POST   { empresa, itens: ItemLote[] } → grava o que a contadora escolheu na
//        conferência: `lancar` (uma ou duas pernas por linha), `casar` (marca a linha
//        como já no caixa) e `ignorar` (não volta nas próximas importações).
//        Devolve `lote` e os ids criados, para o Desfazer.
// DELETE { empresa, lote, lancamentoIds? } → desfaz o lote: apaga os lançamentos
//        criados por ele e as marcas.
//
// Mês fechado (Sprint 17 · C): nada entra nem sai de mês fechado (ou anterior a um
// fechado) — 409 com a mensagem de lib/mesFechado.ts, antes de gravar qualquer coisa.
// Empresa arquivada: 409 para a contabilidade (motivoNegado). Só a contabilidade.
import { NextRequest } from 'next/server';
import { exigirGestor, motivoNegado } from '@/lib/acesso';
import {
  ErroCaixa, exigirCatalogoVisivel, exigirMesAberto, garantirExercicio, validarLancamento, vincularConta, vincularHistorico,
} from '@/lib/caixa';
import { lerEmpresa } from '@/lib/cadastro';
import { getDb } from '@/lib/db';
import { lerLote } from '@/lib/extratoBancario';
import {
  apagarMarcasDoLote, lancamentosDaEmpresa, lancamentosDoLote, reservarMarcas, type MarcaNova,
} from '@/lib/extratoServidor';
import { visaoDoCatalogo } from '@/lib/visibilidadeCatalogo';

export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function falha(e: unknown) {
  if (e instanceof ErroCaixa) return Response.json({ erro: e.message }, { status: e.status });
  console.error('[caixa] extrato lote', e instanceof Error ? e.message : e);
  return Response.json({ erro: 'Não foi possível gravar o extrato agora. Nada foi lançado; tente de novo.' }, { status: 502 });
}

async function guarda(req: NextRequest, empresa: string) {
  const g = await exigirGestor(req);
  if (!g.ok) return g;
  if (!empresa) return { ok: false as const, resposta: Response.json({ erro: 'Informe a empresa.' }, { status: 400 }) };
  const n = await motivoNegado(g.sessao, empresa);
  if (n) return { ok: false as const, resposta: Response.json({ erro: n.erro }, { status: n.status }) };
  return g;
}

const mesFechadoNoBanco = (msg: string) => msg.includes('Mês fechado');

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const empresa = String(body.empresa ?? '').trim();
  const g = await guarda(req, empresa);
  if (!g.ok) return g.resposta;
  try {
    const r = lerLote(body.itens);
    if (!r.ok) throw new ErroCaixa(r.erro);
    const autor = g.sessao.email;
    const visao = visaoDoCatalogo(g.sessao);

    // 1. Monta e valida TUDO antes de gravar (mesma regra da rota de lançamentos).
    const exercicios = new Map<number, string>();
    const exercicioDe = async (ano: number) => {
      if (!exercicios.has(ano)) exercicios.set(ano, (await garantirExercicio(empresa, ano)).id);
      return exercicios.get(ano)!;
    };
    const mesesConferidos = new Set<string>();
    const exigirAberto = async (ano: number, mes: number) => {
      const k = `${ano}-${mes}`;
      if (mesesConferidos.has(k)) return;
      await exigirMesAberto(await exercicioDe(ano), ano, mes);
      mesesConferidos.add(k);
    };

    const t0 = Date.now();
    let seq = 0;
    const linhas: Record<string, unknown>[] = [];
    const marcas: MarcaNova[] = [];
    const contas = new Set<string>(), analiticas = new Set<string>();
    const catalogo = new Set<string>();
    for (const it of r.itens) {
      const ano = Number(it.data.slice(0, 4)), mes = Number(it.data.slice(5, 7));
      const marca: MarcaNova = {
        chave: it.chave, situacao: it.acao === 'lancar' ? 'lancada' : it.acao === 'casar' ? 'casada' : 'ignorada',
        lancamentoIds: [], data: it.data, valor: it.valor, sentido: it.sentido, historicoBanco: it.historicoBanco,
      };
      if (it.acao === 'lancar') {
        await exigirAberto(ano, mes);
        const exercicioId = await exercicioDe(ano);
        for (const p of it.pernas) {
          let l;
          try {
            l = validarLancamento({
              data: it.data, historico: p.historico, historicoId: p.historicoId, complemento: p.complemento,
              contaId: p.contaId, entrada: p.direcao === 'entrada' ? p.valor : 0, saida: p.direcao === 'saida' ? p.valor : 0,
            }, ano);
          } catch (e) {
            if (e instanceof ErroCaixa) throw new ErroCaixa(`Linha de ${it.data.split('-').reverse().join('/')} (${it.historicoBanco || 'extrato'}): ${e.message}`, e.status);
            throw e;
          }
          const k = `${l.contaId ?? ''}|${l.historicoId ?? ''}`;
          if (!catalogo.has(k)) { await exigirCatalogoVisivel(visao, l.contaId, l.historicoId); catalogo.add(k); }
          if (l.contaId) contas.add(l.contaId);
          if (l.historicoId) analiticas.add(l.historicoId);
          const id = crypto.randomUUID();
          marca.lancamentoIds.push(id);
          // `criado_em` explícito: a ordem das pernas (retirada antes do pagamento;
          // recebimento antes do depósito) é a do livro, como no cheque.
          linhas.push({
            id, exercicio_id: exercicioId, data: l.data, historico: l.historico, complemento: l.complemento,
            conta_id: l.contaId, entrada: l.entrada, saida: l.saida, juros: 0, multa: 0,
            criado_por: autor, criado_em: new Date(t0 + seq++).toISOString(),
          });
        }
      } else if (it.acao === 'casar') {
        marca.lancamentoIds = it.lancamentoIds;
      }
      marcas.push(marca);
    }

    // Casadas: os lançamentos citados têm que ser desta empresa.
    const citados = [...new Set(marcas.filter((m) => m.situacao === 'casada').flatMap((m) => m.lancamentoIds))];
    if (citados.length) {
      const daEmpresa = new Set((await lancamentosDaEmpresa(empresa, citados)).map((l) => l.id));
      if (citados.some((id) => !daEmpresa.has(id))) throw new ErroCaixa('Um lançamento casado não é desta empresa. Leia o extrato de novo.', 400);
    }

    // 2. Reserva as marcas (barra a mesma linha duas vezes) e grava os lançamentos.
    const lote = crypto.randomUUID();
    const dados = await lerEmpresa(empresa);
    const registrado = await reservarMarcas({ empresaId: empresa, escritorioId: dados?.escritorioId ?? null, lote, autor, marcas });
    if (linhas.length) {
      const { error } = await getDb().from('lancamentos').insert(linhas);
      if (error) {
        if (registrado) await apagarMarcasDoLote(empresa, lote);
        const msg = error.message.replace(/^.*?(Mês fechado)/, '$1');
        throw new ErroCaixa(mesFechadoNoBanco(error.message) ? msg : `Nada foi lançado: ${msg}`, mesFechadoNoBanco(error.message) ? 409 : 400);
      }
    }

    // A lista da empresa é aberta: o que foi usado entra nela.
    await Promise.all([
      ...[...contas].map((c) => vincularConta(empresa, c)),
      ...[...analiticas].map((h) => vincularHistorico(empresa, h)),
    ]);

    return Response.json({
      ok: true, lote, criados: linhas.length, lancamentoIds: linhas.map((l) => l.id),
      registrado, marcadas: registrado ? marcas.length : 0,
    });
  } catch (e) { return falha(e); }
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const empresa = String(body.empresa ?? '').trim();
  const g = await guarda(req, empresa);
  if (!g.ok) return g.resposta;
  try {
    const lote = String(body.lote ?? '');
    if (!UUID.test(lote)) throw new ErroCaixa('Lote inválido.');
    const informados = Array.isArray(body.lancamentoIds) ? body.lancamentoIds.map(String).filter((x: string) => UUID.test(x)).slice(0, 1000) : [];
    // Os do lote (pelas marcas, 0035) e, sem a 0035, os que a tela guardou.
    const doLote = await lancamentosDoLote(empresa, lote);
    const ids = [...new Set([...(doLote ?? []), ...informados])];
    // Só os desta empresa — id de outra empresa fica de fora (nem é citado).
    const alvo = await lancamentosDaEmpresa(empresa, ids);

    // Mês fechado: nada sai (mesma regra do DELETE de lançamentos).
    const vistos = new Set<string>();
    for (const l of alvo) {
      const k = `${l.exercicioId}-${l.mes}`;
      if (vistos.has(k)) continue;
      await exigirMesAberto(l.exercicioId, l.ano, l.mes);
      vistos.add(k);
    }
    if (alvo.length) {
      const { error } = await getDb().from('lancamentos').delete().in('id', alvo.map((l) => l.id));
      if (error) throw new ErroCaixa(mesFechadoNoBanco(error.message) ? error.message.replace(/^.*?(Mês fechado)/, '$1') : `lancamentos: ${error.message}`, mesFechadoNoBanco(error.message) ? 409 : 502);
    }
    await apagarMarcasDoLote(empresa, lote);
    return Response.json({ ok: true, excluidos: alvo.length });
  } catch (e) { return falha(e); }
}
