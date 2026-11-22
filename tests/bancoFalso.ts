// Banco falso com a mesma regra do PostgREST que importa para o desempenho:
// **corta a resposta em `maxRows` linhas sem avisar** (o `max_rows` do Supabase).
// Suporta o suficiente do builder para as leituras de lib/: select, eq, neq, in,
// is, not, lt, lte, gte, order, range, limit, maybeSingle/single e count/head.
// Não é um Postgres: é só a prova de que a paginação não perde linha.
//
// Também grava (insert/update/delete/upsert), em memória, para os testes de fluxo
// de rota (`fluxosRotas.test.ts`): `opcoes.aoGravar` completa colunas geradas
// (ex.: `lancamentos.mes`), `opcoes.aoLer` simula joins e `opcoes.visoes` simula views.
type Linha = Record<string, unknown>;
type Tabelas = Record<string, Linha[]>;
export interface OpcoesBanco {
  /** Colunas que o banco preencheria (gerada, default): roda em todo insert/update. */
  aoGravar?: Record<string, (l: Linha) => void>;
  /** Linha como sai num select (ex.: com o join embutido). */
  aoLer?: Record<string, (l: Linha, tabelas: Tabelas) => Linha>;
  /** Views: recalculadas a cada consulta a partir das tabelas. */
  visoes?: Record<string, (tabelas: Tabelas) => Linha[]>;
}
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
  private operacao: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private carga: Linha[] = [];
  private conflito: string[] = [];
  private ignorarDuplicadas = false;
  private devolver = false;

  constructor(
    private banco: BancoFalso, private tabela: string, private linhas: Linha[], private maxRows: number,
    private tabelas: Tabelas = {}, private opcoes: OpcoesBanco = {},
  ) {}

  select(_cols?: string, op?: { count?: string; head?: boolean }) {
    if (op?.count) this.contar = true;
    if (op?.head) this.somenteContagem = true;
    if (this.operacao !== 'select') this.devolver = true;
    return this;
  }
  insert(v: Linha | Linha[]) { this.operacao = 'insert'; this.carga = Array.isArray(v) ? v : [v]; return this; }
  update(v: Linha) { this.operacao = 'update'; this.carga = [v]; return this; }
  delete() { this.operacao = 'delete'; return this; }
  upsert(v: Linha | Linha[], op?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this.operacao = 'upsert';
    this.carga = Array.isArray(v) ? v : [v];
    this.conflito = (op?.onConflict ?? 'id').split(',').map((c) => c.trim());
    this.ignorarDuplicadas = Boolean(op?.ignoreDuplicates);
    return this;
  }
  eq(c: string, v: unknown) { this.filtros.push((l) => l[c] === v); return this; }
  neq(c: string, v: unknown) { this.filtros.push((l) => l[c] !== v); return this; }
  in(c: string, vs: unknown[]) { this.filtros.push((l) => vs.includes(l[c])); return this; }
  is(c: string, v: null) { this.filtros.push((l) => (l[c] ?? null) === v); return this; }
  not(c: string, op: string, v: null | string) {
    // `.not('dia', 'in', '(1,2)')` (salvarFrequencia) e `.not('col', 'is', null)`.
    if (op === 'in' && typeof v === 'string') {
      const lista = v.replace(/^\(|\)$/g, '').split(',').map((x) => x.trim());
      this.filtros.push((l) => !lista.includes(String(l[c])));
    } else this.filtros.push((l) => (l[c] ?? null) !== v);
    return this;
  }
  /** `.or('col.is.null,col.eq.x')` (o filtro do catálogo por escritório) — só `is.null` e `eq`. */
  or(expr: string) {
    const alts = expr.split(',').map((p) => {
      const [c, op, ...resto] = p.trim().split('.');
      const v = resto.join('.');
      return (l: Linha) => (op === 'is' && v === 'null' ? (l[c] ?? null) === null : op === 'eq' ? String(l[c]) === v : false);
    });
    this.filtros.push((l) => alts.some((f) => f(l)));
    return this;
  }
  lt(c: string, v: number) { this.filtros.push((l) => Number(l[c]) < v); return this; }
  lte(c: string, v: string | number) { this.filtros.push((l) => String(l[c]) <= String(v)); return this; }
  gte(c: string, v: string | number) { this.filtros.push((l) => String(l[c]) >= String(v)); return this; }
  order(col: string, op?: { ascending?: boolean }) { this.ordens.push({ col, asc: op?.ascending !== false }); return this; }
  range(de: number, ate: number) { this.faixa = [de, ate]; return this; }
  limit(n: number) { this.teto = n; return this; }
  abortSignal() { return this; }
  maybeSingle() { this.unica = 'maybe'; return this; }
  single() { this.unica = 'single'; return this; }

  private gravar(l: Linha): Linha {
    this.opcoes.aoGravar?.[this.tabela]?.(l);
    return l;
  }

  private mutar(): Resposta {
    this.banco.consultas.push({ tabela: this.tabela });
    const afetadas: Linha[] = [];
    if (this.operacao === 'insert' || this.operacao === 'upsert') {
      for (const nova of this.carga) {
        const existente = this.operacao === 'upsert'
          ? this.linhas.find((l) => this.conflito.every((c) => l[c] === nova[c])) : undefined;
        if (existente) {
          if (!this.ignorarDuplicadas) afetadas.push(this.gravar(Object.assign(existente, nova)));
          continue;
        }
        const l = this.gravar({ id: crypto.randomUUID(), criado_em: new Date().toISOString(), ...nova });
        this.linhas.push(l);
        afetadas.push(l);
      }
    } else {
      const alvo = this.linhas.filter((l) => this.filtros.every((f) => f(l)));
      if (this.operacao === 'update') for (const l of alvo) afetadas.push(this.gravar(Object.assign(l, this.carga[0])));
      else for (const l of alvo) { this.linhas.splice(this.linhas.indexOf(l), 1); afetadas.push(l); }
    }
    if (!this.devolver) return { data: null, error: null };
    const copia = afetadas.map((l) => ({ ...l }));
    return { data: this.unica ? copia[0] ?? null : copia, error: null };
  }

  private executar() {
    if (this.operacao !== 'select') return this.mutar();
    const visao = this.opcoes.visoes?.[this.tabela];
    const aoLer = this.opcoes.aoLer?.[this.tabela];
    const fonte = visao ? visao(this.tabelas) : this.linhas;
    let r = (aoLer ? fonte.map((l) => aoLer(l, this.tabelas)) : fonte).filter((l) => this.filtros.every((f) => f(l)));
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

export function bancoFalso(tabelas: Tabelas, maxRows = 1000, opcoes: OpcoesBanco = {}): BancoFalso {
  const b: BancoFalso = {
    consultas: [],
    from: (t) => new ConsultaFalsa(b, t, (tabelas[t] ??= []), maxRows, tabelas, opcoes),
  };
  return b;
}
