// Utilidades de tempo: parsing e conversões de "HH:MM".

/** Converte "HH:MM" (aceita 8:00, 08h00, 0800) em minutos do dia, ou null. */
export function parseHoraParaMin(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  const t = String(s).trim();
  if (t === '') return null;
  const m = t.match(/^(\d{1,2})[:h.]?(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

/** Minutos -> fração do dia (base do Excel para horas). */
export function minParaFracaoDia(min: number | null): number {
  return (min ?? 0) / 1440;
}

/** "HH:MM" -> fração do dia. */
export function horaParaFracaoDia(s: string | null | undefined): number {
  return minParaFracaoDia(parseHoraParaMin(s));
}

/** Minutos -> "H:MM" (com sinal para negativo). */
export function formatarMin(min: number): string {
  const sinal = min < 0 ? '-' : '';
  const a = Math.abs(min);
  return `${sinal}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}
