// Nota e boleto sem IA (Sprint 17, Frente B) — do documento à PROPOSTA de
// lançamento do Livro Caixa, com regras exatas e nada saindo do servidor.
//
// Três fontes, todas determinísticas:
//   1. XML de NF-e/NFC-e/NFS-e (lib/notaFiscalXml.ts) — exato;
//   2. boleto (lib/boleto.ts) — linha digitável digitada ou achada no PDF;
//   3. PDF com texto (nota, recibo impresso) — data e valor por rótulos simples
//      ("Valor total", "Data de emissão"…); se não achar, diz e deixa preencher.
//
// A proposta tem o MESMO formato da leitura por IA (PropostaDocumento, Sprint 12):
// a tela a põe como rascunho no formulário e quem lança confere e clica em Lançar.
// A conta vem de `sugerirConta` (histórico e analíticas DA EMPRESA), nunca de IA.
// Regras puras; o texto do PDF e o banco ficam em lib/leituraSemIaServidor.ts.
import { acharBoletoNoTexto, lerBoleto, type BoletoLido } from './boleto';
import { mascararTexto, type PropostaDocumento } from './documentoLancamento';
import { decomporChaveNfe, lerNotaXml, papelDaEmpresa, type NotaLida } from './notaFiscalXml';
import {
  sugerirConta, type AnaliticaSugerivel, type ContaSugerivel, type Direcao, type ExemploConferido,
} from './sugestaoConta';

export type FonteLeitura = 'nfe' | 'nfce' | 'nfse' | 'boleto' | 'pdf';

export interface PropostaLeitura extends PropostaDocumento {
  fonte: FonteLeitura;
  /** Como a tela chama o que foi lido ("NF-e 1234", "Boleto Itaú", "PDF"). */
  titulo: string;
  /** Identidade do documento para apontar duplicidade (`nfe:…`, `nfse:…`, `boleto:…`). */
  chave: string | null;
  /** O que foi lido, para conferência (número, chave, banco, vencimento…). */
  detalhes: string[];
  /** Pagador da entrada (só em empresa que identifica pagador — Carnê-Leão/DMED). */
  pagadorNome: string | null;
  pagadorDocumento: string | null;
}

/** Lançamento que já veio do mesmo documento (duplicidade), como a tela mostra. */
export interface LancamentoAnterior { data: string; complemento: string | null; valor: number }

/** O que a regra sabe da empresa: o documento (para emitente × destinatário) e o pagador. */
export interface EmpresaLeitura { documento: string | null; identificaPagador: boolean }

/** Contexto de toda leitura: o exercício aberto, hoje e a direção que quem lança informou. */
export interface ContextoLeitura { ano: number; hoje: string; direcaoInformada: Direcao | null }

/** Tipos que a leitura sem IA aceita (o MIME gravado em `documentos.tipo`). */
export const TIPOS_LEITURA_SEM_IA = ['application/xml', 'application/pdf'] as const;

export function tipoLidoSemIa(mime: string | null | undefined): boolean {
  return (TIPOS_LEITURA_SEM_IA as readonly string[]).includes(String(mime ?? ''));
}

/** Do PDF só as primeiras páginas: nota, recibo e boleto cabem nelas. */
export const PAGINAS_PDF_SEM_IA = 3;

/** Formato aceito para a chave de duplicidade que a tela devolve ao lançar. */
export const FORMATO_CHAVE = /^(nfe|nfse|boleto):[0-9A-Za-z:]{8,80}$/;

const dataBR = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
const reais = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const ehCnpj = (d: string | null) => !!d && d.length === 14;

function formatarDocumento(d: string): string {
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return d;
}

/** Data dentro do exercício; fora dele vira aviso (como na leitura por IA). */
function dataNoExercicio(data: string | null, ano: number, avisos: string[], oQue: string): string | null {
  if (!data) return null;
  if (Number(data.slice(0, 4)) !== ano) {
    avisos.push(`${oQue} é de ${dataBR(data)}, fora do exercício de ${ano} — ajuste a data ou troque o exercício.`);
    return null;
  }
  return data;
}

function base(fonte: FonteLeitura, titulo: string): PropostaLeitura {
  return {
    fonte, titulo, chave: null, detalhes: [], data: null, valor: null, direcao: null, complemento: '',
    contaId: null, historico: null, historicoId: null, confianca: 1, avisos: [],
    pagadorNome: null, pagadorDocumento: null,
  };
}

/** Direção do documento × a informada por quem lança: o documento vence, com aviso. */
function decidirDirecao(p: PropostaLeitura, doDocumento: Direcao | null, ctx: ContextoLeitura) {
  p.direcao = doDocumento ?? ctx.direcaoInformada;
  if (doDocumento && ctx.direcaoInformada && doDocumento !== ctx.direcaoInformada) {
    p.avisos.push(`Você marcou ${ctx.direcaoInformada === 'entrada' ? 'recebimento' : 'pagamento'}, mas o documento indica ${doDocumento === 'entrada' ? 'um recebimento (entrada)' : 'um pagamento (saída)'} — confira.`);
  }
}

// ------------------------------------------------------------------ nota (XML)

const PREFIXO_NOTA: Record<NotaLida['tipo'], string> = { nfe: 'NF', nfce: 'NFC-e', nfse: 'NFS-e' };

/** A proposta a partir da nota já lida (do XML). */
export function propostaDaNota(nota: NotaLida, empresa: EmpresaLeitura, ctx: ContextoLeitura): PropostaLeitura {
  const nome = nota.numero ? `${nota.layout} ${nota.numero}` : nota.layout;
  const p = base(nota.tipo, nome);
  p.chave = nota.chaveDuplicidade;

  if (nota.cancelada) p.avisos.push('Esta NFS-e foi cancelada — normalmente não entra no caixa.');
  const { papel, direcao, filial } = papelDaEmpresa(nota, empresa.documento);
  if (!empresa.documento) {
    p.avisos.push('A empresa está sem CNPJ/CPF no cadastro: não dá para saber se a nota é de venda ou de compra. Escolha entrada ou saída.');
  } else if (!papel) {
    p.avisos.push('O CNPJ/CPF da empresa não aparece nesta nota (nem como emitente nem como destinatário) — confira se é desta empresa.');
  } else if (filial) {
    p.detalhes.push('A nota é de outro estabelecimento da mesma empresa (matriz/filial).');
  }
  decidirDirecao(p, direcao, ctx);

  const outra = papel === 'emitente' ? nota.destinatario : papel === 'destinatario' ? nota.emitente : nota.emitente;
  // Nome no complemento só de empresa (CNPJ). Pessoa física fica fora (pode ser
  // paciente/cliente): em empresa que identifica pagador, vai para o pagador.
  const numero = nota.numero ? `${PREFIXO_NOTA[nota.tipo]} ${nota.numero}` : PREFIXO_NOTA[nota.tipo];
  p.complemento = mascararTexto(ehCnpj(outra.documento) && outra.nome ? `${numero} — ${outra.nome}` : numero).slice(0, 80);
  if (empresa.identificaPagador && p.direcao === 'entrada' && outra.documento) {
    p.pagadorNome = outra.nome?.slice(0, 120) ?? null;
    p.pagadorDocumento = formatarDocumento(outra.documento);
  }

  p.data = dataNoExercicio(nota.dataEmissao, ctx.ano, p.avisos, 'A nota');
  if (!nota.dataEmissao) p.avisos.push('A nota não traz a data de emissão — preencha.');
  else if (p.data) p.detalhes.push(`Data de emissão ${dataBR(nota.dataEmissao)} — se o dinheiro entrou ou saiu em outro dia, ajuste.`);

  p.valor = nota.valor && nota.valor > 0 ? nota.valor : null;
  if (p.valor === null) p.avisos.push('A nota não traz o valor total — preencha.');
  if (nota.valorBruto && p.valor) {
    p.detalhes.push(`Valor líquido ${reais(p.valor)} (o serviço foi ${reais(nota.valorBruto)}; a diferença são as retenções).`);
  }
  if (nota.parcelas.length > 1) {
    const venc = nota.parcelas.map((x) => (x.vencimento ? dataBR(x.vencimento) : '?')).join(', ');
    p.avisos.push(`A nota tem ${nota.parcelas.length} parcelas (vencimentos ${venc}). O rascunho traz o total; no caixa, lance cada parcela na data em que foi paga.`);
  }
  if (nota.devolucao) p.avisos.push('É uma nota de devolução — confira se houve dinheiro devolvido.');
  if (nota.semPagamento) p.avisos.push('A nota diz "sem pagamento" (remessa, bonificação…) — talvez não haja movimento no caixa.');

  if (nota.serie && nota.tipo !== 'nfse') p.detalhes.push(`Série ${nota.serie}.`);
  if (nota.chaveAcesso) p.detalhes.push(`Chave de acesso ${nota.chaveAcesso.replace(/(\d{4})(?=\d)/g, '$1 ')}.`);
  if (!p.chave) p.avisos.push('A nota não tem identificação única (número e CNPJ do prestador): não deu para conferir se já foi lançada.');
  return p;
}

// ------------------------------------------------------------------ boleto

export function propostaDoBoleto(b: BoletoLido, ctx: ContextoLeitura): PropostaLeitura {
  const titulo = b.banco ? `Boleto ${b.banco.nome}` : `Boleto — ${b.segmento ?? 'arrecadação'}`;
  const p = base('boleto', titulo);
  p.chave = `boleto:${b.codigoBarras}`;
  // Boleto é pagamento; quem lança pode dizer que é recebimento (boleto que a empresa emitiu).
  p.direcao = ctx.direcaoInformada ?? 'saida';
  p.complemento = b.banco ? `Boleto ${b.banco.nome}` : `Boleto — ${b.segmento ?? 'conta'}`;
  p.valor = b.valor;
  p.data = dataNoExercicio(b.vencimento, ctx.ano, p.avisos, 'O vencimento');
  if (p.data) p.detalhes.push(`Vencimento ${dataBR(p.data)} — se pagou em outro dia, ajuste a data.`);
  p.avisos.push(...b.avisos);
  p.detalhes.push(`Linha digitável ${b.linhaDigitavel}.`);
  if (b.banco) p.detalhes.push(`Banco ${b.banco.codigo} (${b.banco.nome}) — é o banco que cobra, não necessariamente o fornecedor: complete o complemento.`);
  return p;
}

/** Linha digitável digitada → proposta, ou o erro claro ("confira o que foi digitado"). */
export function propostaDoCodigo(codigo: string, ctx: ContextoLeitura): { ok: true; proposta: PropostaLeitura } | { ok: false; erro: string } {
  const r = lerBoleto(codigo, ctx.hoje);
  return r.ok ? { ok: true, proposta: propostaDoBoleto(r.boleto, ctx) } : r;
}

// ------------------------------------------------------------------ PDF com texto

const MESES_EXTENSO = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

interface Achado<T> { valor: T; indice: number; peso: number; rotulo: string | null }

/** Rótulos de data, do mais forte para o mais fraco (peso). */
const ROTULOS_DATA: [RegExp, number, string][] = [
  [/\b(data d[oe] pagamento|pago em|paga em|data do recebimento|recebido em|data da transacao|data do credito)\s*:?\s*$/, 4, 'pagamento'],
  [/\b(data (de|da) emissao|emissao|emitid[oa] em|data de autorizacao)\s*:?\s*$/, 3, 'emissão'],
  [/\b(vencimento|data de vencimento|vence em)\s*:?\s*$/, 1, 'vencimento'],
  // Só "Data:" solto. "feito em", "entregue em" não dizem que é o dia do dinheiro.
  [/\b(data)\s*:?\s*$/, 2, 'data'],
];

/** Rótulos de valor (peso maior vence). */
const ROTULOS_VALOR: [RegExp, number][] = [
  [/\b(valor total da nota|valor total do documento|valor pago|valor recebido|total pago|total a pagar|valor liquido da nota|valor liquido|total geral|valor cobrado|importancia de|a quantia de)\s*[:(r$)\s]*$/, 4],
  [/\b(valor total|total da nota|valor do documento|valor do servico|valor dos servicos|total)\s*[:(r$)\s]*$/, 3],
  [/\b(valor)\s*[:(r$)\s]*$/, 2],
];

function rotuloAntes(texto: string, indice: number, rotulos: [RegExp, number, string?][]): { peso: number; rotulo: string | null } {
  // Até 50 caracteres antes, atravessando no máximo uma quebra de linha (rótulo
  // em cima, número embaixo, como no DANFE).
  const janela = semAcento(texto.slice(Math.max(0, indice - 50), indice)).split('\n').slice(-2).join(' ').replace(/\s+/g, ' ');
  for (const [re, peso, rotulo] of rotulos) if (re.test(janela)) return { peso, rotulo: rotulo ?? null };
  return { peso: 0, rotulo: null };
}

function datasDoTexto(texto: string): Achado<string>[] {
  const achados: Achado<string>[] = [];
  const validar = (a: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(a, m - 1, d));
    return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d && a >= 2000 && a <= 2100
      ? dt.toISOString().slice(0, 10) : null;
  };
  for (const m of texto.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g)) {
    const v = validar(Number(m[3]), Number(m[2]), Number(m[1]));
    if (v) achados.push({ valor: v, indice: m.index ?? 0, ...rotuloAntes(texto, m.index ?? 0, ROTULOS_DATA) });
  }
  const sa = semAcento(texto); // mesmo tamanho do texto quando os acentos são compostos (NFC)
  for (const m of sa.matchAll(/\b(\d{1,2}) de ([a-z]+) de (\d{4})\b/g)) {
    const mes = MESES_EXTENSO.indexOf(m[2]) + 1;
    const v = mes ? validar(Number(m[3]), mes, Number(m[1])) : null;
    if (v) achados.push({ valor: v, indice: m.index ?? 0, ...rotuloAntes(sa, m.index ?? 0, ROTULOS_DATA) });
  }
  return achados;
}

function valoresDoTexto(texto: string): (Achado<number> & { comCifrao: boolean })[] {
  const achados: (Achado<number> & { comCifrao: boolean })[] = [];
  for (const m of texto.matchAll(/(R\$\s*)?\b(\d{1,3}(?:\.\d{3})+|\d+),(\d{2})\b/g)) {
    const v = Number(`${m[2].replace(/\./g, '')}.${m[3]}`);
    if (!(v > 0 && v < 1e9)) continue;
    const r = rotuloAntes(texto, m.index ?? 0, ROTULOS_VALOR);
    achados.push({ valor: v, indice: m.index ?? 0, peso: r.peso, rotulo: null, comCifrao: !!m[1] });
  }
  return achados;
}

/** A data do documento: o rótulo mais forte, se for um só; ou a única data dentro do exercício. */
function escolherData(texto: string, ano: number): { data: string | null; rotulo: string | null; aviso: string | null } {
  const todas = datasDoTexto(texto);
  const doAno = todas.filter((d) => Number(d.valor.slice(0, 4)) === ano);
  if (todas.length === 0) return { data: null, rotulo: null, aviso: 'Não achei data no documento — preencha.' };
  if (doAno.length === 0) {
    return { data: null, rotulo: null, aviso: `As datas do documento (${[...new Set(todas.map((d) => dataBR(d.valor)))].slice(0, 3).join(', ')}) estão fora do exercício de ${ano} — ajuste a data ou troque o exercício.` };
  }
  const maior = Math.max(...doAno.map((d) => d.peso));
  const topo = [...new Set(doAno.filter((d) => d.peso === maior).map((d) => d.valor))];
  if (maior > 0 && topo.length === 1) {
    const rotulo = doAno.find((d) => d.peso === maior)?.rotulo ?? null;
    return { data: topo[0], rotulo, aviso: rotulo === 'vencimento' ? 'A data lida é a do vencimento — se pagou em outro dia, ajuste.' : null };
  }
  const distintas = [...new Set(doAno.map((d) => d.valor))];
  if (distintas.length === 1) return { data: distintas[0], rotulo: null, aviso: null };
  return { data: null, rotulo: null, aviso: `Achei mais de uma data (${distintas.slice(0, 4).map(dataBR).join(', ')}) e não sei qual é a do pagamento — preencha.` };
}

/** O valor: o do rótulo mais forte (o maior, se o rótulo se repete com valores diferentes) ou o único com R$. */
function escolherValor(texto: string): { valor: number | null; aviso: string | null } {
  const todos = valoresDoTexto(texto);
  const rotulados = todos.filter((v) => v.peso > 0);
  if (rotulados.length) {
    const maior = Math.max(...rotulados.map((v) => v.peso));
    const topo = [...new Set(rotulados.filter((v) => v.peso === maior).map((v) => v.valor))];
    const valor = Math.max(...topo);
    return { valor, aviso: topo.length > 1 ? `Achei mais de um total (${topo.slice(0, 4).map(reais).join(', ')}); usei o maior — confira.` : null };
  }
  const comCifrao = [...new Set(todos.filter((v) => v.comCifrao).map((v) => v.valor))];
  if (comCifrao.length === 1) return { valor: comCifrao[0], aviso: null };
  if (comCifrao.length > 1) return { valor: null, aviso: `Achei vários valores (${comCifrao.slice(0, 4).map(reais).join(', ')}) e não sei qual é o total — preencha.` };
  return { valor: null, aviso: 'Não achei o valor no documento — preencha.' };
}

/** Chave de acesso de NF-e/NFC-e impressa (DANFE), em grupos de 4 ou corrida. */
function chaveNoTexto(texto: string): string | null {
  for (const m of texto.matchAll(/\d(?:[\d ]{42,60})\d/g)) {
    const n = m[0].replace(/\D/g, '');
    for (let i = 0; i + 44 <= n.length; i++) {
      const c = n.slice(i, i + 44);
      if (decomporChaveNfe(c)) return c;
    }
  }
  return null;
}

/** Texto mínimo para dizer que o PDF tem texto (e não é só uma imagem escaneada). */
export const MINIMO_TEXTO_PDF = 20;

/**
 * Lê o texto de um PDF (já extraído no servidor). Ordem: boleto (linha
 * digitável válida) → DANFE (chave de acesso válida) → recibo/nota por rótulos.
 * `null` = o PDF não tem texto (escaneado) — a tela diz e a pessoa preenche.
 */
export function propostaDoTextoPdf(texto: string, empresa: EmpresaLeitura, ctx: ContextoLeitura): PropostaLeitura | null {
  const t = String(texto ?? '').replace(/\r/g, '').replace(/[ \t]+/g, ' ');
  if (t.replace(/\s/g, '').length < MINIMO_TEXTO_PDF) return null;

  const boleto = acharBoletoNoTexto(t, ctx.hoje);
  if (boleto) {
    const p = propostaDoBoleto(boleto, ctx);
    p.detalhes.unshift('Linha digitável achada no PDF.');
    return p;
  }

  const sa = semAcento(t);
  const chave = chaveNoTexto(t);
  const partes = chave ? decomporChaveNfe(chave) : null;
  let p: PropostaLeitura;
  if (chave && partes) {
    const tipo = partes.modelo === '65' ? 'nfce' : 'nfe';
    p = base(tipo, `${tipo === 'nfce' ? 'NFC-e' : 'NF-e'} ${partes.numero} (DANFE)`);
    p.chave = `nfe:${chave}`;
    p.complemento = `${tipo === 'nfce' ? 'NFC-e' : 'NF'} ${partes.numero}`;
    p.detalhes.push(`Chave de acesso ${chave.replace(/(\d{4})(?=\d)/g, '$1 ')}.`);
    // A chave diz quem emitiu: a empresa emitiu → venda (entrada); senão, compra (saída).
    const doc = String(empresa.documento ?? '').replace(/\D/g, '');
    const emitiu = !!doc && (doc === partes.cnpjEmitente || (doc.length === 14 && doc.slice(0, 8) === partes.cnpjEmitente.slice(0, 8)));
    decidirDirecao(p, doc ? (emitiu ? 'entrada' : 'saida') : null, ctx);
    p.detalhes.push('Do PDF da nota (DANFE): se tiver o XML, ele é mais exato.');
  } else {
    const recibo = /\brecibo\b/.test(sa);
    p = base('pdf', recibo ? 'Recibo (PDF)' : 'Documento (PDF)');
    const num = /\b(recibo|nota fiscal|nf-?e?|nfs-?e|cupom|fatura)\s*(n[ºo°.]*|numero)?\s*:?\s*(\d{1,10})\b/i.exec(sa);
    const rotulo = num ? (num[1].startsWith('recibo') ? 'Recibo' : num[1].startsWith('fatura') ? 'Fatura' : num[1].startsWith('cupom') ? 'Cupom' : 'NF') : (recibo ? 'Recibo' : '');
    p.complemento = num ? `${rotulo} ${num[3]}` : rotulo;
    decidirDirecao(p, null, ctx);
    if (!p.direcao) p.avisos.push('Diga se é pagamento (saída) ou recebimento (entrada) — o PDF não deixa claro.');
    // Regras simples: a leitura do PDF é menos certa que a do XML.
    p.confianca = 0.7;
  }

  const d = escolherData(t, ctx.ano);
  p.data = d.data;
  if (d.aviso) p.avisos.push(d.aviso);
  else if (d.data) p.detalhes.push(`Data lida${d.rotulo ? ` (${d.rotulo})` : ''}: ${dataBR(d.data)}.`);
  const v = escolherValor(t);
  p.valor = v.valor;
  if (v.aviso) p.avisos.push(v.aviso);
  if (p.fonte === 'pdf' && (p.data === null || p.valor === null)) p.confianca = 0.5;
  return p;
}

// ------------------------------------------------------------------ XML

/** Lê o XML (bytes) → proposta, ou o erro claro. */
export function propostaDoXml(conteudo: string, empresa: EmpresaLeitura, ctx: ContextoLeitura):
  { ok: true; proposta: PropostaLeitura } | { ok: false; erro: string } {
  const r = lerNotaXml(conteudo);
  return r.ok ? { ok: true, proposta: propostaDaNota(r.nota, empresa, ctx) } : r;
}

// ------------------------------------------------------------------ conta

/**
 * A conta pelo que a empresa já tem — histórico de lançamentos e analíticas
 * (`sugerirConta`, a mesma da tela) —, nunca por IA. Sem direção ou sem
 * sugestão segura, a conta fica em branco com o aviso "escolha a conta".
 */
export function comContaSugerida(
  p: PropostaLeitura,
  baseSugestao: { exemplos: ExemploConferido[]; contas: ContaSugerivel[]; analiticas: AnaliticaSugerivel[] },
): PropostaLeitura {
  const r = p.direcao
    ? sugerirConta({
      complemento: p.complemento, direcao: p.direcao, valor: p.valor,
      pagadorNome: p.pagadorNome, pagadorDocumento: p.pagadorDocumento,
    }, baseSugestao)
    : null;
  const s = r?.sugestao;
  if (s) {
    p.contaId = s.contaId; p.historico = s.historico; p.historicoId = s.historicoId;
    p.detalhes.push(`Conta sugerida pelo que a empresa já lançou: ${s.motivo}.`);
  } else {
    p.avisos.push('Escolha a conta — o histórico da empresa ainda não aponta uma com segurança.');
  }
  return p;
}
