import { describe, it, expect } from 'vitest';
import { Obrigacao } from '@/lib/agenda';
import {
  checklistDaEmpresa, chavePedido, EntradaFechamento, itensNovos, MODELO_PADRAO, ModeloRecorrente,
  obrigacoesDaCompetencia, ordenarFechamento, pedidosAAbrir, pendenciaDoDocumento, prazoDoPedido,
  resumirFechamento,
} from '@/lib/fechamento';

const modelo = (extra: Partial<ModeloRecorrente> = {}): ModeloRecorrente => ({
  id: 'm1', empresaId: 'e1', titulo: 'Extrato bancário', descricao: null, categoria: 'extrato', diaPrazo: 10,
  ativa: true, criadoEm: '2026-10-15T12:00:00Z', excluidoEm: null, ...extra,
});

describe('prazoDoPedido', () => {
  it('cai no mês seguinte à competência', () => {
    expect(prazoDoPedido('2026-10', 10)).toBe('2026-11-10');
    expect(prazoDoPedido('2026-12', 5)).toBe('2027-01-05');
  });
  it('limita o dia a 1–28', () => {
    expect(prazoDoPedido('2026-01', 31)).toBe('2026-02-28');
    expect(prazoDoPedido('2026-01', 0)).toBe('2026-02-10');
  });
});

describe('pedidosAAbrir', () => {
  it('abre a competência anterior com o prazo do modelo', () => {
    expect(pedidosAAbrir([modelo()], new Set(), '2026-11-01')).toEqual([
      { modeloId: 'm1', empresaId: 'e1', competencia: '2026-10', prazo: '2026-11-10' },
    ]);
  });
  it('é idempotente: não repete o que já abriu (nem o excluído)', () => {
    const ja = new Set([chavePedido('m1', '2026-10')]);
    expect(pedidosAAbrir([modelo()], ja, '2026-11-01')).toEqual([]);
    expect(pedidosAAbrir([modelo()], ja, '2026-11-02')).toEqual([]);
  });
  it('recupera o dia 1º perdido: abre no dia 2', () => {
    expect(pedidosAAbrir([modelo()], new Set(), '2026-11-02')).toHaveLength(1);
  });
  it('janeiro cobre dezembro do ano anterior', () => {
    const r = pedidosAAbrir([modelo()], new Set(), '2027-01-01');
    expect(r[0].competencia).toBe('2026-12');
    expect(r[0].prazo).toBe('2027-01-10');
  });
  it('ignora modelo inativo, excluído ou criado neste mês', () => {
    const lista = [
      modelo({ id: 'a', ativa: false }), modelo({ id: 'b', excluidoEm: '2026-10-20T00:00:00Z' }),
      modelo({ id: 'c', criadoEm: '2026-11-01T08:00:00Z' }),
    ];
    expect(pedidosAAbrir(lista, new Set(), '2026-11-01')).toEqual([]);
  });
});

describe('pendenciaDoDocumento', () => {
  const base = { id: 'p1', empresaId: 'e1', categoria: 'extrato' as const, competencia: '2026-10', modeloId: 'm1', prazo: '2026-11-10', criadoEm: '2026-11-01T10:00:00Z' };
  const doc = { empresaId: 'e1', categoria: 'extrato', competencia: '2026-10' };
  it('fecha a recorrente de mesma empresa, categoria e competência', () => {
    expect(pendenciaDoDocumento(doc, [base])).toBe('p1');
  });
  it('não mexe em pedido manual, de outra categoria, mês ou empresa', () => {
    expect(pendenciaDoDocumento(doc, [{ ...base, modeloId: null }])).toBeNull();
    expect(pendenciaDoDocumento({ ...doc, categoria: 'nota' }, [base])).toBeNull();
    expect(pendenciaDoDocumento({ ...doc, competencia: '2026-09' }, [base])).toBeNull();
    expect(pendenciaDoDocumento({ ...doc, empresaId: 'e2' }, [base])).toBeNull();
  });
  it('escolhe a de prazo mais próximo', () => {
    expect(pendenciaDoDocumento(doc, [{ ...base, id: 'tarde', prazo: '2026-11-20' }, { ...base, id: 'cedo', prazo: '2026-11-05' }])).toBe('cedo');
  });
});

describe('itensNovos', () => {
  it('pula o que a empresa já pede, ignorando acento e caixa', () => {
    const novos = itensNovos(MODELO_PADRAO, [{ titulo: 'EXTRATO BANCARIO', categoria: 'extrato', excluidoEm: null }]);
    expect(novos.map((i) => i.titulo)).not.toContain('Extrato bancário');
    expect(novos).toHaveLength(MODELO_PADRAO.length - 1);
  });
  it('o item excluído não conta como existente', () => {
    expect(itensNovos(MODELO_PADRAO, [{ titulo: 'Extrato bancário', categoria: 'extrato', excluidoEm: '2026-01-01' }])).toHaveLength(MODELO_PADRAO.length);
  });
});

function ok<T>(dados: T) { return { ok: true as const, dados }; }
const entrada = (extra: Partial<EntradaFechamento> = {}): EntradaFechamento => ({
  empresaId: 'e1', nome: 'Vaz & Vouzela',
  caixa: ok({ lancamentos: 10, naoConferidos: 0, confirmado: true }),
  documentos: ok({ pedidos: 2, abertos: 0 }),
  obrigacoes: ok({ total: 3, feitas: 3 }),
  ...extra,
});

describe('checklistDaEmpresa', () => {
  it('fecha quando tudo foi feito', () => {
    const r = checklistDaEmpresa(entrada(), '2026-10');
    expect(r.situacao).toBe('fechada');
    expect(r.etapas.every((e) => e.estado === 'ok')).toBe(true);
  });
  it('fica aberta e conta o que falta', () => {
    const r = checklistDaEmpresa(entrada({
      caixa: ok({ lancamentos: 10, naoConferidos: 4, confirmado: false }),
      documentos: ok({ pedidos: 2, abertos: 1 }),
    }), '2026-10');
    expect(r.situacao).toBe('aberta');
    expect(r.faltam).toBe(3);
    expect(r.etapas.find((e) => e.chave === 'conferencia')!.detalhe).toBe('4 lançamentos a conferir.');
    expect(r.etapas.find((e) => e.chave === 'documentos')!.detalhe).toBe('Faltam 1 de 2.');
  });
  it('mês confirmado sem movimento conta como lançado e não pede conferência', () => {
    const r = checklistDaEmpresa(entrada({ caixa: ok({ lancamentos: 0, naoConferidos: 0, confirmado: true }) }), '2026-10');
    expect(r.etapas.find((e) => e.chave === 'caixa')!.estado).toBe('ok');
    expect(r.etapas.find((e) => e.chave === 'conferencia')!.estado).toBe('na');
    expect(r.situacao).toBe('fechada');
  });
  it('sem lançamento e sem confirmação, o caixa falta', () => {
    const r = checklistDaEmpresa(entrada({ caixa: ok({ lancamentos: 0, naoConferidos: 0, confirmado: false }) }), '2026-10');
    expect(r.etapas.find((e) => e.chave === 'caixa')!.estado).toBe('falta');
  });
  it('cada fonte degrada sozinha: falha vira indisponível e as outras seguem', () => {
    const r = checklistDaEmpresa(entrada({ documentos: { ok: false } }), '2026-10');
    expect(r.etapas.find((e) => e.chave === 'documentos')!.estado).toBe('indisponivel');
    expect(r.etapas.find((e) => e.chave === 'caixa')!.estado).toBe('ok');
    expect(r.situacao).toBe('incompleta'); // não afirma "fechada" sem ver tudo
  });
  it('falta algo mesmo com outra fonte fora do ar → aberta', () => {
    const r = checklistDaEmpresa(entrada({ obrigacoes: ok({ total: 3, feitas: 1 }), documentos: { ok: false } }), '2026-10');
    expect(r.situacao).toBe('aberta');
  });
  it('fonte que não se aplica (sem módulo caixa) vira n/a', () => {
    const r = checklistDaEmpresa(entrada({ caixa: ok(null) }), '2026-10');
    expect(r.etapas.filter((e) => e.estado === 'na')).toHaveLength(3);
    expect(r.situacao).toBe('fechada');
  });
  it('empresa sem nada aplicável fica fora da conta', () => {
    const r = checklistDaEmpresa(entrada({
      caixa: ok(null), documentos: ok({ pedidos: 0, abertos: 0 }), obrigacoes: ok({ total: 0, feitas: 0 }),
    }), '2026-10');
    expect(r.situacao).toBe('sem_etapas');
  });
});

describe('resumirFechamento / ordenarFechamento', () => {
  const lista = [
    checklistDaEmpresa(entrada({ empresaId: 'a', nome: 'A' }), '2026-10'),
    checklistDaEmpresa(entrada({ empresaId: 'b', nome: 'B', documentos: ok({ pedidos: 1, abertos: 1 }) }), '2026-10'),
    checklistDaEmpresa(entrada({ empresaId: 'c', nome: 'C', obrigacoes: { ok: false } }), '2026-10'),
    checklistDaEmpresa(entrada({ empresaId: 'd', nome: 'D', caixa: ok(null), documentos: ok(null), obrigacoes: ok(null) }), '2026-10'),
  ];
  it('conta "X de Y" sem as empresas sem etapas', () => {
    const r = resumirFechamento(lista);
    expect(r).toMatchObject({ total: 3, fechadas: 1, abertas: 1, incompletas: 1 });
    expect(r.frase).toBe('1 de 3 empresas fechadas · 1 sem todos os dados');
  });
  it('frase para nenhuma empresa e para uma só', () => {
    expect(resumirFechamento([]).frase).toBe('Nenhuma empresa com etapas para fechar.');
    expect(resumirFechamento([lista[0]]).frase).toBe('1 de 1 empresa fechada');
  });
  it('abertas primeiro', () => {
    expect(ordenarFechamento(lista).map((e) => e.empresaId)).toEqual(['b', 'c', 'a', 'd']);
  });
});

describe('obrigacoesDaCompetencia', () => {
  const o = (extra: Partial<Obrigacao>): Obrigacao => ({
    id: 'o1', empresaId: 'e1', tipo: 'das', nome: 'DAS', recorrencia: 'mensal', modoDia: 'dia_fixo', dia: 20, mes: null,
    defasagem: 1, ajuste: 'prorroga', dataUnica: null, avisoDias: 0, inicio: '2026-01-01', responsavel: null,
    observacao: null, ativa: true, ...extra,
  });
  it('conta as ocorrências da competência e as feitas', () => {
    const r = obrigacoesDaCompetencia(
      [o({ id: 'a' }), o({ id: 'b', tipo: 'iss', nome: 'ISS', dia: 10 }), o({ id: 'c', empresaId: 'e2' })],
      [{ obrigacaoId: 'a', competencia: '2026-10' }], '2026-10',
    );
    expect(r.get('e1')).toEqual({ total: 2, feitas: 1 });
    expect(r.get('e2')).toEqual({ total: 1, feitas: 0 });
  });
  it('ignora anual, inativa e o que começou a ser acompanhado depois', () => {
    const r = obrigacoesDaCompetencia(
      [o({ id: 'a', recorrencia: 'anual', mes: 5 }), o({ id: 'b', ativa: false }), o({ id: 'c', inicio: '2026-12-01' })], [], '2026-10',
    );
    expect(r.size).toBe(0);
  });
});
