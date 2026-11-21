// Rotas da medição própria (Sprint 15, frente A), com as guardas REAIS de lib/acesso.ts:
//  - POST /api/medicao: qualquer sessão envia; grava só rota normalizada + papel
//    (o papel vem da sessão, não do corpo); nada de e-mail, escritório, query; 204 sempre;
//  - GET /api/config/medicao: só o master; sem a 0031 avisa `semTabela`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Sessao } from '@/lib/auth';
import { bancoFalso } from './bancoFalso';

const exp = Date.now() + 3_600_000;
const S: Record<string, Sessao> = {
  master: { email: 'm@x.com', nome: 'M', role: 'master', exp },
  contador: { email: 'ana.souza@escritorio.com.br', nome: 'Ana Souza', role: 'usuario', escritorioId: 'esc-a', adminEscritorio: true, exp },
  cliente: { email: 'e@a.com', nome: 'E', role: 'cliente', escritorioId: 'esc-a', empresa: 'emp-a1', exp },
};
let sessao: Sessao | null = null;
const db = vi.hoisted(() => ({ atual: null as unknown }));

vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<typeof import('@/lib/auth')>()), lerSessao: async () => sessao }));
vi.mock('@/lib/cadastro', () => ({ lerEmpresas: async () => [], lerEmpresasComArquivadas: async () => [], buscarUsuario: async () => null }));
vi.mock('@/lib/cobrancaServidor', () => ({ situacaoDoEscritorio: async () => null }));
vi.mock('@/lib/db', async (orig) => ({ ...(await orig<typeof import('@/lib/db')>()), getDb: () => db.atual }));

const { POST } = await import('@/app/api/medicao/route');
const { GET } = await import('@/app/api/config/medicao/route');
const { _reiniciarMedicao } = await import('@/lib/medicaoServidor');

const enviar = (corpo: unknown) => POST(new NextRequest('http://localhost/api/medicao', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
}));
/** A gravação roda depois da resposta (`after`); aqui, fora de um pedido, ela dispara sem esperar. */
const assentar = () => new Promise((r) => setTimeout(r, 10));

afterEach(() => { sessao = null; db.atual = null; _reiniciarMedicao(); });

describe('POST /api/medicao', () => {
  it('sem sessão → 401 e nada gravado', async () => {
    const tabelas: Record<string, Record<string, unknown>[]> = {};
    db.atual = bancoFalso(tabelas);
    const r = await enviar({ itens: [{ tipo: 'api', rota: '/api/dp', metodo: 'GET', status: 200, ms: 5, amostra: true }] });
    expect(r.status).toBe(401);
    await assentar();
    expect(tabelas.medicoes ?? []).toEqual([]);
  });

  it('grava só rota normalizada, papel da sessão e números — nada pessoal', async () => {
    const tabelas: Record<string, Record<string, unknown>[]> = {};
    db.atual = bancoFalso(tabelas);
    sessao = S.contador;
    const r = await enviar({
      papel: 'master', escritorio: 'esc-a', email: 'ana.souza@escritorio.com.br',
      itens: [
        { tipo: 'api', rota: '/api/dp?empresa=emp-a1&cpf=123.456.789-00', metodo: 'GET', status: 200, ms: 321, amostra: true, email: 'x@y.com' },
        { tipo: 'api', rota: '/api/usuarios/ana.souza@escritorio.com.br', metodo: 'DELETE', status: 500, ms: 80, amostra: false },
        { tipo: 'pagina', rota: '/caixa?mes=2026-11', metrica: 'LCP', ms: 1800, amostra: true },
        { tipo: 'pagina', rota: '/joao-da-silva', metrica: 'VISITA', amostra: true },
        { tipo: 'api', rota: '/api/me', metodo: 'GET', status: 200, ms: 5, amostra: false }, // fora da amostra e sem erro: descarta
        'lixo', null, { tipo: 'erro', rota: '/api/dp' },
      ],
    });
    expect(r.status).toBe(204);
    await assentar();
    const gravadas = tabelas.medicoes ?? [];
    expect(gravadas.map((l) => [l.tipo, l.rota, l.metodo ?? l.metrica, l.status, l.ms, l.papel])).toEqual([
      ['api', '/api/dp', 'GET', 200, 321, 'usuario'],
      ['api', '/api/[outra]', 'DELETE', 500, 80, 'usuario'],
      ['pagina', '/caixa', 'LCP', null, 1800, 'usuario'],
      ['pagina', '/[outra]', 'VISITA', null, null, 'usuario'],
    ]);
    // id e criado_em são do banco falso (o real usa identity e `em`), fora da conferência.
    const texto = JSON.stringify(gravadas.map((l) => Object.fromEntries(Object.entries(l).filter(([k]) => k !== 'id' && k !== 'criado_em'))));
    expect(texto).not.toMatch(/@|ana|souza|esc-a|emp-a1|123\.456|cpf|joao|2026-11/i);
    for (const l of gravadas) {
      expect(Object.keys(l).filter((k) => !['id', 'criado_em'].includes(k)).sort())
        .toEqual(['amostra', 'erro', 'metodo', 'metrica', 'ms', 'papel', 'rota', 'status', 'taxa', 'tipo']);
    }
  });

  it('corpo inválido ou grande demais → 204 e nada gravado', async () => {
    const tabelas: Record<string, Record<string, unknown>[]> = {};
    db.atual = bancoFalso(tabelas);
    sessao = S.cliente;
    expect((await enviar('{não é json')).status).toBe(204);
    expect((await enviar({ itens: [{ tipo: 'api', rota: '/api/dp', metodo: 'GET', status: 200, ms: 5, amostra: true, x: 'a'.repeat(40_000) }] })).status).toBe(204);
    await assentar();
    expect(tabelas.medicoes ?? []).toEqual([]);
  });

  it('sem a migração 0031 (tabela ausente) → 204, sem exceção', async () => {
    db.atual = { from: () => ({ insert: () => ({ abortSignal: async () => ({ error: { code: '42P01', message: 'relation "medicoes" does not exist' } }) }) }) };
    sessao = S.cliente;
    const r = await enviar({ itens: [{ tipo: 'api', rota: '/api/caixa/resumo', metodo: 'GET', status: 200, ms: 5, amostra: true }] });
    expect(r.status).toBe(204);
    await assentar();
  });
});

describe('GET /api/config/medicao — só o master', () => {
  it('sem sessão 401; contador e cliente 403', async () => {
    expect((await GET(new NextRequest('http://localhost/api/config/medicao'))).status).toBe(401);
    sessao = S.contador;
    expect((await GET(new NextRequest('http://localhost/api/config/medicao'))).status).toBe(403);
    sessao = S.cliente;
    expect((await GET(new NextRequest('http://localhost/api/config/medicao'))).status).toBe(403);
  });

  it('master: resumo dos últimos 7 dias (o que é mais velho fica de fora)', async () => {
    const agora = Date.now();
    const em = (dias: number) => new Date(agora - dias * 86_400_000).toISOString();
    const base = { tipo: 'api', rota: '/api/painel', metodo: 'GET', status: 200, metrica: null, erro: null, papel: 'usuario', taxa: 0.25, amostra: true };
    db.atual = bancoFalso({
      medicoes: [
        { id: 1, em: em(1), ...base, ms: 100 },
        { id: 2, em: em(2), ...base, ms: 300 },
        { id: 3, em: em(10), ...base, ms: 9000 },
        { id: 4, em: em(1), ...base, status: 500, ms: 50, amostra: false },
      ],
    });
    sessao = S.master;
    const r = await GET(new NextRequest('http://localhost/api/config/medicao'));
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.dias).toBe(7);
    expect(d.linhas).toBe(3);
    expect(d.rotasLentas[0]).toMatchObject({ rota: '/api/painel', metodo: 'GET', n: 2, p50: 100, p95: 300 });
    expect(d.erros[0]).toMatchObject({ rota: '/api/painel', codigo: '500', n: 1 });
  });

  it('sem a migração 0031 → semTabela (a tela explica), não 500', async () => {
    const falha = { data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.medicoes'" } };
    const consulta = { select: () => consulta, gte: () => consulta, order: () => consulta, range: () => Promise.resolve(falha) };
    db.atual = { from: () => consulta };
    sessao = S.master;
    const d = await (await GET(new NextRequest('http://localhost/api/config/medicao'))).json();
    expect(d.semTabela).toBe(true);
  });
});
