import { describe, it, expect } from 'vitest';
import { parseHoraParaMin, minParaFracaoDia, horaParaFracaoDia, formatarMin } from '@/lib/tempo';

describe('parseHoraParaMin', () => {
  it.each([
    ['08:00', 480],
    ['8:00', 480],
    ['08h00', 480],
    ['0800', 480],
    ['08.30', 510],
    ['00:00', 0],
    ['23:59', 1439],
    ['  12:15 ', 735],
  ])('lê %s como %i min', (entrada, esperado) => {
    expect(parseHoraParaMin(entrada)).toBe(esperado);
  });

  it.each([null, undefined, '', '   ', 'abc', '24:00', '12:60', '8', '123456'])('devolve null para %j', (v) => {
    expect(parseHoraParaMin(v as string | null | undefined)).toBeNull();
  });
});

describe('conversões para fração do dia (Excel)', () => {
  it('minutos -> fração', () => {
    expect(minParaFracaoDia(720)).toBe(0.5);
    expect(minParaFracaoDia(null)).toBe(0);
  });
  it('hora -> fração', () => {
    expect(horaParaFracaoDia('06:00')).toBe(0.25);
    expect(horaParaFracaoDia('lixo')).toBe(0);
  });
});

describe('formatarMin', () => {
  it('formata positivos, zero e negativos', () => {
    expect(formatarMin(0)).toBe('0:00');
    expect(formatarMin(65)).toBe('1:05');
    expect(formatarMin(600)).toBe('10:00');
    expect(formatarMin(-90)).toBe('-1:30');
  });
});
