// Contrato de /api/caixa/documento-ia e do vínculo do documento no lançamento:
// travas (plataforma 503, empresa/saúde 403), isolamento entre escritórios e
// empresas, cota e o que vai para o Gemini. O Gemini é SIMULADO (vi.mock de
// @google/genai) — nenhum documento sai daqui.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import type { Sessao } from '@/lib/auth';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const DOC = '11111111-2222-4333-8444-555555555555';

const exp = Date.now() + 3_600_000;
const SESSOES: Record<string, Sessao> = {
  contadorA: { email: 'c@a.com', nome: 'A', role: 'usuario', escritorioId: A, exp, modulos: ['caixa'] },
  contadorB: { email: 'c@b.com', nome: 'B', role: 'usuario', escritorioId: B, exp, modulos: ['caixa'] },
  clienteA1: { email: 'cli@a1.com', nome: 'A1', role: 'cliente', escritorioId: A, empresa: 'emp-a1', exp },
  clienteA2: { email: 'cli@a2.com', nome: 'A2', role: 'cliente', escritorioId: A, empresa: 'emp-a2', exp },
};
let sessaoAtual: Sessao | null = null;
const como = (k: keyof typeof SESSOES) => { sessaoAtual = SESSOES[k]; };

type EmpresaTeste = { id: string; nome: string; escritorioId: string; iaDocumento?: boolean; identificaPagador?: boolean; trabalhaSabado: boolean };
let EMPRESAS: Record<string, EmpresaTeste>;
const empresasBase = (): Record<string, EmpresaTeste> => ({
  'emp-a1': { id: 'emp-a1', nome: 'Padaria Secreta LTDA', escritorioId: A, iaDocumento: true, trabalhaSabado: false },
  'emp-a2': { id: 'emp-a2', nome: 'A2', escritorioId: A, iaDocumento: true, trabalhaSabado: false },
  'emp-a3': { id: 'emp-a3', nome: 'Clínica', escritorioId: A, iaDocumento: true, identificaPagador: true, trabalhaSabado: false },
  'emp-b1': { id: 'emp-b1', nome: 'B1', escritorioId: B, iaDocumento: true, trabalhaSabado: false },
});

const definirIaDocumento = vi.fn(async () => {});
vi.mock('@/lib/cadastro', () => ({
  lerEmpresa: async (id: string) => EMPRESAS[id] ?? null,
  lerEmpresas: async () => Object.values(EMPRESAS),
  lerEmpresasComArquivadas: async () => Object.values(EMPRESAS),
  buscarUsuario: async () => null,
  definirIaDocumento: (...a: unknown[]) => definirIaDocumento(...(a as [])),
}));

vi.mock('@/lib/acesso', async (orig) => {
  const real = await orig<typeof import('@/lib/acesso')>();
  const negar = (msg: string, status: number) => ({ ok: false as const, resposta: Response.json({ erro: msg }, { status }) });
  return {
    ...real,
    sessaoDe: async () => sessaoAtual,
    exigirSessao: async () => (sessaoAtual ? { ok: true as const, sessao: sessaoAtual } : negar('Não autenticado.', 401)),
    exigirGestor: async () => {
      if (!sessaoAtual) return negar('Não autenticado.', 401);
      if (!real.ehGestor(sessaoAtual)) return negar('Acesso restrito.', 403);
      return { ok: true as const, sessao: sessaoAtual };
    },
    exigirEmpresa: async (_req: unknown, empresaId: string) => {
      if (!sessaoAtual) return negar('Não autenticado.', 401);
      const n = await real.motivoNegado(sessaoAtual, empresaId);
      return n ? negar(n.erro, n.status) : { ok: true as const, sessao: sessaoAtual };
    },
  };
});

const docBase = {
  id: DOC, empresaId: 'emp-a1', escritorioId: A, competencia: '2026-03', categoria: 'nota', caminho: `${A}/${DOC}.pdf`,
  nome: 'nota-do-JOAO-DA-SILVA.pdf', tamanho: 100, tipo: 'application/pdf', observacao: 'cpf 123.456.789-09', pendenciaId: null,
  status: 'recebido', enviadoPor: 'cli@a1.com', enviadoEm: '2026-03-01T00:00:00Z', conferidoPor: null, conferidoEm: null,
  excluidoEm: null as string | null, excluidoPorGestor: false,
};
let docAtual: typeof docBase = { ...docBase };
// Um PDF de verdade, com 5 páginas e autor nos metadados: só 2 páginas, sem o autor, podem ir à IA.
const pdf = await PDFDocument.create();
for (let i = 0; i < 5; i++) pdf.addPage([200, 200]);
pdf.setAuthor('Fulano de Tal');
const PDF5 = await pdf.save();
let bytesDoArquivo: Uint8Array = PDF5;
const baixarArquivo = vi.fn(async () => bytesDoArquivo);
vi.mock('@/lib/documentosServidor', async (orig) => {
  const real = await orig<typeof import('@/lib/documentosServidor')>();
  return {
    ...real,
    lerDocumento: async (id: string) => (id === docAtual.id ? docAtual : null),
    baixarArquivo: (...a: unknown[]) => baixarArquivo(...(a as [])),
  };
});

vi.mock('@/lib/caixa', async (orig) => {
  const real = await orig<typeof import('@/lib/caixa')>();
  return {
    ...real,
    contasDaEmpresa: async () => [{ id: 'c-luz', codigo: '3.1', nome: 'Energia', grupo: '3', natureza: 'despesa', daEmpresa: true, escritorioId: null }],
    historicosDaEmpresa: async () => [{ id: 'h-luz', texto: 'Pago conta de luz', natureza: 'despesa', contaId: 'c-luz', daEmpresa: true, escritorioId: null }],
    garantirExercicio: async () => ({ id: 'ex1', empresaId: 'emp-a1', ano: 2026, saldoInicial: 0 }),
    exigirCatalogoVisivel: async () => {},
    exigirMesAberto: async () => {}, // mês fechado (Sprint 17): coberto em tests/mesFechadoRotas.test.ts
    vincularConta: async () => {},
    vincularHistorico: async () => {},
  };
});

vi.mock('@/lib/escritorios', () => ({ lerEscritorio: async () => ({ plano: 'essencial', situacao: 'ativo' }) }));

let usadas = 0;
let usadasEmpresa = 0;
const cota = {
  contarLeiturasOcr: vi.fn(async () => usadas),
  contarLeiturasDocumentoDoCliente: vi.fn(async () => usadasEmpresa),
  contarTentativasRecentes: vi.fn(async () => 0),
  reservarLeituraOcr: vi.fn(async () => { usadas++; return 'reserva-1'; }),
  confirmarLeituraOcr: vi.fn(async () => {}),
  falharLeituraOcr: vi.fn(async () => {}),
  cancelarLeituraOcr: vi.fn(async () => {}),
};
vi.mock('@/lib/pontoDb', async (orig) => ({ ...(await orig<typeof import('@/lib/pontoDb')>()), ...cota }));

// O Gemini simulado: guarda o que recebeu e devolve uma leitura pronta.
const gemini = vi.fn();
vi.mock('@google/genai', async (orig) => {
  const real = await orig<typeof import('@google/genai')>();
  class GoogleGenAI { models = { generateContent: (p: unknown) => gemini(p) }; }
  return { ...real, GoogleGenAI };
});

// Banco simulado só para o insert de lançamentos.
const inseridos: Record<string, unknown>[][] = [];
vi.mock('@/lib/db', async (orig) => ({
  ...(await orig<typeof import('@/lib/db')>()),
  getDb: () => ({
    from: () => ({
      insert: (linhas: Record<string, unknown>[]) => {
        inseridos.push(linhas);
        return { select: async () => ({ data: linhas.map((l, i) => ({ id: `l${i}`, historico: l.historico, conta_id: l.conta_id })), error: null }) };
      },
    }),
  }),
}));

const rota = await import('@/app/api/caixa/documento-ia/route');
const lancamentos = await import('@/app/api/caixa/lancamentos/route');

const req = (url: string, init?: { method?: string; body?: unknown }) =>
  new NextRequest(`http://x${url}`, {
    method: init?.method ?? 'GET',
    body: init?.body ? JSON.stringify(init.body) : undefined,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
const ler = (empresa = 'emp-a1', extra: Record<string, unknown> = {}) =>
  rota.POST(req('/api/caixa/documento-ia', { method: 'POST', body: { empresa, documento: DOC, ano: 2026, direcao: 'saida', ...extra } }));

const ENV = { CAIXA_IA_DOCUMENTO: process.env.CAIXA_IA_DOCUMENTO, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
const ligarPlataforma = () => { process.env.CAIXA_IA_DOCUMENTO = 'ligada'; process.env.GEMINI_API_KEY = 'chave-de-teste'; };

beforeEach(() => {
  EMPRESAS = empresasBase();
  docAtual = { ...docBase };
  usadas = 0;
  usadasEmpresa = 0;
  bytesDoArquivo = PDF5;
  inseridos.length = 0;
  ligarPlataforma();
  gemini.mockReset();
  gemini.mockResolvedValue({
    text: JSON.stringify({ data: '2026-03-10', valor: 187.4, direcao: 'saida', complemento: 'Conta de luz — Equatorial', indice: 0, confianca: 0.92, legivel: true }),
  });
  [baixarArquivo, definirIaDocumento, ...Object.values(cota)].forEach((f) => f.mockClear());
});
afterEach(() => {
  for (const [k, v] of Object.entries(ENV)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('travas', () => {
  it('plataforma desligada (sem CAIXA_IA_DOCUMENTO): POST 503, GET indisponível, Gemini intocado', async () => {
    delete process.env.CAIXA_IA_DOCUMENTO;
    como('clienteA1');
    const r = await ler();
    expect(r.status).toBe(503);
    expect((await r.json()).erro).toMatch(/não está ligada nesta plataforma/);
    expect(await (await rota.GET(req('/api/caixa/documento-ia?empresa=emp-a1'))).json()).toEqual({ disponivel: false, podeLigar: false });
    expect(gemini).not.toHaveBeenCalled();
    expect(cota.reservarLeituraOcr).not.toHaveBeenCalled();
  });

  it('empresa com a opção desligada (padrão) → 403', async () => {
    EMPRESAS['emp-a1'].iaDocumento = false;
    como('clienteA1');
    const r = await ler();
    expect(r.status).toBe(403);
    expect((await r.json()).erro).toMatch(/não está ligada para esta empresa/);
    expect(gemini).not.toHaveBeenCalled();
  });

  it('empresa de saúde (identifica pagador) nunca usa, mesmo ligada → 403', async () => {
    como('contadorA');
    docAtual = { ...docBase, empresaId: 'emp-a3' };
    expect((await ler('emp-a3')).status).toBe(403);
    expect(gemini).not.toHaveBeenCalled();
  });
});

describe('isolamento', () => {
  it('cliente de outra empresa do mesmo escritório → 403', async () => {
    como('clienteA2');
    expect((await ler('emp-a1')).status).toBe(403);
    expect((await rota.GET(req('/api/caixa/documento-ia?empresa=emp-a1'))).status).toBe(403);
    expect(gemini).not.toHaveBeenCalled();
  });

  it('contador de outro escritório → 403', async () => {
    como('contadorB');
    expect((await ler('emp-a1')).status).toBe(403);
    expect(gemini).not.toHaveBeenCalled();
  });

  it('documento de OUTRA empresa citado na empresa permitida → 404', async () => {
    como('clienteA2');
    expect((await ler('emp-a2')).status).toBe(404); // o documento é da emp-a1
    expect(gemini).not.toHaveBeenCalled();
    expect(baixarArquivo).not.toHaveBeenCalled();
  });

  it('documento gravado em outro escritório (empresa trocada de escritório) → 404', async () => {
    como('contadorB');
    docAtual = { ...docBase, empresaId: 'emp-b1', escritorioId: A };
    expect((await ler('emp-b1')).status).toBe(404);
    expect(gemini).not.toHaveBeenCalled();
  });

  it('documento excluído ou ainda em envio → 404; XML → 415', async () => {
    como('clienteA1');
    docAtual = { ...docBase, excluidoEm: '2026-03-02T00:00:00Z' };
    expect((await ler()).status).toBe(404);
    docAtual = { ...docBase, status: 'enviando' };
    expect((await ler()).status).toBe(404);
    docAtual = { ...docBase, tipo: 'application/xml' };
    expect((await ler()).status).toBe(415);
    expect(gemini).not.toHaveBeenCalled();
  });

  it('extrato e folha nunca vão para a IA, nem chamando a API direto → 415', async () => {
    como('contadorA');
    for (const categoria of ['extrato', 'folha']) {
      docAtual = { ...docBase, categoria };
      expect((await ler()).status).toBe(415);
    }
    expect(baixarArquivo).not.toHaveBeenCalled();
    expect(gemini).not.toHaveBeenCalled();
  });
});

describe('leitura', () => {
  it('devolve a proposta, conta na cota (origem documento) e não manda dados da empresa nem de quem lança', async () => {
    como('clienteA1');
    const r = await ler();
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.proposta).toMatchObject({ data: '2026-03-10', valor: 187.4, direcao: 'saida', contaId: 'c-luz', historicoId: 'h-luz' });
    expect(d.documento).toEqual({ id: DOC, nome: docBase.nome });
    expect(cota.reservarLeituraOcr).toHaveBeenCalledWith(expect.objectContaining({ escritorioId: A, empresaId: 'emp-a1', origem: 'documento' }));
    expect(cota.confirmarLeituraOcr).toHaveBeenCalledWith('reserva-1');

    expect(gemini).toHaveBeenCalledTimes(1);
    // O PDF que foi: 2 páginas, sem o autor do original.
    const parte = (gemini.mock.calls[0][0] as { contents: { parts: { inlineData?: { data: string } }[] }[] }).contents[0].parts[0];
    const enviadoPdf = await PDFDocument.load(Buffer.from(parte.inlineData!.data, 'base64'));
    expect(enviadoPdf.getPageCount()).toBe(2);
    expect(enviadoPdf.getAuthor()).toBeUndefined();
    const enviado = JSON.stringify(gemini.mock.calls[0][0]);
    expect(enviado).toContain('application/pdf');
    expect(enviado).toContain('Pago conta de luz');
    for (const proibido of ['Padaria Secreta', 'cli@a1.com', 'JOAO-DA-SILVA', '123.456.789-09', 'emp-a1', A]) {
      expect(enviado).not.toContain(proibido);
    }
  });

  it('cota esgotada → 429 sem chamar o Gemini', async () => {
    como('contadorA');
    usadas = 150; // limite do plano essencial
    const r = await ler();
    expect(r.status).toBe(429);
    expect((await r.json()).erro).toMatch(/folhas e documentos/);
    expect(gemini).not.toHaveBeenCalled();
    expect(cota.reservarLeituraOcr).not.toHaveBeenCalled();
  });

  it('PDF que não abre (com senha, torto) é recusado antes da cota — nunca vai inteiro', async () => {
    como('clienteA1');
    bytesDoArquivo = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x00]);
    const r = await ler();
    expect(r.status).toBe(415);
    expect((await r.json()).erro).toMatch(/sem senha/);
    expect(cota.reservarLeituraOcr).not.toHaveBeenCalled();
    expect(gemini).not.toHaveBeenCalled();
  });

  it('o cliente tem subcota por empresa (30/mês); a contabilidade não', async () => {
    usadasEmpresa = 30;
    como('clienteA1');
    const r = await ler();
    expect(r.status).toBe(429);
    expect((await r.json()).erro).toMatch(/Esta empresa já usou/);
    expect(gemini).not.toHaveBeenCalled();
    como('contadorA');
    expect((await ler()).status).toBe(200);
  });

  it('a subcota conta só as leituras do cliente: a reserva marca quem leu', async () => {
    como('clienteA1');
    expect((await ler()).status).toBe(200);
    expect(cota.reservarLeituraOcr).toHaveBeenLastCalledWith(expect.objectContaining({ usuario: 'cliente-documento:cli@a1.com' }));
    expect(cota.contarLeiturasDocumentoDoCliente).toHaveBeenCalledWith('emp-a1', expect.any(String));
    // A contabilidade lê sem marca e sem consultar a subcota do cliente.
    cota.contarLeiturasDocumentoDoCliente.mockClear();
    como('contadorA');
    expect((await ler()).status).toBe(200);
    const usuario = (cota.reservarLeituraOcr.mock.lastCall as unknown as [{ usuario: string }])[0].usuario;
    expect(usuario).not.toMatch(/^cliente/);
    expect(cota.contarLeiturasDocumentoDoCliente).not.toHaveBeenCalled();
  });

  it('corrida: dois pedidos do cliente na 30ª leitura — quem passou do limite desfaz a reserva', async () => {
    como('clienteA1');
    // Antes da reserva havia 29; depois dela, 31 (outro pedido reservou junto).
    cota.contarLeiturasDocumentoDoCliente.mockResolvedValueOnce(29).mockResolvedValueOnce(31);
    const r = await ler();
    expect(r.status).toBe(429);
    expect((await r.json()).erro).toMatch(/Esta empresa já usou/);
    expect(cota.cancelarLeituraOcr).toHaveBeenCalledWith('reserva-1');
    expect(gemini).not.toHaveBeenCalled();
    // Exatamente no limite (a própria reserva é a 30ª) passa.
    cota.contarLeiturasDocumentoDoCliente.mockResolvedValueOnce(29).mockResolvedValueOnce(30);
    expect((await ler()).status).toBe(200);
  });

  it('Gemini falhou → 503 com mensagem para gente (sem a crua), e a reserva vira falha (não conta na cota)', async () => {
    como('clienteA1');
    gemini.mockRejectedValueOnce(new Error('fora do ar'));
    const r = await ler();
    expect(r.status).toBe(503);
    const d = await r.json();
    expect(d.erro).toMatch(/indisponível no momento.*não conta na cota/);
    expect(d.erro).not.toMatch(/fora do ar/);
    expect(cota.falharLeituraOcr).toHaveBeenCalledWith('reserva-1');
    expect(cota.confirmarLeituraOcr).not.toHaveBeenCalled();
  });

  it('documento ilegível → 200 sem proposta (a chamada conta)', async () => {
    como('clienteA1');
    gemini.mockResolvedValueOnce({ text: JSON.stringify({ confianca: 0, legivel: false }) });
    const d = await (await ler()).json();
    expect(d.proposta).toBeNull();
    expect(d.aviso).toMatch(/não conseguiu ler/);
    expect(cota.confirmarLeituraOcr).toHaveBeenCalled();
  });
});

describe('opção da empresa (PATCH)', () => {
  const patch = (empresa: string, ligada: unknown) =>
    rota.PATCH(req('/api/caixa/documento-ia', { method: 'PATCH', body: { empresa, ligada } }));

  it('cliente não liga nem desliga → 403', async () => {
    como('clienteA1');
    expect((await patch('emp-a1', true)).status).toBe(403);
    expect(definirIaDocumento).not.toHaveBeenCalled();
  });

  it('contador de outro escritório → 403', async () => {
    como('contadorB');
    expect((await patch('emp-a1', false)).status).toBe(403);
    expect(definirIaDocumento).not.toHaveBeenCalled();
  });

  it('ligar com a plataforma desligada → 503; em saúde → 403; desligar vale sempre', async () => {
    como('contadorA');
    delete process.env.CAIXA_IA_DOCUMENTO;
    expect((await patch('emp-a1', true)).status).toBe(503);
    expect((await patch('emp-a1', false)).status).toBe(200);
    ligarPlataforma();
    expect((await patch('emp-a3', true)).status).toBe(403);
    expect((await patch('emp-a1', 'sim')).status).toBe(400);
    expect((await patch('emp-a1', true)).status).toBe(200);
    expect(definirIaDocumento).toHaveBeenCalledWith('emp-a1', true);
  });

  it('GET para a contabilidade mostra as travas', async () => {
    como('contadorA');
    EMPRESAS['emp-a1'].iaDocumento = false;
    expect(await (await rota.GET(req('/api/caixa/documento-ia?empresa=emp-a1'))).json())
      .toMatchObject({ plataforma: true, ligadaNaEmpresa: false, saude: false, disponivel: false, podeLigar: true });
  });
});

describe('lançamento com o documento anexado', () => {
  const lancar = (empresa: string, documentoId: string) =>
    lancamentos.POST(req('/api/caixa/lancamentos', {
      method: 'POST',
      body: { empresa, ano: 2026, data: '2026-03-10', historico: 'Pago conta de luz', contaId: 'c-luz', saida: '187,40', documentoId },
    }));

  it('grava o vínculo quando o documento é da mesma empresa', async () => {
    como('clienteA1');
    expect((await lancar('emp-a1', DOC)).status).toBe(200);
    expect(inseridos[0][0]).toMatchObject({ documento_id: DOC, saida: 187.4 });
  });

  it('documento de outra empresa → 400, nada gravado', async () => {
    como('clienteA2');
    expect((await lancar('emp-a2', DOC)).status).toBe(400);
    expect(inseridos).toHaveLength(0);
  });

  it('sem documento, o insert não leva a coluna (funciona antes da 0029)', async () => {
    como('clienteA1');
    await lancamentos.POST(req('/api/caixa/lancamentos', {
      method: 'POST', body: { empresa: 'emp-a1', ano: 2026, data: '2026-03-10', historico: 'Pago conta de luz', contaId: 'c-luz', saida: '10' },
    }));
    expect(inseridos[0][0]).not.toHaveProperty('documento_id');
  });
});
