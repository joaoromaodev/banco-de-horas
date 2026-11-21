// GET /api/cron/agenda — resumo por e-mail da agenda de obrigações.
//
// Chamado pela Vercel Cron (vercel.json) uma vez por dia — o plano Hobby só
// permite cron diário e dispara em qualquer minuto da hora marcada. A rota é
// pública no proxy (`/api/cron` em PUBLICO) e se protege sozinha: a Vercel manda
// `Authorization: Bearer <CRON_SECRET>`. Sem CRON_SECRET configurado, recusa tudo.
//
// A Vercel não refaz chamada que falhou e às vezes chama duas vezes: a tabela
// `agenda_envios` (chave escritório + dia) garante um envio por escritório por dia.
//
// Também abre as pendências mensais (lib/fechamentoServidor). `?dia=AAAA-MM-DD` simula outro dia (para testar em produção; a trava vale para
// o dia simulado).
import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';
import {
  Calendario, chaveConclusao, deveEnviar, emailDoResumo, Frequencia, hojeBelem, isoValida, ItemResumo,
  montarResumo, ocorrenciasDe, resumoVazio, somarDias,
} from '@/lib/agenda';
import {
  AVISO_PADRAO, avisosDe, concluirEnvio, destinatariosDoAviso, equipeDoEscritorio, escritoriosComAgenda,
  listarConclusoes, listarObrigacoes, reservarEnvio,
} from '@/lib/agendaServidor';
import { lerEmpresas } from '@/lib/cadastro';
import { lerEscritorios } from '@/lib/escritorios';
import { enviarEmail } from '@/lib/email';
import { itensDeContratos } from '@/lib/agendaDerivada';
import { listarEmExperiencia } from '@/lib/contratosServidor';
import { abrirPendenciasRecorrentes, ResultadoAbertura } from '@/lib/fechamentoServidor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Dias à frente que entram no resumo, além das atrasadas e de hoje. */
const JANELA: Record<Exclude<Frequencia, 'desligado'>, number> = { diario: 3, semanal: 7 };
/** Até onde olhar para trás procurando atrasadas. */
const ATRASO_MAX_DIAS = 365;

function autorizado(req: NextRequest): boolean {
  const segredo = process.env.CRON_SECRET?.trim();
  if (!segredo) return false;
  const recebido = Buffer.from(req.headers.get('authorization') ?? '');
  const esperado = Buffer.from(`Bearer ${segredo}`);
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET?.trim()) {
    return Response.json({ erro: 'CRON_SECRET não configurado.' }, { status: 503 });
  }
  if (!autorizado(req)) return Response.json({ erro: 'Não autorizado.' }, { status: 401 });

  const pedido = req.nextUrl.searchParams.get('dia');
  const hoje = isoValida(pedido) ? pedido : hojeBelem();
  const cal = new Calendario();
  const urlAgenda = `${process.env.APP_URL?.trim() || req.nextUrl.origin}/agenda`;
  const relatorio: { escritorio: string; resultado: string }[] = [];

  // Fechamento mensal (0018): abre as pendências recorrentes da competência anterior.
  // Roda todo dia e é idempotente — quem perdeu o dia 1º recupera no dia 2 — e falha
  // sozinho, sem tirar o resumo da agenda do ar.
  let fechamento: ResultadoAbertura | { erro: string };
  try {
    const [empresasAtivas, escritorios] = await Promise.all([lerEmpresas(), lerEscritorios()]);
    const suspensos = new Set(escritorios.filter((e) => e.situacao === 'suspenso').map((e) => e.id));
    const ativas = new Map(empresasAtivas.filter((e) => e.escritorioId && !suspensos.has(e.escritorioId)).map((e) => [e.id, e.escritorioId!]));
    fechamento = await abrirPendenciasRecorrentes(hoje, ativas);
  } catch (e) {
    console.error('[cron agenda] fechamento mensal:', e instanceof Error ? e.message : e);
    fechamento = { erro: e instanceof Error ? e.message : 'falha' };
  }

  try {
    const ids = await escritoriosComAgenda();
    const [avisos, escritorios, empresas] = await Promise.all([avisosDe(ids), lerEscritorios(), lerEmpresas()]);
    const nomeEscritorio = new Map(escritorios.map((e) => [e.id, e]));
    const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.nome]));

    for (const id of ids) {
      const esc = nomeEscritorio.get(id);
      const aviso = avisos.get(id) ?? AVISO_PADRAO;
      const anotar = (resultado: string) => relatorio.push({ escritorio: id, resultado });
      if (!esc || esc.situacao === 'suspenso') { anotar('ignorado (suspenso ou inexistente)'); continue; }
      if (aviso.frequencia === 'desligado' || !deveEnviar(aviso.frequencia, hoje, cal)) { anotar('fora do dia'); continue; }
      try {
        if (!(await reservarEnvio(id, hoje, aviso.frequencia))) { anotar('já processado hoje'); continue; }

        const [obrigacoes, conclusoes, equipe] = await Promise.all([
          listarObrigacoes({ escritorioId: id }),
          listarConclusoes({ escritorioId: id }, Number(hoje.slice(0, 4)) - 2),
          equipeDoEscritorio(id),
        ]);
        const janela = JANELA[aviso.frequencia];
        const maiorAviso = Math.max(janela, ...obrigacoes.map((o) => o.avisoDias));
        const feitas = new Set(conclusoes.map((c) => chaveConclusao(c.obrigacaoId, c.competencia)));
        const porId = new Map(obrigacoes.map((o) => [o.id, o]));
        const itens: (ItemResumo & { avisoDias: number })[] = ocorrenciasDe(
          obrigacoes, somarDias(hoje, -ATRASO_MAX_DIAS), somarDias(hoje, maiorAviso), cal,
        )
          .filter((oc) => !feitas.has(chaveConclusao(oc.obrigacaoId, oc.competencia)))
          .map((oc) => {
            const o = porId.get(oc.obrigacaoId)!;
            return {
              empresa: nomeEmpresa.get(oc.empresaId) ?? oc.empresaId, obrigacao: o.nome,
              competencia: oc.competencia, vencimento: oc.vencimento,
              responsavel: o.responsavel, avisoDias: o.avisoDias,
            };
          });

        // Contratos de experiência: os vencimentos saem dos contratos salvos (nada duplicado).
        // Sem a tabela (0009) ou sem contratos, o resumo segue só com a agenda.
        try {
          const idsEmpresas = empresas.filter((e) => e.escritorioId === id).map((e) => e.id);
          const contratos = await listarEmExperiencia(idsEmpresas);
          for (const c of itensDeContratos(contratos, nomeEmpresa, hoje, janela)) {
            itens.push({ empresa: c.empresa, obrigacao: c.obrigacao, competencia: c.competencia, vencimento: c.vencimento, responsavel: null, avisoDias: 0 });
          }
        } catch (e) { console.error('[cron agenda] contratos:', id, e instanceof Error ? e.message : e); }

        const resumo = montarResumo(itens, hoje, janela);
        const total = resumo.atrasadas.length + resumo.hoje.length + resumo.proximas.length;
        if (resumoVazio(resumo)) {
          await concluirEnvio(id, hoje, { situacao: 'vazio', destinatarios: [], itens: 0 });
          anotar('nada a avisar');
          continue;
        }
        const para = destinatariosDoAviso(aviso, equipe);
        if (!para.length) {
          await concluirEnvio(id, hoje, { situacao: 'falhou', destinatarios: [], itens: total, erro: 'Sem destinatários.' });
          anotar('sem destinatários');
          continue;
        }
        const email = emailDoResumo(resumo, { escritorio: esc.nome, hoje, frequencia: aviso.frequencia, urlAgenda });
        const r = await enviarEmail({ para, ...email });
        await concluirEnvio(id, hoje, {
          situacao: r.situacao, destinatarios: para, itens: total, erro: r.situacao === 'falhou' ? r.erro : undefined,
        });
        anotar(`${r.situacao} (${total} itens, ${para.length} destinatário(s))`);
      } catch (e) {
        console.error('[cron agenda]', id, e);
        anotar('erro');
      }
    }
    return Response.json({ dia: hoje, fechamento, escritorios: relatorio });
  } catch (e) {
    console.error('[cron agenda]', e);
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha.', dia: hoje, fechamento, escritorios: relatorio }, { status: 500 });
  }
}
