import { describe, it, expect } from 'vitest';
import {
  configGateway, corpoParaGuardar, interpretarWebhook, lerPagamento, linkAsaas, tokenWebhookValido, traduzirStatus,
} from '@/lib/gatewayAsaas';

describe('configGateway', () => {
  it('sem chave: cobrança não configurada', () => {
    expect(configGateway({})).toBeNull();
    expect(configGateway({ ASAAS_API_KEY: '  ' })).toBeNull();
  });
  it('sandbox por padrão; produção só escrita por extenso', () => {
    expect(configGateway({ ASAAS_API_KEY: 'k' })).toMatchObject({ ambiente: 'sandbox', baseUrl: 'https://api-sandbox.asaas.com/v3' });
    expect(configGateway({ ASAAS_API_KEY: 'k', ASAAS_AMBIENTE: 'prod' })).toBeNull(); // valor estranho: não adivinha
    expect(configGateway({ ASAAS_API_KEY: 'k', ASAAS_AMBIENTE: 'producao' })).toMatchObject({ ambiente: 'producao', baseUrl: 'https://api.asaas.com/v3' });
  });
  it('o prefixo da chave manda: chave de sandbox nunca vira produção', () => {
    expect(configGateway({ ASAAS_API_KEY: '$aact_hmlg_x' })?.ambiente).toBe('sandbox');
    expect(configGateway({ ASAAS_API_KEY: '$aact_prod_x' })?.ambiente).toBe('producao');
    expect(configGateway({ ASAAS_API_KEY: '$aact_hmlg_x', ASAAS_AMBIENTE: 'producao' })).toBeNull();
    expect(configGateway({ ASAAS_API_KEY: '$aact_prod_x', ASAAS_AMBIENTE: 'sandbox' })).toBeNull();
  });
});

describe('tokenWebhookValido', () => {
  const T = 'um-token-bem-comprido-123';
  it('aceita só o token exato', () => {
    expect(tokenWebhookValido(T, T)).toBe(true);
    expect(tokenWebhookValido(T + 'x', T)).toBe(false);
    expect(tokenWebhookValido('', T)).toBe(false);
    expect(tokenWebhookValido(null, T)).toBe(false);
  });
  it('sem token configurado (ou curto demais) nada passa', () => {
    expect(tokenWebhookValido('qualquer', undefined)).toBe(false);
    expect(tokenWebhookValido('', '')).toBe(false);
    expect(tokenWebhookValido('curto', 'curto')).toBe(false);
  });
});

describe('tradução do Asaas', () => {
  it('status', () => {
    expect(traduzirStatus('RECEIVED')).toBe('pago');
    expect(traduzirStatus('CONFIRMED')).toBe('pago');
    expect(traduzirStatus('RECEIVED_IN_CASH')).toBe('pago');
    expect(traduzirStatus('OVERDUE')).toBe('vencido');
    expect(traduzirStatus('REFUNDED')).toBe('estornado');
    expect(traduzirStatus('CHARGEBACK_REQUESTED')).toBe('estornado');
    expect(traduzirStatus('PENDING')).toBe('pendente');
    expect(traduzirStatus('PENDING', 'PAYMENT_DELETED')).toBe('removido');
  });
  it('link da fatura só do domínio do Asaas, em https', () => {
    expect(linkAsaas('https://www.asaas.com/i/abc')).toBe('https://www.asaas.com/i/abc');
    expect(linkAsaas('https://sandbox.asaas.com/i/abc')).toBe('https://sandbox.asaas.com/i/abc');
    expect(linkAsaas('http://www.asaas.com/i/abc')).toBeNull();
    expect(linkAsaas('https://asaas.com.golpe.io/i/abc')).toBeNull();
    expect(linkAsaas('javascript:alert(1)')).toBeNull();
    expect(linkAsaas(null)).toBeNull();
  });
  it('lê a cobrança', () => {
    expect(lerPagamento({
      id: 'pay_1', customer: 'cus_1', subscription: 'sub_1', value: 89, dueDate: '2026-03-10',
      status: 'RECEIVED', billingType: 'PIX', invoiceUrl: 'https://www.asaas.com/i/1', clientPaymentDate: '2026-03-09',
    })).toEqual({
      id: 'pay_1', cliente: 'cus_1', assinatura: 'sub_1', referencia: null, descricao: null, valor: 89,
      vencimento: '2026-03-10', statusGateway: 'RECEIVED', status: 'pago', forma: 'PIX',
      linkFatura: 'https://www.asaas.com/i/1', pagoEm: '2026-03-09',
    });
    expect(lerPagamento({})).toBeNull();
  });
});

describe('interpretarWebhook', () => {
  it('evento de pagamento', () => {
    const ev = interpretarWebhook({ id: 'evt_1', event: 'PAYMENT_OVERDUE', payment: { id: 'pay_1', status: 'OVERDUE', value: 89, dueDate: '2026-03-10' } });
    expect(ev).toMatchObject({ tipo: 'pagamento', id: 'evt_1', pagamento: { id: 'pay_1', status: 'vencido' } });
  });
  it('remoção vira "removido" mesmo com status pendente', () => {
    const ev = interpretarWebhook({ id: 'evt_2', event: 'PAYMENT_DELETED', payment: { id: 'pay_1', status: 'PENDING' } });
    expect(ev).toMatchObject({ tipo: 'pagamento', pagamento: { status: 'removido', statusGateway: 'DELETED' } });
  });
  it('encerramento de assinatura', () => {
    expect(interpretarWebhook({ id: 'evt_3', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_1' } }))
      .toEqual({ tipo: 'assinatura', id: 'evt_3', evento: 'SUBSCRIPTION_DELETED', assinatura: 'sub_1', encerrada: true });
    expect(interpretarWebhook({ id: 'evt_4', event: 'SUBSCRIPTION_UPDATED', subscription: { id: 'sub_1' } }))
      .toMatchObject({ encerrada: false });
  });
  it('outros eventos são ignorados; corpo sem id ou evento é inválido', () => {
    expect(interpretarWebhook({ id: 'evt_5', event: 'INVOICE_AUTHORIZED' })).toEqual({ tipo: 'ignorado', id: 'evt_5', evento: 'INVOICE_AUTHORIZED' });
    expect(interpretarWebhook({ event: 'PAYMENT_RECEIVED' })).toBeNull();
    expect(interpretarWebhook(null)).toBeNull();
    expect(interpretarWebhook({ id: 'x'.repeat(300), event: 'PAYMENT_RECEIVED' })).toBeNull();
  });
  it('não guarda dados de cartão nem do pagador', () => {
    const g = corpoParaGuardar({
      id: 'evt', event: 'PAYMENT_RECEIVED', payment: { id: 'pay', value: 89, creditCard: { creditCardToken: 'tok' }, creditCardToken: 'tok2' },
      subscription: { id: 'sub', creditCard: { creditCardNumber: '1234' } }, customer: { cpfCnpj: '1' },
    });
    expect(g).toEqual({ id: 'evt', event: 'PAYMENT_RECEIVED', payment: { id: 'pay', value: 89 }, subscription: { id: 'sub' } });
  });
});
