// Gera o LIVRO CAIXA inteiro em PDF: Termo de Abertura + os 12 meses (miolo, no
// formato DATA · HISTÓRICO · COMPLEMENTO · CONTA · ENTRADA · SAÍDA · SALDO, com o
// saldo transportado na primeira linha e o saldo corrido a cada lançamento) +
// Termo de Encerramento. Todas as folhas numeradas.
//
// Visual azul-marinho, o mesmo de lib/folhaPonto.ts. Páginas em paisagem, que é
// como um livro razão se lê. A saída de cada linha é a EFETIVA (saida+juros+multa,
// ver docs/livro-caixa.md).
//
// ATENÇÃO — texto dos termos: o texto legal abaixo é o padrão do Livro Caixa; a
// contadora (Edilse) ainda precisa validá-lo, e a variante de pessoa física é uma
// redação nossa a confirmar (pendência da Fase 6 em docs/livro-caixa.md).
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage, RGB } from 'pdf-lib';
import { LivroCaixaDados, MesLivro, saidaEfetiva } from './caixa';
import { MESES_LONGOS } from './formatoLivro';

const NAVY = rgb(0x17 / 255, 0x36 / 255, 0x5d / 255);
const NAVY_SOFT = rgb(0x2e / 255, 0x5b / 255, 0x8a / 255);
const LABEL_BG = rgb(0xed / 255, 0xf2 / 255, 0xf8 / 255);
const ZEBRA = rgb(0xf4 / 255, 0xf8 / 255, 0xfc / 255);
const WHITE = rgb(1, 1, 1);
const INK = rgb(0x1f / 255, 0x29 / 255, 0x37 / 255);
const MUTED = rgb(0x6b / 255, 0x72 / 255, 0x80 / 255);
const GRID = rgb(0xcb / 255, 0xd5 / 255, 0xe1 / 255);
const GREEN = rgb(0x15 / 255, 0x80 / 255, 0x3d / 255);
const RED = rgb(0xb9 / 255, 0x1c / 255, 0x1c / 255);

// A4 paisagem
const PG = { w: 841.89, h: 595.28 };
const MARGIN = 28;
const PAD = 4;
const CONTENT_W = PG.w - 2 * MARGIN;

// Larguras das colunas do miolo (somam CONTENT_W)
const W = { data: 55, hist: 245, compl: 175, conta: 62, entrada: 82, saida: 82, saldo: CONTENT_W - (55 + 245 + 175 + 62 + 82 + 82) };
const COLS = ['data', 'hist', 'compl', 'conta', 'entrada', 'saida', 'saldo'] as const;
type Col = (typeof COLS)[number];
const X: Record<Col, number> = (() => {
  const x = {} as Record<Col, number>;
  let acc = MARGIN;
  for (const c of COLS) { x[c] = acc; acc += W[c]; }
  return x;
})();

const H_HEAD = 26;

interface Ctx { pdf: PDFDocument; reg: PDFFont; bold: PDFFont; }
type Align = 'left' | 'center' | 'right';

const brl = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (n: number) => brl.format(n);
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function cell(
  page: PDFPage, ctx: Ctx, x: number, top: number, w: number, h: number,
  o: { fill?: RGB; texto?: string; align?: Align; bold?: boolean; size?: number; color?: RGB; borda?: boolean } = {},
) {
  const y = PG.h - top - h;
  page.drawRectangle({
    x, y, width: w, height: h,
    color: o.fill ?? WHITE,
    borderColor: o.borda === false ? undefined : GRID,
    borderWidth: o.borda === false ? 0 : 0.5,
  });
  if (o.texto) {
    const font = o.bold ? ctx.bold : ctx.reg;
    const size = o.size ?? 8.5;
    const texto = recortar(o.texto, font, size, w - 2 * PAD);
    const tw = font.widthOfTextAtSize(texto, size);
    const align = o.align ?? 'center';
    const tx = align === 'left' ? x + PAD : align === 'right' ? x + w - tw - PAD : x + (w - tw) / 2;
    const ty = PG.h - top - h / 2 - size * 0.35;
    page.drawText(texto, { x: tx, y: ty, size, font, color: o.color ?? INK });
  }
}

/** Trunca com reticências para não estourar a coluna. */
function recortar(s: string, font: PDFFont, size: number, max: number): string {
  if (font.widthOfTextAtSize(s, size) <= max) return s;
  let t = s;
  while (t.length > 1 && font.widthOfTextAtSize(t + '…', size) > max) t = t.slice(0, -1);
  return t + '…';
}

/** Cabeçalho de página (faixa de título + subtítulo). Devolve o `top` após ele. */
function cabecalho(page: PDFPage, ctx: Ctx, nomeEmpresa: string, sub: string): number {
  let top = MARGIN;
  cell(page, ctx, MARGIN, top, CONTENT_W, H_HEAD, { fill: NAVY, texto: nomeEmpresa.toUpperCase(), bold: true, size: 14, color: WHITE, borda: false });
  top += H_HEAD;
  cell(page, ctx, MARGIN, top, CONTENT_W, 16, { fill: NAVY_SOFT, texto: sub, bold: true, size: 10, color: WHITE, borda: false });
  top += 16;
  return top;
}

// -------------------------------------------------------------- miolo (meses)

const H_LINHA = 17;
const H_TH = 18;

function cabecalhoTabela(page: PDFPage, ctx: Ctx, top: number) {
  const th = { fill: NAVY, bold: true, size: 8.5, color: WHITE };
  cell(page, ctx, X.data, top, W.data, H_TH, { ...th, texto: 'DATA' });
  cell(page, ctx, X.hist, top, W.hist, H_TH, { ...th, texto: 'HISTÓRICO', align: 'left' });
  cell(page, ctx, X.compl, top, W.compl, H_TH, { ...th, texto: 'COMPLEMENTO', align: 'left' });
  cell(page, ctx, X.conta, top, W.conta, H_TH, { ...th, texto: 'CONTA' });
  cell(page, ctx, X.entrada, top, W.entrada, H_TH, { ...th, texto: 'ENTRADA' });
  cell(page, ctx, X.saida, top, W.saida, H_TH, { ...th, texto: 'SAÍDA' });
  cell(page, ctx, X.saldo, top, W.saldo, H_TH, { ...th, texto: 'SALDO' });
}

/** Linha "SALDO ANTERIOR/TRANSPORTADO" que abre o mês (e cada continuação). */
function linhaSaldo(page: PDFPage, ctx: Ctx, top: number, rotulo: string, saldo: number) {
  const wRot = W.data + W.hist + W.compl + W.conta + W.entrada + W.saida;
  cell(page, ctx, X.data, top, wRot, H_LINHA, { fill: LABEL_BG, texto: rotulo, bold: true, size: 8.5, color: NAVY, align: 'right' });
  cell(page, ctx, X.saldo, top, W.saldo, H_LINHA, { fill: LABEL_BG, texto: money(saldo), bold: true, size: 8.5, color: saldo < 0 ? RED : INK, align: 'right' });
}

/**
 * Desenha um mês (uma ou mais páginas). Cada mês começa em página nova, como as
 * abas da planilha dela. Devolve as páginas criadas, na ordem.
 */
function desenharMes(ctx: Ctx, dados: LivroCaixaDados, m: MesLivro): PDFPage[] {
  const paginas: PDFPage[] = [];
  const periodo = `LIVRO CAIXA · ${MESES_LONGOS[m.mes - 1]} / ${dados.ano}`;

  let saldo = m.saldoTransportado;
  let i = 0;
  let continuacao = false;

  do {
    const page = ctx.pdf.addPage([PG.w, PG.h]);
    paginas.push(page);
    let top = cabecalho(page, ctx, dados.empresa.nome, periodo);
    cabecalhoTabela(page, ctx, top);
    top += H_TH;

    linhaSaldo(page, ctx, top, continuacao ? 'Saldo transportado' : 'Saldo anterior', saldo);
    top += H_LINHA;

    const limiteTop = PG.h - MARGIN - H_LINHA - 28; // reserva para a linha de totais + rodapé
    let zebra = 0;
    while (i < m.linhas.length && top + H_LINHA <= limiteTop) {
      const l = m.linhas[i];
      const se = saidaEfetiva(l);
      saldo = saldo + l.entrada - se;
      const bg = zebra % 2 === 1 ? ZEBRA : undefined;
      cell(page, ctx, X.data, top, W.data, H_LINHA, { fill: bg, texto: ddmm(l.data), size: 8.5 });
      cell(page, ctx, X.hist, top, W.hist, H_LINHA, { fill: bg, texto: l.historico, size: 8.5, align: 'left' });
      cell(page, ctx, X.compl, top, W.compl, H_LINHA, { fill: bg, texto: l.complemento ?? '', size: 8, align: 'left', color: MUTED });
      cell(page, ctx, X.conta, top, W.conta, H_LINHA, { fill: bg, texto: l.contaCodigo ?? '—', size: 8, color: l.contaCodigo ? INK : MUTED });
      cell(page, ctx, X.entrada, top, W.entrada, H_LINHA, { fill: bg, texto: l.entrada ? money(l.entrada) : '', size: 8.5, align: 'right', color: GREEN });
      cell(page, ctx, X.saida, top, W.saida, H_LINHA, { fill: bg, texto: se ? money(se) : '', size: 8.5, align: 'right', color: RED });
      cell(page, ctx, X.saldo, top, W.saldo, H_LINHA, { fill: bg, texto: money(saldo), size: 8.5, align: 'right', bold: true, color: saldo < 0 ? RED : INK });
      top += H_LINHA;
      i++;
      zebra++;
    }

    continuacao = true;
    const acabou = i >= m.linhas.length;
    if (acabou) {
      // Totais do mês + saldo a transportar
      const wRot = W.data + W.hist + W.compl + W.conta;
      cell(page, ctx, X.data, top, wRot, H_LINHA, { fill: NAVY_SOFT, texto: 'TOTAIS DO MÊS', bold: true, size: 8.5, color: WHITE, align: 'right' });
      cell(page, ctx, X.entrada, top, W.entrada, H_LINHA, { fill: NAVY_SOFT, texto: money(m.entradas), bold: true, size: 8.5, color: WHITE, align: 'right' });
      cell(page, ctx, X.saida, top, W.saida, H_LINHA, { fill: NAVY_SOFT, texto: money(m.saidas), bold: true, size: 8.5, color: WHITE, align: 'right' });
      cell(page, ctx, X.saldo, top, W.saldo, H_LINHA, { fill: NAVY, texto: money(m.saldoFinal), bold: true, size: 8.5, color: WHITE, align: 'right' });
      top += H_LINHA;
      const wSaldo = W.data + W.hist + W.compl + W.conta + W.entrada + W.saida;
      cell(page, ctx, X.data, top, wSaldo, H_LINHA, { fill: LABEL_BG, texto: 'Saldo a transportar', bold: true, size: 8.5, color: NAVY, align: 'right' });
      cell(page, ctx, X.saldo, top, W.saldo, H_LINHA, { fill: LABEL_BG, texto: money(m.saldoFinal), bold: true, size: 8.5, color: m.saldoFinal < 0 ? RED : INK, align: 'right' });
    }
  } while (i < m.linhas.length);

  return paginas;
}

// -------------------------------------------------------------- termos

/** Placeholder de linha pontilhada quando falta o dado. */
function ou(v: string | null | undefined, larg = 14): string {
  const s = String(v ?? '').trim();
  return s || '_'.repeat(larg);
}

function paragrafo(page: PDFPage, ctx: Ctx, texto: string, top: number, size = 11): number {
  const maxW = CONTENT_W - 80;
  const x = MARGIN + 40;
  const palavras = texto.split(' ');
  let linha = '';
  const linhas: string[] = [];
  for (const p of palavras) {
    const tent = linha ? `${linha} ${p}` : p;
    if (ctx.reg.widthOfTextAtSize(tent, size) > maxW) { linhas.push(linha); linha = p; }
    else linha = tent;
  }
  if (linha) linhas.push(linha);
  const lh = size * 1.6;
  for (const l of linhas) {
    page.drawText(l, { x, y: PG.h - top, size, font: ctx.reg, color: INK });
    top += lh;
  }
  return top;
}

function paginaTermo(ctx: Ctx, dados: LivroCaixaDados, tipo: 'abertura' | 'encerramento', totalFolhas: number, page: PDFPage) {
  const { empresa, fiscal, termo, ano } = dados;
  const pf = empresa.tipoPessoa === 'fisica';
  const titulo = tipo === 'abertura' ? 'TERMO DE ABERTURA' : 'TERMO DE ENCERRAMENTO';

  let top = cabecalho(page, ctx, empresa.nome, `LIVRO CAIXA · EXERCÍCIO DE ${ano}`);
  top += 50;
  const tw = ctx.bold.widthOfTextAtSize(titulo, 16);
  page.drawText(titulo, { x: MARGIN + (CONTENT_W - tw) / 2, y: PG.h - top, size: 16, font: ctx.bold, color: NAVY });
  top += 44;

  const numLivro = ou(termo.numeroLivro?.toString(), 4);
  const numOrdem = ou(termo.numeroOrdem?.toString(), 4);
  const folhas = String(totalFolhas);
  const pessoa = pf ? 'ao(à) contribuinte' : 'à empresa';
  const inscricao = pf
    ? `inscrito(a) no CPF sob o nº ${ou(empresa.documento, 18)}`
    : `inscrita no CNPJ sob o nº ${ou(empresa.documento, 18)}, Inscrição Estadual nº ${ou(fiscal.inscricaoEstadual, 12)}, Inscrição Municipal nº ${ou(fiscal.inscricaoMunicipal, 12)}`;
  const junta = pf ? '' : `, registrada na ${ou(fiscal.registroJunta, 24)} sob o nº ${ou(fiscal.registroNumero, 12)}`;
  const local = `estabelecido(a) em ${ou(fiscal.endereco, 30)}, nº ${ou(fiscal.numeroEndereco, 5)}, ${ou(fiscal.municipio, 18)}/${ou(fiscal.estado, 2)}`;

  const corpo = tipo === 'abertura'
    ? `Este livro, sob o nº ${numLivro}, de ordem ${numOrdem}, contém ${folhas} (${folhas}) folhas numeradas do nº 1 ao nº ${folhas}, todas por mim rubricadas, e servirá de LIVRO CAIXA pertencente ${pessoa} ${empresa.nome.toUpperCase()}, ${local}, ${inscricao}${junta}, referente ao exercício de ${ano}.`
    : `Este livro, sob o nº ${numLivro}, de ordem ${numOrdem}, contém ${folhas} (${folhas}) folhas numeradas do nº 1 ao nº ${folhas}, todas por mim rubricadas, e encerra-se nesta data por conter a escrituração completa do LIVRO CAIXA pertencente ${pessoa} ${empresa.nome.toUpperCase()}, ${inscricao ? inscricao : ''}, referente ao exercício de ${ano}.`;

  top = paragrafo(page, ctx, corpo, top);
  top += 24;

  const cidade = ou(fiscal.cidadeTermo, 18);
  const dataTermo = termo.dataTermo ? formatarDataExtenso(termo.dataTermo) : ou(null, 30);
  top = paragrafo(page, ctx, `${cidade}, ${dataTermo}.`, top);

  // Assinaturas
  const yAss = PG.h - MARGIN - 70;
  const meia = CONTENT_W / 2;
  const linhaAss = (x: number, w: number, rotulo: string, sub: string) => {
    page.drawLine({ start: { x: x + 30, y: yAss }, end: { x: x + w - 30, y: yAss }, thickness: 0.8, color: INK });
    const t1w = ctx.bold.widthOfTextAtSize(rotulo, 9.5);
    page.drawText(rotulo, { x: x + (w - t1w) / 2, y: yAss - 14, size: 9.5, font: ctx.bold, color: INK });
    const t2w = ctx.reg.widthOfTextAtSize(sub, 8.5);
    page.drawText(sub, { x: x + (w - t2w) / 2, y: yAss - 27, size: 8.5, font: ctx.reg, color: MUTED });
  };
  linhaAss(MARGIN, meia, empresa.nome.toUpperCase(), pf ? 'Contribuinte' : 'Empresa');
  linhaAss(MARGIN + meia, meia, ou(fiscal.contabilista, 20), `Contabilista · CRC ${ou(fiscal.crc, 10)}`);
}

function formatarDataExtenso(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number);
  return `${d} de ${MESES_LONGOS[m - 1]} de ${a}`;
}

// -------------------------------------------------------------- rodapé (folhas)

function rodapes(pdf: PDFDocument, reg: PDFFont, empresa: string, ano: number) {
  const paginas = pdf.getPages();
  const total = paginas.length;
  paginas.forEach((page, idx) => {
    const n = idx + 1;
    const esq = `${empresa} · Livro Caixa ${ano}`;
    page.drawText(esq, { x: MARGIN, y: MARGIN - 6, size: 7.5, font: reg, color: MUTED });
    const dir = `Folha ${n} de ${total}`;
    const w = reg.widthOfTextAtSize(dir, 7.5);
    page.drawText(dir, { x: PG.w - MARGIN - w, y: MARGIN - 6, size: 7.5, font: reg, color: MUTED });
  });
}

/**
 * Monta o PDF do livro inteiro. Devolve os bytes e a **qtd de folhas** (total de
 * páginas), para o chamador gravar em `exercicios.qtd_folhas` — é o número que os
 * próprios termos citam.
 */
export async function gerarLivroCaixaPDF(dados: LivroCaixaDados): Promise<{ pdf: Uint8Array; qtdFolhas: number }> {
  const pdf = await PDFDocument.create();
  const ctx: Ctx = {
    pdf,
    reg: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  // 1) Miolo primeiro, para saber quantas páginas o livro terá.
  for (const m of dados.meses) desenharMes(ctx, dados, m);
  const totalFolhas = pdf.getPageCount() + 2; // + abertura + encerramento

  // 2) Termo de abertura na frente; encerramento no fim. Agora o total é conhecido.
  const abertura = pdf.insertPage(0, [PG.w, PG.h]);
  paginaTermo(ctx, dados, 'abertura', totalFolhas, abertura);
  const encerramento = pdf.addPage([PG.w, PG.h]);
  paginaTermo(ctx, dados, 'encerramento', totalFolhas, encerramento);

  // 3) Numera todas as folhas no rodapé.
  rodapes(pdf, ctx.reg, dados.empresa.nome.toUpperCase(), dados.ano);

  return { pdf: await pdf.save(), qtdFolhas: totalFolhas };
}
