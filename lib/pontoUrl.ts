// Timesheet (/ponto) na URL: `?empresa=<id>&ano=AAAA&mes=1..12`. Puro (sem I/O), para
// os links da conferência, do painel e da agenda abrirem direto na empresa e no mês.

/** Lê `ano` e `mes` da query; valor ausente ou fora da faixa vira `null`. */
export function anoMesDaUrl(search: string): { ano: number | null; mes: number | null } {
  const q = new URLSearchParams(search);
  const num = (k: string, min: number, max: number) => {
    const t = q.get(k)?.trim() ?? '';
    const n = /^\d+$/.test(t) ? Number(t) : NaN;
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  };
  return { ano: num('ano', 2000, 2100), mes: num('mes', 1, 12) };
}

/**
 * Mês em que a Timesheet abre (Sprint 18 · A): o da URL, quando vem; senão o mês de HOJE
 * em Belém (`hoje` = AAAA-MM-DD). Antes ficava fixo em junho/2026. Ano sem mês na URL →
 * mês de hoje naquele ano; mês sem ano → o ano de hoje.
 */
export function mesInicialPonto(search: string, hoje: string): { ano: number; mes: number } {
  const url = anoMesDaUrl(search);
  const a = Number(hoje.slice(0, 4));
  const m = Number(hoje.slice(5, 7));
  const anoHoje = Number.isInteger(a) && a >= 2000 && a <= 2100 ? a : 2026;
  const mesHoje = Number.isInteger(m) && m >= 1 && m <= 12 ? m : 1;
  return { ano: url.ano ?? anoHoje, mes: url.mes ?? mesHoje };
}

/** `href` atual com empresa, ano e mês gravados (mantém os demais parâmetros). */
export function urlDoPonto(href: string, empresa: string, ano: number, mes: number): string {
  const u = new URL(href);
  u.searchParams.set('empresa', empresa);
  if (Number.isInteger(ano) && ano >= 2000 && ano <= 2100) u.searchParams.set('ano', String(ano)); else u.searchParams.delete('ano');
  u.searchParams.set('mes', String(mes));
  return u.toString();
}

/** Link para a Timesheet (ano/mês opcionais). */
export function linkPonto(empresaId: string, ano?: number, mes?: number): string {
  const q = new URLSearchParams({ empresa: empresaId });
  if (ano && mes) { q.set('ano', String(ano)); q.set('mes', String(mes)); }
  return `/ponto?${q.toString()}`;
}
