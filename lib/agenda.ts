// Agenda de obrigações — regras puras (sem I/O). Roda no servidor (cron, rotas)
// e no navegador (a tela gera as ocorrências do mês que está mostrando).
//
// Uma OBRIGAÇÃO é a regra ("DAS da empresa X, dia 20 do mês seguinte, prorroga
// se cair em dia não útil"); uma OCORRÊNCIA é uma competência concreta dela
// ("DAS de 10/2026, vence 20/11/2026"). Ocorrências não são gravadas: saem da
// regra a cada consulta. Só a CONCLUSÃO (feita por quem, quando) vai ao banco.
//
// Datas sempre AAAA-MM-DD com Date.UTC — a Vercel roda em UTC e Belém em UTC−3.
// Catálogo, prazos e modelos definidos com o consultor contábil em 21/11/2026
// (ver docs/agenda.md).
import { chaveData, diasNoMes, diaSemana } from './calendario';

// ================================================================== tipos
export type Recorrencia = 'mensal' | 'trimestral' | 'anual' | 'unica';
/** Como o dia de vencimento é contado dentro do mês. */
export type ModoDia = 'dia_fixo' | 'n_dia_util' | 'ultimo_dia_util';
/** O que fazer quando o dia fixo cai em dia não útil. */
export type AjusteDia = 'antecipa' | 'prorroga' | 'nenhum';

export const RECORRENCIAS: Recorrencia[] = ['mensal', 'trimestral', 'anual', 'unica'];
export const MODOS_DIA: ModoDia[] = ['dia_fixo', 'n_dia_util', 'ultimo_dia_util'];
export const AJUSTES: AjusteDia[] = ['antecipa', 'prorroga', 'nenhum'];

export interface Obrigacao {
  id: string;
  empresaId: string;
  tipo: string;
  /** Nome de tela (padrão = nome do tipo; editável: "ISS Belém"). */
  nome: string;
  recorrencia: Recorrencia;
  modoDia: ModoDia;
  /** Dia do mês (dia_fixo) ou n-ésimo dia útil (n_dia_util). Ignorado em ultimo_dia_util. */
  dia: number;
  /** Anual: mês do vencimento (1–12). */
  mes?: number | null;
  /**
   * Distância entre a competência e o mês do vencimento: mensal/trimestral em
   * meses (1 = mês seguinte ao fim da competência), anual em anos (1 = ano seguinte).
   */
  defasagem: number;
  ajuste: AjusteDia;
  /** Única: a data (AAAA-MM-DD). */
  dataUnica?: string | null;
  /** Dias de antecedência para começar a avisar (certificado: 30). 0 = janela padrão. */
  avisoDias: number;
  /** Acompanhar a partir desta data: ocorrências que vencem antes não aparecem. */
  inicio: string;
  responsavel?: string | null;
  observacao?: string | null;
  ativa: boolean;
}

export interface Ocorrencia {
  obrigacaoId: string;
  empresaId: string;
  competencia: string;
  /** Vencimento já ajustado ao dia útil. */
  vencimento: string;
}

export interface Conclusao {
  obrigacaoId: string;
  competencia: string;
  feitaPor: string;
  feitaEm: string;
}

export type Situacao = 'feita' | 'atrasada' | 'hoje' | 'proxima' | 'futura';

// ================================================================== datas
const partes = (iso: string) => iso.split('-').map(Number) as [number, number, number];
export const isoValida = (s: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'))
  && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;

export function somarDias(iso: string, n: number): string {
  const [a, m, d] = partes(iso);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

export function diasEntre(de: string, ate: string): number {
  const t = (iso: string) => { const [a, m, d] = partes(iso); return Date.UTC(a, m - 1, d); };
  return Math.round((t(ate) - t(de)) / 86_400_000);
}

export function hojeBelem(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem' }).format(agora);
}

export function br(iso: string): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Soma meses a (ano, mês 1–12). */
function somarMeses(ano: number, mes: number, n: number): [number, number] {
  const t = ano * 12 + (mes - 1) + n;
  return [Math.floor(t / 12), (t % 12 + 12) % 12 + 1];
}

// =============================================================== feriados
/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano). */
export function pascoa(ano: number): string {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return chaveData(ano, mes, dia);
}

const FIXOS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];

/**
 * Dias sem expediente bancário no país — o que conta para vencimento federal.
 * Fixos (inclui 20/11, nacional desde a Lei 14.759/2023), Sexta-feira Santa e,
 * embora não sejam feriado em lei, segunda e terça de Carnaval e Corpus Christi
 * (sem expediente bancário; a Receita e o mercado tratam como não úteis).
 * Quarta de Cinzas é útil. Estaduais/municipais entram por `extras`.
 */
export function feriadosNacionais(ano: number): string[] {
  const p = pascoa(ano);
  return [
    ...FIXOS.map((md) => `${ano}-${md}`),
    somarDias(p, -48), somarDias(p, -47), // Carnaval (segunda e terça)
    somarDias(p, -2),                     // Sexta-feira Santa
    somarDias(p, 60),                     // Corpus Christi
  ].sort();
}

/** Calendário de dias não úteis: nacionais (gerados por ano, sob demanda) + extras. */
export class Calendario {
  private anos = new Set<number>();
  private dias = new Set<string>();
  constructor(extras: Iterable<string> = []) {
    for (const d of extras) this.dias.add(d);
  }
  private garantir(ano: number) {
    if (this.anos.has(ano)) return;
    this.anos.add(ano);
    for (const d of feriadosNacionais(ano)) this.dias.add(d);
  }
  feriado(iso: string): boolean {
    this.garantir(partes(iso)[0]);
    return this.dias.has(iso);
  }
  util(iso: string): boolean {
    const [a, m, d] = partes(iso);
    const ds = diaSemana(a, m, d);
    return ds !== 0 && ds !== 6 && !this.feriado(iso);
  }
  ajustar(iso: string, ajuste: AjusteDia): string {
    if (ajuste === 'nenhum') return iso;
    const passo = ajuste === 'antecipa' ? -1 : 1;
    let d = iso;
    while (!this.util(d)) d = somarDias(d, passo);
    return d;
  }
  /** n-ésimo dia útil do mês (n ≥ 1); se o mês não tiver tantos, o último útil. */
  nDiaUtil(ano: number, mes: number, n: number): string {
    let conta = 0, ultimo = '';
    for (let dia = 1; dia <= diasNoMes(ano, mes); dia++) {
      const iso = chaveData(ano, mes, dia);
      if (!this.util(iso)) continue;
      ultimo = iso;
      if (++conta === n) return iso;
    }
    return ultimo;
  }
  ultimoDiaUtil(ano: number, mes: number): string {
    return this.ajustar(chaveData(ano, mes, diasNoMes(ano, mes)), 'antecipa');
  }
}

// ============================================================ ocorrências
/** Dia do vencimento dentro de um mês, segundo o modo e o ajuste da obrigação. */
export function vencimentoNoMes(o: Pick<Obrigacao, 'modoDia' | 'dia' | 'ajuste'>, ano: number, mes: number, cal: Calendario): string {
  if (o.modoDia === 'ultimo_dia_util') return cal.ultimoDiaUtil(ano, mes);
  if (o.modoDia === 'n_dia_util') return cal.nDiaUtil(ano, mes, Math.max(1, o.dia));
  const dia = Math.min(Math.max(1, o.dia), diasNoMes(ano, mes));
  return cal.ajustar(chaveData(ano, mes, dia), o.ajuste);
}

/** Competência de um mês de vencimento, ou null se a obrigação não vence nele. */
function competenciaDoMes(o: Obrigacao, ano: number, mes: number): string | null {
  if (o.recorrencia === 'mensal') {
    const [a, m] = somarMeses(ano, mes, -o.defasagem);
    return `${a}-${String(m).padStart(2, '0')}`;
  }
  if (o.recorrencia === 'trimestral') {
    const [a, m] = somarMeses(ano, mes, -o.defasagem);
    return m % 3 === 0 ? `${a}-T${m / 3}` : null;
  }
  if (o.recorrencia === 'anual') {
    return mes === (o.mes ?? 1) ? String(ano - o.defasagem) : null;
  }
  return null;
}

/**
 * Ocorrências de uma obrigação com vencimento (ajustado) em [de, ate].
 * Respeita `inicio` (nada vence antes dele) e `ativa`.
 */
export function ocorrencias(o: Obrigacao, de: string, ate: string, cal: Calendario): Ocorrencia[] {
  if (!o.ativa || ate < de) return [];
  const piso = de > o.inicio ? de : o.inicio;
  const base = { obrigacaoId: o.id, empresaId: o.empresaId };

  if (o.recorrencia === 'unica') {
    if (!o.dataUnica || !isoValida(o.dataUnica)) return [];
    const v = cal.ajustar(o.dataUnica, o.ajuste);
    return v >= piso && v <= ate ? [{ ...base, competencia: 'unica', vencimento: v }] : [];
  }

  // Um mês de folga de cada lado: o ajuste pode empurrar o dia para o mês vizinho.
  const [a0, m0] = partes(piso);
  const [a1, m1] = partes(ate);
  const lista: Ocorrencia[] = [];
  for (let [a, m] = somarMeses(a0, m0, -1); a * 12 + m <= a1 * 12 + m1 + 1; [a, m] = somarMeses(a, m, 1)) {
    const competencia = competenciaDoMes(o, a, m);
    if (!competencia) continue;
    const vencimento = vencimentoNoMes(o, a, m, cal);
    if (vencimento >= piso && vencimento <= ate) lista.push({ ...base, competencia, vencimento });
  }
  return lista;
}

/** Ocorrências de várias obrigações, ordenadas por vencimento. */
export function ocorrenciasDe(obrigacoes: Obrigacao[], de: string, ate: string, cal = new Calendario()): Ocorrencia[] {
  return obrigacoes
    .flatMap((o) => ocorrencias(o, de, ate, cal))
    .sort((x, y) => x.vencimento.localeCompare(y.vencimento) || x.obrigacaoId.localeCompare(y.obrigacaoId));
}

export const chaveConclusao = (obrigacaoId: string, competencia: string) => `${obrigacaoId}|${competencia}`;

/** Janela padrão de "vence em breve", em dias corridos. */
export const JANELA_PADRAO = 7;

export function situacao(
  oc: Ocorrencia, hoje: string, feita: boolean, avisoDias = 0, janela = JANELA_PADRAO,
): Situacao {
  if (feita) return 'feita';
  if (oc.vencimento < hoje) return 'atrasada';
  if (oc.vencimento === hoje) return 'hoje';
  return diasEntre(hoje, oc.vencimento) <= Math.max(janela, avisoDias) ? 'proxima' : 'futura';
}

/** Rótulo de tela da competência ("10/2026", "3º tri/2026", "2025", "—"). */
export function rotuloCompetencia(c: string): string {
  let m = c.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${m[2]}/${m[1]}`;
  m = c.match(/^(\d{4})-T([1-4])$/);
  if (m) return `${m[2]}º tri/${m[1]}`;
  if (/^\d{4}$/.test(c)) return c;
  return '—';
}

/** Competência bem formada para a recorrência (validação das rotas). */
export function competenciaValida(c: string, r: Recorrencia): boolean {
  if (r === 'mensal') return /^\d{4}-(0[1-9]|1[0-2])$/.test(c);
  if (r === 'trimestral') return /^\d{4}-T[1-4]$/.test(c);
  if (r === 'anual') return /^\d{4}$/.test(c);
  return c === 'unica';
}

// ================================================================ catálogo
export interface TipoObrigacao {
  codigo: string;
  nome: string;
  padrao: Pick<Obrigacao, 'recorrencia' | 'modoDia' | 'dia' | 'defasagem' | 'ajuste' | 'avisoDias'> & { mes?: number };
  /** Texto de apoio na tela (quando o dia varia por município/estado, etc.). */
  dica?: string;
}

const mensal = (dia: number, ajuste: AjusteDia, defasagem = 1) =>
  ({ recorrencia: 'mensal', modoDia: 'dia_fixo', dia, defasagem, ajuste, avisoDias: 0 }) as const;
const mensalUltimoUtil = (defasagem = 1) =>
  ({ recorrencia: 'mensal', modoDia: 'ultimo_dia_util', dia: 0, defasagem, ajuste: 'nenhum', avisoDias: 0 }) as const;

/**
 * Catálogo fechado (+ "outra"). Prazos vigentes em 2026, conferidos com o
 * consultor contábil: DCTFWeb no último dia útil do mês seguinte (IN RFB
 * 2.248/2025); DIRF extinta desde o ano-calendário 2025 (IN RFB 2.181/2024) —
 * fica fora. IRPF/DEFIS/DASN mudam por norma anual: o dia é editável.
 */
export const CATALOGO: TipoObrigacao[] = [
  { codigo: 'das', nome: 'DAS – Simples Nacional', padrao: mensal(20, 'prorroga') },
  { codigo: 'das_mei', nome: 'DAS-MEI', padrao: mensal(20, 'prorroga') },
  { codigo: 'dasn_simei', nome: 'DASN-SIMEI', padrao: { recorrencia: 'anual', modoDia: 'dia_fixo', dia: 31, mes: 5, defasagem: 1, ajuste: 'prorroga', avisoDias: 15 }, dica: 'Confira a data a cada ano: a Receita pode prorrogar.' },
  { codigo: 'defis', nome: 'DEFIS', padrao: { recorrencia: 'anual', modoDia: 'dia_fixo', dia: 31, mes: 3, defasagem: 1, ajuste: 'prorroga', avisoDias: 15 }, dica: 'Confira a data a cada ano: a Receita pode prorrogar.' },
  { codigo: 'dctfweb', nome: 'DCTFWeb (entrega)', padrao: mensalUltimoUtil() },
  { codigo: 'darf_previdenciario', nome: 'DARF previdenciário (INSS)', padrao: mensal(20, 'antecipa') },
  { codigo: 'fgts_digital', nome: 'FGTS Digital', padrao: mensal(20, 'antecipa') },
  { codigo: 'esocial_fechamento', nome: 'eSocial – folha e fechamento', padrao: mensal(15, 'antecipa') },
  { codigo: 'efd_reinf', nome: 'EFD-Reinf', padrao: mensal(15, 'antecipa') },
  { codigo: 'folha_pagamento', nome: 'Pagamento de salários', padrao: { recorrencia: 'mensal', modoDia: 'n_dia_util', dia: 5, defasagem: 1, ajuste: 'nenhum', avisoDias: 0 } },
  { codigo: 'pro_labore', nome: 'Pró-labore', padrao: { recorrencia: 'mensal', modoDia: 'n_dia_util', dia: 5, defasagem: 1, ajuste: 'nenhum', avisoDias: 0 } },
  { codigo: 'irrf', nome: 'IRRF (DARF)', padrao: mensal(20, 'antecipa') },
  { codigo: 'pis_cofins', nome: 'PIS/COFINS', padrao: mensal(25, 'antecipa') },
  { codigo: 'irpj_csll', nome: 'IRPJ/CSLL trimestral', padrao: { recorrencia: 'trimestral', modoDia: 'ultimo_dia_util', dia: 0, defasagem: 1, ajuste: 'nenhum', avisoDias: 0 } },
  { codigo: 'iss', nome: 'ISS municipal', padrao: mensal(10, 'prorroga'), dica: 'O dia varia por município — confira o da prefeitura da empresa.' },
  { codigo: 'icms', nome: 'ICMS / DIFAL / ST', padrao: mensal(15, 'antecipa'), dica: 'O dia varia por estado e atividade — confira na SEFAZ.' },
  { codigo: 'carne_leao', nome: 'Carnê-Leão', padrao: mensalUltimoUtil() },
  { codigo: 'irpf', nome: 'IRPF – declaração anual', padrao: { recorrencia: 'anual', modoDia: 'ultimo_dia_util', dia: 0, mes: 5, defasagem: 1, ajuste: 'nenhum', avisoDias: 30 } },
  { codigo: 'dmed', nome: 'DMED', padrao: { recorrencia: 'anual', modoDia: 'ultimo_dia_util', dia: 0, mes: 2, defasagem: 1, ajuste: 'nenhum', avisoDias: 15 } },
  { codigo: 'parcelamento', nome: 'Parcela de parcelamento', padrao: mensalUltimoUtil(0) },
  { codigo: 'certificado_digital', nome: 'Vencimento do certificado digital', padrao: { recorrencia: 'unica', modoDia: 'dia_fixo', dia: 1, defasagem: 0, ajuste: 'nenhum', avisoDias: 30 }, dica: 'Informe a data de validade do certificado. Ao renovar, atualize a data.' },
  { codigo: 'alvara', nome: 'Alvará de funcionamento', padrao: { recorrencia: 'anual', modoDia: 'dia_fixo', dia: 31, mes: 1, defasagem: 0, ajuste: 'nenhum', avisoDias: 30 }, dica: 'A data varia por município.' },
  { codigo: 'licenca_sanitaria', nome: 'Licença sanitária / Bombeiros', padrao: { recorrencia: 'anual', modoDia: 'dia_fixo', dia: 31, mes: 3, defasagem: 0, ajuste: 'nenhum', avisoDias: 30 }, dica: 'Informe a data da licença da empresa.' },
  { codigo: 'contrato_experiencia', nome: 'Fim do contrato de experiência', padrao: { recorrencia: 'unica', modoDia: 'dia_fixo', dia: 1, defasagem: 0, ajuste: 'nenhum', avisoDias: 7 } },
  { codigo: 'outra', nome: 'Outra obrigação', padrao: mensal(10, 'antecipa') },
];

export const TIPO_POR_CODIGO = new Map(CATALOGO.map((t) => [t.codigo, t]));

// ================================================================= modelos
export type Regime = 'mei' | 'simples' | 'simples_folha' | 'presumido' | 'pessoa_fisica';

export const MODELOS: { regime: Regime; nome: string; tipos: string[]; descricao: string }[] = [
  { regime: 'mei', nome: 'MEI', tipos: ['das_mei', 'dasn_simei', 'alvara'], descricao: 'DAS-MEI, DASN-SIMEI e alvará.' },
  {
    regime: 'simples', nome: 'Simples Nacional sem funcionário',
    tipos: ['das', 'defis', 'pro_labore', 'esocial_fechamento', 'dctfweb', 'darf_previdenciario', 'iss', 'certificado_digital', 'alvara'],
    descricao: 'DAS, DEFIS, pró-labore com eSocial/DCTFWeb/INSS, ISS, certificado e alvará.',
  },
  {
    regime: 'simples_folha', nome: 'Simples Nacional com folha',
    tipos: ['das', 'defis', 'pro_labore', 'folha_pagamento', 'esocial_fechamento', 'dctfweb', 'darf_previdenciario', 'fgts_digital', 'irrf', 'iss', 'certificado_digital', 'alvara'],
    descricao: 'O do Simples mais salários, FGTS Digital e IRRF.',
  },
  {
    regime: 'presumido', nome: 'Lucro Presumido',
    tipos: ['pis_cofins', 'irpj_csll', 'dctfweb', 'darf_previdenciario', 'esocial_fechamento', 'efd_reinf', 'irrf', 'pro_labore', 'iss', 'certificado_digital', 'alvara'],
    descricao: 'PIS/COFINS, IRPJ/CSLL, DCTFWeb, INSS, eSocial, EFD-Reinf, IRRF, pró-labore, ISS, certificado e alvará.',
  },
  { regime: 'pessoa_fisica', nome: 'Pessoa física / autônomo', tipos: ['carne_leao', 'irpf'], descricao: 'Carnê-Leão e IRPF.' },
];

export type NovaObrigacao = Omit<Obrigacao, 'id'>;

/** Obrigação nova de um tipo do catálogo, com os prazos padrão. */
export function obrigacaoDoTipo(codigo: string, empresaId: string, inicio: string): NovaObrigacao | null {
  const t = TIPO_POR_CODIGO.get(codigo);
  if (!t) return null;
  const p = t.padrao;
  return {
    empresaId, tipo: t.codigo, nome: t.nome, recorrencia: p.recorrencia, modoDia: p.modoDia, dia: p.dia,
    mes: p.mes ?? null, defasagem: p.defasagem, ajuste: p.ajuste, avisoDias: p.avisoDias,
    // Única precisa de data informada pelo contador; sem ela a obrigação não gera nada.
    dataUnica: null, inicio, responsavel: null, observacao: null, ativa: true,
  };
}

/**
 * Obrigações que um modelo cria numa empresa, pulando tipos que ela já tem.
 * Tipos de recorrência única (certificado) ficam de fora: dependem de uma data
 * que só o contador sabe — a tela os cadastra à parte.
 */
export function aplicarModelo(regime: Regime, empresaId: string, inicio: string, tiposExistentes: Iterable<string> = []): NovaObrigacao[] {
  const modelo = MODELOS.find((m) => m.regime === regime);
  if (!modelo) return [];
  const ja = new Set(tiposExistentes);
  return modelo.tipos
    .filter((t) => !ja.has(t))
    .map((t) => obrigacaoDoTipo(t, empresaId, inicio))
    .filter((o): o is NovaObrigacao => o !== null && o.recorrencia !== 'unica');
}

// ================================================================ validação
/** Normaliza e valida o que veio do navegador. Devolve a obrigação ou a lista de erros. */
export function validarObrigacao(b: Partial<NovaObrigacao>): { ok: true; obrigacao: NovaObrigacao } | { ok: false; erros: string[] } {
  const erros: string[] = [];
  const recorrencia = b.recorrencia as Recorrencia;
  const modoDia = (b.modoDia ?? 'dia_fixo') as ModoDia;
  const ajuste = (b.ajuste ?? 'nenhum') as AjusteDia;
  const inteiro = (v: unknown, padrao = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : padrao);
  const dia = inteiro(b.dia);
  const mes = b.mes == null || (b.mes as unknown) === '' ? null : inteiro(b.mes);
  const defasagem = inteiro(b.defasagem);
  const avisoDias = inteiro(b.avisoDias);
  const nome = String(b.nome ?? '').trim();
  const tipo = String(b.tipo ?? '').trim();

  if (!String(b.empresaId ?? '').trim()) erros.push('Informe a empresa.');
  if (!TIPO_POR_CODIGO.has(tipo)) erros.push('Tipo de obrigação inválido.');
  if (!nome) erros.push('Informe o nome da obrigação.');
  if (nome.length > 120) erros.push('Nome muito longo.');
  if (!RECORRENCIAS.includes(recorrencia)) erros.push('Recorrência inválida.');
  if (!MODOS_DIA.includes(modoDia)) erros.push('Forma de contar o dia inválida.');
  if (!AJUSTES.includes(ajuste)) erros.push('Regra de dia útil inválida.');
  if (recorrencia !== 'unica') {
    if (modoDia === 'dia_fixo' && (dia < 1 || dia > 31)) erros.push('Dia do vencimento deve estar entre 1 e 31.');
    if (modoDia === 'n_dia_util' && (dia < 1 || dia > 23)) erros.push('O dia útil deve estar entre 1 e 23.');
    if (defasagem < 0 || defasagem > 12) erros.push('O vencimento deve ser até 12 meses depois da competência.');
  }
  if (recorrencia === 'anual' && (mes == null || mes < 1 || mes > 12)) erros.push('Informe o mês do vencimento.');
  if (recorrencia === 'unica' && !isoValida(b.dataUnica)) erros.push('Informe a data do vencimento.');
  if (avisoDias < 0 || avisoDias > 120) erros.push('Antecedência do aviso deve estar entre 0 e 120 dias.');
  if (!isoValida(b.inicio)) erros.push('Informe a partir de quando acompanhar.');
  const responsavel = String(b.responsavel ?? '').trim().toLowerCase() || null;
  if (responsavel && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(responsavel)) erros.push('Responsável inválido.');
  if (erros.length) return { ok: false, erros };

  return {
    ok: true,
    obrigacao: {
      empresaId: String(b.empresaId).trim(), tipo, nome, recorrencia,
      modoDia: recorrencia === 'unica' ? 'dia_fixo' : modoDia,
      dia: modoDia === 'ultimo_dia_util' || recorrencia === 'unica' ? 0 : dia,
      mes: recorrencia === 'anual' ? mes : null,
      defasagem: recorrencia === 'unica' ? 0 : defasagem,
      ajuste: modoDia === 'dia_fixo' || recorrencia === 'unica' ? ajuste : 'nenhum',
      dataUnica: recorrencia === 'unica' ? (b.dataUnica as string) : null,
      avisoDias, inicio: b.inicio as string, responsavel,
      observacao: String(b.observacao ?? '').trim().slice(0, 500) || null,
      ativa: b.ativa !== false,
    },
  };
}

/** Descrição curta da regra ("dia 20 do mês seguinte · prorroga"). */
export function descreverRegra(o: Pick<Obrigacao, 'recorrencia' | 'modoDia' | 'dia' | 'mes' | 'defasagem' | 'ajuste' | 'dataUnica'>): string {
  if (o.recorrencia === 'unica') return o.dataUnica ? `em ${br(o.dataUnica)}` : 'sem data';
  const dia = o.modoDia === 'ultimo_dia_util' ? 'último dia útil'
    : o.modoDia === 'n_dia_util' ? `${o.dia}º dia útil` : `dia ${o.dia}`;
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  let quando: string;
  if (o.recorrencia === 'anual') {
    quando = `de ${MESES[(o.mes ?? 1) - 1]}${o.defasagem === 1 ? ' do ano seguinte' : o.defasagem > 1 ? ` (+${o.defasagem} anos)` : ''}`;
  } else {
    const base = o.recorrencia === 'trimestral' ? 'após o trimestre' : '';
    quando = o.defasagem === 0 ? (base ? 'do último mês do trimestre' : 'do próprio mês')
      : o.defasagem === 1 ? (base ? 'do mês seguinte ao trimestre' : 'do mês seguinte')
        : `${o.defasagem} meses ${base || 'depois'}`;
  }
  const ajuste = o.modoDia === 'dia_fixo' && o.ajuste !== 'nenhum'
    ? ` · ${o.ajuste === 'antecipa' ? 'antecipa' : 'prorroga'} se não for útil` : '';
  return `${dia} ${quando}${ajuste}`;
}

// ============================================================ aviso por e-mail
export type Frequencia = 'diario' | 'semanal' | 'desligado';
export const FREQUENCIAS: Frequencia[] = ['diario', 'semanal', 'desligado'];

/**
 * O cron roda todo dia. Semanal sai na segunda; diário, de segunda a sexta.
 * (Dia útil "de calendário" — feriado nacional não manda resumo diário.)
 */
export function deveEnviar(freq: Frequencia, hoje: string, cal = new Calendario()): boolean {
  if (freq === 'desligado') return false;
  const [a, m, d] = partes(hoje);
  if (freq === 'semanal') return diaSemana(a, m, d) === 1;
  return cal.util(hoje);
}

export interface ItemResumo {
  empresa: string;
  obrigacao: string;
  competencia: string;
  vencimento: string;
  responsavel?: string | null;
}

export interface Resumo {
  atrasadas: ItemResumo[];
  hoje: ItemResumo[];
  proximas: ItemResumo[];
}

/** Separa as ocorrências NÃO feitas em atrasadas / hoje / próximos `janela` dias. */
export function montarResumo(
  itens: (ItemResumo & { avisoDias?: number })[], hoje: string, janela: number,
): Resumo {
  const r: Resumo = { atrasadas: [], hoje: [], proximas: [] };
  for (const i of [...itens].sort((x, y) => x.vencimento.localeCompare(y.vencimento) || x.empresa.localeCompare(y.empresa))) {
    const { avisoDias, ...item } = i;
    if (i.vencimento < hoje) r.atrasadas.push(item);
    else if (i.vencimento === hoje) r.hoje.push(item);
    else if (diasEntre(hoje, i.vencimento) <= Math.max(janela, avisoDias ?? 0)) r.proximas.push(item);
  }
  return r;
}

export const resumoVazio = (r: Resumo) => !r.atrasadas.length && !r.hoje.length && !r.proximas.length;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Assunto, texto e HTML do e-mail. HTML simples, estilos em linha (cliente de e-mail não lê CSS externo). */
export function emailDoResumo(r: Resumo, opcoes: { escritorio: string; hoje: string; frequencia: Frequencia; urlAgenda?: string }) {
  const partesAssunto = [
    r.atrasadas.length && `${r.atrasadas.length} atrasada${r.atrasadas.length > 1 ? 's' : ''}`,
    r.hoje.length && `${r.hoje.length} vence${r.hoje.length > 1 ? 'm' : ''} hoje`,
    r.proximas.length && `${r.proximas.length} nos próximos dias`,
  ].filter(Boolean);
  const titulo = opcoes.frequencia === 'semanal' ? 'Resumo da semana' : 'Resumo do dia';
  const assunto = `${titulo}: ${partesAssunto.join(', ') || 'nada pendente'} — ${opcoes.escritorio}`;

  const grupos: [string, ItemResumo[], string][] = [
    ['Atrasadas', r.atrasadas, '#b91c1c'],
    ['Vencem hoje', r.hoje, '#92400e'],
    ['Próximos dias', r.proximas, '#0f4c54'],
  ];
  const linhaTexto = (i: ItemResumo) =>
    `- ${br(i.vencimento)} · ${i.empresa} · ${i.obrigacao} (${rotuloCompetencia(i.competencia)})${i.responsavel ? ` · ${i.responsavel}` : ''}`;
  const texto = [
    `${titulo} da agenda de obrigações — ${opcoes.escritorio} (${br(opcoes.hoje)})`, '',
    ...grupos.filter(([, l]) => l.length).flatMap(([t, l]) => [`${t}:`, ...l.map(linhaTexto), '']),
    opcoes.urlAgenda ? `Abrir a agenda: ${opcoes.urlAgenda}` : '',
  ].join('\n').trim();

  // Cores fixas: e-mail não tem os tokens do app (são os valores do tema claro de app/globals.css).
  const tabela = (l: ItemResumo[]) => `<table role="presentation" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:14px">${
    l.map((i) => `<tr style="border-bottom:1px solid #dde6e7"><td style="white-space:nowrap;color:#47595d">${br(i.vencimento)}</td><td><strong>${esc(i.empresa)}</strong><br>${esc(i.obrigacao)} · ${esc(rotuloCompetencia(i.competencia))}</td><td style="color:#47595d">${esc(i.responsavel ?? '')}</td></tr>`).join('')
  }</table>`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f2226;max-width:640px">
<h1 style="font-size:18px;margin:0 0 4px">${esc(titulo)} da agenda</h1>
<p style="margin:0 0 16px;color:#47595d">${esc(opcoes.escritorio)} · ${br(opcoes.hoje)}</p>
${grupos.filter(([, l]) => l.length).map(([t, l, cor]) => `<h2 style="font-size:15px;margin:16px 0 4px;color:${cor}">${t} (${l.length})</h2>${tabela(l)}`).join('\n')}
${opcoes.urlAgenda ? `<p style="margin-top:20px"><a href="${esc(opcoes.urlAgenda)}" style="color:#14636c">Abrir a agenda no ClickContas</a></p>` : ''}
<p style="margin-top:20px;font-size:12px;color:#5f7377">Você recebe este resumo porque o seu escritório ligou o aviso da agenda. Para mudar, use “Avisos por e-mail” na Agenda.</p>
</div>`;
  return { assunto, texto, html };
}
