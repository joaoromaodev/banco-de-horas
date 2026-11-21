import { describe, it, expect } from 'vitest';
import {
  cabeNoPlano, calcularTroca, comGateway, periodoDoPagamento, consolidarAgendamento, documentoValido, escritaBarrada, hojeEm, limiteEmpresas,
  mensagemSomenteLeitura, planoEfetivo, planoMinimoPara, preco, primeiroVencimento, recalcularAssinatura,
  situacaoEfetiva, somarCiclo, somarMeses, CARENCIA_DIAS,
  type AssinaturaRef, type EstadoCobranca, type PagamentoRef,
} from '@/lib/cobranca';

// 15/03/2026 12:00 em Belém (UTC−3) = 15:00 UTC.
const AGORA = Date.UTC(2026, 2, 15, 15, 0);
const HOJE = '2026-03-15';

const assinatura = (extra: Partial<AssinaturaRef> = {}): AssinaturaRef => ({
  plano: 'essencial', ciclo: 'mensal', status: 'ativa', pagoAte: '2026-04-09',
  inadimplenteDesde: null, proximoVencimento: '2026-04-10', ...extra,
});
const estado = (extra: Partial<EstadoCobranca> = {}): EstadoCobranca => ({
  plano: 'teste', situacao: 'teste', testeAte: '2026-03-20T12:00:00Z', assinatura: null, ...extra,
});

describe('datas', () => {
  it('hoje é contado em Belém (UTC−3)', () => {
    expect(hojeEm(Date.UTC(2026, 2, 16, 2, 0))).toBe('2026-03-15'); // 23h de 15/03 em Belém
    expect(hojeEm(AGORA)).toBe(HOJE);
  });
  it('soma de mês recua para o último dia quando o dia não existe', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(somarMeses('2028-01-31', 1)).toBe('2028-02-29');
    expect(somarMeses('2026-12-10', 1)).toBe('2027-01-10');
    expect(somarCiclo('2028-02-29', 'anual')).toBe('2029-02-28');
    expect(somarCiclo('2026-03-10', 'mensal', -1)).toBe('2026-02-10');
  });
});

describe('situacaoEfetiva', () => {
  it('fundador nunca cai em somente leitura — nem suspenso, nem com assinatura vencida', () => {
    expect(situacaoEfetiva(estado({ plano: 'fundador', situacao: 'ativo' }), AGORA).somenteLeitura).toBe(false);
    expect(situacaoEfetiva(estado({ plano: 'fundador', situacao: 'suspenso' }), AGORA).somenteLeitura).toBe(false);
    expect(situacaoEfetiva(estado({ plano: 'fundador', testeAte: '2020-01-01T00:00:00Z' }), AGORA).somenteLeitura).toBe(false);
    expect(situacaoEfetiva(estado({
      plano: 'fundador', situacao: 'ativo',
      assinatura: assinatura({ status: 'inadimplente', inadimplenteDesde: '2025-01-01' }),
    }), AGORA)).toEqual({ somenteLeitura: false, motivo: 'fundador' });
  });

  it('teste em andamento libera e conta os dias', () => {
    expect(situacaoEfetiva(estado(), AGORA)).toEqual({ somenteLeitura: false, motivo: 'teste', dias: 5 });
  });

  it('teste vencido sem assinatura vira somente leitura', () => {
    const s = situacaoEfetiva(estado({ testeAte: '2026-03-15T14:59:00Z' }), AGORA);
    expect(s).toEqual({ somenteLeitura: true, motivo: 'teste_vencido', desde: '2026-03-15' });
  });

  it('suspenso manual bloqueia mesmo com assinatura ativa', () => {
    expect(situacaoEfetiva(estado({ situacao: 'suspenso', assinatura: assinatura() }), AGORA).somenteLeitura).toBe(true);
  });

  it('ativo sem assinatura (liberado à mão) segue liberado', () => {
    expect(situacaoEfetiva(estado({ situacao: 'ativo', testeAte: '2020-01-01T00:00:00Z' }), AGORA))
      .toEqual({ somenteLeitura: false, motivo: 'cortesia' });
  });

  it('assinatura ativa libera mesmo com teste vencido', () => {
    expect(situacaoEfetiva(estado({ testeAte: '2026-01-01T00:00:00Z', assinatura: assinatura() }), AGORA))
      .toEqual({ somenteLeitura: false, motivo: 'assinante' });
  });

  it(`inadimplente: carência de ${CARENCIA_DIAS} dias a partir do vencimento, depois somente leitura`, () => {
    const com = (desde: string) => situacaoEfetiva(estado({
      testeAte: '2026-01-01T00:00:00Z', assinatura: assinatura({ status: 'inadimplente', inadimplenteDesde: desde }),
    }), AGORA);
    // venceu 08/03 → carência até 15/03 (hoje): ainda liberado, último dia
    expect(com('2026-03-08')).toEqual({ somenteLeitura: false, motivo: 'carencia', dias: 1, ate: '2026-03-15' });
    expect(com('2026-03-14')).toMatchObject({ somenteLeitura: false, motivo: 'carencia', dias: 7 });
    // venceu 07/03 → carência acabou ontem
    expect(com('2026-03-07')).toEqual({ somenteLeitura: true, motivo: 'inadimplente', desde: '2026-03-07' });
  });

  it('pendente durante o teste libera', () => {
    const s = situacaoEfetiva(estado({ assinatura: assinatura({ status: 'pendente', pagoAte: null, proximoVencimento: '2026-03-20' }) }), AGORA);
    expect(s).toMatchObject({ somenteLeitura: false, motivo: 'aguardando_pagamento' });
  });

  it('pendente de quem assinou no teste: libera até o 1º vencimento + carência (boleto compensando)', () => {
    const com = (testeAte: string, venc: string) => situacaoEfetiva(estado({
      testeAte, assinatura: assinatura({ status: 'pendente', pagoAte: null, proximoVencimento: venc }),
    }), AGORA);
    expect(com('2026-03-10T12:00:00Z', '2026-03-10')).toMatchObject({ somenteLeitura: false, motivo: 'aguardando_pagamento', ate: '2026-03-17' });
    expect(com('2026-03-01T12:00:00Z', '2026-03-01')).toEqual({ somenteLeitura: true, motivo: 'aguardando_pagamento' });
  });

  it('pendente de quem assinou DEPOIS do teste não ganha folga (assinar e cancelar em loop não libera)', () => {
    const s = situacaoEfetiva(estado({
      testeAte: '2026-03-01T12:00:00Z',
      assinatura: assinatura({ status: 'pendente', pagoAte: null, proximoVencimento: '2026-03-15' }),
    }), AGORA);
    expect(s).toEqual({ somenteLeitura: true, motivo: 'aguardando_pagamento' });
  });

  it('cancelada mantém acesso até o fim do período pago', () => {
    const com = (pagoAte: string | null) => situacaoEfetiva(estado({
      testeAte: '2026-01-01T00:00:00Z', assinatura: assinatura({ status: 'cancelada', pagoAte }),
    }), AGORA);
    expect(com('2026-03-15')).toEqual({ somenteLeitura: false, motivo: 'cancelada_vigente', dias: 1, ate: '2026-03-15' });
    expect(com('2026-03-14')).toEqual({ somenteLeitura: true, motivo: 'cancelada', desde: '2026-03-14' });
    expect(com(null)).toEqual({ somenteLeitura: true, motivo: 'cancelada', desde: undefined });
  });

  it('cancelada ainda no teste: vale o teste', () => {
    expect(situacaoEfetiva(estado({ assinatura: assinatura({ status: 'cancelada', pagoAte: null }) }), AGORA))
      .toMatchObject({ somenteLeitura: false, motivo: 'teste' });
  });
});

describe('planos e limites', () => {
  it('preços e limites da tabela', () => {
    expect(preco('essencial', 'mensal')).toBe(89);
    expect(preco('escritorio', 'anual')).toBe(1890);
    expect(preco('ilimitado', 'anual')).toBe(3490);
    expect(limiteEmpresas('essencial')).toBe(10);
    expect(limiteEmpresas('escritorio')).toBe(40);
    expect(limiteEmpresas('ilimitado')).toBeNull();
    expect(limiteEmpresas('teste')).toBeNull();
    expect(limiteEmpresas('fundador')).toBeNull();
  });
  it('plano mínimo para n empresas', () => {
    expect(planoMinimoPara(10)).toBe('essencial');
    expect(planoMinimoPara(11)).toBe('escritorio');
    expect(planoMinimoPara(41)).toBe('ilimitado');
  });
  it('só barra o que cresce além do limite', () => {
    expect(cabeNoPlano('essencial', 9, 10)).toBe(true);
    expect(cabeNoPlano('essencial', 10, 11)).toBe(false);
    expect(cabeNoPlano('essencial', 15, 15)).toBe(true); // desceu de plano: edita as que tem
    expect(cabeNoPlano('essencial', 15, 14)).toBe(true);
    expect(cabeNoPlano('essencial', 15, 16)).toBe(false);
    expect(cabeNoPlano('ilimitado', 500, 501)).toBe(true);
    expect(cabeNoPlano('fundador', 3, 300)).toBe(true);
  });
  it('plano efetivo segue a assinatura e a troca agendada', () => {
    expect(planoEfetivo(estado({ plano: 'fundador' }), AGORA)).toBe('fundador');
    expect(planoEfetivo(estado({ assinatura: assinatura({ plano: 'escritorio' }) }), AGORA)).toBe('escritorio');
    expect(planoEfetivo(estado({
      assinatura: assinatura({ plano: 'escritorio', planoAgendado: 'essencial', agendadoAPartir: '2026-03-15' }),
    }), AGORA)).toBe('essencial');
    expect(planoEfetivo(estado({
      assinatura: assinatura({ plano: 'escritorio', planoAgendado: 'essencial', agendadoAPartir: '2026-03-16' }),
    }), AGORA)).toBe('escritorio');
    // cancelada e vencida: volta ao plano do escritório
    expect(planoEfetivo(estado({ assinatura: assinatura({ status: 'cancelada', pagoAte: '2026-01-01' }) }), AGORA)).toBe('teste');
  });
  it('consolidarAgendamento aplica plano e ciclo na data', () => {
    const a = assinatura({ plano: 'escritorio', ciclo: 'mensal', planoAgendado: 'essencial', cicloAgendado: 'anual', agendadoAPartir: '2026-03-10' });
    expect(consolidarAgendamento(a, HOJE)).toMatchObject({ plano: 'essencial', ciclo: 'anual', planoAgendado: null, agendadoAPartir: null });
    expect(consolidarAgendamento(a, '2026-03-09')).toBe(a);
  });
});

describe('escritaBarrada (somente leitura)', () => {
  it('leitura nunca é barrada', () => {
    for (const m of ['GET', 'HEAD', 'OPTIONS', 'get']) expect(escritaBarrada(m, '/api/caixa/lancamentos')).toBe(false);
  });
  it('toda escrita em rota de dados é barrada', () => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'delete']) {
      expect(escritaBarrada(m, '/api/caixa/lancamentos')).toBe(true);
      expect(escritaBarrada(m, '/api/empresas')).toBe(true);
      expect(escritaBarrada(m, '/api/usuarios')).toBe(true);
    }
    // rota que ainda nem existe: falha fechada
    expect(escritaBarrada('POST', '/api/qualquer-coisa-nova')).toBe(true);
    // método estranho conta como escrita
    expect(escritaBarrada('PROPFIND', '/api/caixa')).toBe(true);
  });
  it('login, logout, cadastro e cobrança ficam livres', () => {
    for (const p of ['/api/login', '/api/logout', '/api/criar-conta', '/api/cobranca', '/api/cobranca/webhook']) {
      expect(escritaBarrada('POST', p)).toBe(false);
    }
  });
  it('exportações por POST continuam (gerar planilha e documento)', () => {
    expect(escritaBarrada('POST', '/api/gerar')).toBe(false);
    expect(escritaBarrada('POST', '/api/contratos/documento')).toBe(false);
    expect(escritaBarrada('POST', '/api/gerar-lote')).toBe(true); // prefixo parecido não vale
    expect(escritaBarrada('POST', '/api/contratos')).toBe(true);
  });
  it('não se engana com prefixo parecido', () => {
    expect(escritaBarrada('POST', '/api/cobrancax')).toBe(true);
    expect(escritaBarrada('POST', '/api/loginx')).toBe(true);
  });
  it('páginas não são API', () => {
    expect(escritaBarrada('POST', '/caixa')).toBe(false);
  });
  it('mensagem do cliente aponta para a contabilidade; a do gestor, para Assinatura', () => {
    expect(mensagemSomenteLeitura('teste_vencido', 'cliente')).toMatch(/contabilidade/);
    expect(mensagemSomenteLeitura('inadimplente', 'usuario')).toMatch(/Assinatura/);
  });
});

describe('primeiroVencimento', () => {
  it('no fim do teste, ou hoje se já acabou', () => {
    expect(primeiroVencimento('2026-03-20T12:00:00Z', AGORA)).toBe('2026-03-20');
    expect(primeiroVencimento('2026-03-01T12:00:00Z', AGORA)).toBe(HOJE);
    expect(primeiroVencimento(null, AGORA)).toBe(HOJE);
  });
});

describe('recalcularAssinatura', () => {
  const pg = (extra: Partial<PagamentoRef>): PagamentoRef => ({ id: 'p', daAssinatura: true, status: 'pendente', vencimento: '2026-03-10', valor: 89, ...extra });
  const base = { ciclo: 'mensal' as const, status: 'pendente' as const, proximoVencimento: '2026-03-10' };

  it('nada pago: pendente', () => {
    expect(recalcularAssinatura(base, [pg({})])).toEqual({ status: 'pendente', pagoAte: null, inadimplenteDesde: null, proximoVencimento: '2026-03-10' });
  });
  it('pago: ativa até o fim do período congelado da cobrança', () => {
    expect(recalcularAssinatura(base, [pg({ status: 'pago', periodoAte: '2026-04-09' })])).toEqual({
      status: 'ativa', pagoAte: '2026-04-09', inadimplenteDesde: null, proximoVencimento: '2026-04-10',
    });
    expect(recalcularAssinatura(base, [pg({ status: 'pago', periodoAte: '2027-03-09' })]).pagoAte).toBe('2027-03-09');
  });
  it('trocar para anual NÃO estica o mês já pago (achado do Escudo)', () => {
    // pagou 1 mês; depois a assinatura virou anual: o pago continua valendo 1 mês
    const mensalPago = pg({ status: 'pago', periodoAte: periodoDoPagamento('2026-03-10', { ciclo: 'mensal' }) });
    expect(recalcularAssinatura({ ...base, ciclo: 'anual' }, [mensalPago]).pagoAte).toBe('2026-04-09');
    // sem período gravado, a conta conservadora é 1 mês, nunca o ciclo atual
    expect(recalcularAssinatura({ ...base, ciclo: 'anual' }, [pg({ status: 'pago' })]).pagoAte).toBe('2026-04-09');
  });
  it('vencida: inadimplente desde o vencimento mais antigo em aberto (inclusive avulsa)', () => {
    const r = recalcularAssinatura(base, [
      pg({ id: 'a', status: 'pago', vencimento: '2026-01-10', periodoAte: '2026-02-09' }),
      pg({ id: 'b', status: 'vencido', vencimento: '2026-02-10' }),
      pg({ id: 'c', status: 'vencido', vencimento: '2026-01-20', daAssinatura: false }),
    ]);
    expect(r).toMatchObject({ status: 'inadimplente', inadimplenteDesde: '2026-01-20', pagoAte: '2026-02-09', proximoVencimento: '2026-02-10' });
  });
  it('é insensível à ordem e à repetição', () => {
    const lista = [pg({ id: 'a', status: 'pago', vencimento: '2026-02-10', periodoAte: '2026-03-09' }), pg({ id: 'b', status: 'pago', vencimento: '2026-03-10', periodoAte: '2026-04-09' })];
    expect(recalcularAssinatura(base, lista)).toEqual(recalcularAssinatura(base, [...lista].reverse().concat(lista)));
  });
  it('estorno tira o período pago; avulsa paga não estende o período', () => {
    expect(recalcularAssinatura(base, [pg({ status: 'estornado', periodoAte: '2026-04-09' })]).pagoAte).toBeNull();
    expect(recalcularAssinatura(base, [pg({ status: 'pago', daAssinatura: false })]).pagoAte).toBeNull();
  });
  it('cancelada continua cancelada', () => {
    expect(recalcularAssinatura({ ...base, status: 'cancelada' }, [pg({ status: 'pago' })]).status).toBe('cancelada');
  });
});

describe('calcularTroca (ajuste proporcional)', () => {
  const pedido = { planoAtual: 'essencial' as const, cicloAtual: 'mensal' as const, pagoAte: '2026-03-31', hoje: '2026-03-17' };

  it('mesmo plano e ciclo: nada', () => {
    expect(calcularTroca({ ...pedido, planoNovo: 'essencial', cicloNovo: 'mensal' })).toEqual({ tipo: 'nada' });
  });
  it('nada pago ainda: imediata, sem ajuste', () => {
    expect(calcularTroca({ ...pedido, pagoAte: null, planoNovo: 'ilimitado', cicloNovo: 'anual' })).toEqual({ tipo: 'imediata', valorNovo: 3490 });
  });
  it('subida no meio do mês cobra a diferença dos dias restantes', () => {
    // período 01/03–31/03 (31 dias); de 17/03 a 31/03 faltam 15 dias (hoje conta)
    const r = calcularTroca({ ...pedido, planoNovo: 'escritorio', cicloNovo: 'mensal' });
    expect(r).toEqual({ tipo: 'subida', valorNovo: 189, cobrarAgora: 48.39, diasRestantes: 15, diasPeriodo: 31 });
  });
  it('ajuste pequeno demais não vira cobrança', () => {
    const r = calcularTroca({ ...pedido, hoje: '2026-03-31', planoNovo: 'escritorio', cicloNovo: 'mensal' });
    expect(r).toMatchObject({ tipo: 'subida', cobrarAgora: 0, diasRestantes: 1 });
  });
  it('descida vale na renovação, sem crédito', () => {
    const r = calcularTroca({ ...pedido, planoAtual: 'ilimitado', planoNovo: 'essencial', cicloNovo: 'mensal' });
    expect(r).toEqual({ tipo: 'agendada', valorNovo: 89, aPartir: '2026-04-01', cobrarAgora: 0 });
  });
  it('troca de ciclo vale na renovação; com subida, o plano vale já com ajuste', () => {
    expect(calcularTroca({ ...pedido, planoNovo: 'essencial', cicloNovo: 'anual' }))
      .toEqual({ tipo: 'agendada', valorNovo: 890, aPartir: '2026-04-01', cobrarAgora: 0 });
    expect(calcularTroca({ ...pedido, planoNovo: 'escritorio', cicloNovo: 'anual' }))
      .toEqual({ tipo: 'agendada', valorNovo: 1890, aPartir: '2026-04-01', planoJa: 'escritorio', cobrarAgora: 48.39 });
  });
  it('período anual usa os dias do ano', () => {
    const r = calcularTroca({ planoAtual: 'essencial', cicloAtual: 'anual', pagoAte: '2027-02-28', hoje: '2026-09-01', planoNovo: 'escritorio', cicloNovo: 'anual' });
    // período 01/03/2026–28/02/2027 = 365 dias; faltam 181; (1890−890)×181/365
    expect(r).toEqual({ tipo: 'subida', valorNovo: 1890, cobrarAgora: 495.89, diasRestantes: 181, diasPeriodo: 365 });
  });
});

describe('documentoValido', () => {
  it('CPF e CNPJ com dígitos verificadores', () => {
    expect(documentoValido('529.982.247-25')).toBe(true);
    expect(documentoValido('52998224724')).toBe(false);
    expect(documentoValido('11.222.333/0001-81')).toBe(true);
    expect(documentoValido('11222333000180')).toBe(false);
    expect(documentoValido('111.111.111-11')).toBe(false);
    expect(documentoValido('123')).toBe(false);
  });
});

describe('comGateway', () => {
  it('sem gateway, teste vencido não trava (não haveria como assinar)', () => {
    expect(comGateway({ somenteLeitura: true, motivo: 'teste_vencido' }, false)).toEqual({ somenteLeitura: false, motivo: 'cobranca_desligada' });
    expect(comGateway({ somenteLeitura: true, motivo: 'teste_vencido' }, true)).toEqual({ somenteLeitura: true, motivo: 'teste_vencido' });
  });
  it('suspenso e inadimplência valem mesmo sem gateway', () => {
    expect(comGateway({ somenteLeitura: true, motivo: 'suspenso' }, false).somenteLeitura).toBe(true);
    expect(comGateway({ somenteLeitura: true, motivo: 'inadimplente' }, false).somenteLeitura).toBe(true);
  });
});

describe('periodoDoPagamento', () => {
  it('usa o ciclo que vale no vencimento (troca agendada só a partir da data)', () => {
    const a = { ciclo: 'mensal' as const, cicloAgendado: 'anual' as const, agendadoAPartir: '2026-04-10' };
    expect(periodoDoPagamento('2026-03-10', a)).toBe('2026-04-09');
    expect(periodoDoPagamento('2026-04-10', a)).toBe('2027-04-09');
  });
});

describe('cancelar com ajuste em aberto (achado do Escudo)', () => {
  it('subiu de plano, não pagou o ajuste e cancelou: passada a carência, somente leitura mesmo com período pago', () => {
    const e = estado({
      testeAte: '2026-01-01T00:00:00Z',
      assinatura: assinatura({ status: 'cancelada', plano: 'ilimitado', pagoAte: '2027-01-01', inadimplenteDesde: '2026-03-01' }),
    });
    expect(situacaoEfetiva(e, AGORA)).toEqual({ somenteLeitura: true, motivo: 'inadimplente', desde: '2026-03-01' });
  });
  it('dentro da carência segue com o período pago', () => {
    const e = estado({
      testeAte: '2026-01-01T00:00:00Z',
      assinatura: assinatura({ status: 'cancelada', pagoAte: '2027-01-01', inadimplenteDesde: '2026-03-10' }),
    });
    expect(situacaoEfetiva(e, AGORA)).toMatchObject({ somenteLeitura: false, motivo: 'cancelada_vigente' });
  });
});
