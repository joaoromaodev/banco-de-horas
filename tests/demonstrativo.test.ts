import { describe, expect, it } from 'vitest';
import {
  emailDoDemonstrativo, liberadoAte, maioresSaidas, mesLiberado, montarDemonstrativo, textoVariacao, variacao,
  type MesDaSerie,
} from '@/lib/demonstrativo';

const m = (ano: number, mes: number, entradas: number, saidas: number, saldoFinal = 0): MesDaSerie => ({ ano, mes, entradas, saidas, saldoFinal });

describe('mesLiberado / liberadoAte', () => {
  it('só em sequência desde janeiro', () => {
    expect(mesLiberado([1, 2, 3], 3)).toBe(true);
    expect(mesLiberado([1, 2, 4], 4)).toBe(false); // abril confirmado, março não
    expect(mesLiberado([2, 3], 2)).toBe(false); // sem janeiro
    expect(mesLiberado([], 1)).toBe(false);
    expect(mesLiberado([1], 13)).toBe(false);
    expect(mesLiberado([1], 0)).toBe(false);
  });
  it('liberadoAte acompanha o prefixo', () => {
    expect(liberadoAte([1, 2, 4])).toBe(2);
    expect(liberadoAte([])).toBe(0);
    expect(liberadoAte([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])).toBe(12);
  });
});

describe('variação', () => {
  it('base zero não vira infinito', () => {
    expect(variacao(10, 0)).toBeNull();
    expect(variacao(110, 100)).toBeCloseTo(0.1);
    expect(textoVariacao(null)).toMatch(/sem base/);
    expect(textoVariacao(0.124)).toBe('+12%');
    expect(textoVariacao(-0.08)).toBe('−8%');
    expect(textoVariacao(0.001)).toBe('igual');
  });
});

describe('maioresSaidas', () => {
  it('agrupa por conta, ordena, corta em 5 e junta o resto', () => {
    const r = maioresSaidas([
      { conta: 'Aluguel', valor: 1000 }, { conta: 'Luz', valor: 100 }, { conta: 'Luz', valor: 50 },
      { conta: 'Água', valor: 20 }, { conta: 'Telefone', valor: 80 }, { conta: 'Material', valor: 60 },
      { conta: 'Limpeza', valor: 30 }, { conta: 'Café', valor: 10 }, { conta: 'Zero', valor: 0 },
    ]);
    expect(r.map((x) => x.conta)).toEqual(['Aluguel', 'Luz', 'Telefone', 'Material', 'Limpeza', 'Outras contas']);
    expect(r[1].valor).toBe(150);
    expect(r[5].valor).toBe(30); // Água 20 + Café 10
  });
  it('até 5 contas: sem "Outras contas"', () => {
    expect(maioresSaidas([{ conta: 'A', valor: 1 }, { conta: 'B', valor: 2 }]).map((x) => x.conta)).toEqual(['B', 'A']);
  });
  it('centavos não acumulam erro de ponto flutuante', () => {
    expect(maioresSaidas([{ conta: 'A', valor: 0.1 }, { conta: 'A', valor: 0.2 }])[0].valor).toBe(0.3);
  });
});

describe('montarDemonstrativo', () => {
  const serie = [m(2026, 1, 1000, 600, 400), m(2026, 2, 1200, 700, 900), m(2026, 3, 1500, 900, 1500)];

  it('resultado, anterior e média só com meses visíveis', () => {
    const d = montarDemonstrativo({ ano: 2026, mes: 3, serie, saidasPorConta: [{ conta: 'Luz', valor: 900 }] })!;
    expect(d.entradas).toBe(1500);
    expect(d.resultado).toBe(600);
    expect(d.saldoFinal).toBe(1500);
    expect(d.anterior).toMatchObject({ ano: 2026, mes: 2, entradas: 1200, saidas: 700 });
    expect(d.anterior!.variacaoEntradas).toBeCloseTo(0.25);
    expect(d.media).toMatchObject({ meses: 2, entradas: 1100, saidas: 650 });
    expect(d.media!.variacaoSaidas).toBeCloseTo(900 / 650 - 1);
  });

  it('janeiro compara com dezembro do ano anterior quando ele é visível', () => {
    const s = [m(2025, 12, 800, 500, 300), m(2026, 1, 1000, 600, 700)];
    const d = montarDemonstrativo({ ano: 2026, mes: 1, serie: s, saidasPorConta: [] })!;
    expect(d.anterior).toMatchObject({ ano: 2025, mes: 12 });
  });

  it('mês anterior fora da série (não confirmado) = sem comparação, nunca inventa', () => {
    const s = [m(2026, 1, 1000, 600), m(2026, 3, 1500, 900)]; // fevereiro faltando
    const d = montarDemonstrativo({ ano: 2026, mes: 3, serie: s, saidasPorConta: [] })!;
    expect(d.anterior).toBeNull();
    expect(d.media).toBeNull(); // só 1 mês antes: abaixo do mínimo
  });

  it('média usa no máximo os 12 meses anteriores', () => {
    const s: MesDaSerie[] = [];
    for (let i = 1; i <= 12; i++) s.push(m(2025, i, 100 * i, 50, 0));
    s.push(m(2026, 1, 5000, 50, 0), m(2026, 2, 5000, 50, 0));
    const d = montarDemonstrativo({ ano: 2026, mes: 2, serie: s, saidasPorConta: [] })!;
    // 12 anteriores a fev/26: fev/25 a jan/26 → fev–dez de 2025 (11 meses) + jan/26
    expect(d.media!.meses).toBe(12);
    expect(d.media!.entradas).toBeCloseTo((200 + 300 + 400 + 500 + 600 + 700 + 800 + 900 + 1000 + 1100 + 1200 + 5000) / 12, 1);
    expect(d.serie).toHaveLength(12);
    expect(d.serie[d.serie.length - 1]).toMatchObject({ ano: 2026, mes: 2 });
  });

  it('o mês pedido tem que estar na série visível', () => {
    expect(montarDemonstrativo({ ano: 2026, mes: 4, serie, saidasPorConta: [] })).toBeNull();
  });

  it('não compara com meses posteriores', () => {
    const d = montarDemonstrativo({ ano: 2026, mes: 2, serie, saidasPorConta: [] })!;
    expect(d.anterior!.mes).toBe(1);
    expect(d.media).toBeNull();
  });

  it('base zero: variação nula', () => {
    const d = montarDemonstrativo({ ano: 2026, mes: 2, serie: [m(2026, 1, 0, 0), m(2026, 2, 100, 10)], saidasPorConta: [] })!;
    expect(d.anterior!.variacaoEntradas).toBeNull();
  });
});

describe('emailDoDemonstrativo', () => {
  const d = montarDemonstrativo({
    ano: 2026, mes: 2, serie: [m(2026, 1, 1000, 600, 400), m(2026, 2, 1200, 700, 900)],
    saidasPorConta: [{ conta: 'Aluguel <b>', valor: 700 }],
    pendencias: [{ titulo: 'Extrato "fev"', prazo: '2026-03-10' }],
    obrigacoes: [{ nome: 'DAS', competencia: '2026-02', vencimento: '2026-03-20', atrasada: false }],
  })!;
  const e = emailDoDemonstrativo(d, { empresa: 'Padaria & Cia', escritorio: 'Escritório X', url: 'https://x.test/caixa/demonstrativo' });

  it('usa "Demonstrativo de caixa", nunca DRE', () => {
    expect(e.assunto).toBe('Demonstrativo de caixa de fevereiro de 2026 — Padaria & Cia');
    expect(`${e.assunto}${e.texto}${e.html}`).not.toMatch(/\bDRE\b/);
  });
  it('escapa HTML de dados do cliente', () => {
    expect(e.html).toContain('Padaria &amp; Cia');
    expect(e.html).toContain('Aluguel &lt;b&gt;');
    expect(e.html).toContain('Extrato &quot;fev&quot;');
    expect(e.html).not.toContain('<b>');
  });
  it('traz valores, comparação e links', () => {
    expect(e.texto).toContain('R$ 1.200,00');
    expect(e.texto).toContain('Mês anterior (01/2026)');
    expect(e.texto).toContain('10/03/2026');
    expect(e.texto).toContain('https://x.test/caixa/demonstrativo');
  });
});
