// Documento → lançamento sugerido por IA (Sprint 12, Frente A) — regras puras.
//
// A IA lê um documento já enviado (nota, recibo, boleto, comprovante — foto ou
// PDF) e PROPÕE um lançamento do Livro Caixa: data, valor, entrada/saída,
// complemento e a conta, escolhida só entre as da empresa. A proposta nunca grava:
// a tela preenche o formulário como rascunho e quem lança confere e clica em Lançar.
//
// Duas travas, as duas desligadas por padrão (decisão do dono, 21/11/2026):
//   1. plataforma — `CAIXA_IA_DOCUMENTO=ligada` (e a chave do Gemini);
//   2. empresa — `empresas.caixa_ia_documento` (0029), que só a contabilidade liga.
// E, como a IA do caixa (lib/caixaInteligente.ts), nunca para empresa que
// identifica pagador (clínica/saúde): o documento pode trazer dado de saúde.
//
// Sem I/O aqui: quem chama o Gemini e grava é a rota /api/caixa/documento-ia.
import type { AnaliticaSugerivel, ContaSugerivel, Direcao, OpcaoIa } from './sugestaoConta';
import { opcoesParaIa } from './sugestaoConta';

/**
 * Tipos que a IA lê (o MIME gravado em `documentos.tipo`). XML/OFX/CSV/XLSX ficam
 * fora, e HEIC também: não dá para tirar os metadados dele (localização do
 * celular) sem uma biblioteca de imagem — a foto tirada pelo navegador já é JPG.
 */
export const TIPOS_LIDOS_PELA_IA = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;

export function tipoLidoPelaIa(mime: string | null | undefined): boolean {
  return (TIPOS_LIDOS_PELA_IA as readonly string[]).includes(String(mime ?? ''));
}

/**
 * Categorias do portal que a IA lê. Extrato (dados bancários de terceiros) e
 * folha (nome, CPF e salário de empregados) nunca vão — nem chamando a API direto.
 */
export const CATEGORIAS_LIDAS_PELA_IA = ['nota', 'recibo', 'outros'] as const;

export function categoriaLidaPelaIa(c: string | null | undefined): boolean {
  return (CATEGORIAS_LIDAS_PELA_IA as readonly string[]).includes(String(c ?? ''));
}

/** Do PDF só vão as primeiras páginas: nota, recibo e boleto cabem nelas (minimização). */
export const PAGINAS_PDF_PARA_IA = 2;

/**
 * Leituras de documento por mês **por empresa** quando quem lê é o cliente — um
 * cliente não esgota a cota do escritório (que é a mesma da folha de ponto).
 * Mesmo espírito do `LIMITE_IA_EMPRESA_CLIENTE` da 0017.
 */
export const LIMITE_DOCUMENTOS_EMPRESA_CLIENTE = 30;

/**
 * Prefixo de `ponto_leituras_ocr.usuario` quando quem leu o documento é o CLIENTE.
 * É por ele que a subcota acima conta: só as leituras do cliente, não as que a
 * contabilidade faz na mesma empresa. Não começa por `cliente:` de propósito — esse
 * prefixo é o das leituras automáticas da folha de ponto (teto e ritmo próprios em
 * lib/envioPontoServidor.ts), que não devem enxergar as do caixa.
 */
export const PREFIXO_LEITURA_CLIENTE = 'cliente-documento:';

/** O que vai em `usuario` na reserva da leitura: o e-mail, marcado quando é o cliente. */
export function leitorDaLeitura(sessao: { email: string; role: string }): string {
  return sessao.role === 'cliente' ? `${PREFIXO_LEITURA_CLIENTE}${sessao.email}` : sessao.email;
}

// ------------------------------------------------------------------ metadados

const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u32le = (b: Uint8Array, i: number) => b[i] + (b[i + 1] << 8) + (b[i + 2] << 16) + ((b[i + 3] << 24) >>> 0);
const tag = (b: Uint8Array, i: number) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);

function juntar(partes: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
}

/** JPEG sem APP1 (EXIF/XMP — GPS, aparelho, horário), APP13 (IPTC) e comentários. */
function jpegSemMetadados(b: Uint8Array): Uint8Array | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  const partes: Uint8Array[] = [b.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1];
    if (m === 0xda) { partes.push(b.subarray(i)); return juntar(partes); } // início da imagem: o resto vai como está
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { partes.push(b.subarray(i, i + 2)); i += 2; continue; }
    const fim = i + 2 + ((b[i + 2] << 8) | b[i + 3]);
    if (fim > b.length) return null;
    if (m !== 0xe1 && m !== 0xed && m !== 0xfe) partes.push(b.subarray(i, fim));
    i = fim;
  }
  return null;
}

/** PNG sem eXIf e sem textos (tEXt/iTXt/zTXt — autor, software, data). */
function pngSemMetadados(b: Uint8Array): Uint8Array | null {
  if (b.length < 8 || b[0] !== 0x89 || tag(b, 1).slice(0, 3) !== 'PNG') return null;
  const partes: Uint8Array[] = [b.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= b.length) {
    const fim = i + 12 + u32be(b, i);
    if (fim > b.length) return null;
    const tipo = tag(b, i + 4);
    if (!['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME'].includes(tipo)) partes.push(b.subarray(i, fim));
    i = fim;
    if (tipo === 'IEND') return juntar(partes);
  }
  return null;
}

/** WEBP sem os blocos EXIF e XMP (e com as marcas deles apagadas no VP8X). */
function webpSemMetadados(b: Uint8Array): Uint8Array | null {
  if (b.length < 12 || tag(b, 0) !== 'RIFF' || tag(b, 8) !== 'WEBP') return null;
  const partes: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= b.length) {
    const tam = u32le(b, i + 4);
    const fim = i + 8 + tam + (tam % 2);
    if (i + 8 + tam > b.length) return null;
    const tipo = tag(b, i);
    if (tipo === 'VP8X') {
      const c = b.slice(i, Math.min(fim, b.length));
      c[8] &= ~0x0c; // bits de EXIF (0x08) e XMP (0x04)
      partes.push(c);
    } else if (tipo !== 'EXIF' && tipo !== 'XMP ') {
      partes.push(b.subarray(i, Math.min(fim, b.length)));
    }
    i = fim;
  }
  const corpo = juntar(partes);
  const cab = new Uint8Array(12);
  cab.set(b.subarray(0, 4), 0);
  const total = corpo.length + 4;
  cab.set([total & 0xff, (total >> 8) & 0xff, (total >> 16) & 0xff, (total >>> 24) & 0xff], 4);
  cab.set(b.subarray(8, 12), 8);
  return juntar([cab, corpo]);
}

/**
 * A foto sem metadados (localização, aparelho, horário) antes de ir à IA. `null` =
 * não deu para limpar (arquivo fora do formato) — a rota recusa em vez de mandar
 * como está. A imagem em si não muda — por isso, foto com orientação EXIF (celular
 * em pé gravando "gire 90°") precisa ser endireitada ANTES (lib/fotoParaIa.ts), ou
 * chegaria deitada à IA, já que a marca de orientação sai junto com o EXIF.
 */
export function imagemSemMetadados(bytes: Uint8Array, mime: string): Uint8Array | null {
  if (mime === 'image/jpeg') return jpegSemMetadados(bytes);
  if (mime === 'image/png') return pngSemMetadados(bytes);
  if (mime === 'image/webp') return webpSemMetadados(bytes);
  return null;
}

// ------------------------------------------------------------------ orientação

/** Orientação (tag 0x0112) de um bloco TIFF/EXIF; 1 quando não há ou não dá para ler. */
function orientacaoTiff(b: Uint8Array, ini: number, fim: number): number {
  if (ini + 8 > fim) return 1;
  const le = b[ini] === 0x49 && b[ini + 1] === 0x49; // "II" = little-endian; "MM" = big-endian
  if (!le && !(b[ini] === 0x4d && b[ini + 1] === 0x4d)) return 1;
  const u16 = (i: number) => (le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  const u32 = (i: number) => (le ? u32le(b, i) : u32be(b, i));
  if (u16(ini + 2) !== 42) return 1;
  const ifd = ini + u32(ini + 4);
  if (ifd + 2 > fim) return 1;
  const n = u16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12;
    if (e + 12 > fim) return 1;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

const EXIF_CAB = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif" + dois zeros
const comCabExif = (b: Uint8Array, i: number) => EXIF_CAB.every((x, k) => b[i + k] === x);

/**
 * A orientação EXIF da foto (1 a 8; 1 = já está em pé). Lê JPEG (APP1 Exif), PNG
 * (eXIf) e WEBP (bloco EXIF). Arquivo torto ou sem a marca → 1 (nada a girar).
 */
export function orientacaoExif(b: Uint8Array, mime: string): number {
  try {
    if (mime === 'image/jpeg') {
      if (b[0] !== 0xff || b[1] !== 0xd8) return 1;
      let i = 2;
      while (i + 4 <= b.length && b[i] === 0xff) {
        const m = b[i + 1];
        if (m === 0xda) return 1;
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        const fim = i + 2 + ((b[i + 2] << 8) | b[i + 3]);
        if (fim > b.length) return 1;
        if (m === 0xe1 && comCabExif(b, i + 4)) return orientacaoTiff(b, i + 10, fim);
        i = fim;
      }
      return 1;
    }
    if (mime === 'image/png') {
      let i = 8;
      while (i + 12 <= b.length) {
        const tam = u32be(b, i);
        const tipo = tag(b, i + 4);
        if (tipo === 'eXIf') return orientacaoTiff(b, i + 8, Math.min(b.length, i + 8 + tam));
        if (tipo === 'IDAT' || tipo === 'IEND') return 1; // eXIf vem antes da imagem
        i += 12 + tam;
      }
      return 1;
    }
    if (mime === 'image/webp') {
      if (b.length < 12 || tag(b, 0) !== 'RIFF' || tag(b, 8) !== 'WEBP') return 1;
      let i = 12;
      while (i + 8 <= b.length) {
        const tam = u32le(b, i + 4);
        if (tag(b, i) === 'EXIF') {
          const ini = comCabExif(b, i + 8) ? i + 14 : i + 8;
          return orientacaoTiff(b, ini, Math.min(b.length, i + 8 + tam));
        }
        i += 8 + tam + (tam % 2);
      }
      return 1;
    }
  } catch { /* torto: trata como em pé */ }
  return 1;
}

/** A plataforma ligou a leitura de documentos? (trava 1) */
export function iaDocumentoNaPlataforma(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.CAIXA_IA_DOCUMENTO ?? '').trim().toLowerCase() === 'ligada' && !!chaveGeminiDocumento(env);
}

/**
 * Chave do Gemini desta função: `GEMINI_API_KEY_CAIXA` (recomendada — uma chave do
 * plano pago só para os documentos do caixa) ou, sem ela, a `GEMINI_API_KEY` da plataforma.
 */
export function chaveGeminiDocumento(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.GEMINI_API_KEY_CAIXA?.trim() || env.GEMINI_API_KEY?.trim() || null;
}

export type MotivoIndisponivel = 'plataforma' | 'saude' | 'empresa' | null;

export interface SituacaoIaDocumento {
  /** Trava 1. */
  plataforma: boolean;
  /** Trava 2 (opção da empresa). */
  ligadaNaEmpresa: boolean;
  /** Empresa que identifica pagador: nunca usa (dado de saúde). */
  saude: boolean;
  /** Pode ler agora? (as duas travas e não é saúde) */
  disponivel: boolean;
  motivo: MotivoIndisponivel;
}

export function situacaoIaDocumento(
  empresa: { iaDocumento?: boolean; identificaPagador?: boolean } | null,
  env: NodeJS.ProcessEnv = process.env,
): SituacaoIaDocumento {
  const plataforma = iaDocumentoNaPlataforma(env);
  const saude = !!empresa?.identificaPagador;
  const ligadaNaEmpresa = !!empresa?.iaDocumento;
  const motivo: MotivoIndisponivel = !plataforma ? 'plataforma' : saude ? 'saude' : !ligadaNaEmpresa ? 'empresa' : null;
  return { plataforma, ligadaNaEmpresa, saude, disponivel: motivo === null && !!empresa, motivo };
}

export const MENSAGEM_INDISPONIVEL: Record<Exclude<MotivoIndisponivel, null>, string> = {
  plataforma: 'A leitura de documentos por IA não está ligada nesta plataforma.',
  saude: 'A leitura de documentos por IA não é usada em empresa que identifica pagador (dados de saúde).',
  empresa: 'A leitura de documentos por IA não está ligada para esta empresa. A contabilidade liga no Livro Caixa, em "Documentos".',
};

// ------------------------------------------------------------------ opções

/** Opção de conta para a IA, com a natureza (para não aceitar receita numa saída). */
export interface OpcaoDocumento extends OpcaoIa { natureza: 'receita' | 'despesa' }

/**
 * As contas que a IA pode escolher: as analíticas DA EMPRESA (ou, sem nenhuma, as
 * titulares da empresa), na natureza da direção quando quem lança a informou. A
 * lista vem já recortada pela sessão (lib/caixa → contasDaEmpresa/historicosDaEmpresa).
 */
export function opcoesDocumento(
  direcao: Direcao | null, contas: ContaSugerivel[], analiticas: AnaliticaSugerivel[],
): OpcaoDocumento[] {
  const natConta = new Map(contas.map((c) => [c.id, c.natureza]));
  const natAnalitica = new Map(analiticas.map((a) => [a.id, a.natureza]));
  return opcoesParaIa(direcao, contas, analiticas).map((o) => ({
    ...o,
    natureza: (o.historicoId ? natAnalitica.get(o.historicoId) : undefined)
      ?? (o.contaId ? natConta.get(o.contaId) : undefined) ?? 'despesa',
  }));
}

// ------------------------------------------------------------------ prompt

/**
 * O texto que acompanha o documento. Não leva nome, CNPJ nem e-mail de ninguém —
 * nem da empresa, nem de quem lança, nem o nome do arquivo (pode trazer nome de
 * pessoa). Só o exercício, a direção (se informada) e a lista de contas da empresa.
 */
export function montarPromptDocumento(p: { ano: number; direcao: Direcao | null; opcoes: OpcaoDocumento[] }): string {
  const lista = p.opcoes.map((o, i) => `${i}. ${o.rotulo} (${o.natureza === 'receita' ? 'entrada' : 'saída'})`).join('\n');
  const direcao = p.direcao === 'entrada'
    ? 'Quem lança informou que é uma ENTRADA no caixa (a empresa RECEBEU o dinheiro).'
    : p.direcao === 'saida'
      ? 'Quem lança informou que é uma SAÍDA do caixa (a empresa PAGOU).'
      : 'Quem lança não informou se é entrada ou saída: deduza pelo documento (na dúvida, comprovante de pagamento, boleto, nota de compra e recibo de fornecedor são SAÍDA).';
  return `Você lê documentos (nota fiscal, recibo, boleto, comprovante de pagamento) de uma pequena empresa brasileira
para propor UM lançamento do Livro Caixa dela, no exercício de ${p.ano}. Uma pessoa vai conferir antes de gravar.

${direcao}

Extraia:
- data: a data do pagamento ou do recebimento (se não houver, a data de emissão), no formato AAAA-MM-DD; null se não der para ler;
- valor: o valor total efetivamente pago ou recebido, em reais, como número (ex.: 1234.56); null se não der para ler;
- direcao: "entrada" ou "saida";
- complemento: descrição curta para o livro (até 80 caracteres), no padrão "NF 1234 — Nome do fornecedor" ou
  "Boleto — Nome da empresa" ou "Recibo — serviço". Use o nome do estabelecimento/empresa, nunca o nome de uma
  pessoa física. NÃO escreva CPF, RG, endereço, telefone, e-mail, nome de paciente nem dado de saúde;
- indice: o número da conta da lista abaixo que melhor classifica o lançamento; null se nenhuma servir com segurança.
  Use só os números da lista; não invente conta;
- confianca: de 0 a 1, o quanto você tem certeza da leitura;
- legivel: false se o arquivo não for um documento financeiro ou estiver ilegível.

Contas desta empresa:
${lista || '(nenhuma — responda indice = null)'}

Responda SOMENTE com o JSON no schema fornecido.`;
}

// ------------------------------------------------------------------ resposta

/**
 * Tira da resposta o que parece dado pessoal, caso a IA tenha escrito mesmo assim:
 * sequências de 11+ dígitos (CPF, CNPJ, linha digitável), CPF formatado, telefone
 * e e-mail. Números curtos (nº da nota) ficam.
 */
export function mascararTexto(s: string): string {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩]/g, ' ')
    .replace(/\S+@\S+/g, '[e-mail]')
    .replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, '[número]')
    .replace(/\(?\b\d{2}\)?\s*\d{4,5}-\d{4}\b/g, '[telefone]')
    .replace(/\b\d{4,5}-\d{4}\b/g, '[telefone]')
    .replace(/\d[\d.\-/ ]{9,}\d/g, (m) => (m.replace(/\D/g, '').length >= 11 ? '[número]' : m))
    .replace(/\b(CPF|RG)\s*:?\s*\[número\]/gi, '[número]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export interface PropostaDocumento {
  data: string | null;
  valor: number | null;
  direcao: Direcao | null;
  complemento: string;
  contaId: string | null;
  historico: string | null;
  historicoId: string | null;
  confianca: number;
  /** O que quem lança precisa olhar com mais cuidado (data fora do exercício etc.). */
  avisos: string[];
}

const dataReal = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const dataBR = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

/**
 * Lê a resposta da IA. JSON torto ou documento ilegível vira `null`; campo que não
 * passa na validação vira vazio (com aviso) — nunca um valor inventado. A conta só
 * fica se o índice está na lista e a natureza bate com a direção.
 */
export function interpretarLeitura(
  texto: string | null | undefined, opcoes: OpcaoDocumento[],
  ctx: { ano: number; direcaoInformada: Direcao | null },
): PropostaDocumento | null {
  let r: Record<string, unknown>;
  try { r = JSON.parse(String(texto ?? '')); } catch { return null; }
  if (!r || typeof r !== 'object' || r.legivel === false) return null;

  const avisos: string[] = [];

  let data: string | null = typeof r.data === 'string' && dataReal(r.data.trim()) ? r.data.trim() : null;
  if (data && Number(data.slice(0, 4)) !== ctx.ano) {
    avisos.push(`O documento é de ${dataBR(data)}, fora do exercício de ${ctx.ano} — ajuste a data ou troque o exercício.`);
    data = null;
  }
  if (!data && !avisos.length) avisos.push('A IA não leu a data — preencha.');

  const v = typeof r.valor === 'number' ? r.valor : Number(String(r.valor ?? '').replace(',', '.'));
  const valor = Number.isFinite(v) && v > 0 && v < 1e9 ? Math.round(v * 100) / 100 : null;
  if (valor === null) avisos.push('A IA não leu o valor — preencha.');

  const lida: Direcao | null = r.direcao === 'entrada' || r.direcao === 'saida' ? r.direcao : null;
  const direcao = ctx.direcaoInformada ?? lida;

  let contaId: string | null = null; let historico: string | null = null; let historicoId: string | null = null;
  const i = Number(r.indice);
  if (r.indice !== null && r.indice !== undefined && Number.isInteger(i) && i >= 0 && i < opcoes.length) {
    const o = opcoes[i];
    const natureza = direcao === 'entrada' ? 'receita' : direcao === 'saida' ? 'despesa' : null;
    if (!natureza || o.natureza === natureza) {
      contaId = o.contaId; historico = o.historico; historicoId = o.historicoId;
    }
  }
  if (!historico) avisos.push('A IA não achou uma conta segura entre as da empresa — escolha a conta.');

  const c = Number(r.confianca);
  const confianca = Math.round((Number.isFinite(c) ? Math.max(0, Math.min(1, c)) : 0.3) * 1000) / 1000;

  return {
    data, valor, direcao, complemento: mascararTexto(typeof r.complemento === 'string' ? r.complemento : ''),
    contaId, historico, historicoId, confianca, avisos,
  };
}
