// Leitura (planilha .xlsx / .csv) e modelo para baixar da edição em lote do DP.
// Só de servidor. Lê o arquivo como TEXTO — células com fórmula contam pelo resultado
// e nada é executado. Regras de interpretação em lib/dpLote.ts.
import ExcelJS from 'exceljs';
import { br } from './dp';
import { CABECALHOS_MODELO, type EmpregadoDoLote } from './dpLote';

export const MAX_BYTES_PLANILHA = 2 * 1024 * 1024;

function textoDaCelula(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10); // datas do Excel vêm em UTC
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if ('result' in o) return textoDaCelula(o.result as ExcelJS.CellValue);
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join('');
    if (typeof o.text === 'string') return o.text;
    return '';
  }
  return String(v);
}

/** CSV simples (aspas, `;` ou `,`, BOM). */
export function lerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, '');
  const primeira = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ';' : ',';
  const linhas: string[][] = [];
  let cel = '';
  let linha: string[] = [];
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"') { if (t[i + 1] === '"') { cel += '"'; i++; } else aspas = false; } else cel += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(cel); cel = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      linha.push(cel); cel = ''; linhas.push(linha); linha = [];
    } else cel += c;
  }
  if (cel !== '' || linha.length) { linha.push(cel); linhas.push(linha); }
  return linhas;
}

/** Matriz de texto da primeira aba do .xlsx ou do .csv. Lança `Error` com mensagem para a tela. */
export async function lerArquivoPlanilha(nome: string, bytes: ArrayBuffer): Promise<string[][]> {
  if (bytes.byteLength > MAX_BYTES_PLANILHA) throw new Error('Arquivo grande demais (máximo 2 MB).');
  const ext = nome.toLowerCase().split('.').pop();
  if (ext === 'csv' || ext === 'txt') return lerCsv(new TextDecoder('utf-8').decode(bytes));
  if (ext !== 'xlsx') throw new Error('Envie um arquivo .xlsx ou .csv (use o modelo para baixar).');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes);
  } catch {
    throw new Error('Não consegui abrir a planilha. Confira se é um .xlsx válido.');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('A planilha está vazia.');
  const r: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    if (n > 2000) return;
    const cel: string[] = [];
    for (let c = 1; c <= Math.min(ws.columnCount, 20); c++) cel.push(textoDaCelula(row.getCell(c).value));
    r[n - 1] = cel;
  });
  return Array.from(r, (l) => l ?? []);
}

const linhaModelo = (e: EmpregadoDoLote) => [
  e.nome, br(e.admissao), e.cargo ?? '', e.salarioBase ?? '', e.horasSemanais ?? '', e.escala ?? '',
  e.bancoHoras ? 'Sim' : '', e.bancoHorasDesde ? br(e.bancoHorasDesde) : '',
];

/** Modelo para baixar: um empregado por linha, já com o que está no cadastro. */
export async function gerarModelo(empregados: EmpregadoDoLote[], formato: 'xlsx' | 'csv'): Promise<{ bytes: Uint8Array; tipo: string; arquivo: string }> {
  const ativos = empregados.filter((e) => e.situacao !== 'desligado');
  if (formato === 'csv') {
    const q = (v: unknown) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const txt = [[...CABECALHOS_MODELO] as string[], ...ativos.map((e) => linhaModelo(e).map(String))].map((l) => l.map(q).join(';')).join('\r\n');
    return { bytes: new TextEncoder().encode(`﻿${txt}\r\n`), tipo: 'text/csv; charset=utf-8', arquivo: 'modelo-cadastro-empregados.csv' };
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Empregados');
  ws.addRow([...CABECALHOS_MODELO]);
  for (const e of ativos) ws.addRow(linhaModelo(e));
  ws.getRow(1).font = { bold: true };
  [32, 14, 24, 14, 16, 10, 16, 20].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const aj = wb.addWorksheet('Como preencher');
  [
    ['Preencha só o que quiser completar. Célula em branco = não muda nada (a importação nunca apaga).'],
    ['Nome: precisa ser igual ao do cadastro; a importação não cadastra empregado novo.'],
    ['Admissão e Banco de horas desde: dd/mm/aaaa.'],
    ['Salário base: 1.518,00 · Horas semanais: 44 · Escala: 5x2, 6x1, 12x36 ou Outra · Banco de horas: Sim ou Não.'],
    ['Antes de gravar, o sistema mostra a prévia do que vai mudar.'],
  ].forEach((l) => aj.addRow(l));
  aj.getColumn(1).width = 110;
  const buf = await wb.xlsx.writeBuffer();
  return { bytes: new Uint8Array(buf), tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', arquivo: 'modelo-cadastro-empregados.xlsx' };
}
