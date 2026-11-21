// Rotas da edição em lote do DP: isolamento entre escritórios, cliente, empresa arquivada,
// validação refeita no servidor, "nunca apaga" e desfazer. Banco simulado (como dpRotas).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Sessao } from '@/lib/auth';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID_ARQ = '33333333-3333-4333-8333-333333333333';

const exp = Date.now() + 3_600_000;
const SESSOES: Record<string, Sessao> = {
  contadorA: { email: 'c@a.com', nome: 'A', role: 'usuario', escritorioId: A, modulos: ['ponto'], exp },
  contadorB: { email: 'c@b.com', nome: 'B', role: 'usuario', escritorioId: B, modulos: ['ponto'], exp },
  clienteA: { email: 'cli@a.com', nome: 'CA', role: 'cliente', escritorioId: A, empresa: 'emp-a', modulos: ['caixa'], exp },
};
let sessaoAtual: Sessao | null = null;

const EMPRESAS = [
  { id: 'emp-a', nome: 'A', escritorioId: A, trabalhaSabado: false, arquivadaEm: null as string | null },
  { id: 'emp-b', nome: 'B', escritorioId: B, trabalhaSabado: false, arquivadaEm: null as string | null },
  { id: 'emp-arq', nome: 'Arq', escritorioId: A, trabalhaSabado: false, arquivadaEm: '2026-11-01T00:00:00Z' as string | null },
];
vi.mock('@/lib/cadastro', () => ({
  lerEmpresa: async (id: string) => EMPRESAS.find((e) => e.id === id) ?? null,
  lerEmpresas: async () => EMPRESAS.filter((e) => !e.arquivadaEm),
  lerEmpresasComArquivadas: async () => EMPRESAS,
  buscarUsuario: async () => null,
}));
vi.mock('@/lib/cobrancaServidor', () => ({ situacaoDoEscritorio: vi.fn(async () => null) }));
vi.mock('@/lib/acesso', async (orig) => {
  const real = await orig<typeof import('@/lib/acesso')>();
  const negar = (msg: string, status: number) => ({ ok: false as const, resposta: Response.json({ erro: msg }, { status }) });
  return {
    ...real,
    exigirGestor: async (req: NextRequest) => {
      const s = sessaoAtual && !['GET', 'HEAD'].includes(req.method) ? { ...sessaoAtual, escrita: true } : sessaoAtual;
      if (!s) return negar('Não autenticado.', 401);
      if (s.role === 'cliente') return negar('Acesso restrito.', 403);
      return { ok: true as const, sessao: s };
    },
  };
});

type Emp = ReturnType<typeof empregado>;
const empregado = (id: string, empresaId: string, escritorioId: string, extra: Record<string, unknown> = {}) => ({
  id, escritorioId, empresaId, nome: `NOME ${id.slice(0, 2)}`, cpf: '52998224725', cargo: null as string | null, admissao: null as string | null,
  salarioBase: null as number | null, horasSemanais: null as number | null, escala: null as string | null, dsr: 0, bancoHoras: false,
  bancoHorasDesde: null as string | null, situacao: 'ativo', situacaoDesde: null, afastamentoTipo: null, aquisitivoBase: null,
  origem: 'manual', atualizadoEm: null, atualizadoPor: null, ...extra,
});
let BANCO: Record<string, Emp> = {};
const gravacoes: { id: string; valores: Record<string, unknown> }[] = [];

vi.mock('@/lib/dpServidor', async (orig) => {
  const real = await orig<typeof import('@/lib/dpServidor')>();
  return {
    ...real,
    listarEmpregados: async (esc: string | null, empresas?: string[]) =>
      Object.values(BANCO).filter((e) => (!esc || e.escritorioId === esc) && (!empresas || empresas.includes(e.empresaId))),
    atualizarCamposEmpregado: async (_esc: string, _emp: string, id: string, valores: Record<string, unknown>) => {
      gravacoes.push({ id, valores });
      Object.assign(BANCO[id], valores);
    },
  };
});

const lote = await import('@/app/api/dp/lote/route');

const req = (url: string, init?: { method?: string; body?: unknown }) => new NextRequest(new URL(url, 'http://localhost'), {
  method: init?.method ?? 'GET',
  ...(init?.body ? { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } } : {}),
});
const post = (body: unknown) => lote.POST(req('/api/dp/lote', { method: 'POST', body }));

beforeEach(() => {
  sessaoAtual = SESSOES.contadorA;
  gravacoes.length = 0;
  BANCO = {
    [ID1]: empregado(ID1, 'emp-a', A, { cargo: 'Caixa', salarioBase: 1500 }),
    [ID2]: empregado(ID2, 'emp-a', A),
    [ID_ARQ]: empregado(ID_ARQ, 'emp-arq', A),
  };
});

describe('acesso', () => {
  it('B não lê nem grava na empresa de A; cliente não entra; arquivada só consulta', async () => {
    sessaoAtual = SESSOES.contadorB;
    expect((await lote.GET(req('/api/dp/lote?empresa=emp-a'))).status).toBe(403);
    expect((await post({ empresa: 'emp-a', acao: 'aplicar', itens: [{ id: ID2, entrada: { cargo: 'X' } }] })).status).toBe(403);
    sessaoAtual = SESSOES.clienteA;
    expect((await lote.GET(req('/api/dp/lote?empresa=emp-a'))).status).toBe(403);
    sessaoAtual = SESSOES.contadorA;
    const r = await post({ empresa: 'emp-arq', acao: 'aplicar', itens: [{ id: ID_ARQ, entrada: { cargo: 'X' } }] });
    expect(r.status).toBe(409);
    expect(gravacoes).toEqual([]);
  });
  it('um id de outra empresa no corpo não é gravado (mesmo sendo da mesma conta)', async () => {
    const r = await (await post({ empresa: 'emp-a', acao: 'aplicar', itens: [{ id: ID_ARQ, entrada: { cargo: 'X' } }] })).json();
    expect(r.aplicados).toEqual([]);
    expect(r.falhas[0].erro).toMatch(/não encontrado/);
    expect(gravacoes).toEqual([]);
  });
  it('a grade não recebe CPF', async () => {
    const x = await (await lote.GET(req('/api/dp/lote?empresa=emp-a'))).json();
    expect(x.empregados).toHaveLength(2);
    expect(JSON.stringify(x)).not.toContain('52998224725');
    expect(x.empregados.find((e: { id: string }) => e.id === ID1).salarioBase).toBe(1500);
  });
});

describe('aplicar', () => {
  it('grava só o que mudou, só as colunas pedidas, e devolve antes/depois', async () => {
    const r = await (await post({ empresa: 'emp-a', acao: 'aplicar', itens: [
      { id: ID1, entrada: { admissao: '10/03/2025', cargo: 'Caixa', salarioBase: '1.620,00' } },
      { id: ID2, entrada: { cargo: '' } }, // vazio: não mexe
    ] })).json();
    expect(gravacoes).toEqual([{ id: ID1, valores: { admissao: '2025-03-10', salarioBase: 1620 } }]);
    expect(r.semMudanca).toBe(1);
    expect(r.aplicados[0].campos.salarioBase).toEqual({ antes: 1500, depois: 1620 });
    expect(r.aplicados[0].campos.admissao).toEqual({ antes: null, depois: '2025-03-10' });
  });
  it('o servidor valida de novo: linha com erro não grava e vira falha; as boas seguem', async () => {
    const r = await (await post({ empresa: 'emp-a', acao: 'aplicar', itens: [
      { id: ID1, entrada: { admissao: '99/99/2025' } },
      { id: ID2, entrada: { cargo: 'Aux' } },
    ] })).json();
    expect(r.falhas).toHaveLength(1);
    expect(r.aplicados.map((a: { id: string }) => a.id)).toEqual([ID2]);
  });
  it('limites e ações inválidas', async () => {
    expect((await post({ empresa: 'emp-a', acao: 'aplicar', itens: [] })).status).toBe(400);
    expect((await post({ empresa: 'emp-a', acao: 'apagar', itens: [{ id: ID1 }] })).status).toBe(400);
    const muitos = Array.from({ length: 301 }, () => ({ id: ID1, entrada: {} }));
    expect((await post({ empresa: 'emp-a', acao: 'aplicar', itens: muitos })).status).toBe(400);
  });
});

describe('desfazer', () => {
  it('volta ao valor de antes (inclusive vazio), mas respeita edição feita depois', async () => {
    const ap = await (await post({ empresa: 'emp-a', acao: 'aplicar', itens: [
      { id: ID1, entrada: { admissao: '10/03/2025', salarioBase: '1.620,00' } },
    ] })).json();
    BANCO[ID1].salarioBase = 1700; // alguém editou depois
    gravacoes.length = 0;
    const r = await (await post({ empresa: 'emp-a', acao: 'desfazer', itens: ap.aplicados.map((a: { id: string; campos: unknown }) => ({ id: a.id, campos: a.campos })) })).json();
    expect(r.revertidos).toBe(1);
    expect(r.ignorados).toEqual([{ nome: BANCO[ID1].nome, campos: ['salarioBase'] }]);
    expect(gravacoes).toEqual([{ id: ID1, valores: { admissao: null } }]);
    expect(BANCO[ID1].salarioBase).toBe(1700);
  });
  it('valor solto no "antes" é descartado (não vai para o banco)', async () => {
    BANCO[ID2].cargo = 'Novo';
    const r = await (await post({ empresa: 'emp-a', acao: 'desfazer', itens: [
      { id: ID2, campos: { salarioBase: { antes: { x: 1 }, depois: 1 }, escala: { antes: 'galáxia', depois: null } } },
    ] })).json();
    expect(r.revertidos).toBe(0);
    expect(gravacoes).toEqual([]);
  });
});
