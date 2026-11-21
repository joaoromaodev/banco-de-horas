// Página inicial por papel e rotas do ponto, passando pelo proxy.ts de verdade.
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { criarSessao, COOKIE_SESSAO, type Sessao } from '@/lib/auth';
import { inicioDoPapel } from '@/lib/inicio';

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
const master: Omit<Sessao, 'exp'> = { email: 'm@x.com', nome: 'M', role: 'master', modulos: ['ponto', 'caixa'] };
const cliente: Omit<Sessao, 'exp'> = { ...base, role: 'cliente', empresa: 'emp', modulos: ['caixa'] };

describe('início por papel', () => {
  it('inicioDoPapel', () => {
    expect(inicioDoPapel('usuario')).toBe('/painel');
    expect(inicioDoPapel('master')).toBe('/painel');
    expect(inicioDoPapel('cliente')).toBe('/caixa');
  });

  it('"/" leva contador e master ao painel e o cliente ao caixa', async () => {
    expect(destino(await ir('/', contador(['ponto'])))).toBe('/painel');
    expect(destino(await ir('/', master))).toBe('/painel');
    expect(destino(await ir('/', cliente))).toBe('/caixa');
  });

  it('"/" sem sessão continua indo ao site público', async () => {
    expect(destino(await ir('/'))).toBe('/conheca');
  });

  it('a Timesheet está em /ponto: contador com módulo passa; cliente é barrado', async () => {
    expect((await ir('/ponto', contador(['ponto']))).status).toBe(200);
    expect((await ir('/ponto', master)).status).toBe(200);
    expect(destino(await ir('/ponto', cliente))).toBe('/caixa');
  });

  it('contador só-caixa não alcança /ponto nem /ponto-cadastros e cai no caixa', async () => {
    expect(destino(await ir('/ponto', contador(['caixa'])))).toBe('/caixa');
    expect(destino(await ir('/ponto-cadastros', contador(['caixa'])))).toBe('/caixa');
  });

  it('contador sem nenhum módulo é mandado ao painel, não ao ponto', async () => {
    expect(destino(await ir('/ponto', contador([])))).toBe('/painel');
  });

  it('painel e agenda seguem livres de módulo; /ponto sem sessão pede login', async () => {
    expect((await ir('/painel', contador([]))).status).toBe(200);
    const r = await ir('/ponto');
    expect(destino(r)).toBe('/login');
  });

  it('área do master: contador comum volta ao painel', async () => {
    expect(destino(await ir('/configuracoes', contador(['ponto'])))).toBe('/painel');
  });
});
