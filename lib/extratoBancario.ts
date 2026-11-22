// Extrato bancário no Livro Caixa (Sprint 17, Frente D) — regra PURA.
//
// Lê OFX (1.x SGML e 2.x XML) e CSV dos bancos (com mapeamento de colunas), sem
// serviço externo nem IA, e concilia com o livro:
//   - cada linha do extrato vira uma SUGESTÃO de lançamento (nada grava sozinho);
//   - linha que já está no caixa (mesma direção, mesmo valor, data ± 2 dias) é
//     CASADA, não duplicada; a mesma linha importada de novo (FITID, ou a linha do
//     CSV) é reconhecida pela chave;
//   - o que está no caixa e não no banco, no período do extrato, sai como diferença.
//
// A REGRA DA CONTADORA (docs/livro-caixa.md): a conta bancária fica FORA do caixa —
// depósito no banco é SAÍDA do caixa, retirada é ENTRADA, e pagamento com cheque
// gera DOIS lançamentos. Por isso o modo padrão (`par`) traduz cada linha do banco
// do jeito que o cheque já é lançado hoje:
//   - pagamento pelo banco (débito)  → "Retirada de conta corrente" (entrada, sem
//     conta) + o pagamento (saída, conta sugerida);
//   - recebimento no banco (crédito) → o recebimento (entrada, conta sugerida) +
//     "Depósito em conta corrente" (saída, sem conta);
//   - saque (débito)                 → só a retirada (entrada);
//   - depósito em dinheiro (crédito) → só o depósito (saída).
// O saldo do caixa só muda com saque e depósito em dinheiro — o banco fica fora —, e
// as receitas e despesas ficam registradas. O modo `direto` (banco DENTRO do caixa)
// existe por empresa para o caso de a Edilse dizer que é assim em algum cliente: aí
// cada linha vira um lançamento só, e saque/depósito em dinheiro ficam de fora
// (neutros). A pergunta está em docs/empresa/reuniao-edilse.md.
//
// Sem import de servidor: roda nos testes e poderia rodar no navegador.
import { normalizarTexto, sugerirConta, type AnaliticaSugerivel, type ContaSugerivel, type Direcao, type ExemploConferido } from './sugestaoConta';

export type Sentido = 'credito' | 'debito';
export type TipoLinha = 'movimento' | 'saque' | 'deposito' | 'cheque';
export type ModoExtrato = 'par' | 'direto';
export const MODO_PADRAO: ModoExtrato = 'par';
export const MODOS: readonly ModoExtrato[] = ['par', 'direto'];

/** Os textos das pernas de transferência — os mesmos do catálogo e do cheque. */
export const HISTORICO_RETIRADA = 'Retirada de conta corrente';
export const HISTORICO_DEPOSITO = 'Depósito em conta corrente';

/** Teto de linhas por arquivo e de tamanho do arquivo. */
export const MAX_LINHAS_EXTRATO = 5000;
export const MAX_BYTES_EXTRATO = 2 * 1024 * 1024;
/** Tolerância de data do casamento (dias) e de valor (reais). */
export const JANELA_DIAS = 2;
const TOLERANCIA_VALOR = 0.005;

/** Chave de uma linha importada: `ofx:`/`csv:` + 26 hex, e `#n` quando repete no arquivo. */
export const FORMATO_CHAVE_EXTRATO = /^(ofx|csv):[0-9a-f]{26}(#\d{1,4})?$/;

export interface LinhaExtrato {
  chave: string;
  /** AAAA-MM-DD. */
  data: string;
  /** Sempre positivo; o lado vem em `sentido`. */
  valor: number;
  sentido: Sentido;
  /** Histórico do banco, já com CPF/números longos mascarados. */
  historico: string;
  documento: string | null;
  tipo: TipoLinha;
  /** Posição no arquivo (1, 2, …) — desempata e ordena a tela. */
  ordem: number;
}

/** Mapeamento das colunas do CSV (índice da coluna, a partir de 0). */
export interface MapaCsv {
  data: number;
  historico: number;
  /** Uma coluna com o valor assinado (ou com D/C ao lado, em `tipo`)… */
  valor: number | null;
  /** …ou duas colunas, crédito e débito. */
  credito: number | null;
  debito: number | null;
  /** Coluna "D/C" / "Tipo" que diz o lado quando o valor vem sem sinal. */
  tipo: number | null;
  documento: number | null;
}

export interface InfoCsv {
  separador: string;
  colunas: string[];
  amostra: string[][];
  mapa: MapaCsv | null;
}

export interface LeituraExtrato {
  formato: 'ofx' | 'csv';
  linhas: LinhaExtrato[];
  periodo: { de: string; ate: string };
  /** "Banco 341 · conta final 4321" (nunca o número inteiro). */
  conta: string | null;
  /** Linhas que não viraram lançamento (saldo do dia, valor zero, data inválida). */
  descartadas: number;
  avisos: string[];
  csv?: InfoCsv;
}

export type ResultadoExtrato =
  | { ok: true; leitura: LeituraExtrato }
  | { ok: false; erro: string; csv?: InfoCsv };

// ------------------------------------------------------------------ utilidades

/** Hash estável de 104 bits (dois cyrb53), em 26 hex — não é segredo, é identidade. */
export function hashTexto(s: string): string {
  const cyrb = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 2654435761);
      h2 = Math.imul(h2 ^ c, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0').slice(-13);
  };
  return cyrb(1) + cyrb(7);
}

const centavos = (v: number) => Math.round(v * 100);
const iso = (a: number, m: number, d: number) =>
  `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function dataValida(a: number, m: number, d: number): string | null {
  if (!(a >= 2000 && a <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const t = new Date(Date.UTC(a, m - 1, d));
  if (t.getUTCMonth() !== m - 1) return null;
  return iso(a, m, d);
}

/** Dias entre duas datas AAAA-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function somarDias(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** CPF, números longos (conta, CNPJ, código) e e-mail viram marcador no histórico. */
export function mascararHistorico(s: string): string {
  return s
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[e-mail]')
    .replace(/[*\dX]{3}\.[*\dX]{3}\.[*\dX]{3}-[*\dX]{2}/gi, '[CPF]')
    .replace(/\d[\d./-]{9,}\d/g, (m) => (m.replace(/\D/g, '').length >= 11 ? '[número]' : m))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/**
 * Valor em reais escrito por banco: "-1.234,56", "1234.56", "R$ 1.234,56 D",
 * "(50,00)", "100,00-". Devolve o valor ASSINADO (débito negativo quando o texto diz).
 * `decimalPonto`: o OFX usa ponto como decimal (salvo quando há vírgula).
 */
export function lerValorBanco(bruto: string, decimalPonto = false): number | null {
  let s = String(bruto ?? '').trim().toUpperCase().replace(/R\$|\s/g, '');
  if (!s) return null;
  let sinal = 1;
  if (/^\(.*\)$/.test(s)) { sinal = -1; s = s.slice(1, -1); }
  if (/[D-]$/.test(s) && !/^-/.test(s)) { sinal = -1; s = s.slice(0, -1); }
  else if (/C$/.test(s)) s = s.slice(0, -1);
  if (s.startsWith('-')) { sinal *= -1; s = s.slice(1); }
  else if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s)) return null;
  const ultPonto = s.lastIndexOf('.'), ultVirg = s.lastIndexOf(',');
  let n: string;
  if (ultPonto >= 0 && ultVirg >= 0) {
    n = ultVirg > ultPonto ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (ultVirg >= 0) {
    n = s.replace(/\./g, '').replace(',', '.');
  } else if (ultPonto >= 0 && !decimalPonto && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    n = s.replace(/\./g, ''); // "1.234" no CSV brasileiro = mil duzentos e trinta e quatro
  } else n = s;
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 * sinal : null;
}

/** "31/01/2026", "31/01/26", "2026-01-31", "31-01-2026", "31.01.2026", com hora ou não. */
export function lerDataBanco(bruto: string): string | null {
  const s = String(bruto ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return dataValida(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/);
  if (m) {
    const a = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return dataValida(a, Number(m[2]), Number(m[1]));
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})/); // OFX: AAAAMMDD[hhmmss…]
  if (m) return dataValida(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

/** Bytes do arquivo → texto: OFX antigo vem em Windows-1252; o resto, UTF-8. */
export function decodificarExtrato(bytes: Uint8Array): string {
  const cabeca = new TextDecoder('latin1').decode(bytes.slice(0, 600)).toUpperCase();
  const declara1252 = /CHARSET:\s*(1252|ISO-?8859-?1|WINDOWS-?1252)|ENCODING="?(WINDOWS-1252|ISO-8859-1)/.test(cabeca);
  if (!declara1252) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''); } catch { /* cai no 1252 */ }
  }
  return new TextDecoder('windows-1252').decode(bytes);
}

// ------------------------------------------------------------------ classificação

/**
 * O que a linha é para o caixa. Conservador: só é saque/depósito em dinheiro quando
 * o banco diz com todas as letras — "DEPOSITO" sozinho pode ser um cliente pagando.
 */
export function tipoDaLinha(historico: string, sentido: Sentido, trntype?: string | null): TipoLinha {
  const n = normalizarTexto(historico);
  const t = String(trntype ?? '').toUpperCase();
  if (sentido === 'debito') {
    if (t === 'ATM' || /\bsaque\b|\bsaq\b|\bcaixa eletronico\b|\bretirada (em )?(dinheiro|especie)\b/.test(n)) return 'saque';
    if (t === 'CHECK' || /\bcheque\b|\bchq\b|\bcheq\b|\bch compensado\b/.test(n)) return 'cheque';
    return 'movimento';
  }
  if (/\bdep(osito|os|\.)? ?(em )?(dinheiro|especie)\b|\bdep din\b|\bdeposito (em |no )?(caixa|envelope)\b/.test(n)) return 'deposito';
  return 'movimento';
}

// ------------------------------------------------------------------ OFX

const ENTIDADES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
const desentidade = (s: string) => s.replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m) => ENTIDADES[m] ?? m);

function campoOfx(bloco: string, tag: string): string | null {
  const m = bloco.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i'));
  const v = m ? desentidade(m[1]).trim() : '';
  return v || null;
}

export function lerOfx(texto: string): ResultadoExtrato {
  const ini = texto.search(/<OFX>/i);
  if (ini < 0) return { ok: false, erro: 'O arquivo não parece um OFX (falta o bloco <OFX>).' };
  const corpo = texto.slice(ini);
  const blocos = [...corpo.matchAll(/<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi)].map((m) => m[1]);
  const bancoId = campoOfx(corpo, 'BANKID');
  const contaId = campoOfx(corpo, 'ACCTID');
  const avisos: string[] = [];
  const brutas: Omit<LinhaExtrato, 'chave' | 'ordem'>[] = [];
  const bases: string[] = [];
  let descartadas = 0;
  let semSinal = false;

  for (const b of blocos) {
    const data = lerDataBanco(campoOfx(b, 'DTPOSTED') ?? '');
    const bruto = lerValorBanco(campoOfx(b, 'TRNAMT') ?? '', true);
    if (!data || bruto == null || bruto === 0) { descartadas++; continue; }
    const trntype = campoOfx(b, 'TRNTYPE');
    let sentido: Sentido = bruto < 0 ? 'debito' : 'credito';
    // Alguns bancos mandam o valor sem sinal; o tipo diz o lado.
    if (bruto > 0 && /^(DEBIT|CHECK|ATM|FEE|SRVCHG|DIRECTDEBIT)$/i.test(trntype ?? '')) { sentido = 'debito'; semSinal = true; }
    const nome = campoOfx(b, 'NAME'), memo = campoOfx(b, 'MEMO');
    const partes = [...new Set([nome, memo].filter((x): x is string => !!x))];
    const historico = mascararHistorico(partes.join(' — ') || trntype || 'Movimento');
    const numero = campoOfx(b, 'CHECKNUM') ?? campoOfx(b, 'REFNUM');
    const fitid = campoOfx(b, 'FITID');
    const valor = Math.abs(bruto);
    brutas.push({ data, valor, sentido, historico, documento: numero, tipo: tipoDaLinha(historico, sentido, trntype) });
    // O FITID é a identidade da linha no banco; data e valor entram porque há banco
    // que reaproveita FITID. Sem FITID, a própria linha.
    bases.push(fitid
      ? `${bancoId ?? ''}|${contaId ?? ''}|${fitid}|${data}|${centavos(valor)}|${sentido}`
      : `${bancoId ?? ''}|${contaId ?? ''}|${data}|${centavos(valor)}|${sentido}|${normalizarTexto(historico)}`);
  }
  if (semSinal) avisos.push('O banco mandou alguns valores sem sinal; o lado (crédito/débito) saiu do tipo da transação. Confira.');
  if (brutas.length === 0) return { ok: false, erro: 'Não achei nenhuma transação neste OFX.' };
  if (brutas.length > MAX_LINHAS_EXTRATO) return { ok: false, erro: `O extrato tem mais de ${MAX_LINHAS_EXTRATO} linhas. Exporte um período menor.` };

  const linhas = comChaves('ofx', brutas, bases);
  const de = lerDataBanco(campoOfx(corpo, 'DTSTART') ?? '');
  const ate = lerDataBanco(campoOfx(corpo, 'DTEND') ?? '');
  const final4 = contaId ? contaId.replace(/\D/g, '').slice(-4) : '';
  const conta = bancoId || final4
    ? [bancoId ? `Banco ${bancoId.replace(/^0+(?=\d{3})/, '')}` : null, final4 ? `conta final ${final4}` : null].filter(Boolean).join(' · ')
    : null;
  return { ok: true, leitura: { formato: 'ofx', linhas, periodo: periodoDe(linhas, de, ate), conta, descartadas, avisos } };
}

function comChaves(prefixo: 'ofx' | 'csv', brutas: Omit<LinhaExtrato, 'chave' | 'ordem'>[], bases: string[]): LinhaExtrato[] {
  const vistas = new Map<string, number>();
  return brutas.map((l, i) => {
    const h = `${prefixo}:${hashTexto(bases[i])}`;
    const n = (vistas.get(h) ?? 0) + 1;
    vistas.set(h, n);
    return { ...l, chave: n === 1 ? h : `${h}#${n}`, ordem: i + 1 };
  });
}

function periodoDe(linhas: LinhaExtrato[], de: string | null, ate: string | null): { de: string; ate: string } {
  const datas = linhas.map((l) => l.data).sort();
  const min = datas[0], max = datas[datas.length - 1];
  // O período declarado só vale se cobrir as linhas (há banco que manda DTEND errado).
  return { de: de && de <= min ? de : min, ate: ate && ate >= max ? ate : max };
}

// ------------------------------------------------------------------ CSV

function separadorDe(texto: string): string {
  const amostra = texto.split(/\r?\n/).filter((l) => l.trim()).slice(0, 15);
  let melhor = ';', nota = -1;
  for (const sep of [';', ',', '\t', '|']) {
    const contagens = amostra.map((l) => dividirCsv(l, sep).length - 1).filter((n) => n > 0);
    if (contagens.length === 0) continue;
    // A moda das contagens, pesada pelo número de linhas que a seguem.
    const freq = new Map<number, number>();
    for (const c of contagens) freq.set(c, (freq.get(c) ?? 0) + 1);
    const [, vezes] = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
    if (vezes > nota) { nota = vezes; melhor = sep; }
  }
  return melhor;
}

/** Uma linha de CSV (aspas dobradas, separador dentro de aspas). */
export function dividirCsv(linha: string, sep: string): string[] {
  const out: string[] = [];
  let atual = '', aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (aspas) {
      if (c === '"' && linha[i + 1] === '"') { atual += '"'; i++; }
      else if (c === '"') aspas = false;
      else atual += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { out.push(atual.trim()); atual = ''; }
    else atual += c;
  }
  out.push(atual.trim());
  return out;
}

const SALDO = /^(saldo|s a l d o|sdo\b|saldo anterior|saldo do dia|saldo final|total)/;

/** Adivinha o mapa pelos nomes do cabeçalho (os bancos mais comuns). */
export function mapaPeloCabecalho(cab: string[]): MapaCsv | null {
  const n = cab.map((c) => normalizarTexto(c));
  const acha = (re: RegExp, fora: number[] = []) => {
    const i = n.findIndex((c, k) => !fora.includes(k) && !/saldo/.test(c) && re.test(c));
    return i >= 0 ? i : null;
  };
  const data = acha(/^(data|dt\b|dia\b)/);
  if (data == null) return null;
  const credito = acha(/^(credito|creditos|entrada|entradas|valor credito|credito \(r\$\))/, [data]);
  const debito = acha(/^(debito|debitos|saida|saidas|valor debito|debito \(r\$\))/, [data]);
  const valor = acha(/^(valor|montante|quantia|vlr)/, [data, credito ?? -1, debito ?? -1]);
  const tipo = acha(/^(tipo|d\/c|c\/d|natureza|deb\/cred|cred\/deb)$/, [data]);
  const documento = acha(/(documento|^doc\b|^n. ?doc|^numero|^num\.? doc|^nr\.? doc)/, [data]);
  const historico = acha(/(historico|descricao|lancamento|detalhe|memo|transacao|estabelecimento|identificacao)/,
    [data, credito ?? -1, debito ?? -1, valor ?? -1, tipo ?? -1, documento ?? -1]);
  if (historico == null || (valor == null && credito == null && debito == null)) return null;
  return { data, historico, valor, credito, debito, tipo, documento };
}

export function mapaValido(m: unknown, colunas: number): MapaCsv | null {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  const idx = (v: unknown): number | null => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n < colunas ? n : NaN;
  };
  const r = {
    data: idx(o.data), historico: idx(o.historico), valor: idx(o.valor), credito: idx(o.credito),
    debito: idx(o.debito), tipo: idx(o.tipo), documento: idx(o.documento),
  };
  if (Object.values(r).some((v) => Number.isNaN(v))) return null;
  if (r.data == null || r.historico == null) return null;
  if (r.valor == null && r.credito == null && r.debito == null) return null;
  return r as MapaCsv;
}

export function lerCsv(texto: string, mapaInformado?: unknown): ResultadoExtrato {
  const sep = separadorDe(texto);
  const linhasTxt = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const celulas = linhasTxt.map((l) => dividirCsv(l, sep));
  if (celulas.length < 2) return { ok: false, erro: 'O CSV está vazio ou tem uma linha só.' };

  // O cabeçalho: a primeira linha (das 20 primeiras) que o mapa reconhece. Banco
  // costuma pôr agência, conta e período antes dele.
  let inicio = -1;
  let mapaAuto: MapaCsv | null = null;
  for (let i = 0; i < Math.min(20, celulas.length); i++) {
    const m = mapaPeloCabecalho(celulas[i]);
    if (m) { inicio = i; mapaAuto = m; break; }
  }
  // Cabeçalho com nomes que não conhecemos: a 1ª linha não tem data e a 2ª tem.
  if (inicio < 0 && !celulas[0].some((x) => lerDataBanco(x)) && celulas[1].some((x) => lerDataBanco(x))) inicio = 0;
  const largura = Math.max(...celulas.map((c) => c.length));
  const colunas = inicio >= 0
    ? Array.from({ length: largura }, (_, i) => celulas[inicio][i] || `Coluna ${i + 1}`)
    : Array.from({ length: largura }, (_, i) => `Coluna ${i + 1}`);
  const dados = celulas.slice(inicio + 1).filter((c) => c.length > 1);
  const amostra = dados.slice(0, 3).map((c) => c.map((x) => mascararHistorico(x).slice(0, 60)));
  const mapa = mapaInformado ? mapaValido(mapaInformado, largura) : mapaAuto;
  const info: InfoCsv = { separador: sep, colunas, amostra, mapa };
  if (mapaInformado && !mapa) return { ok: false, erro: 'Escolha ao menos as colunas de data, histórico e valor (ou crédito e débito).', csv: info };
  if (!mapa) {
    return { ok: false, erro: 'Não reconheci as colunas deste CSV. Diga qual coluna é a data, o histórico e o valor.', csv: { ...info, mapa: null } };
  }

  const brutas: Omit<LinhaExtrato, 'chave' | 'ordem'>[] = [];
  const bases: string[] = [];
  let descartadas = 0;
  for (const c of dados) {
    const data = lerDataBanco(c[mapa.data] ?? '');
    const hist = String(c[mapa.historico] ?? '').trim();
    if (!data || SALDO.test(normalizarTexto(hist))) { descartadas++; continue; }
    let assinado: number | null = null;
    if (mapa.credito != null || mapa.debito != null) {
      const cr = mapa.credito != null ? lerValorBanco(c[mapa.credito] ?? '') : null;
      const db = mapa.debito != null ? lerValorBanco(c[mapa.debito] ?? '') : null;
      if (cr) assinado = Math.abs(cr);
      else if (db) assinado = -Math.abs(db);
    }
    if (assinado == null && mapa.valor != null) {
      assinado = lerValorBanco(c[mapa.valor] ?? '');
      const t = mapa.tipo != null ? normalizarTexto(c[mapa.tipo]) : '';
      if (assinado != null && /^d/.test(t)) assinado = -Math.abs(assinado);
      else if (assinado != null && /^c/.test(t)) assinado = Math.abs(assinado);
    }
    if (assinado == null || assinado === 0) { descartadas++; continue; }
    const sentido: Sentido = assinado < 0 ? 'debito' : 'credito';
    const historico = mascararHistorico(hist || 'Movimento');
    const documento = mapa.documento != null ? (String(c[mapa.documento] ?? '').trim() || null) : null;
    const valor = Math.abs(assinado);
    brutas.push({ data, valor, sentido, historico, documento, tipo: tipoDaLinha(historico, sentido) });
    bases.push(`${data}|${centavos(valor)}|${sentido}|${normalizarTexto(historico)}|${documento ?? ''}`);
  }
  if (brutas.length === 0) return { ok: false, erro: 'Nenhuma linha do CSV tem data e valor nas colunas escolhidas.', csv: info };
  if (brutas.length > MAX_LINHAS_EXTRATO) return { ok: false, erro: `O extrato tem mais de ${MAX_LINHAS_EXTRATO} linhas. Exporte um período menor.`, csv: info };
  const linhas = comChaves('csv', brutas, bases);
  return { ok: true, leitura: { formato: 'csv', linhas, periodo: periodoDe(linhas, null, null), conta: null, descartadas, avisos: [], csv: info } };
}

/** OFX ou CSV, pelo conteúdo (não pela extensão). */
export function lerExtrato(texto: string, mapa?: unknown): ResultadoExtrato {
  if (/<OFX>|OFXHEADER/i.test(texto.slice(0, 4000))) return lerOfx(texto);
  if (/<\?xml|<html|<!doctype/i.test(texto.slice(0, 200))) return { ok: false, erro: 'Este arquivo não é um extrato OFX nem CSV.' };
  return lerCsv(texto, mapa);
}

// ------------------------------------------------------------------ pernas

/** Um lançamento que a linha do extrato criaria no caixa. */
export interface PernaSugerida {
  direcao: Direcao;
  valor: number;
  historico: string;
  historicoId: string | null;
  contaId: string | null;
  complemento: string;
  /** Retirada/depósito de conta corrente: sem conta, fixo. */
  transferencia: boolean;
}

export interface SugestaoLinha { origem: string; confianca: number; motivo: string }

/** O que cada linha vira no caixa, no modo da empresa (sem conta ainda). */
export function pernasDaLinha(l: LinhaExtrato, modo: ModoExtrato): PernaSugerida[] {
  const compl = l.historico;
  const retirada = (c = compl): PernaSugerida => ({ direcao: 'entrada', valor: l.valor, historico: HISTORICO_RETIRADA, historicoId: null, contaId: null, complemento: c, transferencia: true });
  const deposito = (): PernaSugerida => ({ direcao: 'saida', valor: l.valor, historico: HISTORICO_DEPOSITO, historicoId: null, contaId: null, complemento: compl, transferencia: true });
  const principal = (direcao: Direcao, c = compl): PernaSugerida => ({ direcao, valor: l.valor, historico: '', historicoId: null, contaId: null, complemento: c, transferencia: false });

  if (modo === 'direto') {
    // Banco dentro do caixa: saque e depósito em dinheiro só trocam o dinheiro de bolso.
    if (l.tipo === 'saque' || l.tipo === 'deposito') return [];
    return [principal(l.sentido === 'credito' ? 'entrada' : 'saida')];
  }
  switch (l.tipo) {
    case 'saque': return [retirada()];
    case 'deposito': return [deposito()];
    case 'cheque': {
      const c = l.documento ? `Cheque ${l.documento} — ${compl}` : `Cheque — ${compl}`;
      return [retirada(c), principal('saida', c)];
    }
    default:
      return l.sentido === 'debito' ? [retirada(), principal('saida')] : [principal('entrada'), deposito()];
  }
}

/** Preenche a conta da perna principal com a sugestão (analítica citada ou histórico da empresa). */
export function sugerirPerna(
  p: PernaSugerida,
  base: { exemplos: ExemploConferido[]; contas: ContaSugerivel[]; analiticas: AnaliticaSugerivel[] },
): SugestaoLinha | null {
  if (p.transferencia) return null;
  const r = sugerirConta({ complemento: p.complemento, direcao: p.direcao, valor: p.valor }, base);
  const s = r.sugestao;
  if (!s) return null;
  p.contaId = s.contaId; p.historico = s.historico; p.historicoId = s.historicoId;
  return { origem: s.origem, confianca: s.confianca, motivo: s.motivo };
}

// ------------------------------------------------------------------ conciliação

/** Lançamento do caixa, reduzido ao que a conciliação usa. */
export interface LancamentoConciliacao {
  id: string;
  data: string;
  historico: string;
  complemento: string | null;
  contaId: string | null;
  entrada: number;
  /** Saída efetiva (saída + juros + multa). */
  saida: number;
}

export const ehTransferencia = (historico: string): boolean => {
  const n = normalizarTexto(historico);
  return n === normalizarTexto(HISTORICO_RETIRADA) || n === normalizarTexto(HISTORICO_DEPOSITO)
    || /^(retirada|deposito|transferencia) (de|em|para|da|na) (conta|banco)/.test(n);
};

export type EstadoLinha = 'nova' | 'parcial' | 'casada' | 'importada' | 'fora';

export interface ItemConciliacao extends LinhaExtrato {
  estado: EstadoLinha;
  /** O que confirmar criaria (as pernas que ainda faltam no caixa). */
  pernas: PernaSugerida[];
  /** Lançamentos do caixa que casaram com esta linha. */
  casadoCom: LancamentoConciliacao[];
  sugestao: SugestaoLinha | null;
  /** O mês da linha (ou um posterior) está fechado: não dá para lançar. */
  travada: boolean;
  /** Por que está fora (modo direto) ou o que pede atenção. */
  notas: string[];
}

export interface Marca { situacao: 'lancada' | 'casada' | 'ignorada'; lancamentoIds: string[] }

export interface Conciliacao {
  itens: ItemConciliacao[];
  /** No caixa e não no banco, no período do extrato. */
  soNoCaixa: { transferencias: LancamentoConciliacao[]; outros: LancamentoConciliacao[] };
  totais: { linhas: number; novas: number; parciais: number; casadas: number; importadas: number; fora: number; travadas: number };
}

/** O mês está travado se ele ou um posterior do mesmo ano estiver fechado (Sprint 17 · C). */
export function mesTravado(data: string, fechadosPorAno: Record<number, number[]>): boolean {
  const ano = Number(data.slice(0, 4)), mes = Number(data.slice(5, 7));
  return (fechadosPorAno[ano] ?? []).some((m) => m >= mes);
}

const valorNaDirecao = (l: LancamentoConciliacao, d: Direcao) => (d === 'entrada' ? l.entrada : l.saida);

/**
 * Concilia as linhas do extrato com o caixa. Casamento um-para-um, guloso pela
 * menor distância de data (e pela ordem do extrato no empate): cada perna procura
 * um lançamento da mesma direção, mesmo valor, até `JANELA_DIAS` de distância e da
 * mesma espécie (transferência com transferência, o resto com o resto).
 */
export function conciliar(
  linhas: LinhaExtrato[],
  caixa: LancamentoConciliacao[],
  opcoes: {
    modo: ModoExtrato;
    periodo: { de: string; ate: string };
    marcas?: Map<string, Marca>;
    fechadosPorAno?: Record<number, number[]>;
    /** Preenche a conta da perna principal (sugestão). */
    sugerir?: (p: PernaSugerida) => SugestaoLinha | null;
  },
): Conciliacao {
  const usados = new Set<string>();
  const porId = new Map(caixa.map((l) => [l.id, l]));
  const itens: ItemConciliacao[] = linhas.map((l) => ({
    ...l, estado: 'nova', pernas: pernasDaLinha(l, opcoes.modo), casadoCom: [], sugestao: null,
    travada: mesTravado(l.data, opcoes.fechadosPorAno ?? {}), notas: [],
  }));

  // 1. Já importadas (a mesma chave): os lançamentos delas não casam com mais nada.
  for (const it of itens) {
    const m = opcoes.marcas?.get(it.chave);
    if (!m) continue;
    it.estado = 'importada';
    it.casadoCom = m.lancamentoIds.map((id) => porId.get(id)).filter((x): x is LancamentoConciliacao => !!x);
    for (const id of m.lancamentoIds) usados.add(id);
    if (m.situacao === 'ignorada') it.notas.push('Marcada para ignorar numa importação anterior.');
    it.pernas = [];
  }

  // 2. Fora do caixa (modo direto: saque e depósito em dinheiro são neutros).
  for (const it of itens) {
    if (it.estado === 'importada' || it.pernas.length > 0) continue;
    it.estado = 'fora';
    it.notas.push('Saque ou depósito em dinheiro: com o banco dentro do caixa, não muda o saldo.');
  }

  // 3. Casamento guloso.
  type Cand = { item: ItemConciliacao; perna: number; lanc: LancamentoConciliacao; dist: number };
  const cands: Cand[] = [];
  const abertos = itens.filter((it) => it.estado === 'nova');
  // Índice por direção + valor em centavos (+ espécie): só compara quem pode casar.
  const dia = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
  const indice = new Map<string, { l: LancamentoConciliacao; dia: number }[]>();
  for (const l of caixa) {
    if (usados.has(l.id)) continue;
    const t = ehTransferencia(l.historico);
    for (const d of ['entrada', 'saida'] as Direcao[]) {
      const v = valorNaDirecao(l, d);
      if (v <= TOLERANCIA_VALOR) continue;
      const k = `${d}|${centavos(v)}|${t}`;
      (indice.get(k) ?? indice.set(k, []).get(k)!).push({ l, dia: dia(l.data) });
    }
  }
  for (const it of abertos) {
    const diaLinha = dia(it.data);
    it.pernas.forEach((p, k) => {
      for (const { l, dia: d } of indice.get(`${p.direcao}|${centavos(p.valor)}|${p.transferencia}`) ?? []) {
        const dist = Math.abs(d - diaLinha);
        if (dist <= JANELA_DIAS) cands.push({ item: it, perna: k, lanc: l, dist });
      }
    });
  }
  cands.sort((a, b) => a.dist - b.dist || a.item.ordem - b.item.ordem || a.perna - b.perna);
  const pernaFeita = new Set<string>();
  for (const c of cands) {
    const k = `${c.item.chave}/${c.perna}`;
    if (pernaFeita.has(k) || usados.has(c.lanc.id)) continue;
    pernaFeita.add(k);
    usados.add(c.lanc.id);
    c.item.casadoCom.push(c.lanc);
  }
  for (const it of abertos) {
    const faltam = it.pernas.filter((_, k) => !pernaFeita.has(`${it.chave}/${k}`));
    if (faltam.length === it.pernas.length) continue;
    it.estado = faltam.length === 0 ? 'casada' : 'parcial';
    it.pernas = faltam;
    if (it.estado === 'parcial') {
      const t = faltam.find((p) => p.transferencia);
      it.notas.push(t
        ? `Já está no caixa; falta "${t.historico}" (a conta bancária fica fora do caixa).`
        : 'A transferência já está no caixa; falta o lançamento da receita ou despesa.');
    }
  }

  // 4. Conta sugerida só para o que ainda vai ser lançado.
  if (opcoes.sugerir) {
    for (const it of itens) {
      if (it.estado !== 'nova' && it.estado !== 'parcial') continue;
      for (const p of it.pernas) {
        const s = opcoes.sugerir(p);
        if (s) it.sugestao = s;
      }
    }
  }

  // 5. No caixa e não no banco, dentro do período do extrato.
  const sobra = caixa.filter((l) => !usados.has(l.id) && l.data >= opcoes.periodo.de && l.data <= opcoes.periodo.ate);
  const conta = (e: EstadoLinha) => itens.filter((i) => i.estado === e).length;
  return {
    itens,
    soNoCaixa: {
      transferencias: sobra.filter((l) => ehTransferencia(l.historico)),
      outros: sobra.filter((l) => !ehTransferencia(l.historico)),
    },
    totais: {
      linhas: itens.length, novas: conta('nova'), parciais: conta('parcial'), casadas: conta('casada'),
      importadas: conta('importada'), fora: conta('fora'),
      travadas: itens.filter((i) => i.travada && (i.estado === 'nova' || i.estado === 'parcial')).length,
    },
  };
}

// ------------------------------------------------------------------ lote

export const MAX_ITENS_LOTE = 500;

export interface PernaLote {
  direcao: Direcao; valor: number; historico: string; historicoId: string | null;
  contaId: string | null; complemento: string | null;
}
export interface ItemLote {
  chave: string; data: string; valor: number; sentido: Sentido; historicoBanco: string;
  acao: 'lancar' | 'casar' | 'ignorar';
  pernas: PernaLote[];
  lancamentoIds: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Valida o lote que a tela manda confirmar. Erro em português, sem gravar nada. */
export function lerLote(v: unknown): { ok: true; itens: ItemLote[] } | { ok: false; erro: string } {
  if (!Array.isArray(v) || v.length === 0) return { ok: false, erro: 'Escolha ao menos uma linha do extrato.' };
  if (v.length > MAX_ITENS_LOTE) return { ok: false, erro: `Confirme no máximo ${MAX_ITENS_LOTE} linhas por vez.` };
  const itens: ItemLote[] = [];
  const chaves = new Set<string>();
  for (const bruto of v) {
    const o = (bruto ?? {}) as Record<string, unknown>;
    const chave = String(o.chave ?? '');
    if (!FORMATO_CHAVE_EXTRATO.test(chave)) return { ok: false, erro: 'Linha do extrato inválida. Leia o arquivo de novo.' };
    if (chaves.has(chave)) return { ok: false, erro: 'A mesma linha do extrato apareceu duas vezes.' };
    chaves.add(chave);
    const data = lerDataBanco(String(o.data ?? ''));
    const valor = Number(o.valor);
    const sentido = o.sentido === 'credito' || o.sentido === 'debito' ? o.sentido : null;
    const acao = o.acao === 'lancar' || o.acao === 'casar' || o.acao === 'ignorar' ? o.acao : null;
    if (!data || !(valor > 0) || !sentido || !acao) return { ok: false, erro: 'Linha do extrato inválida. Leia o arquivo de novo.' };
    const pernasBrutas = Array.isArray(o.pernas) ? o.pernas : [];
    if (acao === 'lancar' && (pernasBrutas.length < 1 || pernasBrutas.length > 2)) return { ok: false, erro: 'Cada linha vira um ou dois lançamentos.' };
    const pernas: PernaLote[] = acao === 'lancar' ? pernasBrutas.map((p) => {
      const q = (p ?? {}) as Record<string, unknown>;
      return {
        direcao: q.direcao === 'entrada' ? 'entrada' : 'saida',
        valor: Number(q.valor),
        historico: String(q.historico ?? '').trim(),
        historicoId: String(q.historicoId ?? '').trim() || null,
        contaId: String(q.contaId ?? '').trim() || null,
        complemento: String(q.complemento ?? '').trim().slice(0, 200) || null,
      };
    }) : [];
    const ids = Array.isArray(o.lancamentoIds) ? o.lancamentoIds.map(String) : [];
    if (acao === 'casar' && (ids.length === 0 || ids.length > 2 || !ids.every((x) => UUID.test(x)))) {
      return { ok: false, erro: 'Linha casada sem o lançamento do caixa. Leia o arquivo de novo.' };
    }
    itens.push({
      chave, data, valor: Math.round(valor * 100) / 100, sentido, acao, pernas,
      historicoBanco: String(o.historicoBanco ?? '').slice(0, 160), lancamentoIds: acao === 'casar' ? ids : [],
    });
  }
  return { ok: true, itens };
}
