// Boleto — linha digitável ou código de barras → valor, vencimento e banco
// (Sprint 17, Frente B: "Nota e boleto sem IA"). Regras puras, sem I/O: nada sai
// do servidor (nem do navegador).
//
// Dois formatos (especificação FEBRABAN):
//
// 1. **Bancário** (cobrança): código de barras de 44 posições
//      BBB M D FFFF VVVVVVVVVV LLLLLLLLLLLLLLLLLLLLLLLLL
//      banco(3) moeda(1) DV(1) fator(4) valor(10) campo livre(25)
//    e a linha digitável de 47 números, em 5 campos:
//      campo 1 = banco+moeda + campo livre 1–5   + DV (módulo 10)
//      campo 2 = campo livre 6–15                + DV (módulo 10)
//      campo 3 = campo livre 16–25               + DV (módulo 10)
//      campo 4 = DV geral do código de barras (módulo 11)
//      campo 5 = fator de vencimento (4) + valor (10)
//
// 2. **Arrecadação** (contas de consumo e tributos — começa por 8): código de
//    barras de 44 posições e linha de 48 (4 blocos de 11 + DV). O 3º número diz se
//    o valor é efetivo (6/7 → DV módulo 10; 8/9 → módulo 11). Não tem vencimento
//    padronizado no código.
//
// Fator de vencimento: dias desde 07/10/1997. Em 22/02/2025 o fator passou de
// 9999 e **reiniciou em 1000** (regra FEBRABAN) — o mesmo fator volta a cada
// 9.000 dias, e vale a data mais perto de hoje.

export type TipoBoleto = 'bancario' | 'arrecadacao';

export interface BoletoLido {
  tipo: TipoBoleto;
  /** Os 44 números do código de barras. */
  codigoBarras: string;
  /** A linha digitável formatada (como vem impressa). */
  linhaDigitavel: string;
  /** Banco emissor (só no bancário). */
  banco: { codigo: string; nome: string } | null;
  /** Segmento da arrecadação (energia, água, prefeitura…). */
  segmento: string | null;
  /** Valor em reais; `null` quando o código não traz (valor em aberto ou de referência). */
  valor: number | null;
  /** Vencimento AAAA-MM-DD; `null` quando o código não traz. */
  vencimento: string | null;
  /** O que a pessoa precisa saber (valor em aberto, sem vencimento…). */
  avisos: string[];
}

export type ResultadoBoleto = { ok: true; boleto: BoletoLido } | { ok: false; erro: string };

/** Principais bancos (código COMPE). Fora da lista aparece "banco 123". */
export const BANCOS: Record<string, string> = {
  '001': 'Banco do Brasil', '004': 'Banco do Nordeste', '021': 'Banestes', '033': 'Santander',
  '037': 'Banpará', '041': 'Banrisul', '047': 'Banese', '070': 'BRB', '077': 'Inter',
  '085': 'Ailos', '104': 'Caixa', '133': 'Cresol', '136': 'Unicred', '197': 'Stone',
  '208': 'BTG Pactual', '212': 'Banco Original', '237': 'Bradesco', '260': 'Nubank',
  '290': 'PagBank', '323': 'Mercado Pago', '336': 'C6 Bank', '341': 'Itaú', '380': 'PicPay',
  '389': 'Mercantil do Brasil', '403': 'Cora', '422': 'Safra', '633': 'Rendimento',
  '655': 'Votorantim', '707': 'Daycoval', '745': 'Citibank', '748': 'Sicredi', '756': 'Sicoob',
};

/** Segmentos da arrecadação (2º número do código). */
export const SEGMENTOS: Record<string, string> = {
  '1': 'Prefeitura', '2': 'Saneamento (água e esgoto)', '3': 'Energia elétrica e gás',
  '4': 'Telecomunicações', '5': 'Órgão governamental', '6': 'Carnê ou convênio',
  '7': 'Multa de trânsito', '9': 'Uso do banco',
};

// ------------------------------------------------------------------ dígitos verificadores

/** Módulo 10 (pesos 2,1 da direita; produto ≥ 10 soma os algarismos). */
export function modulo10(numeros: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = numeros.length - 1; i >= 0; i--) {
    const p = Number(numeros[i]) * peso;
    soma += p > 9 ? p - 9 : p;
    peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

/** Soma do módulo 11 (pesos 2 a 9, repetidos, da direita). */
function soma11(numeros: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = numeros.length - 1; i >= 0; i--) {
    soma += Number(numeros[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  return soma;
}

/** DV geral do boleto bancário: 11 − resto; 0, 10 e 11 viram 1. */
export function modulo11Bancario(numeros: string): number {
  const dv = 11 - (soma11(numeros) % 11);
  return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}

/** DV da arrecadação em módulo 11: resto 0 ou 1 → 0; senão 11 − resto. */
export function modulo11Arrecadacao(numeros: string): number {
  const r = soma11(numeros) % 11;
  return r < 2 ? 0 : 11 - r;
}

// ------------------------------------------------------------------ fator de vencimento

const DIA_MS = 86_400_000;
const BASE_FATOR = Date.UTC(1997, 9, 7); // 07/10/1997 = fator 0
/** O ciclo do fator depois da virada de 22/02/2025: 1000 → 9999, 9.000 dias. */
export const CICLO_FATOR = 9000;

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Vencimento do fator, escolhendo o ciclo mais perto da data de referência
 * (hoje). Fator 0 = sem vencimento. Ex.: 9999 → 21/02/2025; 1000 → 22/02/2025
 * (o reinício) e não 03/07/2000, para quem lê hoje.
 */
export function dataDoFator(fator: number, referencia: string): string | null {
  if (!Number.isInteger(fator) || fator <= 0 || fator > 9999) return null;
  const ref = Date.parse(`${referencia}T00:00:00Z`);
  // Abaixo de 1000 só existe no ciclo original (1997–2000).
  const ciclos = fator < 1000 ? [0] : [0, 1, 2, 3];
  let melhor: number | null = null;
  for (const k of ciclos) {
    const d = BASE_FATOR + (fator + k * CICLO_FATOR) * DIA_MS;
    if (melhor === null || Math.abs(d - ref) < Math.abs(melhor - ref)) melhor = d;
  }
  return melhor === null ? null : iso(melhor);
}

/** O fator de uma data (no ciclo atual) — o caminho inverso, útil em testes. */
export function fatorDaData(data: string): number {
  const dias = Math.round((Date.parse(`${data}T00:00:00Z`) - BASE_FATOR) / DIA_MS);
  if (dias < 1000) return dias;
  return ((dias - 1000) % CICLO_FATOR) + 1000;
}

// ------------------------------------------------------------------ leitura

const ERRO_TAMANHO = 'O código do boleto tem 47 números (ou 48 nas contas de consumo e tributos); o código de barras tem 44. Confira o que foi digitado.';
const conferir = (onde: string) => `O código não confere (${onde}). Confira o que foi digitado — um número trocado muda o valor ou o vencimento.`;

function formatarBancaria(b: string): string {
  const c1 = b.slice(0, 4) + b.slice(19, 24);
  const c2 = b.slice(24, 34);
  const c3 = b.slice(34, 44);
  const d1 = c1 + modulo10(c1);
  const d2 = c2 + modulo10(c2);
  const d3 = c3 + modulo10(c3);
  return `${d1.slice(0, 5)}.${d1.slice(5)} ${d2.slice(0, 5)}.${d2.slice(5)} ${d3.slice(0, 5)}.${d3.slice(5)} ${b[4]} ${b.slice(5, 19)}`;
}

function dvArrecadacao(id: string): (s: string) => number {
  return id === '6' || id === '7' ? modulo10 : modulo11Arrecadacao;
}

function formatarArrecadacao(b: string): string {
  const dv = dvArrecadacao(b[2]);
  return [0, 11, 22, 33].map((i) => { const bl = b.slice(i, i + 11); return `${bl}-${dv(bl)}`; }).join(' ');
}

function lerBancario(barras: string, referencia: string): ResultadoBoleto {
  const dv = modulo11Bancario(barras.slice(0, 4) + barras.slice(5));
  if (dv !== Number(barras[4])) return { ok: false, erro: conferir('dígito verificador geral') };
  if (barras[3] !== '9') return { ok: false, erro: 'Este boleto não é em reais (código de moeda diferente de 9).' };
  const avisos: string[] = [];
  const codigo = barras.slice(0, 3);
  const fator = Number(barras.slice(5, 9));
  const centavos = Number(barras.slice(9, 19));
  const vencimento = dataDoFator(fator, referencia);
  if (!vencimento) avisos.push('O boleto não traz vencimento no código — preencha a data do pagamento.');
  const valor = centavos > 0 ? centavos / 100 : null;
  if (valor === null) avisos.push('O boleto não traz o valor no código (valor em aberto) — preencha o valor pago.');
  return {
    ok: true,
    boleto: {
      tipo: 'bancario', codigoBarras: barras, linhaDigitavel: formatarBancaria(barras),
      banco: { codigo, nome: BANCOS[codigo] ?? `banco ${codigo}` }, segmento: null, valor, vencimento, avisos,
    },
  };
}

function lerArrecadacao(barras: string): ResultadoBoleto {
  const id = barras[2];
  if (!['6', '7', '8', '9'].includes(id)) return { ok: false, erro: conferir('identificador de valor') };
  const dv = dvArrecadacao(id)(barras.slice(0, 3) + barras.slice(4));
  if (dv !== Number(barras[3])) return { ok: false, erro: conferir('dígito verificador geral') };
  const avisos: string[] = ['Conta de consumo ou tributo: o código não traz o vencimento — preencha a data do pagamento.'];
  // 6 e 8: valor efetivo, em centavos, nas posições 5–15. 7 e 9: valor de referência (quantidade, índice).
  const centavos = Number(barras.slice(4, 15));
  const efetivo = id === '6' || id === '8';
  const valor = efetivo && centavos > 0 ? centavos / 100 : null;
  if (valor === null) avisos.push('O código não traz o valor em reais — preencha o valor pago.');
  return {
    ok: true,
    boleto: {
      tipo: 'arrecadacao', codigoBarras: barras, linhaDigitavel: formatarArrecadacao(barras),
      banco: null, segmento: SEGMENTOS[barras[1]] ?? null, valor, vencimento: null, avisos,
    },
  };
}

/**
 * Lê a linha digitável (47 ou 48 números) ou o código de barras (44), com ou sem
 * pontos e espaços. Confere TODOS os dígitos verificadores — um número trocado
 * não vira um valor errado no livro, vira "confira o que foi digitado".
 * `referencia` (AAAA-MM-DD, normalmente hoje) escolhe o ciclo do fator.
 */
export function lerBoleto(entrada: string, referencia: string): ResultadoBoleto {
  const n = String(entrada ?? '').replace(/\D/g, '');
  if (n.length === 44) return n[0] === '8' ? lerArrecadacao(n) : lerBancario(n, referencia);
  if (n.length === 47) {
    if (n[0] === '8') return { ok: false, erro: ERRO_TAMANHO };
    const campos: [string, number][] = [[n.slice(0, 9), Number(n[9])], [n.slice(10, 20), Number(n[20])], [n.slice(21, 31), Number(n[31])]];
    for (let i = 0; i < campos.length; i++) {
      if (modulo10(campos[i][0]) !== campos[i][1]) return { ok: false, erro: conferir(`campo ${i + 1}`) };
    }
    const barras = n.slice(0, 4) + n[32] + n.slice(33, 47) + n.slice(4, 9) + n.slice(10, 20) + n.slice(21, 31);
    return lerBancario(barras, referencia);
  }
  if (n.length === 48) {
    if (n[0] !== '8') return { ok: false, erro: ERRO_TAMANHO };
    const dv = dvArrecadacao(n[2]);
    let barras = '';
    for (let i = 0; i < 4; i++) {
      const bloco = n.slice(i * 12, i * 12 + 11);
      if (dv(bloco) !== Number(n[i * 12 + 11])) return { ok: false, erro: conferir(`bloco ${i + 1}`) };
      barras += bloco;
    }
    return lerArrecadacao(barras);
  }
  return { ok: false, erro: ERRO_TAMANHO };
}

/**
 * Procura uma linha digitável válida num texto (o PDF do boleto). Aceita os
 * números agrupados como vêm impressos ("23790.12345 60000.000001 …") ou
 * corridos. Devolve o primeiro que passa em todos os dígitos verificadores.
 */
export function acharBoletoNoTexto(texto: string, referencia: string): BoletoLido | null {
  const candidatos = String(texto ?? '').match(/\d[\d.\s-]{42,75}\d/g) ?? [];
  for (const c of candidatos) {
    // Um trecho pode juntar a linha com outros números; tenta as janelas dentro dele.
    const n = c.replace(/\D/g, '');
    for (const tam of [47, 48]) {
      for (let i = 0; i + tam <= n.length; i++) {
        const r = lerBoleto(n.slice(i, i + tam), referencia);
        if (r.ok) return r.boleto;
      }
    }
  }
  return null;
}
