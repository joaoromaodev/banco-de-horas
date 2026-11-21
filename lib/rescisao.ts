// Rescisão — SIMULAÇÃO (puro, sem I/O; testado em tests/rescisao.test.ts). Ver a seção
// "Simulação de rescisão" em docs/departamento-pessoal.md.
//
// Não é documento oficial e não substitui o TRCT: depende de médias, convenção coletiva,
// estabilidades e do saldo real do FGTS, que o sistema não conhece. Desde a Sprint 11 dá
// também INSS, IRRF e o LÍQUIDO (tabelas em lib/tabelasTributos.ts) e tira as médias de HE e
// adicional noturno do ponto (lib/mediasPonto.ts). Sem pensão alimentícia. Arredondamento:
// cada linha em centavos; os totais somam as linhas.
//
// Regras revisadas com o subagente `contador` em 21/11/2026 (fontes ao lado de cada uma):
//  - saldo de salário: (salário + adicionais fixos) ÷ 30 × dias do mês até o desligamento
//    (mês completo = 30, inclusive fevereiro e meses de 31) − faltas lançadas no mês;
//    médias de variáveis não entram (vão na folha do mês);
//  - aviso prévio proporcional: 30 dias + 3 por ano completo, até 90 (Lei 12.506/2011;
//    NT 184/2012 MTE), anos contados até a comunicação; só a favor do empregado — no pedido
//    de demissão é sempre 30. Indenizado: (salário + adicionais + médias) ÷ 30 × dias
//    (art. 487 §1º e §5º). Trabalhado: 30 dias trabalhados e os 3n acrescidos indenizados
//    (prática dominante; a lei não é expressa). Projeção = desligamento + dias indenizados
//    (art. 487 §1º; Súmula 380 TST; OJ 82 SDI-1);
//  - acordo (art. 484-A): aviso indenizado pela metade (projeção pela metade, prática dos
//    sistemas de folha — divergente), multa do FGTS de 20%; culpa recíproca (art. 484;
//    Súmula 14 TST): metade do aviso, do 13º e das férias proporcionais, multa de 20%;
//  - pedido de demissão sem cumprir o aviso: desconto de 30 dias do salário base (art. 487
//    §2º), ou só dos dias que faltaram;
//  - 13º proporcional: (salário + adicionais + médias) ÷ 12 × avos, 1/12 por mês com 15 dias
//    ou mais (Lei 4.090/62 art. 1º §2º; Decreto 57.155/65 art. 2º), em linhas separadas até o
//    desligamento e pela projeção; não na justa causa (Lei 4.090 art. 3º), sim no pedido de
//    demissão (Súmula 157); a 1ª parcela já paga é descontada;
//  - férias vencidas: períodos completos até a data projetada, direito pelo art. 130, menos
//    o gozado até o desligamento e o abono vendido; em dobro se o concessivo terminou antes
//    do desligamento (arts. 137 e 146); 1/3 também sobre a dobra (Súmula 328); remuneração
//    da rescisão (Súmula 7);
//  - férias proporcionais: 1/12 por mês do aquisitivo em curso ou fração ≥ 15 dias até a data
//    projetada (art. 146 par. único; art. 147) × direito do art. 130 + 1/3; devidas no pedido
//    de demissão com menos de 1 ano (Súmula 261); não na justa causa (Súmula 171);
//  - experiência: término no prazo sem aviso nem multa; antecipado pelo empregador → metade
//    da remuneração dos dias que faltavam (art. 479), sem FGTS sobre ela, e multa de 40%
//    (Decreto 99.684/90 art. 14; Súmula 125); pelo empregado → até o mesmo valor, só se houver
//    prejuízo (art. 480 §1º), informativo;
//  - FGTS (separado: vai para a conta vinculada): 8% sobre saldo, aviso indenizado (Súmula 305),
//    13º menos a 1ª parcela já recolhida e banco de horas; férias indenizadas fora (OJ 195
//    SDI-1); multa = 40% ou 20% × (saldo para fins rescisórios informado + mês anterior não
//    recolhido + 8% da rescisão) (Lei 8.036 art. 18 §1º e §2º); doméstico: sem multa, a
//    indenização são os 3,2% mensais (LC 150/2015 art. 22);
//  - prazo: 10 dias corridos do término, excluído o dia do início (art. 477 §6º; OJ 162 SDI-1),
//    antecipado para dia útil; atraso = multa de um salário base (art. 477 §8º);
//  - descontos limitados a um mês de remuneração (art. 477 §5º) — INSS e IRRF fora do limite;
//  - médias por verba (Sprint 11): aviso = 12 meses, 13º = meses do ano, férias = aquisitivo
//    (art. 487 §3º; Decreto 57.155/65 art. 2º; art. 142 §5º) — ver lib/mediasPonto.ts;
//  - INSS (Lei 8.212 art. 28; tabela pela competência do desligamento): saldo + banco de horas
//    na tabela mensal; 13º (inclusive o do aviso) em separado (art. 28 §7º); aviso indenizado
//    (STJ Tema 478), férias indenizadas + 1/3 (art. 28 §9º d) e art. 479 (§9º e 3) sem INSS.
//    O desconto do aviso não cumprido NÃO reduz as bases (prática mais segura);
//  - IRRF (tabela pela data do PAGAMENTO — regime de caixa, Lei 7.713 art. 7º): saldo + banco
//    de horas − INSS − dependentes (ou desconto simplificado, se maior) − redução da Lei
//    15.270/2025; 13º exclusivo na fonte, em separado (Lei 7.713 art. 26), sem simplificado
//    por padrão (divergente); aviso indenizado e art. 479 isentos (Lei 7.713 art. 6º V);
//    férias indenizadas isentas (Súmulas 125 e 386 STJ). A 1ª parcela do 13º não reduz a base.
import { diasDeDireito, diasEntre, diaDaSemana, feriadosLegais, periodosAquisitivos, somarAnos, somarDias, type FeriasProgramada } from './ferias';
import { avosDecimo, faltasPorMesDoAno } from './decimoTerceiro';
import { br, isoOk, type Empregado } from './dp';
import { mediaDoPeriodo, mesesDoAquisitivo, rotuloMes, variaveisDoMes, somarMes, ultimoMesDasMedias, type AjusteMes, type MediaPeriodo, type MesPonto } from './mediasPonto';
import { calcularInss, calcularIrrf, tabelaInssEm, tabelaIrrfEm } from './tabelasTributos';

// ------------------------------------------------------------------ tipos

export type TipoRescisao =
  | 'sem_justa_causa' | 'rescisao_indireta' | 'pedido_demissao' | 'acordo' | 'culpa_reciproca'
  | 'justa_causa' | 'falecimento' | 'experiencia_termino' | 'experiencia_antecipada_empregador'
  | 'experiencia_antecipada_empregado';

export const TIPOS_RESCISAO: { valor: TipoRescisao; rotulo: string; detalhe: string }[] = [
  { valor: 'sem_justa_causa', rotulo: 'Dispensa sem justa causa', detalhe: 'Pelo empregador — aviso proporcional e multa de 40% do FGTS' },
  { valor: 'pedido_demissao', rotulo: 'Pedido de demissão', detalhe: 'Pelo empregado — aviso de 30 dias, sem multa do FGTS' },
  { valor: 'acordo', rotulo: 'Acordo entre as partes (art. 484-A)', detalhe: 'Metade do aviso indenizado e multa de 20%' },
  { valor: 'justa_causa', rotulo: 'Justa causa (art. 482)', detalhe: 'Só saldo de salário e férias vencidas' },
  { valor: 'experiencia_termino', rotulo: 'Fim do contrato de experiência no prazo', detalhe: 'Sem aviso e sem multa' },
  { valor: 'experiencia_antecipada_empregador', rotulo: 'Experiência encerrada antes pelo empregador (art. 479)', detalhe: 'Metade dos dias que faltavam e multa de 40%' },
  { valor: 'experiencia_antecipada_empregado', rotulo: 'Experiência encerrada antes pelo empregado (art. 480)', detalhe: 'Pode indenizar prejuízo até o limite do art. 479' },
  { valor: 'rescisao_indireta', rotulo: 'Rescisão indireta (art. 483)', detalhe: 'Falta grave do empregador — mesmas verbas da dispensa sem justa causa' },
  { valor: 'culpa_reciproca', rotulo: 'Culpa recíproca (art. 484)', detalhe: 'Metade do aviso, do 13º e das férias proporcionais; multa de 20%' },
  { valor: 'falecimento', rotulo: 'Falecimento do empregado', detalhe: 'Verbas aos dependentes ou sucessores (Lei 6.858/80)' },
];

export const rotuloTipo = (t: TipoRescisao) => TIPOS_RESCISAO.find((x) => x.valor === t)?.rotulo ?? t;

export type ModoAviso = 'indenizado' | 'trabalhado' | 'dispensado' | 'nao_cumprido' | 'parcial' | 'nenhum';

export const ROTULO_AVISO: Record<ModoAviso, string> = {
  indenizado: 'Indenizado',
  trabalhado: 'Trabalhado',
  dispensado: 'Dispensado pelo empregador',
  nao_cumprido: 'Não cumprido pelo empregado (desconto)',
  parcial: 'Cumprido em parte (desconto dos dias que faltaram)',
  nenhum: 'Não se aplica',
};

/** Modos de aviso possíveis para o tipo (o primeiro é o padrão). */
export function modosDeAviso(tipo: TipoRescisao): ModoAviso[] {
  switch (tipo) {
    case 'sem_justa_causa': case 'acordo': return ['indenizado', 'trabalhado'];
    case 'rescisao_indireta': case 'culpa_reciproca': return ['indenizado'];
    case 'pedido_demissao': return ['trabalhado', 'dispensado', 'nao_cumprido', 'parcial'];
    default: return ['nenhum'];
  }
}

export const ehExperiencia = (t: TipoRescisao) => t.startsWith('experiencia_');

export interface EntradaRescisao {
  tipo: TipoRescisao;
  aviso: ModoAviso;
  admissao: string;
  /** Último dia trabalhado (no aviso trabalhado, o último dia do aviso). */
  desligamento: string;
  salarioBase: number;
  /** Insalubridade, periculosidade, gratificação fixa: entram também no saldo. */
  adicionaisFixos?: number;
  /**
   * Outras médias mensais informadas (comissões, gorjetas…): somam às médias do ponto em
   * aviso, 13º, férias e art. 479. Sem ponto, é a única média.
   */
  mediasVariaveis?: number;
  /** Horas do ponto por mês (rota /api/dp/medias): médias de HE e noturno por verba. */
  ponto?: MesPonto[] | null;
  /** Ajustes da contadora por mês (AAAA-MM): ignorar ou trocar as horas. */
  ajustesPonto?: Record<string, AjusteMes>;
  /** O mês do desligamento entra nas médias mesmo incompleto. */
  incluirMesDesligamento?: boolean;
  /** Dependentes para o IRRF. */
  dependentesIr?: number;
  /** Data do pagamento (escolhe a tabela do IRRF). Padrão: o prazo do art. 477 §6º. */
  dataPagamento?: string | null;
  /** Desconto simplificado também no IRRF do 13º (divergente; padrão: não). */
  simplificado13?: boolean;
  /** Redução da Lei 15.270 no IRRF do 13º (orientação da Receita; padrão: sim). */
  reducao13?: boolean;
  /**
   * Outros rendimentos tributáveis pagos no MESMO mês do pagamento da rescisão (ex.: salário
   * do mês anterior pago no 5º dia útil): o IRRF é pelo regime de caixa e soma tudo.
   */
  outrosRendimentosMes?: number;
  /** INSS descontado desses outros rendimentos (dedução do IRRF). */
  outrosInssMes?: number;
  /** IRRF já retido sobre esses outros rendimentos (abate do IRRF da rescisão). */
  irrfJaRetidoMes?: number;
  /** Saldo do FGTS para fins rescisórios (extrato). Sem ele, a multa não é estimada. */
  saldoFgts?: number | null;
  /** Depósito do mês anterior ainda não recolhido (vence dia 20 — FGTS Digital). */
  fgtsMesAnterior?: number;
  /** 1ª parcela do 13º do ano já paga. */
  decimoAdiantado?: number;
  /** Adiantamentos, vale-transporte e outros descontos da rescisão. */
  outrosDescontos?: number;
  /** Último dia do contrato de experiência (tipos de experiência). */
  fimExperiencia?: string | null;
  /** Aviso cumprido em parte: dias que faltaram. */
  diasAvisoNaoCumpridos?: number;
  /** Saldo POSITIVO do banco de horas, em horas (art. 59 §3º). */
  bancoHorasPositivo?: number;
  horasSemanais?: number | null;
  /** O empregado tem acordo de banco de horas (cadastro do DP). */
  temBancoHoras?: boolean;
  /** Empregador doméstico (LC 150/2015): sem multa do FGTS. */
  domestico?: boolean;
  /** Faltas injustificadas (AAAA-MM-DD), do ponto. */
  faltas?: string[];
  /** Início do 1º aquisitivo editado na ficha (null = admissão). */
  aquisitivoBase?: string | null;
  /** Férias programadas: só conta o que começou até o desligamento. */
  ferias?: Pick<FeriasProgramada, 'aquisitivoInicio' | 'inicio' | 'dias' | 'abonoDias'>[];
  /** Períodos aquisitivos (início) que a contadora marcou como já quitados fora do sistema. */
  periodosQuitados?: string[];
  /** Feriados extras para o prazo de pagamento (os do ponto do escritório). */
  feriados?: Iterable<string>;
  situacao?: Empregado['situacao'];
  afastamentoTipo?: Empregado['afastamentoTipo'];
}

export type GrupoLinha = 'provento' | 'desconto' | 'tributo' | 'informativo';

export interface LinhaRescisao {
  id: string;
  grupo: GrupoLinha;
  descricao: string;
  /** Memória de cálculo legível ("R$ 2.000,00 ÷ 30 × 20 dias"). */
  memoria: string;
  valor: number;
  fonte: string;
}

export interface AlertaRescisao { nivel: 'perigo' | 'aviso' | 'info'; texto: string }

export interface PeriodoFeriasRescisao {
  inicio: string;
  fim: string;
  concessivoFim: string;
  direito: number;
  gozados: number;
  devidos: number;
  dobro: boolean;
  quitado: boolean;
}

export interface FgtsRescisao {
  base: number;
  deposito: number;
  saldoInformado: number | null;
  mesAnterior: number;
  percentual: number;
  /** null = saldo não informado (não dá para estimar) ou sem multa. */
  multa: number | null;
  memoria: string;
}

export interface MediasRescisao {
  /** Médias do ponto por verba (null = sem ponto). */
  aviso: MediaPeriodo | null;
  decimo: MediaPeriodo | null;
  /** Por período aquisitivo (início). */
  ferias: { inicio: string; media: MediaPeriodo }[];
  /** Outras médias informadas (somam a cada verba). */
  informadas: number;
  /** Último mês considerado (AAAA-MM). */
  ultimoMes: string;
}

export interface TributosRescisao {
  inss: number;
  inss13: number;
  irrf: number;
  irrf13: number;
  baseMensal: number;
  base13: number;
  tabelaInss: string;
  tabelaIrrf: string;
  dataPagamento: string;
}

export interface ResultadoRescisao {
  erros: string[];
  alertas: AlertaRescisao[];
  linhas: LinhaRescisao[];
  totalProventos: number;
  totalDescontos: number;
  /** Proventos − descontos considerados, antes de INSS e IRRF. */
  totalBruto: number;
  /** INSS + IRRF (mensal e 13º). */
  totalTributos: number;
  /** Bruto − INSS − IRRF. Sem pensão alimentícia. */
  totalLiquido: number;
  tributos: TributosRescisao | null;
  medias: MediasRescisao | null;
  fgts: FgtsRescisao | null;
  anosCompletos: number;
  aviso: { dias: number; trabalhados: number; indenizados: number; projetados: number; comunicacao: string | null };
  /** Último dia do contrato com a projeção do aviso (data de saída na CTPS — OJ 82). */
  projecao: string;
  avos13: { ate: number; projecao: number };
  ferias: PeriodoFeriasRescisao[];
  prazoPagamento: string | null;
  multa477: number;
}

// ------------------------------------------------------------------ utilidades

export const centavos = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
export const reais = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const pos = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

const partes = (iso: string) => iso.split('-').map(Number) as [number, number, number];
const ultimoDiaMes = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate();

/** Mesmo dia `n` meses depois; sem esse dia no mês, o último dia do mês. */
export function somarMeses(iso: string, n: number): string {
  const [a, m, d] = partes(iso);
  const t = new Date(Date.UTC(a, m - 1 + n, 1));
  const dia = Math.min(d, ultimoDiaMes(t.getUTCFullYear(), t.getUTCMonth() + 1));
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), dia)).toISOString().slice(0, 10);
}

/** Anos completos de serviço da admissão até `ate` (inclusive). */
export function anosCompletos(admissao: string, ate: string): number {
  let n = 0;
  while (n < 80 && somarAnos(admissao, n + 1) <= somarDias(ate, 1)) n++;
  return n;
}

/** Lei 12.506/2011: 30 dias + 3 por ano completo, até 90. */
export const diasAvisoProporcional = (anos: number) => 30 + 3 * Math.min(Math.max(0, anos), 20);

/**
 * Avos de férias proporcionais: 1/12 por mês contado do início do aquisitivo e a fração
 * de 15 dias ou mais (art. 146 par. único). `ate` inclusive. Máximo 12.
 */
export function avosFerias(inicio: string, ate: string): number {
  if (ate < inicio) return 0;
  const fimExcl = somarDias(ate, 1);
  let k = 0;
  while (k < 12 && somarMeses(inicio, k + 1) <= fimExcl) k++;
  if (k >= 12) return 12;
  const resto = diasEntre(somarMeses(inicio, k), fimExcl);
  return Math.min(12, k + (resto >= 15 ? 1 : 0));
}

/** Dias do saldo de salário no mês do desligamento (mês comercial de 30). */
export function diasSaldoSalario(admissao: string, desligamento: string): number {
  const [a, m, d] = partes(desligamento);
  const inicioMes = `${desligamento.slice(0, 7)}-01`;
  const de = admissao > inicioMes ? admissao : inicioMes;
  if (de > desligamento) return 0;
  const diaDe = partes(de)[2];
  if (d === ultimoDiaMes(a, m)) return Math.max(0, 30 - (diaDe - 1));
  return Math.min(30, diasEntre(de, desligamento) + 1);
}

/** Prazo do art. 477 §6º: término + 10 dias, antecipado para o dia útil anterior. */
export function prazoPagamento(termino: string, feriados: Iterable<string> = []): string {
  let d = somarDias(termino, 10);
  const ano = partes(d)[0];
  const f = new Set<string>([...feriadosLegais(ano - 1), ...feriadosLegais(ano), ...feriados]);
  while ([0, 6].includes(diaDaSemana(d)) || f.has(d)) d = somarDias(d, -1);
  return d;
}

/** Avos do 13º de 1º de janeiro do ano de `de` até `ate` (pode atravessar o ano). */
function avos13(admissao: string, de: string, ate: string, faltas: string[]): number {
  let total = 0;
  for (let ano = partes(de)[0]; ano <= partes(ate)[0]; ano++) {
    total += avosDecimo({ admissao, situacao: 'desligado', situacaoDesde: ate }, ano, faltasPorMesDoAno(faltas, ano)).avos;
  }
  return total;
}

const MULTA_FGTS: Partial<Record<TipoRescisao, number>> = {
  sem_justa_causa: 0.4, rescisao_indireta: 0.4, experiencia_antecipada_empregador: 0.4, acordo: 0.2, culpa_reciproca: 0.2,
};

// ------------------------------------------------------------------ simulação

export function simularRescisao(en: EntradaRescisao): ResultadoRescisao {
  const erros: string[] = [];
  const alertas: AlertaRescisao[] = [];
  const linhas: LinhaRescisao[] = [];
  const vazio: ResultadoRescisao = {
    erros, alertas, linhas, totalProventos: 0, totalDescontos: 0, totalBruto: 0, totalTributos: 0, totalLiquido: 0,
    tributos: null, medias: null, fgts: null, anosCompletos: 0,
    aviso: { dias: 0, trabalhados: 0, indenizados: 0, projetados: 0, comunicacao: null },
    projecao: en.desligamento, avos13: { ate: 0, projecao: 0 }, ferias: [], prazoPagamento: null, multa477: 0,
  };

  const { tipo, admissao, desligamento } = en;
  if (!TIPOS_RESCISAO.some((t) => t.valor === tipo)) erros.push('Escolha o tipo de rescisão.');
  if (!isoOk(admissao)) erros.push('Cadastre a data de admissão do empregado.');
  if (!isoOk(desligamento)) erros.push('Informe a data do desligamento.');
  const salario = pos(en.salarioBase);
  if (!salario) erros.push('Informe o salário base.');
  if (!erros.length && desligamento < admissao) erros.push('O desligamento não pode ser antes da admissão.');
  const modos = modosDeAviso(tipo);
  const aviso: ModoAviso = modos.includes(en.aviso) ? en.aviso : modos[0];
  const fimExp = en.fimExperiencia ?? null;
  if (!erros.length && ehExperiencia(tipo)) {
    if (!fimExp || !isoOk(fimExp)) erros.push('Informe o último dia do contrato de experiência.');
    else if (fimExp < admissao) erros.push('O fim da experiência não pode ser antes da admissão.');
    else if (diasEntre(admissao, fimExp) + 1 > 90) {
      erros.push('Contrato com mais de 90 dias não é de experiência (CLT art. 445 par. único): use “Dispensa sem justa causa” ou “Pedido de demissão”.');
    } else if (desligamento > fimExp) {
      erros.push(`O desligamento é depois do fim da experiência (${br(fimExp)}): o contrato virou prazo indeterminado (CLT art. 451). Use “Dispensa sem justa causa” ou “Pedido de demissão”.`);
    } else if (tipo !== 'experiencia_termino' && desligamento === fimExp) {
      erros.push('O desligamento é o último dia da experiência: escolha “Fim do contrato de experiência no prazo”.');
    }
  }
  if (erros.length) return vazio;

  const adicionais = pos(en.adicionaisFixos);
  const informadas = pos(en.mediasVariaveis);
  const remuneracao = salario + adicionais;       // saldo, banco de horas, limite do §5º
  const faltas = (en.faltas ?? []).filter(isoOk);
  const divisor = en.horasSemanais && en.horasSemanais > 0 ? Math.round(en.horasSemanais * 5) : 220;

  // ---- médias do ponto, por verba (lib/mediasPonto.ts)
  const ultimoMes = ultimoMesDasMedias(desligamento, en.incluirMesDesligamento);
  const comPonto = Array.isArray(en.ponto);
  const media = (de: string, ate: string) => mediaDoPeriodo(en.ponto ?? [], {
    de, ate, admissao, desligamento, valorHora: remuneracao / divisor, ajustes: en.ajustesPonto,
  });
  const mediaAviso = comPonto ? media(somarMes(ultimoMes, -11), ultimoMes) : null;
  const mediaDecimo = comPonto ? media(`${desligamento.slice(0, 4)}-01`, ultimoMes) : null;
  const mediasFerias: MediasRescisao['ferias'] = [];
  /** Média das férias do período aquisitivo (art. 142 §5º): ponto do período + informadas. */
  const mediaFerias = (p: { inicio: string; fim: string }) => {
    if (!comPonto) return informadas;
    const meses = mesesDoAquisitivo(p.inicio, p.fim);
    const m = media(meses.de, meses.ate < ultimoMes ? meses.ate : ultimoMes);
    mediasFerias.push({ inicio: p.inicio, media: m });
    return informadas + m.valor;
  };
  const medAviso = informadas + (mediaAviso?.valor ?? 0);
  const medDecimo = informadas + (mediaDecimo?.valor ?? 0);
  const metade = tipo === 'acordo' || tipo === 'culpa_reciproca';
  const justa = tipo === 'justa_causa';
  const add = (l: Omit<LinhaRescisao, 'valor'> & { valor: number }) => {
    const valor = centavos(l.valor);
    if (valor > 0) linhas.push({ ...l, valor });
  };
  /** Texto da remuneração usada; `med` = média da verba (ponto + informadas). */
  const baseTxt = (med = 0) => {
    const p = [reais(salario)];
    if (adicionais) p.push(`${reais(adicionais)} de adicionais`);
    if (med) p.push(`${reais(centavos(med))} de médias`);
    return p.length > 1 ? `(${p.join(' + ')})` : p[0];
  };

  // ---- saldo de salário
  const diasMes = diasSaldoSalario(admissao, desligamento);
  const faltasMes = faltas.filter((d) => d.slice(0, 7) === desligamento.slice(0, 7) && d >= admissao && d <= desligamento).length;
  const diasSaldo = Math.max(0, diasMes - faltasMes);
  add({
    id: 'saldo', grupo: 'provento', descricao: `Saldo de salário (${diasSaldo} dia${diasSaldo === 1 ? '' : 's'})`,
    memoria: `${baseTxt()} ÷ 30 × ${diasSaldo}${faltasMes ? ` (${diasMes} dias − ${faltasMes} falta${faltasMes > 1 ? 's' : ''})` : ''}`,
    valor: (remuneracao / 30) * diasSaldo, fonte: 'CLT art. 462; mês comercial de 30 dias',
  });
  // ---- horas extras e noturno do próprio mês do desligamento (verba do mês, não média)
  if (comPonto) {
    const mesD = desligamento.slice(0, 7);
    const hm = variaveisDoMes(en.ponto ?? [], mesD, remuneracao / divisor, en.ajustesPonto?.[mesD]);
    add({
      id: 'he_mes', grupo: 'provento', descricao: `Horas extras e adicional noturno de ${rotuloMes(mesD)} (ponto até ${br(desligamento)})`,
      memoria: hm.memoria, valor: hm.valor, fonte: 'CF art. 7º XVI; CLT arts. 59 e 73; Súmula 172 TST',
    });
    if (!hm.temPonto && !hm.ajustado) {
      alertas.push({ nivel: 'aviso', texto: `Sem ponto lançado em ${rotuloMes(mesD)}: as horas extras do mês do desligamento, se houver, não entraram (são verba do mês, com INSS, IRRF e FGTS). Lance o ponto ou ajuste as horas do mês no painel das médias.` });
    }
  }
  if (faltasMes) alertas.push({ nivel: 'info', texto: `${faltasMes} falta(s) no mês descontadas do saldo. A perda do repouso semanal (Lei 605/49 art. 6º) não foi calculada.` });

  // ---- aviso prévio
  let comunicacao: string | null = null;
  let diasAviso = 0, trabalhados = 0, indenizados = 0, projetados = 0;
  const comAvisoProporcional = tipo === 'sem_justa_causa' || tipo === 'rescisao_indireta' || tipo === 'acordo' || tipo === 'culpa_reciproca';
  let anos = anosCompletos(admissao, desligamento);
  if (comAvisoProporcional) {
    comunicacao = aviso === 'trabalhado' ? somarDias(desligamento, -30) : desligamento;
    if (comunicacao < admissao) comunicacao = admissao;
    anos = anosCompletos(admissao, comunicacao);
    diasAviso = diasAvisoProporcional(anos);
    trabalhados = aviso === 'trabalhado' ? 30 : 0;
    const devidos = diasAviso - trabalhados;
    indenizados = metade ? devidos / 2 : devidos;
    projetados = metade ? Math.ceil(devidos / 2) : devidos;
    if (indenizados > 0) {
      const desc = aviso === 'trabalhado'
        ? `Aviso prévio indenizado — acréscimo da Lei 12.506 (${num(indenizados)} dias)`
        : `Aviso prévio indenizado (${num(indenizados)} dias)`;
      add({
        id: 'aviso', grupo: 'provento', descricao: desc,
        memoria: `${baseTxt(medAviso)} ÷ 30 × ${num(indenizados)}`
          + ` — ${diasAviso} dias de aviso (30 + 3 × ${Math.min(anos, 20)} ano${anos === 1 ? '' : 's'} completo${anos === 1 ? '' : 's'})`
          + `${trabalhados ? `, ${trabalhados} trabalhados` : ''}${metade ? ', pela metade' : ''}`,
        valor: ((remuneracao + medAviso) / 30) * indenizados,
        fonte: `CLT art. 487 §1º e §5º; Lei 12.506/2011${tipo === 'acordo' ? '; CLT art. 484-A I a' : tipo === 'culpa_reciproca' ? '; Súmula 14 TST' : ''}`,
      });
    }
    if (aviso === 'trabalhado') {
      alertas.push({ nivel: 'info', texto: `Aviso trabalhado: 30 dias trabalhados (aviso dado em ${br(comunicacao)})${diasAviso > 30 ? ` e os ${diasAviso - 30} dias da Lei 12.506 indenizados${metade ? ' pela metade' : ''} — prática dominante, mas a lei não é expressa: confira a convenção` : ''}. O empregado escolhe reduzir 2 horas por dia ou faltar 7 dias corridos (CLT art. 488).` });
    }
    if (metade && projetados > 0) {
      alertas.push({ nivel: 'aviso', texto: `A projeção do aviso usa só os dias indenizados (${projetados}): a lei não diz se é pela metade ou integral. Confira com a contadora.` });
    }
  } else if (tipo === 'pedido_demissao') {
    diasAviso = 30;
    comunicacao = aviso === 'trabalhado' || aviso === 'parcial' ? somarDias(desligamento, -30) : desligamento;
    if (aviso === 'trabalhado') trabalhados = 30;
    const faltam = aviso === 'nao_cumprido' ? 30 : aviso === 'parcial' ? Math.min(30, Math.max(0, Math.round(pos(en.diasAvisoNaoCumpridos)))) : 0;
    if (aviso === 'parcial') trabalhados = 30 - faltam;
    if (faltam > 0) {
      add({
        id: 'aviso_desconto', grupo: 'desconto', descricao: `Aviso prévio não cumprido (${faltam} dia${faltam === 1 ? '' : 's'})`,
        memoria: `${reais(salario)} ÷ 30 × ${faltam}`, valor: (salario / 30) * faltam, fonte: 'CLT art. 487 §2º',
      });
    }
    if (aviso === 'parcial' && faltam === 0) alertas.push({ nivel: 'aviso', texto: 'Informe quantos dias do aviso faltaram cumprir.' });
    alertas.push({ nivel: 'info', texto: 'No pedido de demissão o aviso é de 30 dias: a proporcionalidade da Lei 12.506 só vale a favor do empregado.' });
  }
  const projecao = somarDias(desligamento, projetados);

  // ---- art. 479 / 480 (experiência antecipada)
  if ((tipo === 'experiencia_antecipada_empregador' || tipo === 'experiencia_antecipada_empregado') && fimExp) {
    const faltavam = diasEntre(desligamento, fimExp);
    const valor = ((remuneracao + medAviso) / 30) * faltavam / 2;
    if (tipo === 'experiencia_antecipada_empregador') {
      add({
        id: 'art479', grupo: 'provento', descricao: `Indenização do art. 479 (metade de ${faltavam} dias)`,
        memoria: `${baseTxt(medAviso)} ÷ 30 × ${faltavam} dias até ${br(fimExp)} ÷ 2`, valor, fonte: 'CLT art. 479; sem FGTS sobre ela (Lei 8.036 art. 15 §6º)',
      });
    } else {
      add({
        id: 'art480', grupo: 'informativo', descricao: 'Indenização ao empregador (art. 480) — teto, só se houver prejuízo',
        memoria: `Até ${baseTxt(medAviso)} ÷ 30 × ${faltavam} dias até ${br(fimExp)} ÷ 2. Não entra no total.`, valor, fonte: 'CLT art. 480 §1º',
      });
    }
    alertas.push({ nivel: 'info', texto: 'Se o contrato tiver cláusula assecuratória do direito recíproco de rescisão (CLT art. 481; Súmula 163 TST), valem as regras do aviso prévio: use “Dispensa sem justa causa” ou “Pedido de demissão”. Para aprendiz, os arts. 479 e 480 não se aplicam (art. 433 §2º).' });
  }
  if (tipo === 'experiencia_termino' && fimExp && desligamento !== fimExp) {
    alertas.push({ nivel: 'aviso', texto: `O fim da experiência é ${br(fimExp)}, mas o desligamento informado é ${br(desligamento)}. Antes do prazo, escolha um dos tipos “encerrada antes”.` });
  }

  // ---- 13º
  const fator13 = tipo === 'culpa_reciproca' ? 0.5 : 1;
  const avosAte = justa ? 0 : avos13(admissao, desligamento, desligamento, faltas);
  const avosTotal = justa ? 0 : avos13(admissao, desligamento, projecao, faltas);
  const avosProj = Math.max(0, avosTotal - avosAte);
  const v13 = (n: number) => ((remuneracao + medDecimo) / 12) * n * fator13;
  const meio13 = fator13 < 1 ? ' × 1/2' : '';
  add({ id: '13', grupo: 'provento', descricao: `13º salário proporcional (${avosAte}/12)`, memoria: `${baseTxt(medDecimo)} ÷ 12 × ${avosAte}${meio13}`, valor: v13(avosAte),
    fonte: `Lei 4.090/62 art. 1º §2º e art. 3º${tipo === 'pedido_demissao' ? '; Súmula 157 TST' : ''}${fator13 < 1 ? '; Súmula 14 TST' : ''}` });
  add({ id: '13_aviso', grupo: 'provento', descricao: `13º salário sobre o aviso indenizado (${avosProj}/12)`, memoria: `${baseTxt(medDecimo)} ÷ 12 × ${avosProj}${meio13} — projeção até ${br(projecao)}`,
    valor: v13(avosProj), fonte: 'CLT art. 487 §1º; Lei 4.090/62' });
  const adiantado = pos(en.decimoAdiantado);
  if (adiantado) {
    add({ id: '13_adiantado', grupo: 'desconto', descricao: '1ª parcela do 13º já paga', memoria: justa ? 'Na justa causa o 13º deixa de ser devido' : 'Informada na simulação', valor: adiantado, fonte: 'Lei 4.749/65 art. 3º' });
  }
  if (justa) alertas.push({ nivel: 'info', texto: 'Na justa causa não há 13º proporcional (Lei 4.090/62 art. 3º), férias proporcionais (Súmula 171 TST), aviso nem multa do FGTS.' });

  // ---- férias
  const base = en.aquisitivoBase && isoOk(en.aquisitivoBase) ? en.aquisitivoBase : admissao;
  const quitados = new Set(en.periodosQuitados ?? []);
  const periodosR: PeriodoFeriasRescisao[] = [];
  let valorVencidas = 0, valorProp = 0;
  const memVencidas: string[] = [];
  for (const p of periodosAquisitivos(base, projecao)) {
    if (p.fim <= projecao) {
      const direito = diasDeDireito(faltas.filter((d) => d >= p.inicio && d <= p.fim).length);
      const gozados = (en.ferias ?? []).filter((f) => f.aquisitivoInicio === p.inicio && f.inicio <= desligamento)
        .reduce((s, f) => s + Math.min(f.dias, diasEntre(f.inicio, desligamento) + 1) + (f.abonoDias ?? 0), 0);
      const devidos = Math.max(0, direito - gozados);
      const dobro = p.concessivoFim < desligamento;
      const quitado = quitados.has(p.inicio);
      periodosR.push({ inicio: p.inicio, fim: p.fim, concessivoFim: p.concessivoFim, direito, gozados, devidos, dobro, quitado });
      if (!devidos || quitado) continue;
      const medP = mediaFerias(p);
      const v = ((remuneracao + medP) / 30) * devidos * (dobro ? 2 : 1);
      valorVencidas += v;
      add({
        id: `ferias_${p.inicio}`, grupo: 'provento',
        descricao: `Férias vencidas${dobro ? ' em dobro' : ''} — ${br(p.inicio)} a ${br(p.fim)} (${devidos} dias)`,
        memoria: `${baseTxt(medP)} ÷ 30 × ${devidos}${dobro ? ' × 2' : ''}${gozados ? ` (direito ${direito} − ${gozados} gozados/vendidos)` : direito < 30 ? ` (direito ${direito}, art. 130)` : ''}`,
        valor: v, fonte: dobro ? 'CLT arts. 137 e 146' : 'CLT art. 146',
      });
      memVencidas.push(reais(centavos(v)));
      if (!dobro && p.concessivoFim < projecao) {
        alertas.push({ nivel: 'aviso', texto: `O concessivo do período ${br(p.inicio)}–${br(p.fim)} vence dentro da projeção do aviso (${br(p.concessivoFim)}): há divergência se paga em dobro. A simulação usa o desligamento (simples).` });
      }
      if (dobro && !(en.ferias ?? []).some((f) => f.aquisitivoInicio === p.inicio)) {
        alertas.push({ nivel: 'aviso', texto: `Período ${br(p.inicio)}–${br(p.fim)} sem nenhuma férias no sistema: se foi gozado ou pago fora dele, marque como quitado.` });
      }
    } else if (!justa) {
      const avos = avosFerias(p.inicio, projecao);
      const direito = diasDeDireito(faltas.filter((d) => d >= p.inicio && d <= projecao).length);
      const fator = tipo === 'culpa_reciproca' ? 0.5 : 1;
      const medP = mediaFerias(p);
      const v = (remuneracao + medP) * (avos / 12) * (direito / 30) * fator;
      valorProp += v;
      add({
        id: 'ferias_prop', grupo: 'provento', descricao: `Férias proporcionais (${avos}/12) — aquisitivo desde ${br(p.inicio)}`,
        memoria: `${baseTxt(medP)} ÷ 12 × ${avos}${direito < 30 ? ` × ${direito}/30 (art. 130)` : ''}${fator < 1 ? ' × 1/2' : ''} — até ${br(projecao)}`,
        valor: v, fonte: `CLT arts. 146 par. único e 147${tipo === 'pedido_demissao' ? '; Súmula 261 TST' : ''}${fator < 1 ? '; Súmula 14 TST' : ''}`,
      });
    }
  }
  add({ id: 'terco_vencidas', grupo: 'provento', descricao: '1/3 constitucional sobre férias vencidas', memoria: `${memVencidas.join(' + ') || '—'} ÷ 3`,
    valor: centavos(valorVencidas) / 3, fonte: 'CF art. 7º XVII; Súmula 328 TST' });
  add({ id: 'terco_prop', grupo: 'provento', descricao: '1/3 constitucional sobre férias proporcionais', memoria: `${reais(centavos(valorProp))} ÷ 3`,
    valor: centavos(valorProp) / 3, fonte: 'CF art. 7º XVII; Súmula 328 TST' });

  // ---- banco de horas
  const bh = pos(en.bancoHorasPositivo);
  if (bh) {
    add({
      id: 'banco_horas', grupo: 'provento', descricao: `Banco de horas — saldo positivo (${num(bh)} h)`,
      memoria: `${baseTxt()} ÷ ${divisor} × 1,5 × ${num(bh)} h (adicional de 50%; a convenção pode prever mais)`,
      valor: (remuneracao / divisor) * 1.5 * bh, fonte: 'CLT art. 59 §3º; CF art. 7º XVI',
    });
  }

  // ---- outros descontos
  const outros = pos(en.outrosDescontos);
  if (outros) add({ id: 'outros', grupo: 'desconto', descricao: 'Adiantamentos e outros descontos', memoria: 'Informados na simulação', valor: outros, fonte: 'CLT art. 462' });

  // ---- totais
  const soma = (g: GrupoLinha) => centavos(linhas.filter((l) => l.grupo === g).reduce((s, l) => s + l.valor, 0));
  const totalProventos = soma('provento');
  let totalDescontos = soma('desconto');
  const limite5 = centavos(remuneracao);
  if (totalDescontos > limite5) {
    alertas.push({ nivel: 'perigo', texto: `Os descontos (${reais(totalDescontos)}) passam de um mês de remuneração: na rescisão a compensação fica limitada a ${reais(limite5)} (CLT art. 477 §5º). O total já considera o limite.` });
    totalDescontos = limite5;
  }
  const totalBruto = centavos(totalProventos - totalDescontos);
  if (totalBruto < 0) alertas.push({ nivel: 'aviso', texto: 'Os descontos superam as verbas: o saldo negativo não se cobra na rescisão além do limite legal.' });

  // ---- FGTS
  const val = (id: string) => linhas.find((l) => l.id === id)?.valor ?? 0;
  const baseFgts13 = Math.max(0, val('13') + val('13_aviso') - (justa ? 0 : adiantado));
  const baseFgts = centavos(val('saldo') + val('he_mes') + val('aviso') + baseFgts13 + val('banco_horas'));
  const deposito = centavos(baseFgts * 0.08);
  const percentual = en.domestico ? 0 : MULTA_FGTS[tipo] ?? 0;
  const saldoInf = typeof en.saldoFgts === 'number' && Number.isFinite(en.saldoFgts) && en.saldoFgts >= 0 ? centavos(en.saldoFgts) : null;
  const mesAnterior = centavos(pos(en.fgtsMesAnterior));
  const multa = percentual && saldoInf !== null ? centavos(percentual * (saldoInf + mesAnterior + deposito)) : null;
  const pct = `${Math.round(percentual * 100)}%`;
  const fgts: FgtsRescisao = {
    base: baseFgts, deposito, saldoInformado: saldoInf, mesAnterior, percentual, multa,
    memoria: percentual
      ? saldoInf !== null
        ? `${pct} × (${reais(saldoInf)} de saldo informado${mesAnterior ? ` + ${reais(mesAnterior)} do mês anterior` : ''} + ${reais(deposito)} do depósito da rescisão)`
        : `Informe o saldo do FGTS para fins rescisórios (extrato) para estimar a multa de ${pct}.`
      : en.domestico ? 'Doméstico: sem multa de 40%; a indenização são os 3,2% depositados todo mês (LC 150/2015 art. 22).'
        : 'Sem multa do FGTS neste tipo de rescisão.',
  };
  if (percentual && saldoInf === null) alertas.push({ nivel: 'aviso', texto: `Sem o saldo do FGTS informado, a multa de ${pct} não foi estimada.` });
  if (tipo === 'acordo') alertas.push({ nivel: 'info', texto: 'No acordo o empregado saca até 80% do FGTS e não recebe seguro-desemprego (CLT art. 484-A §1º e §2º).' });

  // ---- prazo e multa do art. 477
  const prazo = prazoPagamento(desligamento, en.feriados ?? []);
  const multa477 = centavos(salario);

  // ---- INSS e IRRF (lib/tabelasTributos.ts)
  // Bases: o que é salário (saldo + banco de horas) na tabela mensal; o 13º inteiro (inclusive
  // o do aviso e a 1ª parcela já paga) em separado. Aviso indenizado, férias indenizadas + 1/3
  // e art. 479 ficam fora das duas. Descontos (aviso não cumprido, adiantamentos) não reduzem.
  const baseMensal = centavos(val('saldo') + val('he_mes') + val('banco_horas'));
  const base13 = centavos(val('13') + val('13_aviso'));
  const { tabela: tInss, foraDaLista: inssFora } = tabelaInssEm(desligamento);
  const pagamento = en.dataPagamento && isoOk(en.dataPagamento) ? en.dataPagamento : prazo;
  const { tabela: tIrrf, foraDaLista: irrfFora } = tabelaIrrfEm(pagamento);
  const dependentes = Math.max(0, Math.floor(pos(en.dependentesIr)));
  const inssM = calcularInss(baseMensal, tInss);
  const inss13 = calcularInss(base13, tInss);
  // IRRF do mês: regime de caixa — soma os outros rendimentos pagos no mesmo mês e abate o já retido.
  const outrosRend = centavos(pos(en.outrosRendimentosMes));
  const outrosInss = centavos(pos(en.outrosInssMes));
  const jaRetido = centavos(pos(en.irrfJaRetidoMes));
  const irrfTotalMes = calcularIrrf({ rendimentos: baseMensal + outrosRend, inss: inssM.valor + outrosInss, dependentes, permitirSimplificado: true }, tIrrf);
  const irrfM = { ...irrfTotalMes, valor: Math.max(0, centavos(irrfTotalMes.valor - jaRetido)) };
  const irrf13 = calcularIrrf({
    rendimentos: base13, inss: inss13.valor, dependentes, permitirSimplificado: Boolean(en.simplificado13), aplicarReducao: en.reducao13 !== false,
  }, tIrrf);
  const anoInss = tInss.vigenciaDesde.slice(0, 4);
  const anoIrrf = tIrrf.vigenciaDesde.slice(0, 4);
  /** Linha de tributo: aparece sempre que há base, mesmo com valor zero (mostra a isenção). */
  const tributo = (base: number, l: Omit<LinhaRescisao, 'grupo'>) => {
    if (base > 0) linhas.push({ ...l, grupo: 'tributo', valor: centavos(l.valor) });
  };
  tributo(baseMensal, {
    id: 'inss', descricao: 'INSS sobre saldo de salário e banco de horas',
    memoria: `${reais(baseMensal)}: ${inssM.memoria} (tabela ${anoInss}; aviso indenizado e férias indenizadas não entram)`,
    valor: inssM.valor, fonte: `Lei 8.212/91 arts. 20 e 28 I e §9º d; STJ Tema 478; ${tInss.fonte}`,
  });
  tributo(base13, {
    id: 'inss_13', descricao: 'INSS sobre o 13º salário (em separado)',
    memoria: `${reais(base13)}${adiantado && !justa ? ' (13º inteiro, inclusive a 1ª parcela já paga)' : ''}: ${inss13.memoria} (tabela ${anoInss})`,
    valor: inss13.valor, fonte: `Lei 8.212/91 art. 28 §7º; Decreto 3.048/99 art. 214 §6º; ${tInss.fonte}`,
  });
  tributo(baseMensal, {
    id: 'irrf', descricao: 'IRRF sobre saldo de salário e banco de horas',
    memoria: `${outrosRend ? `Rescisão ${reais(baseMensal)} + outros pagos no mês ${reais(outrosRend)}${outrosInss ? ` (INSS deles ${reais(outrosInss)})` : ''}. ` : ''}`
      + `${irrfM.memoria}${jaRetido ? `; − ${reais(jaRetido)} já retidos no mês` : ''}`
      + ` (tabela ${anoIrrf}, pagamento em ${br(pagamento)}; aviso indenizado, férias indenizadas e art. 479 isentos)`,
    valor: irrfM.valor, fonte: `Lei 7.713/88 arts. 6º V e 7º; Lei 9.250/95 art. 4º; Súmulas 125 e 386 STJ; ${tIrrf.fonte}`,
  });
  tributo(base13, {
    id: 'irrf_13', descricao: 'IRRF sobre o 13º salário (exclusivo na fonte)',
    memoria: `${irrf13.memoria} (tabela ${anoIrrf}${en.simplificado13 ? '; desconto simplificado aplicado a pedido' : ''})`,
    valor: irrf13.valor, fonte: `Lei 7.713/88 art. 26; Lei 8.134/90 art. 16; ${tIrrf.fonte}`,
  });
  const totalTributos = centavos(inssM.valor + inss13.valor + irrfM.valor + irrf13.valor);
  const totalLiquido = centavos(totalBruto - totalTributos);
  const tributos: TributosRescisao = {
    inss: inssM.valor, inss13: inss13.valor, irrf: irrfM.valor, irrf13: irrf13.valor, baseMensal, base13,
    tabelaInss: `${anoInss} — ${tInss.fonte}`, tabelaIrrf: `${anoIrrf} — ${tIrrf.fonte}`, dataPagamento: pagamento,
  };
  if (inssFora || irrfFora) {
    alertas.push({ nivel: 'perigo', texto: `Não há tabela de ${inssFora ? 'INSS' : 'IRRF'} cadastrada para ${(inssFora ? desligamento : pagamento).slice(0, 4)}: a simulação usou a de ${inssFora ? anoInss : anoIrrf}. Atualize lib/tabelasTributos.ts.` });
  }
  if (pagamento.slice(0, 4) !== desligamento.slice(0, 4)) {
    alertas.push({ nivel: 'aviso', texto: `O pagamento (${br(pagamento)}) cai em outro ano: o IRRF usa a tabela da data do pagamento (regime de caixa) e o INSS a da competência do desligamento.` });
  }
  if (baseMensal > 0 && !outrosRend) {
    alertas.push({ nivel: 'aviso', texto: 'O IRRF é pelo regime de caixa: se no mês do pagamento da rescisão o empregado receber outro valor tributável (ex.: o salário do mês anterior pago no 5º dia útil), informe em “Outros rendimentos pagos no mês” — a base sobe e a redução da Lei 15.270 pode deixar de valer.' });
  }
  if (base13 > 0) {
    alertas.push({ nivel: 'info', texto: `IRRF do 13º: ${en.simplificado13 ? 'com' : 'sem'} desconto simplificado e ${en.reducao13 === false ? 'sem' : 'com'} a redução da Lei 15.270/2025. As duas aplicações no 13º ainda pedem confirmação da contadora na instrução da Receita — retenção exclusiva errada não se acerta na declaração.` });
  }
  if (tipo === 'falecimento') alertas.push({ nivel: 'info', texto: 'No falecimento, confira a retenção de IRRF sobre as verbas pagas aos dependentes ou sucessores com a contadora.' });

  // ---- alertas gerais
  const dispensaPeloEmpregador = tipo === 'sem_justa_causa' || tipo === 'experiencia_antecipada_empregador' || tipo === 'experiencia_termino' || tipo === 'acordo';
  if (dispensaPeloEmpregador) {
    alertas.push({ nivel: 'aviso', texto: 'Confira estabilidades antes de dispensar: gestante (ADCT art. 10 II b — vale também na experiência, Súmula 244 III), acidente de trabalho (12 meses após o retorno, Lei 8.213 art. 118; Súmula 378 III), CIPA e dirigente sindical. Aviso dado durante estabilidade não vale (Súmula 348 TST).' });
  }
  if (tipo === 'sem_justa_causa' || tipo === 'experiencia_antecipada_empregador') {
    alertas.push({ nivel: 'info', texto: 'Se a data projetada cair nos 30 dias antes da data-base da categoria, há indenização adicional de um salário (Lei 7.238/84 art. 9º; Súmula 182 TST); se passar da data-base, recalcule com o salário reajustado (Súmula 314 TST).' });
  }
  if (en.situacao === 'afastado') {
    alertas.push({ nivel: 'perigo', texto: `Empregado afastado${en.afastamentoTipo === 'acidente' ? ' por acidente de trabalho (estabilidade de 12 meses após o retorno)' : ''}: com o contrato suspenso ou interrompido, a dispensa sem justa causa não produz efeito até o retorno. Confira antes de seguir.` });
  }
  if (tipo === 'justa_causa') alertas.push({ nivel: 'aviso', texto: 'Justa causa exige falta grave do art. 482, punição imediata e prova: se revertida na Justiça, viram devidas as verbas da dispensa sem justa causa.' });
  if (tipo === 'rescisao_indireta') alertas.push({ nivel: 'aviso', texto: 'A rescisão indireta depende do reconhecimento da falta grave do empregador (CLT art. 483), em regra na Justiça do Trabalho.' });
  if (tipo === 'falecimento') alertas.push({ nivel: 'info', texto: 'As verbas vão aos dependentes habilitados no INSS ou, na falta deles, aos sucessores por alvará (Lei 6.858/80). Não há aviso nem multa do FGTS.' });
  if (tipo === 'culpa_reciproca') alertas.push({ nivel: 'info', texto: 'Culpa recíproca é reconhecida pela Justiça do Trabalho: metade do aviso, do 13º e das férias proporcionais (Súmula 14 TST) e multa de 20% (Lei 8.036 art. 18 §2º).' });
  if (comunicacao && (en.ferias ?? []).some((f) => f.inicio <= projecao && somarDias(f.inicio, f.dias - 1) > comunicacao!)) {
    alertas.push({ nivel: 'aviso', texto: 'Há férias programadas dentro do período do aviso: aviso e férias não podem coincidir. Ajuste as datas.' });
  }
  if (!informadas && !comPonto && !justa) alertas.push({ nivel: 'info', texto: 'Sem médias informadas: horas extras habituais, comissões e adicional noturno integram aviso, 13º e férias (CLT art. 487 §5º; Súmulas 45, 60 e 347 TST).' });
  if (comPonto && !justa) {
    const todos = [mediaAviso, mediaDecimo, ...mediasFerias.map((f) => f.media)].flatMap((m) => m?.meses ?? []);
    const semPonto = [...new Set(todos.filter((m) => m.considerado && !m.temPonto && !m.ajustado).map((m) => m.mes))].sort();
    if (semPonto.length) {
      alertas.push({ nivel: 'aviso', texto: `${semPonto.length} mês(es) sem ponto lançado entram nas médias com zero (o divisor é o de meses trabalhados). Se o empregado fez horas nesses meses, ajuste as horas; se o mês não deve contar, marque para ignorar.` });
    }
    if ((mediaAviso?.horas.noturno ?? 0) > 0) {
      alertas.push({ nivel: 'info', texto: 'Hora extra feita no período noturno não leva o adicional de 20% sobre a hora extra (OJ 97 SDI-1; Súmula 60 II TST): a média sai um pouco menor. Noturno rural é 25%.' });
    }
    alertas.push({ nivel: 'info', texto: 'Médias do ponto com os percentuais mínimos (HE 50% e 100%, noturno 20%) e reflexo no DSR mês a mês (Súmula 172 TST). Se a convenção coletiva prevê percentuais maiores, ajuste em “outras médias”.' });
  }
  if (en.temBancoHoras && !bh) alertas.push({ nivel: 'info', texto: 'Empregado com acordo de banco de horas: informe o saldo positivo para pagá-lo como horas extras (CLT art. 59 §3º). Saldo negativo só se desconta se o acordo previr.' });

  return {
    erros, alertas, linhas, totalProventos, totalDescontos, totalBruto, totalTributos, totalLiquido, tributos,
    medias: { aviso: mediaAviso, decimo: mediaDecimo, ferias: mediasFerias, informadas, ultimoMes }, fgts,
    anosCompletos: anos,
    aviso: { dias: diasAviso, trabalhados, indenizados, projetados, comunicacao },
    projecao, avos13: { ate: avosAte, projecao: avosProj }, ferias: periodosR,
    prazoPagamento: prazo, multa477,
  };
}

/** Rótulos e o aviso fixo da simulação (tela e PDF). */
export const AVISO_SIMULACAO = 'Simulação — não substitui o TRCT; confira convenção, médias, INSS e IRRF. Sem pensão alimentícia.';
