// Fluxo crítico da folha de ponto enviada pelo cliente, pelas rotas e com as
// guardas REAIS de lib/acesso.ts (cookie assinado):
//   cliente envia → confirma → contadora lê → aplica (ou devolve com motivo) →
//   o cliente vê o desfecho.
// Complementa envioPontoRotas.test.ts (que mocka as guardas e cobre as recusas
// uma a uma): aqui o estado anda de verdade entre as chamadas, e entra a empresa
// arquivada. O I/O (Supabase, Storage, Gemini) é um fake com estado, em memória.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Envio } from '@/lib/envioPontoServidor';
import { ESC_A, pedido, type QuemTeste } from './rotaTeste';

vi.mock('next/server', async (orig) => ({ ...(await orig<object>()), after: vi.fn() }));
vi.mock('@/lib/cadastro', async (orig) => {
  const { cadastroFalso, empresasTeste } = await import('./rotaTeste');
  const empresas = empresasTeste();
  return { ...(await orig<object>()), ...cadastroFalso(() => empresas) };
});

let envios: Map<string, Envio>;
const aplicadas: { envioId: string; funcionario: string; dias: number }[] = [];
let seq = 0;

vi.mock('@/lib/envioPontoServidor', async (orig) => {
  const real = await orig<typeof import('@/lib/envioPontoServidor')>();
  const { ErroEnvio } = real;
  const pegar = (id: string) => envios.get(id) ?? null;
  const mudar = (e: Envio, p: Partial<Envio>) => { envios.set(e.id, { ...envios.get(e.id)!, ...p }); };
  return {
    ...real,
    lerEnvio: async (id: string) => { const e = pegar(id); return e ? { ...e } : null; },
    listarEnvios: async (esc: string | null, empresaId: string) =>
      [...envios.values()].filter((e) => e.empresaId === empresaId && (esc === null || e.escritorioId === esc) && !e.excluidoEm),
    funcionariosParaEnvio: async () => [{ nome: 'MARIA SILVA', empregadoId: null }],
    enviosNaUltimaHora: async () => 0,
    processarFila: async () => 0,
    urlFoto: async () => 'https://storage.exemplo/foto',
    iniciarEnvio: async (n: { escritorioId: string; empresaId: string; funcionario: string; ano: number; mes: number; tipo: string; tamanho: number; autor: string }) => {
      const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
      envios.set(id, {
        id, escritorioId: n.escritorioId, empresaId: n.empresaId, funcionario: n.funcionario, empregadoId: null,
        ano: n.ano, mes: n.mes, caminho: `${n.escritorioId}/${id}.jpg`, tipo: n.tipo, tamanho: n.tamanho,
        situacao: 'enviando', aguardando: null, rascunho: null, tentativas: 0, lendoDesde: null, lidoEm: null,
        motivo: null, devolvidoPor: null, devolvidoEm: null, aplicadoPor: null, aplicadoEm: null,
        frequenciaAnterior: null, frequenciaAplicada: null, enviadoPor: n.autor, enviadoEm: new Date().toISOString(),
        excluidoEm: null, excluidoPorGestor: false, fotoApagadaEm: null,
      });
      return { id, url: 'https://storage.exemplo/upload', mime: n.tipo };
    },
    confirmarEnvio: async (e: Envio) => { mudar(e, { situacao: 'recebida' }); return pegar(e.id)!; },
    lerEnvioPelaIa: async (id: string) => {
      mudar(pegar(id)!, {
        situacao: 'lida', tentativas: 1, lidoEm: new Date().toISOString(),
        rascunho: { dias: [{ dia: 1, entradaManha: '08:00', saidaAlmoco: '12:00', retornoAlmoco: '13:00', saidaTarde: '17:00', marcador: null }], incertos: [], funcionarioLido: 'Maria Silva' } as Envio['rascunho'],
      });
      return 'lida' as const;
    },
    aplicarEnvio: async (e: Envio, funcionario: string, dias: unknown[], autor: string) => {
      if (!['recebida', 'lida', 'falhou'].includes(pegar(e.id)!.situacao)) throw new ErroEnvio('Já aplicada.', 409);
      mudar(e, { situacao: 'aplicada', aplicadoPor: autor, aplicadoEm: new Date().toISOString(), funcionario });
      aplicadas.push({ envioId: e.id, funcionario, dias: dias.length });
      return { dias: dias.length, anteriores: 0 };
    },
    desfazerAplicacao: async (e: Envio) => { mudar(e, { situacao: 'lida', aplicadoPor: null, aplicadoEm: null }); },
    devolverEnvio: async (e: Envio, motivo: string, autor: string) => {
      mudar(e, { situacao: 'devolvida', motivo, devolvidoPor: autor, devolvidoEm: new Date().toISOString() });
    },
    desfazerDevolucao: async (e: Envio) => { mudar(e, { situacao: 'lida', motivo: null, devolvidoPor: null, devolvidoEm: null }); },
    excluirEnvio: async (e: Envio, _autor: string, porGestor: boolean) => {
      mudar(e, { excluidoEm: new Date().toISOString(), excluidoPorGestor: porGestor });
    },
    restaurarEnvio: async (e: Envio) => { mudar(e, { excluidoEm: null, excluidoPorGestor: false }); },
  };
});

const rota = await import('@/app/api/envio-ponto/route');
const foto = await import('@/app/api/envio-ponto/foto/route');

const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem' }).format(new Date());
const ANO = Number(hoje.slice(0, 4));
const MES = Number(hoje.slice(5, 7));

const patch = async (quem: QuemTeste, corpo: Record<string, unknown>) =>
  rota.PATCH(await pedido(quem, '/api/envio-ponto', { method: 'PATCH', body: corpo }));
const listar = async (quem: QuemTeste, empresa?: string) =>
  (await rota.GET(await pedido(quem, `/api/envio-ponto${empresa ? `?empresa=${empresa}` : ''}`)));
const DIAS = [{ dia: 1, entradaManha: '08:00', saidaAlmoco: '12:00', retornoAlmoco: '13:00', saidaTarde: '17:00', marcador: null }];

/** O cliente da A1 envia e confirma uma foto; devolve o id. */
async function enviarComoCliente(): Promise<string> {
  const r = await rota.POST(await pedido('clienteA1', '/api/envio-ponto', {
    method: 'POST', body: { ano: ANO, mes: MES, funcionario: 'maria silva', nome: 'folha.jpg', tamanho: 2000, tipo: 'image/jpeg' },
  }));
  expect(r.status).toBe(200);
  const { id } = await r.json();
  expect((await patch('clienteA1', { id, acao: 'confirmar' })).status).toBe(200);
  return id;
}

/** Um envio já gravado (ex.: de empresa que depois foi arquivada). */
function envioSemeado(empresaId: string, situacao: Envio['situacao'] = 'lida'): string {
  const id = `00000000-0000-4000-9000-${String(++seq).padStart(12, '0')}`;
  envios.set(id, {
    id, escritorioId: ESC_A, empresaId, funcionario: 'MARIA SILVA', empregadoId: null, ano: ANO, mes: MES,
    caminho: `${ESC_A}/${id}.jpg`, tipo: 'image/jpeg', tamanho: 100, situacao, aguardando: null, rascunho: null,
    tentativas: 1, lendoDesde: null, lidoEm: null, motivo: null, devolvidoPor: null, devolvidoEm: null,
    aplicadoPor: null, aplicadoEm: null, frequenciaAnterior: null, frequenciaAplicada: null,
    enviadoPor: 'cli@arq.com', enviadoEm: '2026-01-01T00:00:00Z', excluidoEm: null, excluidoPorGestor: false, fotoApagadaEm: null,
  });
  return id;
}

beforeEach(() => {
  envios = new Map();
  aplicadas.length = 0;
});

describe('fluxo: folha enviada pelo cliente → aplicada', () => {
  it('ponta a ponta', async () => {
    const id = await enviarComoCliente();
    // Gravado no escritório e na empresa da SESSÃO, com a grafia do cadastro.
    expect(envios.get(id)).toMatchObject({ escritorioId: ESC_A, empresaId: 'emp-a1', funcionario: 'MARIA SILVA', situacao: 'recebida', enviadoPor: 'cli@a1.com' });

    // A contadora pede a leitura e vê o rascunho; o cliente nunca vê o rascunho.
    expect((await patch('contadorA', { id, acao: 'ler' })).status).toBe(200);
    const daContadora = await (await listar('contadorA', 'emp-a1')).json();
    expect(daContadora.envios[0]).toMatchObject({ id, situacao: 'lida' });
    expect(daContadora.envios[0].rascunho.dias).toHaveLength(1);
    const doCliente = await (await listar('clienteA1')).json();
    expect(doCliente.envios[0]).toMatchObject({ id, situacao: 'lida', minha: true });
    expect(doCliente.envios[0].rascunho).toBeUndefined();

    // Aplica com o nome digitado de outro jeito: vale a grafia do cadastro.
    expect((await patch('contadorA', { id, acao: 'aplicar', funcionario: 'maria  silva', dias: DIAS })).status).toBe(200);
    expect(aplicadas).toEqual([{ envioId: id, funcionario: 'MARIA SILVA', dias: 1 }]);
    expect((await (await listar('clienteA1')).json()).envios[0]).toMatchObject({ situacao: 'aplicada' });

    // Aplicada: não aplica de novo, não devolve, e o cliente não exclui.
    expect((await patch('contadorA', { id, acao: 'aplicar', dias: DIAS })).status).toBe(409);
    expect((await patch('contadorA', { id, acao: 'devolver', motivo: 'tarde demais' })).status).toBe(409);
    expect((await rota.DELETE(await pedido('clienteA1', `/api/envio-ponto?id=${id}`, { method: 'DELETE' }))).status).toBe(409);
    expect(aplicadas).toHaveLength(1);

    // Desfazer a aplicação volta para a conferência.
    expect((await patch('contadorA', { id, acao: 'desfazer-aplicacao' })).status).toBe(200);
    expect(envios.get(id)!.situacao).toBe('lida');
  });
});

describe('fluxo: folha enviada pelo cliente → devolvida', () => {
  it('a contadora devolve com motivo; o cliente vê o motivo; desfazer reabre', async () => {
    const id = await enviarComoCliente();
    await patch('contadorA', { id, acao: 'ler' });
    const motivo = 'Foto cortada: faltam os dias 20 a 31';
    expect((await patch('contadorA', { id, acao: 'devolver', motivo })).status).toBe(200);

    const doCliente = await (await listar('clienteA1')).json();
    expect(doCliente.envios[0]).toMatchObject({ id, situacao: 'devolvida', motivo });
    // Devolvida não se aplica (o cliente reenvia).
    expect((await patch('contadorA', { id, acao: 'aplicar', dias: DIAS })).status).toBe(409);
    expect(aplicadas).toHaveLength(0);
    // O cliente pode excluir a devolvida e mandar outra foto.
    expect((await patch('contadorA', { id, acao: 'desfazer-devolucao' })).status).toBe(200);
    expect(envios.get(id)).toMatchObject({ situacao: 'lida', motivo: null });
  });
});

describe('isolamento nas rotas do envio (guardas reais)', () => {
  it('contador de OUTRO escritório não vê, não lê, não aplica, não devolve nem exclui', async () => {
    const id = await enviarComoCliente();
    expect((await listar('contadorB', 'emp-a1')).status).toBe(403);
    for (const acao of [{ acao: 'ler' }, { acao: 'aplicar', dias: DIAS }, { acao: 'devolver', motivo: 'qualquer motivo' }]) {
      expect((await patch('contadorB', { id, ...acao })).status).toBe(404);
    }
    expect((await foto.GET(await pedido('contadorB', `/api/envio-ponto/foto?id=${id}`))).status).toBe(404);
    expect((await rota.DELETE(await pedido('contadorB', `/api/envio-ponto?id=${id}`, { method: 'DELETE' }))).status).toBe(404);
    expect(envios.get(id)).toMatchObject({ situacao: 'recebida', excluidoEm: null });
  });

  it('cliente de OUTRA empresa do mesmo escritório não vê nem mexe', async () => {
    const id = await enviarComoCliente();
    expect((await listar('clienteA2', 'emp-a1')).status).toBe(403);
    expect((await (await listar('clienteA2')).json()).envios).toEqual([]);
    expect((await foto.GET(await pedido('clienteA2', `/api/envio-ponto/foto?id=${id}`))).status).toBe(404);
    expect((await rota.DELETE(await pedido('clienteA2', `/api/envio-ponto?id=${id}`, { method: 'DELETE' }))).status).toBe(404);
    expect((await patch('clienteA2', { id, acao: 'confirmar' })).status).toBe(404);
    // E não envia folha em nome da A1.
    const r = await rota.POST(await pedido('clienteA2', '/api/envio-ponto', {
      method: 'POST', body: { empresa: 'emp-a1', ano: ANO, mes: MES, funcionario: 'maria silva', nome: 'f.jpg', tamanho: 10, tipo: 'image/jpeg' },
    }));
    expect(r.status).toBe(403);
    expect(envios.size).toBe(1);
  });

  it('o próprio cliente não aplica nem devolve (é trabalho da contabilidade)', async () => {
    const id = await enviarComoCliente();
    expect((await patch('clienteA1', { id, acao: 'aplicar', dias: DIAS })).status).toBe(403);
    expect((await patch('clienteA1', { id, acao: 'devolver', motivo: 'eu mesmo' })).status).toBe(403);
    expect(envios.get(id)!.situacao).toBe('recebida');
  });

  it('empresa arquivada: a contabilidade não aplica, não devolve nem exclui (409); o cliente dela não entra (403)', async () => {
    const id = envioSemeado('emp-arq');
    for (const r of [
      await patch('contadorA', { id, acao: 'aplicar', dias: DIAS }),
      await patch('contadorA', { id, acao: 'devolver', motivo: 'motivo qualquer' }),
      await rota.DELETE(await pedido('contadorA', `/api/envio-ponto?id=${id}`, { method: 'DELETE' })),
    ]) {
      expect(r.status).toBe(409);
      expect((await r.json()).erro).toMatch(/arquivada/i);
    }
    expect((await listar('clienteArq')).status).toBe(403);
    const r = await rota.POST(await pedido('clienteArq', '/api/envio-ponto', {
      method: 'POST', body: { ano: ANO, mes: MES, funcionario: 'maria silva', nome: 'f.jpg', tamanho: 10, tipo: 'image/jpeg' },
    }));
    expect(r.status).toBe(403);
    expect((await foto.GET(await pedido('clienteArq', `/api/envio-ponto/foto?id=${id}`))).status).toBe(403);
    expect(envios.get(id)).toMatchObject({ situacao: 'lida', excluidoEm: null });
    expect(aplicadas).toHaveLength(0);
  });
});
