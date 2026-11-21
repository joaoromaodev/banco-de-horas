import { describe, it, expect } from 'vitest';
import {
  avisosEmpregado, cpfFormatado, cpfMascarado, cpfValido, jornadaDoEmpregado, lerDinheiro, nomeChave,
  temBancoDeHoras, validarEmpregado, vinculadoEm,
} from '@/lib/dp';
import { itensDoDp, itensNaJanela } from '@/lib/dpAgenda';
import type { Empregado } from '@/lib/dp';

const CPF_OK = '52998224725';

describe('cadastro do empregado', () => {
  it('CPF: dígitos verificadores, máscara e formato', () => {
    expect(cpfValido(CPF_OK)).toBe(true);
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('11111111111')).toBe(false);
    expect(cpfValido('52998224724')).toBe(false);
    expect(cpfMascarado(CPF_OK)).toBe('***.982.***-**');
    expect(cpfFormatado(CPF_OK)).toBe('529.982.247-25');
  });
  it('dinheiro no formato brasileiro', () => {
    expect(lerDinheiro('1.518,00')).toBe(1518);
    expect(lerDinheiro('R$ 2.000,55')).toBe(2000.55);
    expect(lerDinheiro('1518.5')).toBe(1518.5);
    expect(lerDinheiro('')).toBeNull();
    expect(Number.isNaN(lerDinheiro('abc'))).toBe(true);
  });
  it('valida e normaliza', () => {
    const r = validarEmpregado({ nome: '  maria  da silva ', cpf: '529.982.247-25', salarioBase: '1.518,00', horasSemanais: '44', dsr: 0, admissao: '2026-01-05' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dados).toMatchObject({ nome: 'maria da silva', cpf: CPF_OK, salarioBase: 1518, horasSemanais: 44, situacao: 'ativo' });
  });
  it('erros: nome, CPF, desligado sem data, afastado sem tipo', () => {
    const r = validarEmpregado({ nome: '', cpf: '123', situacao: 'desligado' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.join(' ')).toMatch(/nome.*CPF.*desligamento/);
    const a = validarEmpregado({ nome: 'X', situacao: 'afastado', situacaoDesde: '2026-01-01' });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.erros.join(' ')).toMatch(/tipo do afastamento/);
  });
  it('situação ativa limpa a data; banco de horas sem acordo limpa a data', () => {
    const r = validarEmpregado({ nome: 'X', situacao: 'ativo', situacaoDesde: '2026-01-01', bancoHoras: false, bancoHorasDesde: '2026-01-01' });
    expect(r.ok && r.dados.situacaoDesde).toBeNull();
    expect(r.ok && r.dados.bancoHorasDesde).toBeNull();
  });
  it('avisos', () => {
    expect(avisosEmpregado({ admissao: null, horasSemanais: 48, bancoHoras: true, bancoHorasDesde: null, situacao: 'ativo' })).toHaveLength(3);
  });
  it('nomeChave', () => {
    expect(nomeChave('  Maria   da Silva ')).toBe('MARIA DA SILVA');
  });
});

describe('para a frente B: jornada e banco de horas', () => {
  it('jornada diária do funcionário, depois da empresa, depois padrão', () => {
    expect(jornadaDoEmpregado(null, { jornadaUtilMin: 528 }, { jornadaUtilMin: 480, trabalhaSabado: false })).toMatchObject({ utilMin: 528, fonte: 'funcionario', horasSemanais: 44 });
    expect(jornadaDoEmpregado(null, null, { jornadaUtilMin: 480, jornadaSabadoMin: 240, trabalhaSabado: true })).toMatchObject({ utilMin: 480, fonte: 'empresa', horasSemanais: 44 });
    expect(jornadaDoEmpregado(null)).toMatchObject({ utilMin: 480, trabalhaSabado: false, fonte: 'padrao', horasSemanais: 40, dsr: 0 });
  });
  it('horas semanais e escala do DP prevalecem', () => {
    expect(jornadaDoEmpregado({ horasSemanais: 36, escala: '12x36', dsr: 3 })).toMatchObject({ horasSemanais: 36, escala: '12x36', dsr: 3 });
  });
  it('banco de horas vigente', () => {
    expect(temBancoDeHoras(null)).toBe(false);
    expect(temBancoDeHoras({ bancoHoras: false, bancoHorasDesde: null })).toBe(false);
    expect(temBancoDeHoras({ bancoHoras: true, bancoHorasDesde: null }, '2026-01-01')).toBe(true);
    expect(temBancoDeHoras({ bancoHoras: true, bancoHorasDesde: '2026-03-01' }, '2026-02-28')).toBe(false);
    expect(temBancoDeHoras({ bancoHoras: true, bancoHorasDesde: '2026-03-01' }, '2026-03-01')).toBe(true);
  });
  it('vinculado na data', () => {
    expect(vinculadoEm({ admissao: '2026-01-01', situacao: 'ativo', situacaoDesde: null }, '2025-12-31')).toBe(false);
    expect(vinculadoEm({ admissao: '2026-01-01', situacao: 'desligado', situacaoDesde: '2026-05-01' }, '2026-05-02')).toBe(false);
  });
});

const emp = (extra: Partial<Empregado>): Empregado => ({
  id: 'e1', escritorioId: 'x', empresaId: 'a', nome: 'MARIA', cpf: CPF_OK, cargo: null, admissao: '2024-01-15',
  salarioBase: 3000, horasSemanais: 44, escala: '5x2', dsr: 0, bancoHoras: false, bancoHorasDesde: null,
  situacao: 'ativo', situacaoDesde: null, afastamentoTipo: null, aquisitivoBase: null, origem: 'manual',
  atualizadoEm: null, atualizadoPor: null, ...extra,
});

describe('DP na agenda (derivado)', () => {
  const nomes = new Map([['a', 'Vaz'], ['b', 'Outra']]);
  it('férias vencidas, vencendo, programada e 13º por empresa', () => {
    const d = {
      empregados: [emp({}), emp({ id: 'e2', nome: 'JOÃO', empresaId: 'b', admissao: '2026-02-02' }), emp({ id: 'e3', nome: 'ZÉ', situacao: 'desligado', situacaoDesde: '2026-01-01' })],
      ferias: [{ id: 'f1', empregadoId: 'e2', empresaId: 'b', aquisitivoInicio: '2026-02-02', inicio: '2027-01-11', dias: 30, abonoDias: 0, avisoEm: null, pagamentoEm: null }],
      faltas: new Map<string, string[]>(),
    };
    const itens = itensDoDp(d, nomes, '2026-11-21');
    const tipos = itens.map((i) => i.tipo);
    expect(tipos).toContain('ferias_vencida'); // período 2024-01-15 venceu em 14/01/2026
    expect(tipos).toContain('ferias_programada');
    // 1ª (30/11) e 2ª (18/12) parcelas caem nos 30 dias; 2 empresas
    expect(itens.filter((i) => i.tipo === 'decimo').map((i) => i.vencimento).sort()).toEqual(['2026-11-30', '2026-11-30', '2026-12-18', '2026-12-18']);
    expect(itens.some((i) => i.obrigacao.includes('ZÉ'))).toBe(false);
    // nada de salário nem CPF no texto
    expect(itens.map((i) => i.obrigacao).join(' ')).not.toMatch(/3000|529/);
    const vencida = itens.find((i) => i.tipo === 'ferias_vencida')!;
    expect(vencida.dias).toBeLessThan(0);
  });
  it('13º some depois do prazo; janela filtra', () => {
    const d = { empregados: [emp({})], ferias: [], faltas: new Map<string, string[]>() };
    expect(itensDoDp(d, nomes, '2026-12-19').filter((i) => i.tipo === 'decimo')).toHaveLength(0);
    expect(itensDoDp(d, nomes, '2026-12-01').filter((i) => i.tipo === 'decimo').map((i) => i.vencimento)).toEqual(['2026-12-18']);
    const longe = { ...d, ferias: [{ id: 'f', empregadoId: 'e1', empresaId: 'a', aquisitivoInicio: '2025-01-15', inicio: '2027-06-07', dias: 30, abonoDias: 0, avisoEm: null, pagamentoEm: null }] };
    expect(itensNaJanela(itensDoDp(longe, nomes, '2026-11-21'), 30).some((i) => i.tipo === 'ferias_programada')).toBe(false);
  });
});
