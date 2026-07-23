// Formatação compartilhada pelas telas do Livro Caixa.
//
// Fica fora de lib/caixa.ts de propósito: aquele módulo é só de servidor (abre o
// cliente do Postgres) e isto roda no navegador.

export const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export const MESES_LONGOS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/** Sempre com duas casas, como no livro: 1234.5 → "1.234,50". */
export const dinheiro = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Versão curta para eixo de gráfico: 12500 → "12,5 mil". */
export const dinheiroCurto = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${(n / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
};

/** "2026-07-14" → "14/07" */
export const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
