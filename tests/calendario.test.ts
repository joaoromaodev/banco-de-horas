import { describe, it, expect } from 'vitest';
import {
  diasNoMes, diaSemana, chaveData, tipoDoDia, ehDiaDeTrabalho, minutosACumprir,
  minutosACumprirDia, JORNADA_PADRAO, MESES, DIAS_SEMANA, type Jornada,
} from '@/lib/calendario';

const comSabado: Jornada = { utilMin: 480, sabadoMin: 240, trabalhaSabado: true };

describe('calendário básico', () => {
  it('tem 12 meses (índice 1..12) e 7 dias da semana', () => {
    expect(MESES).toHaveLength(13);
    expect(MESES[3]).toBe('MARÇO');
    expect(DIAS_SEMANA[0]).toBe('DOMINGO');
  });
  it('diasNoMes considera ano bissexto', () => {
    expect(diasNoMes(2024, 2)).toBe(29);
    expect(diasNoMes(2026, 2)).toBe(28);
    expect(diasNoMes(2026, 11)).toBe(30);
    expect(diasNoMes(2026, 12)).toBe(31);
    expect(diasNoMes(2100, 2)).toBe(28);
  });
  it('diaSemana: 0=domingo ... 6=sábado', () => {
    expect(diaSemana(2026, 11, 21)).toBe(6); // sábado
    expect(diaSemana(2026, 11, 22)).toBe(0); // domingo
    expect(diaSemana(2026, 11, 23)).toBe(1); // segunda
  });
  it('chaveData completa com zeros', () => {
    expect(chaveData(2026, 3, 5)).toBe('2026-03-05');
  });
});

describe('tipoDoDia', () => {
  const feriados = new Set(['2026-11-20']); // sexta
  it('feriado vence o dia da semana', () => {
    expect(tipoDoDia(2026, 11, 20, feriados)).toBe('feriado');
  });
  it('útil, sábado e domingo', () => {
    expect(tipoDoDia(2026, 11, 19, feriados)).toBe('util');
    expect(tipoDoDia(2026, 11, 21, feriados)).toBe('sabado');
    expect(tipoDoDia(2026, 11, 22, feriados)).toBe('domingo');
  });
  it('feriado em domingo continua feriado', () => {
    expect(tipoDoDia(2026, 11, 22, new Set(['2026-11-22']))).toBe('feriado');
  });
});

describe('jornada', () => {
  it('padrão: sábado é folga', () => {
    expect(JORNADA_PADRAO.trabalhaSabado).toBe(false);
    expect(ehDiaDeTrabalho('sabado')).toBe(false);
    expect(minutosACumprir('sabado')).toBe(0);
  });
  it('empresa que trabalha aos sábados', () => {
    expect(ehDiaDeTrabalho('sabado', comSabado)).toBe(true);
    expect(minutosACumprir('sabado', comSabado)).toBe(240);
  });
  it('útil = 8h; domingo e feriado = 0', () => {
    expect(minutosACumprir('util')).toBe(480);
    expect(minutosACumprir('domingo')).toBe(0);
    expect(minutosACumprir('feriado', comSabado)).toBe(0);
    expect(ehDiaDeTrabalho('feriado')).toBe(false);
  });
});

describe('minutosACumprirDia (marcadores)', () => {
  it.each(['FALTA', 'ATESTADO', 'FÉRIAS', 'FOLGA'] as const)('%s zera o a cumprir', (m) => {
    expect(minutosACumprirDia('util', m)).toBe(0);
  });
  it('BANCO DE HORAS mantém o débito (uso intencional das horas)', () => {
    expect(minutosACumprirDia('util', 'BANCO DE HORAS')).toBe(480);
  });
  it('FERIADO como marcador não zera sozinho — o tipo do dia é que zera', () => {
    expect(minutosACumprirDia('util', 'FERIADO')).toBe(480);
    expect(minutosACumprirDia('feriado', 'FERIADO')).toBe(0);
  });
  it('sem marcador usa o tipo do dia', () => {
    expect(minutosACumprirDia('util', null)).toBe(480);
    expect(minutosACumprirDia('util', undefined)).toBe(480);
    expect(minutosACumprirDia('sabado', null, comSabado)).toBe(240);
  });
});
