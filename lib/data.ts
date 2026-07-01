// Formatação de datas em pt-BR (DD/MM/YYYY).

export function dataBR(d: Date = new Date()): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** "AAAA-MM-DD[...]" -> "DD/MM/YYYY". */
export function isoParaBR(iso: string): string {
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
