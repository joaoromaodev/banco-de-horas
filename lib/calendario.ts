// Calendário: nomes de meses/dias, tipo do dia e horário a cumprir.

export const MESES = [
  '',
  'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
  'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO',
];

export const DIAS_SEMANA = [
  'DOMINGO', 'SEGUNDA-FEIRA', 'TERÇA-FEIRA', 'QUARTA-FEIRA',
  'QUINTA-FEIRA', 'SEXTA-FEIRA', 'SÁBADO',
];

export type TipoDia = 'util' | 'sabado' | 'domingo' | 'feriado';

export function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** 0=domingo ... 6=sábado (UTC para evitar fuso). */
export function diaSemana(ano: number, mes: number, dia: number): number {
  return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

export function chaveData(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function tipoDoDia(
  ano: number,
  mes: number,
  dia: number,
  feriados: Set<string>,
): TipoDia {
  if (feriados.has(chaveData(ano, mes, dia))) return 'feriado';
  const wd = diaSemana(ano, mes, dia);
  if (wd === 0) return 'domingo';
  if (wd === 6) return 'sabado';
  return 'util';
}

export interface Jornada {
  utilMin: number;
  sabadoMin: number;
  /** A empresa trabalha aos sábados? Quando false, sábado vira folga (0h). */
  trabalhaSabado: boolean;
}

// Padrão: não trabalha aos sábados (sábado = folga, como na VAZ & VOUZELA).
export const JORNADA_PADRAO: Jornada = { utilMin: 480, sabadoMin: 240, trabalhaSabado: false };

/** O tipo de dia conta como dia de trabalho para esta jornada? */
export function ehDiaDeTrabalho(tipo: TipoDia, jornada: Jornada = JORNADA_PADRAO): boolean {
  if (tipo === 'util') return true;
  if (tipo === 'sabado') return jornada.trabalhaSabado;
  return false; // domingo / feriado
}

/** Minutos que o funcionário deve cumprir naquele tipo de dia. */
export function minutosACumprir(tipo: TipoDia, jornada: Jornada = JORNADA_PADRAO): number {
  if (tipo === 'util') return jornada.utilMin;
  if (tipo === 'sabado') return jornada.trabalhaSabado ? jornada.sabadoMin : 0;
  return 0; // domingo / feriado (ou sábado de folga)
}
