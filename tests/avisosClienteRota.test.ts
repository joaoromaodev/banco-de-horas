// Isolamento dos avisos ao cliente em /api/notificacoes. Usa as guardas REAIS de
// lib/acesso.ts + lib/visibilidade.ts; só sessão, cadastro e banco são simulados.
// O que se testa: o cliente só vê a empresa DA SESSÃO (ignora ?empresa= e corpo),
// outro escritório/empresa não passa, a contadora não recebe os avisos do cliente e a
// leitura do cliente é gravada numa chave própria.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Sessao } from '@/lib/auth';
import type { Empresa } from '@/lib/tipos';

const exp = Date.now() + 3_600_000;
const S: Record<string, Sessao> = {
  clienteA1: { email: 'c@a1.com', nome: 'A1', role: 'cliente', escritorioId: 'esc-a', empresa: 'emp-a1', exp },
  clienteA2: { email: 'c@a2.com', nome: 'A2', role: 'cliente', escritorioId: 'esc-a', empresa: 'emp-a2', exp },
  // login de cliente que diz ser do escritório B mas a empresa é do A: barrado
  clienteOutroEsc: { email: 'c@b.com', nome: 'B', role: 'cliente', escritorioId: 'esc-b', empresa: 'emp-a1', exp },
  clienteArquivada: { email: 'c@arq.com', nome: 'Arq', role: 'cliente', escritorioId: 'esc-a', empresa: 'emp-arq', exp },
  clienteSemEmpresa: { email: 'c@x.com', nome: 'X', role: 'cliente', escritorioId: 'esc-a', exp },
  contadorA: { email: 'x@a.com', nome: 'X', role: 'usuario', escritorioId: 'esc-a', exp },
  master: { email: 'm@x.com', nome: 'M', role: 'master', exp },
};
let sessao: Sessao | null = null;

const EMPRESAS: Empresa[] = [
  { id: 'emp-a1', nome: 'Padaria Sol', trabalhaSabado: false, escritorioId: 'esc-a' },
  { id: 'emp-a2', nome: 'Oficina Lua', trabalhaSabado: false, escritorioId: 'esc-a' },
  { id: 'emp-b1', nome: 'Outro escritório', trabalhaSabado: false, escritorioId: 'esc-b' },
  { id: 'emp-arq', nome: 'Arquivada', trabalhaSabado: false, escritorioId: 'esc-a', arquivadaEm: '2026-01-01T00:00:00.000Z' } as Empresa,
];

vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<typeof import('@/lib/auth')>()), lerSessao: async () => sessao }));
vi.mock('@/lib/cadastro', () => ({
  lerEmpresas: async () => EMPRESAS.filter((e) => !(e as { arquivadaEm?: string }).arquivadaEm),
  lerEmpresasComArquivadas: async () => EMPRESAS,
  lerEmpresa: async (id: string) => EMPRESAS.find((e) => e.id === id) ?? null,
  buscarUsuario: async () => null,
}));

const chamadas = { envios: [] as unknown[][], pendencias: [] as unknown[], exercicios: [] as string[], leitura: [] as string[], marcar: [] as unknown[][], contador: 0 };
vi.mock('@/lib/envioPontoServidor', () => ({
  listarEnvios: async (...a: unknown[]) => {
    chamadas.envios.push(a);
    return [{ id: 'f1', funcionario: 'MARIA DA SILVA', ano: 2026, mes: 10, situacao: 'devolvida', motivo: 'Foto cortada', devolvidoEm: new Date(Date.now() - 3_600_000).toISOString() }];
  },
}));
vi.mock('@/lib/entregasServidor', () => ({ listarEntregasOuNada: async () => [] }));
vi.mock('@/lib/documentosServidor', () => ({
  listarDocumentos: async () => [],
  listarPendencias: async (e: unknown) => {
    chamadas.pendencias.push(e);
    return [{ id: 'p1', titulo: 'Extrato de outubro', prazo: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10), status: 'aberta', criadoEm: new Date(Date.now() - 7_200_000).toISOString() }];
  },
}));
vi.mock('@/lib/notificacoesServidor', () => ({
  lerLeitura: async (_esc: string, usuario: string) => { chamadas.leitura.push(usuario); return { leitura: { lidasAte: '2020-01-01T00:00:00.000Z', lidas: [] }, persistido: true }; },
  marcarLidas: async (...a: unknown[]) => { chamadas.marcar.push(a); return true; },
  lerNotificacoes: async () => { chamadas.contador++; return { itens: [], naoLidas: 0, persistido: true, indisponiveis: [] }; },
}));
// Banco do demonstrativo: exercícios + meses confirmados (registra a empresa pedida).
vi.mock('@/lib/db', () => {
  const linhas = (tabela: string, filtros: Record<string, unknown>) => {
    if (tabela === 'exercicios') { chamadas.exercicios.push(String(filtros.empresa_id)); return [{ id: 'ex1', ano: new Date().getUTCFullYear() }]; }
    if (tabela === 'meses_confirmados') return [{ mes: 1, confirmado_em: new Date(Date.now() - 600_000).toISOString() }];
    return [];
  };
  const getDb = () => ({
    from: (tabela: string) => {
      const filtros: Record<string, unknown> = {};
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'order', 'limit', 'is', 'in', 'gte']) q[m] = () => q;
      q.eq = (c: string, v: unknown) => { filtros[c] = v; return q; };
      q.then = (ok: (v: unknown) => unknown) => ok({ data: linhas(tabela, filtros), error: null });
      return q;
    },
  });
  return { getDb };
});
vi.mock('@/lib/cobrancaServidor', () => ({ situacaoDoEscritorio: async () => null }));

const { GET, POST } = await import('@/app/api/notificacoes/route');
const get = (qs = '') => GET(new NextRequest(`http://localhost/api/notificacoes${qs}`));
const post = (body: unknown) => POST(new NextRequest('http://localhost/api/notificacoes', { method: 'POST', body: JSON.stringify(body) }));

describe('/api/notificacoes — avisos ao cliente', () => {
  beforeEach(() => {
    sessao = null;
    chamadas.envios.length = 0; chamadas.pendencias.length = 0; chamadas.exercicios.length = 0;
    chamadas.leitura.length = 0; chamadas.marcar.length = 0; chamadas.contador = 0;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('cliente: só a empresa da sessão (ignora ?empresa= de outra), os 3 avisos, sem nome de funcionário', async () => {
    sessao = S.clienteA1;
    const r = await get('?empresa=emp-b1');
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(chamadas.envios.map((a) => a.slice(0, 2))).toEqual([['esc-a', 'emp-a1']]);
    expect(chamadas.envios[0][2]).toMatchObject({ desde: expect.objectContaining({ ano: expect.any(Number) }) });
    expect(chamadas.pendencias).toEqual([{ empresaId: 'emp-a1', escritorioId: 'esc-a' }]);
    expect(chamadas.exercicios).toEqual(['emp-a1']);
    expect(chamadas.contador).toBe(0); // não monta o sino da contabilidade
    expect(j.itens.map((i: { tipo: string }) => i.tipo).sort()).toEqual(['demonstrativo', 'folha_devolvida', 'pedido']);
    expect(j.naoLidas).toBe(3);
    expect(JSON.stringify(j)).not.toMatch(/MARIA/i);
    expect(chamadas.leitura).toEqual(['cliente|emp-a1|c@a1.com']);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('cliente de outro escritório, de empresa arquivada ou sem empresa: 403 e nenhuma leitura', async () => {
    for (const s of [S.clienteOutroEsc, S.clienteArquivada, S.clienteSemEmpresa]) {
      sessao = s;
      expect((await get()).status).toBe(403);
      expect((await post({ acao: 'todas' })).status).toBe(403);
    }
    expect(chamadas.envios).toEqual([]);
    expect(chamadas.pendencias).toEqual([]);
    expect(chamadas.marcar).toEqual([]);
  });

  it('sem sessão: 401', async () => {
    expect((await get()).status).toBe(401);
    expect((await post({ acao: 'todas' })).status).toBe(401);
  });

  it('contadora: continua no sino dela e NÃO recebe os avisos do cliente', async () => {
    sessao = S.contadorA;
    const r = await get();
    expect(r.status).toBe(200);
    expect(chamadas.contador).toBe(1);
    expect(chamadas.envios).toEqual([]);
    expect(chamadas.exercicios).toEqual([]);
    expect((await r.json()).itens).toEqual([]);
  });

  it('master: sem escritório, sino indisponível e nada do cliente', async () => {
    sessao = S.master;
    const j = await (await get()).json();
    expect(j.disponivel).toBe(false);
    expect(chamadas.envios).toEqual([]);
  });

  it('cliente marca como lida na chave dele (empresa da sessão, nunca do corpo)', async () => {
    sessao = S.clienteA1;
    expect((await post({ acao: 'lida', chave: 'cli|pedido|p1', empresa: 'emp-b1' })).status).toBe(200);
    expect((await post({ acao: 'todas', empresa: 'emp-b1' })).status).toBe(200);
    expect(chamadas.marcar).toEqual([['esc-a', 'cliente|emp-a1|c@a1.com', 'cli|pedido|p1'], ['esc-a', 'cliente|emp-a1|c@a1.com']]);
  });

  it('outra empresa do MESMO escritório: cada cliente só lê e grava a própria empresa', async () => {
    sessao = S.clienteA2;
    expect((await get('?empresa=emp-a1')).status).toBe(200);
    expect(chamadas.envios.map((a) => a.slice(0, 2))).toEqual([['esc-a', 'emp-a2']]);
    expect(chamadas.pendencias).toEqual([{ empresaId: 'emp-a2', escritorioId: 'esc-a' }]);
    expect(chamadas.exercicios).toEqual(['emp-a2']);
    await post({ acao: 'todas', empresa: 'emp-a1' });
    expect(chamadas.marcar).toEqual([['esc-a', 'cliente|emp-a2|c@a2.com']]);
  });

  it('contadora: POST continua gravando a leitura pelo e-mail puro (sem a chave do cliente)', async () => {
    sessao = S.contadorA;
    expect((await post({ acao: 'lida', chave: 'doc|emp-a1|x' })).status).toBe(200);
    expect((await post({ acao: 'todas' })).status).toBe(200);
    expect(chamadas.marcar).toEqual([['esc-a', 'x@a.com', 'doc|emp-a1|x'], ['esc-a', 'x@a.com']]);
    sessao = S.master;
    expect((await post({ acao: 'todas' })).status).toBe(403);
  });

  it('uma fonte falhando vira "indisponiveis" e o resto responde', async () => {
    sessao = S.clienteA1;
    const mod = await import('@/lib/envioPontoServidor');
    vi.spyOn(mod, 'listarEnvios').mockRejectedValueOnce(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    const j = await (await get()).json();
    expect(j.indisponiveis).toEqual(['folhas de ponto']);
    expect(j.itens.length).toBe(2);
    expect(JSON.stringify(j)).not.toContain('42P01');
  });
});
