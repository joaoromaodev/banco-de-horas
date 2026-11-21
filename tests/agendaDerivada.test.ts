import { describe, it, expect } from 'vitest';
import { dadosVazios } from '@/lib/contratos';
import { itensDeContratos, propostaDeAgenda, SinaisEmpresa } from '@/lib/agendaDerivada';

const sinais = (extra: Partial<SinaisEmpresa> = {}): SinaisEmpresa => ({ funcionarios: 0, contratosAtivos: 0, ...extra });

describe('propostaDeAgenda', () => {
  it('sem regime e sem sinal, pergunta (nunca deduz)', () => {
    expect(propostaDeAgenda(null, sinais({ tipoPessoa: 'juridica' }), []).situacao).toBe('perguntar');
  });
  it('pessoa física pelo cadastro ou por identificar pagador → modelo PF', () => {
    const a = propostaDeAgenda(null, sinais({ tipoPessoa: 'fisica' }), []);
    expect(a).toMatchObject({ situacao: 'propor', modelo: 'pessoa_fisica', origem: 'sinal', faltam: ['carne_leao', 'irpf'] });
    const b = propostaDeAgenda(null, sinais({ identificaPagador: true }), []);
    expect(b).toMatchObject({ situacao: 'propor', modelo: 'pessoa_fisica' });
  });
  it('Simples com funcionário no ponto ou contrato ativo → modelo com folha', () => {
    expect(propostaDeAgenda('simples', sinais({ funcionarios: 3 }), [])).toMatchObject({ modelo: 'simples_folha' });
    expect(propostaDeAgenda('simples', sinais({ contratosAtivos: 1 }), [])).toMatchObject({ modelo: 'simples_folha' });
    expect(propostaDeAgenda('simples', sinais(), [])).toMatchObject({ modelo: 'simples' });
  });
  it('regime registrado vale mais que o sinal de PF', () => {
    expect(propostaDeAgenda('presumido', sinais({ tipoPessoa: 'fisica' }), [])).toMatchObject({ modelo: 'presumido', origem: 'cadastro' });
  });
  it('quando passa a ter funcionário, propõe só o que falta', () => {
    const existentes = ['das', 'defis', 'pro_labore', 'esocial_fechamento', 'dctfweb', 'darf_previdenciario', 'iss', 'alvara'];
    const r = propostaDeAgenda('simples', sinais({ funcionarios: 2 }), existentes);
    expect(r).toMatchObject({ situacao: 'propor', modelo: 'simples_folha', faltam: ['folha_pagamento', 'fgts_digital', 'irrf'] });
  });
  it('agenda já completa → em dia; avisa o que sobrou de outro modelo', () => {
    const tipos = ['das', 'defis', 'pro_labore', 'esocial_fechamento', 'dctfweb', 'darf_previdenciario', 'iss', 'alvara', 'folha_pagamento'];
    const r = propostaDeAgenda('simples', sinais(), tipos);
    expect(r).toMatchObject({ situacao: 'em_dia', modelo: 'simples', sobram: ['folha_pagamento'] });
  });
  it('funcionários não consultados não viram afirmação, só aviso', () => {
    const r = propostaDeAgenda('simples', sinais({ funcionarios: null, contratosAtivos: null }), []);
    expect(r).toMatchObject({ situacao: 'propor', modelo: 'simples' });
    expect((r as { motivos: string[] }).motivos.join(' ')).toContain('Não foi possível ver os funcionários');
  });
});

describe('itensDeContratos', () => {
  const contrato = (id: string, admissao: string, extra = {}) => ({
    id, empresa: 'e1', situacao: 'experiencia' as const,
    dados: { ...dadosVazios(), nome: 'Maria', admissao, diasPeriodo: 45, diasProrrogacao: 45, ...extra },
  });
  const nomes = new Map([['e1', 'Vaz & Vouzela']]);
  it('traz o fim do 1º período dentro da janela', () => {
    // admissão 2026-10-10 + 44 dias = 2026-11-23
    const r = itensDeContratos([contrato('c1', '2026-10-10')], nomes, '2026-11-20', 30);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ empresa: 'Vaz & Vouzela', vencimento: '2026-11-23', competencia: 'unica', marco: '1º período', dias: 3 });
    expect(r[0].obrigacao).toContain('Maria');
  });
  it('depois do 1º período, mostra o fim da prorrogação', () => {
    const r = itensDeContratos([contrato('c1', '2026-10-10')], nomes, '2026-11-25', 90);
    expect(r[0]).toMatchObject({ marco: 'prorrogação', vencimento: '2027-01-07' });
  });
  it('ignora contrato efetivado/encerrado e fora da janela', () => {
    expect(itensDeContratos([{ ...contrato('c1', '2026-10-10'), situacao: 'efetivado' as const }], nomes, '2026-11-20', 30)).toEqual([]);
    expect(itensDeContratos([contrato('c1', '2026-10-10')], nomes, '2026-11-01', 7)).toEqual([]);
  });
});
