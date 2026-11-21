import { describe, expect, it } from 'vitest';
import type { DiaFreq, Marcador } from '@/lib/tipos';
import {
  computarNoturno, intervalosDoDia, minutosNoturnos, resumirFolha, resumirMes, resumoParaCsv, regrasDoEmpregado,
  textoAssinatura, type FolhaResumo,
} from '@/lib/resumoFolha';
import { JORNADA_PADRAO } from '@/lib/calendario';

// Outubro/2026: 1 = quinta; domingos 4, 11, 18, 25; sábados 3, 10, 17, 24, 31.
const OP = { ano: 2026, mes: 10, feriados: new Set<string>() };

const dia = (d: number, e?: string, s?: string, e2?: string, s2?: string, marcador?: Marcador): DiaFreq => ({
  dia: d, entradaManha: e ?? null, saidaAlmoco: s ?? null, retornoAlmoco: e2 ?? null, saidaTarde: s2 ?? null, marcador: marcador ?? null,
});
const normal = (d: number) => dia(d, '08:00', '12:00', '13:00', '17:00');
const folha = (dias: DiaFreq[], extra: Partial<FolhaResumo> = {}): FolhaResumo => ({ funcionario: 'ANA', dias, ...extra });
const banco = { jornada: JORNADA_PADRAO, temBanco: true };

describe('horas normais, extras e atrasos', () => {
  it('dia de 8h: tudo normal', () => {
    const r = resumirFolha(folha([normal(1)]), OP);
    expect(r.normaisMin).toBe(480);
    expect(r.extrasUtilPagarMin).toBe(0);
    expect(r.atrasoMin).toBe(0);
    expect(r.diasTrabalhados).toBe(1);
  });
  it('9h30 em dia útil: 1h30 de extra a pagar', () => {
    const r = resumirFolha(folha([dia(1, '08:00', '12:00', '13:00', '18:30')]), OP);
    expect(r.extrasUtilPagarMin).toBe(90);
    expect(r.normaisMin).toBe(480);
  });
  it('tolerância de 10 min no dia: 8h08 e 7h55 não geram extra nem atraso; 8h11 conta tudo', () => {
    const r1 = resumirFolha(folha([dia(1, '08:00', '12:00', '13:00', '17:08'), dia(2, '08:00', '12:00', '13:00', '16:55')]), OP);
    expect(r1.extrasUtilPagarMin).toBe(0);
    expect(r1.atrasoMin).toBe(0);
    const r2 = resumirFolha(folha([dia(1, '08:00', '12:00', '13:00', '17:11')]), OP);
    expect(r2.extrasUtilPagarMin).toBe(11);
  });
  it('7h45: 15 min de atraso a descontar', () => {
    const r = resumirFolha(folha([dia(1, '08:00', '12:00', '13:00', '16:45')]), OP);
    expect(r.atrasoMin).toBe(15);
    expect(r.conferir.some((c) => c.texto.includes('Atraso aproximado'))).toBe(true);
  });
  it('domingo e feriado cadastrado: toda a hora é extra a 100%', () => {
    const r = resumirFolha(folha([dia(4, '08:00', '12:00'), dia(12, '09:00', '13:00')]), { ...OP, feriados: new Set(['2026-10-12']) });
    expect(r.extrasDomFeriadoMin).toBe(480);
    expect(r.normaisMin).toBe(0);
    expect(r.detalhe.find((d) => d.dia === 12)?.situacao).toBe('Feriado trabalhado');
  });
  it('sábado de folga trabalhado: extra a 50% e pede conferência da convenção', () => {
    const r = resumirFolha(folha([dia(3, '08:00', '11:00')]), OP);
    expect(r.extrasUtilPagarMin).toBe(180);
    expect(r.conferir.some((c) => c.texto.includes('sábado de folga'))).toBe(true);
  });
  it('sábado trabalhado com jornada de sábado: 4h normais', () => {
    const r = resumirFolha(folha([dia(3, '08:00', '12:00')], { regras: { jornada: { utilMin: 480, sabadoMin: 240, trabalhaSabado: true }, temBanco: false } }), OP);
    expect(r.normaisMin).toBe(240);
    expect(r.extrasUtilPagarMin).toBe(0);
  });
  it('com banco de horas: extra de dia útil vai para o banco, atraso abate; domingo continua a pagar', () => {
    const r = resumirFolha(folha([
      dia(1, '08:00', '12:00', '13:00', '18:00'), // +60
      dia(2, '08:00', '12:00', '13:00', '16:30'), // −30
      dia(4, '08:00', '10:00'), // domingo 2h
      dia(5, undefined, undefined, undefined, undefined, 'BANCO DE HORAS'), // −8h
    ], { regras: banco }), OP);
    expect(r.extrasUtilBancoMin).toBe(60);
    expect(r.extrasUtilPagarMin).toBe(0);
    expect(r.atrasoMin).toBe(0);
    expect(r.debitoBancoMin).toBe(30 + 480);
    expect(r.saldoBancoMovMin).toBe(60 - 510);
    expect(r.extrasDomFeriadoMin).toBe(120);
  });
  it('BANCO DE HORAS sem acordo de banco pede conferência', () => {
    const r = resumirFolha(folha([dia(5, undefined, undefined, undefined, undefined, 'BANCO DE HORAS')]), OP);
    expect(r.debitoBancoMin).toBe(0);
    expect(r.conferir.some((c) => c.texto.includes('não tem banco'))).toBe(true);
  });
});

describe('faltas, DSR e marcadores', () => {
  it('duas faltas na mesma semana perdem um DSR só', () => {
    const r = resumirFolha(folha([dia(6, undefined, undefined, undefined, undefined, 'FALTA'), dia(7, undefined, undefined, undefined, undefined, 'FALTA')]), OP);
    expect(r.faltas).toBe(2);
    expect(r.dsrPerdidos).toBe(1);
  });
  it('falta em semanas diferentes: dois DSR', () => {
    const r = resumirFolha(folha([dia(6, undefined, undefined, undefined, undefined, 'FALTA'), dia(14, undefined, undefined, undefined, undefined, 'FALTA')]), OP);
    expect(r.dsrPerdidos).toBe(2);
  });
  it('falta na última semana: o DSR vai para o mês seguinte', () => {
    const r = resumirFolha(folha([dia(28, undefined, undefined, undefined, undefined, 'FALTA')]), OP);
    expect(r.faltas).toBe(1);
    expect(r.dsrPerdidos).toBe(0);
    expect(r.dsrDoProximoMes).toBe(1);
  });
  it('falta do fim do mês anterior perde o DSR do domingo de outubro', () => {
    const r = resumirFolha(folha([normal(1)], { anteriores: [dia(29, undefined, undefined, undefined, undefined, 'FALTA')] }), OP);
    expect(r.faltas).toBe(0);
    expect(r.dsrPerdidos).toBe(1); // 29/09 (terça) → domingo 04/10
  });
  it('falta em sábado de folga não é falta', () => {
    const r = resumirFolha(folha([dia(3, undefined, undefined, undefined, undefined, 'FALTA')]), OP);
    expect(r.faltas).toBe(0);
    expect(r.dsrPerdidos).toBe(0);
  });
  it('atestado, férias, folga e feriado são contados como dias, sem débito nem DSR', () => {
    const r = resumirFolha(folha([
      dia(1, undefined, undefined, undefined, undefined, 'ATESTADO'), dia(2, undefined, undefined, undefined, undefined, 'FÉRIAS'),
      dia(5, undefined, undefined, undefined, undefined, 'FOLGA'), dia(12, undefined, undefined, undefined, undefined, 'FERIADO'),
    ]), OP);
    expect([r.atestadoDias, r.feriasDias, r.folgaDias, r.feriadoDias]).toEqual([1, 1, 1, 1]);
    expect(r.dsrPerdidos).toBe(0);
    expect(r.atrasoMin).toBe(0);
    expect(r.debitoBancoMin).toBe(0);
  });
});

describe('impedimentos', () => {
  it('marcação faltando impede e o dia não entra na conta', () => {
    const r = resumirFolha(folha([dia(1, '08:00', '12:00', '13:00'), normal(2)]), OP);
    expect(r.impedimentos.map((a) => a.codigo)).toContain('marcacao_impar');
    expect(r.detalhe[0].naoCalculado).toBe(true);
    expect(r.normaisMin).toBe(480);
  });
  it('horário ilegível e marcador × horário impedem', () => {
    const r = resumirFolha(folha([dia(1, '08:00', '12>54', '13:00', '17:00'), dia(2, '08:00', '12:00', '13:00', '17:00', 'ATESTADO')]), OP);
    expect(r.impedimentos.map((a) => a.codigo).sort()).toEqual(['horario_invalido', 'marcador_com_horario']);
    expect(r.diasTrabalhados).toBe(0);
  });
  it('alerta que não impede (intervalo curto) não trava', () => {
    const r = resumirFolha(folha([dia(1, '08:00', '12:00', '12:30', '17:00')]), OP);
    expect(r.impedimentos).toHaveLength(0);
  });
});

describe('adicional noturno', () => {
  it('20h–23h30: 1h30 reais na faixa viram 1h43 com a hora reduzida', () => {
    const r = resumirFolha(folha([dia(1, '20:00', undefined, undefined, '23:30')]), OP);
    expect(r.noturnoRealMin).toBe(90);
    expect(r.noturnoComputadoMin).toBe(computarNoturno(90));
    expect(r.noturnoComputadoMin).toBe(103);
    expect(r.conferir.some((c) => c.texto.includes('noturno'))).toBe(true);
  });
  it('22h às 6h com virada: 8h reais, prorrogação após as 5h, 9h08 computadas e 1h08 de extra', () => {
    const d = dia(1, '22:00', undefined, undefined, '06:00');
    const iv = intervalosDoDia(d)!;
    expect(iv.virou).toBe(true);
    const n = minutosNoturnos(iv.intervalos, iv.virou);
    expect(n.real).toBe(480);
    expect(n.prorrogacao).toBe(60);
    const r = resumirFolha(folha([d]), OP);
    expect(r.impedimentos).toHaveLength(0); // virada plausível não é "fora de ordem"
    expect(r.noturnoComputadoMin).toBe(549);
    expect(r.extrasUtilPagarMin).toBe(69);
    expect(r.extrasEmDiaNoturnoMin).toBe(69);
    expect(r.conferir.some((c) => c.texto.includes('Virada da meia-noite'))).toBe(true);
  });
  it('entrada de madrugada (04h) em jornada diurna: só a faixa até as 5h, sem prorrogação', () => {
    const iv = intervalosDoDia(dia(1, '04:00', '12:00'))!;
    const n = minutosNoturnos(iv.intervalos, iv.virou);
    expect(n.real).toBe(60);
    expect(n.prorrogacao).toBe(0);
  });
  it('inversão que não é virada da noite continua inválida', () => {
    expect(intervalosDoDia(dia(1, '14:00', '09:00'))).toBeNull();
  });
});

describe('mês, assinatura, CSV e ligação com o cadastro', () => {
  it('resumirMes agrega impedimentos e avisa de feriados não cadastrados', () => {
    const m = resumirMes([folha([dia(1, '08:00')]), { funcionario: 'BIA', dias: [normal(1)] }], OP);
    expect(m.comImpedimento).toBe(1);
    expect(m.avisos[0]).toContain('Nenhum feriado');
    expect(m.percentuais).toEqual({ extraUtil: 50, extraDomFeriado: 100, adicionalNoturno: 20 });
  });
  it('percentuais editáveis só mudam os rótulos', () => {
    const m = resumirMes([folha([dia(1, '08:00', '12:00', '13:00', '18:30')])], { ...OP, percentuais: { extraUtil: 60 } });
    expect(m.funcionarios[0].extrasUtilPagarMin).toBe(90);
    expect(resumoParaCsv(m)).toContain('Extras 60% (pagar)');
  });
  it('a assinatura muda quando a folha muda', () => {
    const a = textoAssinatura(resumirMes([folha([normal(1)])], OP));
    const b = textoAssinatura(resumirMes([folha([normal(1), normal(2)])], OP));
    expect(a).not.toBe(b);
  });
  it('CSV: BOM, ponto e vírgula e horas em h:mm', () => {
    const csv = resumoParaCsv(resumirMes([folha([dia(1, '08:00', '12:00', '13:00', '18:30')])], OP));
    expect(csv.startsWith('﻿Funcionário;')).toBe(true);
    const linha = csv.trim().split('\r\n')[1].split(';');
    expect(linha[0]).toBe('ANA');
    expect(linha[2]).toBe('9:30');
    expect(linha[4]).toBe('1:30');
  });
  it('regrasDoEmpregado: jornada do cadastro, sem banco por padrão; banco marcado na tela', () => {
    const emp = { utilMin: 480, sabadoMin: 240, trabalhaSabado: false };
    expect(regrasDoEmpregado({ nome: 'ANA', jornadaUtilMin: 360 }, emp, 'ANA').jornada.utilMin).toBe(360);
    expect(regrasDoEmpregado(undefined, emp, 'ANA').temBanco).toBe(false);
    expect(regrasDoEmpregado(undefined, emp, 'ANA', new Set(['ANA'])).temBanco).toBe(true);
  });
  it('100 funcionários × 30 dias em poucos ms', () => {
    const folhas = Array.from({ length: 100 }, (_, i) => ({ funcionario: `F${i}`, dias: Array.from({ length: 30 }, (_, k) => normal(k + 1)) }));
    const t0 = performance.now();
    resumirMes(folhas, OP);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('regrasDoEmpregado com o cadastro do DP', () => {
  const empresa = { utilMin: 480, sabadoMin: 240, trabalhaSabado: false };
  it('acordo de banco do cadastro liga o banco mesmo sem a marcação da tela', () => {
    expect(regrasDoEmpregado(undefined, empresa, 'ANA', undefined, true).temBanco).toBe(true);
  });
  it('sem acordo no cadastro, vale a marcação da tela', () => {
    expect(regrasDoEmpregado(undefined, empresa, 'ANA', new Set(['ANA']), false).temBanco).toBe(true);
    expect(regrasDoEmpregado(undefined, empresa, 'ANA', new Set(), false).temBanco).toBe(false);
  });
});
