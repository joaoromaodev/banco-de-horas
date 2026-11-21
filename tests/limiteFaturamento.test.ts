import { describe, expect, it } from 'vitest';
import {
  AVISO_ESTIMATIVA, calcularLimite, mesesInclusive, nivelDoPercentual, receitaPorMes, regimeComLimite, somarMeses,
  vigenciaEm, VIGENCIAS,
} from '@/lib/limiteFaturamento';

/** Distribui `total` igualmente nos meses de `de` a `ate` (AAAA-MM). */
function uniforme(de: string, ate: string, total: number): Record<string, number> {
  const n = mesesInclusive(de, ate);
  const r: Record<string, number> = {};
  for (let m = de; m <= ate; m = somarMeses(m, 1)) r[m] = total / n;
  return r;
}

describe('utilidades de mês', () => {
  it('soma meses atravessando o ano', () => {
    expect(somarMeses('2026-11', 3)).toBe('2027-02');
    expect(somarMeses('2026-01', -1)).toBe('2025-12');
    expect(somarMeses('2026-11', -11)).toBe('2025-12');
  });
  it('conta meses inclusive', () => {
    expect(mesesInclusive('2026-01', '2026-01')).toBe(1);
    expect(mesesInclusive('2025-12', '2026-11')).toBe(12);
  });
});

describe('nivelDoPercentual', () => {
  it('80% · 100% · 120%', () => {
    expect(nivelDoPercentual(0.79)).toBe('ok');
    expect(nivelDoPercentual(0.8)).toBe('atencao');
    expect(nivelDoPercentual(1)).toBe('atencao'); // chegar no limite não é passar dele
    expect(nivelDoPercentual(1.01)).toBe('excedido');
    expect(nivelDoPercentual(1.2)).toBe('excedido');
    expect(nivelDoPercentual(1.21)).toBe('retroativo');
  });
});

describe('vigência', () => {
  it('usa a vigência mais recente que já começou', () => {
    expect(vigenciaEm('2026-11-21').mei.limiteAnual).toBe(81_000);
    expect(vigenciaEm('2026-11-21').simples.sublimite).toBe(3_600_000);
  });
  it('antes da primeira vigência cai na primeira (nunca indefinido)', () => {
    expect(vigenciaEm('2000-01-01')).toBe(VIGENCIAS[0]);
  });
  it('a lei nova entra como vigência nova e vale só dali em diante', () => {
    const nova = { ...VIGENCIAS[0], desde: '2099-01-01', mei: { ...VIGENCIAS[0].mei, limiteAnual: 130_000 } };
    VIGENCIAS.push(nova);
    try {
      expect(vigenciaEm('2098-12-31').mei.limiteAnual).toBe(140_000); // a de 2028 ainda é a vigente
      expect(vigenciaEm('2099-01-01').mei.limiteAnual).toBe(130_000);
    } finally { VIGENCIAS.pop(); }
  });
});

describe('MEI', () => {
  const base = { regime: 'mei' as const, hoje: '2026-11-21', abertura: '2020-03-10', primeiroMesDados: '2026-01' };

  it('abaixo de 80%: ok, com o aviso de estimativa', () => {
    const a = calcularLimite({ ...base, receitaPorMes: uniforme('2026-01', '2026-11', 40_000) });
    expect(a.nivel).toBe('ok');
    expect(a.medidas[0].limite).toBe(81_000);
    expect(a.medidas[0].mensagem).toMatch(/Estimativa pelo caixa/);
    expect(a.aviso).toBe(AVISO_ESTIMATIVA);
  });

  it('entre 80% e 100%: atenção', () => {
    const a = calcularLimite({ ...base, receitaPorMes: uniforme('2026-01', '2026-11', 70_000) });
    expect(a.nivel).toBe('atencao');
  });

  it('acima de 100% e até 120%: excedido (DAS sobre o excesso, não retroativo)', () => {
    const a = calcularLimite({ ...base, receitaPorMes: uniforme('2026-01', '2026-11', 90_000) });
    expect(a.nivel).toBe('excedido');
    expect(a.medidas[0].mensagem).toMatch(/20% de tolerância/);
  });

  it('acima de 120% (R$ 97.200): desenquadramento retroativo', () => {
    const a = calcularLimite({ ...base, receitaPorMes: uniforme('2026-01', '2026-11', 100_000) });
    expect(a.nivel).toBe('retroativo');
    expect(a.medidas[0].mensagem).toMatch(/desde 1º de janeiro/);
  });

  it('exatamente R$ 97.200,00 ainda não é retroativo; 97.200,01 é', () => {
    expect(calcularLimite({ ...base, receitaPorMes: { '2026-05': 97_200 } }).nivel).toBe('excedido');
    expect(calcularLimite({ ...base, receitaPorMes: { '2026-05': 97_200.01 } }).nivel).toBe('retroativo');
  });

  it('só conta o ano-calendário: receita do ano passado não entra', () => {
    const a = calcularLimite({ ...base, receitaPorMes: { '2025-12': 80_000, '2026-02': 1_000 } });
    expect(a.medidas[0].valor).toBe(1_000);
    expect(a.nivel).toBe('ok');
  });

  it('1º ano: limite proporcional R$ 6.750 × meses (mês de abertura conta inteiro)', () => {
    // aberta em 15/08: ago..dez = 5 meses → 33.750
    const a = calcularLimite({ ...base, abertura: '2026-08-15', primeiroMesDados: '2026-08', receitaPorMes: { '2026-08': 20_000, '2026-09': 20_000 } });
    expect(a.medidas[0].limite).toBe(33_750);
    expect(a.medidas[0].percentual).toBeCloseTo(40_000 / 33_750);
    expect(a.nivel).toBe('excedido');
    expect(a.observacoes.join(' ')).toMatch(/proporcional/);
  });

  it('aberta em janeiro: 12 meses = 81.000', () => {
    const a = calcularLimite({ ...base, abertura: '2026-01-02', receitaPorMes: {} });
    expect(a.medidas[0].limite).toBe(81_000);
  });

  it('sem data de abertura: usa 81.000 e avisa que pode ser proporcional', () => {
    const a = calcularLimite({ ...base, abertura: null, receitaPorMes: { '2026-03': 10 } });
    expect(a.medidas[0].limite).toBe(81_000);
    expect(a.observacoes.join(' ')).toMatch(/abertura não informada/i);
  });

  it('caixa começou depois de janeiro: marca como incompleto', () => {
    const a = calcularLimite({ ...base, primeiroMesDados: '2026-06', receitaPorMes: { '2026-07': 5_000 } });
    expect(a.incompleto).toBe(true);
    expect(a.observacoes.join(' ')).toMatch(/06\/2026/);
  });

  it('projeção do ano só informa, não muda o nível', () => {
    const a = calcularLimite({ ...base, receitaPorMes: uniforme('2026-01', '2026-11', 22_000) });
    expect(a.nivel).toBe('ok');
    expect(a.observacoes.join(' ')).toMatch(/ritmo atual/);
  });
});

describe('Simples Nacional', () => {
  const base = { regime: 'simples' as const, hoje: '2026-11-21', abertura: '2015-01-01', primeiroMesDados: '2025-01' };
  const medida = (a: ReturnType<typeof calcularLimite>, chave: string) => a.medidas.find((m) => m.chave === chave)!;
  const ano = (total: number) => uniforme('2026-01', '2026-11', total);

  it('limite e sublimite usam o ano-calendário (jan até o mês corrente), não a janela móvel', () => {
    const a = calcularLimite({ ...base, receitaPorMes: { '2025-12': 999_999, '2026-01': 100, '2026-11': 50 } });
    expect(medida(a, 'simples_limite').valor).toBe(150); // dezembro/25 fica de fora
    expect(medida(a, 'simples_sublimite').valor).toBe(150);
  });

  it('a faixa usa os 12 meses terminando no mês corrente (aproxima a RBT12)', () => {
    const a = calcularLimite({ ...base, receitaPorMes: { '2025-10': 999, '2025-12': 100, '2026-11': 50 } });
    expect(medida(a, 'simples_faixa').valor).toBe(150); // out/25 fora da janela
  });

  it('faixa atual pela receita de 12 meses e troca de faixa perto do teto', () => {
    const f = (total: number) => medida(calcularLimite({ ...base, receitaPorMes: uniforme('2025-12', '2026-11', total) }), 'simples_faixa');
    expect(f(100_000).rotulo).toMatch(/Faixa 1/);
    expect(f(100_000).nivel).toBe('ok');
    expect(f(170_000).nivel).toBe('atencao');
    expect(f(170_000).mensagem).toMatch(/faixa 2/);
    expect(f(200_000).rotulo).toMatch(/Faixa 2/);
  });

  it('faixa mais alta não tem "próxima": a medida some', () => {
    const a = calcularLimite({ ...base, receitaPorMes: uniforme('2025-12', '2026-11', 4_000_000) });
    expect(a.medidas.find((m) => m.chave === 'simples_faixa')).toBeUndefined();
  });

  it('sublimite de R$ 3,6 mi: 80%, 100% e 120% (R$ 4,32 mi)', () => {
    const f = (total: number) => medida(calcularLimite({ ...base, receitaPorMes: ano(total) }), 'simples_sublimite');
    expect(f(2_800_000).nivel).toBe('ok');
    expect(f(2_900_000).nivel).toBe('atencao');
    expect(f(3_700_000).nivel).toBe('excedido');
    expect(f(4_400_000).nivel).toBe('retroativo');
  });

  it('limite geral de R$ 4,8 mi e o pior nível vai para o alerta', () => {
    const a = calcularLimite({ ...base, receitaPorMes: ano(5_000_000) });
    expect(medida(a, 'simples_limite').nivel).toBe('excedido');
    expect(medida(a, 'simples_sublimite').nivel).toBe('retroativo');
    expect(a.nivel).toBe('retroativo');
  });

  it('acima de 20% em empresa antiga: exclusão no mês seguinte, NÃO retroativa ao início do ano', () => {
    const a = calcularLimite({ ...base, receitaPorMes: ano(6_000_000) });
    const m = medida(a, 'simples_limite');
    expect(m.nivel).toBe('retroativo');
    expect(m.mensagem).toMatch(/a partir do mês seguinte ao excesso/);
    expect(m.mensagem).not.toMatch(/início do ano/);
  });

  it('até 20%: efeito só em 1º de janeiro do ano seguinte', () => {
    const m = medida(calcularLimite({ ...base, receitaPorMes: ano(5_000_000) }), 'simples_limite');
    expect(m.mensagem).toMatch(/1º de janeiro do ano seguinte/);
  });

  it('empresa com menos de 12 meses: a faixa usa a média × 12', () => {
    const a = calcularLimite({ ...base, abertura: '2025-12-05', receitaPorMes: uniforme('2025-12', '2026-11', 1_200_000) });
    expect(medida(a, 'simples_faixa').valor).toBe(1_200_000); // 12 meses completos: igual à soma
    // jan/2027, aberta em 05/2026: 9 meses de atividade (mai–jan), R$ 900 mil → média 100 mil × 12
    const nova = calcularLimite({ ...base, hoje: '2027-01-15', abertura: '2026-05-10', primeiroMesDados: '2026-05', receitaPorMes: uniforme('2026-05', '2027-01', 900_000) });
    expect(medida(nova, 'simples_faixa').valor).toBe(1_200_000);
    expect(nova.observacoes.join(' ')).toMatch(/média de 9 meses/);
  });

  it('ano de início de atividade: R$ 400 mil × meses, e acima de 20% retroage ao início da atividade', () => {
    // aberta em 03/2026: mar..dez = 10 meses → limite 4.000.000, sublimite 3.000.000
    const a = calcularLimite({ ...base, abertura: '2026-03-01', primeiroMesDados: '2026-03', receitaPorMes: uniforme('2026-03', '2026-11', 3_300_000) });
    expect(medida(a, 'simples_limite').limite).toBe(4_000_000);
    expect(medida(a, 'simples_sublimite').limite).toBe(3_000_000);
    expect(medida(a, 'simples_sublimite').nivel).toBe('excedido');
    const retro = medida(calcularLimite({ ...base, abertura: '2026-03-01', primeiroMesDados: '2026-03', receitaPorMes: uniforme('2026-03', '2026-11', 3_700_000) }), 'simples_sublimite');
    expect(retro.nivel).toBe('retroativo');
    expect(retro.mensagem).toMatch(/desde o início da atividade/);
  });

  it('caixa que começou depois de janeiro: incompleto, e diz desde quando', () => {
    const a = calcularLimite({ ...base, primeiroMesDados: '2026-03', receitaPorMes: { '2026-04': 10 } });
    expect(a.incompleto).toBe(true);
    expect(a.observacoes.join(' ')).toMatch(/03\/2026/);
  });

  it('caixa desde janeiro do ano: não é incompleto para limite/sublimite (a faixa só vira ressalva)', () => {
    const a = calcularLimite({ ...base, primeiroMesDados: '2026-01', receitaPorMes: { '2026-02': 10 } });
    expect(a.incompleto).toBe(false);
    expect(a.observacoes.join(' ')).toMatch(/faixa pode estar subestimada/);
  });
});

describe('LC 238/2026 (vigências do MEI)', () => {
  it('2026 segue R$ 81 mil; 2027 e 2028 sobem (valores a conferir no texto final)', () => {
    expect(vigenciaEm('2026-12-31').mei.limiteAnual).toBe(81_000);
    expect(vigenciaEm('2027-01-01').mei.limiteAnual).toBe(110_000);
    expect(vigenciaEm('2028-06-01').mei.limiteAnual).toBe(140_000);
    expect(vigenciaEm('2027-06-01').mei.limiteMensalNoAnoDeAbertura).toBeCloseTo(9_166.67, 2);
  });
  it('o alerta de 2027 compara com R$ 110 mil e o Simples não muda', () => {
    const a = calcularLimite({ regime: 'mei', hoje: '2027-05-10', abertura: '2020-01-01', primeiroMesDados: '2026-01', receitaPorMes: { '2027-02': 90_000 } });
    expect(a.medidas[0].limite).toBe(110_000);
    expect(a.nivel).toBe('atencao');
    expect(vigenciaEm('2027-05-10').simples.sublimite).toBe(3_600_000);
  });
});

describe('texto: nunca conclui sozinho', () => {
  it('toda mensagem de toda medida de todo nível fala em estimativa', () => {
    const totais = [0, 70_000, 90_000, 120_000];
    for (const regime of ['mei', 'simples'] as const) {
      for (const t of totais) {
        const a = calcularLimite({ regime, hoje: '2026-11-21', abertura: '2015-01-01', primeiroMesDados: '2025-01', receitaPorMes: uniforme('2025-12', '2026-11', regime === 'mei' ? t : t * 40) });
        for (const m of a.medidas) expect(m.mensagem).toMatch(/Estimativa pelo caixa/);
        expect(a.aviso).toMatch(/confirme/i);
      }
    }
  });
});

describe('regimeComLimite e receitaPorMes', () => {
  it('só MEI e Simples têm limite aqui', () => {
    expect(regimeComLimite('mei')).toBe('mei');
    expect(regimeComLimite('simples')).toBe('simples');
    expect(regimeComLimite('presumido')).toBeNull();
    expect(regimeComLimite('pessoa_fisica')).toBeNull();
    expect(regimeComLimite(null)).toBeNull();
  });
  it('agrupa por mês, ignora data ruim e valor não positivo', () => {
    expect(receitaPorMes([
      { data: '2026-01-05', valor: 10.1 }, { data: '2026-01-20', valor: 0.2 },
      { data: '2026-02-01', valor: 5 }, { data: 'x', valor: 9 }, { data: '2026-02-02', valor: 0 }, { data: '2026-02-03', valor: -3 },
    ])).toEqual({ '2026-01': 10.3, '2026-02': 5 });
  });
});
