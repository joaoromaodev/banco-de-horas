// Banco falso com a mesma regra do PostgREST que importa para o desempenho:
// **corta a resposta em `maxRows` linhas sem avisar** (o `max_rows` do Supabase).
// Suporta o suficiente do builder para as leituras de lib/: select, eq, neq, in,
// is, not, lt, lte, gte, order, range, limit, maybeSingle/single e count/head.
// Não é um Postgres: é só a prova de que a paginação não perde linha.
type Linha = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- o builder real devolve `any`
type Resposta = { data: any; error: null; count?: number };

export interface BancoFalso {
  from(tabela: string): ConsultaFalsa;
  /** Quantas consultas chegaram (para provar "uma ida só" e "N páginas"). */
  consultas: { tabela: string; de?: number; ate?: number }[];
}

class ConsultaFalsa implements PromiseLike<Resposta> {
  private filtros: ((l: Linha) => boolean)[] = [];
  private ordens: { col: string; asc: boolean }[] = [];
  private faixa: [number, number] | null = null;
  private teto: number | null = null;
  private unica: 'maybe' | 'single' | null = null;
  private contar = false;
  private somenteContagem = false;

  constructor(private banco: BancoFalso, private tabela: string, private linhas: Linha[], private maxRows: number) {}

  select(_cols?: string, op?: { count?: string; head?: boolean }) {
    if (op?.count) this.contar = true;
    if (op?.head) this.somenteContagem = true;
    return this;
  }
  eq(c: string, v: unknown) { this.filtros.push((l) => l[c] === v); return this; }
  neq(c: string, v: unknown) { this.filtros.push((l) => l[c] !== v); return this; }
  in(c: string, vs: unknown[]) { this.filtros.push((l) => vs.includes(l[c])); return this; }
  is(c: string, v: null) { this.filtros.push((l) => (l[c] ?? null) === v); return this; }
  not(c: string, _op: string, v: null) { this.filtros.push((l) => (l[c] ?? null) !== v); return this; }
  lt(c: string, v: number) { this.filtros.push((l) => Number(l[c]) < v); return this; }
  lte(c: string, v: string | number) { this.filtros.push((l) => String(l[c]) <= String(v)); return this; }
  gte(c: string, v: string | number) { this.filtros.push((l) => String(l[c]) >= String(v)); return this; }
  order(col: string, op?: { ascending?: boolean }) { this.ordens.push({ col, asc: op?.ascending !== false }); return this; }
  range(de: number, ate: number) { this.faixa = [de, ate]; return this; }
  limit(n: number) { this.teto = n; return this; }
  maybeSingle() { this.unica = 'maybe'; return this; }
  single() { this.unica = 'single'; return this; }

  private executar() {
    let r = this.linhas.filter((l) => this.filtros.every((f) => f(l)));
    for (const { col, asc } of [...this.ordens].reverse()) {
      r = [...r].sort((a, b) => {
        const x = a[col] as string | number, y = b[col] as string | number;
        return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
      });
    }
    const total = r.length;
    if (this.faixa) r = r.slice(this.faixa[0], this.faixa[1] + 1);
    if (this.teto !== null) r = r.slice(0, this.teto);
    r = r.slice(0, this.maxRows); // o corte silencioso
    this.banco.consultas.push({ tabela: this.tabela, de: this.faixa?.[0], ate: this.faixa?.[1] });
    if (this.somenteContagem) return { data: null, error: null, count: total };
    if (this.unica) return { data: r[0] ?? null, error: null };
    return { data: r, error: null, ...(this.contar ? { count: total } : {}) };
  }

  then<A, B>(ok?: ((v: Resposta) => A | PromiseLike<A>) | null,
    no?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.executar()).then(ok, no);
  }
}

export function bancoFalso(tabelas: Record<string, Linha[]>, maxRows = 1000): BancoFalso {
  const b: BancoFalso = {
    consultas: [],
    from: (t) => new ConsultaFalsa(b, t, tabelas[t] ?? [], maxRows),
  };
  return b;
}
