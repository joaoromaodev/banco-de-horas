// Contrato das rotas do portal: tenta furar o isolamento entre escritórios e
// entre empresas. Banco e Storage são simulados (vi.mock); a guarda de sessão
// também — o que se testa é a decisão das rotas sobre o registro carregado.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Sessao } from '@/lib/auth';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const DOC = '11111111-2222-4333-8444-555555555555';
const PEND = '66666666-7777-4888-9999-000000000000';

const exp = Date.now() + 3_600_000;
const SESSOES: Record<string, Sessao> = {
  contadorA: { email: 'c@a.com', nome: 'A', role: 'usuario', escritorioId: A, exp },
  contadorB: { email: 'c@b.com', nome: 'B', role: 'usuario', escritorioId: B, exp },
  clienteA1: { email: 'cli@a1.com', nome: 'A1', role: 'cliente', escritorioId: A, empresa: 'emp-a1', exp },
  clienteA2: { email: 'cli@a2.com', nome: 'A2', role: 'cliente', escritorioId: A, empresa: 'emp-a2', exp },
};
let sessaoAtual: Sessao | null = null;

const EMPRESAS: Record<string, { id: string; nome: string; escritorioId: string }> = {
  'emp-a1': { id: 'emp-a1', nome: 'A1', escritorioId: A },
  'emp-a2': { id: 'emp-a2', nome: 'A2', escritorioId: A },
  'emp-b1': { id: 'emp-b1', nome: 'B1', escritorioId: B },
};

vi.mock('@/lib/cadastro', () => ({
  lerEmpresa: async (id: string) => EMPRESAS[id] ?? null,
  lerEmpresas: async () => Object.values(EMPRESAS),
  buscarUsuario: async () => null,
}));

vi.mock('@/lib/acesso', async (orig) => {
  const real = await orig<typeof import('@/lib/acesso')>();
  const negar = (msg: string, status: number) => ({ ok: false as const, resposta: Response.json({ erro: msg }, { status }) });
  return {
    ...real,
    sessaoDe: async () => sessaoAtual,
    exigirSessao: async () => (sessaoAtual ? { ok: true as const, sessao: sessaoAtual } : negar('Não autenticado.', 401)),
    exigirEmpresa: async (_req: unknown, empresaId: string) => {
      if (!sessaoAtual) return negar('Não autenticado.', 401);
      if (!empresaId) return negar('Informe a empresa.', 400);
      const e = EMPRESAS[empresaId];
      const { empresaVisivel } = await import('@/lib/visibilidade');
      if (!e || !empresaVisivel(sessaoAtual, e)) return negar('Acesso restrito a esta empresa.', 403);
      return { ok: true as const, sessao: sessaoAtual };
    },
  };
});

const docBase = {
  id: DOC, empresaId: 'emp-a1', escritorioId: A, competencia: '2026-10', categoria: 'extrato', caminho: `${A}/${DOC}.pdf`,
  nome: 'extrato.pdf', tamanho: 100, tipo: 'application/pdf', observacao: null, pendenciaId: null, status: 'recebido',
  enviadoPor: 'cli@a1.com', enviadoEm: '2026-11-01T00:00:00Z', conferidoPor: null, conferidoEm: null,
  excluidoEm: null as string | null, excluidoPorGestor: false,
};
let docAtual: typeof docBase | null = docBase;
const pendBase = {
  id: PEND, empresaId: 'emp-a1', escritorioId: A, titulo: 'Extrato', descricao: null, categoria: null, competencia: null,
  prazo: null, status: 'aberta', atendidaEm: null, atendidaPor: null, criadoPor: 'c@a.com', criadoEm: '', excluidoEm: null,
};
let pendAtual: typeof pendBase | null = pendBase;

const io = {
  excluirDocumento: vi.fn(async () => {}),
  restaurarDocumento: vi.fn(async () => {}),
  conferirDocumento: vi.fn(async () => docBase),
  confirmarEnvio: vi.fn(async () => docBase),
  urlDownload: vi.fn(async () => 'https://storage.exemplo/assinada'),
  listarDocumentos: vi.fn(async () => [docBase]),
  iniciarEnvio: vi.fn(async () => ({ id: DOC, url: 'https://storage.exemplo/up', mime: 'application/pdf' })),
  excluirPendencia: vi.fn(async () => {}),
  mudarStatusPendencia: vi.fn(async () => pendBase),
  listarPendencias: vi.fn(async () => [pendBase]),
};

vi.mock('@/lib/documentosServidor', async (orig) => {
  const real = await orig<typeof import('@/lib/documentosServidor')>();
  return {
    ...real,
    ...io,
    lerDocumento: async (id: string) => (docAtual && id === docAtual.id ? docAtual : null),
    lerPendencia: async (id: string) => (pendAtual && id === pendAtual.id ? pendAtual : null),
    enviosRecentes: async () => 0,
  };
});

const docs = await import('@/app/api/documentos/route');
const arquivo = await import('@/app/api/documentos/arquivo/route');
const pends = await import('@/app/api/pendencias/route');

const req = (url: string, init?: { method?: string; body?: unknown }) =>
  new NextRequest(`http://x${url}`, {
    method: init?.method ?? 'GET',
    body: init?.body ? JSON.stringify(init.body) : undefined,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });

beforeEach(() => {
  docAtual = { ...docBase };
  pendAtual = { ...pendBase };
  Object.values(io).forEach((f) => f.mockClear());
});

const como = (k: keyof typeof SESSOES) => { sessaoAtual = SESSOES[k]; };

describe('outro escritório não alcança o documento por id', () => {
  it('GET arquivo, PATCH (conferir/restaurar) e DELETE → 404, sem I/O', async () => {
    como('contadorB');
    expect((await arquivo.GET(req(`/api/documentos/arquivo?id=${DOC}`))).status).toBe(404);
    expect((await docs.PATCH(req('/api/documentos', { method: 'PATCH', body: { id: DOC, acao: 'conferir' } }))).status).toBe(404);
    docAtual!.excluidoEm = '2026-11-02T00:00:00Z';
    expect((await docs.PATCH(req('/api/documentos', { method: 'PATCH', body: { id: DOC, acao: 'restaurar' } }))).status).toBe(404);
    docAtual!.excluidoEm = null;
    expect((await docs.DELETE(req(`/api/documentos?id=${DOC}`, { method: 'DELETE' }))).status).toBe(404);
    expect(io.urlDownload).not.toHaveBeenCalled();
    expect(io.conferirDocumento).not.toHaveBeenCalled();
    expect(io.restaurarDocumento).not.toHaveBeenCalled();
    expect(io.excluirDocumento).not.toHaveBeenCalled();
  });

  it('listar a empresa de outro escritório → 403', async () => {
    como('contadorB');
    expect((await docs.GET(req('/api/documentos?empresa=emp-a1'))).status).toBe(403);
    expect(io.listarDocumentos).not.toHaveBeenCalled();
  });

  it('o mesmo escritório alcança (controle positivo)', async () => {
    como('contadorA');
    const r = await arquivo.GET(req(`/api/documentos/arquivo?id=${DOC}`));
    expect(r.status).toBe(302);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect((await docs.PATCH(req('/api/documentos', { method: 'PATCH', body: { id: DOC, acao: 'conferir' } }))).status).toBe(200);
  });
});

describe('cliente só a própria empresa', () => {
  it('cliente de outra empresa do mesmo escritório → 404/403', async () => {
    como('clienteA2');
    expect((await arquivo.GET(req(`/api/documentos/arquivo?id=${DOC}`))).status).toBe(404);
    expect((await docs.DELETE(req(`/api/documentos?id=${DOC}`, { method: 'DELETE' }))).status).toBe(404);
    expect((await docs.GET(req('/api/documentos?empresa=emp-a1'))).status).toBe(403);
  });

  it('cliente não confere e não confirma envio de outra pessoa', async () => {
    como('clienteA1');
    expect((await docs.PATCH(req('/api/documentos', { method: 'PATCH', body: { id: DOC, acao: 'conferir' } }))).status).toBe(403);
    docAtual!.status = 'enviando';
    docAtual!.enviadoPor = 'outra@a1.com';
    expect((await docs.PATCH(req('/api/documentos', { method: 'PATCH', body: { id: DOC, acao: 'confirmar' } }))).status).toBe(403);
  });

  it('cliente não restaura o que a contabilidade excluiu', async () => {
    como('clienteA1');
    docAtual!.excluidoEm = '2026-11-02T00:00:00Z';
    docAtual!.excluidoPorGestor = true;
    expect((await docs.PATCH(req('/api/documentos', { method: 'PATCH', body: { id: DOC, acao: 'restaurar' } }))).status).toBe(403);
    docAtual!.excluidoPorGestor = false;
    expect((await docs.PATCH(req('/api/documentos', { method: 'PATCH', body: { id: DOC, acao: 'restaurar' } }))).status).toBe(200);
  });

  it('a lista do cliente não traz e-mails', async () => {
    como('clienteA1');
    const x = await (await docs.GET(req('/api/documentos'))).json();
    expect(x.documentos[0].enviadoPor).toBe('');
    expect(x.documentos[0].caminho).toBeUndefined();
    const p = await (await pends.GET(req('/api/pendencias'))).json();
    expect(p.pendencias[0].criadoPor).toBe('');
  });
});

describe('envio e pendências', () => {
  it('POST com pendência de outra empresa → 409, sem iniciar envio', async () => {
    como('clienteA2');
    const r = await docs.POST(req('/api/documentos', {
      method: 'POST',
      body: { competencia: '2026-10', categoria: 'extrato', nome: 'a.pdf', tamanho: 10, tipo: 'application/pdf', pendencia: PEND },
    }));
    expect(r.status).toBe(409);
    expect(io.iniciarEnvio).not.toHaveBeenCalled();
  });

  it('POST com tipo proibido → 400', async () => {
    como('clienteA1');
    const r = await docs.POST(req('/api/documentos', {
      method: 'POST', body: { competencia: '2026-10', categoria: 'outros', nome: 'x.html', tamanho: 10, tipo: 'text/html' },
    }));
    expect(r.status).toBe(400);
    expect(io.iniciarEnvio).not.toHaveBeenCalled();
  });

  it('POST válido usa o escritório do cadastro, não o do navegador', async () => {
    como('clienteA1');
    const r = await docs.POST(req('/api/documentos', {
      method: 'POST',
      body: { competencia: '2026-10', categoria: 'nota', nome: 'n.pdf', tamanho: 10, tipo: 'application/pdf', escritorioId: B },
    }));
    expect(r.status).toBe(200);
    expect(io.iniciarEnvio).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 'emp-a1', escritorioId: A }));
  });

  it('cliente não gere pendência; outro escritório não a alcança', async () => {
    como('clienteA1');
    expect((await pends.DELETE(req(`/api/pendencias?id=${PEND}`, { method: 'DELETE' }))).status).toBe(403);
    expect((await pends.POST(req('/api/pendencias', { method: 'POST', body: { titulo: 'x' } }))).status).toBe(403);
    como('contadorB');
    expect((await pends.DELETE(req(`/api/pendencias?id=${PEND}`, { method: 'DELETE' }))).status).toBe(404);
    expect((await pends.PATCH(req('/api/pendencias', { method: 'PATCH', body: { id: PEND, acao: 'fechar' } }))).status).toBe(404);
    expect(io.excluirPendencia).not.toHaveBeenCalled();
    expect(io.mudarStatusPendencia).not.toHaveBeenCalled();
  });

  it('id que não é uuid → 404', async () => {
    como('contadorA');
    expect((await arquivo.GET(req('/api/documentos/arquivo?id=------------------------------------'))).status).toBe(404);
  });
});
