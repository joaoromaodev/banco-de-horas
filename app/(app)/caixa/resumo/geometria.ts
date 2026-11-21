// Geometria dos gráficos do resumo do caixa, em PIXELS de verdade.
//
// Antes o SVG tinha viewBox fixo de 720 × 200 e escalava para caber: numa coluna de
// ~400 px (desktop com dois gráficos lado a lado) o texto de 10 unidades virava ~5 px,
// e no celular menos ainda. Agora o desenho é feito na largura medida do contêiner,
// então o tamanho da fonte é o que aparece na tela.

/** Largura usada antes da primeira medição (e no servidor). */
export const LARGURA_PADRAO = 720;

export type Passo = 1 | 2 | 3;

export interface Geometria {
  W: number; H: number;
  /** Margens: esquerda (rótulos do eixo Y), direita, topo, base (meses). */
  L: number; R: number; T: number; B: number;
  /** Fonte do eixo e dos meses, em px. */
  fonte: number;
  /** Fonte do rótulo direto (último saldo), em px. */
  fonteDestaque: number;
  /** De quantos em quantos meses o rótulo aparece (1 = todos; 2 = jan, mar, mai…; 3 só em tela muito estreita). */
  passoMes: Passo;
}

/** O menor passo (1, 2 ou 3) que dá a cada rótulo visível ao menos `minFaixa` px. */
function passoPara(faixa: number, minFaixa: number): Passo {
  if (faixa >= minFaixa) return 1;
  return faixa * 2 >= minFaixa ? 2 : 3;
}

/**
 * `meses`: quantas faixas o eixo X tem (o resumo tem sempre 12; o demonstrativo, os
 * últimos meses liberados). `minFaixa`: largura mínima, em px, de cada mês para
 * mostrar todos os rótulos — mais larga quando o rótulo leva o ano ("jan/26").
 */
export function geometria(largura: number, opcoes: { meses?: number; minFaixa?: number } = {}): Geometria {
  const W = Math.max(260, Math.round(largura || LARGURA_PADRAO));
  const estreito = W < 480;
  const fonte = 12;
  const L = 64, R = 12, T = 16, B = 28;
  // Cada rótulo de mês ("fev") tem ~22 px em 12 px; abaixo de ~30 px por mês, um sim, um não.
  const meses = Math.max(1, Math.round(opcoes.meses ?? 12));
  const faixa = (W - L - R) / meses;
  return {
    W, H: estreito ? 190 : 220, L, R, T, B,
    fonte, fonteDestaque: 13,
    passoMes: passoPara(faixa, opcoes.minFaixa ?? 30),
  };
}

/** O rótulo do mês (1–12) aparece? (O mês em foco já vem nomeado na dica.) */
export const mostraMes = (mes: number, passo: Passo) => (mes - 1) % passo === 0;

/**
 * Numa série que não começa em janeiro (o demonstrativo), alterna a partir do FIM:
 * o último mês — o do demonstrativo — sempre tem rótulo. `i` é a posição na série.
 */
export const mostraPosicao = (i: number, total: number, passo: Passo) => (total - 1 - i) % passo === 0;
