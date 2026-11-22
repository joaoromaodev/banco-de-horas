// Empresa arquivada no portal (Documentos e Pendências), pelas rotas e com as
// guardas REAIS de lib/acesso.ts (cookie assinado): a contabilidade CONSULTA
// (lista, baixa), gravar dá 409 com a mensagem de reativar e o cliente da
// arquivada leva 403 — a mesma regra do caixa, do DP e dos envios de ponto.
// Banco e Storage são um fake em memória (lib/documentosServidor).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Documento, Pendencia } from '@/lib/documentosServidor';
import { ESC_A, pedido, type QuemTeste } from './rotaTeste';

vi.mock('@/lib/cadastro', async (orig) => {
  const { cadastroFalso, empresasTeste } = await import('./rotaTeste');
  const empresas = empresasTeste();
  return { ...(await orig<object>()), ...cadastroFalso(() => empresas) };
});

let docs: Map<string, Documento>;
let pends: Map<string, Pendencia>;
const gravacoes: string[] = [];

vi.mock('@/lib/documentosServidor', async (orig) => {
  const real = await orig<typeof import('@/lib/documentosServidor')>();
  const doEscopo = <T extends { empresaId: string; escritorioId: string | null; excluidoEm: string | null }>(
    l: Iterable<T>, e: { empresaId: string; escritorioId: string | null },
  ) => [...l].filter((x) => x.empresaId === e.empresaId && (e.escritorioId === null || x.escritorioId === e.escritorioId) && !x.excluidoEm);
  const gravou = (o: string) => { gravacoes.push(o); };
  return {
    ...real,
    listarDocumentos: async (e: { empresaId: string; escritorioId: string | null }) => doEscopo(docs.values(), e),
    listarPendencias: async (e: { empresaId: string; escritorioId: string | null }) => doEscopo(pends.values(), e),
    lerDocumento: async (id: string) => docs.get(id) ?? null,
    lerPendencia: async (id: string) => pends.get(id) ?? null,
    urlDownload: async () => 'https://storage.exemplo/doc',
    enviosRecentes: async () => 0,
    iniciarEnvio: async () => { gravou('iniciarEnvio'); return { id: 'x', url: 'https://storage.exemplo/up', mime: 'application/pdf' }; },
    conferirDocumento: async () => { gravou('conferirDocumento'); return [...docs.values()][0]; },
    excluirDocumento: async () => { gravou('excluirDocumento'); },
    criarPendencia: async () => { gravou('criarPendencia'); return [...pends.values()][0]; },
    editarPendencia: async () => { gravou('editarPendencia'); return [...pends.values()][0]; },
    mudarStatusPendencia: async () => { gravou('mudarStatusPendencia'); return [...pends.values()][0]; },
    excluirPendencia: async () => { gravou('excluirPendencia'); },
  };
});

const documentos = await import('@/app/api/documentos/route');
const arquivo = await import('@/app/api/documentos/arquivo/route');
const pendencias = await import('@/app/api/pendencias/route');

const DOC_ARQ = '11111111-2222-4333-8444-555555555555';
const PEND_ARQ = '66666666-7777-4888-9999-000000000000';

beforeEach(() => {
  gravacoes.length = 0;
  docs = new Map([[DOC_ARQ, {
    id: DOC_ARQ, empresaId: 'emp-arq', escritorioId: ESC_A, competencia: '2026-05', categoria: 'extrato',
    caminho: `${ESC_A}/${DOC_ARQ}.pdf`, nome: 'extrato.pdf', tamanho: 100, tipo: 'application/pdf', observacao: null,
    pendenciaId: null, status: 'recebido', enviadoPor: 'cli@arq.com', enviadoEm: '2026-05-10T00:00:00Z',
    conferidoPor: null, conferidoEm: null, excluidoEm: null, excluidoPorGestor: false,
    devolvidoEm: null, devolvidoPor: null, motivoDevolucao: null,
  }]]);
  pends = new Map([[PEND_ARQ, {
    id: PEND_ARQ, empresaId: 'emp-arq', escritorioId: ESC_A, titulo: 'Extrato de maio', descricao: null,
    categoria: 'extrato', competencia: '2026-05', prazo: null, status: 'aberta', atendidaEm: null, atendidaPor: null,
    criadoPor: 'c@a.com', criadoEm: '2026-05-01T00:00:00Z', excluidoEm: null,
    semMovimentoEm: null, semMovimentoPor: null, semMovimentoObs: null,
  }]]);
});

const get = async (quem: QuemTeste, url: string) => {
  const req = await pedido(quem, url);
  if (url.startsWith('/api/documentos/arquivo')) return arquivo.GET(req);
  return url.startsWith('/api/pendencias') ? pendencias.GET(req) : documentos.GET(req);
};

describe('empresa arquivada no portal (guardas reais)', () => {
  it('a contabilidade do escritório consulta: lista documentos e pendências e baixa o arquivo', async () => {
    const d = await get('contadorA', '/api/documentos?empresa=emp-arq');
    expect(d.status).toBe(200);
    expect((await d.json()).documentos.map((x: { id: string }) => x.id)).toEqual([DOC_ARQ]);

    const p = await get('contadorA', '/api/pendencias?empresa=emp-arq');
    expect(p.status).toBe(200);
    expect((await p.json()).pendencias.map((x: { id: string }) => x.id)).toEqual([PEND_ARQ]);

    const a = await get('contadorA', `/api/documentos/arquivo?id=${DOC_ARQ}`);
    expect(a.status).toBe(302);
  });

  it('a contabilidade não grava: pedir, conferir, editar e excluir dão 409 com a mensagem de reativar', async () => {
    const respostas = [
      await pendencias.POST(await pedido('contadorA', '/api/pendencias', { method: 'POST', body: { empresa: 'emp-arq', titulo: 'Folha de junho' } })),
      await documentos.POST(await pedido('contadorA', '/api/documentos', {
        method: 'POST', body: { empresa: 'emp-arq', competencia: '2026-05', categoria: 'extrato', nome: 'a.pdf', tamanho: 10, tipo: 'application/pdf' },
      })),
      await documentos.PATCH(await pedido('contadorA', '/api/documentos', { method: 'PATCH', body: { id: DOC_ARQ, acao: 'conferir' } })),
      await documentos.DELETE(await pedido('contadorA', `/api/documentos?id=${DOC_ARQ}`, { method: 'DELETE' })),
      await pendencias.PATCH(await pedido('contadorA', '/api/pendencias', { method: 'PATCH', body: { id: PEND_ARQ, acao: 'fechar' } })),
      await pendencias.DELETE(await pedido('contadorA', `/api/pendencias?id=${PEND_ARQ}`, { method: 'DELETE' })),
    ];
    for (const r of respostas) {
      expect(r.status).toBe(409);
      expect((await r.json()).erro).toMatch(/arquivada/i);
    }
    expect(gravacoes).toEqual([]);
  });

  it('o cliente da empresa arquivada não lista, não baixa nem envia (403)', async () => {
    expect((await get('clienteArq', '/api/documentos')).status).toBe(403);
    expect((await get('clienteArq', '/api/pendencias')).status).toBe(403);
    expect((await get('clienteArq', `/api/documentos/arquivo?id=${DOC_ARQ}`)).status).toBe(403);
    const r = await documentos.POST(await pedido('clienteArq', '/api/documentos', {
      method: 'POST', body: { competencia: '2026-05', categoria: 'extrato', nome: 'a.pdf', tamanho: 10, tipo: 'application/pdf' },
    }));
    expect(r.status).toBe(403);
    expect(gravacoes).toEqual([]);
  });

  it('outro escritório não enxerga a arquivada (403/404, sem revelar que está arquivada)', async () => {
    const r = await get('contadorB', '/api/documentos?empresa=emp-arq');
    expect(r.status).toBe(403);
    expect((await r.json()).erro).not.toMatch(/arquivada/i);
    expect((await get('contadorB', '/api/pendencias?empresa=emp-arq')).status).toBe(403);
    expect((await get('contadorB', `/api/documentos/arquivo?id=${DOC_ARQ}`)).status).toBe(404);
  });
});
