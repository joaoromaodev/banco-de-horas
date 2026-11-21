// Tabelas de INSS (empregado) e IRRF (mensal) — o ÚNICO lugar com esses números.
// Puro, sem I/O; testado em tests/tributos.test.ts.
//
// Para atualizar (todo janeiro e quando sair lei nova): acrescente um item no FIM da
// lista com `vigenciaDesde` e a `fonte`, sem apagar os anteriores — a rescisão escolhe a
// tabela pela data (INSS pela competência do desligamento; IRRF pela data do pagamento,
// regime de caixa). Depois rode `npm test`: os casos de tests/tributos.test.ts conferem
// as faixas da tabela vigente.
//
// Valores conferidos em 21/11/2026 com o subagente `contador`.

export interface FaixaInss {
  /** Limite superior da faixa (inclusive). A última faixa termina no teto. */
  ate: number;
  aliquota: number;
}

export interface TabelaInss {
  vigenciaDesde: string;
  faixas: FaixaInss[];
  /** Teto do salário de contribuição (= limite da última faixa). */
  teto: number;
  fonte: string;
}

export interface FaixaIrrf {
  /** Limite superior da base (inclusive); null = sem limite. */
  ate: number | null;
  aliquota: number;
  deduzir: number;
}

/** Redução do imposto da Lei 15.270/2025 (a partir de 2026), sobre o rendimento tributável BRUTO. */
export interface ReducaoIrrf {
  /** Até este rendimento a redução zera o imposto (até `maxima`). */
  isencaoAte: number;
  maxima: number;
  /** Entre `isencaoAte` e `ate`: redução = constante − fator × rendimento. */
  ate: number;
  constante: number;
  fator: number;
  fonte: string;
}

export interface TabelaIrrf {
  vigenciaDesde: string;
  faixas: FaixaIrrf[];
  dependente: number;
  /** Desconto simplificado mensal (substitui as deduções legais quando maior). */
  simplificado: number;
  reducao: ReducaoIrrf | null;
  fonte: string;
}

/** INSS do empregado, doméstico e avulso — progressivo por faixa (EC 103/2019 art. 28). */
export const TABELAS_INSS: TabelaInss[] = [
  {
    vigenciaDesde: '2025-01-01',
    faixas: [
      { ate: 1518.0, aliquota: 0.075 },
      { ate: 2793.88, aliquota: 0.09 },
      { ate: 4190.83, aliquota: 0.12 },
      { ate: 8157.41, aliquota: 0.14 },
    ],
    teto: 8157.41,
    fonte: 'Portaria Interministerial MPS/MF 6/2025',
  },
  {
    vigenciaDesde: '2026-01-01',
    faixas: [
      { ate: 1621.0, aliquota: 0.075 },
      { ate: 2902.84, aliquota: 0.09 },
      { ate: 4354.27, aliquota: 0.12 },
      { ate: 8475.55, aliquota: 0.14 },
    ],
    teto: 8475.55,
    fonte: 'Portaria Interministerial MPS/MF 13/2026',
  },
];

const FAIXAS_IRRF_2025: FaixaIrrf[] = [
  { ate: 2428.8, aliquota: 0, deduzir: 0 },
  { ate: 2826.65, aliquota: 0.075, deduzir: 182.16 },
  { ate: 3751.05, aliquota: 0.15, deduzir: 394.16 },
  { ate: 4664.68, aliquota: 0.225, deduzir: 675.49 },
  { ate: null, aliquota: 0.275, deduzir: 908.73 },
];

/** IRRF mensal (Lei 11.482/2007 art. 1º, valores da Lei 15.191/2025). */
export const TABELAS_IRRF: TabelaIrrf[] = [
  {
    vigenciaDesde: '2025-05-01',
    faixas: FAIXAS_IRRF_2025,
    dependente: 189.59,
    simplificado: 607.2,
    reducao: null,
    fonte: 'Lei 15.191/2025',
  },
  {
    vigenciaDesde: '2026-01-01',
    faixas: FAIXAS_IRRF_2025,
    dependente: 189.59,
    simplificado: 607.2,
    reducao: { isencaoAte: 5000, maxima: 312.89, ate: 7350, constante: 978.62, fator: 0.133145, fonte: 'Lei 15.270/2025' },
    fonte: 'Lei 15.191/2025; redução da Lei 15.270/2025',
  },
];

/** Tabela vigente na data (a mais recente com `vigenciaDesde` ≤ data). Antes da primeira, a primeira. */
function vigente<T extends { vigenciaDesde: string }>(lista: T[], data: string): { tabela: T; foraDaLista: boolean } {
  const ordenada = [...lista].sort((a, b) => a.vigenciaDesde.localeCompare(b.vigenciaDesde));
  let t = ordenada[0];
  for (const x of ordenada) if (x.vigenciaDesde <= data) t = x;
  // Data num ano depois da última tabela: provavelmente falta cadastrar a tabela nova.
  const ultima = ordenada[ordenada.length - 1];
  const foraDaLista = data < ordenada[0].vigenciaDesde || data.slice(0, 4) > ultima.vigenciaDesde.slice(0, 4);
  return { tabela: t, foraDaLista };
}

export const tabelaInssEm = (data: string) => vigente(TABELAS_INSS, data);
export const tabelaIrrfEm = (data: string) => vigente(TABELAS_IRRF, data);

// ------------------------------------------------------------------ cálculo

/** Centavos com meio para cima, sem o erro do ponto flutuante (24,195 → 24,20, não 24,19). */
export const centavos = (v: number) => Math.round(Number((v * 100).toPrecision(12))) / 100;
const pct = (a: number) => `${(a * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export interface ResultadoInss {
  base: number;
  /** Base limitada ao teto. */
  baseConsiderada: number;
  valor: number;
  /** Parcela de cada faixa alcançada (sem arredondar; o total é arredondado no fim). */
  parcelas: { de: number; ate: number; aliquota: number; valor: number }[];
  memoria: string;
}

/** INSS progressivo: cada faixa só sobre a parte do salário dentro dela; total arredondado no fim. */
export function calcularInss(base: number, tabela: TabelaInss): ResultadoInss {
  const b = Math.max(0, centavos(base));
  const considerada = Math.min(b, tabela.teto);
  const parcelas: ResultadoInss['parcelas'] = [];
  let anterior = 0;
  for (const f of tabela.faixas) {
    if (considerada <= anterior) break;
    const topo = Math.min(considerada, f.ate);
    parcelas.push({ de: anterior, ate: topo, aliquota: f.aliquota, valor: (topo - anterior) * f.aliquota });
    anterior = f.ate;
  }
  const valor = centavos(parcelas.reduce((s, p) => s + p.valor, 0));
  const memoria = b === 0 ? 'Sem base' : `${parcelas.map((p) => `${pct(p.aliquota)} × ${reais(centavos(p.ate - p.de))}`).join(' + ')}`
    + `${b > tabela.teto ? ` (base ${reais(b)} limitada ao teto de ${reais(tabela.teto)})` : ''}`;
  return { base: b, baseConsiderada: considerada, valor, parcelas, memoria };
}

export interface EntradaIrrf {
  /** Rendimento tributável bruto (sem as verbas isentas). */
  rendimentos: number;
  /** INSS retido sobre esse rendimento. */
  inss: number;
  dependentes?: number;
  /** Pode trocar as deduções legais pelo desconto simplificado quando for maior. */
  permitirSimplificado?: boolean;
  /** Aplica a redução da Lei 15.270 (quando a tabela tiver). */
  aplicarReducao?: boolean;
}

export interface ResultadoIrrf {
  rendimentos: number;
  deducaoLegal: number;
  deducaoUsada: 'legal' | 'simplificado';
  deducao: number;
  base: number;
  faixa: FaixaIrrf;
  impostoTabela: number;
  reducao: number;
  valor: number;
  memoria: string;
}

/** IRRF pela tabela mensal: base = rendimento − (INSS + dependentes) ou − simplificado; − redução. */
export function calcularIrrf(en: EntradaIrrf, tabela: TabelaIrrf): ResultadoIrrf {
  const rend = Math.max(0, centavos(en.rendimentos));
  const dep = Math.max(0, Math.floor(en.dependentes ?? 0));
  const deducaoLegal = centavos(Math.max(0, en.inss) + dep * tabela.dependente);
  const usaSimplificado = Boolean(en.permitirSimplificado) && tabela.simplificado > deducaoLegal;
  const deducao = usaSimplificado ? tabela.simplificado : deducaoLegal;
  const base = Math.max(0, centavos(rend - deducao));
  const faixa = tabela.faixas.find((f) => f.ate === null || base <= f.ate) ?? tabela.faixas[tabela.faixas.length - 1];
  const impostoTabela = Math.max(0, centavos(base * faixa.aliquota - faixa.deduzir));
  let reducao = 0;
  const r = tabela.reducao;
  if (r && en.aplicarReducao !== false && impostoTabela > 0) {
    if (rend <= r.isencaoAte) reducao = Math.min(r.maxima, impostoTabela);
    else if (rend <= r.ate) reducao = Math.min(impostoTabela, Math.max(0, centavos(r.constante - r.fator * rend)));
  }
  const valor = centavos(impostoTabela - reducao);

  const ded = usaSimplificado
    ? `desconto simplificado ${reais(tabela.simplificado)} (maior que INSS${dep ? ' + dependentes' : ''} ${reais(deducaoLegal)})`
    : dep ? `(INSS ${reais(centavos(en.inss))} + ${dep} dependente${dep > 1 ? 's' : ''} × ${reais(tabela.dependente)})` : `INSS ${reais(centavos(en.inss))}`;
  const partes = [`Rendimento ${reais(rend)} − ${ded} = base ${reais(base)}`];
  partes.push(faixa.aliquota === 0 ? 'faixa isenta' : `${pct(faixa.aliquota)} − ${reais(faixa.deduzir)} = ${reais(impostoTabela)}`);
  if (reducao > 0 && r) {
    partes.push(rend <= r.isencaoAte
      ? `− redução ${reais(reducao)} (rendimento até ${reais(r.isencaoAte)}, ${r.fonte})`
      : `− redução ${reais(reducao)} (${reais(r.constante)} − ${String(r.fator).replace('.', ',')} × ${reais(rend)}, ${r.fonte})`);
  } else if (r && en.aplicarReducao === false && impostoTabela > 0 && rend <= r.ate) {
    partes.push(`sem a redução da ${r.fonte} (desligada na simulação)`);
  }
  return { rendimentos: rend, deducaoLegal, deducaoUsada: usaSimplificado ? 'simplificado' : 'legal', deducao, base, faixa, impostoTabela, reducao, valor, memoria: partes.join('; ') };
}
