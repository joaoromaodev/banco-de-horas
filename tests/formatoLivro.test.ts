import { describe, it, expect } from 'vitest';
import { MESES_LONGOS } from '@/lib/formatoLivro';
import { dataBR, isoParaBR } from '@/lib/data';

describe('formatoLivro', () => {
  it('12 meses em português, janeiro a dezembro', () => {
    expect(MESES_LONGOS).toHaveLength(12);
    expect(MESES_LONGOS[0]).toBe('Janeiro');
    expect(MESES_LONGOS[2]).toBe('Março');
    expect(MESES_LONGOS[11]).toBe('Dezembro');
  });
});

describe('data.ts', () => {
  it('isoParaBR converte e ignora hora', () => {
    expect(isoParaBR('2026-11-21')).toBe('21/11/2026');
    expect(isoParaBR('2026-11-21T10:00:00Z')).toBe('21/11/2026');
  });
  it('isoParaBR devolve a entrada quando não é ISO', () => {
    expect(isoParaBR('lixo')).toBe('lixo');
  });
  it('dataBR formata com zeros', () => {
    expect(dataBR(new Date(2026, 0, 5))).toBe('05/01/2026');
  });
});
