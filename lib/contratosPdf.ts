// Contrato de experiência — saída em PDF, desenhada com pdf-lib a partir dos
// MESMOS campos que preenchem os modelos .docx (`camposDoDocumento`).
//
// Por que pdf-lib e não converter o .docx: a Vercel não tem LibreOffice, e uma
// conversão externa seria mais um serviço pago e um lugar onde dado pessoal
// (CPF, CTPS) sai do sistema. Aqui roda em qualquer função serverless, sem I/O.
//
// Acentuação: usa as fontes padrão do PDF (Times), cuja codificação WinAnsi cobre
// todo o português (á ã ç é ê í ó õ ú ü, “ ” – …). Caractere fora dela (ex.: "→"
// colado de outro sistema) vira "?" em vez de derrubar a geração.
//
// O layout reproduz o TEXTO e a ordem dos modelos da contadora, não o desenho
// pixel a pixel (margens, tabela e assinaturas são nossas). O .docx continua
// sendo o padrão — é o que ela edita e imprime. Ver docs/contratos-experiencia.md.
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import { camposDoDocumento, DadosContrato, DIAS, Documento } from './contratos';

export const A4: [number, number] = [595.28, 841.89];
export const MARGEM = { x: 70, topo: 64, base: 64 };
export const LARGURA = A4[0] - MARGEM.x * 2;
const PRETO = rgb(0, 0, 0);

interface Fontes { reg: PDFFont; neg: PDFFont }

type Alinhar = 'esq' | 'centro' | 'justificado';

export interface OpcoesTexto {
  negrito?: boolean;
  tam?: number;
  alinhar?: Alinhar;
  recuo?: number;     // recuo à esquerda de todo o parágrafo
  primeira?: number;  // recuo extra da primeira linha
  depois?: number;    // espaço depois do parágrafo
}

/** Desenhista de documento A4 (também usado pelo aviso e recibo de férias, lib/feriasPdf.ts). */
export class Escritor {
  pdf!: PDFDocument;
  fontes!: Fontes;
  pagina!: PDFPage;
  y = 0;

  static async criar(titulo: string): Promise<Escritor> {
    const e = new Escritor();
    e.pdf = await PDFDocument.create();
    e.pdf.setTitle(titulo);
    e.pdf.setProducer('ClickContas');
    e.pdf.setCreator('ClickContas');
    e.fontes = {
      reg: await e.pdf.embedFont(StandardFonts.TimesRoman),
      neg: await e.pdf.embedFont(StandardFonts.TimesRomanBold),
    };
    e.novaPagina();
    return e;
  }

  novaPagina() {
    this.pagina = this.pdf.addPage(A4);
    this.y = A4[1] - MARGEM.topo;
  }

  /** Garante `altura` pontos livres; senão abre outra página. */
  garantir(altura: number) {
    if (this.y - altura < MARGEM.base) this.novaPagina();
  }

  espaco(h: number) { this.y -= h; }

  /** Troca o que a fonte não codifica por "?" (e tira quebras de linha). */
  limpo(f: PDFFont, s: string): string {
    const ok = new Set(f.getCharacterSet());
    let r = '';
    for (const ch of s.replace(/\s+/g, ' ')) r += ok.has(ch.codePointAt(0)!) ? ch : '?';
    return r;
  }

  largura(f: PDFFont, tam: number, s: string) { return f.widthOfTextAtSize(s, tam); }

  /** Quebra em linhas que cabem em `max`. Palavra maior que a linha é cortada por caractere. */
  quebrar(f: PDFFont, tam: number, texto: string, max: number, max1 = max): string[] {
    const palavras = this.limpo(f, texto).trim().split(' ').filter(Boolean);
    const linhas: string[] = [];
    let atual = '';
    for (const p of palavras) {
      const lim = linhas.length === 0 ? max1 : max;
      const teste = atual ? `${atual} ${p}` : p;
      if (this.largura(f, tam, teste) <= lim) { atual = teste; continue; }
      if (atual) linhas.push(atual);
      let resto = p;
      const lim2 = linhas.length === 0 ? max1 : max;
      while (this.largura(f, tam, resto) > lim2 && resto.length > 1) {
        let n = resto.length - 1;
        while (n > 1 && this.largura(f, tam, resto.slice(0, n)) > lim2) n--;
        linhas.push(resto.slice(0, n));
        resto = resto.slice(n);
      }
      atual = resto;
    }
    if (atual) linhas.push(atual);
    return linhas.length ? linhas : [''];
  }

  /** Parágrafo com quebra automática e paginação. */
  par(texto: string, o: OpcoesTexto = {}) {
    const tam = o.tam ?? 11;
    const f = o.negrito ? this.fontes.neg : this.fontes.reg;
    const recuo = o.recuo ?? 0, primeira = o.primeira ?? 0;
    const max = LARGURA - recuo;
    const alinhar = o.alinhar ?? 'esq';
    const lh = tam * 1.38;
    const linhas = this.quebrar(f, tam, texto, max, max - primeira);
    linhas.forEach((ln, i) => {
      this.garantir(lh);
      this.y -= lh;
      const x0 = MARGEM.x + recuo + (i === 0 ? primeira : 0);
      const disponivel = max - (i === 0 ? primeira : 0);
      const w = this.largura(f, tam, ln);
      const ultima = i === linhas.length - 1;
      if (alinhar === 'centro') {
        this.pagina.drawText(ln, { x: MARGEM.x + (LARGURA - w) / 2, y: this.y, size: tam, font: f, color: PRETO });
      } else if (alinhar === 'justificado' && !ultima && ln.includes(' ')) {
        const palavras = ln.split(' ');
        const soma = palavras.reduce((s, p) => s + this.largura(f, tam, p), 0);
        const gap = (disponivel - soma) / (palavras.length - 1);
        let x = x0;
        for (const p of palavras) {
          this.pagina.drawText(p, { x, y: this.y, size: tam, font: f, color: PRETO });
          x += this.largura(f, tam, p) + gap;
        }
      } else {
        this.pagina.drawText(ln, { x: x0, y: this.y, size: tam, font: f, color: PRETO });
      }
    });
    this.y -= o.depois ?? 6;
  }

  /** Texto numa posição absoluta da página atual (célula de tabela, assinatura). */
  texto(s: string, x: number, y: number, tam: number, negrito = false, centroEm?: number) {
    const f = negrito ? this.fontes.neg : this.fontes.reg;
    const t = this.limpo(f, s);
    const px = centroEm != null ? x + (centroEm - this.largura(f, tam, t)) / 2 : x;
    this.pagina.drawText(t, { x: px, y, size: tam, font: f, color: PRETO });
  }

  linha(x1: number, x2: number, y: number, esp = 0.7) {
    this.pagina.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: esp, color: PRETO });
  }

  /** Tabela simples com bordas; `cols` são larguras, `linhas[0]` pode ser cabeçalho. */
  tabela(cols: number[], linhas: string[][], opc: { cabecalho?: boolean; altura?: number; tam?: number } = {}) {
    const alt = opc.altura ?? 20, tam = opc.tam ?? 10.5;
    const total = cols.reduce((a, b) => a + b, 0);
    this.garantir(alt * linhas.length + 4);
    const topo = this.y;
    linhas.forEach((cells, r) => {
      const yTopo = topo - r * alt;
      let x = MARGEM.x;
      cells.forEach((c, i) => {
        // célula vazia ao final = continuação (mescla com a anterior) — usada em "FOLGA"
        this.texto(c, x, yTopo - alt + 6.5, tam, opc.cabecalho && r === 0, cols[i]);
        x += cols[i];
      });
      this.linha(MARGEM.x, MARGEM.x + total, yTopo - alt);
    });
    this.linha(MARGEM.x, MARGEM.x + total, topo);
    let x = MARGEM.x;
    for (const w of [0, ...cols]) { x += w; this.linha2(x, topo, topo - alt * linhas.length); }
    this.y = topo - alt * linhas.length - 8;
  }

  private linha2(x: number, y1: number, y2: number) {
    this.pagina.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: 0.7, color: PRETO });
  }

  /** Bloco de assinatura: traço + legenda, numa largura. */
  assinatura(rotulo: string, nome: string, x: number, larg: number, y: number) {
    this.linha(x, x + larg, y, 0.8);
    this.texto(rotulo, x, y - 12, 9.5, true);
    if (nome) {
      const f = this.fontes.reg;
      const ln = this.quebrar(f, 9.5, nome, larg)[0];
      this.texto(ln, x, y - 24, 9.5);
    }
  }

  bytes() { return this.pdf.save(); }
}

// ------------------------------------------------------------------ documentos

function contrato(e: Escritor, c: Record<string, string>) {
  const J: OpcoesTexto = { alinhar: 'justificado' };
  e.par('CONTRATO DE TRABALHO A TÍTULO DE EXPERIÊNCIA', { negrito: true, tam: 13, alinhar: 'centro', depois: 14 });
  e.par(`Por este instrumento particular, que entre si fazem a Empresa, ${c.EMPRESA} com sede nesta cidade na ${c.EMPRESA_ENDERECO}, neste ato denominada simplesmente “EMPREGADORA”, e ${c.O_SR} ${c.NOME}, ${c.PORTADOR} da Carteira Profissional DIGITAL Nº ${c.CTPS} - ${c.CTPS_UF}, doravante ${c.CHAMADO} simplesmente “EMPREGADO”, firmam o presente Contrato individual de trabalho, em caráter de experiência, conforme a letra “C” parágrafo 2º do artigo 443 da Consolidação das Leis do Trabalho, mediante as seguintes condições:`,
    { ...J, primeira: 28 });
  e.par(`1) O Empregado trabalhará para a Empregadora, exercendo a Função de ${c.FUNCAO}, recebendo o Salário R$ ${c.SALARIO} (${c.SALARIO_EXTENSO}) por mês.`, J);
  e.par('2) O horário a ser obedecido será:', { depois: 4 });

  const cols = [95, 85, 85, 110, 75].map((w) => w * (LARGURA / 450));
  const linhas: string[][] = [['Dia(s) de Trabalho', 'Entrada', 'Saída', 'Intervalo', 'Rep. Semanal']];
  for (const d of DIAS) {
    const folga = c[`${d}_E`] === 'FOLGA';
    linhas.push([d, c[`${d}_E`], folga ? '' : c[`${d}_S`], c[`${d}_I`], c.REPOUSO]);
  }
  e.tabela(cols, linhas, { cabecalho: true, altura: 18, tam: 10 });

  e.par(`3) Este contrato tem início na data de sua assinatura, vencendo-se em ${c.VENCIMENTO}, podendo ser prorrogado, obedecido o disposto no Parágrafo Único do Artigo 445 da CLT.`, J);
  e.par('4) O Empregado se compromete a trabalhar em regime de compensação e de prorrogação de horas, observadas as formalidades legais.', J);
  e.par('4.1) O banco de horas será aplicado informando o horário de entrada e saída do funcionário, onde o mesmo deverá ser responsável pelos registros corretos e legíveis, estando de acordo com a compensação das horas devidas (atrasos e faltas) quando estas não forem justificados com documentos válidos dentro da lei.', { ...J, recuo: 18 });
  e.par('5) Obriga-se o empregado, além de executar com dedicação e lealdade seu serviço, a cumprir o Regimento interno da EMPREGADORA, as instruções de sua administração e as ordens de seus chefes e superiores hierárquicos, relativas às peculiaridades dos serviços que lhe forem confiados.', J);
  e.par('6) É proibido o uso de celular pessoal nas dependências da empresa em qualquer horário.', J);
  e.par('7) Aplicam-se a este contrato todas as normas em vigor, relativas aos contratos a prazo determinado devendo sua rescisão antecipada, por justa causa, obedecer ao disposto nos artigos 482 e 483 da CLT, conforme o caso.', J);
  e.par('8) Vencido o período experimental e continuando o empregado a prestar serviços a EMPREGADORA, por tempo indeterminado, ficam prorrogadas todas as cláusulas aqui estabelecidas, enquanto não se rescindir o contrato de trabalho. E por estarem de pleno acordo, assinam as partes este contrato, em duas vias de igual teor, na presença de duas testemunhas.', { ...J, depois: 8 });
  e.par(`${c.CIDADE_MAIUSC}, ${c.DATA_EXTENSO}`, { depois: 8 });

  assinaturas(e, c);

  // Termo de prorrogação — numa página só dele, como no modelo.
  e.novaPagina();
  e.par('TERMO DE PRORROGAÇÃO', { negrito: true, tam: 13, alinhar: 'centro', depois: 16 });
  e.par(`Por mútuo acordo entre as partes, fica o presente contrato de experiência que deveria vencer em ${c.VENCIMENTO} prorrogado até: ${c.PRORROGADO_ATE}`, { ...J, primeira: 28, depois: 24 });
  assinaturas(e, c);
}

/** EMPREGADORA / EMPREGADO em duas colunas e duas testemunhas. */
function assinaturas(e: Escritor, c: Record<string, string>) {
  const altura = 190;
  e.garantir(altura);
  const meio = (LARGURA - 24) / 2;
  const x2 = MARGEM.x + meio + 24;
  let y = e.y - 40;
  e.assinatura('EMPREGADORA:', c.EMPRESA_MAIUSC, MARGEM.x, meio, y);
  e.assinatura('EMPREGADO:', c.NOME, x2, meio, y);
  y -= 80;
  e.texto('TESTEMUNHAS:', MARGEM.x, y + 24, 9.5, true);
  e.linha(MARGEM.x, MARGEM.x + meio, y, 0.8);
  e.linha(x2, x2 + meio, y, 0.8);
  e.y = y - 20;
}

function vale(e: Escritor, c: Record<string, string>) {
  const J: OpcoesTexto = { alinhar: 'justificado' };
  e.par('DECLARAÇÃO DE OPÇÃO DE RECEBIMENTO DE VALE-TRANSPORTE', { negrito: true, tam: 13, alinhar: 'centro', depois: 14 });
  e.par(`Eu, ${c.NOME}, ${c.NACIONALIDADE}, ${c.PROFISSAO}, estado civil ${c.ESTADO_CIVIL}, CPF: ${c.CPF}, ${c.REGISTRADO} com carteira de trabalho Digital, declaro, para os devidos fins, que resido na:`, { ...J, primeira: 28 });
  for (const [r, v] of [['Endereço', c.END_RUA], ['Nº', c.END_NUM], ['Bairro', c.END_BAIRRO], ['Cidade', c.END_CIDADE], ['CEP', c.END_CEP], ['Estado', c.END_UF]]) {
    e.par(`${r}: ${v}`, { depois: 2 });
  }
  e.espaco(6);
  e.par('Optado por:', { negrito: true, depois: 3 });
  e.par(`( ${c.VT_NAO} ) NÃO receber vale-transporte;`, { depois: 3 });
  e.par(`( ${c.VT_SIM} ) receber vale-transporte, comprometendo-me:`, { depois: 5 });
  e.par('A utilizá-los exclusivamente para o meu deslocamento residência-trabalho e vice-versa.', { ...J, recuo: 18, depois: 3 });
  e.par('A renovar o endereço residencial acima declarado, anualmente, ou sempre que houver alterações do meu endereço residencial, ou dos meios de transportes mais adequados ao meu deslocamento residência-trabalho e vice-versa.', { ...J, recuo: 18, depois: 8 });
  e.par('Declaro estar igualmente ciente de que 6% do meu salário básico ou vencimento poderá ser utilizado para custear os vales-transporte, e que a afirmação falsa ou o uso indevido do vale-transporte constituem falta grave.', J);
  e.par('Declaro para todos os fins, inclusive para fazer jus à opção de recebimento de vale-transporte, residir no endereço declarado neste documento, sendo de minha inteira responsabilidade a improcedência das informações declaradas.', { ...J, depois: 12 });

  e.garantir(300);
  e.par('DECLARAÇÃO DE TRAJETO', { negrito: true, tam: 12, alinhar: 'centro', depois: 10 });
  const cols = [0.28, 0.46, 0.26].map((p) => p * LARGURA);
  for (const [titulo, pre] of [['Residência – Trabalho:', 'IDA'], ['Trabalho – Residência:', 'VOLTA']] as const) {
    e.par(titulo, { negrito: true, depois: 3 });
    const linhas = [['Linha', 'Empresa Operadora', 'Tarifa atual (R$)']];
    for (let i = 1; i <= 3; i++) linhas.push([c[`${pre}${i}_LINHA`], c[`${pre}${i}_OPER`], c[`${pre}${i}_TARIFA`]]);
    e.tabela(cols, linhas, { cabecalho: true, altura: 18, tam: 10 });
  }
  e.garantir(70);
  e.espaco(34);
  e.assinatura('FUNCIONÁRIO:', c.NOME, MARGEM.x, LARGURA * 0.6, e.y);
}

function encerramento(e: Escritor, c: Record<string, string>) {
  e.par('AVISO DE TÉRMINO DE CONTRATO DE EXPERIÊNCIA', { negrito: true, tam: 13, alinhar: 'centro', depois: 18 });
  e.par(`Funcionário: ${c.NOME}`, { negrito: true, depois: 3 });
  e.par(`CARTEIRA PROFISSIONAL DIGITAL – Nº ${c.CTPS}`, { depois: 14 });
  e.par(`Fazemos uso do presente documento para notificá-lo que seu contrato de experiência iniciado na data de ${c.INICIO} termina em ${c.TERMINO}, de modo que a partir desta data seus serviços não serão mais utilizados nesta empresa. Solicitamos a devolução do presente com seu ciente, e seu retorno no dia ${c.RETORNO}, para recebimento da documentação e pagamento da Rescisão de Contrato.`,
    { alinhar: 'justificado', primeira: 28, depois: 22 });
  e.par(`${c.CIDADE}, ${c.DATA_EXTENSO}`, { depois: 10 });
  e.garantir(100);
  e.espaco(46);
  e.assinatura('Funcionário:', c.NOME, MARGEM.x, LARGURA * 0.6, e.y);
  e.texto(`CPF: ${c.CPF}`, MARGEM.x, e.y - 36, 9.5);
}

const DESENHOS: Record<Documento, (e: Escritor, c: Record<string, string>) => void> = {
  contrato, vale, encerramento,
};

const TITULO: Record<Documento, string> = {
  contrato: 'Contrato de experiência',
  vale: 'Declaração de opção de vale-transporte',
  encerramento: 'Aviso de término do contrato de experiência',
};

/** Gera o PDF de um dos três documentos a partir dos dados do formulário. */
export async function gerarPdf(doc: Documento, dados: DadosContrato): Promise<Uint8Array> {
  const e = await Escritor.criar(`${TITULO[doc]} — ${dados.nome.trim()}`);
  DESENHOS[doc](e, camposDoDocumento(doc, dados));
  return e.bytes();
}
