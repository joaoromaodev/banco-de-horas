import { describe, it, expect } from 'vitest';
import { avisoAfastamento13, avosDecimo, entraNoDecimo, faltasPorMesDoAno, prazosDecimo } from '@/lib/decimoTerceiro';

const e = (admissao: string | null, extra: Record<string, unknown> = {}) =>
  ({ admissao, situacao: 'ativo' as const, situacaoDesde: null, ...extra });

describe('avos do 13º (Lei 4.090/62 art. 1º §2º)', () => {
  it('ano inteiro = 12 avos', () => {
    expect(avosDecimo(e('2024-05-02'), 2026).previstos).toBe(12);
  });
  it('mês da admissão conta com 15 dias ou mais', () => {
    expect(avosDecimo(e('2026-03-17'), 2026).meses[2]).toMatchObject({ diasContrato: 15, conta: true });
    expect(avosDecimo(e('2026-03-18'), 2026).meses[2]).toMatchObject({ diasContrato: 14, conta: false });
    expect(avosDecimo(e('2026-03-18'), 2026).previstos).toBe(9);
  });
  it('faltas lançadas podem derrubar o avo do mês', () => {
    const faltas = faltasPorMesDoAno(['2026-03-20', '2026-03-21', '2025-03-01'], 2026);
    expect(faltas.get(3)).toBe(2);
    expect(avosDecimo(e('2026-03-15'), 2026, faltas).meses[2]).toMatchObject({ diasContrato: 17, faltas: 2, conta: true });
    expect(avosDecimo(e('2026-03-16'), 2026, faltas).meses[2].conta).toBe(false);
  });
  it('desligado: até o desligamento', () => {
    expect(avosDecimo(e('2020-01-01', { situacao: 'desligado', situacaoDesde: '2026-06-14' }), 2026).previstos).toBe(5);
    expect(avosDecimo(e('2020-01-01', { situacao: 'desligado', situacaoDesde: '2026-06-15' }), 2026).previstos).toBe(6);
  });
  it('avos já contados × previstos', () => {
    const a = avosDecimo(e('2026-01-01'), 2026, new Map(), '2026-11-21');
    expect(a.avos).toBe(11);
    expect(a.previstos).toBe(12);
    expect(a.meses[11].projetado).toBe(true);
  });
  it('sem admissão = zero', () => {
    expect(avosDecimo(e(null), 2026).previstos).toBe(0);
  });
});

describe('prazos (Lei 4.749/65)', () => {
  it('30/11 e 20/12, antecipando para dia útil', () => {
    expect(prazosDecimo(2026)).toEqual({ primeira: '2026-11-30', segunda: '2026-12-18' });
    expect(prazosDecimo(2025)).toEqual({ primeira: '2025-11-28', segunda: '2025-12-19' });
  });
});

describe('quem entra e avisos', () => {
  it('ativo e afastado entram; desligado e sem admissão não', () => {
    expect(entraNoDecimo(e('2026-12-31'), 2026)).toBe(true);
    expect(entraNoDecimo(e('2027-01-02'), 2026)).toBe(false);
    expect(entraNoDecimo(e(null), 2026)).toBe(false);
    expect(entraNoDecimo(e('2020-01-01', { situacao: 'desligado', situacaoDesde: '2026-05-01' }), 2026)).toBe(false);
    expect(entraNoDecimo(e('2020-01-01', { situacao: 'afastado', situacaoDesde: '2026-05-01' }), 2026)).toBe(true);
  });
  it('aviso por tipo de afastamento', () => {
    expect(avisoAfastamento13({ situacao: 'ativo', afastamentoTipo: null })).toBeNull();
    expect(avisoAfastamento13({ situacao: 'afastado', afastamentoTipo: 'acidente' })).toMatch(/Súmula 46/);
    expect(avisoAfastamento13({ situacao: 'afastado', afastamentoTipo: 'doenca' })).toMatch(/15º dia/);
  });
});
