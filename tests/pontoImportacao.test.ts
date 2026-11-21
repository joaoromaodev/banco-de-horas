import { describe, expect, it } from 'vitest';
import { EMPRESA_LEGADA_ID, planejarImportacao, resolverEmpresa } from '@/lib/pontoImportacao';
import { diasParaGravar } from '@/lib/pontoDb';

const ESC = 'esc-a';
const OUTRO = 'esc-b';
const VAZ = 'uuid-vaz';
const HAGE = 'uuid-hage';
const empresas = [
  { id: VAZ, nome: 'VAZ & VOUZELA INDÚSTRIA E COMÉRCIO', escritorio_id: ESC },
  { id: HAGE, nome: 'L A T HAGE', escritorio_id: ESC },
  { id: 'uuid-alheia', nome: 'EMPRESA DE OUTRO', escritorio_id: OUTRO },
];
const destino = empresas.filter((e) => e.escritorio_id === ESC);

const CAB_FUNC = ['nome', 'cargo', 'jornadaUtilMin', 'jornadaSabadoMin', 'ordem', 'empresa'];
const CAB_FREQ = ['funcionario', 'ano', 'mes', 'dia', 'entradaManha', 'saidaAlmoco', 'retornoAlmoco', 'saidaTarde', 'marcador', 'atualizadoEm', 'empresa'];

describe('resolverEmpresa', () => {
  it('id atual e razão social exata', () => {
    expect(resolverEmpresa(VAZ, destino)).toEqual({ id: VAZ, legada: false });
    expect(resolverEmpresa('L A T HAGE', destino)).toEqual({ id: HAGE, legada: false });
  });

  it('vínculo legado (id antigo, nome antigo ou vazio) vai para a Vaz & Vouzela', () => {
    expect(resolverEmpresa(EMPRESA_LEGADA_ID, destino)).toEqual({ id: VAZ, legada: true });
    expect(resolverEmpresa('VAZ E VOUZELA', destino)).toEqual({ id: VAZ, legada: true });
    expect(resolverEmpresa('', destino)).toEqual({ id: VAZ, legada: true });
  });

  it('empresa apagada ou de outro escritório não resolve', () => {
    expect(resolverEmpresa('uuid-apagada', destino)).toBeNull();
    expect(resolverEmpresa('uuid-alheia', destino)).toBeNull();
  });

  it('legado sem uma Vaz & Vouzela única no destino não resolve (escritório errado)', () => {
    expect(resolverEmpresa(EMPRESA_LEGADA_ID, [{ id: 'x', nome: 'OUTRA', escritorio_id: ESC }])).toBeNull();
  });
});

describe('planejarImportacao', () => {
  const plano = planejarImportacao({
    escritorioId: ESC,
    empresas,
    funcionarios: [
      CAB_FUNC,
      ['ANA', 'SORVETEIRA', '480', '240', '1', VAZ],
      ['  BRUNO ', '', '', '', '2', VAZ],
      ['ANA', 'DUPLICADA', '', '', '3', VAZ],
      ['ANA', 'SORVETEIRA', '480', '240', '1', EMPRESA_LEGADA_ID], // cópia antiga
      ['FUNC TESTE', '', '', '', '7', 'uuid-apagada'],
      ['INTRUSO', '', '', '', '1', 'uuid-alheia'],
      ['', 'sem nome', '', '', '', VAZ],
      ['CARLOS', 'GERENTE', 'abc', '9999', 'x', HAGE],
    ],
    frequencias: [
      CAB_FREQ,
      ['ANA', '2026', '10', '1', '08:00', '12:00', '13:00', '17:00', '', '2026-11-01T03:00:00Z', VAZ],
      ['ANA', '2026', '10', '2', '08:00', '12:00', '12>54', '17:00', '', '2026-11-01T03:00:00Z', VAZ],
      ['ANA', '2026', '10', '3', '', '', '', '', 'FÉRIAS', '2026-11-01T03:00:00Z', VAZ],
      ['ANA', '2026', '10', '4', '', '', '', '', '', '2026-11-01T03:00:00Z', VAZ], // vazio
      ['ANA', '2026', '10', '5', '', '', '', '', 'XYZ', '', VAZ], // marcador inválido e sem hora
      ['ANA', '2026', '6', '1', '08:00', '', '', '17:00', '', '2026-07-01T00:00:00Z', EMPRESA_LEGADA_ID],
      ['ANA', '2026', '10', '1', '07:00', '', '', '16:00', '', '2026-12-01T00:00:00Z', EMPRESA_LEGADA_ID], // colide com o atual
      ['ANA', '2026', '13', '1', '08:00', '', '', '', '', '', VAZ],
      ['ANA', '2026', '10', '1', '08:00', '', '', '', '', '', 'uuid-alheia'],
    ],
    feriados: [['data', 'descricao'], ['2026-12-25', 'Natal'], ['25/12/2026', 'formato errado'], ['2026-12-25', 'repetido']],
  });

  it('funcionários: só os de empresa atual do escritório, sem repetir', () => {
    expect(plano.funcionarios.map((f) => `${f.empresa_id}|${f.nome}`)).toEqual([
      `${VAZ}|ANA`, `${VAZ}|BRUNO`, `${HAGE}|CARLOS`,
    ]);
    expect(plano.funcionarios.every((f) => f.escritorio_id === ESC)).toBe(true);
    const ana = plano.funcionarios[0];
    expect(ana).toMatchObject({ cargo: 'SORVETEIRA', jornada_util_min: 480, jornada_sabado_min: 240, ordem: 1 });
    // jornada inválida vira nula (usa a da empresa), ordem não numérica também
    expect(plano.funcionarios[2]).toMatchObject({ jornada_util_min: null, jornada_sabado_min: null, ordem: null });
  });

  it('frequências: recupera o legado, mas o lançamento atual vence na colisão', () => {
    const chaves = plano.frequencias.map((f) => `${f.mes}/${f.dia}`).sort();
    expect(chaves).toEqual(['10/1', '10/2', '10/3', '6/1']);
    expect(plano.frequenciasLegadas).toBe(1);
    const dia1 = plano.frequencias.find((f) => f.mes === 10 && f.dia === 1)!;
    expect(dia1.entrada_manha).toBe('08:00'); // o atual, não o legado
    expect(plano.frequencias.every((f) => f.empresa_id === VAZ && f.escritorio_id === ESC)).toBe(true);
  });

  it('mantém horário fora do padrão, com aviso', () => {
    expect(plano.frequencias.find((f) => f.dia === 2)!.retorno_almoco).toBe('12>54');
    expect(plano.avisos.some((a) => a.includes('12>54'))).toBe(true);
  });

  it('marcador válido entra; inválido é descartado com aviso', () => {
    expect(plano.frequencias.find((f) => f.dia === 3)!.marcador).toBe('FÉRIAS');
    expect(plano.avisos.some((a) => a.includes('XYZ'))).toBe(true);
  });

  it('conta o que ficou de fora, por motivo', () => {
    expect(plano.ignorados['funcionário com vínculo legado (cópia antiga, não aparece no app)']).toBe(1);
    expect(plano.ignorados['funcionário de empresa que não existe mais (ou de outro escritório)']).toBe(2);
    expect(plano.ignorados['funcionário repetido na mesma empresa']).toBe(1);
    expect(plano.ignorados['funcionário sem nome']).toBe(1);
    expect(plano.ignorados['frequência sem horário nem marcador']).toBe(2);
    expect(plano.ignorados['frequência com funcionário, ano, mês ou dia inválido']).toBe(1);
    expect(plano.ignorados['frequência de empresa que não existe mais (ou de outro escritório)']).toBe(1);
    expect(plano.ignorados['frequência repetida (mesmo funcionário e dia)']).toBe(1);
  });

  it('feriados: só AAAA-MM-DD, sem repetir', () => {
    expect(plano.feriados).toEqual([{ escritorio_id: ESC, data: '2026-12-25', descricao: 'Natal' }]);
    expect(plano.ignorados['feriado com data inválida']).toBe(1);
    expect(plano.ignorados['feriado repetido']).toBe(1);
  });

  it('planilha vazia não quebra', () => {
    const vazio = planejarImportacao({ escritorioId: ESC, empresas });
    expect(vazio).toMatchObject({ funcionarios: [], frequencias: [], feriados: [], frequenciasLegadas: 0 });
  });
});

describe('diasParaGravar', () => {
  it('descarta dia vazio, dia fora de 1..31 e marcador inválido; o último repetido vence', () => {
    const dias = diasParaGravar([
      { dia: 2, entradaManha: '08:00', saidaAlmoco: null, retornoAlmoco: null, saidaTarde: '17:00' },
      { dia: 1, entradaManha: ' ', saidaAlmoco: null, retornoAlmoco: null, saidaTarde: null, marcador: null },
      { dia: 32, entradaManha: '08:00', saidaAlmoco: null, retornoAlmoco: null, saidaTarde: null },
      { dia: 3, entradaManha: null, saidaAlmoco: null, retornoAlmoco: null, saidaTarde: null, marcador: 'INVENTADO' as never },
      { dia: 4, entradaManha: null, saidaAlmoco: null, retornoAlmoco: null, saidaTarde: null, marcador: 'FALTA' },
      { dia: 2, entradaManha: '09:00', saidaAlmoco: null, retornoAlmoco: null, saidaTarde: '18:00' },
    ]);
    expect(dias.map((d) => d.dia)).toEqual([2, 4]);
    expect(dias[0].entradaManha).toBe('09:00');
    expect(dias[1].marcador).toBe('FALTA');
  });
});
