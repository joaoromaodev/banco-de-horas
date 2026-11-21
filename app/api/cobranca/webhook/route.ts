// POST /api/cobranca/webhook — notificações do Asaas (pagamentos e assinaturas).
//
// Pública no proxy (o Asaas não tem sessão); a autenticação é o token que
// configuramos no painel do Asaas e que ele manda no header
// `asaas-access-token`, conferido em tempo constante contra ASAAS_WEBHOOK_TOKEN.
//
// Idempotente: o id do evento (evt_...) é a chave de `cobranca_eventos`; evento
// repetido e já processado só responde 200. O estado da assinatura é recalculado
// a partir de TODAS as cobranças guardadas, então a ordem de chegada não importa.
//
// Respostas: só HTTP 200 conta como sucesso para o Asaas (e 15 falhas seguidas
// pausam a fila). Erro permanente (evento de quem não conhecemos) → 200 com o
// erro registrado; erro passageiro (banco fora) → 500, para ele reenviar.
import { NextRequest } from 'next/server';
import {
  assinaturaPorCliente, assinaturaPorGateway, concluirEvento, ErroAtribuicao, recalcular, registrarEvento, salvarPagamento,
} from '@/lib/cobrancaServidor';
import { buscarPagamento, configGateway, corpoParaGuardar, interpretarWebhook, tokenWebhookValido } from '@/lib/gatewayAsaas';

export const runtime = 'nodejs';

const LIMITE_CORPO = 200_000; // bytes — um evento do Asaas tem poucos KB

export async function POST(req: NextRequest) {
  if (!process.env.ASAAS_WEBHOOK_TOKEN?.trim()) {
    return Response.json({ erro: 'Webhook não configurado.' }, { status: 503 });
  }
  if (!tokenWebhookValido(req.headers.get('asaas-access-token'))) {
    return Response.json({ erro: 'Não autorizado.' }, { status: 401 });
  }

  const bruto = await req.text().catch(() => '');
  if (bruto.length > LIMITE_CORPO) return Response.json({ erro: 'Corpo grande demais.' }, { status: 413 });
  let corpo: unknown;
  try { corpo = JSON.parse(bruto); } catch { return Response.json({ erro: 'JSON inválido.' }, { status: 400 }); }

  const ev = interpretarWebhook(corpo);
  if (!ev) return Response.json({ erro: 'Evento inválido.' }, { status: 400 });

  let registro: Awaited<ReturnType<typeof registrarEvento>>;
  try {
    registro = await registrarEvento({
      id: ev.id, evento: ev.evento,
      pagamentoId: ev.tipo === 'pagamento' ? ev.pagamento.id : null,
      assinaturaId: ev.tipo === 'pagamento' ? ev.pagamento.assinatura : ev.tipo === 'assinatura' ? ev.assinatura : null,
      payload: corpoParaGuardar(corpo),
    });
  } catch (e) {
    console.error('[webhook cobranca] registrar', e);
    return Response.json({ erro: 'Falha ao registrar.' }, { status: 500 });
  }
  if (registro === 'repetido') return Response.json({ ok: true, repetido: true });

  try {
    if (ev.tipo === 'ignorado') {
      await concluirEvento(ev.id, {});
      return Response.json({ ok: true });
    }

    if (ev.tipo === 'pagamento') {
      const cfg = configGateway();
      if (!cfg) throw new Error('Cobrança não configurada.'); // passageiro: o Asaas reenvia
      // O corpo diz QUAL cobrança mudou; o estado dela vem da API do Asaas. Assim
      // um token vazado não basta para marcar uma cobrança como paga, e uma
      // cobrança de outro ambiente (sandbox × produção) simplesmente não existe aqui.
      // Removida: a API ainda a devolve com `deleted` (ou 404) — só então vale a remoção.
      const p = (await buscarPagamento(ev.pagamento.id)) ?? (ev.evento === 'PAYMENT_DELETED' ? ev.pagamento : null);
      if (!p) {
        await concluirEvento(ev.id, { erro: 'Cobrança não encontrada neste ambiente do Asaas.' });
        return Response.json({ ok: true, ignorado: true });
      }
      // O escritório sai do que NÓS guardamos (id da assinatura ou do cliente no
      // gateway) — nunca de um campo livre do corpo.
      const a = (p.assinatura ? await assinaturaPorGateway(p.assinatura) : null)
        ?? (p.cliente ? await assinaturaPorCliente(p.cliente) : null);
      if (!a || a.ambiente !== cfg.ambiente) {
        await concluirEvento(ev.id, { erro: 'Cobrança de cliente desconhecido.' });
        return Response.json({ ok: true, ignorado: true });
      }
      try {
        await salvarPagamento(a.escritorioId, p, a, cfg.ambiente);
      } catch (e) {
        if (!(e instanceof ErroAtribuicao)) throw e;
        await concluirEvento(ev.id, { erro: e.message });
        return Response.json({ ok: true, ignorado: true });
      }
      await recalcular(a.escritorioId);
      await concluirEvento(ev.id, { escritorioId: a.escritorioId });
      return Response.json({ ok: true });
    }

    // Eventos de assinatura: só o encerramento muda algo do nosso lado (o resto
    // chega pelos eventos de pagamento).
    const a = await assinaturaPorGateway(ev.assinatura);
    if (!a) {
      await concluirEvento(ev.id, { erro: 'Assinatura desconhecida.' });
      return Response.json({ ok: true, ignorado: true });
    }
    if (ev.encerrada && a.status !== 'cancelada') {
      await recalcular(a.escritorioId, { status: 'cancelada', canceladaEm: new Date().toISOString() });
    }
    await concluirEvento(ev.id, { escritorioId: a.escritorioId });
    return Response.json({ ok: true });
  } catch (e) {
    console.error('[webhook cobranca] processar', e);
    await concluirEvento(ev.id, { erro: e instanceof Error ? e.message : 'falha' }).catch(() => {});
    return Response.json({ erro: 'Falha ao processar.' }, { status: 500 });
  }
}
