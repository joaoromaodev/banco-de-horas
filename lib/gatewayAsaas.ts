// Cliente do gateway de cobrança — Asaas (API v3). Só de servidor.
//
// Isolado atrás de variáveis de ambiente; sem `ASAAS_API_KEY` o resto do app
// trata a cobrança como "ainda não configurada" e nada quebra. A parte de
// tradução (status e eventos do webhook) é pura e testada em
// tests/gatewayAsaas.test.ts. Fatos da API conferidos em docs.asaas.com
// (21/11/2026) — ver docs/cobranca.md.
import { createHash, timingSafeEqual } from 'crypto';
import type { Ciclo, StatusPagamento } from './cobranca';

export type AmbienteGateway = 'sandbox' | 'producao';

export interface ConfigGateway {
  apiKey: string;
  ambiente: AmbienteGateway;
  baseUrl: string;
}

const BASE: Record<AmbienteGateway, string> = {
  sandbox: 'https://api-sandbox.asaas.com/v3',
  producao: 'https://api.asaas.com/v3',
};

/**
 * Configuração a partir do ambiente, ou `null` se a cobrança não está configurada.
 *
 * O ambiente sai de `ASAAS_AMBIENTE` (`producao` | `sandbox`) e é conferido
 * contra o prefixo da chave (`$aact_prod_` × `$aact_hmlg_`): chave de um
 * ambiente com o outro declarado = configuração inválida (`null`), para uma
 * assinatura de sandbox nunca liberar acesso em produção. Sem `ASAAS_AMBIENTE`,
 * vale o que o prefixo diz; prefixo desconhecido e nada declarado = sandbox.
 */
export function configGateway(env: Record<string, string | undefined> = process.env): ConfigGateway | null {
  const apiKey = env.ASAAS_API_KEY?.trim();
  if (!apiKey) return null;
  const pelaChave: AmbienteGateway | null =
    apiKey.startsWith('$aact_prod_') ? 'producao' : apiKey.startsWith('$aact_hmlg_') ? 'sandbox' : null;
  const declarado = env.ASAAS_AMBIENTE?.trim();
  const pelaVariavel: AmbienteGateway | null = declarado === 'producao' ? 'producao' : declarado === 'sandbox' ? 'sandbox' : null;
  if (declarado && !pelaVariavel) return null; // valor estranho: não adivinhamos
  if (pelaChave && pelaVariavel && pelaChave !== pelaVariavel) return null;
  const ambiente = pelaVariavel ?? pelaChave ?? 'sandbox';
  return { apiKey, ambiente, baseUrl: BASE[ambiente] };
}

export const cobrancaConfigurada = () => configGateway() !== null;

/**
 * Confere o token que o Asaas manda no header `asaas-access-token` contra
 * `ASAAS_WEBHOOK_TOKEN`, em tempo constante (compara os hashes, que têm o mesmo
 * tamanho). Sem token configurado, nada é aceito.
 */
export function tokenWebhookValido(recebido: string | null | undefined, esperado: string | undefined = process.env.ASAAS_WEBHOOK_TOKEN): boolean {
  const e = esperado?.trim();
  if (!e || e.length < 16 || !recebido) return false;
  const h = (s: string) => createHash('sha256').update(s, 'utf8').digest();
  return timingSafeEqual(h(recebido), h(e));
}

// ---------------------------------------------------------------- Tradução
export const CICLO_ASAAS: Record<Ciclo, 'MONTHLY' | 'YEARLY'> = { mensal: 'MONTHLY', anual: 'YEARLY' };

/** Status do pagamento no Asaas → status neutro. Desconhecido conta como pendente. */
export function traduzirStatus(status: string | undefined, evento?: string): StatusPagamento {
  if (evento === 'PAYMENT_DELETED') return 'removido';
  switch (status) {
    case 'RECEIVED': case 'CONFIRMED': case 'RECEIVED_IN_CASH': return 'pago';
    case 'OVERDUE': return 'vencido';
    case 'REFUNDED': case 'REFUND_REQUESTED': case 'REFUND_IN_PROGRESS':
    case 'CHARGEBACK_REQUESTED': case 'CHARGEBACK_DISPUTE': case 'AWAITING_CHARGEBACK_REVERSAL':
      return 'estornado';
    default: return 'pendente';
  }
}

/** Cobrança do Asaas no formato que guardamos (`cobranca_pagamentos`). */
export interface PagamentoGateway {
  id: string;
  cliente: string | null;
  assinatura: string | null;
  referencia: string | null;
  descricao: string | null;
  valor: number;
  vencimento: string | null;
  statusGateway: string;
  status: StatusPagamento;
  forma: string | null;
  linkFatura: string | null;
  pagoEm: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const texto = (v: any): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const dia = (v: any): string | null => { const t = texto(v); return t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null; };

export function lerPagamento(p: any, evento?: string): PagamentoGateway | null {
  const id = texto(p?.id);
  if (!id) return null;
  const valor = Number(p.value);
  return {
    id,
    cliente: texto(p.customer),
    assinatura: texto(p.subscription),
    referencia: texto(p.externalReference),
    descricao: texto(p.description)?.slice(0, 300) ?? null,
    valor: Number.isFinite(valor) ? valor : 0,
    vencimento: dia(p.dueDate),
    statusGateway: evento === 'PAYMENT_DELETED' ? 'DELETED' : (texto(p.status) ?? 'PENDING'),
    status: traduzirStatus(texto(p.status) ?? undefined, evento),
    forma: texto(p.billingType),
    // Só aceitamos link https do próprio Asaas — o link vai para um botão na tela.
    linkFatura: linkAsaas(texto(p.invoiceUrl)),
    pagoEm: dia(p.clientPaymentDate) ?? dia(p.paymentDate) ?? dia(p.confirmedDate),
  };
}

export function linkAsaas(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'asaas.com' || u.hostname.endsWith('.asaas.com')) ? u.toString() : null;
  } catch {
    return null;
  }
}

export type EventoWebhook =
  | { tipo: 'pagamento'; id: string; evento: string; pagamento: PagamentoGateway }
  | { tipo: 'assinatura'; id: string; evento: string; assinatura: string; encerrada: boolean }
  | { tipo: 'ignorado'; id: string; evento: string };

/** Eventos de assinatura que encerram a cobrança recorrente. */
const ASSINATURA_ENCERRADA = new Set(['SUBSCRIPTION_DELETED', 'SUBSCRIPTION_INACTIVATED']);

/** Lê o corpo do webhook. `null` = corpo inválido (sem id/evento). */
export function interpretarWebhook(corpo: any): EventoWebhook | null {
  const id = texto(corpo?.id);
  const evento = texto(corpo?.event);
  if (!id || !evento || id.length > 200 || evento.length > 100) return null;
  if (evento.startsWith('PAYMENT_')) {
    const pagamento = lerPagamento(corpo.payment, evento);
    return pagamento ? { tipo: 'pagamento', id, evento, pagamento } : { tipo: 'ignorado', id, evento };
  }
  if (evento.startsWith('SUBSCRIPTION_')) {
    const assinatura = texto(corpo.subscription?.id);
    if (!assinatura) return { tipo: 'ignorado', id, evento };
    return { tipo: 'assinatura', id, evento, assinatura, encerrada: ASSINATURA_ENCERRADA.has(evento) };
  }
  return { tipo: 'ignorado', id, evento };
}

/**
 * O que guardamos do corpo bruto: lista do que PODE ficar (ids, evento, status,
 * valores, datas) — nada de cartão, token ou dado do pagador.
 */
export function corpoParaGuardar(corpo: any): Record<string, unknown> {
  const pegar = (o: any, campos: string[]) => {
    if (!o || typeof o !== 'object') return undefined;
    const r: Record<string, unknown> = {};
    for (const c of campos) if (o[c] !== undefined && (typeof o[c] !== 'object' || o[c] === null)) r[c] = o[c];
    return r;
  };
  const c = corpo ?? {};
  const saida: Record<string, unknown> = pegar(c, ['id', 'event', 'dateCreated']) ?? {};
  const pg = pegar(c.payment, [
    'id', 'customer', 'subscription', 'value', 'netValue', 'dueDate', 'status', 'billingType', 'paymentDate',
    'clientPaymentDate', 'confirmedDate', 'invoiceUrl', 'externalReference', 'description', 'deleted',
  ]);
  if (pg) saida.payment = pg;
  const sub = pegar(c.subscription, ['id', 'customer', 'status', 'cycle', 'value', 'nextDueDate', 'deleted', 'externalReference']);
  if (sub) saida.subscription = sub;
  return saida;
}

// ---------------------------------------------------------------- HTTP
export class ErroGateway extends Error {
  constructor(msg: string, public status = 502) { super(msg); }
}

async function chamar<T = any>(cfg: ConfigGateway, metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  let r: Response;
  try {
    r = await fetch(cfg.baseUrl + caminho, {
      method: metodo,
      headers: {
        access_token: cfg.apiKey,
        'Content-Type': 'application/json',
        // Obrigatório para contas criadas desde 13/06/2024.
        'User-Agent': 'ClickContas/1.0',
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    });
  } catch {
    throw new ErroGateway('Não foi possível falar com o Asaas agora. Tente de novo em instantes.');
  }
  const dados = await r.json().catch(() => null);
  if (!r.ok) {
    // A mensagem do Asaas é útil ao usuário (ex.: "CPF/CNPJ inválido") e não traz segredo.
    const msg = texto(dados?.errors?.[0]?.description) ?? `O Asaas recusou a operação (HTTP ${r.status}).`;
    throw new ErroGateway(msg.slice(0, 300), r.status >= 500 ? 502 : r.status === 404 ? 404 : 400);
  }
  return dados as T;
}

function exigirConfig(): ConfigGateway {
  const cfg = configGateway();
  if (!cfg) throw new ErroGateway('A cobrança ainda não foi configurada.', 503);
  return cfg;
}

export async function criarCliente(d: { nome: string; cpfCnpj: string; email: string; referencia: string }): Promise<string> {
  const r = await chamar(exigirConfig(), 'POST', '/customers', {
    name: d.nome.slice(0, 100), cpfCnpj: d.cpfCnpj, email: d.email, externalReference: d.referencia,
  });
  const id = texto(r?.id);
  if (!id) throw new ErroGateway('O Asaas não devolveu o cliente criado.');
  return id;
}

/**
 * A cobrança como o Asaas a tem AGORA (o webhook não é a fonte do status: com o
 * token vazado, alguém marcaria qualquer cobrança como paga). `null` se ela não
 * existe neste ambiente.
 */
export async function buscarPagamento(id: string): Promise<PagamentoGateway | null> {
  const cfg = exigirConfig();
  try {
    const r = await chamar(cfg, 'GET', `/payments/${encodeURIComponent(id)}`);
    return lerPagamento(r, r?.deleted ? 'PAYMENT_DELETED' : undefined);
  } catch (e) {
    if (e instanceof ErroGateway && e.status === 404) return null;
    throw e;
  }
}

export async function criarAssinatura(d: {
  cliente: string; valor: number; ciclo: Ciclo; vencimento: string; descricao: string; referencia: string;
}): Promise<string> {
  const r = await chamar(exigirConfig(), 'POST', '/subscriptions', {
    customer: d.cliente,
    // UNDEFINED: o escritório escolhe Pix, boleto ou cartão na própria fatura.
    billingType: 'UNDEFINED',
    value: d.valor,
    nextDueDate: d.vencimento,
    cycle: CICLO_ASAAS[d.ciclo],
    description: d.descricao,
    externalReference: d.referencia,
  });
  const id = texto(r?.id);
  if (!id) throw new ErroGateway('O Asaas não devolveu a assinatura criada.');
  return id;
}

export async function cobrancasDaAssinatura(assinatura: string): Promise<PagamentoGateway[]> {
  const r = await chamar(exigirConfig(), 'GET', `/subscriptions/${encodeURIComponent(assinatura)}/payments?limit=100`);
  return (Array.isArray(r?.data) ? r.data : []).map((p: any) => lerPagamento(p)).filter(Boolean) as PagamentoGateway[];
}

/** Novo valor/ciclo para as próximas cobranças e as pendentes já geradas. */
export async function atualizarAssinatura(assinatura: string, d: { valor: number; ciclo: Ciclo }): Promise<void> {
  await chamar(exigirConfig(), 'PUT', `/subscriptions/${encodeURIComponent(assinatura)}`, {
    value: d.valor, cycle: CICLO_ASAAS[d.ciclo], updatePendingPayments: true,
  });
}

/** Encerra a assinatura. O Asaas apaga as cobranças pendentes/vencidas; as pagas ficam. */
export async function cancelarAssinatura(assinatura: string): Promise<void> {
  await chamar(exigirConfig(), 'DELETE', `/subscriptions/${encodeURIComponent(assinatura)}`);
}

export async function criarCobrancaAvulsa(d: {
  cliente: string; valor: number; vencimento: string; descricao: string; referencia: string;
}): Promise<PagamentoGateway> {
  const r = await chamar(exigirConfig(), 'POST', '/payments', {
    customer: d.cliente, billingType: 'UNDEFINED', value: d.valor, dueDate: d.vencimento,
    description: d.descricao, externalReference: d.referencia,
  });
  const p = lerPagamento(r);
  if (!p) throw new ErroGateway('O Asaas não devolveu a cobrança criada.');
  return p;
}
