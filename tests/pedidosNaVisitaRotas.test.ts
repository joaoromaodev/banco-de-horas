// Quem dispara a abertura dos pedidos mensais na visita (Sprint 14): a contadora no
// GET /api/painel e o cliente no GET /api/inicio-cliente — sempre o escritório DA
// SESSÃO, antes de ler os pedidos abertos. O master não dispara (não tem escritório).
// A falha da abertura nunca derruba a tela.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Sessao } from '@/lib/auth';

const exp = Date.now() + 3_600_000;
const S: Record<string, Sessao> = {
  contador: { email: 'x@a.com', nome: 'X', role: 'usuario', escritorioId: 'esc-a', modulos: [], exp } as Sessao,
  master: { email: 'm@x.com', nome: 'M', role: 'master', exp },
  cliente: { email: 'c@a1.com', nome: 'A1', role: 'cliente', escritorioId: 'esc-a', empresa: 'emp-a1', exp },
};
let sessao: Sessao | null = null;
const ordem: string[] = [];

const visita = vi.hoisted(() => ({
  abrirPedidosNaVisita: vi.fn(async (_esc: string, _hoje?: string) => ({ situacao: 'ja_aberta' as const, competencia: '2026-11' })),
  agendarFaxinaOportunista: vi.fn(() => true),
}));
vi.mock('@/lib/pedidosNaVisita', () => ({
  abrirPedidosNaVisita: async (esc: string, hoje?: string) => { ordem.push(`abrir:${esc}`); return visita.abrirPedidosNaVisita(esc, hoje); },
  agendarFaxinaOportunista: visita.agendarFaxinaOportunista,
}));
vi.mock('@/lib/acesso', () => ({
  sessaoDe: async () => sessao,
  exigirGestor: async () => (sessao && sessao.role !== 'cliente'
    ? { ok: true as const, sessao }
    : { ok: false as const, resposta: Response.json({ erro: 'Acesso restrito.' }, { status: 403 }) }),
  exigirEmpresa: async (_r: unknown, id: string) => (id === sessao?.empresa
    ? { ok: true as const, sessao }
    : { ok: false as const, resposta: Response.json({ erro: 'Acesso restrito.' }, { status: 403 }) }),
  empresasVisiveis: async () => [{ id: 'emp-a1', nome: 'Padaria', escritorioId: 'esc-a' }],
}));
vi.mock('@/lib/cadastro', () => ({ lerEmpresa: async () => ({ id: 'emp-a1', nome: 'Padaria', escritorioId: 'esc-a' }) }));
vi.mock('@/lib/agendaServidor', () => ({ listarObrigacoes: async () => [], listarConclusoes: async () => [] }));
vi.mock('@/lib/contratosServidor', () => ({ listarEmExperiencia: async () => [] }));
vi.mock('@/lib/painelServidor', () => ({
  documentosAConferir: async () => ({ linhas: [], truncado: false }),
  lancamentosAConferir: async () => ({ linhas: [], truncado: false }),
  pendenciasComPrazo: async () => { ordem.push('ler:pendencias'); return []; },
}));
vi.mock('@/lib/inicioClienteServidor', () => ({
  lerMovimento: async () => [],
  lerPendenciasAbertas: async () => { ordem.push('ler:pendencias'); return []; },
  lerFolhasDevolvidas: async () => [],
  lerUltimoDemonstrativo: async () => null,
}));

const painel = await import('@/app/api/painel/route');
const inicio = await import('@/app/api/inicio-cliente/route');
const getPainel = () => painel.GET(new NextRequest('http://localhost/api/painel'));
const getInicio = () => inicio.GET(new NextRequest('http://localhost/api/inicio-cliente'));

describe('abertura dos pedidos mensais na visita', () => {
  beforeEach(() => { sessao = null; ordem.length = 0; vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

  it('contadora no painel: abre o escritório da sessão antes de ler as pendências e agenda a faxina', async () => {
    sessao = S.contador;
    expect((await getPainel()).status).toBe(200);
    expect(visita.abrirPedidosNaVisita).toHaveBeenCalledTimes(1);
    expect(visita.abrirPedidosNaVisita.mock.calls[0][0]).toBe('esc-a');
    expect(ordem.indexOf('abrir:esc-a')).toBeLessThan(ordem.indexOf('ler:pendencias'));
    expect(visita.agendarFaxinaOportunista).toHaveBeenCalledTimes(1);
  });

  it('master no painel: não abre nada (não tem escritório) nem faz faxina', async () => {
    sessao = S.master;
    expect((await getPainel()).status).toBe(200);
    expect(visita.abrirPedidosNaVisita).not.toHaveBeenCalled();
    expect(visita.agendarFaxinaOportunista).not.toHaveBeenCalled();
  });

  it('cliente no início: abre o escritório DA SESSÃO antes de ler os pedidos dele', async () => {
    sessao = S.cliente;
    expect((await getInicio()).status).toBe(200);
    expect(visita.abrirPedidosNaVisita.mock.calls.map((c) => c[0])).toEqual(['esc-a']);
    expect(ordem).toEqual(['abrir:esc-a', 'ler:pendencias']);
  });

  it('sem permissão, nada é aberto', async () => {
    sessao = S.cliente;
    expect((await getPainel()).status).toBe(403);
    sessao = null;
    expect((await getInicio()).status).toBe(401);
    expect(visita.abrirPedidosNaVisita).not.toHaveBeenCalled();
  });

  it('a abertura que falha não derruba a tela', async () => {
    sessao = S.cliente;
    visita.abrirPedidosNaVisita.mockResolvedValueOnce({ situacao: 'falhou' } as never);
    expect((await getInicio()).status).toBe(200);
  });
});
