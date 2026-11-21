// Resumo do ponto para a folha de pagamento (Sprint 8, Frente B).
//
// Por funcionário e mês: horas normais, extras (50% / 100%), adicional noturno
// (hora reduzida), faltas com perda do DSR, atestados, atrasos e dias com marcador.
// SÓ HORAS E DIAS — nunca valores em reais: quem digita no programa de folha é a
// contadora. Puro e determinístico (sem consulta); regras definidas com o subagente
// `contador` em 21/11/2026 (CLT arts. 58, 59, 73; Lei 605/49 art. 6º; Súm. 60, 264,
// 366 e 146 do TST). Detalhes e exemplo em docs/folha-de-ponto.md.
import type { DiaFreq, Funcionario } from './tipos';
import { formatarMin } from './tempo';
import {
  diasNoMes, diaSemana, tipoDoDia, minutosACumprir, ehDiaDeTrabalho, MESES, Jornada, JORNADA_PADRAO, TipoDia,
} from './calendario';
import { analisarDia, revisarFolha, TOLERANCIA_MIN, type Achado, type CodigoAchado } from './revisaoPonto';

// ------------------------------------------------------------ Parâmetros
/** Percentuais (mínimo legal por padrão). Só rotulam as colunas — o resumo é em horas. */
export interface Percentuais {
  /** Hora extra de dia útil e de sábado de folga (CF art. 7º XVI). */
  extraUtil: number;
  /** Hora trabalhada em domingo e feriado (Lei 605/49 art. 9º; Súm. 146). */
  extraDomFeriado: number;
  /** Adicional noturno (CLT art. 73). */
  adicionalNoturno: number;
}
export const PERCENTUAIS_PADRAO: Percentuais = { extraUtil: 50, extraDomFeriado: 100, adicionalNoturno: 20 };

/** Hora noturna reduzida: 52min30s → cada minuto noturno real vale 8/7 (art. 73 §1º). */
export const FATOR_NOTURNO = 8 / 7;
/** Faixa noturna urbana: 22h às 5h (art. 73). */
const NOITE_INI = 22 * 60;
const NOITE_FIM = 5 * 60;
/** Tolerância por dia: até 10 min (art. 58 §1º; Súm. 366). Passou, conta tudo. */
export const TOLERANCIA_DIA_MIN = TOLERANCIA_MIN;

/** O que cada funcionário muda no cálculo: a jornada e se tem acordo de banco de horas. */
export interface RegrasEmpregado {
  jornada: Jornada;
  temBanco: boolean;
}

/**
 * ÚNICO ponto de ligação com o cadastro do empregado.
 *
 * Hoje: jornada do cadastro do ponto (ou da empresa) e **sem banco de horas**.
 * Quando o Departamento Pessoal chegar, troque o corpo por
 * `jornadaDoEmpregado(...)` e `temBancoDeHoras(...)` — ver "Para o integrador" em
 * docs/folha-de-ponto.md. `banco` permite marcar o acordo na própria tela enquanto isso.
 */
export function regrasDoEmpregado(
  cad: Pick<Funcionario, 'nome' | 'jornadaUtilMin' | 'jornadaSabadoMin'> | undefined,
  empresa: Jornada,
  nome: string,
  banco?: ReadonlySet<string>,
): RegrasEmpregado {
  return {
    jornada: {
      utilMin: cad?.jornadaUtilMin ?? empresa.utilMin,
      sabadoMin: cad?.jornadaSabadoMin ?? empresa.sabadoMin,
      trabalhaSabado: empresa.trabalhaSabado,
    },
    temBanco: Boolean(banco?.has(nome)),
  };
}

export interface FolhaResumo {
  funcionario: string;
  dias: DiaFreq[];
  regras?: RegrasEmpregado;
  /** Últimos dias do mês anterior: faltas dali cujo domingo cai neste mês. */
  anteriores?: DiaFreq[];
}

export interface OpcoesResumo {
  ano: number;
  mes: number;
  feriados: Set<string>;
  percentuais?: Partial<Percentuais>;
}

// ------------------------------------------------------------ Resultado
export interface DetalheDia {
  dia: number;
  /** 0 = domingo … 6 = sábado. */
  diaSemana: number;
  tipo: TipoDia;
  marcador: string | null;
  /** Texto do dia para a planilha: "Falta", "Atestado", "Trabalhou", "Folga"… */
  situacao: string;
  /** Minutos efetivamente marcados (null = não calculado). */
  trabalhadoMin: number | null;
  normaisMin: number;
  extrasUtilMin: number;
  extrasDomFeriadoMin: number;
  /** Déficit além da tolerância (atraso / saída antecipada). */
  atrasoMin: number;
  noturnoRealMin: number;
  noturnoComputadoMin: number;
  /** O dia não entrou na conta (marcação faltando, ilegível…): está em `impedimentos`. */
  naoCalculado: boolean;
}

export interface Conferir { dia: number | null; texto: string }

export interface ResumoFolhaFuncionario {
  funcionario: string;
  temBanco: boolean;
  diasTrabalhados: number;
  /** Minutos marcados (reais). */
  trabalhadoMin: number;
  /** Trabalhado − extras: o que corre como jornada normal. */
  normaisMin: number;
  /** Extras de dia útil/sábado de folga: a pagar (sem banco) ou para o banco. */
  extrasUtilPagarMin: number;
  extrasUtilBancoMin: number;
  /** Domingo e feriado trabalhados: sempre a pagar (padrão seguro, sem folga compensatória presumida). */
  extrasDomFeriadoMin: number;
  /** Das extras (qualquer faixa), quantos minutos caíram em dia com trabalho noturno (Súm. 264). */
  extrasEmDiaNoturnoMin: number;
  /** Noturno: minutos reais na faixa (22h–5h + prorrogação) e computados com a hora reduzida. */
  noturnoRealMin: number;
  noturnoComputadoMin: number;
  /** Horas não cumpridas além da tolerância: a descontar (sem banco). */
  atrasoMin: number;
  /** Com banco: o que abate o saldo (déficit + dias BANCO DE HORAS sem trabalho). */
  debitoBancoMin: number;
  /** Variação do banco no mês = extras para o banco − débitos. */
  saldoBancoMovMin: number;
  /** Faltas injustificadas (marcador FALTA em dia de trabalho). */
  faltas: number;
  /** DSR perdidos cujo domingo cai neste mês (falta deste mês ou do fim do anterior). */
  dsrPerdidos: number;
  /** Faltas deste mês cuja semana termina no mês seguinte: o DSR vai para a folha de lá. */
  dsrDoProximoMes: number;
  atestadoDias: number;
  feriasDias: number;
  folgaDias: number;
  feriadoDias: number;
  bancoMarcadorDias: number;
  /** Impedem fechar o mês (marcação faltando/ilegível, marcador × horário…). */
  impedimentos: Achado[];
  /** Pedem uma olhada, mas não travam. */
  conferir: Conferir[];
  detalhe: DetalheDia[];
}

export interface ResumoFolhaMes {
  ano: number;
  mes: number;
  percentuais: Percentuais;
  funcionarios: ResumoFolhaFuncionario[];
  /** Quantos funcionários têm impedimento. */
  comImpedimento: number;
  /** Aviso geral (ex.: sem feriados cadastrados). */
  avisos: string[];
}

/** Achados da revisão que impedem fechar: o cálculo do dia não é confiável. */
export const CODIGOS_IMPEDEM: CodigoAchado[] = [
  'horario_invalido', 'fora_de_ordem', 'marcacao_impar', 'marcador_com_horario', 'dia_vazio',
];

// ------------------------------------------------------------ Faixa noturna
export interface Intervalo { ini: number; fim: number }

const sobreposicao = (a: Intervalo, ini: number, fim: number) => Math.max(0, Math.min(a.fim, fim) - Math.max(a.ini, ini));

/**
 * Marcações do dia em intervalos (eixo contínuo, minutos desde 00:00 do dia). Se a
 * marcação seguinte é menor que a anterior mas é uma virada plausível da noite
 * (anterior ≥ 18h e a seguinte ≤ 12h), soma 24h e avisa `virou`. Qualquer outra
 * inversão devolve null (o dia fica "fora de ordem" para a contadora corrigir).
 */
export function intervalosDoDia(d: Partial<DiaFreq> | undefined): { intervalos: Intervalo[]; virou: boolean } | null {
  const a = analisarDia(d);
  if (a.preenchidas === 0 || a.invalidos.length || a.desencontrada) return null;
  const [e1, s1, e2, s2] = a.min;
  let marcas: number[];
  if (e1 !== null && s1 !== null && e2 !== null && s2 !== null) marcas = [e1, s1, e2, s2];
  else if (e1 !== null && s1 !== null && e2 === null && s2 === null) marcas = [e1, s1];
  else if (e1 === null && s1 === null && e2 !== null && s2 !== null) marcas = [e2, s2];
  else if (e1 !== null && s2 !== null && s1 === null && e2 === null) marcas = [e1, s2];
  else return null;
  let desloc = 0;
  let virou = false;
  const norm: number[] = [];
  for (const v of marcas) {
    let x = v + desloc;
    const ant = norm.length ? norm[norm.length - 1] : -1;
    if (x < ant) {
      if (ant - desloc >= 18 * 60 && v <= 12 * 60) { desloc += 1440; x = v + desloc; virou = true; } else return null;
    }
    norm.push(x);
  }
  const intervalos: Intervalo[] = [];
  for (let i = 0; i < norm.length; i += 2) intervalos.push({ ini: norm[i], fim: norm[i + 1] });
  return { intervalos, virou };
}

/**
 * Minutos reais na faixa noturna. Prorrogação (Súm. 60 II): quem começou antes da
 * meia-noite e ainda trabalhava às 5h segue com adicional (e hora reduzida, art. 73
 * §5º) até sair. Quem entrou de madrugada (já depois da meia-noite) só tem a faixa.
 */
export function minutosNoturnos(intervalos: Intervalo[], virou: boolean): { real: number; prorrogacao: number } {
  const cincoDaManha = 1440 + NOITE_FIM;
  const prorroga = virou && intervalos[0].ini < 1440 && intervalos.some((i) => i.ini <= cincoDaManha && i.fim > cincoDaManha);
  const fimNoite = prorroga ? 4000 : cincoDaManha;
  let real = 0;
  let prorrogacao = 0;
  for (const i of intervalos) {
    real += sobreposicao(i, 0, NOITE_FIM) + sobreposicao(i, NOITE_INI, fimNoite);
    if (prorroga) prorrogacao += sobreposicao(i, cincoDaManha, 4000);
  }
  return { real, prorrogacao };
}

/** Minutos reais → minutos computados com a hora noturna reduzida (8/7). */
export const computarNoturno = (realMin: number) => Math.round(realMin * FATOR_NOTURNO);

// ------------------------------------------------------------ DSR
/** Domingo da semana (segunda a domingo) em que cai o dia. */
function domingoDaSemana(ano: number, mes: number, dia: number): { ano: number; mes: number; dia: number } {
  const wd = diaSemana(ano, mes, dia);
  const d = new Date(Date.UTC(ano, mes - 1, dia) + ((7 - wd) % 7) * 86400000);
  return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() };
}

const dd = (n: number) => String(n).padStart(2, '0');

// ------------------------------------------------------------ Um funcionário
export function resumirFolha(folha: FolhaResumo, op: OpcoesResumo): ResumoFolhaFuncionario {
  const { ano, mes } = op;
  const regras = folha.regras ?? { jornada: JORNADA_PADRAO, temBanco: false };
  const j = regras.jornada;
  const N = diasNoMes(ano, mes);
  const porDia = new Map<number, DiaFreq>();
  for (const d of folha.dias ?? []) if (d && d.dia >= 1 && d.dia <= N) porDia.set(d.dia, d);

  const r: ResumoFolhaFuncionario = {
    funcionario: folha.funcionario, temBanco: regras.temBanco, diasTrabalhados: 0, trabalhadoMin: 0, normaisMin: 0,
    extrasUtilPagarMin: 0, extrasUtilBancoMin: 0, extrasDomFeriadoMin: 0, extrasEmDiaNoturnoMin: 0,
    noturnoRealMin: 0, noturnoComputadoMin: 0, atrasoMin: 0, debitoBancoMin: 0, saldoBancoMovMin: 0,
    faltas: 0, dsrPerdidos: 0, dsrDoProximoMes: 0, atestadoDias: 0, feriasDias: 0, folgaDias: 0, feriadoDias: 0,
    bancoMarcadorDias: 0, impedimentos: [], conferir: [], detalhe: [],
  };

  // Impedimentos = achados da revisão que tornam o dia incalculável (mesma régua da tela).
  const revisao = revisarFolha(
    { funcionario: folha.funcionario, dias: folha.dias, jornada: j, anteriores: folha.anteriores },
    { ano, mes, feriados: op.feriados },
  );
  // "Fora de ordem" por virada da meia-noite não impede: o resumo sabe calcular (e avisa em `conferir`).
  r.impedimentos = revisao.achados.filter((a) => CODIGOS_IMPEDEM.includes(a.codigo)
    && !(a.codigo === 'fora_de_ordem' && a.dia !== null && intervalosDoDia(porDia.get(a.dia))?.virou));
  const diasImpedidos = new Set(r.impedimentos.filter((a) => a.dia !== null).map((a) => a.dia as number));
  const conf = (dia: number | null, texto: string) => r.conferir.push({ dia, texto });

  const noturnos: number[] = [];
  const virados: number[] = [];
  const extrasSabado: number[] = [];
  const semanasPerdidas = new Set<string>();
  /** Marca a semana da falta como sem DSR e diz em que mês cai o domingo. */
  const registrarFalta = (a: number, m: number, dia: number): 'neste' | 'outro' => {
    const dom = domingoDaSemana(a, m, dia);
    semanasPerdidas.add(`${dom.ano}-${dom.mes}-${dom.dia}`);
    return dom.ano === ano && dom.mes === mes ? 'neste' : 'outro';
  };

  // Faltas do fim do mês anterior cujo domingo cai neste mês.
  const mesAnt = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
  const NAnt = diasNoMes(mesAnt.ano, mesAnt.mes);
  for (const d of folha.anteriores ?? []) {
    if (d.marcador !== 'FALTA' || analisarDia(d).preenchidas > 0 || d.dia > NAnt) continue;
    if (!ehDiaDeTrabalho(tipoDoDia(mesAnt.ano, mesAnt.mes, d.dia, op.feriados), j)) continue;
    if (registrarFalta(mesAnt.ano, mesAnt.mes, d.dia) === 'neste') {
      conf(null, `Falta de ${dd(d.dia)}/${dd(mesAnt.mes)} faz perder o DSR do domingo deste mês (Lei 605/49 art. 6º).`);
    }
  }

  for (let dia = 1; dia <= N; dia++) {
    const d = porDia.get(dia);
    const wd = diaSemana(ano, mes, dia);
    const tipo = tipoDoDia(ano, mes, dia, op.feriados);
    const marc = d?.marcador ?? null;
    const a = analisarDia(d);
    const temHorario = a.preenchidas > 0;
    const ehFeriado = tipo === 'feriado' || marc === 'FERIADO';
    const trabalha = ehDiaDeTrabalho(tipo, j);
    const det: DetalheDia = {
      dia, diaSemana: wd, tipo, marcador: marc, situacao: '', trabalhadoMin: null, normaisMin: 0,
      extrasUtilMin: 0, extrasDomFeriadoMin: 0, atrasoMin: 0, noturnoRealMin: 0, noturnoComputadoMin: 0, naoCalculado: false,
    };
    r.detalhe.push(det);

    // Marcador × horário é impedimento: o dia não é calculado.
    if (marc && temHorario && marc !== 'BANCO DE HORAS' && marc !== 'FERIADO') {
      det.naoCalculado = true; det.situacao = `${marc} × horário`;
      continue;
    }
    if (diasImpedidos.has(dia) && temHorario) {
      det.naoCalculado = true; det.situacao = 'Conferir marcações';
      continue;
    }

    if (!temHorario) {
      if (marc === 'FALTA') {
        if (trabalha) {
          r.faltas++; det.situacao = 'Falta';
          if (registrarFalta(ano, mes, dia) === 'outro') {
            r.dsrDoProximoMes++;
            const dom = domingoDaSemana(ano, mes, dia);
            conf(dia, `Falta de ${dd(dia)}/${dd(mes)}: o DSR perdido (domingo ${dd(dom.dia)}/${dd(dom.mes)}) entra na folha do mês seguinte.`);
          }
        } else {
          det.situacao = 'Falta (dia sem expediente)';
          conf(dia, `FALTA em ${dd(dia)}/${dd(mes)}, dia sem expediente: não conta falta nem perda de DSR.`);
        }
      } else if (marc === 'ATESTADO') { r.atestadoDias++; det.situacao = 'Atestado'; }
      else if (marc === 'FÉRIAS') { r.feriasDias++; det.situacao = 'Férias'; }
      else if (marc === 'FOLGA') { r.folgaDias++; det.situacao = 'Folga'; }
      else if (marc === 'FERIADO' || tipo === 'feriado') {
        if (wd !== 0) { r.feriadoDias++; det.situacao = 'Feriado'; } else det.situacao = 'Feriado (domingo)';
      } else if (marc === 'BANCO DE HORAS') {
        r.bancoMarcadorDias++; det.situacao = 'Banco de horas';
        if (regras.temBanco) r.debitoBancoMin += minutosACumprir(tipo, j);
        else conf(dia, `Marcador BANCO DE HORAS em ${dd(dia)}/${dd(mes)}, mas o funcionário não tem banco de horas: confira o acordo.`);
      } else det.situacao = wd === 0 ? 'Domingo' : trabalha ? '' : 'Folga semanal';
      continue;
    }

    // Dia com horário.
    const iv = intervalosDoDia(d);
    if (!iv) {
      det.naoCalculado = true; det.situacao = 'Conferir marcações';
      conf(dia, `Dia ${dd(dia)}/${dd(mes)} fora de ordem ou incompleto: não entrou na conta.`);
      continue;
    }
    if (iv.virou) virados.push(dia);
    const t = iv.intervalos.reduce((s, i) => s + (i.fim - i.ini), 0);
    const noite = minutosNoturnos(iv.intervalos, iv.virou);
    const noiteComp = computarNoturno(noite.real);
    // Jornada noturna: compara-se a hora COMPUTADA com a jornada (22h–6h = 9h08, não 8h).
    const efetivo = t + (noiteComp - noite.real);
    det.trabalhadoMin = t;
    det.noturnoRealMin = noite.real;
    det.noturnoComputadoMin = noiteComp;
    r.diasTrabalhados++;
    r.trabalhadoMin += t;
    r.noturnoRealMin += noite.real;
    r.noturnoComputadoMin += noiteComp;
    if (noite.real > 0) noturnos.push(dia);

    let extraUtil = 0;
    let extraDomFer = 0;
    let atraso = 0;
    if (ehFeriado || tipo === 'domingo') {
      extraDomFer = efetivo; // toda hora é extra a 100%; sem folga compensatória presumida
      det.situacao = ehFeriado ? 'Feriado trabalhado' : 'Domingo trabalhado';
    } else {
      const devido = trabalha ? minutosACumprir(tipo, j) : 0;
      const dif = efetivo - devido;
      if (dif > TOLERANCIA_DIA_MIN) extraUtil = dif;
      else if (-dif > TOLERANCIA_DIA_MIN) atraso = -dif;
      det.situacao = trabalha ? 'Trabalhou' : 'Trabalhou na folga';
      if (!trabalha && extraUtil > 0) extrasSabado.push(dia);
    }
    det.normaisMin = Math.max(0, efetivo - extraUtil - extraDomFer);
    det.extrasUtilMin = extraUtil;
    det.extrasDomFeriadoMin = extraDomFer;
    det.atrasoMin = atraso;
    r.normaisMin += det.normaisMin;
    r.extrasDomFeriadoMin += extraDomFer;
    if (regras.temBanco) { r.extrasUtilBancoMin += extraUtil; r.debitoBancoMin += atraso; }
    else { r.extrasUtilPagarMin += extraUtil; r.atrasoMin += atraso; }
    if ((extraUtil > 0 || extraDomFer > 0) && noite.real > 0) r.extrasEmDiaNoturnoMin += extraUtil + extraDomFer;
  }

  r.saldoBancoMovMin = r.extrasUtilBancoMin - r.debitoBancoMin;
  r.dsrPerdidos = [...semanasPerdidas].filter((k) => {
    const [a, m] = k.split('-').map(Number);
    return a === ano && m === mes;
  }).length;

  // Notas do mês (uma por assunto, para não virar ruído).
  const lista = (ds: number[]) => ds.slice(0, 5).map((x) => `${dd(x)}/${dd(mes)}`).join(', ') + (ds.length > 5 ? ` e mais ${ds.length - 5}` : '');
  if (noturnos.length) conf(null, `Trabalho noturno em ${lista(noturnos)}: a jornada é comparada em hora computada (22h–6h = 9h08) e a extra incide sobre a hora com adicional. Confira o regime noturno (CLT art. 73).`);
  if (virados.length) conf(null, `Virada da meia-noite assumida em ${lista(virados)} (saída menor que a entrada); o dia vale pela data de início da jornada.`);
  if (extrasSabado.length) conf(null, `Trabalho em sábado de folga em ${lista(extrasSabado)} pago a ${op.percentuais?.extraUtil ?? PERCENTUAIS_PADRAO.extraUtil}%: algumas convenções fixam 100%.`);
  if (r.atrasoMin > 0 || (regras.temBanco && r.debitoBancoMin > 0)) conf(null, 'Atraso aproximado: sem o horário de entrada no cadastro, é a jornada menos o trabalhado, acima de 10 min no dia (não vale a tolerância de 5 min por marcação).');
  if (r.atestadoDias > 15) conf(null, `${r.atestadoDias} dias de atestado: do 16º dia em diante o afastamento é com o INSS (Lei 8.213 art. 60).`);
  return r;
}

// ------------------------------------------------------------ O mês inteiro
export function resumirMes(folhas: FolhaResumo[], op: OpcoesResumo): ResumoFolhaMes {
  const percentuais = { ...PERCENTUAIS_PADRAO, ...(op.percentuais ?? {}) };
  const funcionarios = folhas.map((f) => resumirFolha(f, { ...op, percentuais }));
  const avisos: string[] = [];
  if (folhas.length && ![...op.feriados].some((f) => f.startsWith(`${op.ano}-`))) {
    avisos.push(`Nenhum feriado cadastrado em ${op.ano}: o trabalho em feriado só é visto quando o dia tem o marcador FERIADO.`);
  }
  return {
    ano: op.ano, mes: op.mes, percentuais, funcionarios, avisos,
    comImpedimento: funcionarios.filter((f) => f.impedimentos.length > 0).length,
  };
}

/** Texto dos números do resumo — se a folha mudar, muda; base do "conferido". */
export function textoAssinatura(r: ResumoFolhaMes): string {
  return JSON.stringify(r.funcionarios.map((f) => [
    f.funcionario, f.temBanco, f.trabalhadoMin, f.normaisMin, f.extrasUtilPagarMin, f.extrasUtilBancoMin, f.extrasDomFeriadoMin,
    f.noturnoRealMin, f.atrasoMin, f.debitoBancoMin, f.faltas, f.dsrPerdidos, f.atestadoDias, f.feriasDias, f.folgaDias,
    f.feriadoDias, f.bancoMarcadorDias, f.impedimentos.length,
  ]));
}

// ------------------------------------------------------------ Exportação
/** "8:30" para minutos; vazio para zero (fica limpo na planilha). */
export const hhmm = (min: number) => (min ? formatarMin(min) : '');

export interface ColunaResumo { titulo: string; valor: (f: ResumoFolhaFuncionario) => string | number }

export function colunasResumo(p: Percentuais): ColunaResumo[] {
  const h = (fn: (f: ResumoFolhaFuncionario) => number) => (f: ResumoFolhaFuncionario) => hhmm(fn(f));
  return [
    { titulo: 'Funcionário', valor: (f) => f.funcionario },
    { titulo: 'Dias trabalhados', valor: (f) => f.diasTrabalhados },
    { titulo: 'Horas trabalhadas', valor: h((f) => f.trabalhadoMin) },
    { titulo: 'Horas normais', valor: h((f) => f.normaisMin) },
    { titulo: `Extras ${p.extraUtil}% (pagar)`, valor: h((f) => f.extrasUtilPagarMin) },
    { titulo: `Extras ${p.extraUtil}% (banco)`, valor: h((f) => f.extrasUtilBancoMin) },
    { titulo: `Extras ${p.extraDomFeriado}% dom./feriado (pagar)`, valor: h((f) => f.extrasDomFeriadoMin) },
    { titulo: 'Noturno real (22h–5h)', valor: h((f) => f.noturnoRealMin) },
    { titulo: `Noturno computado (hora 52min30s) — adicional ${p.adicionalNoturno}%`, valor: h((f) => f.noturnoComputadoMin) },
    { titulo: 'Atrasos a descontar', valor: h((f) => f.atrasoMin) },
    { titulo: 'Débito no banco', valor: h((f) => f.debitoBancoMin) },
    { titulo: 'Variação do banco no mês', valor: (f) => (f.saldoBancoMovMin ? formatarMin(f.saldoBancoMovMin) : '') },
    { titulo: 'Faltas (dias)', valor: (f) => f.faltas || '' },
    { titulo: 'DSR perdidos', valor: (f) => f.dsrPerdidos || '' },
    { titulo: 'Atestado (dias)', valor: (f) => f.atestadoDias || '' },
    { titulo: 'Férias (dias)', valor: (f) => f.feriasDias || '' },
    { titulo: 'Folga (dias)', valor: (f) => f.folgaDias || '' },
    { titulo: 'Feriado (dias)', valor: (f) => f.feriadoDias || '' },
    { titulo: 'Banco de horas (dias)', valor: (f) => f.bancoMarcadorDias || '' },
    { titulo: 'Pendências', valor: (f) => (f.impedimentos.length ? `${f.impedimentos.length} a corrigir` : '') },
  ];
}

const aspas = (v: string | number) => {
  const s = String(v);
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV com ponto e vírgula e BOM (abre direto no Excel em pt-BR). */
export function resumoParaCsv(r: ResumoFolhaMes): string {
  const cols = colunasResumo(r.percentuais);
  const linhas = [cols.map((c) => aspas(c.titulo)).join(';'), ...r.funcionarios.map((f) => cols.map((c) => aspas(c.valor(f))).join(';'))];
  return `﻿${linhas.join('\r\n')}\r\n`;
}

export const tituloPeriodo = (r: { ano: number; mes: number }) => `${MESES[r.mes]}/${r.ano}`;
