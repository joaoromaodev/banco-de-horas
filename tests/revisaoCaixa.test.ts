// Revisão antes da conferência (lib/revisaoCaixa.ts) — regras puras.
import { describe, it, expect } from 'vitest';
import { chaveDocumento, ContaRevisao, LancamentoRevisao, nivelMaisAlto, revisarLancamentos } from '@/lib/revisaoCaixa';

const contas: ContaRevisao[] = [
  { id: 'atend', codigo: '1.02.05', nome: 'Receita de Atendimento', natureza: 'receita' },
  { id: 'luz', codigo: '2.02.02', nome: 'Energia Elétrica', natureza: 'despesa' },
  { id: 'exp', codigo: '2.02.06', nome: 'Material de Expediente', natureza: 'despesa' },
];

let seq = 0;
function l(data: string, contaId: string | null, v: number, extra: Partial<LancamentoRevisao> = {}): LancamentoRevisao {
  seq++;
  const entrada = contaId === 'atend' ? v : 0;
  return {
    id: `l${seq}`, data, historico: 'H', complemento: null, contaId, entrada, saida: entrada ? 0 : v,
    juros: 0, multa: 0, pagadorNome: null, pagadorDocumento: null, criadoEm: `${data}T10:00:${String(seq % 60).padStart(2, '0')}Z`,
    ...extra,
  };
}
const op = { ano: 2026, saldoInicial: 100_000, identificaPagador: false, hoje: '2026-12-31' };
const codigos = (r: ReturnType<typeof revisarLancamentos>, id: string) => r.porLancamento[id]?.alertas.map((a) => a.codigo) ?? [];

describe('duplicidade', () => {
  it('mesma data + valor + conta = duplicado (alto)', () => {
    const a = l('2026-03-10', 'luz', 500); const b = l('2026-03-10', 'luz', 500); const c = l('2026-03-10', 'exp', 500);
    const r = revisarLancamentos([a, b, c, l('2026-01-05', 'luz', 1), l('2026-02-05', 'luz', 1)], contas, op);
    expect(codigos(r, a.id)).toContain('duplicado');
    expect(codigos(r, b.id)).toContain('duplicado');
    expect(codigos(r, c.id)).not.toContain('duplicado');
    expect(nivelMaisAlto(r.porLancamento[a.id])).toBe('alto');
  });
  it('mesma data/valor/conta com complementos diferentes = quase-duplicado (médio)', () => {
    const a = l('2026-03-10', 'exp', 50, { complemento: 'NF 1' }); const b = l('2026-03-10', 'exp', 50, { complemento: 'NF 2' });
    const r = revisarLancamentos([a, b], contas, op);
    expect(codigos(r, a.id)).toEqual(['quase_duplicado']);
  });
  it('mesmo valor e conta a 2 dias = quase-duplicado; a 10 dias, não', () => {
    const a = l('2026-03-10', 'luz', 321.5); const b = l('2026-03-12', 'luz', 321.5); const c = l('2026-03-25', 'luz', 321.5);
    const r = revisarLancamentos([a, b, c], contas, op);
    expect(codigos(r, a.id)).toContain('quase_duplicado');
    expect(codigos(r, b.id)).toContain('quase_duplicado');
    expect(codigos(r, c.id)).not.toContain('quase_duplicado');
  });
  it('o mesmo documento em dias diferentes = quase-duplicado', () => {
    const a = l('2026-02-01', 'exp', 100, { complemento: 'NF 33406' }); const b = l('2026-03-01', 'exp', 120, { complemento: 'nf 33406' });
    const r = revisarLancamentos([a, b], contas, op);
    expect(r.porLancamento[b.id].alertas[0].motivo).toContain('01/02');
  });
  it('mesmo valor no mesmo dia, pacientes diferentes, não é duplicidade', () => {
    const a = l('2026-03-10', 'atend', 800, { pagadorNome: 'Maria' }); const b = l('2026-03-10', 'atend', 800, { pagadorNome: 'José' });
    const c = l('2026-03-11', 'atend', 800, { pagadorNome: 'maria ' });
    const r = revisarLancamentos([a, b, c], contas, op);
    expect(r.porLancamento[b.id]).toBeUndefined();
    expect(codigos(r, a.id)).toEqual(['quase_duplicado']); // Maria de novo no dia seguinte
  });
  it('cheque (retirada + pagamento) não é duplicidade', () => {
    const ret = l('2026-03-10', null, 0, { historico: 'Retirada de conta corrente', entrada: 800, saida: 0, complemento: 'Cheque — NF 9999' });
    const pag = l('2026-03-10', 'exp', 800, { complemento: 'NF 9999' });
    const r = revisarLancamentos([ret, pag], contas, op);
    expect(r.porLancamento[ret.id]).toBeUndefined();
    expect(r.porLancamento[pag.id]).toBeUndefined();
  });
});

describe('valor fora do padrão da conta', () => {
  const luz = [700, 650, 720, 690, 710].map((v, i) => l(`2026-0${i + 1}-10`, 'luz', v));
  it('10× a mediana alerta, com mediana e quantidade no motivo', () => {
    const fora = l('2026-03-20', 'luz', 7000);
    const r = revisarLancamentos([...luz, fora], contas, op);
    expect(codigos(r, fora.id)).toContain('valor_fora_padrao');
    expect(r.porLancamento[fora.id].alertas[0].motivo).toMatch(/mediana R\$ 700,00 em 5 lançamentos/);
  });
  it('variação normal não alerta; poucos lançamentos não têm padrão', () => {
    expect(revisarLancamentos([...luz, l('2026-03-20', 'luz', 900)], contas, op).resumo.lancamentos).toBe(0);
    const r = revisarLancamentos([l('2026-01-10', 'luz', 100), l('2026-02-10', 'luz', 9000)], contas, op);
    expect(Object.values(r.porLancamento).flatMap((x) => x.alertas.map((a) => a.codigo))).not.toContain('valor_fora_padrao');
  });
  it('anos anteriores entram no padrão', () => {
    const fora = l('2026-03-20', 'luz', 7000);
    const r = revisarLancamentos([fora], contas, { ...op, anteriores: luz.map((x) => ({ ...x, data: x.data.replace('2026', '2025') })) });
    expect(codigos(r, fora.id)).toContain('valor_fora_padrao');
  });
});

describe('natureza, pagador e titular', () => {
  it('receita como saída e despesa como entrada (alto)', () => {
    const a = l('2026-03-10', 'atend', 0, { entrada: 0, saida: 50 });
    const b = l('2026-03-11', 'luz', 0, { entrada: 50, saida: 0 });
    const r = revisarLancamentos([a, b], contas, op);
    expect(codigos(r, a.id)).toContain('natureza_invertida');
    expect(r.porLancamento[a.id].alertas[0].nivel).toBe('alto');
    expect(r.porLancamento[b.id].alertas[0].nivel).toBe('alto');
  });
  it('estorno/devolução citado no complemento: médio, e o motivo aponta Recuperação de despesas', () => {
    const b = l('2026-03-11', 'luz', 0, { entrada: 50, saida: 0, complemento: 'Estorno da fatura' });
    const r = revisarLancamentos([b], contas, op);
    expect(r.porLancamento[b.id].alertas[0]).toMatchObject({ nivel: 'medio' });
    expect(r.porLancamento[b.id].alertas[0].motivo).toContain('Recuperação de despesas');
  });
  it('empresa que identifica pagador: entrada sem nome/CPF e CPF inválido', () => {
    const sem = l('2026-03-10', 'atend', 800);
    const semDoc = l('2026-03-11', 'atend', 800, { pagadorNome: 'Maria' });
    const inv = l('2026-03-12', 'atend', 800, { pagadorNome: 'Maria', pagadorDocumento: '12345678900' });
    const ok = l('2026-03-13', 'atend', 800, { pagadorNome: 'Maria', pagadorDocumento: '52998224725' });
    const ret = l('2026-03-14', null, 0, { historico: 'Retirada de conta corrente', entrada: 100 });
    const r = revisarLancamentos([sem, semDoc, inv, ok, ret], contas, { ...op, identificaPagador: true });
    expect(r.porLancamento[sem.id].alertas[0].motivo).toContain('o nome e o CPF/CNPJ');
    expect(r.porLancamento[semDoc.id].alertas[0].motivo).toContain('sem o CPF/CNPJ');
    expect(codigos(r, inv.id)).toContain('documento_invalido');
    expect(r.porLancamento[ok.id]).toBeUndefined();
    expect(r.porLancamento[ret.id]).toBeUndefined();
    // empresa que não identifica: nada disso
    expect(revisarLancamentos([sem], contas, op).resumo.lancamentos).toBe(0);
  });
  it('sem titular só alerta quando não é transferência', () => {
    const a = l('2026-03-10', null, 50, { historico: 'Compra' });
    const b = l('2026-03-11', null, 75, { historico: 'Depósito em conta corrente' });
    const r = revisarLancamentos([a, b], contas, op);
    expect(codigos(r, a.id)).toEqual(['sem_titular']);
    expect(r.porLancamento[b.id]).toBeUndefined();
  });
});

describe('juros/multa, saldo e meses', () => {
  it('juros/multa em 3 meses: alerta no 3º e no exercício', () => {
    const j = [1, 2, 3].map((m) => l(`2026-0${m}-10`, 'luz', 100, { juros: 2 + m }));
    const r = revisarLancamentos(j, contas, op);
    expect(codigos(r, j[0].id)).not.toContain('juros_multa_recorrentes');
    expect(codigos(r, j[2].id)).toContain('juros_multa_recorrentes');
    expect(r.gerais.find((g) => g.codigo === 'juros_multa_recorrentes')?.motivo).toContain('R$ 12,00');
  });
  it('saldo negativo: marca o lançamento que vira o saldo, conta as vezes', () => {
    const a = l('2026-01-10', 'luz', 150); const b = l('2026-01-11', 'luz', 10);
    const c = l('2026-01-12', 'atend', 500); const d = l('2026-02-01', 'luz', 600);
    const r = revisarLancamentos([d, c, b, a], contas, { ...op, saldoInicial: 100 });
    expect(codigos(r, a.id)).toContain('saldo_negativo');
    expect(codigos(r, b.id)).not.toContain('saldo_negativo'); // continua negativo, não é nova virada
    expect(codigos(r, d.id)).toContain('saldo_negativo');
    expect(r.gerais.find((g) => g.codigo === 'saldo_negativo')?.motivo).toContain('2 vezes');
  });
  it('mês sem lançamento: só meses já encerrados', () => {
    const meses = (hoje: string) => revisarLancamentos([l('2026-01-10', 'luz', 1)], contas, { ...op, hoje })
      .gerais.filter((g) => g.codigo === 'mes_sem_lancamento').map((g) => g.mes);
    expect(meses('2026-04-11')).toEqual([2, 3]);
    expect(meses('2026-04-10')).toEqual([2]); // março ainda na carência de 10 dias
    expect(meses('2026-01-20')).toEqual([]);
    const passado = revisarLancamentos([l('2025-01-10', 'luz', 1)], contas, { ...op, ano: 2025 });
    expect(passado.gerais.filter((g) => g.codigo === 'mes_sem_lancamento')).toHaveLength(11);
    expect(revisarLancamentos([], contas, op).gerais).toEqual([]);
  });
});

describe('ruído que o contador pediu para tirar', () => {
  it('documento só depois de NF/recibo/boleto…; número solto não conta', () => {
    expect(chaveDocumento('NF 001670268')).toBe('nf 1670268');
    expect(chaveDocumento('Nota fiscal nº 4521')).toBe('nf 4521');
    expect(chaveDocumento('Cheque — NF 2668633')).toBe('nf 2668633');
    expect(chaveDocumento('recibo 123')).toBe('recibo 123');
    expect(chaveDocumento('aluguel sala 1203')).toBeNull();
    expect(chaveDocumento('UC 123456')).toBeNull();
    expect(chaveDocumento('REF 07/2026')).toBeNull();
  });
  it('mesmo documento a mais de 60 dias não alerta', () => {
    const a = l('2026-01-05', 'exp', 100, { complemento: 'NF 500' }); const b = l('2026-06-05', 'exp', 90, { complemento: 'NF 500' });
    expect(revisarLancamentos([a, b], contas, op).resumo.lancamentos).toBe(0);
  });
  it('transferências de valor redondo em dias próximos não são "repetidas"', () => {
    const a = l('2026-03-10', null, 500, { historico: 'Depósito em conta corrente' });
    const b = l('2026-03-12', null, 500, { historico: 'Depósito em conta corrente' });
    expect(revisarLancamentos([a, b], contas, op).resumo.lancamentos).toBe(0);
  });
  it('venda de balcão igual no mesmo dia (sem pagador nem complemento) é médio, não alto', () => {
    const ok = { ...contas[0] };
    const a = l('2026-03-10', 'atend', 30); const b = l('2026-03-10', 'atend', 30);
    const r = revisarLancamentos([a, b], [ok], op);
    expect(r.porLancamento[a.id].alertas[0]).toMatchObject({ codigo: 'quase_duplicado', nivel: 'medio' });
  });
  it('saldo negativo pelo fim do dia: pagar antes de receber no mesmo dia não alerta', () => {
    const pag = l('2026-03-10', 'luz', 500, { criadoEm: '2026-03-10T09:00:00Z' });
    const rec = l('2026-03-10', 'atend', 600, { criadoEm: '2026-03-10T10:00:00Z' });
    expect(revisarLancamentos([pag, rec], contas, { ...op, saldoInicial: 0 }).resumo.lancamentos).toBe(0);
  });
});

describe('alertas novos', () => {
  it('data futura (alto)', () => {
    const a = l('2026-05-02', 'luz', 100);
    const r = revisarLancamentos([a], contas, { ...op, hoje: '2026-04-20' });
    expect(r.porLancamento[a.id].alertas[0]).toMatchObject({ codigo: 'data_futura', nivel: 'alto' });
  });
  it('lançado ou alterado depois de o mês ser confirmado (alto)', () => {
    const antes = l('2026-03-10', 'luz', 100, { criadoEm: '2026-03-10T10:00:00Z' });
    const editado = l('2026-03-11', 'luz', 101, { criadoEm: '2026-03-11T10:00:00Z', atualizadoEm: '2026-04-05T10:00:00Z' });
    const novo = l('2026-03-12', 'luz', 102, { criadoEm: '2026-04-06T10:00:00Z' });
    const r = revisarLancamentos([antes, editado, novo], contas, { ...op, confirmados: [{ mes: 3, em: '2026-04-01T12:00:00+00:00' }] });
    expect(r.porLancamento[antes.id]).toBeUndefined();
    expect(codigos(r, editado.id)).toContain('alterado_apos_confirmar');
    expect(codigos(r, novo.id)).toContain('alterado_apos_confirmar');
  });
});

describe('risco e desempenho', () => {
  it('risco soma os níveis e o resumo conta', () => {
    const a = l('2026-03-10', 'atend', 0, { entrada: 0, saida: 500 });
    const b = l('2026-03-10', 'atend', 0, { entrada: 0, saida: 500 });
    const r = revisarLancamentos([a, b], contas, op);
    expect(r.porLancamento[a.id].risco).toBe(10); // duplicado (5) + natureza (5)
    expect(r.resumo).toMatchObject({ alto: 4, lancamentos: 2 });
  });
  it('5 mil lançamentos em bem menos de 1 s', () => {
    const muitos: LancamentoRevisao[] = [];
    for (let i = 0; i < 5000; i++) {
      const m = String(1 + (i % 12)).padStart(2, '0'); const d = String(1 + (i % 28)).padStart(2, '0');
      muitos.push(l(`2026-${m}-${d}`, i % 3 ? 'exp' : 'luz', 50 + (i % 400), { complemento: `NF ${i}` }));
    }
    const t = performance.now();
    revisarLancamentos(muitos, contas, { ...op, hoje: '2027-01-01' });
    expect(performance.now() - t).toBeLessThan(1000);
  });
});
