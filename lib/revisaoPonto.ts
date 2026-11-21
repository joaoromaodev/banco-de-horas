// Revisão inteligente da Folha de Ponto (Sprint 7, Frente A).
//
// Regras PURAS, determinísticas e explicáveis — mesmo espírito de
// lib/revisaoCaixa.ts: cada achado diz em uma frase por que apareceu e cita a
// regra legal. Só ALERTA: nunca bloqueia nem altera o dado (corrigir continua
// sendo editar o dia). Critérios definidos com o subagente `contador` em
// 21/11/2026 e calibrados com os 183 dias reais (ver docs/folha-de-ponto.md).
//
// Quem chama: a rota GET /api/revisao-ponto (o mês inteiro da empresa, numa
// leitura) e a Timesheet (a folha em edição, ao vivo, no navegador).
//
// Desempenho: uma passada por funcionário × dia, sem consulta — um mês de 100
// funcionários revisa em poucos milissegundos.
import type { DiaFreq, Marcador } from './tipos';
import { parseHoraParaMin, formatarMin } from './tempo';
import { diasNoMes, tipoDoDia, ehDiaDeTrabalho, minutosACumprirDia, Jornada, JORNADA_PADRAO, TipoDia } from './calendario';

export type NivelAchado = 'alto' | 'medio' | 'baixo';

export type CodigoAchado =
  | 'horario_invalido' | 'fora_de_ordem' | 'marcacao_impar' | 'jornada_acima'
  | 'sem_intervalo' | 'intervalo_curto' | 'intervalo_longo' | 'intervalo_nao_marcado'
  | 'interjornada' | 'setimo_dia' | 'feriado_trabalhado' | 'folga_com_horario'
  | 'marcador_com_horario' | 'dia_vazio' | 'falta' | 'atestado_inss' | 'noturno'
  | 'ponto_britanico' | 'leitura_incerta' | 'sem_feriados';

export interface Achado {
  codigo: CodigoAchado;
  nivel: NivelAchado;
  /** Rótulo curto do selo ("Sem intervalo"). */
  rotulo: string;
  /** A frase que explica, com a regra legal entre parênteses. */
  motivo: string;
  funcionario: string;
  /** Dia do mês; `null` = achado do mês inteiro (aparece no resumo do funcionário). */
  dia: number | null;
}

export type Campo = 'entradaManha' | 'saidaAlmoco' | 'retornoAlmoco' | 'saidaTarde';
export const CAMPOS: Campo[] = ['entradaManha', 'saidaAlmoco', 'retornoAlmoco', 'saidaTarde'];
const NOME_CAMPO: Record<Campo, string> = {
  entradaManha: 'entrada', saidaAlmoco: 'saída do almoço', retornoAlmoco: 'retorno do almoço', saidaTarde: 'saída',
};
/** Gênero do nome do campo, para "na entrada" / "no retorno". */
const MASCULINO: Record<Campo, boolean> = { entradaManha: false, saidaAlmoco: false, retornoAlmoco: true, saidaTarde: false };
const com = (prep: 'em' | 'de', c: Campo) =>
  `${prep === 'em' ? (MASCULINO[c] ? 'no' : 'na') : (MASCULINO[c] ? 'do' : 'da')} ${NOME_CAMPO[c]}`;

export interface FolhaRevisao {
  funcionario: string;
  /** Dias do mês revisado (os que faltam contam como vazios). */
  dias: DiaFreq[];
  /** Jornada do funcionário (minutos do dia útil/sábado + se a empresa trabalha sábado). */
  jornada?: Jornada;
  /** Últimos dias do mês anterior, se houver — fecham interjornada e 7º dia na virada. */
  anteriores?: DiaFreq[];
  /** Campos que a IA marcou como leitura incerta (só existe logo após a leitura). */
  incertos?: { dia: number; campo: string }[];
}

export interface OpcoesRevisaoPonto {
  ano: number;
  mes: number;
  /** Feriados do escritório (AAAA-MM-DD). */
  feriados: Set<string>;
}

export interface ResumoFuncionario {
  funcionario: string;
  /** Soma dos pesos dos achados — ordena a fila. */
  risco: number;
  alto: number;
  medio: number;
  baixo: number;
  /** Dias distintos com pelo menos um achado. */
  diasAtencao: number;
  /** Achados do funcionário, do mais grave para o mais leve (empate: pelo dia). */
  achados: Achado[];
  /** Informativo, não é alerta: horas além da jornada contratual e em quantos dias. */
  alemDaJornadaMin: number;
  diasAlemDaJornada: number;
  faltas: number;
}

export interface ResultadoRevisaoPonto {
  /** Um por funcionário, do maior risco para o menor (empate: ordem de chegada). */
  funcionarios: ResumoFuncionario[];
  /** Achados que não são de um funcionário (ex.: nenhum feriado cadastrado). */
  gerais: Achado[];
  resumo: { alto: number; medio: number; baixo: number; diasAtencao: number; funcionariosAtencao: number };
  /** Contagem por tipo — base da calibração. */
  porCodigo: Partial<Record<CodigoAchado, number>>;
}

/** Quanto cada nível pesa no risco (igual ao Livro Caixa). */
export const PESO_NIVEL: Record<NivelAchado, number> = { alto: 5, medio: 2, baixo: 1 };
const ORDEM_NIVEL: Record<NivelAchado, number> = { alto: 0, medio: 1, baixo: 2 };

// ------------------------------------------------------------ Limiares
// Cada um explicável em uma frase (ver docs/folha-de-ponto.md, "Revisão inteligente").
/** Horas extras por dia (CLT art. 59). */
export const EXTRAS_DIA_MIN = 120;
/** Teto diário com compensação (art. 59 §2º): ninguém passa de 10h. */
export const TETO_DIA_MIN = 600;
/** Tolerância de marcação: até 10 min no dia (art. 58 §1º, Súmula 366 TST). */
export const TOLERANCIA_MIN = 10;
/** Acima disto o intervalo mínimo é 1h (art. 71); 6h + tolerância. */
export const JORNADA_INTERVALO_1H = 360 + TOLERANCIA_MIN;
/** Acima disto (e até 6h) o intervalo mínimo é 15 min (art. 71 §1º). */
export const JORNADA_INTERVALO_15 = 240;
/** Intervalo abaixo disto em jornada > 6h alerta (1h menos 5 min, anti-ruído). */
export const INTERVALO_MINIMO_MIN = 55;
/** Intervalo acima de 2h exige acordo escrito (art. 71). */
export const INTERVALO_MAXIMO_MIN = 120;
/** Descanso mínimo entre jornadas (art. 66). */
export const INTERJORNADA_MIN = 660;
/** 7º dia seguido de trabalho sem folga (art. 67, OJ 410 TST). */
export const DIAS_SEGUIDOS_MAX = 6;
/** Ponto britânico: mínimo de dias trabalhados e fração com entrada+saída idênticas. */
export const BRITANICO_MIN_DIAS = 10;
export const BRITANICO_FRACAO = 0.8;
/** Afastamento: do 16º dia de atestado em diante é com o INSS (Lei 8.213 art. 60). */
export const ATESTADO_DIAS_EMPRESA = 15;
/** Trabalho noturno urbano: 22h às 5h (art. 73). */
const NOITE_INICIO = 22 * 60;
const NOITE_FIM = 5 * 60;

const dd = (n: number) => String(n).padStart(2, '0');
/** "8h" / "7h06" — horas para o motivo. */
export function horas(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${dd(m)}` : `${h}h`;
}

// ------------------------------------------------------------ Análise de um dia
export interface AnaliseDia {
  /** Minutos de cada marcação (null = vazia ou ilegível). */
  min: (number | null)[];
  /** Marcações preenchidas mas que não são um horário (ex.: "12>54", "25:00", "8:75"). */
  invalidos: { campo: Campo; valor: string }[];
  /** Primeira marcação fora de ordem (e a anterior a ela). */
  foraDeOrdem: { campo: Campo; valor: number; anterior: Campo; valorAnterior: number } | null;
  /** Quantas marcações têm algum texto. */
  preenchidas: number;
  /** Combinação de marcações que não fecha um período (1 ou 3, ou pares trocados). */
  desencontrada: boolean;
  /** Minutos trabalhados (null quando não dá para calcular). */
  trabalhado: number | null;
  /** Intervalo do almoço (só com as 4 marcações). */
  intervalo: number | null;
  /** Só entrada e saída: intervalo não marcado (pode ser pré-assinalado). */
  semIntervaloMarcado: boolean;
  primeira: number | null;
  ultima: number | null;
}

const vazio = (v: unknown) => v === null || v === undefined || String(v).trim() === '';

export function analisarDia(d: Partial<DiaFreq> | undefined): AnaliseDia {
  const brutos = CAMPOS.map((c) => (d ? d[c] : null));
  const min = brutos.map((b) => parseHoraParaMin(b));
  const invalidos: AnaliseDia['invalidos'] = [];
  brutos.forEach((b, i) => { if (!vazio(b) && min[i] === null) invalidos.push({ campo: CAMPOS[i], valor: String(b).trim() }); });
  const tem = brutos.map((b) => !vazio(b));
  const preenchidas = tem.filter(Boolean).length;

  let foraDeOrdem: AnaliseDia['foraDeOrdem'] = null;
  let ant = -1;
  for (let i = 0; i < 4 && !foraDeOrdem; i++) {
    const v = min[i];
    if (v === null) continue;
    if (ant >= 0 && v < min[ant]!) foraDeOrdem = { campo: CAMPOS[i], valor: v, anterior: CAMPOS[ant], valorAnterior: min[ant]! };
    ant = i;
  }

  const [e1, s1, e2, s2] = tem;
  const quatro = e1 && s1 && e2 && s2;
  const manha = e1 && s1 && !e2 && !s2;
  const tarde = !e1 && !s1 && e2 && s2;
  const corrido = e1 && !s1 && !e2 && s2; // entrada e saída, intervalo não marcado
  const desencontrada = preenchidas > 0 && !(quatro || manha || tarde || corrido);

  let trabalhado: number | null = null;
  let intervalo: number | null = null;
  if (!invalidos.length && !foraDeOrdem && !desencontrada && preenchidas > 0) {
    const [a, b, c, e] = min as number[];
    if (quatro) { trabalhado = (b - a) + (e - c); intervalo = c - b; }
    else if (manha) trabalhado = b - a;
    else if (tarde) trabalhado = e - c;
    else trabalhado = e - a;
  }
  const validos = min.filter((v): v is number => v !== null);
  return {
    min, invalidos, foraDeOrdem, preenchidas, desencontrada, trabalhado, intervalo,
    semIntervaloMarcado: Boolean(corrido),
    primeira: validos.length ? validos[0] : null,
    ultima: validos.length ? validos[validos.length - 1] : null,
  };
}

/** Jornada contratual do dia (minutos) para o limite de horas extras. */
function contratualDoDia(tipo: TipoDia, j: Jornada): number {
  return tipo === 'sabado' && j.trabalhaSabado ? j.sabadoMin : j.utilMin;
}

/** Limite do dia: o menor entre contratual + 2h e 10h (art. 59 e §2º). */
export function limiteDoDia(tipo: TipoDia, j: Jornada = JORNADA_PADRAO): number {
  return Math.min(contratualDoDia(tipo, j) + EXTRAS_DIA_MIN, TETO_DIA_MIN);
}

const MARCADOR_SEM_TRABALHO: Marcador[] = ['FÉRIAS', 'ATESTADO', 'FALTA'];

// ------------------------------------------------------------ Um funcionário

/** Revisa a folha de UM funcionário num mês. */
export function revisarFolha(folha: FolhaRevisao, op: OpcoesRevisaoPonto): ResumoFuncionario {
  const j = folha.jornada ?? JORNADA_PADRAO;
  const nome = folha.funcionario;
  const { ano, mes } = op;
  const N = diasNoMes(ano, mes);
  const porDia = new Map<number, DiaFreq>();
  for (const d of folha.dias ?? []) if (d && d.dia >= 1 && d.dia <= N) porDia.set(d.dia, d);
  const achados: Achado[] = [];
  const add = (codigo: CodigoAchado, nivel: NivelAchado, rotulo: string, motivo: string, dia: number | null) =>
    achados.push({ codigo, nivel, rotulo, motivo, funcionario: nome, dia });

  const analises = new Map<number, AnaliseDia>();
  for (let dia = 1; dia <= N; dia++) analises.set(dia, analisarDia(porDia.get(dia)));
  const comDado = (dia: number) => {
    const d = porDia.get(dia);
    return Boolean(d && (analises.get(dia)!.preenchidas > 0 || d.marcador));
  };
  const diasComDado = [...porDia.keys()].filter(comDado).sort((a, b) => a - b);
  const primeiroDia = diasComDado[0] ?? 0;
  const ultimoDia = diasComDado[diasComDado.length - 1] ?? 0;

  // Mês anterior: último dia (interjornada no dia 1) e sequência de dias trabalhados.
  const mesAnt = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
  const NAnt = diasNoMes(mesAnt.ano, mesAnt.mes);
  const anteriores = new Map((folha.anteriores ?? []).map((d) => [d.dia, d]));
  let seguidos = 0;
  if (anteriores.size) {
    for (let dia = NAnt; dia >= 1; dia--) {
      const a = analisarDia(anteriores.get(dia));
      if (a.preenchidas > 0) seguidos++;
      else break;
    }
  }

  let alemMin = 0;
  let diasAlem = 0;
  let faltas = 0;
  const longos: number[] = [];
  const naoMarcados: number[] = [];
  const noturnos: number[] = [];
  let atestadoInicio: number | null = null; // primeiro dia da sequência de atestados
  let atestadoAvisado = false;
  const incertosPorDia = new Map<number, Set<string>>();
  for (const c of folha.incertos ?? []) {
    if (!incertosPorDia.has(c.dia)) incertosPorDia.set(c.dia, new Set());
    incertosPorDia.get(c.dia)!.add(c.campo);
  }

  for (let dia = 1; dia <= N; dia++) {
    const d = porDia.get(dia);
    const a = analises.get(dia)!;
    const marc = d?.marcador ?? null;
    const tipo = tipoDoDia(ano, mes, dia, op.feriados);
    const trabalha = ehDiaDeTrabalho(tipo, j);
    const temHorario = a.preenchidas > 0;
    const antes = achados.length;

    // 1. Horário impossível / ilegível
    for (const inv of a.invalidos) {
      add('horario_invalido', 'alto', 'Horário ilegível',
        `Horário "${inv.valor}" ${com('em', inv.campo)} não é uma hora válida (HH:MM); corrija para calcular`, dia);
    }
    // 2. Fora de ordem
    if (a.foraDeOrdem) {
      const f = a.foraDeOrdem;
      add('fora_de_ordem', 'alto', 'Fora de ordem',
        `${cap(NOME_CAMPO[f.campo])} ${formatarMin(f.valor)} antes ${com('de', f.anterior)} ${formatarMin(f.valorAnterior)}; virou a meia-noite?`, dia);
    }
    // 3. Marcações ímpares / desencontradas
    if (a.desencontrada && !a.invalidos.length) {
      add('marcacao_impar', 'alto', 'Falta marcação',
        a.preenchidas % 2
          ? `Só ${a.preenchidas} marcação(ões): falta um horário para calcular a jornada (CLT art. 74 §2º)`
          : 'Marcações não fecham entrada e saída: confira qual horário está na coluna errada (CLT art. 74 §2º)', dia);
    }

    // 4. Marcador que diz "não trabalhou", mas há horário
    if (temHorario && marc && (MARCADOR_SEM_TRABALHO.includes(marc) || marc === 'FOLGA')) {
      add('marcador_com_horario', marc === 'FOLGA' ? 'medio' : 'alto', 'Marcador × horário',
        `Marcado ${marc}, mas tem horário: qual dos dois vale?`, dia);
    }

    const t = a.trabalhado;
    if (t !== null && t > 0) {
      // 5. Jornada acima do limite (contratual + 2h, teto 10h)
      const lim = limiteDoDia(tipo, j);
      if (t > lim + TOLERANCIA_MIN) {
        add('jornada_acima', 'alto', 'Acima de 2h extras',
          `${horas(t)} trabalhadas: passou de ${horas(lim)} no dia, o máximo com 2h extras (CLT art. 59)`, dia);
      }
      // 6. Intervalo intrajornada
      if (a.intervalo !== null) {
        if (t > JORNADA_INTERVALO_1H && a.intervalo === 0) {
          add('sem_intervalo', 'alto', 'Sem intervalo',
            `Jornada de ${horas(t)} sem intervalo (saída e retorno às ${formatarMin(a.min[1]!)}); mínimo 1h (CLT art. 71)`, dia);
        } else if (t > JORNADA_INTERVALO_1H && a.intervalo < INTERVALO_MINIMO_MIN) {
          add('intervalo_curto', 'medio', 'Intervalo curto',
            `Intervalo de ${a.intervalo} min em jornada acima de 6h; mínimo 1h (CLT art. 71)`, dia);
        } else if (t > JORNADA_INTERVALO_15 && t <= JORNADA_INTERVALO_1H && a.intervalo < 15) {
          add('intervalo_curto', 'medio', 'Intervalo curto',
            `Jornada de ${horas(t)} sem os 15 min de intervalo (CLT art. 71 §1º)`, dia);
        }
        if (a.intervalo > INTERVALO_MAXIMO_MIN) longos.push(dia);
      } else if (a.semIntervaloMarcado && t > JORNADA_INTERVALO_15) {
        naoMarcados.push(dia);
      }
      // Informativo: além da jornada contratual
      const devido = minutosACumprirDia(tipo, marc, j);
      const alem = devido > 0 ? t - devido : t;
      if (alem > TOLERANCIA_MIN) { alemMin += alem; diasAlem++; }
    }

    // 7. Interjornada (11h entre a saída de ontem e a entrada de hoje)
    if (a.primeira !== null && !a.invalidos.length && !a.foraDeOrdem) {
      const ontem = dia > 1 ? analises.get(dia - 1)! : analisarDia(anteriores.get(NAnt));
      if (ontem.ultima !== null && !ontem.foraDeOrdem && !ontem.invalidos.length) {
        const descanso = 1440 - ontem.ultima + a.primeira;
        if (descanso < INTERJORNADA_MIN) {
          add('interjornada', 'medio', 'Pouco descanso',
            `Só ${horas(descanso)} de descanso desde a saída de ontem (${formatarMin(ontem.ultima)}); mínimo 11h (CLT art. 66)`, dia);
        }
      }
    }

    // 8. Trabalho noturno (22h–5h): um alerta no mês
    if (!a.invalidos.length && a.min.some((v) => v !== null && (v > NOITE_INICIO || v < NOITE_FIM))) noturnos.push(dia);

    // 9. Sétimo dia seguido sem folga
    if (temHorario) {
      seguidos++;
      if (seguidos === DIAS_SEGUIDOS_MAX + 1) {
        add('setimo_dia', 'alto', '7º dia seguido',
          `${DIAS_SEGUIDOS_MAX + 1}º dia seguido de trabalho sem folga semanal (CLT art. 67; OJ 410 TST)`, dia);
      }
    } else seguidos = 0;

    // 10. Feriado trabalhado / folga com horário
    const ehFeriado = tipo === 'feriado' || marc === 'FERIADO';
    if (temHorario && ehFeriado) {
      add('feriado_trabalhado', 'medio', 'Feriado trabalhado',
        `Trabalho no feriado ${dd(dia)}/${dd(mes)}: folga compensatória ou pagamento em dobro (Lei 605/49 art. 9º)`, dia);
    } else if (temHorario && !trabalha && !marc) {
      add('folga_com_horario', 'baixo', 'Horário na folga',
        `${tipo === 'domingo' ? 'Domingo' : 'Sábado sem expediente'} com horário e sem marcador: hora extra ou erro de dia?`, dia);
    }

    // 11. Dia útil vazio (só entre o primeiro e o último dia lançados: admissão/desligamento)
    if (trabalha && !temHorario && !marc && primeiroDia && dia > primeiroDia && dia < ultimoDia) {
      add('dia_vazio', 'medio', 'Dia em branco',
        'Dia útil sem horário nem marcador: falta ou esquecimento? Afeta desconto e DSR (Lei 605/49)', dia);
    }

    // 12. Falta: perde o DSR da semana
    if (marc === 'FALTA' && !temHorario) {
      faltas++;
      add('falta', 'baixo', 'Falta',
        'Falta sem justificativa: perde o descanso remunerado da semana (Lei 605/49 art. 6º)', dia);
    }

    // 13. Atestado além de 15 dias corridos (fins de semana/feriados sem dado não quebram)
    if (marc === 'ATESTADO') {
      if (atestadoInicio === null) atestadoInicio = dia;
      if (!atestadoAvisado && dia - atestadoInicio + 1 > ATESTADO_DIAS_EMPRESA) {
        atestadoAvisado = true;
        add('atestado_inss', 'alto', 'Atestado > 15 dias',
          `${dia - atestadoInicio + 1}º dia de atestado seguido: do 16º em diante, encaminhar ao INSS (Lei 8.213 art. 60)`, dia);
      }
    } else if (trabalha || temHorario || marc) {
      atestadoInicio = null;
      atestadoAvisado = false;
    }

    // 14. Leitura incerta da IA (sobe para médio se o dia já tem outro achado)
    const inc = incertosPorDia.get(dia);
    if (inc && inc.size) {
      const nomes = [...inc].map((c) => (c in NOME_CAMPO ? `${MASCULINO[c as Campo] ? 'o' : 'a'} ${NOME_CAMPO[c as Campo]}` : c)).join(', ');
      add('leitura_incerta', achados.length > antes ? 'medio' : 'baixo', 'Leitura incerta',
        `A IA teve dúvida ao ler ${nomes}; confira na foto`, dia);
    }
  }

  // ----- Achados do mês
  if (longos.length) {
    add('intervalo_longo', 'baixo', 'Intervalo > 2h',
      `Intervalo acima de 2h em ${listaDias(longos, mes)}: exige acordo escrito (CLT art. 71)`, null);
  }
  if (naoMarcados.length) {
    add('intervalo_nao_marcado', 'baixo', 'Intervalo não marcado',
      `Só entrada e saída em ${listaDias(naoMarcados, mes)}: confirme se o intervalo é pré-assinalado (CLT art. 74 §2º)`, null);
  }
  if (noturnos.length) {
    add('noturno', 'medio', 'Trabalho noturno',
      `Trabalho entre 22h e 5h em ${listaDias(noturnos, mes)}: adicional noturno e hora reduzida (CLT art. 73)`, null);
  }
  // Ponto britânico: entrada e saída idênticas na maioria dos dias (o almoço pode ser pré-assinalado).
  const trabalhados = diasComDado
    .map((dia) => analises.get(dia)!)
    .filter((a) => a.trabalhado !== null && a.trabalhado > 0 && a.primeira !== null && a.ultima !== null);
  if (trabalhados.length >= BRITANICO_MIN_DIAS) {
    const cont = new Map<string, number>();
    for (const a of trabalhados) {
      const k = `${a.primeira}-${a.ultima}`;
      cont.set(k, (cont.get(k) ?? 0) + 1);
    }
    const [chave, maior] = [...cont].sort((x, y) => y[1] - x[1])[0];
    if (maior / trabalhados.length >= BRITANICO_FRACAO) {
      const [e, s] = chave.split('-').map(Number);
      add('ponto_britanico', 'medio', 'Horário britânico',
        `Mesma entrada e saída (${formatarMin(e)}–${formatarMin(s)}) em ${maior} de ${trabalhados.length} dias: não vale como prova (Súmula 338 III TST)`, null);
    }
  }

  return resumir(nome, achados, { alemMin, diasAlem, faltas });
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function listaDias(dias: number[], mes: number): string {
  const txt = dias.slice(0, 5).map((d) => `${dd(d)}/${dd(mes)}`).join(', ');
  return dias.length > 5 ? `${txt} e mais ${dias.length - 5} dia(s)` : txt;
}

/** Ordena do mais grave para o mais leve; empate pelo dia (achados do mês por último). */
export function ordenarAchados(achados: Achado[]): Achado[] {
  return [...achados].sort((a, b) =>
    ORDEM_NIVEL[a.nivel] - ORDEM_NIVEL[b.nivel] || (a.dia ?? 99) - (b.dia ?? 99));
}

function resumir(nome: string, achados: Achado[], info: { alemMin: number; diasAlem: number; faltas: number }): ResumoFuncionario {
  const r: ResumoFuncionario = {
    funcionario: nome, risco: 0, alto: 0, medio: 0, baixo: 0, diasAtencao: 0,
    achados: ordenarAchados(achados),
    alemDaJornadaMin: info.alemMin, diasAlemDaJornada: info.diasAlem, faltas: info.faltas,
  };
  const dias = new Set<number>();
  for (const a of achados) {
    r[a.nivel]++;
    r.risco += PESO_NIVEL[a.nivel];
    if (a.dia !== null) dias.add(a.dia);
  }
  r.diasAtencao = dias.size;
  return r;
}

/** Achados de um dia, do mais grave para o mais leve. */
export function achadosPorDia(r: ResumoFuncionario): Map<number, Achado[]> {
  const m = new Map<number, Achado[]>();
  for (const a of r.achados) {
    if (a.dia === null) continue;
    if (!m.has(a.dia)) m.set(a.dia, []);
    m.get(a.dia)!.push(a);
  }
  return m;
}

/** O escritório não cadastrou nenhum feriado no ano: trabalho em feriado não é verificado. */
export function semFeriadosNoAno(feriados: Set<string>, ano: number): boolean {
  const prefixo = `${ano}-`;
  for (const f of feriados) if (f.startsWith(prefixo)) return false;
  return true;
}

// ------------------------------------------------------------ O mês inteiro de uma empresa
/** Revisa todas as folhas de uma empresa num mês. */
export function revisarMes(folhas: FolhaRevisao[], op: OpcoesRevisaoPonto): ResultadoRevisaoPonto {
  const funcionarios = folhas
    .map((f, i) => ({ r: revisarFolha(f, op), i }))
    .sort((a, b) => b.r.risco - a.r.risco || a.i - b.i)
    .map((x) => x.r);
  const gerais: Achado[] = [];
  if (folhas.length && semFeriadosNoAno(op.feriados, op.ano)) {
    gerais.push({
      codigo: 'sem_feriados', nivel: 'baixo', rotulo: 'Sem feriados', funcionario: '', dia: null,
      motivo: `Nenhum feriado cadastrado em ${op.ano}: o trabalho em feriado só é visto quando o dia tem o marcador FERIADO. Cadastre em Cadastros.`,
    });
  }
  const resumo = { alto: 0, medio: 0, baixo: 0, diasAtencao: 0, funcionariosAtencao: 0 };
  const porCodigo: Partial<Record<CodigoAchado, number>> = {};
  for (const f of funcionarios) {
    resumo.alto += f.alto; resumo.medio += f.medio; resumo.baixo += f.baixo;
    resumo.diasAtencao += f.diasAtencao;
    if (f.achados.length) resumo.funcionariosAtencao++;
    for (const a of f.achados) porCodigo[a.codigo] = (porCodigo[a.codigo] ?? 0) + 1;
  }
  for (const g of gerais) porCodigo[g.codigo] = (porCodigo[g.codigo] ?? 0) + 1;
  return { funcionarios, gerais, resumo, porCodigo };
}
