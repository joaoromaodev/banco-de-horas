import { describe, it, expect } from 'vitest';
import {
  lerCelula, lerDataLote, lerPlanilha, planejarDesfazer, planejarLinha, previaPlanilha, resumoPlanos,
  type EmpregadoDoLote,
} from '@/lib/dpLote';
import { lerCsv } from '@/lib/dpLoteArquivo';
import type { DadosEmpregado } from '@/lib/dp';

const base: DadosEmpregado = {
  nome: 'MARIA', cpf: null, cargo: null, admissao: null, salarioBase: null, horasSemanais: null, escala: null, dsr: 0,
  bancoHoras: false, bancoHorasDesde: null, situacao: 'ativo', situacaoDesde: null, afastamentoTipo: null, aquisitivoBase: null,
};
const emp = (id: string, nome: string, extra: Partial<DadosEmpregado> = {}): EmpregadoDoLote => ({ ...base, ...extra, id, nome });

describe('células do lote', () => {
  it('datas em dd/mm/aaaa e ISO; inválidas não passam', () => {
    expect(lerDataLote('10/03/2025')).toBe('2025-03-10');
    expect(lerDataLote('1/3/2025')).toBe('2025-03-01');
    expect(lerDataLote('01062026')).toBe('2026-06-01'); // sem as barras
    expect(lerDataLote('31022026')).toBeNull();
    expect(lerDataLote('2025-03-10')).toBe('2025-03-10');
    expect(lerDataLote('31/02/2025')).toBeNull();
    expect(lerDataLote('10/03/25')).toBeNull();
    expect(lerDataLote('1900-01-01')).toBeNull();
  });
  it('vazio = não mexer; inválido devolve mensagem', () => {
    expect(lerCelula('cargo', '   ')).toEqual({ vazio: true });
    expect(lerCelula('salarioBase', 'abc')).toMatchObject({ ok: false });
    expect(lerCelula('salarioBase', '-5')).toMatchObject({ ok: false });
    expect(lerCelula('salarioBase', '1.518,00')).toMatchObject({ ok: true, valor: 1518 });
    expect(lerCelula('horasSemanais', '0')).toMatchObject({ ok: false });
    expect(lerCelula('horasSemanais', '71')).toMatchObject({ ok: false });
    expect(lerCelula('horasSemanais', '44,5')).toMatchObject({ ok: true, valor: 44.5 });
    expect(lerCelula('escala', '5X2')).toMatchObject({ ok: true, valor: '5x2' });
    expect(lerCelula('escala', 'Outra')).toMatchObject({ ok: true, valor: 'outra' });
    expect(lerCelula('escala', '7x7')).toMatchObject({ ok: false });
    expect(lerCelula('bancoHoras', 'Não')).toMatchObject({ ok: true, valor: false });
    expect(lerCelula('bancoHoras', 'talvez')).toMatchObject({ ok: false });
  });
});

describe('plano de uma linha', () => {
  it('preenche o que está vazio e ignora o que já é igual', () => {
    const p = planejarLinha({ ...base, cargo: 'Caixa' }, { admissao: '10/03/2025', cargo: 'Caixa', salarioBase: '1.518,00' });
    expect(p.status).toBe('muda');
    expect(Object.keys(p.mudancas).sort()).toEqual(['admissao', 'salarioBase']);
    expect(p.mudancas.admissao).toEqual({ antes: null, depois: '2025-03-10' });
  });
  it('célula vazia nunca apaga', () => {
    const p = planejarLinha({ ...base, cargo: 'Caixa', admissao: '2025-01-01' }, { cargo: '', admissao: '' });
    expect(p.status).toBe('igual');
    expect(p.mudancas).toEqual({});
  });
  it('atualiza valor existente (antes e depois)', () => {
    const p = planejarLinha({ ...base, salarioBase: 1500 }, { salarioBase: '1.620,00' });
    expect(p.mudancas.salarioBase).toEqual({ antes: 1500, depois: 1620 });
  });
  it('erro por célula bloqueia a linha', () => {
    const p = planejarLinha(base, { admissao: '32/13/2025', horasSemanais: '99' });
    expect(p.status).toBe('erro');
    expect(p.erros.admissao).toBeTruthy();
    expect(p.erros.horasSemanais).toBeTruthy();
  });
  it('a regra da ficha vale: admissão depois do desligamento', () => {
    const p = planejarLinha({ ...base, situacao: 'afastado', situacaoDesde: '2025-02-01', afastamentoTipo: 'outro' }, { admissao: '10/03/2025' });
    expect(p.status).toBe('erro');
    expect(p.erroLinha).toMatch(/antes da admissão/);
  });
  it('banco desde exige banco = Sim', () => {
    expect(planejarLinha(base, { bancoHorasDesde: '01/02/2025' }).erros.bancoHorasDesde).toBeTruthy();
    const ok = planejarLinha(base, { bancoHoras: 'Sim', bancoHorasDesde: '01/02/2025' });
    expect(ok.status).toBe('muda');
    expect(ok.mudancas.bancoHorasDesde?.depois).toBe('2025-02-01');
  });
  it('avisos não bloqueiam', () => {
    const p = planejarLinha(base, { horasSemanais: '48', bancoHoras: 'Sim', admissao: '01/01/2030' }, '2026-11-21');
    expect(p.status).toBe('muda');
    expect(p.avisos.length).toBe(3);
  });
});

describe('planilha', () => {
  it('acha o cabeçalho, aceita variações e ignora colunas desconhecidas (CPF não é lido)', () => {
    const r = lerPlanilha([
      ['Relatório'], [],
      ['NOME', 'CPF', 'Data de admissao', 'Salário', 'Banco de horas'],
      ['Maria  Silva', '529.982.247-25', '10/03/2025', '1.518,00', ''],
      ['', '', '', '', ''],
      ['João', '', '', '', 'Sim'],
    ]);
    expect(r.erro).toBeNull();
    expect(r.ignoradas).toEqual(['CPF']);
    expect(r.linhas).toEqual([
      { linha: 4, nome: 'Maria Silva', entrada: { admissao: '10/03/2025', salarioBase: '1.518,00' } },
      { linha: 6, nome: 'João', entrada: { bancoHoras: 'Sim' } },
    ]);
  });
  it('sem coluna Nome ou sem coluna útil: erro claro', () => {
    expect(lerPlanilha([['A', 'B'], ['1', '2']]).erro).toMatch(/Nome/);
    expect(lerPlanilha([['Nome', 'CPF'], ['X', '1']]).erro).toMatch(/nenhuma coluna/);
  });
  it('prévia casa por nome (sem caixa/acento de espaço), não cadastra e acusa repetido e homônimo', () => {
    const emps = [emp('1', 'MARIA SILVA'), emp('2', 'JOAO'), emp('3', 'PEDRO'), emp('4', 'PEDRO')];
    const linhas = lerPlanilha([
      ['Nome', 'Admissão'],
      ['maria  silva', '10/03/2025'],
      ['Maria Silva', '11/03/2025'],
      ['Ninguém', '10/03/2025'],
      ['Pedro', '10/03/2025'],
      ['JOAO', '99/99/2025'],
    ]).linhas;
    const p = previaPlanilha(linhas, emps);
    expect(p[0].empregadoId).toBe('1');
    expect(p[0].plano?.status).toBe('muda');
    expect(p[1].problema).toMatch(/repetido/);
    expect(p[2].problema).toMatch(/não cadastra/);
    expect(p[3].problema).toMatch(/mais de um/);
    expect(p[4].plano?.status).toBe('erro');
    expect(resumoPlanos(p.map((l) => l.plano ?? { status: 'erro' as const }))).toEqual({ muda: 1, igual: 0, erro: 4 });
  });
  it('CSV com ; , aspas e BOM', () => {
    expect(lerCsv('﻿Nome;Cargo\r\n"Silva; Ana";"Aux ""A"""\r\nBia;Caixa')).toEqual([
      ['Nome', 'Cargo'], ['Silva; Ana', 'Aux "A"'], ['Bia', 'Caixa'],
    ]);
    expect(lerCsv('Nome,Cargo\nAna,Caixa')).toEqual([['Nome', 'Cargo'], ['Ana', 'Caixa']]);
  });
});

describe('desfazer', () => {
  it('volta só o que ainda está como foi gravado', () => {
    const atual = { ...base, admissao: '2025-03-10', salarioBase: 1700 };
    const r = planejarDesfazer(atual, {
      admissao: { antes: null, depois: '2025-03-10' },
      salarioBase: { antes: 1500, depois: 1620 }, // alguém mudou para 1700 depois
    });
    expect(r.restaurar).toEqual({ admissao: null });
    expect(r.ignorados).toEqual(['salarioBase']);
  });
});
