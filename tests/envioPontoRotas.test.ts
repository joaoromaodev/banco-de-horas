// Contrato das rotas da folha enviada pelo cliente: tenta furar o isolamento
// entre escritórios e empresas e os papéis. Banco, Storage e IA simulados (vi.mock);
// o que se testa é a decisão das rotas.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Sessao } from '@/lib/auth';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const ID = '11111111-2222-4333-8444-555555555555';

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

vi.mock('next/server', async (orig) => {
  const real = await orig<typeof import('next/server')>();
  return { ...real, after: vi.fn() };
});

vi.mock('@/lib/cadastro', () => ({
  lerEmpresa: async (id: string) => EMPRESAS[id] ?? null,
  lerEmpresas: async () => Object.values(EMPRESAS),
  lerEmpresasComArquivadas: async () => Object.values(EMPRESAS),
  buscarUsuario: async () => null,
}));

vi.mock('@/lib/acesso', async (orig) => {
  const real = await orig<typeof import('@/lib/acesso')>();
  const negar = (msg: string, status: number) => ({ ok: false as const, resposta: Response.json({ erro: msg }, { status }) });
  return {
    ...real,
    sessaoDe: async () => sessaoAtual,
    exigirSessao: async () => (sessaoAtual ? { ok: true as const, sessao: sessaoAtual } : negar('Não autenticado.', 401)),
    exigirGestor: async () => (sessaoAtual && real.ehGestor(sessaoAtual) ? { ok: true as const, sessao: sessaoAtual } : negar('Acesso restrito.', 403)),
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

const envioBase = {
  id: ID, escritorioId: A, empresaId: 'emp-a1', funcionario: 'MARIA', empregadoId: null, ano: 2026, mes: 10,
  caminho: `${A}/${ID}.jpg`, tipo: 'image/jpeg', tamanho: 100, situacao: 'lida', aguardando: null,
  rascunho: { dias: [{ dia: 1, entradaManha: '08:00', saidaAlmoco: null, retornoAlmoco: null, saidaTarde: '17:00', marcador: null }], incertos: [], funcionarioLido: null },
  tentativas: 1, lendoDesde: null, lidoEm: null, motivo: null, devolvidoPor: null, devolvidoEm: null, aplicadoPor: null,
  aplicadoEm: null, frequenciaAnterior: null, enviadoPor: 'cli@a1.com', enviadoEm: '2026-11-01T00:00:00Z',
  excluidoEm: null as string | null, excluidoPorGestor: false, fotoApagadaEm: null,
};
let envioAtual: typeof envioBase | null = envioBase;

const io = {
  listarEnvios: vi.fn(async () => [envioBase]),
  funcionariosParaEnvio: vi.fn(async () => [{ nome: 'MARIA', empregadoId: null }]),
  iniciarEnvio: vi.fn(async () => ({ id: ID, url: 'https://storage.exemplo/up', mime: 'image/jpeg' })),
  confirmarEnvio: vi.fn(async () => ({ ...envioBase, situacao: 'recebida' })),
  aplicarEnvio: vi.fn(async () => ({ dias: 1, anteriores: 0 })),
  desfazerAplicacao: vi.fn(async () => {}),
  devolverEnvio: vi.fn(async () => {}),
  desfazerDevolucao: vi.fn(async () => {}),
  lerEnvioPelaIa: vi.fn(async () => 'lida'),
  excluirEnvio: vi.fn(async () => {}),
  restaurarEnvio: vi.fn(async () => {}),
  processarFila: vi.fn(async () => 0),
  urlFoto: vi.fn(async () => 'https://storage.exemplo/foto'),
};

vi.mock('@/lib/envioPontoServidor', async (orig) => {
  const real = await orig<typeof import('@/lib/envioPontoServidor')>();
  return {
    ...real,
    ...io,
    lerEnvio: async (id: string) => (envioAtual && id === envioAtual.id ? envioAtual : null),
    enviosNaUltimaHora: async () => 0,
  };
});

const rota = await import('@/app/api/envio-ponto/route');
const foto = await import('@/app/api/envio-ponto/foto/route');

const req = (url: string, init?: { method?: string; body?: unknown }) =>
  new NextRequest(`http://x${url}`, {
    method: init?.method ?? 'GET',
    body: init?.body ? JSON.stringify(init.body) : undefined,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
const patch = (body: unknown) => rota.PATCH(req('/api/envio-ponto', { method: 'PATCH', body }));
const como = (k: keyof typeof SESSOES) => { sessaoAtual = SESSOES[k]; };

// Mês corrente (Belém): o cliente só manda folha de mês que já começou.
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem' }).format(new Date());
const ANO = Number(hoje.slice(0, 4));
const MES = Number(hoje.slice(5, 7));
const novo = (extra: Record<string, unknown> = {}) => ({
  ano: ANO, mes: MES, funcionario: 'maria', nome: 'foto.jpg', tamanho: 1000, tipo: 'image/jpeg', ...extra,
});

beforeEach(() => {
  envioAtual = { ...envioBase };
  Object.values(io).forEach((f) => f.mockClear());
});

describe('outro escritório não alcança o envio', () => {
  it('foto, PATCH e DELETE → 404, sem I/O', async () => {
    como('contadorB');
    expect((await foto.GET(req(`/api/envio-ponto/foto?id=${ID}`))).status).toBe(404);
    expect((await patch({ id: ID, acao: 'aplicar', dias: [] })).status).toBe(404);
    expect((await patch({ id: ID, acao: 'ler' })).status).toBe(404);
    expect((await rota.DELETE(req(`/api/envio-ponto?id=${ID}`, { method: 'DELETE' }))).status).toBe(404);
    expect(io.urlFoto).not.toHaveBeenCalled();
    expect(io.aplicarEnvio).not.toHaveBeenCalled();
    expect(io.lerEnvioPelaIa).not.toHaveBeenCalled();
    expect(io.excluirEnvio).not.toHaveBeenCalled();
  });

  it('listar envios de empresa de outro escritório → 403', async () => {
    como('contadorB');
    expect((await rota.GET(req('/api/envio-ponto?empresa=emp-a1'))).status).toBe(403);
    expect(io.listarEnvios).not.toHaveBeenCalled();
  });

  it('o mesmo escritório alcança (controle positivo)', async () => {
    como('contadorA');
    const r = await foto.GET(req(`/api/envio-ponto/foto?id=${ID}`));
    expect(r.status).toBe(302);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect((await patch({ id: ID, acao: 'aplicar', dias: [] })).status).toBe(200);
    expect(io.aplicarEnvio).toHaveBeenCalledOnce();
  });
});

describe('cliente', () => {
  it('de outra empresa do mesmo escritório não vê nem exclui', async () => {
    como('clienteA2');
    expect((await foto.GET(req(`/api/envio-ponto/foto?id=${ID}`))).status).toBe(404);
    expect((await rota.DELETE(req(`/api/envio-ponto?id=${ID}`, { method: 'DELETE' }))).status).toBe(404);
    expect((await rota.GET(req('/api/envio-ponto?empresa=emp-a1'))).status).toBe(403);
  });

  it('não aplica, não devolve, não força leitura (não gasta a cota por fora)', async () => {
    como('clienteA1');
    expect((await patch({ id: ID, acao: 'aplicar', dias: [] })).status).toBe(403);
    expect((await patch({ id: ID, acao: 'devolver', motivo: 'qualquer coisa' })).status).toBe(403);
    envioAtual!.situacao = 'falhou';
    expect((await patch({ id: ID, acao: 'ler' })).status).toBe(403);
    expect(io.aplicarEnvio).not.toHaveBeenCalled();
    expect(io.devolverEnvio).not.toHaveBeenCalled();
    expect(io.lerEnvioPelaIa).not.toHaveBeenCalled();
  });

  it('não confirma envio de outra pessoa', async () => {
    como('clienteA1');
    envioAtual!.situacao = 'enviando';
    envioAtual!.enviadoPor = 'outra@a1.com';
    expect((await patch({ id: ID, acao: 'confirmar' })).status).toBe(403);
    expect(io.confirmarEnvio).not.toHaveBeenCalled();
  });

  it('confirma o próprio envio e a leitura vai para depois da resposta', async () => {
    como('clienteA1');
    envioAtual!.situacao = 'enviando';
    const { after } = await import('next/server');
    const r = await patch({ id: ID, acao: 'confirmar' });
    expect(r.status).toBe(200);
    expect(after).toHaveBeenCalled();
    const x = await r.json();
    expect(x.envio.rascunho).toBeUndefined();
  });

  it('a lista do cliente não traz rascunho, e-mails nem caminho', async () => {
    como('clienteA1');
    const x = await (await rota.GET(req('/api/envio-ponto'))).json();
    expect(x.envios[0].rascunho).toBeUndefined();
    expect(x.envios[0].enviadoPor).toBeUndefined();
    expect(x.envios[0].caminho).toBeUndefined();
    expect(x.funcionarios).toEqual([{ nome: 'MARIA' }]);
  });

  it('não restaura o que a contabilidade excluiu', async () => {
    como('clienteA1');
    envioAtual!.excluidoEm = '2026-11-02T00:00:00Z';
    envioAtual!.excluidoPorGestor = true;
    expect((await patch({ id: ID, acao: 'restaurar' })).status).toBe(403);
    expect(io.restaurarEnvio).not.toHaveBeenCalled();
  });
});

describe('POST (iniciar envio)', () => {
  it('válido: funcionário do cadastro (sem caixa), escritório do cadastro, não do navegador', async () => {
    como('clienteA1');
    const r = await rota.POST(req('/api/envio-ponto', { method: 'POST', body: novo({ escritorioId: B, empresa: 'emp-a1' }) }));
    expect(r.status).toBe(200);
    expect(io.iniciarEnvio).toHaveBeenCalledWith(expect.objectContaining({ escritorioId: A, empresaId: 'emp-a1', funcionario: 'MARIA' }));
  });

  it('funcionário fora da lista → 400', async () => {
    como('clienteA1');
    const r = await rota.POST(req('/api/envio-ponto', { method: 'POST', body: novo({ funcionario: 'JOÃO INVENTADO' }) }));
    expect(r.status).toBe(400);
    expect(io.iniciarEnvio).not.toHaveBeenCalled();
  });

  it('PDF, mês futuro e empresa de outro cliente são recusados', async () => {
    como('clienteA1');
    expect((await rota.POST(req('/api/envio-ponto', { method: 'POST', body: novo({ nome: 'a.pdf', tipo: 'application/pdf' }) }))).status).toBe(400);
    const futuro = MES === 12 ? { ano: ANO + 1, mes: 1 } : { ano: ANO, mes: MES + 1 };
    expect((await rota.POST(req('/api/envio-ponto', { method: 'POST', body: novo(futuro) }))).status).toBe(400);
    expect((await rota.POST(req('/api/envio-ponto', { method: 'POST', body: novo({ empresa: 'emp-a2' }) }))).status).toBe(403);
    expect(io.iniciarEnvio).not.toHaveBeenCalled();
  });

  it('a contabilidade não envia por aqui (usa a Timesheet)', async () => {
    como('contadorA');
    const r = await rota.POST(req('/api/envio-ponto', { method: 'POST', body: novo({ empresa: 'emp-a1' }) }));
    expect(r.status).toBe(403);
    expect(io.iniciarEnvio).not.toHaveBeenCalled();
  });
});

describe('conferência', () => {
  it('devolver exige motivo', async () => {
    como('contadorA');
    expect((await patch({ id: ID, acao: 'devolver', motivo: ' ' })).status).toBe(400);
    expect((await patch({ id: ID, acao: 'devolver', motivo: 'Foto cortada, faltam os dias 20 a 31' })).status).toBe(200);
    expect(io.devolverEnvio).toHaveBeenCalledOnce();
  });

  it('não aplica folha já aplicada nem devolvida', async () => {
    como('contadorA');
    envioAtual!.situacao = 'aplicada';
    expect((await patch({ id: ID, acao: 'aplicar', dias: [] })).status).toBe(409);
    envioAtual!.situacao = 'devolvida';
    expect((await patch({ id: ID, acao: 'aplicar', dias: [] })).status).toBe(409);
    expect(io.aplicarEnvio).not.toHaveBeenCalled();
  });

  it('dias malformados → 400', async () => {
    como('contadorA');
    expect((await patch({ id: ID, acao: 'aplicar', dias: 'x' })).status).toBe(400);
    expect((await patch({ id: ID, acao: 'aplicar', dias: Array(40).fill({}) })).status).toBe(400);
  });

  it('não exclui folha aplicada', async () => {
    como('contadorA');
    envioAtual!.situacao = 'aplicada';
    expect((await rota.DELETE(req(`/api/envio-ponto?id=${ID}`, { method: 'DELETE' }))).status).toBe(409);
  });
});
