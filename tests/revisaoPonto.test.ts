// Revisão inteligente da Folha de Ponto (lib/revisaoPonto.ts) — regras puras.
import { describe, it, expect } from 'vitest';
import type { DiaFreq } from '@/lib/tipos';
import {
  analisarDia, limiteDoDia, revisarFolha, revisarMes, achadosPorDia, semFeriadosNoAno, FolhaRevisao,
} from '@/lib/revisaoPonto';

// Novembro/2026: dia 1 = domingo, 2 = segunda, 7 = sábado, 15 = domingo.
const d = (dia: number, e: string | null, sa: string | null, ra: string | null, st: string | null, marcador: DiaFreq['marcador'] = null): DiaFreq =>
  ({ dia, entradaManha: e, saidaAlmoco: sa, retornoAlmoco: ra, saidaTarde: st, marcador });
const normal = (dia: number) => d(dia, '08:00', '12:00', '13:00', '17:00');
const OP = { ano: 2026, mes: 11, feriados: new Set<string>(['2026-11-20']) };
const rev = (dias: DiaFreq[], extra: Partial<FolhaRevisao> = {}) => revisarFolha({ funcionario: 'Fulana', dias, ...extra }, OP);
const codigos = (r: ReturnType<typeof rev>, dia: number | null) => r.achados.filter((a) => a.dia === dia).map((a) => a.codigo);
/** Semana útil normal de 2 a 6/11. */
const semana = [2, 3, 4, 5, 6].map(normal);

describe('analisarDia', () => {
  it('4 marcações: trabalhado e intervalo', () => {
    expect(analisarDia(normal(2))).toMatchObject({ trabalhado: 480, intervalo: 60, desencontrada: false });
  });
  it('só entrada e saída: corrido, intervalo não marcado', () => {
    expect(analisarDia(d(2, '08:00', null, null, '17:00'))).toMatchObject({ trabalhado: 540, intervalo: null, semIntervaloMarcado: true });
  });
  it('"12>54", 25:00 e 8:75 são inválidos', () => {
    const a = analisarDia(d(2, '25:00', '8:75', '12>54', '17:00'));
    expect(a.invalidos.map((i) => i.valor)).toEqual(['25:00', '8:75', '12>54']);
    expect(a.trabalhado).toBeNull();
  });
  it('3 marcações ou pares trocados são desencontrados', () => {
    expect(analisarDia(d(2, '08:00', '12:00', '13:00', null)).desencontrada).toBe(true);
    expect(analisarDia(d(2, null, '12:00', '13:00', null)).desencontrada).toBe(true);
  });
});

describe('limite diário', () => {
  it('8h → 10h; 8h48 → teto de 10h; sábado de 4h → 6h', () => {
    const j = { utilMin: 480, sabadoMin: 240, trabalhaSabado: true };
    expect(limiteDoDia('util', j)).toBe(600);
    expect(limiteDoDia('util', { ...j, utilMin: 528 })).toBe(600);
    expect(limiteDoDia('sabado', j)).toBe(360);
  });
});

describe('revisarFolha', () => {
  it('mês normal não gera achado', () => {
    const r = rev(semana);
    expect(r.achados).toEqual([]);
    expect(r.risco).toBe(0);
  });

  it('horário ilegível é alto e cita o valor', () => {
    const r = rev([...semana, d(9, '08:00', '11:54', '12>54', '16:26')]);
    const a = r.achados.find((x) => x.codigo === 'horario_invalido')!;
    expect(a).toMatchObject({ nivel: 'alto', dia: 9 });
    expect(a.motivo).toContain('"12>54" no retorno do almoço');
  });

  it('saída antes da entrada é alto e sugere a virada da meia-noite', () => {
    const r = rev([d(2, '22:00', null, null, '06:00')]);
    const a = r.achados.find((x) => x.codigo === 'fora_de_ordem')!;
    expect(a.nivel).toBe('alto');
    expect(a.motivo).toMatch(/meia-noite/);
  });

  it('marcações ímpares são alto', () => {
    expect(codigos(rev([d(2, '08:00', '12:00', '13:00', null)]), 2)).toContain('marcacao_impar');
  });

  it('jornada acima de contratual + 2h (com 10 min de tolerância)', () => {
    expect(codigos(rev([d(2, '06:00', '12:00', '13:00', '17:10')]), 2)).not.toContain('jornada_acima'); // 10h10
    const r = rev([d(2, '06:00', '12:00', '13:00', '17:11')]); // 10h11
    expect(codigos(r, 2)).toContain('jornada_acima');
    expect(r.achados[0].motivo).toMatch(/CLT art\. 59/);
  });

  it('intervalo zerado em jornada > 6h é alto; curto é médio; 55 min passa', () => {
    expect(rev([d(2, '08:00', '13:01', '13:01', '15:06')]).achados[0]).toMatchObject({ codigo: 'sem_intervalo', nivel: 'alto' });
    expect(rev([d(2, '08:00', '12:30', '13:00', '17:30')]).achados[0]).toMatchObject({ codigo: 'intervalo_curto', nivel: 'medio' });
    expect(rev([d(2, '08:00', '12:00', '12:55', '17:00')]).achados).toEqual([]);
  });

  it('entre 4h e 6h exige 15 min', () => {
    expect(codigos(rev([d(2, '08:00', '10:30', '10:40', '13:20')]), 2)).toContain('intervalo_curto');
    expect(codigos(rev([d(2, '08:00', '10:30', '10:45', '13:20')]), 2)).toEqual([]);
  });

  it('intervalo > 2h e intervalo não marcado são um achado do mês, baixo', () => {
    const r = rev([d(2, '08:00', '11:00', '13:30', '17:00'), d(3, '08:00', '11:00', '13:30', '17:00'), d(4, '08:00', null, null, '16:00')]);
    const mes = r.achados.filter((a) => a.dia === null);
    expect(mes.map((a) => a.codigo).sort()).toEqual(['intervalo_longo', 'intervalo_nao_marcado']);
    expect(mes.every((a) => a.nivel === 'baixo')).toBe(true);
    expect(mes.find((a) => a.codigo === 'intervalo_longo')!.motivo).toContain('02/11, 03/11');
  });

  it('interjornada < 11h é médio, inclusive na virada do mês', () => {
    const r = rev([d(2, '08:00', '12:00', '13:00', '23:00'), d(3, '08:00', '12:00', '13:00', '17:00')]);
    expect(codigos(r, 3)).toContain('interjornada');
    const virada = rev([d(1, null, null, null, null), d(2, '06:00', '10:00', '11:00', '14:00')], {
      anteriores: [d(30, '13:00', '17:00', '18:00', '22:00')], // 31/10 vazio: não é ontem
    });
    expect(codigos(virada, 2)).not.toContain('interjornada');
    const ontem = revisarFolha({ funcionario: 'F', dias: [d(1, '06:00', '10:00', '11:00', '14:00')], anteriores: [d(31, '13:00', '17:00', '18:00', '22:00')] }, OP);
    expect(codigos(ontem, 1)).toContain('interjornada');
  });

  it('7º dia seguido sem folga é alto, contando o mês anterior', () => {
    // 2 a 8/11 = 7 dias seguidos (sábado e domingo trabalhados).
    const r = rev([...semana, normal(7), normal(8)]);
    expect(codigos(r, 8)).toContain('setimo_dia');
    expect(codigos(r, 7)).not.toContain('setimo_dia');
    // 27 a 31/10 trabalhados + 1 e 2/11 → o 7º é o dia 2.
    const v = rev([normal(1), normal(2)], { anteriores: [27, 28, 29, 30, 31].map(normal) });
    expect(codigos(v, 2)).toContain('setimo_dia');
  });

  it('domingo trabalhado sem 7º dia: só "horário na folga" (baixo)', () => {
    const r = rev([normal(1)]);
    expect(r.achados.map((a) => [a.codigo, a.nivel])).toEqual([['folga_com_horario', 'baixo']]);
  });

  it('feriado (cadastrado ou marcador) com horário é médio', () => {
    expect(codigos(rev([normal(20)]), 20)).toEqual(['feriado_trabalhado']);
    expect(codigos(rev([d(10, '08:00', '12:00', '13:00', '17:00', 'FERIADO')]), 10)).toEqual(['feriado_trabalhado']);
  });

  it('FÉRIAS/ATESTADO/FALTA com horário é alto; FOLGA é médio; BANCO DE HORAS com meio dia passa', () => {
    expect(rev([d(2, '08:00', '12:00', '13:00', '17:00', 'FÉRIAS')]).achados[0]).toMatchObject({ codigo: 'marcador_com_horario', nivel: 'alto' });
    expect(rev([d(2, '08:00', '12:00', '13:00', '17:00', 'FOLGA')]).achados[0]).toMatchObject({ codigo: 'marcador_com_horario', nivel: 'medio' });
    expect(rev([d(2, '07:00', '11:58', null, null, 'BANCO DE HORAS')]).achados).toEqual([]);
  });

  it('dia útil em branco só entre o primeiro e o último dia lançados', () => {
    const r = rev([normal(2), normal(4)]);
    expect(codigos(r, 3)).toEqual(['dia_vazio']);
    expect(r.achados.filter((a) => a.codigo === 'dia_vazio')).toHaveLength(1); // admissão/desligamento no meio do mês não acusa
  });

  it('falta é baixo e conta no resumo', () => {
    const r = rev([normal(2), d(3, null, null, null, null, 'FALTA'), normal(4)]);
    expect(codigos(r, 3)).toEqual(['falta']);
    expect(r.faltas).toBe(1);
  });

  it('atestado: o 16º dia corrido é alto (fim de semana sem dado não quebra a sequência)', () => {
    const uteis = [2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 16, 17].map((n) => d(n, null, null, null, null, 'ATESTADO'));
    const r = rev(uteis);
    const a = r.achados.filter((x) => x.codigo === 'atestado_inss');
    expect(a).toHaveLength(1);
    expect(a[0].dia).toBe(17); // 2 → 17 = 16 dias corridos
    expect(rev(uteis.slice(0, 10)).achados.filter((x) => x.codigo === 'atestado_inss')).toHaveLength(0);
  });

  it('trabalho noturno: um achado médio no mês', () => {
    const r = rev([d(2, '14:00', '18:00', '19:00', '22:30'), d(3, '14:00', '18:00', '19:00', '22:30')]);
    const n = r.achados.filter((a) => a.codigo === 'noturno');
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ nivel: 'medio', dia: null });
  });

  it('ponto britânico: entrada e saída iguais em ≥ 80% de ≥ 10 dias; almoço igual não importa', () => {
    const uteis = [2, 3, 4, 5, 6, 9, 10, 11, 12, 13];
    const r = rev(uteis.map(normal));
    expect(r.achados.map((a) => a.codigo)).toEqual(['ponto_britanico']);
    expect(r.achados[0].motivo).toContain('10 de 10 dias');
    // saída variando com almoço fixo (12:00–13:00): não é britânico
    const vari = rev(uteis.map((n, i) => d(n, '08:00', '12:00', '13:00', `17:0${i % 10}`)));
    expect(vari.achados).toEqual([]);
    // 9 dias: abaixo do mínimo
    expect(rev(uteis.slice(0, 9).map(normal)).achados).toEqual([]);
  });

  it('leitura incerta: baixo; médio quando o dia já tem outro achado', () => {
    const r = rev([normal(2), d(3, '08:00', '12:30', '13:00', '17:30')], {
      incertos: [{ dia: 2, campo: 'saidaTarde' }, { dia: 3, campo: 'retornoAlmoco' }],
    });
    expect(r.achados.find((a) => a.dia === 2)).toMatchObject({ codigo: 'leitura_incerta', nivel: 'baixo' });
    expect(r.achados.find((a) => a.dia === 3 && a.codigo === 'leitura_incerta')!.nivel).toBe('medio');
    expect(r.achados.find((a) => a.dia === 2)!.motivo).toContain('a saída');
  });

  it('informativo: horas além da jornada contratual não viram alerta', () => {
    const r = rev([d(2, '08:00', '12:00', '13:00', '18:00'), d(3, '08:00', '12:00', '13:00', '17:05')]);
    expect(r.achados).toEqual([]);
    expect(r).toMatchObject({ alemDaJornadaMin: 60, diasAlemDaJornada: 1 });
  });

  it('ordena do mais grave e soma o risco (alto 5, médio 2, baixo 1)', () => {
    const r = rev([normal(1), normal(2), d(3, '08:00', '12:30', '13:00', '17:30'), d(4, '08:00', '12:00', '12>00', '17:00')]);
    expect(r.achados.map((a) => a.nivel)).toEqual(['alto', 'medio', 'baixo']);
    expect(r.risco).toBe(8);
    expect(r.diasAtencao).toBe(3);
    expect([...achadosPorDia(r).keys()]).toEqual([4, 3, 1]);
  });
});

describe('revisarMes', () => {
  it('ordena funcionários por risco, conta por tipo e avisa sem feriados no ano', () => {
    const op = { ano: 2026, mes: 11, feriados: new Set<string>() };
    const r = revisarMes([
      { funcionario: 'Tranquila', dias: semana },
      { funcionario: 'Atenção', dias: [d(2, '08:00', '13:01', '13:01', '15:06'), normal(3)] },
    ], op);
    expect(r.funcionarios.map((f) => f.funcionario)).toEqual(['Atenção', 'Tranquila']);
    expect(r.resumo).toMatchObject({ alto: 1, diasAtencao: 1, funcionariosAtencao: 1 });
    expect(r.porCodigo).toMatchObject({ sem_intervalo: 1, sem_feriados: 1 });
    expect(r.gerais[0].codigo).toBe('sem_feriados');
    expect(revisarMes([], op).gerais).toEqual([]);
  });

  it('semFeriadosNoAno olha só o ano revisado', () => {
    expect(semFeriadosNoAno(new Set(['2025-12-25']), 2026)).toBe(true);
    expect(semFeriadosNoAno(new Set(['2026-12-25']), 2026)).toBe(false);
  });

  it('100 funcionários × mês inteiro revisam rápido', () => {
    const folhas = Array.from({ length: 100 }, (_, i) => ({
      funcionario: `F${i}`,
      dias: Array.from({ length: 30 }, (_, k) => d(k + 1, '08:00', '12:00', '13:00', `17:${String(k % 60).padStart(2, '0')}`)),
    }));
    const t0 = performance.now();
    revisarMes(folhas, OP);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
