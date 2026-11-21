// Pedidos mensais abertos na primeira visita do mês (lib/pedidosNaVisita) — Sprint 14.
// O banco é simulado em memória, com a regra que importa: o índice único
// (modelo_id, competencia) da 0018 devolve 23505 no segundo insert. Cada ida ao banco
// cede a vez (setTimeout 0), para as visitas simultâneas se intercalarem de verdade.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Linha = Record<string, unknown>;
const estado = vi.hoisted(() => ({
  tabelas: {} as Record<string, Linha[]>,
  semColuna: false,
  consultas: [] as string[],
  falharInsert: false,
  quebrado: false,
}));

vi.mock('@/lib/db', async (orig) => {
  const real = await orig<typeof import('@/lib/db')>();
  const ceder = () => new Promise((r) => setTimeout(r, 0));
  class Consulta {
    private filtros: ((l: Linha) => boolean)[] = [];
    private op: 'select' | 'update' | 'insert' = 'select';
    private dados: Linha | null = null;
    private unica = false;
    private faixa: [number, number] | null = null;
    constructor(private tabela: string) {}
    select(cols?: string) {
      if (estado.semColuna && this.tabela === 'escritorios' && cols?.includes('pedidos_competencia_aberta')) {
        this.erro = { code: '42703', message: 'column escritorios.pedidos_competencia_aberta does not exist' };
      }
      return this;
    }
    erro: { code: string; message: string } | null = null;
    eq(c: string, v: unknown) { this.filtros.push((l) => l[c] === v); return this; }
    is(c: string, v: null) { this.filtros.push((l) => (l[c] ?? null) === v); return this; }
    in(c: string, vs: unknown[]) { this.filtros.push((l) => vs.includes(l[c])); return this; }
    or(expr: string) {
      // só o formato usado pela marca: "col.is.null,col.lt.VALOR"
      const m = expr.match(/^(\w+)\.is\.null,\1\.lt\.(.+)$/);
      if (m) this.filtros.push((l) => l[m[1]] == null || String(l[m[1]]) < m[2]);
      return this;
    }
    order() { return this; }
    range(de: number, ate: number) { this.faixa = [de, ate]; return this; }
    maybeSingle() { this.unica = true; return this; }
    update(d: Linha) {
      this.op = 'update'; this.dados = d;
      if (estado.semColuna && 'pedidos_competencia_aberta' in d) this.erro = { code: 'PGRST204', message: "Could not find the 'pedidos_competencia_aberta' column" };
      return this;
    }
    insert(d: Linha) { this.op = 'insert'; this.dados = d; return this; }
    private async executar() {
      await ceder();
      if (estado.quebrado) throw new Error('fetch failed');
      estado.consultas.push(`${this.op}:${this.tabela}`);
      if (this.erro) return { data: null, error: this.erro };
      const t = (estado.tabelas[this.tabela] ??= []);
      if (this.op === 'insert') {
        if (estado.falharInsert) return { data: null, error: { code: '57014', message: 'timeout' } };
        const d = this.dados!;
        if (this.tabela === 'pendencias' && d.modelo_id && t.some((l) => l.modelo_id === d.modelo_id && l.competencia === d.competencia)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "pendencias_modelo_competencia_uniq"' } };
        }
        t.push({ id: `p${t.length + 1}`, ...d });
        return { data: null, error: null };
      }
      const alvo = t.filter((l) => this.filtros.every((f) => f(l)));
      if (this.op === 'update') { for (const l of alvo) Object.assign(l, this.dados); return { data: null, error: null }; }
      if (this.unica) return { data: alvo[0] ?? null, error: null };
      return { data: this.faixa ? alvo.slice(this.faixa[0], this.faixa[1] + 1) : alvo, error: null };
    }
    then<A, B>(ok?: ((v: unknown) => A | PromiseLike<A>) | null, no?: ((e: unknown) => B | PromiseLike<B>) | null) {
      return this.executar().then(ok, no);
    }
  }
  return { ...real, getDb: () => ({ from: (t: string) => new Consulta(t) }) };
});

vi.mock('@/lib/cadastro', () => ({
  lerEmpresas: async () => [
    { id: 'emp-a1', nome: 'Padaria', trabalhaSabado: false, escritorioId: 'esc-a' },
    { id: 'emp-a2', nome: 'Oficina', trabalhaSabado: false, escritorioId: 'esc-a' },
    { id: 'emp-b1', nome: 'Outro', trabalhaSabado: false, escritorioId: 'esc-b' },
  ],
}));
const faxina = vi.hoisted(() => ({ chamadas: [] as number[] }));
vi.mock('@/lib/envioPontoServidor', () => ({
  expurgarFotos: async (_agora: Date, lote: number) => { faxina.chamadas.push(lote); return { apagadas: 0 }; },
}));

const HOJE = '2026-12-01';
const modeloLinha = (id: string, empresa: string, escritorio: string, extra: Linha = {}) => ({
  id, empresa_id: empresa, escritorio_id: escritorio, titulo: `Pedido ${id}`, descricao: null, categoria: 'extrato',
  dia_prazo: 10, ativa: true, criado_em: '2026-10-15T12:00:00.000Z', excluido_em: null, ...extra,
});

function semear() {
  estado.tabelas = {
    escritorios: [
      { id: 'esc-a', situacao: 'ativo', pedidos_competencia_aberta: '2026-10' },
      { id: 'esc-b', situacao: 'ativo', pedidos_competencia_aberta: null },
      { id: 'esc-s', situacao: 'suspenso', pedidos_competencia_aberta: null },
    ],
    pendencias_recorrentes: [
      modeloLinha('m1', 'emp-a1', 'esc-a'),
      modeloLinha('m2', 'emp-a2', 'esc-a'),
      modeloLinha('m3', 'emp-b1', 'esc-b'), // outro escritório: não abre na visita do A
      modeloLinha('m4', 'emp-a1', 'esc-a', { criado_em: '2026-12-01T10:00:00.000Z' }), // criado neste mês: só no próximo
      modeloLinha('m5', 'emp-arquivada', 'esc-a'), // empresa arquivada (fora de lerEmpresas)
    ],
    pendencias: [],
  };
  estado.consultas = [];
  estado.semColuna = false;
  estado.falharInsert = false;
  estado.quebrado = false;
}

const carregar = async () => {
  vi.resetModules(); // um "processo" novo: memória limpa, mesmo banco
  return import('@/lib/pedidosNaVisita');
};

describe('pedidos mensais na primeira visita do mês', () => {
  beforeEach(() => { semear(); faxina.chamadas = []; });

  it('abre os pedidos do escritório da visita (competência anterior) e marca o escritório', async () => {
    const m = await carregar();
    const r = await m.abrirPedidosDoEscritorio('esc-a', HOJE);
    expect(r).toMatchObject({ situacao: 'aberta', competencia: '2026-11', resultado: { abertas: 2, falhas: 0 } });
    const abertas = estado.tabelas.pendencias;
    expect(abertas.map((p) => p.modelo_id).sort()).toEqual(['m1', 'm2']);
    expect(abertas.every((p) => p.competencia === '2026-11' && p.prazo === '2026-12-10' && p.escritorio_id === 'esc-a')).toBe(true);
    expect(estado.tabelas.escritorios.find((e) => e.id === 'esc-a')?.pedidos_competencia_aberta).toBe('2026-11');
    // não toca no outro escritório
    expect(estado.tabelas.escritorios.find((e) => e.id === 'esc-b')?.pedidos_competencia_aberta).toBeNull();
  });

  it('a segunda visita do mês não consulta o banco (memória) e, num processo novo, só lê a marca', async () => {
    const m = await carregar();
    await m.abrirPedidosDoEscritorio('esc-a', HOJE);
    estado.consultas = [];
    expect(await m.abrirPedidosDoEscritorio('esc-a', '2026-12-15')).toEqual({ situacao: 'ja_aberta', competencia: '2026-11' });
    expect(estado.consultas).toEqual([]);

    const outro = await carregar();
    expect(await outro.abrirPedidosDoEscritorio('esc-a', '2026-12-20')).toEqual({ situacao: 'ja_aberta', competencia: '2026-11' });
    expect(estado.consultas).toEqual(['select:escritorios']);
    expect(estado.tabelas.pendencias).toHaveLength(2);
  });

  it('visitas simultâneas no mesmo processo compartilham uma abertura só', async () => {
    const m = await carregar();
    const rs = await Promise.all(Array.from({ length: 5 }, () => m.abrirPedidosDoEscritorio('esc-a', HOJE)));
    expect(rs.every((r) => r === rs[0])).toBe(true);
    expect(estado.tabelas.pendencias).toHaveLength(2);
    expect(estado.consultas.filter((c) => c === 'insert:pendencias')).toHaveLength(2);
  });

  it('visitas simultâneas em processos diferentes não duplicam: o índice único barra e conta como "já existia"', async () => {
    const [p1, p2, p3] = [await carregar(), await carregar(), await carregar()];
    const rs = await Promise.all([p1, p2, p3].map((m) => m.abrirPedidosDoEscritorio('esc-a', HOJE)));
    expect(estado.tabelas.pendencias).toHaveLength(2); // nunca 4 ou 6
    const somas = rs.map((r) => (r.situacao === 'aberta' ? r.resultado : null)).filter(Boolean);
    const abertas = somas.reduce((t, r) => t + r!.abertas, 0);
    expect(abertas).toBe(2);
    expect(somas.every((r) => r!.falhas === 0)).toBe(true);
    expect(estado.tabelas.escritorios.find((e) => e.id === 'esc-a')?.pedidos_competencia_aberta).toBe('2026-11');
  });

  it('com falha no insert não marca o escritório: a próxima visita tenta de novo', async () => {
    const m = await carregar();
    estado.falharInsert = true;
    const r = await m.abrirPedidosDoEscritorio('esc-a', HOJE);
    expect(r).toMatchObject({ situacao: 'aberta', resultado: { falhas: 2 } });
    expect(estado.tabelas.escritorios.find((e) => e.id === 'esc-a')?.pedidos_competencia_aberta).toBe('2026-10');
    estado.falharInsert = false;
    const r2 = await m.abrirPedidosDoEscritorio('esc-a', HOJE);
    expect(r2).toMatchObject({ situacao: 'aberta', resultado: { abertas: 2, falhas: 0 } });
  });

  it('escritório suspenso não abre nada', async () => {
    const m = await carregar();
    estado.tabelas.pendencias_recorrentes.push(modeloLinha('m9', 'emp-s', 'esc-s'));
    expect(await m.abrirPedidosDoEscritorio('esc-s', HOJE)).toEqual({ situacao: 'ignorada', motivo: 'escritorio_suspenso' });
    expect(estado.tabelas.pendencias).toHaveLength(0);
  });

  it('sem a migração 0030 (coluna ausente) abre do mesmo jeito e guarda só na memória', async () => {
    estado.semColuna = true;
    const m = await carregar();
    expect(await m.abrirPedidosDoEscritorio('esc-a', HOJE)).toMatchObject({ situacao: 'aberta', resultado: { abertas: 2 } });
    estado.consultas = [];
    expect(await m.abrirPedidosDoEscritorio('esc-a', HOJE)).toMatchObject({ situacao: 'ja_aberta' });
    expect(estado.consultas).toEqual([]);
    // processo novo sem a coluna: refaz a conferência, mas o índice único segura
    const outro = await carregar();
    expect(await outro.abrirPedidosDoEscritorio('esc-a', HOJE)).toMatchObject({ situacao: 'aberta', resultado: { abertas: 0, falhas: 0 } });
    expect(estado.tabelas.pendencias).toHaveLength(2);
  });

  it('abrirPedidosNaVisita nunca derruba a visita', async () => {
    const m = await carregar();
    estado.quebrado = true; // sem rede até o banco
    await expect(m.abrirPedidosNaVisita('esc-a', HOJE)).resolves.toEqual({ situacao: 'falhou' });
  });

  it('a marca só avança: o cron simulando um mês passado não a volta', async () => {
    const m = await carregar();
    await m.marcarCompetenciaAberta(['esc-a', 'esc-b'], '2026-09');
    expect(estado.tabelas.escritorios.find((e) => e.id === 'esc-a')?.pedidos_competencia_aberta).toBe('2026-10');
    expect(estado.tabelas.escritorios.find((e) => e.id === 'esc-b')?.pedidos_competencia_aberta).toBe('2026-09');
  });

  it('a faxina oportunista das fotos roda no máximo uma vez por dia por processo, com lote pequeno', async () => {
    const m = await carregar();
    expect(m.agendarFaxinaOportunista(HOJE)).toBe(true);
    expect(m.agendarFaxinaOportunista(HOJE)).toBe(false);
    expect(m.agendarFaxinaOportunista('2026-12-02')).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    expect(faxina.chamadas).toEqual([m.LOTE_FAXINA_VISITA, m.LOTE_FAXINA_VISITA]);
    expect(m.LOTE_FAXINA_VISITA).toBeLessThan(200);
  });
});
