// Sugestão de Conta Titular + Analítica ao lançar no Livro Caixa (Sprint 5, Frente A).
//
// Regra PURA: sem I/O e sem import de servidor — roda no navegador (a tela calcula
// a sugestão a cada tecla, sem ida ao servidor) e nos testes. Quem carrega os
// exemplos é lib/caixaInteligente.ts; quem chama a IA é /api/caixa/sugestao.
//
// Ordem das fontes (a primeira que resolve, vence):
//   (a) ANALÍTICA — o complemento cita o texto de uma analítica da empresa
//       ("luz" → "Pago conta de luz");
//   (b) HISTÓRICO — votação ponderada nos lançamentos da mesma empresa, por
//       semelhança de complemento (tokens com peso idf), valor (distância em
//       escala log) e pagador. Conferido pesa 1 (corrigido pela contadora, 2);
//       ainda não conferido pesa 0,3, nunca passa de confiança 0,6 sozinho e a
//       tela diz que é "como você lançou antes" (recomendação do contador);
//   (c) IA — só quando (a) e (b) não resolvem; escolhe APENAS entre as contas
//       que a empresa já usa (montarPromptIa/interpretarRespostaIa, aqui; a
//       chamada ao Gemini fica na rota).
//
// O que esta regra NUNCA faz: criar conta, marcar conferido, preencher o
// formulário sozinho (a tela só mostra e o usuário clica "Usar") ou olhar dado de
// outra empresa — os exemplos que recebe são só da empresa do lançamento, e a
// sugestão só sai se a conta estiver na lista de contas visíveis que a tela tem.

export type Direcao = 'entrada' | 'saida';
export type OrigemSugestao = 'analitica' | 'historico' | 'ia';

/** Um lançamento da empresa, já reduzido ao que a sugestão usa (sem nome de pagador). */
export interface ExemploConferido {
  contaId: string | null;
  historico: string;
  direcao: Direcao;
  /** Tokens normalizados do complemento (ver `tokenizar`). */
  tokens: string[];
  /** Valor efetivo (entrada, ou saída + juros + multa). */
  valor: number;
  /** Chave opaca do pagador (`chavePagador`) — nunca o nome nem o CPF. */
  pagador: string | null;
  /** Quantos lançamentos iguais este exemplo representa (ver `compactarExemplos`). */
  peso?: number;
  /** A contadora já conferiu? (ausente = sim) */
  conferido?: boolean;
  /** Conferido depois de a contabilidade alterar o lançamento — a correção dela. */
  corrigido?: boolean;
}

/** Peso de um exemplo ainda não conferido, perto de 1 conferido. */
export const PESO_NAO_CONFERIDO = 0.3;
/** Peso de um exemplo que a contadora corrigiu antes de conferir. */
export const PESO_CORRIGIDO = 2;
/** Teto da confiança quando só há não conferidos por trás da sugestão. */
export const TETO_NAO_CONFERIDO = 0.6;

/** Conta Titular visível para quem lança. */
export interface ContaSugerivel {
  id: string;
  codigo: string;
  nome: string;
  natureza: 'receita' | 'despesa';
  daEmpresa?: boolean;
}

/** Conta Analítica visível para quem lança. */
export interface AnaliticaSugerivel {
  id: string;
  texto: string;
  contaId: string | null;
  natureza: 'receita' | 'despesa';
  daEmpresa?: boolean;
}

/** O que o usuário já digitou no formulário. */
export interface ConsultaSugestao {
  complemento: string;
  direcao: Direcao | null;
  valor: number | null;
  /** Nome ou CPF/CNPJ do pagador, cru — vira chave aqui dentro. */
  pagadorNome?: string | null;
  pagadorDocumento?: string | null;
}

export interface Sugestao {
  contaId: string | null;
  historico: string;
  historicoId: string | null;
  origem: OrigemSugestao;
  /** 0–1. A tela só oferece a partir de `CONFIANCA_MINIMA`. */
  confianca: number;
  /** Frase curta para a tela: por que esta conta. */
  motivo: string;
  /** Quantos lançamentos conferidos sustentam a sugestão (0 na analítica/IA). */
  apoio: number;
}

export interface ResultadoSugestao {
  sugestao: Sugestao | null;
  /** Até duas outras opções do histórico, em ordem. */
  alternativas: Sugestao[];
  /** Nada resolveu com confiança: a tela pode oferecer "Perguntar à IA". */
  precisaIa: boolean;
}

/** Abaixo disto a sugestão do histórico não é mostrada (calibrado com o NÉLIO). */
export const CONFIANCA_MINIMA = 0.45;

// ------------------------------------------------------------------ texto

/** Minúsculas, sem acento, espaços colapsados. */
export function normalizarTexto(s: string | null | undefined): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Palavras que não distinguem uma conta de outra. */
const VAZIAS = new Set([
  'de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o', 'as', 'os', 'em', 'no', 'na', 'nos', 'nas',
  'p', 'pra', 'para', 'por', 'com', 'um', 'uma', 'ao', 'aos', 'se', 'que',
]);

/** Verbos de abertura das analíticas ("Pago", "Recebido") — não dizem QUAL conta. */
const GENERICAS = new Set([
  'pago', 'paga', 'pagamento', 'pagto', 'pgto', 'recebido', 'recebida', 'recebimento',
  'compra', 'despesa', 'despesas', 'receita', 'receitas', 'valor', 'referente',
]);

/**
 * Quebra o complemento em tokens comparáveis. Números viram FORMAS — "NF 1590" e
 * "NF 1741" ficam iguais ("nf #num"), "REF 07/2026" vira "ref #data" — porque o
 * que se repete entre lançamentos da mesma conta é o formato, não o número.
 */
export function tokenizar(s: string | null | undefined): string[] {
  const t = normalizarTexto(s)
    .replace(/\b\d{1,2}\/\d{1,4}(\/\d{2,4})?\b/g, ' #data ')
    .split(/[^a-z0-9#]+/)
    .map((p) => (/\d/.test(p) && p !== '#data' ? '#num' : p))
    .filter((p) => p.length > 1 && !VAZIAS.has(p));
  return [...new Set(t)];
}

/** Hash curto e estável (FNV-1a 32 bits) — para a chave do pagador não carregar o dado. */
function hashCurto(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * Chave do pagador: o CPF/CNPJ (se tiver 11+ dígitos) ou o nome normalizado,
 * passados por hash. É o que viaja para a tela no lugar do nome/CPF. É um
 * PSEUDÔNIMO, não anonimização (32 bits caem por força bruta): serve só porque
 * quem recebe já vê esses lançamentos. Não reaproveite fora da sugestão.
 */
export function chavePagador(nome: string | null | undefined, documento: string | null | undefined): string | null {
  const doc = String(documento ?? '').replace(/\D/g, '');
  if (doc.length >= 11) return `d${hashCurto(doc)}`;
  const n = normalizarTexto(nome);
  return n ? `n${hashCurto(n)}` : null;
}

// ------------------------------------------------------------------ exemplos

/** O mínimo de um lançamento de que o exemplo precisa. */
export interface LancamentoParaExemplo {
  complemento: string | null;
  contaId: string | null;
  historico: string;
  entrada: number;
  saida: number;
  juros?: number;
  multa?: number;
  pagadorNome?: string | null;
  pagadorDocumento?: string | null;
  conferido?: boolean;
  corrigido?: boolean;
}

export function exemploDe(l: LancamentoParaExemplo): ExemploConferido {
  const saida = (l.saida || 0) + (l.juros || 0) + (l.multa || 0);
  const direcao: Direcao = l.entrada > 0 ? 'entrada' : 'saida';
  return {
    contaId: l.contaId ?? null,
    historico: String(l.historico ?? '').trim(),
    direcao,
    tokens: tokenizar(l.complemento),
    valor: Math.round((direcao === 'entrada' ? l.entrada : saida) * 100) / 100,
    pagador: chavePagador(l.pagadorNome, l.pagadorDocumento),
    conferido: l.conferido ?? true,
    corrigido: !!l.corrigido && (l.conferido ?? true),
  };
}

/**
 * Junta exemplos iguais (mesma conta, analítica, direção, tokens, pagador e
 * faixa de valor de ~±6%) num só com `peso`. Milhares de lançamentos de uma
 * empresa viram algumas centenas de linhas — é o que vai para a tela.
 */
export function compactarExemplos(exs: ExemploConferido[]): ExemploConferido[] {
  const mapa = new Map<string, ExemploConferido>();
  for (const e of exs) {
    const faixa = e.valor > 0 ? Math.round(Math.log(e.valor) * 8) : -1;
    const chave = [e.contaId ?? '', e.historico, e.direcao, [...e.tokens].sort().join(' '), e.pagador ?? '', faixa,
      e.conferido === false ? 'n' : e.corrigido ? 'c' : 's'].join('|');
    const ja = mapa.get(chave);
    if (ja) ja.peso = (ja.peso ?? 1) + (e.peso ?? 1);
    else mapa.set(chave, { ...e, peso: e.peso ?? 1 });
  }
  return [...mapa.values()];
}

// ------------------------------------------------------------------ (a) analítica

const naturezaDe = (d: Direcao | null): 'receita' | 'despesa' | null =>
  d === 'entrada' ? 'receita' : d === 'saida' ? 'despesa' : null;

/** O token da consulta "é" o da analítica? Igual, ou prefixo comum de 4+ letras (protese/proteses). */
function casaToken(q: string, a: string): boolean {
  if (q === a) return true;
  if (q.startsWith('#') || a.startsWith('#')) return false;
  const n = Math.min(q.length, a.length);
  return n >= 4 && (q.startsWith(a) || a.startsWith(q));
}

function porAnalitica(
  qTokens: string[], direcao: Direcao | null, analiticas: AnaliticaSugerivel[], contas: Map<string, ContaSugerivel>,
): Sugestao | null {
  if (qTokens.length === 0) return null;
  const nat = naturezaDe(direcao);
  let melhor: { a: AnaliticaSugerivel; cobertura: number; termos: string[]; nota: number } | null = null;
  for (const a of analiticas) {
    if (nat && a.natureza !== nat) continue;
    if (a.contaId && !contas.has(a.contaId)) continue;
    const significativos = tokenizar(a.texto).filter((t) => !GENERICAS.has(t) && !t.startsWith('#'));
    if (significativos.length === 0) continue;
    const termos = significativos.filter((s) => qTokens.some((q) => casaToken(q, s)));
    if (termos.length === 0) continue;
    const cobertura = termos.length / significativos.length;
    if (cobertura < 0.5) continue;
    const nota = cobertura + (a.daEmpresa ? 0.1 : 0) + termos.length * 0.01;
    if (!melhor || nota > melhor.nota) melhor = { a, cobertura, termos, nota };
  }
  if (!melhor) return null;
  return {
    contaId: melhor.a.contaId,
    historico: melhor.a.texto,
    historicoId: melhor.a.id,
    origem: 'analitica',
    confianca: melhor.cobertura >= 1 ? 0.9 : 0.7,
    motivo: `o complemento cita "${melhor.termos.join(' ')}"`,
    apoio: 0,
  };
}

// ------------------------------------------------------------------ (b) histórico

/** Pesos da semelhança. Calibrados com os lançamentos reais (ver docs/livro-caixa.md). */
export interface AjusteSugestao {
  /** Peso de cada semelhança (somam 1). */
  pesos: { tokens: number; valor: number; pagador: number };
  /** Desvio (em ln) da semelhança de valor: 0,5 ≈ ±50% ainda conta bastante. */
  sigmaValor: number;
  /** Expoente que faz os vizinhos parecidos dominarem a votação. */
  nitidez: number;
  /** Confiança mínima para oferecer a sugestão do histórico. */
  minima: number;
}

export const AJUSTE_PADRAO: AjusteSugestao = {
  pesos: { tokens: 0.4, valor: 0.45, pagador: 0.15 }, sigmaValor: 0.5, nitidez: 4, minima: CONFIANCA_MINIMA,
};

interface Classe {
  contaId: string | null; historico: string; nota: number;
  /** Lançamentos parecidos (s ≥ 0,5): conferidos, não conferidos e o apoio ponderado. */
  conferidos: number; naoConferidos: number; apoio: number;
  termo: Map<string, number>;
}

function porHistorico(
  q: ExemploConferido, temComplemento: boolean, exemplos: ExemploConferido[],
  contas: Map<string, ContaSugerivel>, analiticas: AnaliticaSugerivel[], aj: AjusteSugestao,
): Sugestao[] {
  const nat = naturezaDe(q.direcao);
  // Fora: outra direção, conta que a sessão não vê, e não conferido com a
  // natureza da conta trocada (é erro do cliente — não pode virar regra).
  const validos = exemplos.filter((e) => {
    if ((nat && e.direcao !== q.direcao) || !e.historico) return false;
    if (e.contaId === null) return true;
    const c = contas.get(e.contaId);
    if (!c) return false;
    return e.conferido !== false || c.natureza === naturezaDe(e.direcao);
  });
  if (validos.length === 0) return [];
  const pesoDe = (e: ExemploConferido) =>
    (e.peso ?? 1) * (e.conferido === false ? PESO_NAO_CONFERIDO : e.corrigido ? PESO_CORRIGIDO : 1);

  // idf: token raro (ex.: "protese") pesa mais que token comum ("nf").
  const n = validos.reduce((s, e) => s + (e.peso ?? 1), 0);
  const df = new Map<string, number>();
  for (const e of validos) for (const t of e.tokens) df.set(t, (df.get(t) ?? 0) + (e.peso ?? 1));
  const idf = (t: string) => Math.log(1 + n / (df.get(t) ?? 0.5));

  const classes = new Map<string, Classe>();
  for (const e of validos) {
    // tokens: Jaccard ponderado por idf
    let simTok: number;
    if (!temComplemento && e.tokens.length === 0) simTok = 0.6;
    else if (!temComplemento || e.tokens.length === 0) simTok = 0.1;
    else {
      let inter = 0; let uniao = 0;
      const todos = new Set([...q.tokens, ...e.tokens]);
      for (const t of todos) {
        const w = idf(t);
        uniao += w;
        if (q.tokens.includes(t) && e.tokens.includes(t)) inter += w;
      }
      simTok = uniao > 0 ? inter / uniao : 0;
    }
    const simVal = q.valor && q.valor > 0 && e.valor > 0
      ? Math.exp(-((Math.log(q.valor / e.valor)) ** 2) / (2 * aj.sigmaValor ** 2))
      : 0.5;
    const simPag = q.pagador && e.pagador ? (q.pagador === e.pagador ? 1 : 0.6)
      : !q.pagador && !e.pagador ? 0.5 : 0;
    const s = aj.pesos.tokens * simTok + aj.pesos.valor * simVal + aj.pesos.pagador * simPag;
    const peso = pesoDe(e);

    const chave = `${e.contaId ?? ''}|${e.historico}`;
    let c = classes.get(chave);
    if (!c) {
      c = { contaId: e.contaId, historico: e.historico, nota: 0, conferidos: 0, naoConferidos: 0, apoio: 0, termo: new Map() };
      classes.set(chave, c);
    }
    c.nota += peso * s ** aj.nitidez;
    if (s >= 0.5) {
      c.apoio += peso;
      if (e.conferido === false) c.naoConferidos += e.peso ?? 1; else c.conferidos += e.peso ?? 1;
      // o token raro em comum vira o "porquê" da frase
      for (const t of q.tokens) if (!t.startsWith('#') && e.tokens.includes(t)) c.termo.set(t, (c.termo.get(t) ?? 0) + peso);
    }
  }

  const total = [...classes.values()].reduce((s, c) => s + c.nota, 0);
  if (total <= 0) return [];
  return [...classes.values()]
    .filter((c) => c.apoio > 0)
    .sort((a, b) => b.nota - a.nota)
    .slice(0, 3)
    .map((c) => {
      const prob = c.nota / total;
      let confianca = prob * (c.apoio / (c.apoio + 1));
      if (c.conferidos === 0) confianca = Math.min(confianca, TETO_NAO_CONFERIDO);
      const termo = [...c.termo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const com = termo ? ` com "${termo}"` : '';
      const motivo = c.conferidos > 0
        ? `como em ${c.conferidos === 1 ? '1 lançamento conferido' : `${c.conferidos} lançamentos conferidos`} de "${c.historico}"${com}`
        : `como você lançou antes${com} (${c.naoConferidos === 1 ? '1 lançamento' : `${c.naoConferidos} lançamentos`}, ainda não conferido${c.naoConferidos === 1 ? '' : 's'})`;
      return {
        contaId: c.contaId,
        historico: c.historico,
        historicoId: idDaAnalitica(analiticas, c.historico, c.contaId),
        origem: 'historico' as const,
        confianca: Math.round(confianca * 1000) / 1000,
        motivo,
        apoio: c.conferidos + c.naoConferidos,
      };
    });
}

function idDaAnalitica(analiticas: AnaliticaSugerivel[], texto: string, contaId: string | null): string | null {
  return analiticas.find((a) => a.texto === texto && a.contaId === contaId)?.id
    ?? analiticas.find((a) => a.texto === texto)?.id ?? null;
}

// ------------------------------------------------------------------ entrada principal

/**
 * A sugestão para o que o usuário digitou. Devolve `null` quando nada atinge a
 * confiança mínima — aí `precisaIa` diz se vale oferecer a IA (há algo digitado).
 */
export function sugerirConta(
  consulta: ConsultaSugestao,
  base: { exemplos: ExemploConferido[]; contas: ContaSugerivel[]; analiticas: AnaliticaSugerivel[] },
  aj: AjusteSugestao = AJUSTE_PADRAO,
): ResultadoSugestao {
  const contas = new Map(base.contas.map((c) => [c.id, c]));
  const q: ExemploConferido = {
    contaId: null, historico: '', direcao: consulta.direcao ?? 'saida',
    tokens: tokenizar(consulta.complemento),
    valor: consulta.valor && consulta.valor > 0 ? consulta.valor : 0,
    pagador: chavePagador(consulta.pagadorNome, consulta.pagadorDocumento),
  };
  const temAlgo = q.tokens.length > 0 || q.valor > 0;
  if (!temAlgo) return { sugestao: null, alternativas: [], precisaIa: false };

  // (a) o complemento cita uma analítica
  const a = porAnalitica(q.tokens, consulta.direcao, base.analiticas, contas);

  // (b) os conferidos da empresa
  const historico = consulta.direcao
    ? porHistorico({ ...q, direcao: consulta.direcao }, q.tokens.length > 0, base.exemplos, contas, base.analiticas, aj)
    : [];

  if (a) {
    const alternativas = historico.filter((h) => h.historico !== a.historico || h.contaId !== a.contaId).slice(0, 2);
    return { sugestao: a, alternativas, precisaIa: false };
  }
  const [topo, ...resto] = historico;
  if (topo && topo.confianca >= aj.minima) {
    return { sugestao: topo, alternativas: resto.slice(0, 2), precisaIa: false };
  }
  // (c) nada resolveu: a tela oferece a IA se houver texto para ela ler.
  return { sugestao: null, alternativas: historico.slice(0, 2), precisaIa: q.tokens.length > 0 };
}

/** A sugestão foi aceita? (a escolha final é a mesma conta + analítica). */
export function sugestaoAceita(
  s: { contaId: string | null; historico: string },
  final: { contaId: string | null; historico: string },
): boolean {
  return (s.contaId ?? null) === (final.contaId ?? null)
    && normalizarTexto(s.historico) === normalizarTexto(final.historico);
}

// ------------------------------------------------------------------ (c) IA

/** Uma opção que a IA pode escolher — sempre uma conta que a empresa já usa. */
export interface OpcaoIa { contaId: string | null; historico: string; historicoId: string | null; rotulo: string }

/** Máximo de opções no prompt (o resto fica de fora; a lista é a da empresa). */
export const MAX_OPCOES_IA = 60;

/**
 * As opções para a IA: as analíticas DA EMPRESA (com a titular), na natureza da
 * direção; sem analítica da empresa, as titulares da empresa. Nunca o catálogo
 * inteiro e nunca conta de outro escritório (a lista vem já recortada).
 */
export function opcoesParaIa(
  direcao: Direcao | null, contas: ContaSugerivel[], analiticas: AnaliticaSugerivel[],
): OpcaoIa[] {
  const nat = naturezaDe(direcao);
  const mapa = new Map(contas.map((c) => [c.id, c]));
  const daEmpresa = analiticas.filter((a) => a.daEmpresa && (!nat || a.natureza === nat) && (!a.contaId || mapa.has(a.contaId)));
  if (daEmpresa.length > 0) {
    return daEmpresa.slice(0, MAX_OPCOES_IA).map((a) => {
      const c = a.contaId ? mapa.get(a.contaId) : undefined;
      return { contaId: a.contaId, historico: a.texto, historicoId: a.id, rotulo: c ? `${c.codigo} ${c.nome} › ${a.texto}` : a.texto };
    });
  }
  return contas.filter((c) => c.daEmpresa && (!nat || c.natureza === nat)).slice(0, MAX_OPCOES_IA)
    .map((c) => ({ contaId: c.id, historico: c.nome, historicoId: null, rotulo: `${c.codigo} ${c.nome}` }));
}

/**
 * Tira do complemento o que parece documento ou telefone (5+ dígitos seguidos,
 * com ou sem pontuação) antes de mandar à IA, e corta o tamanho. O pagador
 * (nome e CPF do paciente) não vai — ver docs/livro-caixa.md, "o que vai para a IA".
 */
export function complementoParaIa(complemento: string): string {
  return String(complemento ?? '')
    .replace(/\d[\d.\-/ ]{3,}\d/g, (m) => (m.replace(/\D/g, '').length >= 5 ? '[número]' : m))
    .replace(/\S+@\S+/g, '[e-mail]')
    .slice(0, 120).trim();
}

export function montarPromptIa(
  consulta: { complemento: string; direcao: Direcao | null; valor: number | null }, opcoes: OpcaoIa[],
): string {
  const lista = opcoes.map((o, i) => `${i}. ${o.rotulo}`).join('\n');
  const tipo = consulta.direcao === 'entrada' ? 'ENTRADA (receita)' : consulta.direcao === 'saida' ? 'SAÍDA (despesa)' : 'não informado';
  const valor = consulta.valor && consulta.valor > 0 ? `R$ ${consulta.valor.toFixed(2)}` : 'não informado';
  return `Você classifica lançamentos do Livro Caixa de uma pequena empresa brasileira.
Escolha UMA conta da lista abaixo para o lançamento. Use só os números da lista; não invente conta.
Se nenhuma servir com segurança, responda indice = null.

Lançamento:
- Tipo: ${tipo}
- Valor: ${valor}
- Complemento digitado: "${complementoParaIa(consulta.complemento)}"

Contas desta empresa:
${lista}

Responda SOMENTE com o JSON no schema fornecido: o índice escolhido e a sua confiança de 0 a 1.`;
}

/** Lê a resposta da IA. Índice fora da lista, ou JSON torto, vira `null` — nunca uma conta inventada. */
export function interpretarRespostaIa(texto: string | null | undefined, opcoes: OpcaoIa[]): Sugestao | null {
  let r: { indice?: unknown; confianca?: unknown };
  try { r = JSON.parse(String(texto ?? '')); } catch { return null; }
  const i = Number(r?.indice);
  if (r?.indice === null || r?.indice === undefined || !Number.isInteger(i) || i < 0 || i >= opcoes.length) return null;
  const o = opcoes[i];
  const conf = Number(r.confianca);
  // A IA não conhece o histórico da empresa: a confiança dela é teto 0,6 na tela.
  const confianca = Math.round(Math.min(0.6, Number.isFinite(conf) ? Math.max(0, conf) : 0.3) * 1000) / 1000;
  return {
    contaId: o.contaId, historico: o.historico, historicoId: o.historicoId, origem: 'ia',
    confianca, motivo: 'sugestão da IA entre as contas desta empresa — confira', apoio: 0,
  };
}
