import { describe, expect, it } from 'vitest';
import { anoMesDaUrl, linkPonto, mesInicialPonto, urlDoPonto } from '@/lib/pontoUrl';
import { hojeBelem } from '@/lib/agenda';

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

describe('mês inicial da Timesheet (Sprint 18 · A)', () => {
  it('sem URL abre no mês de hoje — não mais em junho fixo', () => {
    expect(mesInicialPonto('', '2026-11-21')).toEqual({ ano: 2026, mes: 11 });
    expect(mesInicialPonto('?empresa=x', '2027-01-03')).toEqual({ ano: 2027, mes: 1 });
  });
  it('a URL manda; parte que falta vem de hoje', () => {
    expect(mesInicialPonto('?ano=2025&mes=3', '2026-11-21')).toEqual({ ano: 2025, mes: 3 });
    expect(mesInicialPonto('?ano=2025', '2026-11-21')).toEqual({ ano: 2025, mes: 11 });
    expect(mesInicialPonto('?mes=2', '2026-11-21')).toEqual({ ano: 2026, mes: 2 });
    expect(mesInicialPonto('?ano=abc&mes=13', '2026-11-21')).toEqual({ ano: 2026, mes: 11 });
  });
  it('o "hoje" é o de Belém: 01:00 UTC do dia 1º ainda é o mês anterior lá', () => {
    expect(mesInicialPonto('', hojeBelem(new Date('2026-12-01T01:00:00Z')))).toEqual({ ano: 2026, mes: 11 });
    expect(mesInicialPonto('', hojeBelem(new Date('2026-12-01T04:00:00Z')))).toEqual({ ano: 2026, mes: 12 });
  });
  it('as telas do ponto não têm mais mês fixo', async () => {
    const { readFileSync } = await import('node:fs');
    for (const t of ['ponto', 'folhas']) {
      const src = readFileSync(`app/(app)/${t}/page.tsx`, 'utf8');
      expect(src, t).not.toMatch(/useState\(6\)|useState\(2026\)/);
      expect(src, t).toMatch(/mesInicialPonto\(/);
    }
  });
});
