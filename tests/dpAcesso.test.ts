// Departamento Pessoal: o proxy deixa só a contabilidade com o módulo ponto chegar a /dp e /api/dp.
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { criarSessao, COOKIE_SESSAO, type Sessao } from '@/lib/auth';

vi.mock('@/lib/cobrancaServidor', () => ({ situacaoDoEscritorio: vi.fn(async () => null) }));
const { proxy } = await import('@/proxy');

async function ir(caminho: string, s?: Omit<Sessao, 'exp'>) {
  const headers: Record<string, string> = {};
  if (s) headers.cookie = `${COOKIE_SESSAO}=${await criarSessao(s)}`;
  return proxy(new NextRequest(new URL(caminho, 'http://localhost'), { headers }));
}
const destino = (r: Response) => (r.headers.get('location') ? new URL(r.headers.get('location')!).pathname : null);

const base = { email: 'c@x.com', nome: 'C', escritorioId: 'esc' };
const contador = (modulos: ('ponto' | 'caixa')[]): Omit<Sessao, 'exp'> => ({ ...base, role: 'usuario', modulos });
const cliente: Omit<Sessao, 'exp'> = { ...base, role: 'cliente', empresa: 'emp', modulos: ['caixa'] };

describe('acesso ao Departamento Pessoal', () => {
  it('contador com o módulo ponto passa', async () => {
    expect((await ir('/dp', contador(['ponto']))).status).toBe(200);
    expect((await ir('/api/dp?empresa=x', contador(['ponto']))).status).toBe(200);
  });
  it('cliente (empresa) é barrado na tela e na API', async () => {
    expect(destino(await ir('/dp', cliente))).toBe('/caixa');
    expect((await ir('/api/dp?empresa=emp', cliente)).status).toBe(403);
    expect((await ir('/api/dp/documento?ferias=x&doc=aviso', cliente)).status).toBe(403);
  });
  it('contador só-caixa não alcança', async () => {
    expect((await ir('/api/dp/empregado?id=x', contador(['caixa']))).status).toBe(403);
    expect(destino(await ir('/dp', contador(['caixa'])))).toBe('/caixa');
  });
  it('sem sessão: 401 na API, login na tela', async () => {
    expect((await ir('/api/dp/ferias')).status).toBe(401);
    expect(destino(await ir('/dp'))).toBe('/login');
  });
});
