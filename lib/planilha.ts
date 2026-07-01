// Gera o .xlsx no formato "LEVANTAMENTO DE HORAS" (anexo 2), fiel ao original:
// sistema de datas 1904, fórmulas, mesclagens, estilos e coluna "a cumprir" por calendário.
import ExcelJS from 'exceljs';
import { Frequencia } from './tipos';
import { horaParaFracaoDia } from './tempo';
import {
  MESES, DIAS_SEMANA, diasNoMes, diaSemana, tipoDoDia, minutosACumprir, Jornada, JORNADA_PADRAO,
} from './calendario';

const RED = 'FFFF0000';
const DARK = 'FF111111';
const NUMFMT = '[h]:mm:ss';
const thin = { style: 'thin' as const };
const border = { top: thin, left: thin, bottom: thin, right: thin };
const fontLabel = { name: 'Arial', size: 9, bold: true, color: { argb: DARK } };
const fontTime = { name: 'Arial', size: 9, bold: true, color: { argb: RED } };

const LARGURAS: Record<string, number> = {
  A: 9, B: 19.7, C: 13.4, D: 14.4, E: 14.9, F: 13.6, G: 14, H: 12.4, I: 15.2, J: 15.6, K: 15.6, L: 15.7,
};

export function gerarPlanilha(
  freq: Frequencia,
  feriados: Set<string>,
  jornada: Jornada = JORNADA_PADRAO,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.properties.date1904 = true; // permite exibir saldo negativo

  const ws = wb.addWorksheet(MESES[freq.mes], { views: [{ showGridLines: false }] });
  for (const [c, w] of Object.entries(LARGURAS)) ws.getColumn(c).width = w;

  const porDia = new Map(freq.dias.map((d) => [d.dia, d]));
  const N = diasNoMes(freq.ano, freq.mes);

  // Cabeçalho
  ws.mergeCells('A2:K2');
  cell(ws, 'A2', '   VAZ E VOUZELA', fontLabel, 'center');
  cell(ws, 'B3', 'NOME', fontLabel, 'center');
  ws.mergeCells('C3:K3');
  cell(ws, 'C3', freq.funcionario, fontLabel, 'left');
  cell(ws, 'B4', 'PERÍODO', fontLabel, 'center');
  ws.mergeCells('C4:K4');
  cell(ws, 'C4', `${String(freq.mes).padStart(2, '0')}/${freq.ano}`, fontLabel, 'left');

  ws.mergeCells('C5:E5');
  cell(ws, 'C5', 'VESPERTINO', fontLabel, 'center');
  ws.mergeCells('F5:H5');
  cell(ws, 'F5', 'Matutino', fontLabel, 'center');

  const heads: Record<string, string> = {
    C: 'Entrada', D: 'Saída', E: 'Total', F: 'Entrada', G: 'Saída', H: 'Total',
    I: 'Horário a Cumprir', J: 'Horário Cumprido', K: 'SALDO',
  };
  cell(ws, 'B6', '', fontLabel, 'center');
  for (const [c, v] of Object.entries(heads)) cell(ws, `${c}6`, v, fontLabel, 'center');

  const firstRow = 7;
  for (let d = 1; d <= N; d++) {
    const r = firstRow + (d - 1);
    const tipo = tipoDoDia(freq.ano, freq.mes, d, feriados);
    const wd = diaSemana(freq.ano, freq.mes, d);
    const reg = porDia.get(d);

    valNum(ws, `A${r}`, d, fontLabel, 'center', 'General');
    valNum(ws, `B${r}`, DIAS_SEMANA[wd], fontLabel, 'left', 'General');
    valNum(ws, `C${r}`, horaParaFracaoDia(reg?.entradaManha), fontTime, 'right', NUMFMT);
    valNum(ws, `D${r}`, horaParaFracaoDia(reg?.saidaAlmoco), fontTime, 'right', NUMFMT);
    formula(ws, `E${r}`, `D${r}-C${r}`);
    valNum(ws, `F${r}`, horaParaFracaoDia(reg?.retornoAlmoco), fontTime, 'right', NUMFMT);
    valNum(ws, `G${r}`, horaParaFracaoDia(reg?.saidaTarde), fontTime, 'right', NUMFMT);
    formula(ws, `H${r}`, `G${r}-F${r}`);
    valNum(ws, `I${r}`, minutosACumprir(tipo, jornada) / 1440, fontTime, 'right', NUMFMT);
    formula(ws, `J${r}`, `E${r}+H${r}`);
    formula(ws, `K${r}`, `J${r}-I${r}`);

    const marcador = reg?.marcador ?? (tipo === 'feriado' ? 'FERIADO' : null);
    if (marcador) cell(ws, `L${r}`, marcador, fontLabel, 'center');
  }

  const lastRow = firstRow + N - 1;
  const cumpridoR = lastRow + 2;
  const acumprirR = lastRow + 4;
  const saldoR = lastRow + 6;

  formula(ws, `I${saldoR}`, `SUM(I${firstRow}:I${lastRow})`, NUMFMT);
  formula(ws, `J${saldoR}`, `SUM(J${firstRow}:J${lastRow})`, NUMFMT);

  resumo(ws, `B${cumpridoR}`, 'HORÁRIO  CUMPRIDO', `C${cumpridoR}`, `J${saldoR}`);
  resumo(ws, `B${acumprirR}`, 'HORÁRIO  A CUMPRIR', `C${acumprirR}`, `I${saldoR}`);
  resumo(ws, `B${saldoR}`, 'SALDO DEVEDOR', `C${saldoR}`, `C${cumpridoR}-C${acumprirR}`);

  return wb;
}

// ---- helpers de célula ----
function cell(ws: ExcelJS.Worksheet, ref: string, value: string, font: any, h: 'left' | 'center' | 'right') {
  const c = ws.getCell(ref);
  c.value = value;
  c.font = { ...font };
  c.border = border;
  c.alignment = { horizontal: h, vertical: 'middle' };
}

function valNum(ws: ExcelJS.Worksheet, ref: string, value: number | string, font: any, h: 'left' | 'center' | 'right', fmt: string) {
  const c = ws.getCell(ref);
  c.value = value;
  c.font = { ...font };
  c.border = border;
  c.numFmt = fmt;
  c.alignment = { horizontal: h, vertical: 'middle' };
}

function formula(ws: ExcelJS.Worksheet, ref: string, f: string, fmt: string = NUMFMT) {
  const c = ws.getCell(ref);
  c.value = { formula: f };
  c.font = { ...fontTime };
  c.border = border;
  c.numFmt = fmt;
  c.alignment = { horizontal: 'right', vertical: 'middle' };
}

function resumo(ws: ExcelJS.Worksheet, refLabel: string, label: string, refVal: string, f: string) {
  cell(ws, refLabel, label, fontLabel, 'center');
  const c = ws.getCell(refVal);
  c.value = { formula: f };
  c.font = { ...fontLabel };
  c.border = border;
  c.numFmt = '[h]:mm:ss;@';
  c.alignment = { horizontal: 'center', vertical: 'middle' };
}
