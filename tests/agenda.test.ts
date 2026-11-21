import { describe, it, expect } from 'vitest';
import {
  aplicarModelo, Calendario, CATALOGO, competenciaValida, descreverRegra, deveEnviar, emailDoResumo,
  feriadosNacionais, hojeBelem, montarResumo, MODELOS, obrigacaoDoTipo, Obrigacao, ocorrencias,
  ocorrenciasDe, pascoa, resumoVazio, rotuloCompetencia, situacao, validarObrigacao,
} from '@/lib/agenda';

const cal = () => new Calendario();

function obr(extra: Partial<Obrigacao>): Obrigacao {
  return {
    id: 'o1', empresaId: 'e1', tipo: 'das', nome: 'DAS', recorrencia: 'mensal', modoDia: 'dia_fixo',
    dia: 20, mes: null, defasagem: 1, ajuste: 'prorroga', dataUnica: null, avisoDias: 0,
    inicio: '2020-01-01', responsavel: null, observacao: null, ativa: true, ...extra,
  };
}

describe('feriados', () => {
  it('Páscoa em anos conhecidos', () => {
    expect(pascoa(2024)).toBe('2024-03-31');
    expect(pascoa(2025)).toBe('2025-04-20');
    expect(pascoa(2026)).toBe('2026-04-05');
    expect(pascoa(2027)).toBe('2027-03-28');
  });
  it('nacionais de 2026: fixos, Consciência Negra, Carnaval, Sexta Santa, Corpus Christi', () => {
    const f = feriadosNacionais(2026);
    for (const d of ['2026-01-01', '2026-04-21', '2026-11-20', '2026-12-25', '2026-02-16', '2026-02-17', '2026-04-03', '2026-06-04']) {
      expect(f).toContain(d);
    }
    expect(f).not.toContain('2026-02-18'); // Quarta de Cinzas é útil
  });
  it('dia útil considera fim de semana, nacionais e extras (municipais)', () => {
    const c = new Calendario(['2026-12-08']);
    expect(c.util('2026-11-23')).toBe(true);
    expect(c.util('2026-11-21')).toBe(false); // sábado
    expect(c.util('2026-11-20')).toBe(false); // Consciência Negra
    expect(c.util('2026-12-08')).toBe(false); // extra (N. Sra. da Conceição, Belém)
    expect(cal().util('2026-12-08')).toBe(true);
  });
  it('n-ésimo e último dia útil', () => {
    expect(cal().nDiaUtil(2026, 12, 5)).toBe('2026-12-07');
    expect(cal().nDiaUtil(2026, 2, 30)).toBe('2026-02-27'); // pede além do mês: último útil
    expect(cal().ultimoDiaUtil(2026, 10)).toBe('2026-10-30'); // 31/10 é sábado
    expect(cal().ultimoDiaUtil(2026, 11)).toBe('2026-11-30');
  });
});

describe('ocorrências', () => {
  it('DAS de 10/2026 vence 20/11 (feriado, sexta) e prorroga para 23/11', () => {
    expect(ocorrencias(obr({}), '2026-11-01', '2026-11-30', cal())).toEqual([
      { obrigacaoId: 'o1', empresaId: 'e1', competencia: '2026-10', vencimento: '2026-11-23' },
    ]);
  });
  it('FGTS (antecipa) de 10/2026 vence 19/11', () => {
    const [o] = ocorrencias(obr({ ajuste: 'antecipa' }), '2026-11-01', '2026-11-30', cal());
    expect(o.vencimento).toBe('2026-11-19');
  });
  it('dia fixo na segunda de Carnaval prorroga para a Quarta de Cinzas', () => {
    const [o] = ocorrencias(obr({ dia: 16 }), '2026-02-01', '2026-02-28', cal());
    expect(o).toMatchObject({ competencia: '2026-01', vencimento: '2026-02-18' });
  });
  it('dia 31 em fevereiro vira o último dia do mês e o ajuste vale em seguida', () => {
    const [o] = ocorrencias(obr({ dia: 31, defasagem: 0, ajuste: 'antecipa' }), '2026-02-01', '2026-02-28', cal());
    expect(o).toMatchObject({ competencia: '2026-02', vencimento: '2026-02-27' }); // 28/02 é sábado
  });
  it('ajuste que empurra para o mês seguinte entra na janela certa', () => {
    // 31/10/2026 é sábado; 02/11 é feriado → 03/11
    const lista = ocorrencias(obr({ dia: 31, defasagem: 0 }), '2026-11-01', '2026-11-30', cal());
    expect(lista.map((o) => [o.competencia, o.vencimento])).toEqual([['2026-10', '2026-11-03'], ['2026-11', '2026-11-30']]);
    expect(ocorrencias(obr({ dia: 31, defasagem: 0 }), '2026-10-01', '2026-10-31', cal())).toEqual([]);
  });
  it('último dia útil (DCTFWeb) e n-ésimo dia útil (salários)', () => {
    const [d] = ocorrencias(obr({ modoDia: 'ultimo_dia_util', dia: 0 }), '2026-11-01', '2026-11-30', cal());
    expect(d).toMatchObject({ competencia: '2026-10', vencimento: '2026-11-30' });
    const [s] = ocorrencias(obr({ modoDia: 'n_dia_util', dia: 5 }), '2026-12-01', '2026-12-31', cal());
    expect(s).toMatchObject({ competencia: '2026-11', vencimento: '2026-12-07' });
  });
  it('trimestral: IRPJ/CSLL do 3º tri vence no último dia útil de outubro', () => {
    const o = obr({ recorrencia: 'trimestral', modoDia: 'ultimo_dia_util', dia: 0 });
    const lista = ocorrencias(o, '2026-01-01', '2026-12-31', cal());
    expect(lista.map((x) => [x.competencia, x.vencimento])).toEqual([
      ['2025-T4', '2026-01-30'], ['2026-T1', '2026-04-30'], ['2026-T2', '2026-07-31'], ['2026-T3', '2026-10-30'],
    ]);
  });
  it('anual: DEFIS 2025 em 31/03/2026, IRPF 2025 no último útil de maio, alvará no próprio ano', () => {
    const defis = obrigacaoDoTipo('defis', 'e1', '2020-01-01')!;
    expect(ocorrencias({ ...defis, id: 'x' }, '2026-01-01', '2026-12-31', cal())).toMatchObject([{ competencia: '2025', vencimento: '2026-03-31' }]);
    const irpf = obrigacaoDoTipo('irpf', 'e1', '2020-01-01')!;
    expect(ocorrencias({ ...irpf, id: 'x' }, '2026-01-01', '2026-12-31', cal())).toMatchObject([{ competencia: '2025', vencimento: '2026-05-29' }]);
    const alvara = obrigacaoDoTipo('alvara', 'e1', '2020-01-01')!;
    expect(ocorrencias({ ...alvara, id: 'x' }, '2026-01-01', '2026-12-31', cal())).toMatchObject([{ competencia: '2026', vencimento: '2026-01-31' }]);
  });
  it('única: só na data (com ajuste) e só se estiver na janela', () => {
    const o = obr({ recorrencia: 'unica', dataUnica: '2026-12-25', ajuste: 'antecipa' });
    expect(ocorrencias(o, '2026-12-01', '2026-12-31', cal())).toMatchObject([{ competencia: 'unica', vencimento: '2026-12-24' }]);
    expect(ocorrencias(o, '2027-01-01', '2027-01-31', cal())).toEqual([]);
    expect(ocorrencias(obr({ recorrencia: 'unica', dataUnica: null }), '2026-01-01', '2026-12-31', cal())).toEqual([]);
  });
  it('respeita "acompanhar a partir de" e obrigação inativa', () => {
    const o = obr({ inicio: '2026-11-21' });
    expect(ocorrencias(o, '2026-01-01', '2026-12-31', cal()).map((x) => x.vencimento)).toEqual(['2026-11-23', '2026-12-21']);
    expect(ocorrencias(obr({ ativa: false }), '2026-01-01', '2026-12-31', cal())).toEqual([]);
  });
  it('ano inteiro: 12 ocorrências mensais, ordenadas, competências seguidas', () => {
    const lista = ocorrenciasDe([obr({})], '2026-01-01', '2026-12-31');
    expect(lista).toHaveLength(12);
    expect(lista[0].competencia).toBe('2025-12');
    expect(lista[11].competencia).toBe('2026-11');
  });
});

describe('situação e competência', () => {
  const oc = { obrigacaoId: 'o', empresaId: 'e', competencia: '2026-10', vencimento: '2026-11-23' };
  it('feita, atrasada, hoje, próxima, futura (com antecedência maior)', () => {
    expect(situacao(oc, '2026-11-30', true)).toBe('feita');
    expect(situacao(oc, '2026-11-24', false)).toBe('atrasada');
    expect(situacao(oc, '2026-11-23', false)).toBe('hoje');
    expect(situacao(oc, '2026-11-16', false)).toBe('proxima');
    expect(situacao(oc, '2026-11-01', false)).toBe('futura');
    expect(situacao(oc, '2026-11-01', false, 30)).toBe('proxima');
  });
  it('rótulos e validação', () => {
    expect(rotuloCompetencia('2026-10')).toBe('10/2026');
    expect(rotuloCompetencia('2026-T3')).toBe('3º tri/2026');
    expect(rotuloCompetencia('2025')).toBe('2025');
    expect(rotuloCompetencia('unica')).toBe('—');
    expect(competenciaValida('2026-13', 'mensal')).toBe(false);
    expect(competenciaValida('2026-T4', 'trimestral')).toBe(true);
    expect(competenciaValida('unica', 'unica')).toBe(true);
    expect(competenciaValida('2026', 'mensal')).toBe(false);
  });
  it('hojeBelem é UTC−3', () => {
    expect(hojeBelem(new Date('2026-11-22T02:00:00Z'))).toBe('2026-11-21');
    expect(hojeBelem(new Date('2026-11-22T03:00:00Z'))).toBe('2026-11-22');
  });
});

describe('catálogo e modelos', () => {
  it('todo tipo dos modelos existe no catálogo; DIRF não existe', () => {
    const codigos = new Set(CATALOGO.map((t) => t.codigo));
    for (const m of MODELOS) for (const t of m.tipos) expect(codigos.has(t)).toBe(true);
    expect(codigos.has('dirf')).toBe(false);
  });
  it('todo padrão do catálogo passa na validação (com data, se única)', () => {
    for (const t of CATALOGO) {
      const o = obrigacaoDoTipo(t.codigo, 'e1', '2026-11-21')!;
      const r = validarObrigacao({ ...o, dataUnica: o.recorrencia === 'unica' ? '2027-01-10' : null });
      expect(r.ok, t.codigo).toBe(true);
    }
  });
  it('aplicar modelo pula o que a empresa já tem e deixa a única (certificado) de fora', () => {
    const lista = aplicarModelo('simples', 'e1', '2026-11-21', ['das']);
    const tipos = lista.map((o) => o.tipo);
    expect(tipos).not.toContain('das');
    expect(tipos).not.toContain('certificado_digital');
    expect(tipos).toContain('defis');
    expect(lista.every((o) => o.empresaId === 'e1' && o.inicio === '2026-11-21')).toBe(true);
    expect(aplicarModelo('xx' as never, 'e1', '2026-11-21')).toEqual([]);
  });
  it('DCTFWeb no último dia útil (IN RFB 2.248/2025)', () => {
    expect(obrigacaoDoTipo('dctfweb', 'e', '2026-01-01')).toMatchObject({ modoDia: 'ultimo_dia_util', defasagem: 1 });
  });
});

describe('validarObrigacao', () => {
  const base = { ...obrigacaoDoTipo('das', 'e1', '2026-11-21')! };
  it('aceita e normaliza (ajuste some fora do dia fixo; mês só no anual)', () => {
    const r = validarObrigacao({ ...base, modoDia: 'ultimo_dia_util', ajuste: 'prorroga', mes: 4, responsavel: ' Ana@Ex.com ' });
    expect(r.ok && r.obrigacao).toMatchObject({ ajuste: 'nenhum', mes: null, dia: 0, responsavel: 'ana@ex.com' });
  });
  it('recusa entradas ruins', () => {
    const r = validarObrigacao({ ...base, tipo: 'dirf', dia: 32, nome: ' ', inicio: '2026-02-30' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erros).toEqual(expect.arrayContaining([
        'Tipo de obrigação inválido.', 'Informe o nome da obrigação.', 'Dia do vencimento deve estar entre 1 e 31.',
        'Informe a partir de quando acompanhar.',
      ]));
    }
    expect(validarObrigacao({ ...base, recorrencia: 'anual', mes: null }).ok).toBe(false);
    expect(validarObrigacao({ ...base, recorrencia: 'unica', dataUnica: '' }).ok).toBe(false);
    expect(validarObrigacao({ ...base, responsavel: 'não é e-mail' }).ok).toBe(false);
  });
  it('descreve a regra em português', () => {
    expect(descreverRegra(base)).toBe('dia 20 do mês seguinte · prorroga se não for útil');
    expect(descreverRegra({ ...base, modoDia: 'ultimo_dia_util' })).toBe('último dia útil do mês seguinte');
    expect(descreverRegra({ ...base, recorrencia: 'anual', mes: 3, dia: 31 })).toBe('dia 31 de março do ano seguinte · prorroga se não for útil');
    expect(descreverRegra({ ...base, recorrencia: 'unica', dataUnica: '2027-01-10' })).toBe('em 10/01/2027');
  });
});

describe('aviso por e-mail', () => {
  it('semanal sai na segunda; diário em dia útil; desligado nunca', () => {
    expect(deveEnviar('semanal', '2026-11-23')).toBe(true);
    expect(deveEnviar('semanal', '2026-11-24')).toBe(false);
    expect(deveEnviar('diario', '2026-11-24')).toBe(true);
    expect(deveEnviar('diario', '2026-11-20')).toBe(false); // feriado
    expect(deveEnviar('diario', '2026-11-22')).toBe(false); // domingo
    expect(deveEnviar('desligado', '2026-11-23')).toBe(false);
  });
  it('resumo separa atrasadas, hoje e próximos dias (antecedência própria)', () => {
    const i = (vencimento: string, avisoDias = 0) => ({ empresa: 'A', obrigacao: 'DAS', competencia: '2026-10', vencimento, avisoDias });
    const r = montarResumo([i('2026-11-30'), i('2026-11-10'), i('2026-11-23'), i('2026-12-15'), i('2026-12-15', 30)], '2026-11-23', 7);
    expect(r.atrasadas.map((x) => x.vencimento)).toEqual(['2026-11-10']);
    expect(r.hoje).toHaveLength(1);
    expect(r.proximas.map((x) => x.vencimento)).toEqual(['2026-11-30', '2026-12-15']);
    expect(r.proximas[0]).not.toHaveProperty('avisoDias');
    expect(resumoVazio(montarResumo([], '2026-11-23', 7))).toBe(true);
  });
  it('e-mail: assunto com contagem e HTML escapado', () => {
    const r = montarResumo([{ empresa: '<b>X</b> & Cia', obrigacao: 'DAS', competencia: '2026-10', vencimento: '2026-11-10' }], '2026-11-23', 7);
    const e = emailDoResumo(r, { escritorio: 'Escritório Y', hoje: '2026-11-23', frequencia: 'semanal', urlAgenda: 'https://app/agenda' });
    expect(e.assunto).toBe('Resumo da semana: 1 atrasada — Escritório Y');
    expect(e.html).toContain('&lt;b&gt;X&lt;/b&gt; &amp; Cia');
    expect(e.html).not.toContain('<b>X</b>');
    expect(e.texto).toContain('10/11/2026 · <b>X</b> & Cia · DAS (10/2026)');
    expect(e.texto).toContain('https://app/agenda');
  });
});
