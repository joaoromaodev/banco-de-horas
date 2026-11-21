// GET  /api/cobranca — resumo da assinatura do escritório (tela Assinatura).
// POST /api/cobranca — { acao: 'assinar' | 'trocar' | 'cancelar' | 'sincronizar' }.
//
// Fica fora do modo somente leitura (é por aqui que o escritório regulariza).
// Ver: o gestor do escritório; agir: só o administrador do escritório. O
// `cliente` não alcança (proxy). Regras em lib/cobranca.ts; docs/cobranca.md.
import { NextRequest } from 'next/server';
import { exigirAdminEscritorio, exigirGestor } from '@/lib/acesso';
import {
  calcularTroca, comGateway, documentoValido, ehCiclo, ehPlanoPago, hojeEm, limiteEmpresas, planoEfetivo,
  planoMinimoPara, PLANOS, preco, primeiroVencimento, situacaoEfetiva, soDigitos, somarDias,
  CARENCIA_DIAS, NOME_PLANO, type Ciclo, type PlanoPago,
} from '@/lib/cobranca';
import {
  adquirirTrava, contarEmpresas, estadoCobranca, liberarTrava, lerPagamentos, marcarAbertasRemovidas,
  paraEstado, recalcular, salvarAssinatura, salvarPagamento, type Assinatura,
} from '@/lib/cobrancaServidor';
import {
  atualizarAssinatura, cancelarAssinatura, cobrancasDaAssinatura, configGateway, criarAssinatura,
  criarCliente, criarCobrancaAvulsa, ErroGateway,
} from '@/lib/gatewayAsaas';

export const runtime = 'nodejs';

const json = (dados: unknown, status = 200) => Response.json(dados, { status });

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  const escritorioId = g.sessao.escritorioId;
  if (!escritorioId) return json({ erro: 'A assinatura é de cada escritório; o administrador da plataforma não tem uma.' }, 400);
  try {
    const est = await estadoCobranca(escritorioId);
    if (!est) return json({ erro: 'Escritório não encontrado.' }, 404);
    const estado = paraEstado(est.escritorio, est.assinatura);
    const plano = planoEfetivo(estado);
    const cfg = configGateway();
    const [empresas, pagamentos] = await Promise.all([contarEmpresas(escritorioId), lerPagamentos(escritorioId, cfg?.ambiente)]);
    const a = est.assinatura;
    return json({
      configurada: Boolean(cfg),
      ambiente: cfg?.ambiente ?? null,
      podeGerenciar: Boolean(g.sessao.adminEscritorio),
      escritorio: { nome: est.escritorio.nome, plano: est.escritorio.plano, testeAte: est.escritorio.testeAte },
      situacao: comGateway(situacaoEfetiva(estado), Boolean(cfg)),
      plano, nomePlano: NOME_PLANO[plano],
      empresas, limite: limiteEmpresas(plano),
      carenciaDias: CARENCIA_DIAS,
      assinatura: a && {
        plano: a.plano, ciclo: a.ciclo, valor: a.valor, status: a.status,
        proximoVencimento: a.proximoVencimento, pagoAte: a.pagoAte, inadimplenteDesde: a.inadimplenteDesde,
        planoAgendado: a.planoAgendado ?? null, cicloAgendado: a.cicloAgendado ?? null, agendadoAPartir: a.agendadoAPartir ?? null,
        outroAmbiente: Boolean(cfg && a.ambiente !== cfg.ambiente),
      },
      pagamentos: pagamentos.map(({ periodoAte: _p, ambiente: _a, ...resto }) => { void _p; void _a; return resto; }),
      planos: PLANOS,
    });
  } catch {
    return json({ erro: 'Não foi possível ler a assinatura agora.' }, 502);
  }
}

export async function POST(req: NextRequest) {
  const g = await exigirAdminEscritorio(req);
  if (!g.ok) return g.resposta;
  const escritorioId = g.sessao.escritorioId!;
  const body = await req.json().catch(() => null);
  const acao = String(body?.acao ?? '');

  const cfg = configGateway();
  if (!cfg) return json({ erro: 'A cobrança ainda não foi configurada. Fale com o suporte do ClickContas.' }, 503);
  // Um clique duplo (ou duas abas, em instâncias diferentes) não pode criar
  // duas assinaturas no gateway: trava por escritório no banco.
  try {
    if (!(await adquirirTrava(escritorioId))) {
      return json({ erro: 'Já há uma operação de assinatura em andamento. Aguarde um instante.' }, 409);
    }
  } catch {
    return json({ erro: 'Não foi possível concluir agora. Tente de novo em instantes.' }, 502);
  }

  try {
    const est = await estadoCobranca(escritorioId);
    if (!est) return json({ erro: 'Escritório não encontrado.' }, 404);
    if (est.escritorio.plano === 'fundador') return json({ erro: 'O plano Fundador é gratuito e não precisa de assinatura.' }, 400);
    const atual = est.assinatura;
    const hoje = hojeEm();

    // A assinatura foi criada no sandbox e agora o app fala com a produção (ou o
    // contrário): os ids não existem do outro lado.
    const outroAmbiente = atual && atual.ambiente !== cfg.ambiente;

    if (acao === 'assinar') {
      const plano = body?.plano, ciclo = body?.ciclo;
      if (!ehPlanoPago(plano) || !ehCiclo(ciclo)) return json({ erro: 'Escolha o plano e a forma de cobrança (mensal ou anual).' }, 400);
      if (atual && atual.status !== 'cancelada' && !outroAmbiente) {
        return json({ erro: 'O escritório já tem uma assinatura. Para mudar de plano, use "Trocar de plano".' }, 409);
      }
      const doc = soDigitos(body?.documento);
      if (!documentoValido(doc)) return json({ erro: 'Informe um CPF ou CNPJ válido para a cobrança.' }, 400);
      const empresas = await contarEmpresas(escritorioId);
      const lim = PLANOS[plano].limite;
      if (lim !== null && empresas > lim) {
        return json({ erro: `O escritório tem ${empresas} empresas e o ${PLANOS[plano].nome} comporta ${lim}. Escolha o ${PLANOS[planoMinimoPara(empresas)].nome} ou superior.` }, 400);
      }

      // Reassinar depois de cancelar: o período já pago continua valendo e a
      // primeira cobrança nova vence no dia seguinte a ele.
      let vencimento = primeiroVencimento(est.escritorio.testeAte);
      if (!outroAmbiente && atual?.pagoAte && atual.pagoAte >= hoje) {
        const dep = somarDias(atual.pagoAte, 1);
        if (dep > vencimento) vencimento = dep;
      }
      const cliente = !outroAmbiente && atual?.clienteGatewayId
        ? atual.clienteGatewayId
        : await criarCliente({ nome: est.escritorio.nome, cpfCnpj: doc, email: g.sessao.email, referencia: escritorioId });
      const valor = preco(plano, ciclo);
      const sub = await criarAssinatura({
        cliente, valor, ciclo, vencimento,
        descricao: `ClickContas — plano ${PLANOS[plano].nome} (${ciclo})`,
        referencia: escritorioId,
      });
      const nova: Assinatura = {
        escritorioId, ambiente: cfg.ambiente, clienteGatewayId: cliente, assinaturaGatewayId: sub,
        plano, ciclo, valor, status: 'pendente', proximoVencimento: vencimento,
        pagoAte: outroAmbiente ? null : (atual?.pagoAte ?? null), inadimplenteDesde: null,
        planoAgendado: null, cicloAgendado: null, agendadoAPartir: null, canceladaEm: null,
      };
      try {
        await salvarAssinatura(nova);
      } catch (e) {
        // Não deixar uma assinatura cobrando no Asaas sem registro do nosso lado.
        await cancelarAssinatura(sub).catch((e2) => console.error('[cobranca] assinatura órfã', sub, e2));
        throw e;
      }
      const link = await sincronizarCobrancas(escritorioId, sub);
      return json({ ok: true, link, mensagem: link ? 'Assinatura criada. Abra a fatura para pagar com Pix, boleto ou cartão.' : 'Assinatura criada. A fatura aparece aqui em instantes.' });
    }

    if (!atual || atual.status === 'cancelada' || !atual.assinaturaGatewayId) {
      return json({ erro: 'O escritório não tem assinatura ativa.' }, 400);
    }
    if (outroAmbiente) {
      return json({ erro: 'Esta assinatura foi criada em outro ambiente de cobrança. Assine de novo.' }, 409);
    }

    if (acao === 'sincronizar') {
      const link = await sincronizarCobrancas(escritorioId, atual.assinaturaGatewayId);
      return json({ ok: true, link, mensagem: 'Cobranças atualizadas.' });
    }

    if (acao === 'cancelar') {
      await cancelarAssinatura(atual.assinaturaGatewayId);
      await marcarAbertasRemovidas(escritorioId, atual.assinaturaGatewayId);
      const nova = await recalcular(escritorioId, { status: 'cancelada', canceladaEm: new Date().toISOString(), planoAgendado: null, cicloAgendado: null, agendadoAPartir: null });
      const ate = nova?.pagoAte && nova.pagoAte >= hoje ? nova.pagoAte : null;
      return json({
        ok: true,
        mensagem: ate
          ? `Assinatura cancelada. O escritório segue com acesso completo até ${ate.split('-').reverse().join('/')}; depois, fica em somente leitura — nada é apagado.`
          : 'Assinatura cancelada. O escritório fica em somente leitura — nada é apagado, e dá para assinar de novo quando quiser.',
      });
    }

    if (acao === 'trocar') {
      const planoNovo = body?.plano as PlanoPago, cicloNovo = body?.ciclo as Ciclo;
      if (!ehPlanoPago(planoNovo) || !ehCiclo(cicloNovo)) return json({ erro: 'Escolha o plano e a forma de cobrança.' }, 400);
      const empresas = await contarEmpresas(escritorioId);
      const lim = PLANOS[planoNovo].limite;
      if (lim !== null && empresas > lim) {
        return json({ erro: `O escritório tem ${empresas} empresas e o ${PLANOS[planoNovo].nome} comporta ${lim}. Remova empresas ou escolha um plano maior.` }, 400);
      }
      const r = calcularTroca({
        planoAtual: atual.plano, cicloAtual: atual.ciclo, planoNovo, cicloNovo,
        pagoAte: atual.pagoAte, hoje,
      });
      if (r.tipo === 'nada') {
        // Desfazer uma troca agendada: voltar ao plano/ciclo atuais.
        if (atual.planoAgendado || atual.cicloAgendado) {
          await atualizarAssinatura(atual.assinaturaGatewayId, { valor: preco(atual.plano, atual.ciclo), ciclo: atual.ciclo });
          await recalcular(escritorioId, { valor: preco(atual.plano, atual.ciclo), planoAgendado: null, cicloAgendado: null, agendadoAPartir: null });
          return json({ ok: true, mensagem: 'Troca agendada desfeita. O plano continua como está.' });
        }
        return json({ erro: 'Este já é o plano atual.' }, 400);
      }

      let link: string | null = null;
      // A cobrança do ajuste sai antes de mudar a assinatura: se o gateway
      // recusar, nada mudou.
      const cobrar = r.tipo === 'subida' || r.tipo === 'agendada' ? r.cobrarAgora : 0;
      if (cobrar > 0) {
        const p = await criarCobrancaAvulsa({
          cliente: atual.clienteGatewayId!, valor: cobrar, vencimento: somarDias(hoje, 3),
          descricao: `ClickContas — ajuste proporcional para o plano ${PLANOS[planoNovo].nome}`,
          referencia: escritorioId,
        });
        await salvarPagamento(escritorioId, p, atual, cfg.ambiente);
        link = p.linkFatura;
      }
      await atualizarAssinatura(atual.assinaturaGatewayId, { valor: r.valorNovo, ciclo: cicloNovo });

      // Grava só o que a troca muda, por cima do estado lido agora (não do lido
      // no começo): um webhook que chegou no meio não é desfeito.
      let mudanca: Partial<Assinatura>;
      let mensagem: string;
      if (r.tipo === 'imediata' || r.tipo === 'subida') {
        mudanca = { plano: planoNovo, ciclo: cicloNovo, valor: r.valorNovo, planoAgendado: null, cicloAgendado: null, agendadoAPartir: null };
        mensagem = `Plano trocado para ${PLANOS[planoNovo].nome}.` + (cobrar > 0 ? ' A diferença proporcional saiu numa cobrança separada.' : '');
      } else {
        const data = r.aPartir.split('-').reverse().join('/');
        mudanca = {
          plano: r.planoJa ?? atual.plano,
          valor: r.valorNovo,
          planoAgendado: r.planoJa ? null : (planoNovo !== atual.plano ? planoNovo : null),
          cicloAgendado: cicloNovo !== atual.ciclo ? cicloNovo : null,
          agendadoAPartir: r.aPartir,
        };
        mensagem = r.planoJa
          ? `Plano ${PLANOS[planoNovo].nome} liberado já; a cobrança ${cicloNovo} começa em ${data}.` + (cobrar > 0 ? ' A diferença proporcional saiu numa cobrança separada.' : '')
          : `Troca agendada: a partir de ${data} o escritório passa para o ${PLANOS[planoNovo].nome} (${cicloNovo}). Até lá, segue no plano atual.`;
      }
      await recalcular(escritorioId, mudanca);
      return json({ ok: true, link, mensagem });
    }

    return json({ erro: 'Ação desconhecida.' }, 400);
  } catch (e) {
    if (e instanceof ErroGateway) return json({ erro: e.message }, e.status);
    console.error('[cobranca]', e);
    return json({ erro: 'Não foi possível concluir agora. Tente de novo em instantes.' }, 502);
  } finally {
    await liberarTrava(escritorioId).catch(() => {});
  }
}

/** Puxa as cobranças da assinatura do gateway, grava e recalcula. Devolve o link da que está em aberto. */
async function sincronizarCobrancas(escritorioId: string, assinaturaGatewayId: string): Promise<string | null> {
  const cfg = configGateway();
  if (!cfg) return null;
  const est = await estadoCobranca(escritorioId);
  const a = est?.assinatura ?? null;
  const cobrancas = await cobrancasDaAssinatura(assinaturaGatewayId);
  for (const p of cobrancas) await salvarPagamento(escritorioId, p, a, cfg.ambiente);
  await recalcular(escritorioId);
  const aberta = cobrancas
    .filter((p) => (p.status === 'pendente' || p.status === 'vencido') && p.linkFatura)
    .sort((x, y) => String(x.vencimento).localeCompare(String(y.vencimento)))[0];
  return aberta?.linkFatura ?? null;
}
