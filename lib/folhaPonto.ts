// Gera uma FOLHA DE PONTO em branco (.xlsx) para o funcionário preencher à mão.
// Mesmo visual azul-marinho da planilha de saída; fins de semana/feriados já
// aparecem sombreados e rotulados para orientar quem preenche.
import ExcelJS from 'exceljs';
import {
  MESES, DIAS_SEMANA, diasNoMes, diaSemana, tipoDoDia, ehDiaDeTrabalho, Jornada, JORNADA_PADRAO,
} from './calendario';

const NAVY = 'FF17365D';
const NAVY_SOFT = 'FF2E5B8A';
const LABEL_BG = 'FFEDF2F8';
const ZEBRA = 'FFF4F8FC';
const WEEKEND = 'FFE3EAF3';
const WHITE = 'FFFFFFFF';
const INK = 'FF1F2937';
const MUTED = 'FF6B7280';

const gridB = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } };
const border = { top: gridB, left: gridB, bottom: gridB, right: gridB };

const LARGURAS: Record<string, number> = { A: 6.5, B: 20, C: 12.5, D: 12.5, E: 12.5, F: 12.5, G: 28 };

interface Opts {
  font?: Partial<ExcelJS.Font>;
  fill?: string;
  align?: 'left' | 'center' | 'right';
  wrap?: boolean;
  bordas?: Partial<ExcelJS.Borders>;
}

function paint(ws: ExcelJS.Worksheet, ref: string, value: string | number, o: Opts = {}) {
  const c = ws.getCell(ref);
  c.value = value;
  c.font = { name: 'Arial', size: 9, color: { argb: INK }, ...o.font };
  if (o.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
  c.border = o.bordas ?? border;
  c.alignment = { horizontal: o.align ?? 'center', vertical: 'middle', wrapText: o.wrap };
  return c;
}

export function gerarFolhaPonto(opts: {
  nomeEmpresa: string;
  funcionario: string;
  cargo?: string | null;
  ano: number;
  mes: number;
  feriados: Set<string>;
  jornada?: Jornada;
}): ExcelJS.Workbook {
  const { nomeEmpresa, funcionario, cargo, ano, mes, feriados } = opts;
  const jornada = opts.jornada ?? JORNADA_PADRAO;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(MESES[mes], { views: [{ showGridLines: false }] });
  for (const [c, w] of Object.entries(LARGURAS)) ws.getColumn(c).width = w;

  // --- Faixa de título ---
  ws.mergeCells('A1:G1');
  paint(ws, 'A1', (nomeEmpresa || '').toUpperCase(), { font: { size: 15, bold: true, color: { argb: WHITE } }, fill: NAVY });
  ws.getRow(1).height = 30;
  ws.mergeCells('A2:G2');
  paint(ws, 'A2', 'FOLHA DE PONTO', { font: { size: 10, bold: true, color: { argb: WHITE } }, fill: NAVY_SOFT });
  ws.getRow(2).height = 18;

  // --- Identificação ---
  const rotulo: Opts = { font: { size: 9, bold: true, color: { argb: NAVY } }, fill: LABEL_BG };
  const valor: Opts = { font: { size: 11, bold: true, color: { argb: INK } }, align: 'left' };
  const nomeCompleto = cargo ? `  ${funcionario}   —   ${cargo}` : `  ${funcionario}`;
  ws.mergeCells('A3:B3'); paint(ws, 'A3', 'NOME', rotulo);
  ws.mergeCells('C3:G3'); paint(ws, 'C3', nomeCompleto, valor);
  ws.mergeCells('A4:B4'); paint(ws, 'A4', 'PERÍODO', rotulo);
  ws.mergeCells('C4:G4'); paint(ws, 'C4', `  ${MESES[mes]} / ${ano}`, valor);
  ws.getRow(3).height = 20;
  ws.getRow(4).height = 20;

  // --- Cabeçalho da tabela (linhas 5 e 6) ---
  const th: Opts = { font: { size: 9, bold: true, color: { argb: WHITE } }, fill: NAVY, wrap: true };
  for (const [col, texto] of [['A', 'Dia'], ['B', 'Dia da semana'], ['G', 'Assinatura']] as const) {
    ws.mergeCells(`${col}5:${col}6`);
    paint(ws, `${col}5`, texto, th);
  }
  ws.mergeCells('C5:D5'); paint(ws, 'C5', 'MATUTINO', th);
  ws.mergeCells('E5:F5'); paint(ws, 'E5', 'VESPERTINO', th);
  for (const [col, texto] of [['C', 'Entrada'], ['D', 'Saída'], ['E', 'Entrada'], ['F', 'Saída']] as const) {
    paint(ws, `${col}6`, texto, th);
  }
  ws.getRow(5).height = 18;
  ws.getRow(6).height = 22;

  // --- Linhas dos dias (em branco para preencher) ---
  const firstRow = 7;
  const N = diasNoMes(ano, mes);
  for (let d = 1; d <= N; d++) {
    const r = firstRow + (d - 1);
    const tipo = tipoDoDia(ano, mes, d, feriados);
    const wd = diaSemana(ano, mes, d);
    const folga = !ehDiaDeTrabalho(tipo, jornada);
    const bg = folga ? WEEKEND : (d % 2 === 0 ? ZEBRA : undefined);

    paint(ws, `A${r}`, d, { font: { size: 10, bold: true, color: { argb: NAVY } }, fill: bg });
    paint(ws, `B${r}`, DIAS_SEMANA[wd], { font: { size: 8, italic: folga, color: { argb: folga ? MUTED : INK } }, align: 'left', fill: bg });

    if (folga) {
      // Dia sem expediente: bloqueia as colunas e rotula o motivo.
      ws.mergeCells(`C${r}:G${r}`);
      const rotuloFolga = tipo === 'feriado' ? 'FERIADO' : tipo === 'domingo' ? 'DOMINGO' : 'SÁBADO';
      paint(ws, `C${r}`, rotuloFolga, { font: { size: 8, bold: true, color: { argb: MUTED } }, fill: bg });
    } else {
      for (const col of ['C', 'D', 'E', 'F', 'G'] as const) paint(ws, `${col}${r}`, '', { fill: bg });
    }
    ws.getRow(r).height = 24; // espaço para escrever à mão
  }

  const lastRow = firstRow + N - 1;

  // --- Rodapé: assinaturas ---
  const linhaAssinatura: Opts = { font: { size: 9, color: { argb: INK } }, align: 'center', bordas: { top: { style: 'thin', color: { argb: INK } } } };
  const rAssin = lastRow + 3;
  ws.mergeCells(`B${rAssin}:C${rAssin}`); paint(ws, `B${rAssin}`, 'Assinatura do Funcionário', linhaAssinatura);
  ws.mergeCells(`E${rAssin}:F${rAssin}`); paint(ws, `E${rAssin}`, 'Assinatura do Responsável', linhaAssinatura);
  ws.getRow(rAssin - 1).height = 22; // respiro acima das linhas

  // --- Impressão ---
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
