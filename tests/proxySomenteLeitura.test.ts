// O modo somente leitura passa pelo proxy.ts de verdade; só a leitura da
// situação no banco é simulada.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { criarSessao, COOKIE_SESSAO, type Sessao } from '@/lib/auth';
import type { Situacao } from '@/lib/cobranca';

const situacoes = new Map<string, Situacao | null>();
vi.mock('@/lib/cobrancaServidor', () => ({
  situacaoDoEscritorio: vi.fn(async (id: string) => situacoes.get(id) ?? null),
}));

const { proxy } = await import('@/proxy');

const BLOQ = 'esc-bloqueado';
const LIVRE = 'esc-livre';

beforeEach(() => {
  situacoes.clear();
  situacoes.set(BLOQ, { somenteLeitura: true, motivo: 'teste_vencido' });
  situacoes.set(LIVRE, { somenteLeitura: false, motivo: 'assinante' });
});

async function chamar(metodo: string, caminho: string, s: Omit<Sessao, 'exp'>) {
  const token = await criarSessao(s);
  const req = new NextRequest(new URL(caminho, 'http://localhost'), {
    method: metodo, headers: { cookie: `${COOKIE_SESSAO}=${token}` },
  });
  return proxy(req);
}

const contador = (escritorioId: string): Omit<Sessao, 'exp'> =>
  ({ email: 'c@x.com', nome: 'C', role: 'usuario', escritorioId, adminEscritorio: true, modulos: ['caixa', 'ponto'] });
const cliente = (escritorioId: string): Omit<Sessao, 'exp'> =>
  ({ email: 'e@x.com', nome: 'E', role: 'cliente', empresa: 'emp', escritorioId, modulos: ['caixa'] });

describe('proxy — somente leitura', () => {
  it('contador de escritório bloqueado: escrita → 402 com mensagem', async () => {
    const r = await chamar('POST', '/api/caixa/lancamentos', contador(BLOQ));
    expect(r.status).toBe(402);
    const d = await r.json();
    expect(d.codigo).toBe('somente_leitura');
    expect(d.erro).toMatch(/somente leitura/);
  });

  it('cliente (empresa) do escritório bloqueado também leva 402', async () => {
    for (const m of ['POST', 'PATCH', 'DELETE']) {
      const r = await chamar(m, '/api/caixa/lancamentos', cliente(BLOQ));
      expect(r.status).toBe(402);
      expect((await r.json()).erro).toMatch(/contabilidade/);
    }
  });

  it('leitura e exportação seguem livres', async () => {
    expect((await chamar('GET', '/api/caixa/lancamentos', contador(BLOQ))).status).toBe(200);
    expect((await chamar('POST', '/api/gerar', contador(BLOQ))).status).toBe(200);
    expect((await chamar('GET', '/api/caixa/livro', cliente(BLOQ))).status).toBe(200);
  });

  it('cobrança, logout e login ficam livres', async () => {
    expect((await chamar('POST', '/api/cobranca', contador(BLOQ))).status).toBe(200);
    expect((await chamar('POST', '/api/logout', cliente(BLOQ))).status).toBe(200);
    expect((await chamar('POST', '/api/login', cliente(BLOQ))).status).toBe(200);
  });

  it('escritório liberado e master não são barrados', async () => {
    expect((await chamar('POST', '/api/caixa/lancamentos', contador(LIVRE))).status).toBe(200);
    expect((await chamar('DELETE', '/api/usuarios', { email: 'm@x.com', nome: 'M', role: 'master' })).status).toBe(200);
  });

  it('o cliente continua sem alcançar a cobrança (lista de permissão)', async () => {
    expect((await chamar('POST', '/api/cobranca', cliente(LIVRE))).status).toBe(403);
  });

  it('webhook é público (protegido pelo token na própria rota)', async () => {
    const req = new NextRequest(new URL('/api/cobranca/webhook', 'http://localhost'), { method: 'POST' });
    expect((await proxy(req)).status).toBe(200);
  });
});
