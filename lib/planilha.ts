// Gera o .xlsx "LEVANTAMENTO DE HORAS" — mesma estrutura/fórmulas do modelo
// original (sistema de datas 1904, E/H/J/K por fórmula, coluna "a cumprir" por
// calendário), com um acabamento visual azul-marinho mais apresentável.
import ExcelJS from 'exceljs';
import { Frequencia } from './tipos';
import { horaParaFracaoDia } from './tempo';
import {
  MESES, DIAS_SEMANA, diasNoMes, diaSemana, tipoDoDia, minutosACumprirDia,
  ehDiaDeTrabalho, Jornada, JORNADA_PADRAO,
} from './calendario';

// Paleta
const NAVY = 'FF17365D';       // azul-marinho (faixa principal e cabeçalhos)
const NAVY_SOFT = 'FF2E5B8A';  // faixa de grupos / rótulos
const LABEL_BG = 'FFEDF2F8';   // fundo dos rótulos NOME/PERÍODO
const ZEBRA = 'FFF4F8FC';      // listra alternada das linhas
const WEEKEND = 'FFE3EAF3';    // fim de semana / feriado (folga)
const WHITE = 'FFFFFFFF';
const INK = 'FF1F2937';        // texto escuro
const MUTED = 'FF6B7280';      // texto suave
const GREEN = 'FF15803D';      // saldo positivo
const RED = 'FFB91C1C';        // saldo negativo

const NUMFMT = '[h]:mm';
const SALDO_FMT = '[h]:mm;[Red]-[h]:mm';

const gridB = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } };
const border = { top: gridB, left: gridB, bottom: gridB, right: gridB };

const LARGURAS: Record<string, number> = {
  A: 6.5, B: 19.7, C: 13.4, D: 14.4, E: 14.9, F: 13.6, G: 14, H: 12.4, I: 15.2, J: 15.6, K: 15.6, L: 15.7,
};

type FormulaVal = { formula: string };
interface Opts {
  font?: Partial<ExcelJS.Font>;
  fill?: string;
  align?: 'left' | 'center' | 'right';
  fmt?: string;
  wrap?: boolean;
}

function paint(ws: ExcelJS.Worksheet, ref: string, value: string | number | FormulaVal, o: Opts = {}) {
  const c = ws.getCell(ref);
  c.value = value as ExcelJS.CellValue;
  c.font = { name: 'Arial', size: 9, color: { argb: INK }, ...o.font };
  if (o.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
  c.border = border;
  c.alignment = { horizontal: o.align ?? 'center', vertical: 'middle', wrapText: o.wrap };
  if (o.fmt) c.numFmt = o.fmt;
  return c;
}

export function gerarPlanilha(
  freq: Frequencia,
  feriados: Set<string>,
  jornada: Jornada = JORNADA_PADRAO,
  nomeEmpresa = '',
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.properties.date1904 = true; // permite exibir saldo negativo

  const ws = wb.addWorksheet(MESES[freq.mes], { views: [{ showGridLines: false }] });
  for (const [c, w] of Object.entries(LARGURAS)) ws.getColumn(c).width = w;

  const porDia = new Map(freq.dias.map((d) => [d.dia, d]));
  const N = diasNoMes(freq.ano, freq.mes);

  // --- Faixa de título: empresa + tipo de documento ---
  ws.mergeCells('A1:L1');
  paint(ws, 'A1', (nomeEmpresa || '').toUpperCase(),
    { font: { size: 15, bold: true, color: { argb: WHITE } }, fill: NAVY });
  ws.getRow(1).height = 30;

  ws.mergeCells('A2:L2');
  paint(ws, 'A2', 'LEVANTAMENTO DE HORAS',
    { font: { size: 10, bold: true, color: { argb: WHITE } }, fill: NAVY_SOFT });
  ws.getRow(2).height = 18;

  // --- Identificação: NOME / PERÍODO ---
  const rotulo: Opts = { font: { size: 9, bold: true, color: { argb: NAVY } }, fill: LABEL_BG };
  const valor: Opts = { font: { size: 11, bold: true, color: { argb: INK } }, align: 'left' };
  ws.mergeCells('A3:B3'); paint(ws, 'A3', 'NOME', rotulo);
  ws.mergeCells('C3:L3'); paint(ws, 'C3', `  ${freq.funcionario}`, valor);
  ws.mergeCells('A4:B4'); paint(ws, 'A4', 'PERÍODO', rotulo);
  ws.mergeCells('C4:L4'); paint(ws, 'C4', `  ${MESES[freq.mes]} / ${freq.ano}`, valor);
  ws.getRow(3).height = 20;
  ws.getRow(4).height = 20;

  // --- Cabeçalho da tabela (linhas 5 e 6) ---
  const th: Opts = { font: { size: 9, bold: true, color: { argb: WHITE } }, fill: NAVY, wrap: true };
  // Colunas que ocupam as duas linhas
  for (const [col, texto] of [['A', 'Dia'], ['B', 'Dia da semana'], ['I', 'Horário a Cumprir'], ['J', 'Horário Cumprido'], ['K', 'Saldo'], ['L', 'Marcador']] as const) {
    ws.mergeCells(`${col}5:${col}6`);
    paint(ws, `${col}5`, texto, th);
  }
  // Grupos de turno + sub-cabeçalhos
  ws.mergeCells('C5:E5'); paint(ws, 'C5', 'MATUTINO', th);
  ws.mergeCells('F5:H5'); paint(ws, 'F5', 'VESPERTINO', th);
  for (const [col, texto] of [['C', 'Entrada'], ['D', 'Saída'], ['E', 'Total'], ['F', 'Entrada'], ['G', 'Saída'], ['H', 'Total']] as const) {
    paint(ws, `${col}6`, texto, th);
  }
  ws.getRow(5).height = 18;
  ws.getRow(6).height = 24;

  // --- Linhas dos dias ---
  const firstRow = 7;
  for (let d = 1; d <= N; d++) {
    const r = firstRow + (d - 1);
    const tipo = tipoDoDia(freq.ano, freq.mes, d, feriados);
    const wd = diaSemana(freq.ano, freq.mes, d);
    const reg = porDia.get(d);
    const folga = !ehDiaDeTrabalho(tipo, jornada); // domingo, feriado ou sábado de folga
    const bg = folga ? WEEKEND : (d % 2 === 0 ? ZEBRA : undefined);

    const tNum: Opts = { font: { size: 9, color: { argb: INK } }, align: 'right', fmt: NUMFMT, fill: bg };
    const tCalc: Opts = { font: { size: 9, bold: true, color: { argb: INK } }, align: 'right', fmt: NUMFMT, fill: bg };

    paint(ws, `A${r}`, d, { font: { size: 9, bold: true, color: { argb: NAVY } }, fill: bg });
    paint(ws, `B${r}`, DIAS_SEMANA[wd], { font: { size: 8, italic: folga, color: { argb: folga ? MUTED : INK } }, align: 'left', fill: bg });
    paint(ws, `C${r}`, horaParaFracaoDia(reg?.entradaManha), tNum);
    paint(ws, `D${r}`, horaParaFracaoDia(reg?.saidaAlmoco), tNum);
    paint(ws, `E${r}`, { formula: `D${r}-C${r}` }, tCalc);
    paint(ws, `F${r}`, horaParaFracaoDia(reg?.retornoAlmoco), tNum);
    paint(ws, `G${r}`, horaParaFracaoDia(reg?.saidaTarde), tNum);
    paint(ws, `H${r}`, { formula: `G${r}-F${r}` }, tCalc);
    // Dias marcados como FALTA/ATESTADO/FÉRIAS/FOLGA não geram débito no banco:
    // a falta é descontada em folha, os demais são abonados.
    paint(ws, `I${r}`, minutosACumprirDia(tipo, reg?.marcador, jornada) / 1440, { font: { size: 9, color: { argb: MUTED } }, align: 'right', fmt: NUMFMT, fill: bg });
    paint(ws, `J${r}`, { formula: `E${r}+H${r}` }, tCalc);
    paint(ws, `K${r}`, { formula: `J${r}-I${r}` }, { font: { size: 9, bold: true, color: { argb: INK } }, align: 'right', fmt: SALDO_FMT, fill: bg });

    const marcador = reg?.marcador ?? (tipo === 'feriado' ? 'FERIADO' : null);
    paint(ws, `L${r}`, marcador ?? '', { font: { size: 8, bold: true, color: { argb: marcador ? NAVY : INK } }, fill: bg });
  }

  const lastRow = firstRow + N - 1;

  // Saldo por dia em verde (positivo) / vermelho (negativo)
  ws.addConditionalFormatting({
    ref: `K${firstRow}:K${lastRow}`,
    rules: [
      { type: 'cellIs', operator: 'lessThan', priority: 1, formulae: ['0'], style: { font: { color: { argb: RED }, bold: true } } },
      { type: 'cellIs', operator: 'greaterThan', priority: 2, formulae: ['0'], style: { font: { color: { argb: GREEN }, bold: true } } },
    ],
  });

  // --- Bloco de resumo (à direita, sob as colunas numéricas) ---
  const r0 = lastRow + 2; // total a cumprir
  const r1 = lastRow + 3; // total cumprido
  const r2 = lastRow + 4; // saldo
  const labelOpts: Opts = { font: { size: 9, bold: true, color: { argb: WHITE } }, fill: NAVY_SOFT, align: 'right' };
  const linhas: [number, string, FormulaVal][] = [
    [r0, 'TOTAL A CUMPRIR', { formula: `SUM(I${firstRow}:I${lastRow})` }],
    [r1, 'TOTAL CUMPRIDO', { formula: `SUM(J${firstRow}:J${lastRow})` }],
    [r2, 'SALDO DO MÊS', { formula: `J${r1}-J${r0}` }],
  ];
  for (const [r, label, val] of linhas) {
    ws.mergeCells(`G${r}:I${r}`); paint(ws, `G${r}`, label, labelOpts);
    ws.mergeCells(`J${r}:K${r}`);
    paint(ws, `J${r}`, val, {
      font: { size: 10, bold: true, color: { argb: r === r2 ? WHITE : INK } },
      align: 'right', fmt: r === r2 ? '[h]:mm;-[h]:mm' : NUMFMT,
      fill: r === r2 ? NAVY : WHITE,
    });
  }
  ws.getRow(r2).height = 20;
  // Saldo do mês colorido conforme o sinal (sobre o fundo navy fica em destaque)
  ws.addConditionalFormatting({
    ref: `J${r2}:K${r2}`,
    rules: [
      { type: 'cellIs', operator: 'lessThan', priority: 1, formulae: ['0'], style: { font: { color: { argb: 'FFFECACA' }, bold: true } } },
      { type: 'cellIs', operator: 'greaterThan', priority: 2, formulae: ['0'], style: { font: { color: { argb: 'FFBBF7D0' }, bold: true } } },
    ],
  });

  // --- Congela cabeçalho e ajusta impressão ---
  ws.views = [{ state: 'frozen', ySplit: 6, showGridLines: false }];
  ws.pageSetup = {
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  };

  return wb;
}
