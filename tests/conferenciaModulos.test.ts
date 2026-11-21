import { describe, it, expect } from 'vitest';
import {
  conferirModulos, fraseConferencia, mesesDaJanela, terminoDoContrato, type ContratoConf, type FontesConferencia,
  type PontoFuncionarioConf,
} from '@/lib/conferenciaModulos';
import { dadosVazios } from '@/lib/contratos';
import { jornadaDaFolha, jornadaDoEmpregado, type Empregado } from '@/lib/dp';

const EMP = new Map([['e1', 'Padaria Sol']]);

const emp = (o: Partial<Empregado> & { id: string; nome: string }): Empregado => ({
  escritorioId: 'esc', empresaId: 'e1', cpf: null, cargo: null, admissao: '2025-01-10', salarioBase: null, horasSemanais: null,
  escala: null, dsr: 0, bancoHoras: false, bancoHorasDesde: null, situacao: 'ativo', situacaoDesde: null, afastamentoTipo: null,
  aquisitivoBase: null, origem: 'manual', atualizadoEm: null, atualizadoPor: null, ...o,
});

const contrato = (o: { nome: string; situacao: ContratoConf['situacao']; admissao?: string; termino?: string; cpf?: string }): ContratoConf => ({
  id: `c-${o.nome}`, empresa: 'e1', situacao: o.situacao,
  dados: { ...dadosVazios(), nome: o.nome, admissao: o.admissao ?? '2026-01-05', diasPeriodo: 45, diasProrrogacao: 45, termino: o.termino ?? '', cpf: o.cpf ?? '' },
});

const ponto = (funcionario: string, dias: { data: string; marcador?: PontoFuncionarioConf['dias'][number]['marcador']; trabalhado?: boolean }[], empregadoId?: string): PontoFuncionarioConf => ({
  empresaId: 'e1', funcionario, empregadoId: empregadoId ?? null,
  dias: dias.map((d) => ({ data: d.data, marcador: d.marcador ?? null, trabalhado: d.trabalhado ?? true })),
});

const fontes = (o: Partial<FontesConferencia> = {}): FontesConferencia => ({ empregados: [], contratos: [], ferias: [], ponto: [], ...o });
const codigos = (f: FontesConferencia) => conferirModulos(f, EMP).achados.map((a) => a.codigo);

describe('conferirModulos', () => {
  it('tudo em ordem → nenhum achado', () => {
    const r = conferirModulos(fontes({
      empregados: [emp({ id: 'a', nome: 'ANA' })],
      ponto: [ponto('ANA', [{ data: '2026-11-03' }])],
    }), EMP);
    expect(r.achados).toEqual([]);
    expect(r.indisponiveis).toEqual([]);
    expect(fraseConferencia(r)).toMatch(/batem entre si/);
  });

  it('1) empregado ativo sem admissão (afastado e desligado não entram)', () => {
    const r = conferirModulos(fontes({
      empregados: [
        emp({ id: 'a', nome: 'ANA', admissao: null }),
        emp({ id: 'b', nome: 'BIA', admissao: null, situacao: 'desligado', situacaoDesde: '2026-01-01' }),
        emp({ id: 'c', nome: 'CAIO', admissao: null, situacao: 'afastado', situacaoDesde: '2026-01-01', afastamentoTipo: 'doenca' }),
      ],
    }), EMP);
    expect(r.achados.map((a) => [a.codigo, a.empregado])).toEqual([['ativo_sem_admissao', 'ANA']]);
    expect(r.achados[0].href).toBe('/dp?empresa=e1&empregado=a');
    expect(r.achados[0].empresaNome).toBe('Padaria Sol');
  });

  it('2) no ponto sem admissão nem contrato; com contrato ou admissão não alerta', () => {
    const f = fontes({
      empregados: [emp({ id: 'a', nome: 'ANA' }), emp({ id: 'd', nome: 'DUDA', admissao: null, situacao: 'afastado', situacaoDesde: '2026-02-01', afastamentoTipo: 'outro' })],
      contratos: [contrato({ nome: 'Carla Souza', situacao: 'experiencia' })],
      ponto: [
        ponto('ANA', [{ data: '2026-11-03' }]), // admissão no DP
        ponto('CARLA SOUZA', [{ data: '2026-11-03' }]), // contrato (nome sem caixa/acento diferente)
        ponto('ZEZE', [{ data: '2026-11-03' }]), // ninguém
        ponto('DUDA', [{ data: '2026-11-03' }]), // no DP, mas sem admissão (afastada) e sem contrato
        ponto('VAZIA', []), // sem dias: ignora
      ],
    });
    const r = conferirModulos(f, EMP).achados.filter((a) => a.codigo === 'ponto_sem_vinculo');
    expect(r.map((a) => a.empregado).sort()).toEqual(['DUDA', 'ZEZE']);
    expect(r.find((a) => a.empregado === 'ZEZE')!.href).toBe('/ponto?empresa=e1');
  });

  it('2) ativo sem admissão já apontado em (1) não repete em (2)', () => {
    const c = codigos(fontes({ empregados: [emp({ id: 'a', nome: 'ANA', admissao: null })], ponto: [ponto('ANA', [{ data: '2026-11-03' }])] }));
    expect(c).toEqual(['ativo_sem_admissao']);
  });

  it('2) contrato casa por CPF mesmo com o nome diferente', () => {
    const c = codigos(fontes({
      empregados: [emp({ id: 'a', nome: 'ANA MARIA', admissao: null, situacao: 'afastado', situacaoDesde: '2026-02-01', afastamentoTipo: 'outro', cpf: '52998224725' })],
      contratos: [contrato({ nome: 'Ana M. Silva', situacao: 'experiencia', cpf: '529.982.247-25' })],
      ponto: [ponto('ANA MARIA', [{ data: '2026-11-03' }])],
    }));
    expect(c).not.toContain('ponto_sem_vinculo');
  });

  it('3) contrato encerrado com ponto trabalhado depois do término', () => {
    const f = fontes({
      empregados: [emp({ id: 'a', nome: 'ANA' })],
      contratos: [contrato({ nome: 'ANA', situacao: 'encerrado', termino: '2026-10-31' })],
      ponto: [ponto('ANA', [{ data: '2026-10-30' }, { data: '2026-11-03' }, { data: '2026-11-04' }, { data: '2026-11-05', trabalhado: false, marcador: 'FOLGA' }])],
    });
    const a = conferirModulos(f, EMP).achados.filter((x) => x.codigo === 'contrato_encerrado_com_ponto');
    expect(a).toHaveLength(1);
    expect(a[0].texto).toMatch(/31\/10\/2026/);
    expect(a[0].texto).toMatch(/2 dias/);
    expect(a[0].nivel).toBe('perigo');
  });

  it('3) efetivado, em experiência ou recontratado não alertam; sem término usa o vencimento do contrato', () => {
    const base = { empregados: [emp({ id: 'a', nome: 'ANA' })], ponto: [ponto('ANA', [{ data: '2026-11-03' }])] };
    expect(codigos(fontes({ ...base, contratos: [contrato({ nome: 'ANA', situacao: 'efetivado', termino: '2026-10-31' })] }))).toEqual([]);
    expect(codigos(fontes({ ...base, contratos: [contrato({ nome: 'ANA', situacao: 'experiencia', termino: '2026-10-31' })] }))).toEqual([]);
    // encerrado antigo + novo contrato do mesmo nome → vale o novo
    expect(codigos(fontes({ ...base, contratos: [contrato({ nome: 'ANA', situacao: 'encerrado', termino: '2026-10-31' }), contrato({ nome: 'ANA', situacao: 'experiencia', admissao: '2026-11-01' })] }))).toEqual([]);
    // admissão do DP depois do término → recontratada
    expect(codigos(fontes({ ...base, empregados: [emp({ id: 'a', nome: 'ANA', admissao: '2026-11-01' })], contratos: [contrato({ nome: 'ANA', situacao: 'encerrado', termino: '2026-10-31' })] }))).toEqual([]);
    // sem `termino`: 2026-01-05 + 90 dias − 1 = 2026-04-04
    expect(terminoDoContrato(contrato({ nome: 'X', situacao: 'encerrado' }).dados)).toBe('2026-04-04');
  });

  it('6) desligado com ponto depois da data (no próprio dia não conta)', () => {
    const f = fontes({
      empregados: [emp({ id: 'a', nome: 'ANA', situacao: 'desligado', situacaoDesde: '2026-10-15' })],
      ponto: [ponto('ANA', [{ data: '2026-10-15' }, { data: '2026-10-16' }, { data: '2026-10-20', trabalhado: false, marcador: 'FALTA' }])],
    });
    const a = conferirModulos(f, EMP).achados;
    expect(a.map((x) => x.codigo)).toEqual(['desligado_com_ponto']);
    expect(a[0].texto).toMatch(/1 dia /);
  });

  it('4) marcador FÉRIAS sem programação; dias cobertos pelo DP não alertam', () => {
    const f = fontes({
      empregados: [emp({ id: 'a', nome: 'ANA' }), emp({ id: 'b', nome: 'BIA' })],
      ferias: [{ id: 'f1', empregadoId: 'b', empresaId: 'e1', aquisitivoInicio: '2025-01-10', inicio: '2026-11-02', dias: 10, abonoDias: 0, avisoEm: null, pagamentoEm: null }],
      ponto: [
        ponto('ANA', [{ data: '2026-11-02', marcador: 'FÉRIAS', trabalhado: false }, { data: '2026-11-03', marcador: 'FÉRIAS', trabalhado: false }]),
        ponto('BIA', [{ data: '2026-11-02', marcador: 'FÉRIAS', trabalhado: false }, { data: '2026-11-11', marcador: 'FÉRIAS', trabalhado: false }, { data: '2026-11-12', marcador: 'FÉRIAS', trabalhado: false }]),
      ],
    });
    const a = conferirModulos(f, EMP).achados.filter((x) => x.codigo === 'ferias_marcador_sem_programacao');
    expect(a.map((x) => [x.empregado, x.texto.match(/em (\d+ dias?)/)![1]])).toEqual([['ANA', '2 dias'], ['BIA', '1 dia']]);
    // BIA: gozo 02/11 a 11/11 — o dia 11 está coberto; só o 12 sobra
    expect(a.find((x) => x.empregado === 'BIA')!.texto).toMatch(/\(12\/11\/2026\)/);
  });

  it('5) férias programadas com ponto trabalhado no período', () => {
    const f = fontes({
      empregados: [emp({ id: 'a', nome: 'ANA' })],
      ferias: [{ id: 'f1', empregadoId: 'a', empresaId: 'e1', aquisitivoInicio: '2025-01-10', inicio: '2026-11-02', dias: 5, abonoDias: 0, avisoEm: null, pagamentoEm: null }],
      ponto: [ponto('ANA', [
        { data: '2026-11-02', marcador: 'FÉRIAS', trabalhado: false }, // marcado certo
        { data: '2026-11-03' }, { data: '2026-11-04' }, // trabalhou
        { data: '2026-11-09' }, // depois das férias: normal
      ], 'a')],
    });
    const a = conferirModulos(f, EMP).achados;
    expect(a.map((x) => x.codigo)).toEqual(['ferias_com_ponto']);
    expect(a[0].texto).toMatch(/2 dias/);
    expect(a[0].chave).toContain('f1');
  });

  it('vínculo explícito (empregadoId) vale mais que o nome do ponto', () => {
    const f = fontes({
      empregados: [emp({ id: 'a', nome: 'ANA CLARA', situacao: 'desligado', situacaoDesde: '2026-10-15' })],
      ponto: [ponto('ANINHA', [{ data: '2026-10-20' }], 'a')],
    });
    expect(codigos(f)).toEqual(['desligado_com_ponto']);
  });

  it('cada fonte degrada sozinha: indisponível pula só as regras que dependem dela', () => {
    const dp = [emp({ id: 'a', nome: 'ANA', admissao: null }), emp({ id: 'b', nome: 'BIA', situacao: 'desligado', situacaoDesde: '2026-10-15' })];
    const pt = [ponto('BIA', [{ data: '2026-10-20' }])];

    const semPonto = conferirModulos(fontes({ empregados: dp, ponto: null }), EMP);
    expect(semPonto.indisponiveis).toEqual(['ponto']);
    expect(semPonto.achados.map((a) => a.codigo)).toEqual(['ativo_sem_admissao']);

    const semDp = conferirModulos(fontes({ empregados: null, ponto: pt }), EMP);
    expect(semDp.indisponiveis).toEqual(['dp']);
    expect(semDp.achados).toEqual([]);

    const semContratos = conferirModulos(fontes({ empregados: dp, ponto: pt, contratos: null }), EMP);
    expect(semContratos.indisponiveis).toEqual(['contratos']);
    expect(semContratos.achados.map((a) => a.codigo).sort()).toEqual(['ativo_sem_admissao', 'desligado_com_ponto']);

    const semFerias = conferirModulos(fontes({ empregados: dp, ponto: pt, ferias: null }), EMP);
    expect(semFerias.indisponiveis).toEqual(['ferias']);
    expect(semFerias.achados.some((a) => a.codigo === 'desligado_com_ponto')).toBe(true);

    const tudoFora = conferirModulos({ empregados: null, contratos: null, ferias: null, ponto: null }, EMP);
    expect(tudoFora.achados).toEqual([]);
    expect(tudoFora.indisponiveis).toHaveLength(4);
    expect(fraseConferencia(tudoFora)).toMatch(/fontes disponíveis/);
  });

  it('ordena por gravidade e frase conta empregados', () => {
    const r = conferirModulos(fontes({
      empregados: [emp({ id: 'a', nome: 'ANA', admissao: null }), emp({ id: 'b', nome: 'BIA', situacao: 'desligado', situacaoDesde: '2026-10-15' })],
      ponto: [ponto('BIA', [{ data: '2026-10-20' }])],
    }), EMP);
    expect(r.achados.map((a) => a.nivel)).toEqual(['perigo', 'aviso']);
    expect(fraseConferencia(r)).toBe('2 divergências em 2 empregados');
  });
});

describe('mesesDaJanela', () => {
  it('3 meses até hoje, virando o ano', () => {
    expect(mesesDaJanela('2026-01-15')).toEqual([{ ano: 2025, mes: 11 }, { ano: 2025, mes: 12 }, { ano: 2026, mes: 1 }]);
    expect(mesesDaJanela('2026-11-21', 1)).toEqual([{ ano: 2026, mes: 11 }]);
  });
});

describe('jornadaDaFolha (mesma jornada da revisão, do resumo e da planilha)', () => {
  const empresa = { utilMin: 480, sabadoMin: 240, trabalhaSabado: true };
  it('funcionário → empresa → padrão, igual a jornadaDoEmpregado', () => {
    const func = { jornadaUtilMin: 360, jornadaSabadoMin: undefined };
    const j = jornadaDaFolha(null, func, empresa);
    const ref = jornadaDoEmpregado(null, func, { jornadaUtilMin: 480, jornadaSabadoMin: 240, trabalhaSabado: true });
    expect(j).toEqual({ utilMin: ref.utilMin, sabadoMin: ref.sabadoMin, trabalhaSabado: ref.trabalhaSabado });
    expect(j).toEqual({ utilMin: 360, sabadoMin: 240, trabalhaSabado: true });
    expect(jornadaDaFolha(undefined, undefined, empresa)).toEqual(empresa);
  });
  it('o DP não muda a jornada diária (só horas semanais/escala/DSR)', () => {
    expect(jornadaDaFolha({ horasSemanais: 30, escala: '12x36', dsr: 3 }, { jornadaUtilMin: 420 }, empresa).utilMin).toBe(420);
  });
});
