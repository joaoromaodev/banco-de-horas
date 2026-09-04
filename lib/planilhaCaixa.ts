// Gera o LIVRO CAIXA em .xlsx, no formato da planilha dela: uma aba por mês
// (DATA · HISTÓRICO · COMPLEMENTO · CONTA · ENTRADA · SAÍDA · SALDO, saldo
// transportado na primeira linha, saldo corrido por fórmula), mais uma aba de
// Resumo e os termos de abertura/encerramento. Visual azul-marinho, o mesmo de
// lib/planilha.ts.
//
// A saída de cada linha é a EFETIVA (saida+juros+multa, ver docs/livro-caixa.md).
import ExcelJS from 'exceljs';
import { LivroCaixaDados, MesLivro, saidaEfetiva } from './caixa';
import { MESES_LONGOS } from './formatoLivro';

const NAVY = 'FF17365D';
const NAVY_SOFT = 'FF2E5B8A';
const LABEL_BG = 'FFEDF2F8';
const ZEBRA = 'FFF4F8FC';
const WHITE = 'FFFFFFFF';
const INK = 'FF1F2937';
const MUTED = 'FF6B7280';
const GREEN = 'FF15803D';
const RED = 'FFB91C1C';

const DINHEIRO = '#,##0.00;[Red]-#,##0.00';
const gridB = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } };
const border = { top: gridB, left: gridB, bottom: gridB, right: gridB };

interface Opts {
  font?: Partial<ExcelJS.Font>;
  fill?: string;
  align?: 'left' | 'center' | 'right';
  fmt?: string;
  wrap?: boolean;
  semBorda?: boolean;
}

function paint(ws: ExcelJS.Worksheet, ref: string, value: ExcelJS.CellValue, o: Opts = {}) {
  const c = ws.getCell(ref);
  c.value = value;
  c.font = { name: 'Arial', size: 9, color: { argb: INK }, ...o.font };
  if (o.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
  if (!o.semBorda) c.border = border;
  c.alignment = { horizontal: o.align ?? 'center', vertical: 'middle', wrapText: o.wrap };
  if (o.fmt) c.numFmt = o.fmt;
  return c;
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// A..G = DATA, HISTÓRICO, COMPLEMENTO, CONTA, ENTRADA, SAÍDA, SALDO
const LARGURAS = [9, 34, 26, 10, 15, 15, 16];

function faixaTitulo(ws: ExcelJS.Worksheet, nomeEmpresa: string, sub: string) {
  ws.mergeCells('A1:G1');
  paint(ws, 'A1', nomeEmpresa.toUpperCase(), { font: { size: 15, bold: true, color: { argb: WHITE } }, fill: NAVY, semBorda: true });
  ws.getRow(1).height = 28;
  ws.mergeCells('A2:G2');
  paint(ws, 'A2', sub, { font: { size: 10, bold: true, color: { argb: WHITE } }, fill: NAVY_SOFT, semBorda: true });
  ws.getRow(2).height = 18;
}

function abaMes(wb: ExcelJS.Workbook, dados: LivroCaixaDados, m: MesLivro) {
  const ws = wb.addWorksheet(MESES_LONGOS[m.mes - 1], { views: [{ showGridLines: false }] });
  LARGURAS.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  faixaTitulo(ws, dados.empresa.nome, `LIVRO CAIXA — ${MESES_LONGOS[m.mes - 1]} / ${dados.ano}`);

  // cabeçalho da tabela (linha 3)
  const th: Opts = { font: { size: 9, bold: true, color: { argb: WHITE } }, fill: NAVY, wrap: true };
  const cabecalhos = ['DATA', 'HISTÓRICO', 'COMPLEMENTO', 'CONTA', 'ENTRADA', 'SAÍDA', 'SALDO'];
  cabecalhos.forEach((t, i) => paint(ws, `${col(i)}3`, t, { ...th, align: i === 1 || i === 2 ? 'left' : 'center' }));
  ws.getRow(3).height = 20;

  // saldo anterior (linha 4)
  ws.mergeCells('A4:F4');
  paint(ws, 'A4', m.mes === 1 ? 'SALDO ANTERIOR (abertura)' : 'SALDO TRANSPORTADO', { font: { size: 9, bold: true, color: { argb: NAVY } }, fill: LABEL_BG, align: 'right' });
  paint(ws, 'G4', m.saldoTransportado, { font: { size: 9, bold: true, color: { argb: INK } }, fill: LABEL_BG, align: 'right', fmt: DINHEIRO });

  // lançamentos
  const first = 5;
  m.linhas.forEach((l, idx) => {
    const r = first + idx;
    const se = saidaEfetiva(l);
    const bg = idx % 2 === 1 ? ZEBRA : undefined;
    paint(ws, `A${r}`, ddmm(l.data), { font: { size: 9 }, fill: bg });
    paint(ws, `B${r}`, l.historico, { font: { size: 9 }, align: 'left', fill: bg });
    paint(ws, `C${r}`, l.complemento ?? '', { font: { size: 8, color: { argb: MUTED } }, align: 'left', fill: bg });
    paint(ws, `D${r}`, l.contaCodigo ?? '', { font: { size: 8 }, fill: bg });
    paint(ws, `E${r}`, l.entrada || null, { font: { size: 9, color: { argb: GREEN } }, align: 'right', fmt: DINHEIRO, fill: bg });
    paint(ws, `F${r}`, se || null, { font: { size: 9, color: { argb: RED } }, align: 'right', fmt: DINHEIRO, fill: bg });
    // saldo corrido por fórmula: linha anterior + entrada - saída
    paint(ws, `G${r}`, { formula: `G${r - 1}+E${r}-F${r}` }, { font: { size: 9, bold: true }, align: 'right', fmt: DINHEIRO, fill: bg });
  });

  const last = first + m.linhas.length - 1;
  const totRow = Math.max(last, 4) + 1;
  ws.mergeCells(`A${totRow}:D${totRow}`);
  paint(ws, `A${totRow}`, 'TOTAIS DO MÊS', { font: { size: 9, bold: true, color: { argb: WHITE } }, fill: NAVY_SOFT, align: 'right' });
  const somaAte = m.linhas.length ? last : 4;
  paint(ws, `E${totRow}`, m.linhas.length ? { formula: `SUM(E${first}:E${somaAte})` } : 0, { font: { size: 9, bold: true, color: { argb: WHITE } }, fill: NAVY_SOFT, align: 'right', fmt: DINHEIRO });
  paint(ws, `F${totRow}`, m.linhas.length ? { formula: `SUM(F${first}:F${somaAte})` } : 0, { font: { size: 9, bold: true, color: { argb: WHITE } }, fill: NAVY_SOFT, align: 'right', fmt: DINHEIRO });
  paint(ws, `G${totRow}`, { formula: `G${m.linhas.length ? last : 4}` }, { font: { size: 10, bold: true, color: { argb: WHITE } }, fill: NAVY, align: 'right', fmt: DINHEIRO });

  const saldoRow = totRow + 1;
  ws.mergeCells(`A${saldoRow}:F${saldoRow}`);
  paint(ws, `A${saldoRow}`, 'SALDO A TRANSPORTAR', { font: { size: 9, bold: true, color: { argb: NAVY } }, fill: LABEL_BG, align: 'right' });
  paint(ws, `G${saldoRow}`, { formula: `G${totRow}` }, { font: { size: 9, bold: true }, fill: LABEL_BG, align: 'right', fmt: DINHEIRO });

  ws.views = [{ state: 'frozen', ySplit: 3, showGridLines: false }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } };
}

function col(i: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + i);
}

function abaResumo(wb: ExcelJS.Workbook, dados: LivroCaixaDados) {
  const ws = wb.addWorksheet('Resumo', { views: [{ showGridLines: false }] });
  [8, 20, 18, 18, 18, 18].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  faixaTitulo(ws, dados.empresa.nome, `LIVRO CAIXA — RESUMO DO EXERCÍCIO DE ${dados.ano}`);

  const th: Opts = { font: { size: 9, bold: true, color: { argb: WHITE } }, fill: NAVY, wrap: true };
  ['Mês', 'Saldo transportado', 'Entradas', 'Saídas', 'Saldo do mês'].forEach((t, i) => paint(ws, `${col(i)}3`, t, th));
  ws.getRow(3).height = 22;

  dados.meses.forEach((m, idx) => {
    const r = 4 + idx;
    const bg = idx % 2 === 1 ? ZEBRA : undefined;
    paint(ws, `A${r}`, MESES_LONGOS[m.mes - 1], { font: { size: 9, bold: true, color: { argb: NAVY } }, align: 'left', fill: bg });
    paint(ws, `B${r}`, m.saldoTransportado, { font: { size: 9 }, align: 'right', fmt: DINHEIRO, fill: bg });
    paint(ws, `C${r}`, m.entradas, { font: { size: 9, color: { argb: GREEN } }, align: 'right', fmt: DINHEIRO, fill: bg });
    paint(ws, `D${r}`, m.saidas, { font: { size: 9, color: { argb: RED } }, align: 'right', fmt: DINHEIRO, fill: bg });
    paint(ws, `E${r}`, m.saldoFinal, { font: { size: 9, bold: true }, align: 'right', fmt: DINHEIRO, fill: bg });
  });

  const r = 4 + dados.meses.length;
  paint(ws, `A${r}`, 'TOTAL', { font: { size: 9, bold: true, color: { argb: WHITE } }, fill: NAVY_SOFT, align: 'left' });
  paint(ws, `B${r}`, dados.saldoInicial, { font: { size: 9, bold: true, color: { argb: WHITE } }, fill: NAVY_SOFT, align: 'right', fmt: DINHEIRO });
  paint(ws, `C${r}`, dados.totalEntradas, { font: { size: 9, bold: true, color: { argb: WHITE } }, fill: NAVY_SOFT, align: 'right', fmt: DINHEIRO });
  paint(ws, `D${r}`, dados.totalSaidas, { font: { size: 9, bold: true, color: { argb: WHITE } }, fill: NAVY_SOFT, align: 'right', fmt: DINHEIRO });
  paint(ws, `E${r}`, dados.saldoFinalAno, { font: { size: 10, bold: true, color: { argb: WHITE } }, fill: NAVY, align: 'right', fmt: DINHEIRO });
  ws.views = [{ state: 'frozen', ySplit: 3, showGridLines: false }];
}

function abaTermo(wb: ExcelJS.Workbook, dados: LivroCaixaDados, tipo: 'abertura' | 'encerramento') {
  const { empresa, fiscal, termo, ano } = dados;
  const pf = empresa.tipoPessoa === 'fisica';
  const ws = wb.addWorksheet(tipo === 'abertura' ? 'Termo de Abertura' : 'Termo de Encerramento', { views: [{ showGridLines: false }] });
  ws.getColumn('A').width = 110;
  faixaTitulo(ws, empresa.nome, `LIVRO CAIXA — EXERCÍCIO DE ${ano}`);

  const ou = (v: string | null | undefined, larg = 14) => (String(v ?? '').trim() || '_'.repeat(larg));
  const folhas = termo.qtdFolhas ? String(termo.qtdFolhas) : '____';
  const inscricao = pf
    ? `inscrito(a) no CPF sob o nº ${ou(empresa.documento, 18)}`
    : `inscrita no CNPJ sob o nº ${ou(empresa.documento, 18)}, Inscrição Estadual nº ${ou(fiscal.inscricaoEstadual, 12)}, Inscrição Municipal nº ${ou(fiscal.inscricaoMunicipal, 12)}`;
  const junta = pf ? '' : `, registrada na ${ou(fiscal.registroJunta, 24)} sob o nº ${ou(fiscal.registroNumero, 12)}`;
  const local = `estabelecido(a) em ${ou(fiscal.endereco, 30)}, nº ${ou(fiscal.numeroEndereco, 5)}, ${ou(fiscal.municipio, 18)}/${ou(fiscal.estado, 2)}`;
  const pessoa = pf ? 'ao(à) contribuinte' : 'à empresa';

  const corpo = tipo === 'abertura'
    ? `Este livro, sob o nº ${ou(termo.numeroLivro?.toString(), 4)}, de ordem ${ou(termo.numeroOrdem?.toString(), 4)}, contém ${folhas} folhas numeradas do nº 1 ao nº ${folhas}, todas por mim rubricadas, e servirá de LIVRO CAIXA pertencente ${pessoa} ${empresa.nome.toUpperCase()}, ${local}, ${inscricao}${junta}, referente ao exercício de ${ano}.`
    : `Este livro, sob o nº ${ou(termo.numeroLivro?.toString(), 4)}, de ordem ${ou(termo.numeroOrdem?.toString(), 4)}, contém ${folhas} folhas numeradas do nº 1 ao nº ${folhas}, todas por mim rubricadas, e encerra-se nesta data por conter a escrituração completa do LIVRO CAIXA pertencente ${pessoa} ${empresa.nome.toUpperCase()}, ${inscricao}, referente ao exercício de ${ano}.`;

  paint(ws, 'A4', tipo === 'abertura' ? 'TERMO DE ABERTURA' : 'TERMO DE ENCERRAMENTO', { font: { size: 14, bold: true, color: { argb: NAVY } }, align: 'center', semBorda: true });
  ws.getRow(4).height = 30;
  const cell = ws.getCell('A6');
  cell.value = corpo;
  cell.font = { name: 'Arial', size: 11, color: { argb: INK } };
  cell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
  ws.getRow(6).height = 120;

  const cidade = ou(fiscal.cidadeTermo, 18);
  const data = termo.dataTermo ? formatarDataExtenso(termo.dataTermo) : ou(null, 30);
  paint(ws, 'A8', `${cidade}, ${data}.`, { font: { size: 11 }, align: 'left', semBorda: true });

  paint(ws, 'A11', '_'.repeat(40), { font: { size: 11 }, align: 'left', semBorda: true });
  paint(ws, 'A12', `${empresa.nome.toUpperCase()} — ${pf ? 'Contribuinte' : 'Empresa'}`, { font: { size: 9, bold: true }, align: 'left', semBorda: true });
  paint(ws, 'A14', '_'.repeat(40), { font: { size: 11 }, align: 'left', semBorda: true });
  paint(ws, 'A15', `${ou(fiscal.contabilista, 20)} — Contabilista · CRC ${ou(fiscal.crc, 10)}`, { font: { size: 9, bold: true }, align: 'left', semBorda: true });
}

function formatarDataExtenso(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES_LONGOS[m - 1]} de ${a}`;
}

export async function gerarLivroCaixaXLSX(dados: LivroCaixaDados): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Banco de Horas — Livro Caixa';
  abaTermo(wb, dados, 'abertura');
  for (const m of dados.meses) abaMes(wb, dados, m);
  abaResumo(wb, dados);
  abaTermo(wb, dados, 'encerramento');
  return wb.xlsx.writeBuffer();
}
