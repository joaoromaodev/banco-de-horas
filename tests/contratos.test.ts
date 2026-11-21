import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  somarDias, diaSemanaIso, diasEntre, hojeBelem, isoValida, br, dataExtenso,
  vencimento1, vencimento2, retornoSugerido, horarioPadrao, minutosSemana,
  inteiroExtenso, reaisExtenso, lerValor, formatarValor, dadosVazios, normalizarDados,
  validar, avisos, campos, camposDoDocumento, alertaDe, type DadosContrato,
} from '@/lib/contratos';

afterEach(() => vi.useRealTimers());

const base = (extra: Partial<DadosContrato> = {}): DadosContrato =>
  normalizarDados({ nome: 'Maria', admissao: '2026-11-02', diasPeriodo: 45, diasProrrogacao: 45, ...extra });

describe('datas (AAAA-MM-DD, UTC)', () => {
  it('somarDias atravessa mês, ano e bissexto', () => {
    expect(somarDias('2026-11-02', 0)).toBe('2026-11-02');
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(somarDias('2024-02-28', 1)).toBe('2024-02-29');
    expect(somarDias('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('diaSemanaIso: 0=domingo', () => {
    expect(diaSemanaIso('2026-11-22')).toBe(0);
    expect(diaSemanaIso('2026-11-23')).toBe(1);
  });
  it('diasEntre é assinado e não sofre com horário de verão', () => {
    expect(diasEntre('2026-11-02', '2026-11-12')).toBe(10);
    expect(diasEntre('2026-11-12', '2026-11-02')).toBe(-10);
    expect(diasEntre('2026-03-01', '2026-04-01')).toBe(31);
  });
  it('isoValida / br / dataExtenso', () => {
    expect(isoValida('2026-11-02')).toBe(true);
    expect(isoValida('02/11/2026')).toBe(false);
    expect(isoValida('')).toBe(false);
    expect(br('2026-11-02')).toBe('02/11/2026');
    expect(br('')).toBe('');
    expect(dataExtenso('2026-11-02')).toBe('2 de novembro de 2026');
    expect(dataExtenso('2026-03-15')).toBe('15 de março de 2026');
    expect(dataExtenso('lixo')).toBe('');
  });
});

describe('hojeBelem (fuso America/Belem, UTC−3)', () => {
  it('02:00 UTC ainda é o dia anterior em Belém', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-21T02:00:00Z'));
    expect(hojeBelem()).toBe('2026-11-20');
  });
  it('03:00 UTC já é o dia seguinte em Belém', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-21T03:00:00Z'));
    expect(hojeBelem()).toBe('2026-11-21');
  });
  it('meio-dia UTC é o mesmo dia', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-21T12:00:00Z'));
    expect(hojeBelem()).toBe('2026-11-21');
  });
});

describe('vencimentos: o dia da admissão conta como o 1º dia', () => {
  it('vencimento = admissão + dias − 1', () => {
    expect(vencimento1({ admissao: '2026-11-02', diasPeriodo: 45 })).toBe('2026-12-16');
    expect(vencimento1({ admissao: '2026-01-01', diasPeriodo: 1 })).toBe('2026-01-01');
    expect(vencimento1({ admissao: '2026-01-01', diasPeriodo: 90 })).toBe('2026-03-31');
  });
  it('prorrogação vai até admissão + período + prorrogação − 1', () => {
    expect(vencimento2({ admissao: '2026-11-02', diasPeriodo: 45, diasProrrogacao: 45 })).toBe('2027-01-30');
    expect(vencimento2({ admissao: '2026-01-01', diasPeriodo: 45, diasProrrogacao: 45 })).toBe('2026-03-31'); // 90 dias
  });
  it('sem prorrogação, vencimento2 é null', () => {
    expect(vencimento2({ admissao: '2026-11-02', diasPeriodo: 90, diasProrrogacao: 0 })).toBeNull();
  });
});

describe('retornoSugerido (CLT art. 477 §6: até 10 dias)', () => {
  it('término + 10 em dia útil fica como está', () => {
    expect(retornoSugerido('2026-12-14')).toBe('2026-12-24'); // quinta
  });
  it('cai no sábado → recua para sexta', () => {
    expect(retornoSugerido('2026-12-16')).toBe('2026-12-25'); // 26/12 é sábado
    expect(diaSemanaIso('2026-12-26')).toBe(6);
  });
  it('cai no domingo → recua para sexta', () => {
    expect(retornoSugerido('2026-12-17')).toBe('2026-12-25'); // 27/12 é domingo
  });
  it('nunca passa de 10 dias nem devolve fim de semana', () => {
    for (let i = 0; i < 60; i++) {
      const termino = somarDias('2026-11-01', i);
      const r = retornoSugerido(termino);
      expect([0, 6]).not.toContain(diaSemanaIso(r));
      const d = diasEntre(termino, r);
      expect(d).toBeGreaterThanOrEqual(8);
      expect(d).toBeLessThanOrEqual(10);
    }
  });
});

describe('validar (bloqueios)', () => {
  it('contrato correto não tem erro', () => {
    expect(validar(base())).toEqual([]);
  });
  it('teto de 90 dias somados (CLT art. 445)', () => {
    expect(validar(base({ diasPeriodo: 45, diasProrrogacao: 45 }))).toEqual([]);
    expect(validar(base({ diasPeriodo: 90, diasProrrogacao: 0 }))).toEqual([]);
    expect(validar(base({ diasPeriodo: 45, diasProrrogacao: 46 }))).toEqual(
      [expect.stringMatching(/90 dias/)],
    );
    expect(validar(base({ diasPeriodo: 91, diasProrrogacao: 0 }))).toHaveLength(1);
  });
  it('nome, admissão e prazos inválidos', () => {
    expect(validar(base({ nome: '  ' }))).toContain('Informe o nome do empregado.');
    expect(validar(base({ admissao: '2026/11/02' }))).toContain('Data de admissão inválida.');
    expect(validar(base({ diasPeriodo: 0, diasProrrogacao: 0 }))).toContain('Prazo do 1º período inválido.');
    expect(validar(base({ diasProrrogacao: -1 }))).toContain('Prazo da prorrogação inválido.');
    expect(validar(base({ diasPeriodo: 10.5 }))).toContain('Prazo do 1º período inválido.');
  });
});

describe('avisos (não bloqueiam)', () => {
  it('horário padrão (40h) não gera aviso', () => {
    expect(avisos(base())).toEqual([]);
  });
  it('mais de 44h semanais', () => {
    const h = horarioPadrao({ utilMin: 540 }); // 9h x 5 = 45h
    expect(avisos(base({ horario: h })).join(' ')).toMatch(/44h/);
  });
  it('horário incompleto', () => {
    const d = base();
    d.horario.SEG.saida = '';
    expect(avisos(d).join(' ')).toMatch(/incompleto/);
  });
  it('CPF sem 11 dígitos', () => {
    expect(avisos(base({ cpf: '123.456' })).join(' ')).toMatch(/CPF/);
    expect(avisos(base({ cpf: '123.456.789-09' }))).toEqual([]);
  });
});

describe('horário', () => {
  it('padrão: 8h–17h com almoço 12–13, sábado de folga', () => {
    const h = horarioPadrao();
    expect(h.SEG).toMatchObject({ folga: false, entrada: '08:00', saida: '17:00', intervaloInicio: '12:00', intervaloFim: '13:00' });
    expect(h.SAB.folga).toBe(true);
  });
  it('jornada de 6h não tem almoço', () => {
    const h = horarioPadrao({ utilMin: 360 });
    expect(h.TER).toMatchObject({ saida: '14:00', intervaloInicio: '', intervaloFim: '' });
  });
  it('sábado trabalhado entra na soma semanal', () => {
    expect(minutosSemana(horarioPadrao())).toBe(40 * 60);
    expect(minutosSemana(horarioPadrao({ trabalhaSabado: true }))).toBe(44 * 60);
  });
  it('saída antes da entrada → null', () => {
    const h = horarioPadrao();
    h.SEG.saida = '07:00';
    expect(minutosSemana(h)).toBeNull();
  });
});

describe('valor por extenso', () => {
  it.each([
    [0, 'zero'], [1, 'um'], [21, 'vinte e um'], [100, 'cem'], [101, 'cento e um'],
    [1000, 'mil'], [1001, 'mil e um'], [1100, 'mil e cem'], [1518, 'mil quinhentos e dezoito'],
    [2500, 'dois mil e quinhentos'], [21000, 'vinte e um mil'], [1_000_000, 'um milhão'],
    [2_500_000, 'dois milhões e quinhentos mil'],
  ])('inteiroExtenso(%i)', (n, txt) => expect(inteiroExtenso(n)).toBe(txt));

  it.each([
    [1518, 'mil quinhentos e dezoito reais'],
    [1518.5, 'mil quinhentos e dezoito reais e cinquenta centavos'],
    [1, 'um real'],
    [0.01, 'um centavo'],
    [0, 'zero reais'],
    [2_000_000, 'dois milhões de reais'],
    [1621, 'mil seiscentos e vinte e um reais'],
  ])('reaisExtenso(%f)', (v, txt) => expect(reaisExtenso(v)).toBe(txt));

  it('acima de 1 bilhão devolve vazio (limite documentado)', () => {
    expect(reaisExtenso(1e9)).toBe('');
  });
});

describe('lerValor / formatarValor', () => {
  it.each([
    ['1.518,00', 1518], ['1518,5', 1518.5], ['1518.5', 1518.5], ['1.518', 1518],
    ['R$ 1.518,00', 1518], ['0', 0], [1518, 1518],
  ])('lerValor(%j) = %j', (v, n) => expect(lerValor(v as string | number)).toBe(n));

  it.each(['', 'abc', '-5', NaN, Infinity])('lerValor(%j) = null', (v) => {
    expect(lerValor(v as string | number)).toBeNull();
  });

  it('formatarValor usa duas casas em pt-BR', () => {
    expect(formatarValor(1518)).toBe('1.518,00');
    expect(formatarValor(0.5)).toBe('0,50');
  });
});

describe('dadosVazios / normalizarDados', () => {
  it('nasce com 45+45, término em +44 dias e retorno útil', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-21T12:00:00Z'));
    const d = dadosVazios();
    expect(d.admissao).toBe('2026-11-21');
    expect(d.diasPeriodo + d.diasProrrogacao).toBe(90);
    expect(d.termino).toBe('2027-01-04');
    expect([0, 6]).not.toContain(diaSemanaIso(d.retorno));
    expect(d.ida).toHaveLength(3);
  });
  it('completa registro antigo e converte prazos para número', () => {
    const d = normalizarDados({ nome: 'X', diasPeriodo: '30' as unknown as number, ida: [{ linha: '1', operadora: 'A', tarifa: '4' }] });
    expect(d.diasPeriodo).toBe(30);
    expect(d.ida).toHaveLength(3);
    expect(d.volta).toHaveLength(3);
    expect(d.horario.SEG).toBeDefined();
  });
});

describe('campos dos modelos', () => {
  it('feminino, vencimento e prorrogação', () => {
    const c = campos(base({ sexo: 'F', nome: 'maria silva', funcao: 'auxiliar' }));
    expect(c).toMatchObject({
      O_SR: 'a Sra.', PORTADOR: 'portadora', NACIONALIDADE: 'Brasileira', NOME: 'MARIA SILVA', FUNCAO: 'AUXILIAR',
      VENCIMENTO: '16/12/2026', PRORROGADO_ATE: '30/01/2027', DATA_EXTENSO: '2 de novembro de 2026',
      SAB_E: 'FOLGA', SAB_AS: '', SEG_E: '08:00', SEG_S: '17:00', SEG_I: '12:00 13:00',
    });
  });
  it('masculino e sem prorrogação usa linha em branco', () => {
    const c = campos(base({ diasPeriodo: 90, diasProrrogacao: 0 }));
    expect(c.O_SR).toBe('o Sr.');
    expect(c.PRORROGADO_ATE).toBe('___ / ___ / _______');
  });
  it('marca X em VT sim/não', () => {
    expect(campos(base({ vt: 'sim' }))).toMatchObject({ VT_SIM: 'X', VT_NAO: '   ' });
    expect(campos(base({ vt: 'nao' }))).toMatchObject({ VT_SIM: '   ', VT_NAO: 'X' });
  });
  it('aviso de término usa a data do aviso por extenso', () => {
    const d = base({ dataAviso: '2026-12-10' });
    expect(camposDoDocumento('contrato', d).DATA_EXTENSO).toBe('2 de novembro de 2026');
    expect(camposDoDocumento('encerramento', d).DATA_EXTENSO).toBe('10 de dezembro de 2026');
  });
});

describe('alertaDe', () => {
  const d = base(); // v1 = 2026-12-16, v2 = 2027-01-30
  it('fora da janela → null', () => {
    expect(alertaDe(d, 'experiencia', '2026-12-01')).toBeNull();
  });
  it('vence em ≤ 7 dias (inclusive no próprio dia)', () => {
    expect(alertaDe(d, 'experiencia', '2026-12-09')).toMatchObject({ tipo: 'vence', marco: '1º período', dias: 7 });
    expect(alertaDe(d, 'experiencia', '2026-12-16')).toMatchObject({ tipo: 'vence', dias: 0 });
    expect(alertaDe(d, 'experiencia', '2026-12-08')).toBeNull();
  });
  it('depois do 1º período o marco é a prorrogação', () => {
    expect(alertaDe(d, 'experiencia', '2026-12-17')).toBeNull();
    expect(alertaDe(d, 'experiencia', '2027-01-25')).toMatchObject({ tipo: 'vence', marco: 'prorrogação', dias: 5 });
  });
  it('vencido sem providência continua alertando', () => {
    expect(alertaDe(d, 'experiencia', '2027-02-05')).toMatchObject({ tipo: 'vencido', marco: 'prorrogação', dias: -6 });
    expect(alertaDe(base({ diasPeriodo: 90, diasProrrogacao: 0 }), 'experiencia', '2027-03-10'))
      .toMatchObject({ tipo: 'vencido', marco: '1º período' });
  });
  it('efetivado/encerrado ou data inválida não alertam', () => {
    expect(alertaDe(d, 'efetivado', '2026-12-16')).toBeNull();
    expect(alertaDe(d, 'encerrado', '2026-12-16')).toBeNull();
    expect(alertaDe(base({ admissao: '' }), 'experiencia', '2026-12-16')).toBeNull();
  });
});
