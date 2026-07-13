// Gera uma FOLHA DE PONTO em branco em PDF (A4, uma página), pronta para
// imprimir e preencher à mão. Visual azul-marinho; fins de semana e feriados
// (conforme a jornada da empresa) saem mesclados e em negrito.
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage, RGB } from 'pdf-lib';
import {
  MESES, DIAS_SEMANA, diasNoMes, diaSemana, tipoDoDia, ehDiaDeTrabalho, Jornada, JORNADA_PADRAO,
} from './calendario';

// Paleta (0–1)
const NAVY = rgb(0x17 / 255, 0x36 / 255, 0x5d / 255);
const NAVY_SOFT = rgb(0x2e / 255, 0x5b / 255, 0x8a / 255);
const LABEL_BG = rgb(0xed / 255, 0xf2 / 255, 0xf8 / 255);
const ZEBRA = rgb(0xf4 / 255, 0xf8 / 255, 0xfc / 255);
const WEEKEND = rgb(0xe3 / 255, 0xea / 255, 0xf3 / 255);
const WHITE = rgb(1, 1, 1);
const INK = rgb(0x1f / 255, 0x29 / 255, 0x37 / 255);
const MUTED = rgb(0x6b / 255, 0x72 / 255, 0x80 / 255);
const GRID = rgb(0xcb / 255, 0xd5 / 255, 0xe1 / 255);

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 22;
const PAD = 4;

interface Ctx {
  page: PDFPage;
  reg: PDFFont;
  bold: PDFFont;
}

// Larguras das colunas (somam a largura útil da página)
const CONTENT_W = A4.w - 2 * MARGIN;
const W = { dia: 34, semana: 108, c: 70, d: 70, e: 70, f: 70, assinatura: CONTENT_W - (34 + 108 + 70 * 4) };
const X = {
  dia: MARGIN,
  semana: MARGIN + W.dia,
  c: MARGIN + W.dia + W.semana,
  d: MARGIN + W.dia + W.semana + W.c,
  e: MARGIN + W.dia + W.semana + W.c + W.d,
  f: MARGIN + W.dia + W.semana + W.c + W.d + W.e,
  assinatura: MARGIN + W.dia + W.semana + W.c + W.d + W.e + W.f,
};

type Align = 'left' | 'center' | 'right';

function cell(
  ctx: Ctx, x: number, top: number, w: number, h: number,
  o: { fill?: RGB; texto?: string; align?: Align; bold?: boolean; size?: number; color?: RGB; borda?: boolean } = {},
) {
  const y = A4.h - top - h;
  ctx.page.drawRectangle({
    x, y, width: w, height: h,
    color: o.fill ?? WHITE,
    borderColor: o.borda === false ? undefined : GRID,
    borderWidth: o.borda === false ? 0 : 0.5,
  });
  if (o.texto) {
    const font = o.bold ? ctx.bold : ctx.reg;
    const size = o.size ?? 8.5;
    const tw = font.widthOfTextAtSize(o.texto, size);
    const align = o.align ?? 'center';
    const tx = align === 'left' ? x + PAD : align === 'right' ? x + w - tw - PAD : x + (w - tw) / 2;
    const ty = A4.h - top - h / 2 - size * 0.35;
    ctx.page.drawText(o.texto, { x: tx, y: ty, size, font, color: o.color ?? INK });
  }
}

export async function gerarFolhaPontoPDF(opts: {
  nomeEmpresa: string;
  funcionario: string;
  cargo?: string | null;
  ano: number;
  mes: number;
  feriados: Set<string>;
  jornada?: Jornada;
}): Promise<Uint8Array> {
  const { nomeEmpresa, funcionario, cargo, ano, mes, feriados } = opts;
  const jornada = opts.jornada ?? JORNADA_PADRAO;

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([A4.w, A4.h]);
  const ctx: Ctx = {
    page,
    reg: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };

  const N = diasNoMes(ano, mes);

  // Alturas fixas do cabeçalho + rodapé; a altura das linhas de dia é calculada
  // para caber tudo em UMA página.
  const H_TITULO = 30, H_SUB = 16, H_ID = 17, H_GRUPO = 15, H_SUBH = 14;
  const H_RODAPE = 34, GAP_RODAPE = 8;
  const headerBloco = H_TITULO + H_SUB + H_ID * 3 + H_GRUPO + H_SUBH;
  const disponivel = A4.h - 2 * MARGIN;
  const areaDias = disponivel - headerBloco - H_RODAPE - GAP_RODAPE;
  const hDia = areaDias / N;

  let top = MARGIN;

  // Faixa de título (empresa)
  cell(ctx, MARGIN, top, CONTENT_W, H_TITULO, { fill: NAVY, texto: (nomeEmpresa || '').toUpperCase(), bold: true, size: 15, color: WHITE, borda: false });
  top += H_TITULO;
  cell(ctx, MARGIN, top, CONTENT_W, H_SUB, { fill: NAVY_SOFT, texto: 'FOLHA DE PONTO', bold: true, size: 10, color: WHITE, borda: false });
  top += H_SUB;

  // Identificação (rótulo à esquerda, valor centralizado)
  const wRot = W.dia + W.semana;
  const wVal = CONTENT_W - wRot;
  const idRow = (rotulo: string, valor: string) => {
    cell(ctx, MARGIN, top, wRot, H_ID, { fill: LABEL_BG, texto: rotulo, bold: true, size: 9, color: NAVY });
    cell(ctx, MARGIN + wRot, top, wVal, H_ID, { texto: valor, bold: true, size: 11, align: 'center' });
    top += H_ID;
  };
  idRow('NOME', funcionario);
  idRow('CARGO', cargo || '');
  idRow('PERÍODO', `${MESES[mes]} / ${ano}`);

  // Cabeçalho da tabela (grupo + sub), tudo navy
  const topGrupo = top;
  const th = { fill: NAVY, bold: true, size: 9, color: WHITE };
  // Colunas que ocupam as duas linhas
  cell(ctx, X.dia, topGrupo, W.dia, H_GRUPO + H_SUBH, { ...th, texto: 'Dia' });
  cell(ctx, X.semana, topGrupo, W.semana, H_GRUPO + H_SUBH, { ...th, texto: 'Dia da semana' });
  cell(ctx, X.assinatura, topGrupo, W.assinatura, H_GRUPO + H_SUBH, { ...th, texto: 'Assinatura' });
  // Grupos
  cell(ctx, X.c, topGrupo, W.c + W.d, H_GRUPO, { ...th, texto: 'MATUTINO' });
  cell(ctx, X.e, topGrupo, W.e + W.f, H_GRUPO, { ...th, texto: 'VESPERTINO' });
  // Sub-cabeçalhos
  const topSub = topGrupo + H_GRUPO;
  cell(ctx, X.c, topSub, W.c, H_SUBH, { ...th, texto: 'Entrada' });
  cell(ctx, X.d, topSub, W.d, H_SUBH, { ...th, texto: 'Saída' });
  cell(ctx, X.e, topSub, W.e, H_SUBH, { ...th, texto: 'Entrada' });
  cell(ctx, X.f, topSub, W.f, H_SUBH, { ...th, texto: 'Saída' });
  top = topSub + H_SUBH;

  // Linhas dos dias
  for (let d = 1; d <= N; d++) {
    const tipo = tipoDoDia(ano, mes, d, feriados);
    const wd = diaSemana(ano, mes, d);
    const folga = !ehDiaDeTrabalho(tipo, jornada);
    const bg = folga ? WEEKEND : (d % 2 === 0 ? ZEBRA : undefined);

    if (folga) {
      // Domingo / feriado / sábado sem expediente: linha inteira mesclada, em negrito.
      const rotulo = tipo === 'feriado' ? 'FERIADO' : DIAS_SEMANA[wd];
      cell(ctx, MARGIN, top, CONTENT_W, hDia, { fill: bg, texto: `${d}   -   ${rotulo}`, bold: true, size: 9.5, color: MUTED });
    } else {
      cell(ctx, X.dia, top, W.dia, hDia, { fill: bg, texto: String(d), bold: true, size: 10, color: NAVY });
      cell(ctx, X.semana, top, W.semana, hDia, { fill: bg, texto: DIAS_SEMANA[wd], size: 8, color: INK, align: 'center' });
      cell(ctx, X.c, top, W.c, hDia, { fill: bg });
      cell(ctx, X.d, top, W.d, hDia, { fill: bg });
      cell(ctx, X.e, top, W.e, hDia, { fill: bg });
      cell(ctx, X.f, top, W.f, hDia, { fill: bg });
      cell(ctx, X.assinatura, top, W.assinatura, hDia, { fill: bg });
    }
    top += hDia;
  }

  // Rodapé: linhas de assinatura
  const topRod = top + GAP_RODAPE + 12;
  const meia = CONTENT_W / 2;
  const linha = (x: number, w: number, rotulo: string) => {
    ctx.page.drawLine({ start: { x: x + 20, y: A4.h - topRod }, end: { x: x + w - 20, y: A4.h - topRod }, thickness: 0.7, color: INK });
    cell(ctx, x, topRod + 2, w, 14, { texto: rotulo, size: 9, color: INK, borda: false });
  };
  linha(MARGIN, meia, 'Assinatura do Funcionário');
  linha(MARGIN + meia, meia, 'Assinatura do Responsável');

  return pdf.save();
}
