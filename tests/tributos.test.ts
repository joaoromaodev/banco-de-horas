// INSS e IRRF (lib/tabelasTributos.ts) — cada valor esperado foi conferido à mão (conta ao lado).
import { describe, it, expect } from 'vitest';
import { calcularInss, calcularIrrf, tabelaInssEm, tabelaIrrfEm, TABELAS_INSS, TABELAS_IRRF } from '@/lib/tabelasTributos';

const inss26 = tabelaInssEm('2026-11-20').tabela;
const irrf26 = tabelaIrrfEm('2026-11-30').tabela;

describe('escolha da tabela pela data', () => {
  it('2026 usa a Portaria 13/2026; 2025 a 6/2025', () => {
    expect(inss26.teto).toBe(8475.55);
    expect(tabelaInssEm('2025-12-31').tabela.teto).toBe(8157.41);
    expect(tabelaInssEm('2026-11-20').foraDaLista).toBe(false);
  });
  it('IRRF: redução da Lei 15.270 só a partir de 2026', () => {
    expect(irrf26.reducao?.maxima).toBe(312.89);
    expect(tabelaIrrfEm('2025-12-31').tabela.reducao).toBeNull();
  });
  it('ano sem tabela cadastrada é sinalizado (usa a última)', () => {
    const r = tabelaInssEm('2027-01-15');
    expect(r.foraDaLista).toBe(true);
    expect(r.tabela.teto).toBe(8475.55);
  });
  it('as listas estão em ordem de vigência e a última faixa do INSS é o teto', () => {
    for (const l of [TABELAS_INSS, TABELAS_IRRF]) {
      const datas = l.map((t) => t.vigenciaDesde);
      expect([...datas].sort()).toEqual(datas);
    }
    for (const t of TABELAS_INSS) expect(t.faixas[t.faixas.length - 1].ate).toBe(t.teto);
  });
});

describe('INSS progressivo (2026)', () => {
  it('só na 1ª faixa: 1.333,33 × 7,5% = 99,99975 → 100,00', () => {
    expect(calcularInss(1333.33, inss26).valor).toBe(100);
  });
  it('2.000,00: 1.621 × 7,5% (121,575) + 379 × 9% (34,11) = 155,685 → 155,69', () => {
    expect(calcularInss(2000, inss26).valor).toBe(155.69);
  });
  it('3.000,00: 121,575 + 1.281,84 × 9% (115,3656) + 97,16 × 12% (11,6592) = 248,5998 → 248,60', () => {
    const r = calcularInss(3000, inss26);
    expect(r.valor).toBe(248.6);
    expect(r.parcelas).toHaveLength(3);
  });
  it('5.000,00: 121,575 + 115,3656 + 1.451,43 × 12% (174,1716) + 645,73 × 14% (90,4022) = 501,51', () => {
    expect(calcularInss(5000, inss26).valor).toBe(501.51);
  });
  it('acima do teto: 10.000 limitado a 8.475,55 → 988,09', () => {
    const r = calcularInss(10000, inss26);
    expect(r.valor).toBe(988.09);
    expect(r.baseConsiderada).toBe(8475.55);
    expect(r.memoria).toContain('teto');
  });
  it('2025: 4.000,00 → 1.518 × 7,5% + 1.275,88 × 9% + 1.206,12 × 12% = 373,41', () => {
    expect(calcularInss(4000, tabelaInssEm('2025-06-10').tabela).valor).toBe(373.41);
  });
  it('base zero ou negativa → zero', () => {
    expect(calcularInss(0, inss26).valor).toBe(0);
    expect(calcularInss(-5, inss26).valor).toBe(0);
  });
});

describe('IRRF mensal (2026)', () => {
  it('exemplo da Receita: 6.000,00 com simplificado → 574,29 − redução 179,75 = 394,54', () => {
    const r = calcularIrrf({ rendimentos: 6000, inss: 0, permitirSimplificado: true }, irrf26);
    expect(r.deducaoUsada).toBe('simplificado');
    expect(r.base).toBe(5392.8);
    expect(r.impostoTabela).toBe(574.29);
    expect(r.reducao).toBe(179.75); // 978,62 − 0,133145 × 6.000
    expect(r.valor).toBe(394.54);
  });
  it('até 5.000,00 a redução zera: 5.000 − 607,20 = 4.392,80 × 22,5% − 675,49 = 312,89 − 312,89 = 0', () => {
    const r = calcularIrrf({ rendimentos: 5000, inss: 501.51, permitirSimplificado: true }, irrf26);
    expect(r.deducaoUsada).toBe('simplificado'); // 501,51 < 607,20
    expect(r.impostoTabela).toBe(312.89);
    expect(r.valor).toBe(0);
  });
  it('acima de 7.350,00 sem redução: 10.000 − (988,09 + 2 × 189,59) = 8.632,73 × 27,5% − 908,73 = 1.465,27', () => {
    const r = calcularIrrf({ rendimentos: 10000, inss: 988.09, dependentes: 2, permitirSimplificado: true }, irrf26);
    expect(r.deducaoUsada).toBe('legal');
    expect(r.base).toBe(8632.73);
    expect(r.reducao).toBe(0);
    expect(r.valor).toBe(1465.27);
  });
  it('sem permitir simplificado usa só as deduções legais', () => {
    // 3.000 − 248,60 = 2.751,40 × 7,5% − 182,16 = 24,195 → 24,20; até 5.000 a redução zera
    const r = calcularIrrf({ rendimentos: 3000, inss: 248.6 }, irrf26);
    expect(r.deducaoUsada).toBe('legal');
    expect(r.impostoTabela).toBe(24.2);
    expect(r.valor).toBe(0);
    const sem = calcularIrrf({ rendimentos: 3000, inss: 248.6, aplicarReducao: false }, irrf26);
    expect(sem.valor).toBe(24.2);
    expect(sem.memoria).toContain('sem a redução');
  });
  it('2025 (sem redução): 4.000 − 607,20 = 3.392,80 × 15% − 394,16 = 114,76', () => {
    const r = calcularIrrf({ rendimentos: 4000, inss: 373.41, permitirSimplificado: true }, tabelaIrrfEm('2025-06-10').tabela);
    expect(r.valor).toBe(114.76);
  });
  it('faixa isenta e rendimento zero', () => {
    expect(calcularIrrf({ rendimentos: 2000, inss: 155.69 }, irrf26).valor).toBe(0);
    expect(calcularIrrf({ rendimentos: 0, inss: 0 }, irrf26).valor).toBe(0);
  });
});
