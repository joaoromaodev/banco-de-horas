// Contrato de /api/caixa/documento-leitura (nota e boleto SEM IA, Sprint 17) e da
// chave do documento no lançamento: guardas e isolamento iguais aos da leitura por
// IA, sem as travas dela; duplicidade só dentro da empresa; nada sai do servidor
// (fetch vigiado); sem a 0033 o lançamento grava igual. Documentos SINTÉTICOS.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { Sessao } from '@/lib/auth';
import { bancoFalso, type BancoFalso } from './bancoFalso';
import { dvChaveNfe } from '@/lib/notaFiscalXml';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const DOC = '11111111-2222-4333-8444-555555555555';
const DOC2 = '11111111-2222-4333-8444-666666666666';
const CNPJ_A1 = '11222333000181';
const CNPJ_A2 = '22333444000155';
const CNPJ_FORN = '44555666000199';

const exp = Date.now() + 3_600_000;
const SESSOES: Record<string, Sessao> = {
  contadorA: { email: 'c@a.com', nome: 'A', role: 'usuario', escritorioId: A, exp, modulos: ['caixa'] },
  contadorB: { email: 'c@b.com', nome: 'B', role: 'usuario', escritorioId: B, exp, modulos: ['caixa'] },
  clienteA1: { email: 'cli@a1.com', nome: 'A1', role: 'cliente', escritorioId: A, empresa: 'emp-a1', exp },
  clienteA2: { email: 'cli@a2.com', nome: 'A2', role: 'cliente', escritorioId: A, empresa: 'emp-a2', exp },
};
let sessaoAtual: Sessao | null = null;
const como = (k: keyof typeof SESSOES | null) => { sessaoAtual = k ? SESSOES[k] : null; };

const EMPRESAS: Record<string, { id: string; nome: string; escritorioId: string; cnpj: string; identificaPagador?: boolean; trabalhaSabado: boolean }> = {
  // Sem IA: nenhuma das duas tem a opção de IA ligada, e a leitura funciona igual.
  'emp-a1': { id: 'emp-a1', nome: 'Padaria', escritorioId: A, cnpj: '11.222.333/0001-81', trabalhaSabado: false },
  'emp-a2': { id: 'emp-a2', nome: 'A2', escritorioId: A, cnpj: CNPJ_A2, trabalhaSabado: false },
  'emp-b1': { id: 'emp-b1', nome: 'B1', escritorioId: B, cnpj: '33444555000166', trabalhaSabado: false },
};
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
  };
});

// ------------------------------------------------------------------ documentos sintéticos
function chave(cnpj: string): string {
  const sem = `152603${cnpj}55001000001234112345678`;
  return sem + dvChaveNfe(sem);
}
const xmlNfe = (emit: string, dest: string) => `<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"><NFe><infNFe Id="NFe${chave(emit)}">
  <ide><mod>55</mod><serie>1</serie><nNF>1234</nNF><dhEmi>2026-03-05T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide>
  <emit><CNPJ>${emit}</CNPJ><xNome>Distribuidora Ficticia LTDA</xNome></emit>
  <dest><CNPJ>${dest}</CNPJ><xNome>Comprador</xNome></dest>
  <total><ICMSTot><vNF>870.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;

async function pdfCom(linhas: string[]): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([595, 842]);
  linhas.forEach((l, i) => p.drawText(l, { x: 40, y: 800 - i * 18, size: 11, font: f }));
  return d.save();
}
const PDF_RECIBO = await pdfCom(['RECIBO Nº 9', 'Valor pago: R$ 120,00', 'Data do pagamento: 12/03/2026']);
const PDF_VAZIO = await (async () => { const d = await PDFDocument.create(); d.addPage([200, 200]); return d.save(); })();

const LINHA_ITAU = '34190.00009 00000.000000 00000.000018 3 15000000123456';

const docBase = {
  id: DOC, empresaId: 'emp-a1', escritorioId: A, competencia: '2026-03', categoria: 'nota', caminho: `${A}/${DOC}.xml`,
  nome: 'nota.xml', tamanho: 100, tipo: 'application/xml', observacao: null, pendenciaId: null,
  status: 'recebido', enviadoPor: 'cli@a1.com', enviadoEm: '2026-03-01T00:00:00Z', conferidoPor: null, conferidoEm: null,
  excluidoEm: null as string | null, excluidoPorGestor: false,
};
let docAtual: typeof docBase = { ...docBase };
let bytesDoArquivo: Uint8Array = new TextEncoder().encode(xmlNfe(CNPJ_FORN, CNPJ_A1));
const baixarArquivo = vi.fn(async () => bytesDoArquivo);
vi.mock('@/lib/documentosServidor', async (orig) => {
  const real = await orig<typeof import('@/lib/documentosServidor')>();
  return {
    ...real,
    lerDocumento: async (id: string) => (id === docAtual.id ? docAtual : null),
    baixarArquivo: (...a: unknown[]) => baixarArquivo(...(a as [])),
  };
});

const exercicioDe: Record<string, string> = { 'emp-a1': 'ex-a1', 'emp-a2': 'ex-a2', 'emp-b1': 'ex-b1' };
vi.mock('@/lib/caixa', async (orig) => {
  const real = await orig<typeof import('@/lib/caixa')>();
  return {
    ...real,
    contasDaEmpresa: async () => [{ id: 'c-merc', codigo: '3.1', nome: 'Mercadorias', grupo: '3', natureza: 'despesa', daEmpresa: true, escritorioId: null }],
    historicosDaEmpresa: async () => [{ id: 'h-merc', texto: 'Compra de mercadorias', natureza: 'despesa', contaId: 'c-merc', daEmpresa: true, escritorioId: null }],
    garantirExercicio: async (empresa: string) => ({ id: exercicioDe[empresa], empresaId: empresa, ano: 2026, saldoInicial: 0 }),
    exigirCatalogoVisivel: async () => {},
    vincularConta: async () => {},
    vincularHistorico: async () => {},
  };
});

// Banco em memória; `sem0033` simula a coluna `chave_documento` ainda inexistente.
let banco: BancoFalso;
let tabelas: Record<string, Record<string, unknown>[]>;
let sem0033 = false;
const ERRO_COLUNA = { data: null, error: { code: '42703', message: 'column lancamentos.chave_documento does not exist' } };
vi.mock('@/lib/db', async (orig) => ({
  ...(await orig<typeof import('@/lib/db')>()),
  getDb: () => ({
    from: (t: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- o builder falso, embrulhado
      const q = banco.from(t) as any;
      if (!sem0033 || t !== 'lancamentos') return q;
      const insert = q.insert.bind(q);
      q.insert = (v: Record<string, unknown>[]) => (v.some((l) => 'chave_documento' in l) ? { select: async () => ERRO_COLUNA } : insert(v));
      const eq = q.eq.bind(q);
      q.eq = (c: string, v: unknown) => (c === 'chave_documento' ? { order: () => ({ limit: async () => ERRO_COLUNA }) } : eq(c, v));
      return q;
    },
  }),
}));

const rota = await import('@/app/api/caixa/documento-leitura/route');
const lancamentos = await import('@/app/api/caixa/lancamentos/route');

const req = (url: string, body: unknown) => new NextRequest(`http://x${url}`, {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
});
const ler = (corpo: Record<string, unknown>) => rota.POST(req('/api/caixa/documento-leitura', { empresa: 'emp-a1', ano: 2026, ...corpo }));
const lancar = (corpo: Record<string, unknown>) => lancamentos.POST(req('/api/caixa/lancamentos', {
  empresa: 'emp-a1', ano: 2026, data: '2026-03-05', historico: 'Compra de mercadorias', historicoId: 'h-merc', contaId: 'c-merc',
  complemento: 'NF 1234 — Distribuidora Ficticia LTDA', entrada: '', saida: '870,00', ...corpo,
}));

let fetchEspiao: { mockRestore: () => void };
beforeEach(() => {
  tabelas = {
    exercicios: [
      { id: 'ex-a1', empresa_id: 'emp-a1', ano: 2026, saldo_inicial: 0 },
      { id: 'ex-a2', empresa_id: 'emp-a2', ano: 2026, saldo_inicial: 0 },
      { id: 'ex-b1', empresa_id: 'emp-b1', ano: 2026, saldo_inicial: 0 },
    ],
    lancamentos: [],
  };
  banco = bancoFalso(tabelas);
  sem0033 = false;
  docAtual = { ...docBase };
  bytesDoArquivo = new TextEncoder().encode(xmlNfe(CNPJ_FORN, CNPJ_A1));
  baixarArquivo.mockClear();
  // Nada pode sair do servidor: nenhuma chamada de rede na leitura.
  fetchEspiao = vi.spyOn(globalThis, 'fetch');
});
afterEach(() => {
  expect(fetchEspiao).not.toHaveBeenCalled();
  fetchEspiao.mockRestore();
});

describe('guardas e isolamento (sem as travas da IA)', () => {
  it('sem sessão → 401', async () => {
    como(null);
    expect((await ler({ documento: DOC })).status).toBe(401);
  });

  it('cliente de outra empresa e contador de outro escritório → 403, sem baixar nada', async () => {
    como('clienteA2');
    expect((await ler({ documento: DOC })).status).toBe(403);
    como('contadorB');
    expect((await ler({ documento: DOC })).status).toBe(403);
    expect((await ler({ codigo: LINHA_ITAU })).status).toBe(403);
    expect(baixarArquivo).not.toHaveBeenCalled();
  });

  it('documento de outra empresa ou gravado em outro escritório → 404', async () => {
    como('clienteA1');
    docAtual = { ...docBase, empresaId: 'emp-a2' };
    expect((await ler({ documento: DOC })).status).toBe(404);
    docAtual = { ...docBase, escritorioId: B };
    expect((await ler({ documento: DOC })).status).toBe(404);
    docAtual = { ...docBase, excluidoEm: '2026-03-02T00:00:00Z' };
    expect((await ler({ documento: DOC })).status).toBe(404);
    expect(baixarArquivo).not.toHaveBeenCalled();
  });

  it('foto e extrato → 415 (sem IA só XML e PDF de nota/recibo/outros)', async () => {
    como('clienteA1');
    docAtual = { ...docBase, tipo: 'image/jpeg' };
    const r = await ler({ documento: DOC });
    expect(r.status).toBe(415);
    expect((await r.json()).erro).toMatch(/XML da nota ou um PDF/);
    docAtual = { ...docBase, categoria: 'extrato' };
    expect((await ler({ documento: DOC })).status).toBe(415);
  });
});

describe('leitura e duplicidade', () => {
  it('XML da NF-e: proposta de saída, conta pelo histórico, e a nota duplicada é apontada só na mesma empresa', async () => {
    // Histórico: a empresa já comprou deste fornecedor (vira exemplo da sugestão).
    for (const v of [800, 910, 860]) {
      tabelas.lancamentos.push({
        id: crypto.randomUUID(), exercicio_id: 'ex-a1', data: '2026-02-01', complemento: 'NF 1100 — Distribuidora Ficticia LTDA',
        conta_id: 'c-merc', historico: 'Compra de mercadorias', entrada: 0, saida: v, juros: 0, multa: 0, conferido_em: '2026-02-02',
      });
    }
    como('clienteA1');
    const r = await ler({ documento: DOC });
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.proposta).toMatchObject({
      fonte: 'nfe', direcao: 'saida', valor: 870, data: '2026-03-05', chave: `nfe:${chave(CNPJ_FORN)}`,
      contaId: 'c-merc', historico: 'Compra de mercadorias',
    });
    expect(d).toMatchObject({ documento: { id: DOC, nome: 'nota.xml' }, duplicados: [], duplicidadeVerificada: true });

    // Lança com o documento e a chave → o lançamento guarda os dois.
    expect((await lancar({ documentoId: DOC, chaveDocumento: d.proposta.chave })).status).toBe(200);
    const gravado = tabelas.lancamentos.at(-1)!;
    expect(gravado).toMatchObject({ documento_id: DOC, chave_documento: `nfe:${chave(CNPJ_FORN)}`, exercicio_id: 'ex-a1' });

    // Ler a MESMA nota de novo (outro arquivo, mesma chave): aponta antes de gravar.
    docAtual = { ...docBase, id: DOC2 };
    const deNovo = await (await ler({ documento: DOC2 })).json();
    expect(deNovo.duplicados).toEqual([{ data: '2026-03-05', complemento: 'NF 1234 — Distribuidora Ficticia LTDA', valor: 870 }]);

    // A mesma nota na OUTRA empresa do escritório não é duplicada dela (isolamento).
    como('clienteA2');
    docAtual = { ...docBase, empresaId: 'emp-a2' };
    bytesDoArquivo = new TextEncoder().encode(xmlNfe(CNPJ_FORN, CNPJ_A2));
    const outra = await (await rota.POST(req('/api/caixa/documento-leitura', { empresa: 'emp-a2', ano: 2026, documento: DOC }))).json();
    expect(outra.proposta.direcao).toBe('saida');
    expect(outra.duplicados).toEqual([]);
  });

  it('boleto digitado (sem documento): proposta e chave; código errado → 422 com o motivo', async () => {
    como('contadorA');
    const r = await ler({ codigo: LINHA_ITAU });
    expect(r.status).toBe(200);
    const d = await r.json();
    expect(d.proposta).toMatchObject({ fonte: 'boleto', valor: 1234.56, data: '2026-07-07', direcao: 'saida' });
    expect(d.documento).toBeNull();
    const errado = await ler({ codigo: LINHA_ITAU.replace('15000000123456', '15000000123450') });
    expect(errado.status).toBe(422);
    expect((await errado.json()).erro).toMatch(/não confere/);
    expect((await ler({})).status).toBe(400);
  });

  it('PDF com texto (recibo) e PDF escaneado (sem texto → diz e deixa preencher)', async () => {
    como('clienteA1');
    docAtual = { ...docBase, tipo: 'application/pdf', categoria: 'recibo', caminho: `${A}/${DOC}.pdf`, nome: 'recibo.pdf' };
    bytesDoArquivo = PDF_RECIBO;
    const d = await (await ler({ documento: DOC, direcao: 'saida' })).json();
    expect(d.proposta).toMatchObject({ fonte: 'pdf', valor: 120, data: '2026-03-12', complemento: 'Recibo 9' });
    bytesDoArquivo = PDF_VAZIO;
    const v = await (await ler({ documento: DOC })).json();
    expect(v.proposta).toBeNull();
    expect(v.aviso).toMatch(/não tem texto/);
  });
});

describe('chave no lançamento', () => {
  it('chave fora do formato é ignorada', async () => {
    como('clienteA1');
    expect((await lancar({ chaveDocumento: "nfe:1'; drop table" })).status).toBe(200);
    expect(tabelas.lancamentos.at(-1)).not.toHaveProperty('chave_documento');
  });

  it('sem a 0033: lança igual (sem a chave) e a leitura diz que não conferiu a duplicidade', async () => {
    sem0033 = true;
    como('clienteA1');
    const d = await (await ler({ codigo: LINHA_ITAU })).json();
    expect(d.duplicidadeVerificada).toBe(false);
    const r = await lancar({ chaveDocumento: d.proposta.chave, saida: '1234,56', data: '2026-07-07' });
    expect(r.status).toBe(200);
    const gravado = tabelas.lancamentos.at(-1)!;
    expect(gravado).toMatchObject({ saida: 1234.56, exercicio_id: 'ex-a1' });
    expect(gravado).not.toHaveProperty('chave_documento');
  });
});
