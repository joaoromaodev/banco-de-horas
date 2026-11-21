// Médias de HE e noturno do ponto (lib/mediasPonto.ts) — valores conferidos à mão.
import { describe, it, expect } from 'vitest';
import {
  diasDeContratoNoMes, diasDsrDoMes, mediaDoPeriodo, mesesEntre, somarMes, ultimoMesDasMedias, type MesPonto,
} from '@/lib/mediasPonto';

// Valor-hora 10,00 (R$ 2.200 ÷ 220). Todo mês: 10 h de HE 50%, 25 dias úteis e 5 de DSR
// → DSR = 10 ÷ 25 × 5 = 2 h → 12 h × 1,5 × 10 = R$ 180,00.
// Outubro/26 tem ainda 5 h de HE 100% (DSR 1 h → 6 h × 2 × 10 = 120,00) e 2 h de noturno
// (DSR 0,4 h → 2,4 h × 0,2 × 10 = 4,80): mês = 304,80.
const mes = (m: string, extra: Partial<MesPonto> = {}): MesPonto => ({
  mes: m, temPonto: true, he50Min: 600, he100Min: 0, noturnoMin: 0, diasNaoCalculados: 0, diasUteis: 25, diasDsr: 5, ...extra,
});
const PONTO: MesPonto[] = [
  ...mesesEntre('2025-01', '2026-09').map((m) => mes(m)),
  mes('2026-10', { he100Min: 300, noturnoMin: 120 }),
];
const op = { admissao: '2025-01-01', desligamento: '2026-11-20', valorHora: 10 };

describe('calendário das médias', () => {
  it('meses e somas de mês', () => {
    expect(somarMes('2026-01', -1)).toBe('2025-12');
    expect(somarMes('2025-11', 11)).toBe('2026-10');
    expect(mesesEntre('2025-11', '2026-10')).toHaveLength(12);
  });
  it('DSR de novembro/2026: 5 domingos + feriados de 02 e 20 (o de 15 cai no domingo) = 7; úteis 23', () => {
    expect(diasDsrDoMes(2026, 11, new Set(['2026-11-02', '2026-11-15', '2026-11-20']))).toEqual({ diasUteis: 23, diasDsr: 7 });
  });
  it('mês do desligamento incompleto fica fora (opção de incluir); completo entra', () => {
    expect(ultimoMesDasMedias('2026-11-20')).toBe('2026-10');
    expect(ultimoMesDasMedias('2026-11-20', true)).toBe('2026-11');
    expect(ultimoMesDasMedias('2026-11-30')).toBe('2026-11');
  });
  it('dias de contrato no mês', () => {
    expect(diasDeContratoNoMes('2026-06', '2026-06-20', '2026-11-20')).toBe(11);
    expect(diasDeContratoNoMes('2026-11', '2020-01-01', '2026-11-20')).toBe(20);
    expect(diasDeContratoNoMes('2026-05', '2026-06-20', '2026-11-20')).toBe(0);
  });
});

describe('média do período', () => {
  it('aviso (12 meses): (11 × 180 + 304,80) ÷ 12 = 190,40', () => {
    const r = mediaDoPeriodo(PONTO, { ...op, de: '2025-11', ate: '2026-10' });
    expect(r.nMeses).toBe(12);
    expect(r.valor).toBe(190.4);
    expect(r.horas.he50).toBeCloseTo(12, 6);
    expect(r.horas.he100).toBeCloseTo(0.5, 6); // 6 h ÷ 12
    expect(r.memoria).toContain('12 meses (nov/25 a out/26)');
  });
  it('mês sem ponto entra com zero e conta no divisor: (10 × 180 + 304,80) ÷ 12 = 175,40', () => {
    const ponto = PONTO.map((m) => (m.mes === '2026-03' ? { ...m, temPonto: false, he50Min: 0 } : m));
    const r = mediaDoPeriodo(ponto, { ...op, de: '2025-11', ate: '2026-10' });
    expect(r.valor).toBe(175.4);
    expect(r.meses.find((m) => m.mes === '2026-03')?.nota).toContain('Sem ponto');
  });
  it('a contadora ignora o mês sem ponto: 2.104,80 ÷ 11 = 191,345… → 191,35', () => {
    const ponto = PONTO.map((m) => (m.mes === '2026-03' ? { ...m, temPonto: false, he50Min: 0 } : m));
    const r = mediaDoPeriodo(ponto, { ...op, de: '2025-11', ate: '2026-10', ajustes: { '2026-03': { ignorar: true } } });
    expect(r.nMeses).toBe(11);
    expect(r.valor).toBe(191.35);
  });
  it('a contadora ajusta as horas de um mês: março com 20 h de HE 50% (DSR 4 h → 24 × 1,5 × 10 = 360)', () => {
    const r = mediaDoPeriodo(PONTO, { ...op, de: '2025-11', ate: '2026-10', ajustes: { '2026-03': { he50Min: 1200 } } });
    // (10 × 180 + 360 + 304,80) ÷ 12 = 2.464,80 ÷ 12 = 205,40
    expect(r.valor).toBe(205.4);
    expect(r.meses.find((m) => m.mes === '2026-03')?.ajustado).toBe(true);
  });
  it('13º (meses do ano): jan a out/26 = (9 × 180 + 304,80) ÷ 10 = 192,48', () => {
    expect(mediaDoPeriodo(PONTO, { ...op, de: '2026-01', ate: '2026-10' }).valor).toBe(192.48);
  });
  it('admissão no meio do período: mês com menos de 15 dias fica fora do divisor', () => {
    const r = mediaDoPeriodo(PONTO, { ...op, admissao: '2026-06-20', de: '2025-11', ate: '2026-10' });
    // jun/26 tem 11 dias de contrato (fora); jul a out = 4 meses: (3 × 180 + 304,80) ÷ 4 = 211,20
    expect(r.meses.map((m) => m.mes)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(r.nMeses).toBe(4);
    expect(r.valor).toBe(211.2);
  });
  it('sem horas: média zero com memória clara; período vazio também', () => {
    const zero = PONTO.map((m) => ({ ...m, he50Min: 0, he100Min: 0, noturnoMin: 0 }));
    const r = mediaDoPeriodo(zero, { ...op, de: '2025-11', ate: '2026-10' });
    expect(r.valor).toBe(0);
    expect(r.memoria).toContain('Sem horas extras');
    expect(mediaDoPeriodo(PONTO, { ...op, de: '2026-11', ate: '2026-10' }).nMeses).toBe(0);
  });
});
