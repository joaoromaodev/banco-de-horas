// O código da Sprint 17 · Frente A pode chegar à produção ANTES da migração 0032. Aqui
// o banco falso se comporta como o Supabase sem ela: select com coluna nova → 42703,
// update com coluna nova → PGRST204, `devolvido` barrado pelo CHECK antigo (23514) e a
// tabela `entregas` inexistente (42P01). O que se garante:
//   - as telas de sempre seguem: listar documentos e pedidos, aceitar, reabrir;
//   - as ações novas respondem 503 "aplique a 0032", sem gravar nada;
//   - o sino e o /inicio do cliente não ficam "indisponíveis" por causa das entregas.
// Arquivo próprio: a leitura lembra por 5 min (em memória do módulo) que a 0032 falta.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bancoFalso, type BancoFalso } from './bancoFalso';
import { ESC_A, pedido } from './rotaTeste';

type Linha = Record<string, unknown>;
let tabelas: Record<string, Linha[]>;
let banco: { from: (t: string) => unknown };

vi.mock('@/lib/cadastro', async (orig) => {
  const { cadastroFalso, empresasTeste } = await import('./rotaTeste');
  const empresas = empresasTeste();
  return { ...(await orig<object>()), ...cadastroFalso(() => empresas) };
});
vi.mock('@/lib/db', async (orig) => ({ ...(await orig<object>()), getDb: () => banco }));
vi.mock('@/lib/envioPontoServidor', async (orig) => ({ ...(await orig<object>()), listarEnvios: async () => [] }));

const documentos = await import('@/app/api/documentos/route');
const pendencias = await import('@/app/api/pendencias/route');
const entregas = await import('@/app/api/entregas/route');
const notificacoes = await import('@/app/api/notificacoes/route');

const DOC = '11111111-1111-4111-8111-111111111111';
const PEND = '22222222-2222-4222-8222-222222222222';
const NOVAS = /devolvido_em|devolvido_por|motivo_devolucao|sem_movimento/;

/** Resposta de erro encadeável: qualquer método devolve ela mesma; `await` dá o erro. */
function falha(code: string) {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'gte', 'lte', 'lt', 'order', 'range', 'limit', 'maybeSingle', 'single', 'update', 'insert']) q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { code, message: `simulado ${code}` } }).then(ok);
  return q;
}

/** O banco falso de sempre, mas sem o que a 0032 cria. */
function semA0032(b: BancoFalso) {
  return {
    from(t: string) {
      if (t === 'entregas') return falha('42P01');
      const c = b.from(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
      const select = c.select.bind(c);
      const update = c.update.bind(c);
      c.select = (cols?: unknown, op?: unknown) => (typeof cols === 'string' && NOVAS.test(cols) ? falha('42703') : select(cols, op));
      c.update = (v: unknown) => {
        const chaves = Object.keys(v as object).join(',');
        if (NOVAS.test(chaves)) return falha('PGRST204');
        if ((v as { status?: string }).status === 'devolvido') return falha('23514');
        return update(v);
      };
      // `is('sem_movimento_em', …)` também é coluna nova
      const is = c.is.bind(c);
      c.is = (col: unknown, val: unknown) => (String(col).startsWith('sem_movimento') ? falha('42703') : is(col, val));
      return c;
    },
  };
}

beforeEach(() => {
  tabelas = {
    documentos: [{
      id: DOC, empresa_id: 'emp-a1', escritorio_id: ESC_A, competencia: '2026-10', categoria: 'extrato',
      caminho: `${ESC_A}/${DOC}.pdf`, nome_original: 'extrato.pdf', tamanho: 100, tipo: 'application/pdf',
      observacao: null, pendencia_id: PEND, status: 'recebido', enviado_por: 'cli@a1.com',
      enviado_em: '2026-11-05T12:00:00.000Z', excluido_em: null, excluido_por_gestor: false,
    }],
    pendencias: [{
      id: PEND, empresa_id: 'emp-a1', escritorio_id: ESC_A, titulo: 'Extrato de outubro', categoria: 'extrato',
      competencia: '2026-10', prazo: null, status: 'atendida', atendida_em: '2026-11-05T12:00:00.000Z', atendida_por: 'cli@a1.com',
      criado_por: 'c@a.com', criado_em: '2026-11-01T12:00:00.000Z', excluido_em: null,
    }],
  };
  banco = semA0032(bancoFalso(tabelas));
});

const estado = () => JSON.stringify(tabelas);

describe('antes da migração 0032', () => {
  it('as leituras de sempre seguem (caem para as colunas antigas)', async () => {
    const d = await documentos.GET(await pedido('clienteA1', '/api/documentos'));
    expect(d.status).toBe(200);
    expect((await d.json()).documentos.map((x: { id: string }) => x.id)).toEqual([DOC]);
    const p = await pendencias.GET(await pedido('contadorA', '/api/pendencias?empresa=emp-a1'));
    expect(p.status).toBe(200);
    expect((await p.json()).pendencias[0]).toMatchObject({ id: PEND, semMovimentoEm: null });
  });

  it('aceitar e reabrir funcionam; excluir o documento reabre o pedido como sempre', async () => {
    expect((await documentos.PATCH(await pedido('contadorA', '/api/documentos', { method: 'PATCH', body: { id: DOC, acao: 'conferir' } }))).status).toBe(200);
    expect(tabelas.documentos[0].status).toBe('conferido');
    expect((await documentos.DELETE(await pedido('contadorA', `/api/documentos?id=${DOC}`, { method: 'DELETE' }))).status).toBe(200);
    expect(tabelas.pendencias[0].status).toBe('aberta');
    expect((await pendencias.PATCH(await pedido('contadorA', '/api/pendencias', { method: 'PATCH', body: { id: PEND, acao: 'fechar' } }))).status).toBe(200);
    expect(tabelas.pendencias[0].status).toBe('atendida');
  });

  it('as ações novas respondem 503 "aplique a 0032" e não gravam nada', async () => {
    tabelas.pendencias[0].status = 'aberta';
    const antes = estado();
    const respostas = [
      await documentos.PATCH(await pedido('contadorA', '/api/documentos', { method: 'PATCH', body: { id: DOC, acao: 'devolver', motivo: 'Ilegível.' } })),
      await pendencias.PATCH(await pedido('clienteA1', '/api/pendencias', { method: 'PATCH', body: { id: PEND, acao: 'nao-tenho' } })),
      await entregas.GET(await pedido('contadorA', '/api/entregas?empresa=emp-a1')),
      await entregas.POST(await pedido('contadorA', '/api/entregas', {
        method: 'POST', body: { empresa: 'emp-a1', tipo: 'das', competencia: '2026-10', nome: 'das.pdf', tamanho: 10, mime: 'application/pdf' },
      })),
    ];
    for (const r of respostas) {
      expect(r.status).toBe(503);
      expect((await r.json()).erro).toMatch(/0032/);
    }
    expect(estado()).toBe(antes);
  });

  it('o sino do cliente não fica "indisponível" por causa das entregas', async () => {
    const r = await notificacoes.GET(await pedido('clienteA1', '/api/notificacoes'));
    expect(r.status).toBe(200);
    expect((await r.json()).indisponiveis).toEqual([]);
  });
});
