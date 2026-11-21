import { describe, expect, it } from 'vitest';
import { geometria, LARGURA_PADRAO, mostraMes } from '@/app/(app)/caixa/resumo/geometria';

// O gráfico do resumo do caixa é desenhado na largura medida (pixels reais), para o
// texto do eixo não encolher junto com o SVG (QA visual: rótulos de ~5 a 9 px).
describe('geometria dos gráficos do resumo', () => {
  it('desenha na largura real: a fonte é a da tela, nunca menor que 12 px', () => {
    for (const largura of [300, 343, 420, 560, 720, 1100]) {
      const g = geometria(largura);
      expect(g.W).toBe(largura);
      expect(g.fonte).toBeGreaterThanOrEqual(12);
    }
  });
  it('sem medição ainda, usa a largura padrão; nunca abaixo de 260', () => {
    expect(geometria(0).W).toBe(LARGURA_PADRAO);
    expect(geometria(120).W).toBe(260);
  });
  it('no celular os meses aparecem um sim, um não; no desktop, todos', () => {
    expect(geometria(343).passoMes).toBe(2);
    expect(geometria(560).passoMes).toBe(1);
    const visiveis = (passo: 1 | 2) => Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => mostraMes(m, passo));
    expect(visiveis(2)).toEqual([1, 3, 5, 7, 9, 11]);
    expect(visiveis(1)).toHaveLength(12);
  });
  it('cada rótulo de mês visível tem espaço para ~3 letras em 12 px', () => {
    for (const largura of [300, 343, 420, 560, 720]) {
      const g = geometria(largura);
      expect(((g.W - g.L - g.R) / 12) * g.passoMes).toBeGreaterThanOrEqual(30);
    }
  });
});
