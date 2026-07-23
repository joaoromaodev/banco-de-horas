// GET /api/caixa/de-para — planilha para a contadora revisar o de-para entre o
// plano de contas e as linhas do Balanço Financeiro.
//
// O modelo de balanço dela tem ~34 linhas para 118 contas, então boa parte das
// contas fica sem correspondência. A planilha traz a sugestão preenchida e uma
// coluna com lista suspensa para ela corrigir — é mais rápido do que classificar
// tudo do zero.
import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { exigirGestor } from '@/lib/acesso';
import { LINHAS_BALANCO, PLANO_CONTAS_PADRAO } from '@/lib/planoContasPadrao';

export const runtime = 'nodejs';

const NAVY = 'FF17365D';
const LABEL = 'FFEDF2F8';
const ALERTA = 'FFFFF3CD'; // contas sem sugestão
const INK = 'FF1F2937';

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Banco de Horas — Livro Caixa';

  // --- aba auxiliar com as linhas válidas (fonte da lista suspensa) ---
  const listas = wb.addWorksheet('Listas');
  const linhas = [
    ...LINHAS_BALANCO.entradaCaixa.map((l) => ['ENTRADA — Caixa', l]),
    ...LINHAS_BALANCO.entradaBancos.map((l) => ['ENTRADA — Bancos', l]),
    ...LINHAS_BALANCO.saidaCaixa.map((l) => ['SAÍDA — Caixa', l]),
    ...LINHAS_BALANCO.saidaBancos.map((l) => ['SAÍDA — Bancos', l]),
  ];
  listas.getCell('A1').value = 'Linha do Balanço';
  listas.getCell('B1').value = 'Bloco';
  linhas.forEach(([bloco, linha], i) => {
    listas.getCell(`A${i + 2}`).value = linha;
    listas.getCell(`B${i + 2}`).value = bloco;
  });
  // opção extra: quando nenhuma linha existente serve
  listas.getCell(`A${linhas.length + 2}`).value = 'CRIAR NOVA LINHA NO BALANÇO';
  const fimLista = linhas.length + 2;
  listas.state = 'veryHidden';

  // --- instruções ---
  const inst = wb.addWorksheet('Instruções');
  inst.getColumn('A').width = 110;
  const texto = [
    ['COMO PREENCHER', true],
    ['', false],
    ['Cada lançamento do livro caixa é classificado por uma conta do plano de contas.', false],
    ['Para o Balanço Financeiro sair sozinho no fim do ano, cada conta precisa saber', false],
    ['em qual LINHA do balanço ela entra.', false],
    ['', false],
    ['Na aba "De-para":', true],
    ['  • Coluna E — a sugestão que preenchemos. Confira.', false],
    ['  • Coluna F — só preencha se discordar da coluna E. Tem lista suspensa.', false],
    ['  • Coluna G — se quiser explicar alguma escolha.', false],
    ['', false],
    ['As linhas destacadas em amarelo são as contas que NÃO encontramos onde encaixar.', false],
    ['São 54 de 118. Elas não têm linha correspondente no seu modelo de balanço —', false],
    ['por exemplo: Aluguel, IRPJ, CSLL, COFINS, PIS, ISSQN, IPTU, Combustível,', false],
    ['Viagens, Publicidade e as contribuições sindicais.', false],
    ['', false],
    ['SUGESTÃO: em vez de classificar as 54 uma a uma, talvez seja mais simples', true],
    ['acrescentar 4 ou 5 linhas novas ao Balanço Financeiro — por exemplo "Aluguel",', false],
    ['"Tributos Federais", "Tributos Municipais", "Despesas com Pessoal" e', false],
    ['"Despesas Gerais". Aí quase tudo se resolve sozinho.', false],
    ['Se preferir esse caminho, escolha "CRIAR NOVA LINHA NO BALANÇO" na coluna F', false],
    ['e escreva o nome da linha na coluna G.', false],
    ['', false],
    ['Contas que devem ficar SEM linha (redutoras, como "( - ) Devoluções")', false],
    ['podem ficar em branco mesmo.', false],
  ];
  texto.forEach(([t, negrito], i) => {
    const c = inst.getCell(`A${i + 1}`);
    c.value = t as string;
    c.font = { name: 'Arial', size: 10, bold: negrito as boolean, color: { argb: INK } };
  });

  // --- de-para ---
  const ws = wb.addWorksheet('De-para');
  const larguras = [10, 42, 34, 11, 30, 30, 34];
  larguras.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  ws.mergeCells('A1:G1');
  const titulo = ws.getCell('A1');
  titulo.value = 'PLANO DE CONTAS  ×  BALANÇO FINANCEIRO';
  titulo.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
  titulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  titulo.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 26;

  const cabecalhos = ['Código', 'Conta', 'Grupo', 'Natureza', 'Linha sugerida', 'Linha correta (se mudar)', 'Observação'];
  cabecalhos.forEach((t, i) => {
    const c = ws.getCell(2, i + 1);
    c.value = t;
    c.font = { name: 'Arial', size: 9, bold: true, color: { argb: INK } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LABEL } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  });
  ws.getRow(2).height = 30;

  const borda = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } };
  PLANO_CONTAS_PADRAO.forEach((conta, i) => {
    const r = i + 3;
    const semSugestao = !conta.linhaBalanco;
    const valores = [conta.codigo, conta.nome, conta.grupo, conta.natureza === 'receita' ? 'Receita' : 'Despesa', conta.linhaBalanco ?? '', '', ''];
    valores.forEach((v, j) => {
      const c = ws.getCell(r, j + 1);
      c.value = v;
      c.font = { name: 'Arial', size: 9, color: { argb: INK } };
      c.border = { top: borda, left: borda, bottom: borda, right: borda };
      c.alignment = { vertical: 'middle', horizontal: j === 0 || j === 3 ? 'center' : 'left' };
      if (semSugestao) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ALERTA } };
    });
    // lista suspensa na coluna "Linha correta"
    ws.getCell(r, 6).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`=Listas!$A$2:$A$${fimLista}`],
    };
  });

  ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: PLANO_CONTAS_PADRAO.length + 2, column: 7 } };
  ws.views = [{ state: 'frozen', ySplit: 2 }];

  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="de-para_plano_de_contas_x_balanco.xlsx"',
    },
  });
}
