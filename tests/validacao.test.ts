import { describe, it, expect } from 'vitest';
import { validar } from '@/lib/validacao';
import type { Frequencia, DiaFreq } from '@/lib/tipos';

// Novembro/2026: dia 2 = segunda, 7 = sábado, 8 = domingo.
const dia = (n: number, e: string | null, sa: string | null, ra: string | null, st: string | null, marcador?: DiaFreq['marcador']): DiaFreq =>
  ({ dia: n, entradaManha: e, saidaAlmoco: sa, retornoAlmoco: ra, saidaTarde: st, marcador });
const freq = (dias: DiaFreq[]): Frequencia => ({ empresa: 'x', funcionario: 'Fulana', ano: 2026, mes: 11, dias });
const doDia = (alertas: ReturnType<typeof validar>, n: number) => alertas.filter((a) => a.dia === n);
const SEM_FERIADOS = new Set<string>();

describe('validar (folha de ponto)', () => {
  it('dia normal completo não gera alerta', () => {
    const r = validar(freq([dia(2, '08:00', '12:00', '13:00', '17:00')]), SEM_FERIADOS);
    expect(doDia(r, 2)).toEqual([]);
  });

  it('dia útil vazio e sem marcador gera alerta', () => {
    const r = validar(freq([]), SEM_FERIADOS);
    expect(doDia(r, 2)[0]).toMatchObject({ campo: 'geral', nivel: 'alerta' });
    expect(doDia(r, 2)[0].msg).toMatch(/vazio/);
  });

  it('dia útil com marcador não alerta de vazio', () => {
    const r = validar(freq([dia(2, null, null, null, null, 'ATESTADO')]), SEM_FERIADOS);
    expect(doDia(r, 2)).toEqual([]);
  });

  it('domingo e sábado (folga) vazios são normais', () => {
    const r = validar(freq([]), SEM_FERIADOS);
    expect(doDia(r, 7)).toEqual([]);
    expect(doDia(r, 8)).toEqual([]);
  });

  it('horário lançado em domingo gera alerta', () => {
    const r = validar(freq([dia(8, '08:00', '12:00', '13:00', '17:00')]), SEM_FERIADOS);
    expect(doDia(r, 8).some((a) => /domingo/.test(a.msg))).toBe(true);
  });

  it('horário lançado em feriado gera alerta', () => {
    const r = validar(freq([dia(2, '08:00', '12:00', '13:00', '17:00')]), new Set(['2026-11-02']));
    expect(doDia(r, 2).some((a) => /feriado/.test(a.msg))).toBe(true);
  });

  it('ordem fora de sequência é erro', () => {
    const r = validar(freq([dia(2, '08:00', '12:00', '11:00', '17:00')]), SEM_FERIADOS);
    expect(doDia(r, 2).find((a) => a.campo === 'retornoAlmoco')).toMatchObject({ nivel: 'erro' });
  });

  it('horário repetido é só alerta', () => {
    const r = validar(freq([dia(2, '08:00', '12:00', '12:00', '17:00')]), SEM_FERIADOS);
    expect(doDia(r, 2).find((a) => a.campo === 'retornoAlmoco')).toMatchObject({ nivel: 'alerta' });
  });

  it('entrada e saída fora do usual', () => {
    const r = validar(freq([dia(2, '04:00', '12:00', '13:00', '23:00')]), SEM_FERIADOS);
    const campos = doDia(r, 2).map((a) => a.campo);
    expect(campos).toContain('entradaManha');
    expect(campos).toContain('saidaTarde');
  });

  it('jornada acima de 12h', () => {
    const r = validar(freq([dia(2, '06:00', '13:00', '14:00', '21:00')]), SEM_FERIADOS);
    expect(doDia(r, 2).some((a) => /acima de 12h/.test(a.msg))).toBe(true);
  });

  it('horários incompletos num dia de trabalho', () => {
    const r = validar(freq([dia(2, '08:00', null, null, '17:00')]), SEM_FERIADOS);
    expect(doDia(r, 2).some((a) => /incompletos/.test(a.msg))).toBe(true);
  });

  it('sábado só é dia de trabalho se a jornada permitir', () => {
    const sab = freq([dia(7, '08:00', null, null, '12:00')]);
    expect(doDia(validar(sab, SEM_FERIADOS), 7).some((a) => /sábado/.test(a.msg))).toBe(true);
    const r = validar(sab, SEM_FERIADOS, { utilMin: 480, sabadoMin: 240, trabalhaSabado: true });
    expect(doDia(r, 7).some((a) => /sábado/.test(a.msg))).toBe(false);
  });
});
