// Contrato de /api/inicio-cliente: só o cliente, só a empresa da própria sessão,
// e cada fonte falha sozinha. Leituras simuladas; o que se testa é a decisão da rota.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Sessao } from '@/lib/auth';

const exp = Date.now() + 3_600_000;
const SESSOES: Record<string, Sessao> = {
  cliente: { email: 'c@a1.com', nome: 'A1', role: 'cliente', escritorioId: 'esc-a', empresa: 'emp-a1', exp },
  contador: { email: 'x@a.com', nome: 'X', role: 'usuario', escritorioId: 'esc-a', exp },
  semEscritorio: { email: 'c@o.com', nome: 'O', role: 'cliente', empresa: 'emp-a1', exp },
};
let sessaoAtual: Sessao | null = null;
const empresasPedidas: string[] = [];

vi.mock('@/lib/cadastro', () => ({ lerEmpresa: async () => ({ id: 'emp-a1', nome: 'Padaria Sol', escritorioId: 'esc-a' }) }));
vi.mock('@/lib/acesso', () => ({
  sessaoDe: async () => sessaoAtual,
  exigirEmpresa: async (_r: unknown, id: string) => {
    empresasPedidas.push(id);
    return id === sessaoAtual?.empresa ? { ok: true as const, sessao: sessaoAtual } : { ok: false as const, resposta: Response.json({ erro: 'Acesso restrito a esta empresa.' }, { status: 403 }) };
  },
}));
const io = {
  lerMovimento: vi.fn(async () => [{ ano: 2026, mes: 10, lancamentos: 5, confirmado: true }, { ano: 2026, mes: 11, lancamentos: 1, confirmado: false }]),
  lerPendenciasAbertas: vi.fn(async () => [{ id: 'p1', titulo: 'Extrato', prazo: null }]),
  lerFolhasDevolvidas: vi.fn(async () => []),
  lerUltimoDemonstrativo: vi.fn(async () => ({ ano: 2026, mes: 10 })),
};
vi.mock('@/lib/inicioClienteServidor', () => io);

const { GET } = await import('@/app/api/inicio-cliente/route');
const chamar = (qs = '') => GET(new NextRequest(`http://localhost/api/inicio-cliente${qs}`));

describe('GET /api/inicio-cliente', () => {
  beforeEach(() => { sessaoAtual = null; empresasPedidas.length = 0; vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

  it('sem sessão: 401; contabilidade e cliente sem escritório: 403', async () => {
    expect((await chamar()).status).toBe(401);
    sessaoAtual = SESSOES.contador;
    expect((await chamar()).status).toBe(403);
    sessaoAtual = SESSOES.semEscritorio;
    expect((await chamar()).status).toBe(403);
  });

  it('cliente: usa a empresa da sessão e ignora ?empresa= de outra', async () => {
    sessaoAtual = SESSOES.cliente;
    const r = await chamar('?empresa=emp-b1');
    expect(r.status).toBe(200);
    expect(empresasPedidas).toEqual(['emp-a1']);
    expect(io.lerPendenciasAbertas).toHaveBeenCalledWith('emp-a1', 'esc-a');
    const j = await r.json();
    expect(j.saudacao).toBe('Olá, Padaria Sol');
    expect(j.blocos.map((b: { id: string }) => b.id)).toEqual(['pendencias', 'demonstrativo']);
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('uma fonte falhando vira "indisponiveis" e o resto responde 200', async () => {
    sessaoAtual = SESSOES.cliente;
    io.lerFolhasDevolvidas.mockRejectedValueOnce(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    const r = await chamar();
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.indisponiveis).toEqual(['folhas']);
    expect(j.blocos.length).toBeGreaterThan(0);
    expect(JSON.stringify(j)).not.toContain('42P01');
  });
});
