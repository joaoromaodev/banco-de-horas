// Partes puras do Livro Caixa: lib/caixa.ts (validação, saída efetiva) e o
// formato.ts da tela. Nada aqui toca o Supabase.
import { describe, it, expect } from 'vitest';
import { paraValor, validarLancamento, saidaEfetiva, ErroCaixa, HISTORICO_RETIRADA_CHEQUE } from '@/lib/caixa';
import { HISTORICOS_PADRAO, PLANO_CONTAS_PADRAO } from '@/lib/planoContasPadrao';
import { dinheiro, dinheiroCurto, diaMes, documentoValido, formatarDocumento } from '@/app/(app)/caixa/formato';

describe('paraValor', () => {
  it.each([
    ['1234,56', 1234.56], ['1.234,56', 1234.56], ['1234.56', 1234.56], ['1.234.567,89', 1234567.89],
    ['R$ 10,00', 10], ['10', 10], ['0,5', 0.5], ['', 0], [null, 0], [undefined, 0], [12.5, 12.5],
  ])('paraValor(%j) = %j', (v, n) => expect(paraValor(v)).toBe(n));

  it('texto inválido vira NaN', () => {
    expect(paraValor('abc')).toBeNaN();
    expect(paraValor(NaN)).toBe(0); // número não finito é tratado como vazio
  });

  // Ambiguidade conhecida: "1.234" é lido como milhar (1234), nunca como 1,234.
  it('ponto seguido de 3 dígitos é milhar', () => {
    expect(paraValor('1.234')).toBe(1234);
  });
});

describe('saidaEfetiva: juros e multa são saídas adicionais', () => {
  it('soma saída + juros + multa', () => {
    expect(saidaEfetiva({ saida: 100, juros: 5, multa: 2 })).toBe(107);
    expect(saidaEfetiva({ saida: 0, juros: 5, multa: 2 })).toBe(7); // linha só de penalidade
    expect(saidaEfetiva({ saida: 0, juros: 0, multa: 0 })).toBe(0);
  });
});

describe('validarLancamento', () => {
  const ok = { data: '2026-07-14', historico: 'Pago conta de luz', saida: '120,50' };

  it('saída simples', () => {
    expect(validarLancamento(ok, 2026)).toMatchObject({
      data: '2026-07-14', historico: 'Pago conta de luz', entrada: 0, saida: 120.5, juros: 0, multa: 0,
      historicoId: null, complemento: null, contaId: null, pagadorNome: null, pagadorDocumento: null,
    });
  });
  it('entrada simples', () => {
    expect(validarLancamento({ ...ok, saida: undefined, entrada: '1.000,00' }, 2026)).toMatchObject({ entrada: 1000, saida: 0 });
  });
  it('só juros/multa já conta como saída', () => {
    expect(validarLancamento({ ...ok, saida: '', juros: '3,00', multa: '1,00' }, 2026)).toMatchObject({ saida: 0, juros: 3, multa: 1 });
  });
  it('arredonda para centavos', () => {
    expect(validarLancamento({ ...ok, saida: 10.005 }, 2026).saida).toBeCloseTo(10.01, 2);
    expect(validarLancamento({ ...ok, saida: '0,1' }, 2026).saida).toBe(0.1);
  });
  it('limpa textos; documento do pagador fica só com dígitos', () => {
    const l = validarLancamento({
      ...ok, saida: undefined, entrada: 50, complemento: '  NF 12 ', historicoId: ' h1 ', contaId: ' c1 ',
      pagadorNome: ' Fulano ', pagadorDocumento: '123.456.789-09',
    }, 2026);
    expect(l).toMatchObject({ complemento: 'NF 12', historicoId: 'h1', contaId: 'c1', pagadorNome: 'Fulano', pagadorDocumento: '12345678909' });
  });

  const recusa = (corpo: Record<string, unknown>, msg: RegExp, ano = 2026) => {
    const f = () => validarLancamento(corpo, ano);
    expect(f).toThrow(ErroCaixa);
    expect(f).toThrow(msg);
  };

  it('recusa entrada e saída juntas (inclusive entrada + juros)', () => {
    recusa({ ...ok, entrada: '10', saida: '5' }, /entrada ou saída/);
    recusa({ ...ok, entrada: '10', saida: '', juros: '1' }, /entrada ou saída/);
  });
  it('recusa lançamento sem valor', () => {
    recusa({ ...ok, saida: '' }, /Informe o valor/);
  });
  it('recusa valor negativo ou inválido', () => {
    recusa({ ...ok, saida: '-5' }, /negativo/);
    recusa({ ...ok, saida: 'abc' }, /inválido/);
  });
  it('recusa data fora do formato ou de outro exercício', () => {
    recusa({ ...ok, data: '14/07/2026' }, /AAAA-MM-DD/);
    recusa({ ...ok, data: '2025-07-14' }, /exercício de 2026/);
  });
  it('recusa sem a conta analítica (histórico)', () => {
    recusa({ ...ok, historico: '  ' }, /conta analítica/);
  });
  it('ErroCaixa tem status 400 por padrão', () => {
    try { validarLancamento({}, 2026); } catch (e) { expect((e as ErroCaixa).status).toBe(400); }
  });
});

describe('regras do catálogo padrão', () => {
  it('depósito em conta corrente = saída (despesa); retirada = entrada (receita)', () => {
    const h = (t: string) => HISTORICOS_PADRAO.find((x) => x.texto === t)!;
    expect(h('Depósito em conta corrente').natureza).toBe('despesa');
    expect(h(HISTORICO_RETIRADA_CHEQUE).natureza).toBe('receita');
  });
  it('depósito e retirada ficam sem conta (transferência não é receita nem despesa)', () => {
    expect(HISTORICOS_PADRAO.find((x) => x.texto === 'Depósito em conta corrente')!.codigoConta).toBeUndefined();
    expect(HISTORICOS_PADRAO.find((x) => x.texto === HISTORICO_RETIRADA_CHEQUE)!.codigoConta).toBeUndefined();
  });
  it('todo código de conta citado nos históricos existe no plano, com a mesma natureza', () => {
    const plano = new Map(PLANO_CONTAS_PADRAO.map((c) => [c.codigo, c]));
    for (const h of HISTORICOS_PADRAO) {
      if (!h.codigoConta) continue;
      expect(plano.get(h.codigoConta), `${h.texto} → ${h.codigoConta}`).toBeDefined();
      expect(plano.get(h.codigoConta)!.natureza, h.texto).toBe(h.natureza);
    }
  });
  it('códigos do plano são únicos e receita começa em 1, despesa em 2', () => {
    const codigos = PLANO_CONTAS_PADRAO.map((c) => c.codigo);
    expect(new Set(codigos).size).toBe(codigos.length);
    for (const c of PLANO_CONTAS_PADRAO) expect(c.codigo[0]).toBe(c.natureza === 'receita' ? '1' : '2');
  });
});

describe('formato.ts (tela do caixa)', () => {
  it('dinheiro: duas casas, separadores pt-BR', () => {
    expect(dinheiro(1234.5)).toBe('1.234,50');
    expect(dinheiro(0)).toBe('0,00');
    expect(dinheiro(-10)).toBe('-10,00');
  });
  it('dinheiroCurto', () => {
    expect(dinheiroCurto(500)).toBe('500');
    expect(dinheiroCurto(12500)).toBe('12,5 mil');
    expect(dinheiroCurto(2_000_000)).toBe('2 mi');
    expect(dinheiroCurto(-12500)).toBe('-12,5 mil');
  });
  it('diaMes', () => expect(diaMes('2026-07-14')).toBe('14/07'));
  it('documentoValido: CPF e CNPJ reais, vazio e inválidos', () => {
    expect(documentoValido('')).toBe(true);
    expect(documentoValido('529.982.247-25')).toBe(true);   // CPF de teste válido
    expect(documentoValido('529.982.247-24')).toBe(false);
    expect(documentoValido('111.111.111-11')).toBe(false);
    expect(documentoValido('11.222.333/0001-81')).toBe(true); // CNPJ de teste válido
    expect(documentoValido('11.222.333/0001-82')).toBe(false);
    expect(documentoValido('123')).toBe(false);
  });
  it('formatarDocumento aplica a máscara', () => {
    expect(formatarDocumento('52998224725')).toBe('529.982.247-25');
    expect(formatarDocumento('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatarDocumento('123')).toBe('123');
    expect(formatarDocumento(null)).toBe('');
  });
});
