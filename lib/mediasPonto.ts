// Médias de horas extras e adicional noturno tiradas da Folha de Ponto, para os reflexos
// da rescisão (aviso, 13º, férias). Puro, sem I/O; testado em tests/mediasPonto.test.ts.
// As horas de cada mês vêm de lib/resumoFolha.ts (mesma régua do "Resumo para a folha"),
// lidas pela rota /api/dp/medias.
//
// Regras revisadas com o subagente `contador` em 21/11/2026:
//  - Súmula 347 TST: quantidade MÉDIA de horas × salário-hora da época do pagamento;
//  - valor-hora = (salário + adicionais fixos) ÷ divisor (horas semanais × 5; 220 para 44h,
//    200 para 40h — Súmula 431 TST); adicionais fixos entram (Súmula 264 TST);
//  - HE 50% (dia útil e sábado de folga, a pagar — as que foram para o banco de horas não
//    contam), HE 100% (domingo e feriado — Súmula 146 TST), adicional noturno de 20% sobre
//    a hora noturna computada (CLT art. 73);
//  - DSR sobre as variáveis, mês a mês: horas do mês ÷ dias úteis × (domingos + feriados)
//    (Súmula 172 TST; Lei 605/49 art. 7º; IRR 10169-57.2013.5.05.0024 — TST revisou a OJ 394);
//  - período por verba: aviso = últimos 12 meses (CLT art. 487 §3º); 13º = meses do ano do
//    desligamento (Decreto 57.155/65 art. 2º); férias = período aquisitivo (CLT art. 142 §5º);
//  - divisor = meses TRABALHADOS do período (mês com 15 dias ou mais de contrato), não os
//    meses com ponto: mês sem ponto entra com zero e aparece para a contadora excluir.
//    O mês do desligamento incompleto fica fora (opção de incluir).
import { chaveData, diaSemana, diasNoMes } from './calendario';
import { PERCENTUAIS_PADRAO, resumirFolha, type RegrasEmpregado } from './resumoFolha';
import type { DiaFreq } from './tipos';

/** Horas de um mês do ponto do empregado (minutos), como a rota devolve. */
export interface MesPonto {
  /** AAAA-MM. */
  mes: string;
  /** Há algum dia lançado no ponto neste mês. */
  temPonto: boolean;
  /** HE de dia útil e sábado de folga, a pagar (fora do banco de horas). */
  he50Min: number;
  /** HE de domingo e feriado. */
  he100Min: number;
  /** Minutos noturnos computados (hora reduzida). */
  noturnoMin: number;
  /** Dias que o resumo não calculou (marcação faltando, ilegível…). */
  diasNaoCalculados: number;
  /** Dias úteis do mês (segunda a sábado, sem feriados) — para o DSR. */
  diasUteis: number;
  /** Domingos e feriados do mês — para o DSR. */
  diasDsr: number;
}

/** Ajuste da contadora num mês: ignorar, ou trocar as horas (em minutos). */
export interface AjusteMes {
  ignorar?: boolean;
  he50Min?: number | null;
  he100Min?: number | null;
  noturnoMin?: number | null;
}

export interface PercentuaisMedia { extra50: number; extra100: number; noturno: number }
export const PERCENTUAIS_MEDIA: PercentuaisMedia = {
  extra50: PERCENTUAIS_PADRAO.extraUtil / 100,
  extra100: PERCENTUAIS_PADRAO.extraDomFeriado / 100,
  noturno: PERCENTUAIS_PADRAO.adicionalNoturno / 100,
};

export interface MesConsiderado {
  mes: string;
  considerado: boolean;
  /** Por que ficou fora (ou observação de quem entrou). */
  nota: string | null;
  ajustado: boolean;
  temPonto: boolean;
  he50: number; he100: number; noturno: number;
  dsr50: number; dsr100: number; dsrNoturno: number;
  /** Valor do mês em R$ (horas + DSR × valor-hora × percentual). */
  valor: number;
}

export interface MediaPeriodo {
  de: string;
  ate: string;
  meses: MesConsiderado[];
  nMeses: number;
  /** Médias mensais de horas (com DSR) — decimal. */
  horas: { he50: number; he100: number; noturno: number };
  valorHora: number;
  /** Média mensal em R$, em centavos. */
  valor: number;
  memoria: string;
}

// ------------------------------------------------------------------ calendário

/** Dias úteis (segunda a sábado não feriado) e dias de repouso (domingos + feriados) do mês. */
export function diasDsrDoMes(ano: number, mes: number, feriados: Set<string>): { diasUteis: number; diasDsr: number } {
  let uteis = 0, dsr = 0;
  for (let d = 1; d <= diasNoMes(ano, mes); d++) {
    if (diaSemana(ano, mes, d) === 0 || feriados.has(chaveData(ano, mes, d))) dsr++;
    else uteis++;
  }
  return { diasUteis: uteis, diasDsr: dsr };
}

/**
 * As horas de um mês do ponto, pela mesma régua do "Resumo para a folha" (lib/resumoFolha.ts):
 * HE a pagar de dia útil/sábado de folga (as do banco de horas ficam fora), HE de domingo e
 * feriado e noturno em hora computada. Mês sem nenhum dia lançado → `temPonto: false`.
 */
export function mesPontoDoResumo(mes: string, dias: DiaFreq[] | undefined, regras: RegrasEmpregado, feriados: Set<string>): MesPonto {
  const [ano, m] = mes.split('-').map(Number);
  const r = resumirFolha({ funcionario: '', dias: dias ?? [], regras }, { ano, mes: m, feriados });
  return {
    mes, temPonto: (dias?.length ?? 0) > 0,
    he50Min: r.extrasUtilPagarMin, he100Min: r.extrasDomFeriadoMin, noturnoMin: r.noturnoComputadoMin,
    diasNaoCalculados: r.detalhe.filter((d) => d.naoCalculado).length,
    ...diasDsrDoMes(ano, m, feriados),
  };
}

/** AAAA-MM somando `n` meses. */
export function somarMes(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number);
  const t = a * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

/** Meses de `de` a `ate` (inclusive), AAAA-MM. */
export function mesesEntre(de: string, ate: string): string[] {
  const r: string[] = [];
  for (let m = de; m <= ate && r.length < 600; m = somarMes(m, 1)) r.push(m);
  return r;
}

/** Dias de contrato no mês (da admissão; o desligamento corta o fim). */
export function diasDeContratoNoMes(mes: string, admissao: string, desligamento: string): number {
  const [a, m] = mes.split('-').map(Number);
  const ini = `${mes}-01`;
  const fim = `${mes}-${String(diasNoMes(a, m)).padStart(2, '0')}`;
  const de = admissao > ini ? admissao : ini;
  const ate = desligamento < fim ? desligamento : fim;
  if (de > ate) return 0;
  return Number(ate.slice(8)) - Number(de.slice(8)) + 1;
}

/** Último mês que entra nas médias: o do desligamento só se completo (ou se a contadora incluir). */
/**
 * Meses civis de um período aquisitivo (10/03/25–09/03/26 → mar/25 a fev/26): o mês do
 * início conta se tiver 15 dias ou mais dentro do período; o do fim, se terminar no dia 15
 * ou depois. Assim o aquisitivo dá 12 meses, não 13.
 */
export function mesesDoAquisitivo(inicio: string, fim: string): { de: string; ate: string } {
  const [ai, mi, di] = inicio.split('-').map(Number);
  const de = diasNoMes(ai, mi) - di + 1 >= 15 ? inicio.slice(0, 7) : somarMes(inicio.slice(0, 7), 1);
  const ate = Number(fim.slice(8)) >= 15 ? fim.slice(0, 7) : somarMes(fim.slice(0, 7), -1);
  return { de, ate };
}

export function ultimoMesDasMedias(desligamento: string, incluirMesDesligamento = false): string {
  const [a, m, d] = desligamento.split('-').map(Number);
  const mes = desligamento.slice(0, 7);
  return incluirMesDesligamento || d === diasNoMes(a, m) ? mes : somarMes(mes, -1);
}

const h = (min: number) => Math.max(0, min) / 60;
const centavos = (v: number) => Math.round(Number((v * 100).toPrecision(12))) / 100;
const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const rotuloMes = (mes: string) => `${MES_CURTO[Number(mes.slice(5)) - 1]}/${mes.slice(2, 4)}`;

/**
 * Horas extras e noturno do PRÓPRIO mês do desligamento (até o último dia): não são média,
 * são verba do mês, pagas na rescisão com INSS, IRRF e FGTS (parecer do `contador`).
 * DSR proporcional pelo calendário do mês inteiro.
 */
export function variaveisDoMes(meses: MesPonto[], mes: string, valorHora: number, ajuste?: AjusteMes, percentuais: PercentuaisMedia = PERCENTUAIS_MEDIA) {
  const x = meses.find((m) => m.mes === mes);
  const he50 = h(ajuste?.he50Min ?? x?.he50Min ?? 0);
  const he100 = h(ajuste?.he100Min ?? x?.he100Min ?? 0);
  const noturno = h(ajuste?.noturnoMin ?? x?.noturnoMin ?? 0);
  const uteis = x?.diasUteis ?? 0;
  const fator = uteis > 0 ? 1 + (x!.diasDsr / uteis) : 1;
  const valor = valorHora * fator * (he50 * (1 + percentuais.extra50) + he100 * (1 + percentuais.extra100) + noturno * percentuais.noturno);
  const partes: string[] = [];
  if (he50) partes.push(`${num(he50)} h × ${num(1 + percentuais.extra50)}`);
  if (he100) partes.push(`${num(he100)} h × ${num(1 + percentuais.extra100)}`);
  if (noturno) partes.push(`${num(noturno)} h × ${num(percentuais.noturno)}`);
  const memoria = partes.length
    ? `(${partes.join(' + ')}) × valor-hora ${reais(centavos(valorHora))}${uteis ? ` × (1 + ${x!.diasDsr} ÷ ${uteis} de DSR)` : ''}`
    : '';
  return { temPonto: Boolean(x?.temPonto), ajustado: ajuste?.he50Min != null || ajuste?.he100Min != null || ajuste?.noturnoMin != null, horas: { he50, he100, noturno }, valor, memoria };
}

export interface OpcoesMedia {
  de: string;
  ate: string;
  admissao: string;
  desligamento: string;
  valorHora: number;
  ajustes?: Record<string, AjusteMes>;
  percentuais?: PercentuaisMedia;
}

/**
 * Média mensal das variáveis do ponto num período. Divide pelos meses trabalhados (15 dias
 * ou mais de contrato), não pelos meses com ponto; a contadora pode ignorar ou ajustar meses.
 */
export function mediaDoPeriodo(meses: MesPonto[], op: OpcoesMedia): MediaPeriodo {
  const p = op.percentuais ?? PERCENTUAIS_MEDIA;
  const porMes = new Map(meses.map((m) => [m.mes, m]));
  const lista: MesConsiderado[] = [];
  for (const mes of op.de <= op.ate ? mesesEntre(op.de, op.ate) : []) {
    const dias = diasDeContratoNoMes(mes, op.admissao, op.desligamento);
    if (dias === 0) continue; // antes da admissão: nem aparece
    const x = porMes.get(mes);
    const aj = op.ajustes?.[mes] ?? {};
    const ajustado = aj.he50Min != null || aj.he100Min != null || aj.noturnoMin != null;
    const he50 = h(aj.he50Min ?? x?.he50Min ?? 0);
    const he100 = h(aj.he100Min ?? x?.he100Min ?? 0);
    const noturno = h(aj.noturnoMin ?? x?.noturnoMin ?? 0);
    const [ano, m] = mes.split('-').map(Number);
    const uteis = x?.diasUteis ?? diasDsrDoMes(ano, m, new Set()).diasUteis;
    const dsrDias = x?.diasDsr ?? diasDsrDoMes(ano, m, new Set()).diasDsr;
    const dsr = (v: number) => (uteis > 0 ? (v / uteis) * dsrDias : 0);
    const item: MesConsiderado = {
      mes, considerado: true, nota: null, ajustado, temPonto: Boolean(x?.temPonto),
      he50, he100, noturno, dsr50: dsr(he50), dsr100: dsr(he100), dsrNoturno: dsr(noturno), valor: 0,
    };
    if (dias < 15) { item.considerado = false; item.nota = `${dias} dia${dias === 1 ? '' : 's'} de contrato (menos de 15)`; }
    else if (aj.ignorar) { item.considerado = false; item.nota = 'Ignorado pela contadora'; }
    else if (!item.temPonto && !ajustado) item.nota = 'Sem ponto lançado: entra com zero';
    else if (x && x.diasNaoCalculados > 0 && !ajustado) item.nota = `${x.diasNaoCalculados} dia(s) do ponto sem cálculo: confira`;
    item.valor = op.valorHora * (
      (item.he50 + item.dsr50) * (1 + p.extra50)
      + (item.he100 + item.dsr100) * (1 + p.extra100)
      + (item.noturno + item.dsrNoturno) * p.noturno);
    lista.push(item);
  }
  const usados = lista.filter((m) => m.considerado);
  const n = usados.length;
  const soma = (f: (m: MesConsiderado) => number) => usados.reduce((s, m) => s + f(m), 0);
  const horas = {
    he50: n ? soma((m) => m.he50 + m.dsr50) / n : 0,
    he100: n ? soma((m) => m.he100 + m.dsr100) / n : 0,
    noturno: n ? soma((m) => m.noturno + m.dsrNoturno) / n : 0,
  };
  const valor = n ? centavos(soma((m) => m.valor) / n) : 0;
  const partes: string[] = [];
  if (horas.he50) partes.push(`${num(horas.he50)} h × ${num(1 + p.extra50)}`);
  if (horas.he100) partes.push(`${num(horas.he100)} h × ${num(1 + p.extra100)}`);
  if (horas.noturno) partes.push(`${num(horas.noturno)} h × ${num(p.noturno)}`);
  const periodo = n ? `${n} mes${n === 1 ? '' : 'es'} (${rotuloMes(usados[0].mes)} a ${rotuloMes(usados[n - 1].mes)})` : 'nenhum mês';
  const memoria = !n ? 'Sem meses trabalhados no período'
    : !partes.length ? `Sem horas extras nem noturno em ${periodo}`
      : `Média de ${periodo}, com DSR: (${partes.join(' + ')}) × valor-hora ${reais(centavos(op.valorHora))}`;
  return { de: op.de, ate: op.ate, meses: lista, nMeses: n, horas, valorHora: op.valorHora, valor, memoria };
}
