import { describe, it, expect } from 'vitest';
import {
  alertasFerias, avisoAte, conjuntoFeriados, diasDeDireito, diasDepoisDe, feriadosLegais, inicioVedado,
  mesesDoPeriodo, pagamentoAte, periodosAquisitivos, proximoInicioPermitido, proximoMarco, situacaoDoPeriodo,
  situacaoFerias, somarAnos, validarProgramacao, type ContextoFerias, type FeriasProgramada,
} from '@/lib/ferias';
import type { Empregado } from '@/lib/dp';

const emp = (extra: Partial<Empregado> = {}): Empregado => ({
  id: 'e1', escritorioId: 'x', empresaId: 'emp', nome: 'MARIA', cpf: null, cargo: null, admissao: '2025-03-10',
  salarioBase: null, horasSemanais: 44, escala: '5x2', dsr: 0, bancoHoras: false, bancoHorasDesde: null,
  situacao: 'ativo', situacaoDesde: null, afastamentoTipo: null, aquisitivoBase: null, origem: 'manual',
  atualizadoEm: null, atualizadoPor: null, ...extra,
});

const prog = (extra: Partial<FeriasProgramada>): FeriasProgramada => ({
  id: 'f', empregadoId: 'e1', empresaId: 'emp', aquisitivoInicio: '2025-03-10', inicio: '2026-06-01', dias: 30,
  abonoDias: 0, avisoEm: null, pagamentoEm: null, ...extra,
});

describe('períodos aquisitivo e concessivo', () => {
  it('12 meses a partir da admissão; concessivo nos 12 seguintes', () => {
    const [p1, p2] = periodosAquisitivos('2025-03-10', '2026-11-21');
    expect(p1).toEqual({ numero: 1, inicio: '2025-03-10', fim: '2026-03-09', concessivoFim: '2027-03-09' });
    expect(p2).toEqual({ numero: 2, inicio: '2026-03-10', fim: '2027-03-09', concessivoFim: '2028-03-09' });
    expect(periodosAquisitivos('2025-03-10', '2026-11-21')).toHaveLength(2);
  });
  it('29/02 vira 01/03 em ano não bissexto', () => {
    expect(somarAnos('2024-02-29', 1)).toBe('2025-03-01');
    expect(periodosAquisitivos('2024-02-29', '2024-03-01')[0].fim).toBe('2025-02-28');
  });
  it('data inválida não gera períodos', () => {
    expect(periodosAquisitivos('', '2026-01-01')).toEqual([]);
  });
  it('meses que o período toca', () => {
    expect(mesesDoPeriodo({ inicio: '2025-03-10', fim: '2026-03-09' })).toHaveLength(13);
  });
});

describe('art. 130 — dias pelo número de faltas', () => {
  it.each([[0, 30], [5, 30], [6, 24], [14, 24], [15, 18], [23, 18], [24, 12], [32, 12], [33, 0]])('%i faltas → %i dias', (f, d) => {
    expect(diasDeDireito(f)).toBe(d);
  });
  it('só conta falta dentro do aquisitivo', () => {
    const p = periodosAquisitivos('2025-03-10', '2026-01-01')[0];
    const faltas = ['2025-03-09', ...Array.from({ length: 6 }, (_, i) => `2025-04-0${i + 1}`)];
    expect(situacaoDoPeriodo(p, faltas, [], '2026-11-21').direito).toBe(24);
  });
});

describe('situação do período', () => {
  const p = periodosAquisitivos('2025-03-10', '2026-11-21')[0];
  it('em aquisição antes de completar 12 meses', () => {
    expect(situacaoDoPeriodo(p, [], [], '2026-01-10').estado).toBe('aquisitivo');
  });
  it('aberto, vencendo (≤ 60 dias do limite de início) e vencido', () => {
    expect(situacaoDoPeriodo(p, [], [], '2026-11-21').estado).toBe('aberto');
    // limite de início para 30 dias: 09/03/2027 − 29 = 08/02/2027
    const s = situacaoDoPeriodo(p, [], [], '2026-12-15');
    expect(s.limiteInicio).toBe('2027-02-08');
    expect(s.estado).toBe('vencendo');
    expect(situacaoDoPeriodo(p, [], [], '2027-03-10').estado).toBe('vencido');
  });
  it('programado por inteiro = quitado; saldo próprio por período', () => {
    const s = situacaoDoPeriodo(p, [], [prog({})], '2026-11-21');
    expect(s.saldo).toBe(0);
    expect(s.estado).toBe('quitado');
    const p2 = periodosAquisitivos('2025-03-10', '2026-11-21')[1];
    expect(situacaoDoPeriodo(p2, [], [prog({})], '2026-11-21').saldo).toBe(30);
  });
  it('gozo que passa do concessivo conta dias em dobro', () => {
    expect(diasDepoisDe({ inicio: '2027-03-01', dias: 15 }, '2027-03-09')).toBe(6);
    expect(diasDepoisDe({ inicio: '2027-03-20', dias: 10 }, '2027-03-09')).toBe(10);
    const s = situacaoDoPeriodo(p, [], [prog({ inicio: '2027-03-01', dias: 30 })], '2026-11-21');
    expect(s.diasEmDobro).toBe(21);
  });
  it('perdido com mais de 32 faltas', () => {
    const faltas = Array.from({ length: 33 }, (_, i) => `2025-0${4 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, '0')}`);
    expect(situacaoDoPeriodo(p, faltas, [], '2026-11-21').estado).toBe('perdido');
  });
  it('desligado: períodos só até o desligamento; sem admissão: nada', () => {
    expect(situacaoFerias(emp({ situacao: 'desligado', situacaoDesde: '2026-01-01' }), [], [], '2026-11-21')).toHaveLength(1);
    expect(situacaoFerias(emp({ admissao: null }), [], [], '2026-11-21')).toEqual([]);
  });
  it('início do aquisitivo editado (art. 133 §2º) muda os períodos', () => {
    const s = situacaoFerias(emp({ aquisitivoBase: '2026-02-01' }), [], [], '2026-11-21');
    expect(s).toHaveLength(1);
    expect(s[0].periodo.inicio).toBe('2026-02-01');
  });
});

describe('feriados e início vedado (art. 134 §3º)', () => {
  it('feriados legais: inclui 20/11 e Sexta-feira Santa; não inclui Carnaval nem Corpus Christi', () => {
    const f = feriadosLegais(2026);
    expect(f).toContain('2026-11-20');
    expect(f).toContain('2026-04-03'); // Sexta-feira Santa
    expect(f).not.toContain('2026-02-16'); // Carnaval
    expect(f).not.toContain('2026-06-04'); // Corpus Christi
  });
  it('não começa sexta nem sábado quando o DSR é domingo', () => {
    const fer = conjuntoFeriados([2026]);
    expect(inicioVedado('2026-11-27', 0, fer)).toMatch(/domingo/); // sexta
    expect(inicioVedado('2026-11-28', 0, fer)).toMatch(/domingo/); // sábado
    expect(inicioVedado('2026-11-30', 0, fer)).toBeNull(); // segunda
  });
  it('nem nos 2 dias antes de feriado (inclui os do escritório)', () => {
    const fer = conjuntoFeriados([2026], ['2026-08-15']);
    expect(inicioVedado('2026-11-18', 0, fer)).toMatch(/20\/11\/2026/);
    expect(inicioVedado('2026-08-13', 0, fer)).toMatch(/15\/08\/2026/);
  });
  it('DSR em outro dia', () => {
    expect(inicioVedado('2026-11-24', 4, new Set())).toMatch(/quinta/); // terça, DSR quinta
    expect(inicioVedado('2026-11-27', 4, new Set())).toBeNull(); // sexta
  });
  it('próximo início permitido', () => {
    expect(proximoInicioPermitido('2026-11-27', 0, conjuntoFeriados([2026]))).toBe('2026-11-30');
  });
});

describe('prazos de aviso e pagamento', () => {
  it('aviso 30 dias antes; pagamento 2 dias antes, recuando para dia útil', () => {
    expect(avisoAte('2026-12-01')).toBe('2026-11-01');
    expect(pagamentoAte('2026-12-02')).toBe('2026-11-30'); // segunda
    expect(pagamentoAte('2026-11-30')).toBe('2026-11-27'); // 28 é sábado → sexta
    expect(pagamentoAte('2026-11-23', conjuntoFeriados([2026]))).toBe('2026-11-19'); // 21 sáb, 20 feriado
  });
  it('próximo marco de uma programação', () => {
    const f = { inicio: '2027-01-11', avisoEm: null, pagamentoEm: null };
    expect(proximoMarco(f, '2026-11-21')).toEqual({ marco: 'aviso', data: '2026-12-12' });
    expect(proximoMarco(f, '2026-12-20')).toEqual({ marco: 'pagamento', data: '2027-01-08' });
    expect(proximoMarco(f, '2027-01-10')).toEqual({ marco: 'inicio', data: '2027-01-11' });
    expect(proximoMarco(f, '2027-01-12')).toBeNull();
    expect(proximoMarco({ ...f, avisoEm: '2026-11-20' }, '2026-11-21')?.marco).toBe('pagamento');
  });
});

describe('validar a programação', () => {
  const e = emp();
  const p1 = periodosAquisitivos('2025-03-10', '2026-11-21')[0];
  const ctx = (programadas: FeriasProgramada[] = [], faltas: string[] = [], extra: Partial<ContextoFerias> = {}): ContextoFerias => ({
    empregado: e, periodo: situacaoDoPeriodo(p1, faltas, programadas, '2026-11-21'), todas: programadas,
    feriados: conjuntoFeriados([2026, 2027]), hoje: '2026-11-21', ...extra,
  });
  const pedido = (inicio: string, dias: number, abonoDias = 0) => ({ aquisitivoInicio: p1.inicio, inicio, dias, abonoDias });

  it('30 dias numa segunda, com antecedência: ok, sem aviso de prazo', () => {
    const r = validarProgramacao(pedido('2027-01-04', 30), ctx());
    expect(r.erros).toEqual([]);
    expect(r.fim).toBe('2027-02-02');
    expect(r.retorno).toBe('2027-02-03');
    expect(r.pagamentoAte).toBe('2026-12-31');
    expect(r.avisos.join(' ')).not.toMatch(/30 dias de antecedência/);
  });
  it('menos de 30 dias de antecedência só avisa', () => {
    const r = validarProgramacao(pedido('2026-12-07', 30), ctx());
    expect(r.erros).toEqual([]);
    expect(r.avisos.join(' ')).toMatch(/art. 135/);
  });
  it('mínimo de 5 dias; máximo 3 períodos; um com 14+', () => {
    expect(validarProgramacao(pedido('2027-01-04', 4), ctx()).erros.join(' ')).toMatch(/mínimo 5/);
    // 10 + sobra 20 (ainda cabe um de 14): ok
    expect(validarProgramacao(pedido('2027-01-04', 10), ctx()).erros).toEqual([]);
    // 10 + 10 já programados → sobrariam 10, sem período de 14: erro
    const r = validarProgramacao(pedido('2027-02-01', 10), ctx([prog({ id: 'a', inicio: '2027-01-04', dias: 10 })]));
    expect(r.erros.join(' ')).toMatch(/14 dias ou mais/);
    // 14 + 5 + 5 + sobra 6: sem vaga para o 4º
    const tres = [prog({ id: 'a', inicio: '2027-01-04', dias: 14 }), prog({ id: 'b', inicio: '2027-02-01', dias: 5 })];
    expect(validarProgramacao(pedido('2027-02-15', 5), ctx(tres)).erros.join(' ')).toMatch(/máximo de 3/);
  });
  it('sobrar menos de 5 dias é erro', () => {
    expect(validarProgramacao(pedido('2027-01-04', 27), ctx()).erros.join(' ')).toMatch(/Sobrariam 3/);
  });
  it('passa do direito; abono até 1/3', () => {
    expect(validarProgramacao(pedido('2027-01-04', 31), ctx()).erros.join(' ')).toMatch(/Passa do direito/);
    expect(validarProgramacao(pedido('2027-01-04', 19, 11), ctx()).erros.join(' ')).toMatch(/1\/3/);
    const ok = validarProgramacao(pedido('2027-01-04', 20, 10), ctx());
    expect(ok.erros).toEqual([]);
    expect(ok.avisos.join(' ')).toMatch(/art. 143/);
  });
  it('direito < 14 por faltas: período único', () => {
    const faltas = Array.from({ length: 25 }, (_, i) => `2025-05-${String(i + 1).padStart(2, '0')}`);
    expect(validarProgramacao(pedido('2027-01-04', 6), ctx([], faltas)).erros.join(' ')).toMatch(/não podem ser fracionadas/);
    expect(validarProgramacao(pedido('2027-01-04', 12), ctx([], faltas)).erros).toEqual([]);
  });
  it('início vedado bloqueia; sobreposição bloqueia', () => {
    expect(validarProgramacao(pedido('2027-01-08', 30), ctx()).erros.join(' ')).toMatch(/134 §3º/); // sexta
    expect(validarProgramacao(pedido('2027-01-10', 30), ctx()).erros.join(' ')).toMatch(/repouso semanal/); // domingo
    const r = validarProgramacao(pedido('2027-01-11', 10), ctx([prog({ id: 'a', inicio: '2027-01-04', dias: 14 })]));
    expect(r.erros.join(' ')).toMatch(/Sobrepõe/);
  });
  it('afastado ou desligado não programa', () => {
    expect(validarProgramacao(pedido('2027-01-04', 30), ctx([], [], { empregado: emp({ situacao: 'afastado', situacaoDesde: '2026-10-01' }) })).erros.join(' ')).toMatch(/afastado/);
    expect(validarProgramacao(pedido('2027-01-04', 30), ctx([], [], { empregado: emp({ situacao: 'desligado', situacaoDesde: '2026-10-01' }) })).erros.join(' ')).toMatch(/rescisão/);
  });
  it('depois do concessivo: avisa o dobro', () => {
    const r = validarProgramacao(pedido('2027-03-01', 30), ctx());
    expect(r.erros).toEqual([]);
    expect(r.avisos.join(' ')).toMatch(/21 dia\(s\).*dobro/);
  });
  it('antes de completar o aquisitivo: avisa', () => {
    const p2 = periodosAquisitivos('2025-03-10', '2026-11-21')[1];
    const r = validarProgramacao({ aquisitivoInicio: p2.inicio, inicio: '2027-01-04', dias: 30, abonoDias: 0 },
      { ...ctx(), periodo: situacaoDoPeriodo(p2, [], [], '2026-11-21') });
    expect(r.erros).toEqual([]);
    expect(r.avisos.join(' ')).toMatch(/antes de completar/);
  });
});

describe('alertas', () => {
  it('vencidas (perigo) antes de vencendo (aviso)', () => {
    const e = emp({ admissao: '2024-01-15' });
    const per = situacaoFerias(e, [], [], '2026-12-20');
    const a = alertasFerias(e, per, '2026-12-20');
    expect(a[0].rotulo).toBe('Férias vencidas');
    expect(a[0].nivel).toBe('perigo');
    expect(a.some((x) => x.rotulo === 'Férias vencendo')).toBe(true);
  });
  it('desligado não alerta; sem admissão pede cadastro', () => {
    expect(alertasFerias(emp({ situacao: 'desligado', situacaoDesde: '2026-01-01' }), [], '2026-11-21')).toEqual([]);
    expect(alertasFerias(emp({ admissao: null }), [], '2026-11-21')[0].rotulo).toBe('Sem admissão');
  });
  it('afastado por doença há mais de 6 meses: suspende', () => {
    const e = emp({ admissao: '2024-01-15', situacao: 'afastado', situacaoDesde: '2026-01-02', afastamentoTipo: 'doenca' });
    const a = alertasFerias(e, situacaoFerias(e, [], [], '2026-11-21'), '2026-11-21');
    expect(a).toHaveLength(1);
    expect(a[0].rotulo).toBe('Aquisitivo suspenso');
  });
});
