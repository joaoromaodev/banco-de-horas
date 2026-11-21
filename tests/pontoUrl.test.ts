import { describe, expect, it } from 'vitest';
import { anoMesDaUrl, linkPonto, urlDoPonto } from '@/lib/pontoUrl';

describe('URL da Timesheet', () => {
  it('lê ano e mês válidos e ignora o resto', () => {
    expect(anoMesDaUrl('?empresa=x&ano=2026&mes=11')).toEqual({ ano: 2026, mes: 11 });
    expect(anoMesDaUrl('?ano=abc&mes=13')).toEqual({ ano: null, mes: null });
    expect(anoMesDaUrl('?ano=1999&mes=0')).toEqual({ ano: null, mes: null });
    expect(anoMesDaUrl('')).toEqual({ ano: null, mes: null });
  });

  it('grava empresa, ano e mês mantendo os outros parâmetros', () => {
    const r = urlDoPonto('http://x/ponto?outra=1', 'e 1', 2026, 3);
    const u = new URL(r);
    expect(u.searchParams.get('empresa')).toBe('e 1');
    expect(u.searchParams.get('ano')).toBe('2026');
    expect(u.searchParams.get('mes')).toBe('3');
    expect(u.searchParams.get('outra')).toBe('1');
  });

  it('não grava ano em digitação incompleta', () => {
    expect(new URL(urlDoPonto('http://x/ponto?ano=2026', 'e', 20, 3)).searchParams.has('ano')).toBe(false);
  });

  it('monta o link com ou sem mês', () => {
    expect(linkPonto('e1')).toBe('/ponto?empresa=e1');
    expect(linkPonto('e1', 2026, 10)).toBe('/ponto?empresa=e1&ano=2026&mes=10');
  });
});
