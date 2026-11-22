// Documentos de mão dupla (Sprint 17 · Frente A, migração 0032) pelas rotas, com as
// guardas REAIS de lib/acesso.ts (cookie assinado). Simulados: o cadastro (empresas),
// o banco (tests/bancoFalso.ts, em memória) e o Storage (objetos num Map).
//
//   1. Entregas (escritório → cliente): a contadora publica → o cliente vê e baixa →
//      fica "aberto em" (só a primeira abertura do cliente; a da contadora não conta).
//   2. Situação do documento do cliente: recebido → aceito / devolvido com motivo (o
//      pedido ligado reabre; desfazer atende de novo).
//   3. "Não tenho este mês" no pedido, e desfazer.
//   4. Sino do cliente: aviso da entrega e da devolução, sem título nem nome de arquivo.
// E o isolamento em cada uma: outro escritório, outra empresa do mesmo escritório,
// cliente em ação da contabilidade, empresa arquivada (contabilidade lê, ninguém
// grava; cliente dela 403) — sempre conferindo que nada foi gravado.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bancoFalso, type BancoFalso } from './bancoFalso';
import { ESC_A, pedido, type QuemTeste } from './rotaTeste';

type Linha = Record<string, unknown>;
let tabelas: Record<string, Linha[]>;
let banco: BancoFalso & { storage?: unknown };
let objetos: Map<string, Uint8Array>;

vi.mock('@/lib/cadastro', async (orig) => {
  const { cadastroFalso, empresasTeste } = await import('./rotaTeste');
  const empresas = empresasTeste();
  return { ...(await orig<object>()), ...cadastroFalso(() => empresas) };
});
vi.mock('@/lib/db', async (orig) => ({ ...(await orig<object>()), getDb: () => banco }));
// O sino do cliente também lê folhas de ponto: fora do escopo aqui.
vi.mock('@/lib/envioPontoServidor', async (orig) => ({ ...(await orig<object>()), listarEnvios: async () => [] }));

const entregas = await import('@/app/api/entregas/route');
const entregaArquivo = await import('@/app/api/entregas/arquivo/route');
const documentos = await import('@/app/api/documentos/route');
const pendencias = await import('@/app/api/pendencias/route');
const notificacoes = await import('@/app/api/notificacoes/route');

const PDF = new TextEncoder().encode('%PDF-1.4\n% teste\n');
const DOC_A1 = '11111111-1111-4111-8111-111111111111';
const PEND_A1 = '22222222-2222-4222-8222-222222222222';
const PEND_ARQ = '33333333-3333-4333-8333-333333333333';
const ENT_ARQ = '44444444-4444-4444-8444-444444444444';

function storageFalso() {
  return {
    from: () => ({
      createSignedUploadUrl: async (c: string) => ({ data: { signedUrl: `https://storage.teste/up/${c}` }, error: null }),
      download: async (c: string) => (objetos.has(c)
        ? { data: new Blob([objetos.get(c)! as BlobPart]), error: null }
        : { data: null, error: { message: 'não existe' } }),
      createSignedUrl: async (c: string, _s: number, o: { download: string }) =>
        ({ data: { signedUrl: `https://storage.teste/${c}?download=${encodeURIComponent(o.download)}` }, error: null }),
      remove: async (cs: string[]) => { cs.forEach((c) => objetos.delete(c)); return { data: null, error: null }; },
    }),
  };
}

function novoBanco() {
  objetos = new Map();
  tabelas = {
    documentos: [{
      id: DOC_A1, empresa_id: 'emp-a1', escritorio_id: ESC_A, competencia: '2026-10', categoria: 'extrato',
      caminho: `${ESC_A}/${DOC_A1}.pdf`, nome_original: 'extrato-maria.pdf', tamanho: 100, tipo: 'application/pdf',
      observacao: null, pendencia_id: PEND_A1, status: 'recebido', enviado_por: 'cli@a1.com',
      enviado_em: '2026-11-05T12:00:00.000Z', excluido_em: null, excluido_por_gestor: false,
    }],
    pendencias: [
      {
        id: PEND_A1, empresa_id: 'emp-a1', escritorio_id: ESC_A, titulo: 'Extrato de outubro', categoria: 'extrato',
        competencia: '2026-10', prazo: null, status: 'atendida', atendida_em: '2026-11-05T12:00:00.000Z', atendida_por: 'cli@a1.com',
        criado_por: 'c@a.com', criado_em: '2026-11-01T12:00:00.000Z', excluido_em: null,
      },
      {
        id: PEND_ARQ, empresa_id: 'emp-arq', escritorio_id: ESC_A, titulo: 'Notas de maio', categoria: 'nota',
        competencia: '2026-05', prazo: null, status: 'aberta', criado_por: 'c@a.com', criado_em: '2026-06-01T12:00:00.000Z', excluido_em: null,
      },
    ],
    entregas: [{
      id: ENT_ARQ, empresa_id: 'emp-arq', escritorio_id: ESC_A, tipo: 'das', titulo: 'DAS de maio', competencia: '2026-05',
      vencimento: '2026-06-20', observacao: null, caminho: `${ESC_A}/entregas/${ENT_ARQ}.pdf`, nome_original: 'das.pdf',
      tamanho: 100, mime: 'application/pdf', status: 'publicada', publicado_por: 'c@a.com', publicado_em: '2026-06-01T12:00:00.000Z',
      aberto_em: null, aberto_por: null, excluido_em: null,
    }],
  };
  banco = bancoFalso(tabelas, 1000, {
    aoGravar: {
      entregas: (l) => { l.publicado_em ??= new Date().toISOString(); l.aberto_em ??= null; l.aberto_por ??= null; l.excluido_em ??= null; },
      documentos: (l) => { l.enviado_em ??= new Date().toISOString(); },
    },
  });
  banco.storage = storageFalso();
}
beforeEach(novoBanco);

const json = async (r: Response) => r.json();
const estado = () => JSON.stringify(tabelas);

// ------------------------------------------------------------------ helpers de rota
const publicar = async (quem: QuemTeste, corpo: Record<string, unknown>) =>
  entregas.POST(await pedido(quem, '/api/entregas', {
    method: 'POST',
    body: { tipo: 'das', competencia: '2026-10', nome: 'DAS outubro.pdf', tamanho: PDF.length, mime: 'application/pdf', ...corpo },
  }));
const confirmarEntrega = async (quem: QuemTeste, id: string) =>
  entregas.PATCH(await pedido(quem, '/api/entregas', { method: 'PATCH', body: { id, acao: 'confirmar' } }));
const listarEntregas = async (quem: QuemTeste, empresa?: string) =>
  entregas.GET(await pedido(quem, `/api/entregas${empresa ? `?empresa=${empresa}` : ''}`));
const baixar = async (quem: QuemTeste, id: string) => entregaArquivo.GET(await pedido(quem, `/api/entregas/arquivo?id=${id}`));
const situacao = async (quem: QuemTeste, acao: string, extra: Record<string, unknown> = {}) =>
  documentos.PATCH(await pedido(quem, '/api/documentos', { method: 'PATCH', body: { id: DOC_A1, acao, ...extra } }));
const naoTenho = async (quem: QuemTeste, id: string, acao = 'nao-tenho', observacao?: string) =>
  pendencias.PATCH(await pedido(quem, '/api/pendencias', { method: 'PATCH', body: { id, acao, observacao } }));

/** A contadora A publica um DAS para a emp-a1, subindo os bytes, e devolve o id. */
async function publicarParaA1(corpo: Record<string, unknown> = {}): Promise<string> {
  const r = await publicar('contadorA', { empresa: 'emp-a1', titulo: 'DAS da Maria', vencimento: '2026-12-20', ...corpo });
  expect(r.status).toBe(200);
  const { id, url } = await json(r);
  expect(url).toContain(`${ESC_A}/entregas/${id}.pdf`);
  objetos.set(`${ESC_A}/entregas/${id}.pdf`, PDF);
  expect((await confirmarEntrega('contadorA', id)).status).toBe(200);
  return id;
}
const linhaEntrega = (id: string) => tabelas.entregas.find((e) => e.id === id)!;

// ======================================================================== 1. entregas
describe('entregas: a contadora publica, o cliente abre, fica registrado', () => {
  it('ponta a ponta: publicar → cliente vê → baixa → "aberto em" só na primeira vez', async () => {
    const id = await publicarParaA1();
    expect(linhaEntrega(id)).toMatchObject({ status: 'publicada', escritorio_id: ESC_A, empresa_id: 'emp-a1', aberto_em: null });

    // O cliente vê, sem o caminho interno e sem o e-mail de quem publicou.
    const lista = await json(await listarEntregas('clienteA1'));
    expect(lista.entregas).toHaveLength(1);
    expect(lista.entregas[0]).toMatchObject({ id, tipo: 'das', titulo: 'DAS da Maria', abertoEm: null, publicadoPor: '' });
    expect(JSON.stringify(lista)).not.toContain('/entregas/');
    expect(JSON.stringify(lista)).not.toContain('c@a.com');

    // A contadora baixa para conferir: 302, mas NÃO conta como aberto.
    expect((await baixar('contadorA', id)).status).toBe(302);
    expect(linhaEntrega(id).aberto_em).toBeNull();

    // O cliente baixa: 302 para a URL assinada (anexo, sem cache) e "aberto em" gravado.
    const r = await baixar('clienteA1', id);
    expect(r.status).toBe(302);
    expect(r.headers.get('location')).toContain('download=');
    expect(r.headers.get('cache-control')).toBe('no-store');
    const primeira = linhaEntrega(id).aberto_em;
    expect(primeira).toBeTruthy();
    expect(linhaEntrega(id).aberto_por).toBe('cli@a1.com');

    // Abrir de novo não muda a data.
    await new Promise((ok) => setTimeout(ok, 5));
    expect((await baixar('clienteA1', id)).status).toBe(302);
    expect(linhaEntrega(id).aberto_em).toBe(primeira);

    // Link vindo de outro site (Sec-Fetch-Site: cross-site): baixa, mas não conta como abertura.
    const id2 = await publicarParaA1({ titulo: 'Outro' });
    const deFora = await pedido('clienteA1', `/api/entregas/arquivo?id=${id2}`);
    deFora.headers.set('sec-fetch-site', 'cross-site');
    expect((await entregaArquivo.GET(deFora)).status).toBe(302);
    expect(linhaEntrega(id2).aberto_em).toBeNull();
    const peloPortal = await pedido('clienteA1', `/api/entregas/arquivo?id=${id2}`);
    peloPortal.headers.set('sec-fetch-site', 'same-origin');
    await entregaArquivo.GET(peloPortal);
    expect(linhaEntrega(id2).aberto_em).toBeTruthy();

    // A contadora vê quem abriu e quando.
    const daContadora = await json(await listarEntregas('contadorA', 'emp-a1'));
    expect(daContadora.entregas.find((x: { id: string }) => x.id === id)).toMatchObject({ abertoEm: primeira, abertoPor: 'cli@a1.com' });
  });

  it('"ainda não abertos" do escritório: só da contabilidade e só do escritório dela', async () => {
    const id = await publicarParaA1();
    const r = await json(await entregas.GET(await pedido('contadorA', '/api/entregas?visao=nao-abertas')));
    // A arquivada não entra (a lista é das empresas ativas visíveis).
    expect(r.entregas.map((e: { id: string }) => e.id)).toEqual([id]);
    expect(r.entregas[0].empresaNome).toBe('Padaria A1');

    expect((await json(await entregas.GET(await pedido('contadorB', '/api/entregas?visao=nao-abertas')))).entregas).toEqual([]);
    expect((await entregas.GET(await pedido('clienteA1', '/api/entregas?visao=nao-abertas'))).status).toBe(403);

    await baixar('clienteA1', id);
    expect((await json(await entregas.GET(await pedido('contadorA', '/api/entregas?visao=nao-abertas')))).entregas).toEqual([]);
  });

  it('bytes que não batem com o tipo: recusa, apaga o objeto e o cliente não vê', async () => {
    const r = await publicar('contadorA', { empresa: 'emp-a1' });
    const { id } = await json(r);
    objetos.set(`${ESC_A}/entregas/${id}.pdf`, new TextEncoder().encode('<html>não é pdf</html>'));
    expect((await confirmarEntrega('contadorA', id)).status).toBe(422);
    expect(linhaEntrega(id).status).toBe('rejeitada');
    expect(objetos.has(`${ESC_A}/entregas/${id}.pdf`)).toBe(false);
    expect((await json(await listarEntregas('clienteA1'))).entregas).toEqual([]);
    expect((await baixar('clienteA1', id)).status).toBe(404);
  });

  it('enviando (antes de confirmar) não aparece nem baixa', async () => {
    const { id } = await json(await publicar('contadorA', { empresa: 'emp-a1' }));
    expect((await json(await listarEntregas('clienteA1'))).entregas).toEqual([]);
    expect((await baixar('clienteA1', id)).status).toBe(404);
  });

  it('campos inválidos: 400 com o erro por campo, nada gravado', async () => {
    const antes = estado();
    const r = await publicar('contadorA', { empresa: 'emp-a1', tipo: 'boleto', competencia: '2026-13', vencimento: '2026-02-30' });
    expect(r.status).toBe(400);
    expect((await json(r)).campos).toMatchObject({ tipo: expect.any(String), competencia: expect.any(String), vencimento: expect.any(String) });
    const r2 = await publicar('contadorA', { empresa: 'emp-a1', nome: 'virus.exe' });
    expect(r2.status).toBe(400);
    expect(estado()).toBe(antes);
  });

  it('excluir com desfazer: some para o cliente e volta', async () => {
    const id = await publicarParaA1();
    expect((await entregas.DELETE(await pedido('contadorA', `/api/entregas?id=${id}`, { method: 'DELETE' }))).status).toBe(200);
    expect((await json(await listarEntregas('clienteA1'))).entregas).toEqual([]);
    expect((await baixar('clienteA1', id)).status).toBe(404);
    expect((await entregas.PATCH(await pedido('contadorA', '/api/entregas', { method: 'PATCH', body: { id, acao: 'restaurar' } }))).status).toBe(200);
    expect((await json(await listarEntregas('clienteA1'))).entregas).toHaveLength(1);
  });
});

describe('entregas: isolamento', () => {
  it('outro escritório: não lista (403), não baixa, não exclui nem confirma (404) — e nada muda', async () => {
    const id = await publicarParaA1();
    const antes = estado();
    expect((await listarEntregas('contadorB', 'emp-a1')).status).toBe(403);
    expect((await baixar('contadorB', id)).status).toBe(404);
    expect((await entregas.DELETE(await pedido('contadorB', `/api/entregas?id=${id}`, { method: 'DELETE' }))).status).toBe(404);
    expect((await confirmarEntrega('contadorB', id)).status).toBe(404);
    expect((await publicar('contadorB', { empresa: 'emp-a1' })).status).toBe(403);
    expect(estado()).toBe(antes);
  });

  it('outra empresa do mesmo escritório: o cliente da A2 não lista nem abre o da A1 (e não marca como aberto)', async () => {
    const id = await publicarParaA1();
    expect((await listarEntregas('clienteA2', 'emp-a1')).status).toBe(403);
    expect((await json(await listarEntregas('clienteA2'))).entregas).toEqual([]);
    expect((await baixar('clienteA2', id)).status).toBe(404);
    expect(linhaEntrega(id).aberto_em).toBeNull();
  });

  it('cliente não publica, não confirma, não exclui nem restaura', async () => {
    const id = await publicarParaA1();
    const antes = estado();
    expect((await publicar('clienteA1', {})).status).toBe(403);
    expect((await publicar('clienteA1', { empresa: 'emp-a1' })).status).toBe(403);
    expect((await confirmarEntrega('clienteA1', id)).status).toBe(403);
    expect((await entregas.DELETE(await pedido('clienteA1', `/api/entregas?id=${id}`, { method: 'DELETE' }))).status).toBe(403);
    expect((await entregas.PATCH(await pedido('clienteA1', '/api/entregas', { method: 'PATCH', body: { id, acao: 'restaurar' } }))).status).toBe(403);
    expect(estado()).toBe(antes);
  });

  it('confirmar é só de quem iniciou a publicação', async () => {
    const { id } = await json(await publicar('contadorA', { empresa: 'emp-a1' }));
    objetos.set(`${ESC_A}/entregas/${id}.pdf`, PDF);
    // Outra pessoa do mesmo escritório vê o registro, mas não confirma o envio alheio.
    expect((await confirmarEntrega('contador2A', id)).status).toBe(403);
    expect((await confirmarEntrega('contadorB', id)).status).toBe(404);
    expect(linhaEntrega(id).status).toBe('enviando');
  });

  it('empresa arquivada: a contabilidade lista e baixa; publicar e excluir dão 409; o cliente dela leva 403', async () => {
    const antes = estado();
    const lista = await listarEntregas('contadorA', 'emp-arq');
    expect(lista.status).toBe(200);
    expect((await json(lista)).entregas.map((e: { id: string }) => e.id)).toEqual([ENT_ARQ]);
    expect((await baixar('contadorA', ENT_ARQ)).status).toBe(302);

    const pub = await publicar('contadorA', { empresa: 'emp-arq' });
    expect(pub.status).toBe(409);
    expect((await json(pub)).erro).toMatch(/arquivada/i);
    expect((await entregas.DELETE(await pedido('contadorA', `/api/entregas?id=${ENT_ARQ}`, { method: 'DELETE' }))).status).toBe(409);

    expect((await listarEntregas('clienteArq')).status).toBe(403);
    expect((await baixar('clienteArq', ENT_ARQ)).status).toBe(403);
    expect(estado()).toBe(antes); // nem o "aberto em" foi gravado
  });

  it('outro escritório não descobre que a empresa está arquivada', async () => {
    const r = await listarEntregas('contadorB', 'emp-arq');
    expect(r.status).toBe(403);
    expect((await json(r)).erro).not.toMatch(/arquivada/i);
    expect((await baixar('contadorB', ENT_ARQ)).status).toBe(404);
  });

  it('sem sessão: 401', async () => {
    expect((await entregas.GET(await pedido(null, '/api/entregas?empresa=emp-a1'))).status).toBe(401);
    expect((await entregaArquivo.GET(await pedido(null, `/api/entregas/arquivo?id=${ENT_ARQ}`))).status).toBe(401);
  });
});

// ======================================================================== 2. situação
const doc = () => tabelas.documentos.find((d) => d.id === DOC_A1)!;
const pend = (id = PEND_A1) => tabelas.pendencias.find((p) => p.id === id)!;

describe('situação do documento enviado pelo cliente', () => {
  it('devolver exige motivo; devolvido: o cliente vê o motivo, o pedido reabre; desfazer atende de novo', async () => {
    const semMotivo = await situacao('contadorA', 'devolver', { motivo: ' ' });
    expect(semMotivo.status).toBe(400);
    expect(doc().status).toBe('recebido');

    const r = await situacao('contadorA', 'devolver', { motivo: 'Faltou a segunda página do extrato.' });
    expect(r.status).toBe(200);
    expect(doc()).toMatchObject({ status: 'devolvido', devolvido_por: 'c@a.com', motivo_devolucao: 'Faltou a segunda página do extrato.' });
    // Devolver não atende o pedido: sem outro envio vivo, ele reabre.
    expect(pend()).toMatchObject({ status: 'aberta', atendida_em: null });

    // O devolvido continua baixável (o cliente confere o que mandou; a contabilidade, o que devolveu).
    const { GET: baixarDoc } = await import('@/app/api/documentos/arquivo/route');
    expect((await baixarDoc(await pedido('clienteA1', `/api/documentos/arquivo?id=${DOC_A1}`))).status).toBe(302);
    expect((await baixarDoc(await pedido('contadorA', `/api/documentos/arquivo?id=${DOC_A1}`))).status).toBe(302);

    const doCliente = await json(await documentos.GET(await pedido('clienteA1', '/api/documentos')));
    expect(doCliente.documentos[0]).toMatchObject({ status: 'devolvido', motivoDevolucao: 'Faltou a segunda página do extrato.', devolvidoPor: null });

    // Desfazer (voltar para "a conferir"): limpa a devolução e o pedido volta a atendido.
    expect((await situacao('contadorA', 'desconferir')).status).toBe(200);
    expect(doc()).toMatchObject({ status: 'recebido', devolvido_em: null, motivo_devolucao: null });
    expect(pend().status).toBe('atendida');
  });

  it('aceitar → aceito; aceitar de novo é 403 (transição inexistente); de aceito dá para devolver', async () => {
    expect((await situacao('contadorA', 'conferir')).status).toBe(200);
    expect(doc()).toMatchObject({ status: 'conferido', conferido_por: 'c@a.com' });
    expect((await situacao('contadorA', 'conferir')).status).toBe(403);
    expect((await situacao('contadorA', 'devolver', { motivo: 'Era de outra conta.' })).status).toBe(200);
    expect(doc()).toMatchObject({ status: 'devolvido', conferido_por: null });
    // O cliente não exclui o que foi devolvido (fica como histórico).
    expect((await documentos.DELETE(await pedido('clienteA1', `/api/documentos?id=${DOC_A1}`, { method: 'DELETE' }))).status).toBe(403);
  });

  it('cliente não muda a situação; outro escritório e outra empresa nem enxergam', async () => {
    const antes = estado();
    expect((await situacao('clienteA1', 'devolver', { motivo: 'teste teste' })).status).toBe(403);
    expect((await situacao('clienteA1', 'conferir')).status).toBe(403);
    expect((await situacao('contadorB', 'devolver', { motivo: 'teste teste' })).status).toBe(404);
    expect((await situacao('clienteA2', 'conferir')).status).toBe(404);
    expect(estado()).toBe(antes);
  });
});

// ======================================================================== 3. não tenho
describe('"Não tenho este mês" no pedido', () => {
  it('o cliente responde (com observação); o pedido sai de aberto; desfazer reabre', async () => {
    pend().status = 'aberta'; pend().atendida_em = null; pend().atendida_por = null;
    const r = await naoTenho('clienteA1', PEND_A1, 'nao-tenho', '  A conta ficou parada em outubro.  ');
    expect(r.status).toBe(200);
    const j = await json(r);
    expect(j.pendencia).toMatchObject({ status: 'atendida', semMovimentoObs: 'A conta ficou parada em outubro.', semMovimentoPor: null });
    expect(pend()).toMatchObject({ status: 'atendida', sem_movimento_por: 'cli@a1.com', atendida_por: 'cli@a1.com' });
    expect(pend().sem_movimento_em).toBeTruthy();

    // Repetir: o pedido já não está aberto → 409, nada muda.
    const antes = estado();
    expect((await naoTenho('clienteA1', PEND_A1)).status).toBe(409);
    expect(estado()).toBe(antes);

    expect((await naoTenho('clienteA1', PEND_A1, 'desfazer-nao-tenho')).status).toBe(200);
    expect(pend()).toMatchObject({ status: 'aberta', sem_movimento_em: null, atendida_em: null });
  });

  it('pedido atendido com arquivo não vira "não tenho" nem é "desfeito" como se fosse', async () => {
    const antes = estado();
    expect((await naoTenho('clienteA1', PEND_A1)).status).toBe(409);
    expect((await naoTenho('clienteA1', PEND_A1, 'desfazer-nao-tenho')).status).toBe(409);
    expect(estado()).toBe(antes);
  });

  it('isolamento: outra empresa e outro escritório não alcançam; arquivada: cliente 403, contabilidade 409', async () => {
    pend().status = 'aberta';
    const antes = estado();
    expect((await naoTenho('clienteA2', PEND_A1)).status).toBe(404);
    expect((await naoTenho('contadorB', PEND_A1)).status).toBe(404);
    expect((await naoTenho('clienteArq', PEND_ARQ)).status).toBe(403);
    const r = await naoTenho('contadorA', PEND_ARQ);
    expect(r.status).toBe(409);
    expect((await json(r)).erro).toMatch(/arquivada/i);
    expect(estado()).toBe(antes);
  });

  it('o cliente continua sem as ações da contabilidade no pedido (fechar, editar, excluir)', async () => {
    const antes = estado();
    expect((await naoTenho('clienteA1', PEND_A1, 'fechar')).status).toBe(403);
    expect((await naoTenho('clienteA1', PEND_A1, 'reabrir')).status).toBe(403);
    expect((await pendencias.DELETE(await pedido('clienteA1', `/api/pendencias?id=${PEND_A1}`, { method: 'DELETE' }))).status).toBe(403);
    expect(estado()).toBe(antes);
  });

  it('o checklist de fechamento deixa de contar o pedido como atrasado', async () => {
    const { fontesDoFechamento } = await import('@/lib/fechamentoServidor');
    const { checklistDaEmpresa } = await import('@/lib/fechamento');
    pend().status = 'aberta'; pend().atendida_em = null;
    const ler = async () => {
      const f = await fontesDoFechamento({ empresaIds: ['emp-a1'], escritorioId: ESC_A }, 2026, 10, '2026-10', { comCaixa: false, escopoAgenda: null });
      return checklistDaEmpresa({
        empresaId: 'emp-a1', nome: 'Padaria A1', caixa: { ok: true, dados: null },
        documentos: { ok: true, dados: f.documentos.get('emp-a1') ?? null }, obrigacoes: { ok: true, dados: null },
      }, '2026-10').etapas.find((e) => e.chave === 'documentos')!;
    };
    expect((await ler()).estado).toBe('falta');
    await naoTenho('clienteA1', PEND_A1, 'nao-tenho');
    expect((await ler()).estado).toBe('ok');
  });

  it('o "não tenho" não gruda: devolver o arquivo antigo não reabre, e atender com arquivo não deixa "desfazer"', async () => {
    // A contadora reabre o pedido (atendido pelo extrato), o cliente responde "não tenho".
    expect((await naoTenho('contadorA', PEND_A1, 'reabrir')).status).toBe(200);
    expect((await naoTenho('clienteA1', PEND_A1)).status).toBe(200);
    // Devolver o extrato antigo NÃO reabre um pedido fechado pelo "não tenho".
    expect((await situacao('contadorA', 'devolver', { motivo: 'Era de setembro.' })).status).toBe(200);
    expect(pend()).toMatchObject({ status: 'atendida' });
    expect(pend().sem_movimento_em).toBeTruthy();
    // A contadora fecha à mão: a marca some, e o cliente não "desfaz" o fechamento dela.
    expect((await naoTenho('contadorA', PEND_A1, 'fechar')).status).toBe(200);
    expect(pend()).toMatchObject({ status: 'atendida', sem_movimento_em: null });
    expect((await naoTenho('clienteA1', PEND_A1, 'desfazer-nao-tenho')).status).toBe(409);
    expect(pend().status).toBe('atendida');
  });

  it('a contabilidade reabrir apaga o "não tenho"', async () => {
    pend().status = 'aberta';
    await naoTenho('clienteA1', PEND_A1, 'nao-tenho', 'sem movimento');
    expect((await naoTenho('contadorA', PEND_A1, 'reabrir')).status).toBe(200);
    expect(pend()).toMatchObject({ status: 'aberta', sem_movimento_em: null, sem_movimento_obs: null });
  });
});

// ======================================================================== 4. sino do cliente
describe('sino do cliente: entrega nova e documento devolvido, sem dado pessoal', () => {
  it('avisa a entrega (sem título nem nome de arquivo) e a devolução (sem nome de arquivo nem motivo); some ao abrir', async () => {
    const id = await publicarParaA1({ titulo: 'Holerite da Maria Souza', nome: 'holerite-maria-souza.pdf', vencimento: null });
    await situacao('contadorA', 'devolver', { motivo: 'Extrato ilegível.' });
    const sino = await json(await notificacoes.GET(await pedido('clienteA1', '/api/notificacoes')));
    const tipos = sino.itens.map((i: { tipo: string }) => i.tipo).sort();
    expect(tipos).toEqual(['documento_devolvido', 'entrega']);
    const texto = JSON.stringify(sino);
    expect(texto).not.toMatch(/maria/i);
    expect(texto).not.toContain('Extrato ilegível.'); // o motivo é texto livre: fica na tela, não no sino
    expect(texto).toContain('Veja o motivo em Documentos.');
    expect(sino.indisponiveis).toEqual([]);

    await baixar('clienteA1', id);
    const depois = await json(await notificacoes.GET(await pedido('clienteA1', '/api/notificacoes')));
    expect(depois.itens.map((i: { tipo: string }) => i.tipo)).toEqual(['documento_devolvido']);

    // O cliente de outra empresa não recebe nada disso.
    const outro = await json(await notificacoes.GET(await pedido('clienteA2', '/api/notificacoes')));
    expect(outro.itens).toEqual([]);
  });
});
