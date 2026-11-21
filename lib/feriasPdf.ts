// Aviso de férias e recibo de férias em PDF — mesmo desenhista (pdf-lib, Times) e
// mesmo estilo dos documentos do contrato de experiência (lib/contratosPdf.ts).
//
// Recibo SEM valores: nesta etapa o sistema não calcula remuneração, 1/3, abono,
// INSS nem IRRF (isso é do programa da folha). O recibo sai com as datas, os dias e
// o quadro de valores em branco para preencher — decisão da Sprint 8, ver
// docs/departamento-pessoal.md.
import { Escritor, LARGURA, MARGEM, type OpcoesTexto } from './contratosPdf';
import { dataExtenso } from './contratos';
import { br, cpfFormatado } from './dp';
import { fimDoGozo, retornoDoGozo, type FeriasProgramada, type PeriodoAquisitivo } from './ferias';

export type DocumentoFerias = 'aviso' | 'recibo';

export const NOME_DOCUMENTO_FERIAS: Record<DocumentoFerias, string> = {
  aviso: 'AVISO DE FÉRIAS',
  recibo: 'RECIBO DE FÉRIAS',
};

export interface DadosDocumentoFerias {
  empresa: { nome: string; cnpj?: string | null; cidade?: string | null };
  empregado: { nome: string; cpf?: string | null; cargo?: string | null; admissao?: string | null };
  periodo: Pick<PeriodoAquisitivo, 'inicio' | 'fim'>;
  ferias: Pick<FeriasProgramada, 'inicio' | 'dias' | 'abonoDias' | 'avisoEm' | 'pagamentoEm'>;
  /** Data impressa no documento (padrão: a do aviso, ou hoje). */
  data: string;
}

function cabecalho(e: Escritor, d: DadosDocumentoFerias) {
  e.par(d.empresa.nome.toUpperCase(), { negrito: true, depois: 1 });
  if (d.empresa.cnpj) e.par(`CNPJ: ${d.empresa.cnpj}`, { tam: 10, depois: 12 });
  else e.espaco(10);
}

function dadosEmpregado(e: Escritor, d: DadosDocumentoFerias) {
  e.par(`Empregado(a): ${d.empregado.nome.toUpperCase()}`, { negrito: true, depois: 2 });
  const linha = [
    d.empregado.cpf ? `CPF: ${cpfFormatado(d.empregado.cpf)}` : '',
    d.empregado.cargo ? `Função: ${d.empregado.cargo}` : '',
    d.empregado.admissao ? `Admissão: ${br(d.empregado.admissao)}` : '',
  ].filter(Boolean).join('   ·   ');
  if (linha) e.par(linha, { tam: 10, depois: 12 });
}

function localData(d: DadosDocumentoFerias) {
  const cidade = d.empresa.cidade?.trim();
  return `${cidade ? `${cidade}, ` : ''}${dataExtenso(d.data)}.`;
}

function assinaturasDuplas(e: Escritor, d: DadosDocumentoFerias, esquerda: string, direita: string) {
  e.garantir(110);
  const meio = (LARGURA - 24) / 2;
  const y = e.y - 50;
  e.assinatura(esquerda, d.empresa.nome.toUpperCase(), MARGEM.x, meio, y);
  e.assinatura(direita, d.empregado.nome.toUpperCase(), MARGEM.x + meio + 24, meio, y);
  e.y = y - 36;
}

function aviso(e: Escritor, d: DadosDocumentoFerias) {
  const J: OpcoesTexto = { alinhar: 'justificado' };
  cabecalho(e, d);
  e.par('AVISO DE FÉRIAS', { negrito: true, tam: 13, alinhar: 'centro', depois: 14 });
  dadosEmpregado(e, d);
  const f = d.ferias;
  e.par(`Nos termos do artigo 135 da Consolidação das Leis do Trabalho, comunicamos que suas férias, relativas ao período aquisitivo de ${br(d.periodo.inicio)} a ${br(d.periodo.fim)}, serão concedidas por ${f.dias} (${f.dias === 1 ? 'um dia' : `${f.dias} dias`}) corridos, de ${br(f.inicio)} a ${br(fimDoGozo(f))}, devendo V. Sa. retornar ao trabalho no dia ${br(retornoDoGozo(f))}.`,
    { ...J, primeira: 28 });
  if (f.abonoDias > 0) {
    e.par(`Conforme sua solicitação, ${f.abonoDias} dia(s) de férias serão convertidos em abono pecuniário (artigo 143 da CLT).`, { ...J, primeira: 28 });
  }
  if (f.pagamentoEm) {
    e.par(`A remuneração das férias, acrescida de um terço, será paga até ${br(f.pagamentoEm)} (artigo 145 da CLT).`, { ...J, primeira: 28 });
  } else {
    e.par('A remuneração das férias, acrescida de um terço, será paga até 2 (dois) dias antes do início do período (artigo 145 da CLT).', { ...J, primeira: 28 });
  }
  e.par('Solicitamos apresentar sua Carteira de Trabalho para as anotações devidas (artigo 135, § 1º, da CLT) e devolver este aviso com o seu ciente.', { ...J, primeira: 28, depois: 14 });
  e.par(localData(d), { depois: 6 });
  assinaturasDuplas(e, d, 'EMPREGADOR:', 'CIENTE DO(A) EMPREGADO(A):');
  e.par('Data do ciente: ____ / ____ / ________', { tam: 10 });
}

function recibo(e: Escritor, d: DadosDocumentoFerias) {
  const J: OpcoesTexto = { alinhar: 'justificado' };
  cabecalho(e, d);
  e.par('RECIBO DE FÉRIAS', { negrito: true, tam: 13, alinhar: 'centro', depois: 14 });
  dadosEmpregado(e, d);
  const f = d.ferias;
  e.tabela([LARGURA * 0.5, LARGURA * 0.5], [
    ['Período aquisitivo', `${br(d.periodo.inicio)} a ${br(d.periodo.fim)}`],
    ['Período de gozo', `${br(f.inicio)} a ${br(fimDoGozo(f))} (${f.dias} dias)`],
    ['Retorno ao trabalho', br(retornoDoGozo(f))],
    ['Abono pecuniário', f.abonoDias > 0 ? `${f.abonoDias} dia(s)` : 'Não'],
  ], { altura: 18, tam: 10 });
  e.espaco(4);
  e.par('Valores (preencher conforme a folha de pagamento):', { negrito: true, depois: 4 });
  const linhas: string[][] = [
    ['Descrição', 'Proventos (R$)', 'Descontos (R$)'],
    ['Remuneração das férias', '', ''],
    ['1/3 constitucional', '', ''],
  ];
  if (f.abonoDias > 0) linhas.push(['Abono pecuniário', '', ''], ['1/3 sobre o abono', '', '']);
  linhas.push(['INSS', '', ''], ['IRRF', '', ''], ['Total', '', ''], ['Líquido a receber', '', '']);
  e.tabela([LARGURA * 0.5, LARGURA * 0.25, LARGURA * 0.25], linhas, { cabecalho: true, altura: 18, tam: 10 });
  e.par(`Recebi de ${d.empresa.nome.toUpperCase()} a importância líquida acima, referente às minhas férias do período aquisitivo de ${br(d.periodo.inicio)} a ${br(d.periodo.fim)}, conforme demonstrado, dando plena e geral quitação.`,
    { ...J, primeira: 28, depois: 14 });
  e.par(localData(d), { depois: 6 });
  assinaturasDuplas(e, d, 'EMPREGADOR:', 'EMPREGADO(A):');
}

/** Gera o aviso ou o recibo de férias. */
export async function gerarPdfFerias(doc: DocumentoFerias, d: DadosDocumentoFerias): Promise<Uint8Array> {
  const titulo = doc === 'aviso' ? 'Aviso de férias' : 'Recibo de férias';
  const e = await Escritor.criar(`${titulo} — ${d.empregado.nome.trim()}`);
  (doc === 'aviso' ? aviso : recibo)(e, d);
  return e.bytes();
}
