// XML de nota fiscal → dados exatos (Sprint 17, Frente B: "Nota e boleto sem IA").
// Regras puras, sem I/O e sem dependência: um leitor de XML mínimo e os três
// layouts que o pequeno comércio e o prestador de serviço recebem:
//
//   - NF-e (modelo 55) e NFC-e (65): `nfeProc`/`NFe` › `infNFe` (layout 4.00);
//   - NFS-e padrão nacional (SPED, desde 2023): `NFSe` › `infNFSe` (+ `DPS`);
//   - NFS-e ABRASF (1.0 e 2.0x, o das prefeituras): `CompNfse` › `Nfse` › `InfNfse`.
//
// O leitor recusa DOCTYPE/ENTITY (nada de XXE nem "bilhão de risadas") e não
// resolve nada externo: só lê tags, atributos e texto.

export interface NoXml { nome: string; attrs: Record<string, string>; filhos: NoXml[]; texto: string }

/** Tamanho máximo do XML lido (uma NF-e tem dezenas de KB; o portal aceita 10 MB). */
export const LIMITE_XML = 5 * 1024 * 1024;
const LIMITE_NOS = 100_000;
const LIMITE_PROFUNDIDADE = 64;

const ENTIDADES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodificar(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    }
    return ENTIDADES[e.toLowerCase()] ?? m;
  });
}

const local = (nome: string) => nome.slice(nome.indexOf(':') + 1);

/**
 * Lê o XML numa árvore (nomes sem o prefixo do namespace). `null` = não é XML
 * bem formado o bastante, tem DOCTYPE/ENTITY ou passa dos limites.
 */
export function lerXml(entrada: string): NoXml | null {
  const s = String(entrada ?? '').replace(/^﻿/, '');
  if (!s || s.length > LIMITE_XML || /<!DOCTYPE|<!ENTITY/i.test(s)) return null;
  const raiz: NoXml = { nome: '#raiz', attrs: {}, filhos: [], texto: '' };
  const pilha: NoXml[] = [raiz];
  let nos = 0;
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const atual = pilha[pilha.length - 1];
    if (lt < 0) { atual.texto += decodificar(s.slice(i)); break; }
    if (lt > i) atual.texto += decodificar(s.slice(i, lt));
    if (s.startsWith('<?', lt)) { const f = s.indexOf('?>', lt); if (f < 0) return null; i = f + 2; continue; }
    if (s.startsWith('<!--', lt)) { const f = s.indexOf('-->', lt); if (f < 0) return null; i = f + 3; continue; }
    if (s.startsWith('<![CDATA[', lt)) {
      const f = s.indexOf(']]>', lt); if (f < 0) return null;
      atual.texto += s.slice(lt + 9, f); i = f + 3; continue;
    }
    if (s[lt + 1] === '!') return null;
    // Fim da tag, respeitando aspas nos atributos.
    let f = lt + 1; let aspas = '';
    for (; f < s.length; f++) {
      const c = s[f];
      if (aspas) { if (c === aspas) aspas = ''; } else if (c === '"' || c === "'") aspas = c; else if (c === '>') break;
    }
    if (f >= s.length) return null;
    const corpo = s.slice(lt + 1, f);
    i = f + 1;
    if (corpo[0] === '/') {
      const nome = local(corpo.slice(1).trim());
      if (pilha.length < 2 || pilha[pilha.length - 1].nome !== nome) return null;
      pilha.pop();
      continue;
    }
    const auto = corpo.endsWith('/');
    const m = /^([^\s/>]+)/.exec(corpo);
    if (!m) return null;
    const attrs: Record<string, string> = {};
    for (const a of corpo.slice(m[1].length).matchAll(/([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[local(a[1])] = decodificar(a[2] ?? a[3] ?? '');
    }
    const no: NoXml = { nome: local(m[1]), attrs, filhos: [], texto: '' };
    if (++nos > LIMITE_NOS) return null;
    atual.filhos.push(no);
    if (!auto) {
      if (pilha.length > LIMITE_PROFUNDIDADE) return null;
      pilha.push(no);
    }
  }
  if (pilha.length !== 1 || raiz.filhos.length !== 1) return null;
  return raiz.filhos[0];
}

/** Filho direto pelo caminho de nomes (sem prefixo). */
export function filho(no: NoXml | null | undefined, ...caminho: string[]): NoXml | null {
  let atual: NoXml | null = no ?? null;
  for (const nome of caminho) {
    atual = atual?.filhos.find((f) => f.nome === nome) ?? null;
    if (!atual) return null;
  }
  return atual;
}

/** Primeiro descendente (busca em profundidade, incluindo o próprio nó) com o nome. */
export function busca(no: NoXml | null | undefined, nome: string): NoXml | null {
  if (!no) return null;
  if (no.nome === nome) return no;
  for (const f of no.filhos) { const r = busca(f, nome); if (r) return r; }
  return null;
}

function buscaTodos(no: NoXml | null | undefined, nome: string, saida: NoXml[] = []): NoXml[] {
  if (!no) return saida;
  if (no.nome === nome) saida.push(no);
  for (const f of no.filhos) buscaTodos(f, nome, saida);
  return saida;
}

const texto = (no: NoXml | null | undefined) => (no?.texto ?? '').trim();
const digitos = (s: string) => s.replace(/\D/g, '');

/** "1234.56" (ou "1234,56") → 1234.56; inválido → null. */
function numero(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const v = Number(t.includes(',') && !t.includes('.') ? t.replace(',', '.') : t.replace(/,/g, ''));
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
}

/** AAAA-MM-DD do começo de uma data/hora ISO ("2026-03-05T10:00:00-03:00"), se for data real. */
function dataIso(s: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === `${m[1]}-${m[2]}-${m[3]}` ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// ------------------------------------------------------------------ chave de acesso

/** DV da chave de acesso da NF-e (módulo 11, pesos 2–9; resto 0 ou 1 → 0). */
export function dvChaveNfe(chave43: string): number {
  let soma = 0; let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) { soma += Number(chave43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

export function chaveNfeValida(chave: string): boolean {
  return /^\d{44}$/.test(chave) && dvChaveNfe(chave.slice(0, 43)) === Number(chave[43]);
}

/** O que a própria chave diz (vale para o DANFE em PDF, que traz a chave impressa). */
export function decomporChaveNfe(chave: string): { cnpjEmitente: string; modelo: string; serie: string; numero: string; anoMes: string } | null {
  if (!chaveNfeValida(chave)) return null;
  const modelo = chave.slice(20, 22);
  if (modelo !== '55' && modelo !== '65') return null;
  return {
    anoMes: `20${chave.slice(2, 4)}-${chave.slice(4, 6)}`,
    cnpjEmitente: chave.slice(6, 20), modelo,
    serie: String(Number(chave.slice(22, 25))), numero: String(Number(chave.slice(25, 34))),
  };
}

// ------------------------------------------------------------------ nota lida

export type TipoNota = 'nfe' | 'nfce' | 'nfse';

export interface ParteNota { documento: string | null; nome: string | null }

export interface NotaLida {
  tipo: TipoNota;
  /** Layout de origem, para a tela ("NF-e", "NFS-e nacional", "NFS-e (prefeitura)"). */
  layout: string;
  numero: string | null;
  serie: string | null;
  /** Chave de acesso (44 na NF-e, 50 na NFS-e nacional); a ABRASF não tem. */
  chaveAcesso: string | null;
  /** Identidade única da nota para apontar duplicidade (`nfe:…`, `nfse:…`). */
  chaveDuplicidade: string | null;
  dataEmissao: string | null;
  /** Valor total (NF-e) ou líquido (NFS-e, depois das retenções). */
  valor: number | null;
  /** Valor do serviço antes das retenções (NFS-e), quando difere do líquido. */
  valorBruto: number | null;
  /** Quem emitiu (vendedor/prestador). */
  emitente: ParteNota;
  /** Quem recebeu (comprador/tomador). */
  destinatario: ParteNota;
  /** NF-e: 0 = nota de entrada, 1 = de saída (do ponto de vista do emitente). */
  tipoOperacao: '0' | '1' | null;
  /** NF-e de devolução (finNFe = 4). */
  devolucao: boolean;
  /** NF-e marcada "sem pagamento" (tPag 90): talvez não haja dinheiro. */
  semPagamento: boolean;
  /** Parcelas (duplicatas) da NF-e. */
  parcelas: { vencimento: string | null; valor: number | null }[];
  /** NFS-e cancelada (ABRASF traz o cancelamento junto). */
  cancelada: boolean;
}

function parte(no: NoXml | null, ...camposNome: string[]): ParteNota {
  if (!no) return { documento: null, nome: null };
  const doc = digitos(texto(busca(no, 'CNPJ')) || texto(busca(no, 'Cnpj')) || texto(busca(no, 'CPF')) || texto(busca(no, 'Cpf')));
  let nome = '';
  for (const c of camposNome) { nome = texto(busca(no, c)); if (nome) break; }
  return { documento: doc || null, nome: nome || null };
}

function lerNfe(raiz: NoXml): NotaLida | null {
  const inf = busca(raiz, 'infNFe');
  if (!inf) return null;
  const ide = filho(inf, 'ide');
  const modelo = texto(filho(ide, 'mod'));
  const idChave = digitos(inf.attrs.Id ?? '');
  const chave = idChave.length === 44 ? idChave : digitos(texto(busca(raiz, 'chNFe')));
  const tpNF = texto(filho(ide, 'tpNF'));
  const pagamentos = buscaTodos(filho(inf, 'pag'), 'tPag').map(texto);
  return {
    tipo: modelo === '65' ? 'nfce' : 'nfe',
    layout: modelo === '65' ? 'NFC-e' : 'NF-e',
    numero: texto(filho(ide, 'nNF')) || null,
    serie: texto(filho(ide, 'serie')) || null,
    chaveAcesso: chave.length === 44 ? chave : null,
    chaveDuplicidade: chave.length === 44 ? `nfe:${chave}` : null,
    dataEmissao: dataIso(texto(filho(ide, 'dhEmi')) || texto(filho(ide, 'dEmi'))),
    valor: numero(texto(busca(filho(inf, 'total'), 'vNF'))),
    valorBruto: null,
    emitente: parte(filho(inf, 'emit'), 'xNome', 'xFant'),
    destinatario: parte(filho(inf, 'dest'), 'xNome'),
    tipoOperacao: tpNF === '0' || tpNF === '1' ? tpNF : null,
    devolucao: texto(filho(ide, 'finNFe')) === '4',
    semPagamento: pagamentos.length > 0 && pagamentos.every((p) => p === '90'),
    parcelas: buscaTodos(filho(inf, 'cobr'), 'dup').map((d) => ({
      vencimento: dataIso(texto(filho(d, 'dVenc'))), valor: numero(texto(filho(d, 'vDup'))),
    })),
    cancelada: false,
  };
}

function lerNfseNacional(raiz: NoXml): NotaLida | null {
  const inf = busca(raiz, 'infNFSe');
  if (!inf) return null;
  const dps = busca(inf, 'infDPS');
  const chave = digitos(inf.attrs.Id ?? '');
  const emit = filho(inf, 'emit');
  const prestador = parte(emit ?? filho(dps, 'prest'), 'xNome');
  if (!prestador.documento) prestador.documento = parte(filho(dps, 'prest')).documento;
  const liquido = numero(texto(busca(filho(inf, 'valores'), 'vLiq')));
  const bruto = numero(texto(busca(filho(dps, 'valores'), 'vServ')));
  return {
    tipo: 'nfse', layout: 'NFS-e nacional',
    numero: texto(filho(inf, 'nNFSe')) || null,
    serie: texto(filho(dps, 'serie')) || null,
    chaveAcesso: chave.length >= 44 ? chave : null,
    chaveDuplicidade: chave.length >= 44 ? `nfse:${chave}` : null,
    dataEmissao: dataIso(texto(filho(dps, 'dhEmi'))) ?? dataIso(texto(filho(inf, 'dhProc'))),
    valor: liquido ?? bruto,
    valorBruto: bruto !== null && liquido !== null && bruto !== liquido ? bruto : null,
    emitente: prestador,
    destinatario: parte(filho(dps, 'toma'), 'xNome'),
    tipoOperacao: null, devolucao: false, semPagamento: false, parcelas: [], cancelada: false,
  };
}

function lerNfseAbrasf(raiz: NoXml): NotaLida | null {
  const inf = busca(raiz, 'InfNfse');
  if (!inf) return null;
  const numeroNota = texto(filho(inf, 'Numero')) || null;
  const prestadorNo = busca(inf, 'PrestadorServico') ?? busca(inf, 'Prestador');
  const prestador = parte(prestadorNo, 'RazaoSocial', 'NomeFantasia');
  if (!prestador.documento) prestador.documento = parte(busca(inf, 'Prestador')).documento;
  const tomador = parte(busca(inf, 'TomadorServico') ?? busca(inf, 'Tomador'), 'RazaoSocial');
  const liquido = numero(texto(busca(inf, 'ValorLiquidoNfse')));
  const bruto = numero(texto(busca(inf, 'ValorServicos')));
  const data = dataIso(texto(filho(inf, 'DataEmissao'))) ?? dataIso(texto(busca(inf, 'DataEmissao')))
    ?? dataIso(texto(busca(inf, 'Competencia')));
  return {
    tipo: 'nfse', layout: 'NFS-e (prefeitura)',
    numero: numeroNota, serie: null, chaveAcesso: null,
    // Sem chave de acesso: a nota é única pelo prestador + número.
    chaveDuplicidade: numeroNota && prestador.documento ? `nfse:${prestador.documento}:${numeroNota}` : null,
    dataEmissao: data,
    valor: liquido ?? bruto,
    valorBruto: bruto !== null && liquido !== null && bruto !== liquido ? bruto : null,
    emitente: prestador, destinatario: tomador,
    tipoOperacao: null, devolucao: false, semPagamento: false, parcelas: [],
    cancelada: !!busca(raiz, 'NfseCancelamento'),
  };
}

export type ResultadoNota = { ok: true; nota: NotaLida } | { ok: false; erro: string };

/** Lê o XML de uma NF-e, NFC-e ou NFS-e (nacional ou ABRASF). */
export function lerNotaXml(conteudo: string): ResultadoNota {
  const raiz = lerXml(conteudo);
  if (!raiz) return { ok: false, erro: 'Não foi possível ler este XML. Confira se é o arquivo da nota (o XML que o fornecedor manda ou que o emissor gera).' };
  if (busca(raiz, 'infEvento') && !busca(raiz, 'infNFe')) {
    return { ok: false, erro: 'Este XML é um evento da nota (cancelamento, carta de correção), não a nota em si.' };
  }
  const nota = lerNfe(raiz) ?? lerNfseNacional(raiz) ?? lerNfseAbrasf(raiz);
  if (!nota) return { ok: false, erro: 'Este XML não é de nota fiscal (NF-e, NFC-e ou NFS-e).' };
  return { ok: true, nota };
}

// ------------------------------------------------------------------ direção

export type PapelEmpresa = 'emitente' | 'destinatario' | null;

/** Mesma pessoa: documento igual, ou CNPJ da mesma raiz (matriz e filial). */
function mesmo(a: string | null, b: string): 'igual' | 'raiz' | null {
  if (!a || !b) return null;
  if (a === b) return 'igual';
  if (a.length === 14 && b.length === 14 && a.slice(0, 8) === b.slice(0, 8)) return 'raiz';
  return null;
}

/**
 * A empresa emitiu ou recebeu a nota? E o que isso é no caixa:
 * - emitiu (vendeu / prestou o serviço) → **entrada**;
 * - recebeu (comprou / tomou o serviço) → **saída**.
 * Na NF-e, a nota de entrada (tpNF 0) inverte: emitida pela empresa é compra
 * (produtor rural, importação); recebida dela é a devolução de uma venda.
 */
export function papelDaEmpresa(nota: NotaLida, documentoEmpresa: string | null | undefined): {
  papel: PapelEmpresa; direcao: 'entrada' | 'saida' | null; filial: boolean;
} {
  const doc = digitos(String(documentoEmpresa ?? ''));
  const e = mesmo(nota.emitente.documento, doc);
  const d = mesmo(nota.destinatario.documento, doc);
  // O documento exato vence a raiz (nota entre matriz e filial).
  const papel: PapelEmpresa = e === 'igual' ? 'emitente' : d === 'igual' ? 'destinatario' : e ? 'emitente' : d ? 'destinatario' : null;
  if (!papel) return { papel: null, direcao: null, filial: false };
  const inverte = nota.tipoOperacao === '0';
  const base = papel === 'emitente' ? 'entrada' : 'saida';
  const direcao = inverte ? (base === 'entrada' ? 'saida' : 'entrada') : base;
  return { papel, direcao, filial: (papel === 'emitente' ? e : d) === 'raiz' };
}
