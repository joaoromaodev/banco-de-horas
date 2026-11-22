// Extrato no caixa (Sprint 17, Frente D) pelas rotas, com as GUARDAS REAIS (cookie
// assinado) e banco em memória: ler o OFX/CSV → conferir → confirmar em lote →
// importar de novo não duplica → desfazer. E as travas: mês fechado (409), empresa
// arquivada, catálogo de outro escritório, lançamento de outra empresa, outro
// escritório, cliente (a importação é da contabilidade), sem sessão — sempre
// conferindo que NADA foi gravado. Sem a 0035 a importação segue (sem lembrar).
// Nenhuma chamada de rede: o arquivo é lido no servidor.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bancoFalso, type BancoFalso } from './bancoFalso';
import { ESC_A, ESC_B, pedido, type QuemTeste } from './rotaTeste';
import type { Documento } from '@/lib/documentosServidor';

type Linha = Record<string, unknown>;
let tabelas: Record<string, Linha[]>;
let banco: BancoFalso;
let semExtrato = false;
let docs: Record<string, Documento> = {};
let arquivos: Record<string, Uint8Array> = {};

/** Banco sem a 0035: as tabelas do extrato respondem "não existe". */
function semTabelas(b: BancoFalso): BancoFalso {
  return {
    consultas: b.consultas,
    from(t: string) {
      if (!t.startsWith('caixa_extrato_')) return b.from(t);
      const erro = { data: null, error: { code: '42P01', message: `relation "${t}" does not exist` } };
      const q: Record<string, unknown> = {};
      for (const m of ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'in', 'maybeSingle', 'single', 'order', 'range']) q[m] = () => q;
      q.then = (ok: (v: unknown) => unknown) => Promise.resolve(erro).then(ok);
      return q as never;
    },
  };
}

vi.mock('@/lib/cadastro', async (orig) => {
  const { cadastroFalso, empresasTeste } = await import('./rotaTeste');
  const empresas = empresasTeste();
  return { ...(await orig<object>()), ...cadastroFalso(() => empresas) };
});
vi.mock('@/lib/db', async (orig) => ({ ...(await orig<object>()), getDb: () => (semExtrato ? semTabelas(banco) : banco) }));
vi.mock('@/lib/documentosServidor', async (orig) => ({
  ...(await orig<object>()),
  lerDocumento: async (id: string) => docs[id] ?? null,
  baixarArquivo: async (d: Documento) => arquivos[d.id],
}));

const extrato = await import('@/app/api/caixa/extrato/route');
const lote = await import('@/app/api/caixa/extrato/lote/route');
const lancamentosRota = await import('@/app/api/caixa/lancamentos/route');

const OFX = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>0341<ACCTID>98765-4</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260101<DTEND>20260131
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260110<TRNAMT>-320.50<FITID>A1<MEMO>PAGTO CONTA DE LUZ EQUATORIAL</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260115<TRNAMT>1500.00<FITID>A2<MEMO>TED RECEBIDA CLIENTE LTDA</STMTTRN>
<STMTTRN><TRNTYPE>ATM<DTPOSTED>20260120<TRNAMT>-200.00<FITID>A3<MEMO>SAQUE CAIXA ELETRONICO</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260125<TRNAMT>-89.90<FITID>A4<MEMO>PAGAMENTO ALUGUEL</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
const base64 = (s: string) => Buffer.from(s, 'latin1').toString('base64');

function novoBanco() {
  tabelas = {
    plano_contas: [
      { id: 'conta-luz', codigo: '2.02.02', nome: 'Energia Elétrica', grupo: '2', natureza: 'despesa', escritorio_id: null, ativa: true, ordem: 1 },
      { id: 'conta-receita', codigo: '1.01.01', nome: 'Receita de serviços', grupo: '1', natureza: 'receita', escritorio_id: null, ativa: true, ordem: 2 },
      { id: 'conta-de-b', codigo: '2.09.99', nome: 'Conta do B', grupo: '2', natureza: 'despesa', escritorio_id: ESC_B, ativa: true, ordem: 3 },
    ],
    historicos_padrao: [
      { id: 'h-luz', texto: 'Pago conta de luz', natureza: 'despesa', conta_id: 'conta-luz', escritorio_id: null, ordem: 1 },
      { id: 'h-receita', texto: 'Recebido serviço', natureza: 'receita', conta_id: 'conta-receita', escritorio_id: null, ordem: 2 },
    ],
    exercicios: [
      { id: 'ex-a1', empresa_id: 'emp-a1', ano: 2026, saldo_inicial: 0 },
      { id: 'ex-a2', empresa_id: 'emp-a2', ano: 2026, saldo_inicial: 0 },
    ],
    // O aluguel já foi lançado pelo cliente dois dias depois do débito no banco.
    lancamentos: [
      { id: '11111111-1111-4111-8111-111111111111', exercicio_id: 'ex-a1', data: '2026-01-27', mes: 1, historico: 'Pago aluguel', complemento: null, conta_id: null, entrada: 0, saida: 89.9, juros: 0, multa: 0, criado_por: 'cli@a1.com', criado_em: '2026-01-27T10:00:00Z' },
      // Venda em dinheiro: no caixa e não no banco (normal).
      { id: '22222222-2222-4222-8222-222222222222', exercicio_id: 'ex-a1', data: '2026-01-18', mes: 1, historico: 'Venda à vista', complemento: null, conta_id: null, entrada: 40, saida: 0, juros: 0, multa: 0, criado_por: 'cli@a1.com', criado_em: '2026-01-18T10:00:00Z' },
      // Lançamento de OUTRA empresa do mesmo escritório.
      { id: '33333333-3333-4333-8333-333333333333', exercicio_id: 'ex-a2', data: '2026-01-10', mes: 1, historico: 'Pago conta de luz', complemento: null, conta_id: 'conta-luz', entrada: 0, saida: 320.5, juros: 0, multa: 0, criado_por: 'c@a.com', criado_em: '2026-01-10T10:00:00Z' },
    ],
  };
  banco = bancoFalso(tabelas, 1000, {
    aoGravar: {
      lancamentos: (l) => {
        if (typeof l.data === 'string') l.mes = Number(l.data.slice(5, 7));
        for (const c of ['entrada', 'saida', 'juros', 'multa']) l[c] ??= 0;
      },
      exercicios: (l) => { l.saldo_inicial ??= 0; },
    },
    aoLer: {
      lancamentos: (l, t) => {
        const ex = (t.exercicios ?? []).find((e) => e.id === l.exercicio_id);
        return { ...l, exercicios: ex ? { empresa_id: ex.empresa_id, ano: ex.ano } : null };
      },
    },
  });
}

const doc = (p: Partial<Documento>): Documento => ({
  id: 'doc-1', empresaId: 'emp-a1', escritorioId: ESC_A, competencia: '2026-01', categoria: 'extrato', caminho: 'x', nome: 'extrato.ofx',
  tamanho: 100, tipo: 'application/x-ofx', observacao: null, pendenciaId: null, status: 'recebido', enviadoPor: 'cli@a1.com',
  enviadoEm: '2026-02-01T00:00:00Z', conferidoPor: null, conferidoEm: null, excluidoEm: null, excluidoPorGestor: false,
  devolvidoEm: null, devolvidoPor: null, motivoDevolucao: null, ...p,
} as Documento);

const fetchOriginal = globalThis.fetch;
beforeEach(() => {
  novoBanco(); semExtrato = false;
  docs = { 'doc-1': doc({}), 'doc-b': doc({ id: 'doc-b', empresaId: 'emp-a2' }), 'doc-pdf': doc({ id: 'doc-pdf', tipo: 'application/pdf' }) };
  arquivos = { 'doc-1': new Uint8Array(Buffer.from(OFX, 'latin1')) };
  // Nada sai da máquina.
  globalThis.fetch = vi.fn(async () => { throw new Error('rede proibida neste teste'); }) as typeof fetch;
});
afterEach(() => { globalThis.fetch = fetchOriginal; });

const ler = async (quem: QuemTeste | null, empresa: string, extra: Record<string, unknown> = {}) =>
  extrato.POST(await pedido(quem, '/api/caixa/extrato', { method: 'POST', body: { empresa, arquivo: { nome: 'jan.ofx', base64: base64(OFX) }, ...extra } }));
const confirmar = async (quem: QuemTeste | null, empresa: string, itens: unknown[]) =>
  lote.POST(await pedido(quem, '/api/caixa/extrato/lote', { method: 'POST', body: { empresa, itens } }));
const desfazer = async (quem: QuemTeste | null, empresa: string, corpo: Record<string, unknown>) =>
  lote.DELETE(await pedido(quem, '/api/caixa/extrato/lote', { method: 'DELETE', body: { empresa, ...corpo } }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON da rota
type Json = any;
/** O lote como a tela monta: as novas com a conta escolhida, as casadas para registrar. */
function loteDaTela(r: Json, conta: Record<string, { historico: string; historicoId: string; contaId: string }> = {}) {
  return [
    ...r.itens.filter((i: Json) => i.estado === 'nova' && !i.travada).map((i: Json) => ({
      chave: i.chave, data: i.data, valor: i.valor, sentido: i.sentido, historicoBanco: i.historico, acao: 'lancar',
      pernas: i.pernas.map((p: Json) => (p.transferencia ? p : { ...p, ...(conta[i.chave] ?? {}) })),
    })),
    ...r.itens.filter((i: Json) => i.estado === 'casada').map((i: Json) => ({
      chave: i.chave, data: i.data, valor: i.valor, sentido: i.sentido, historicoBanco: i.historico, acao: 'casar',
      lancamentoIds: i.casadoCom.map((l: Json) => l.id),
    })),
  ];
}

const estado = () => JSON.stringify({ l: tabelas.lancamentos, m: tabelas.caixa_extrato_linhas ?? [], c: tabelas.caixa_extrato_config ?? [] });

describe('extrato: ler → conferir → confirmar em lote → reimportar → desfazer', () => {
  it('ponta a ponta, sem gravar nada antes da confirmação', async () => {
    const antes = estado();
    const res = await ler('contadorA', 'emp-a1');
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(estado()).toBe(antes); // ler não grava
    expect(r).toMatchObject({ modo: 'par', instalada: true, formato: 'ofx', conta: 'Banco 341 · conta final 7654' });
    const [luz, ted, saque, aluguel] = r.itens;
    // Pagamento da luz: retirada + pagamento, com a conta sugerida (a analítica citada).
    expect(luz.estado).toBe('nova');
    expect(luz.pernas.map((p: Json) => [p.direcao, p.historico, p.contaId])).toEqual([
      ['entrada', 'Retirada de conta corrente', null], ['saida', 'Pago conta de luz', 'conta-luz'],
    ]);
    expect(luz.sugestao.origem).toBe('analitica');
    // O lançamento de luz da OUTRA empresa não casa.
    expect(luz.casadoCom).toEqual([]);
    // TED recebida: recebimento + depósito em conta corrente.
    expect(ted.pernas.map((p: Json) => [p.direcao, p.historico])).toEqual([['entrada', ''], ['saida', 'Depósito em conta corrente']]);
    // Saque: só a retirada (entrada no caixa).
    expect(saque.pernas.map((p: Json) => [p.direcao, p.historico])).toEqual([['entrada', 'Retirada de conta corrente']]);
    // Aluguel: já no caixa (2 dias depois) → parcial, falta só a retirada.
    expect(aluguel.estado).toBe('parcial');
    expect(aluguel.casadoCom.map((l: Json) => l.id)).toEqual(['11111111-1111-4111-8111-111111111111']);
    expect(aluguel.pernas.map((p: Json) => p.historico)).toEqual(['Retirada de conta corrente']);
    // No caixa e não no banco: a venda em dinheiro.
    expect(r.soNoCaixa.outros.map((l: Json) => l.historico)).toEqual(['Venda à vista']);

    // Confirma em lote (o TED com a conta escolhida pela contadora).
    const itens = loteDaTela(r, { [ted.chave]: { historico: 'Recebido serviço', historicoId: 'h-receita', contaId: 'conta-receita' } });
    const ok = await confirmar('contadorA', 'emp-a1', itens);
    expect(ok.status).toBe(200);
    const d = await ok.json();
    expect(d).toMatchObject({ criados: 5, registrado: true });
    const novos = tabelas.lancamentos.filter((l) => d.lancamentoIds.includes(l.id));
    expect(novos.map((l) => [l.historico, l.entrada, l.saida, l.conta_id, l.criado_por])).toEqual([
      ['Retirada de conta corrente', 320.5, 0, null, 'c@a.com'],
      ['Pago conta de luz', 0, 320.5, 'conta-luz', 'c@a.com'],
      ['Recebido serviço', 1500, 0, 'conta-receita', 'c@a.com'],
      ['Depósito em conta corrente', 0, 1500, null, 'c@a.com'],
      ['Retirada de conta corrente', 200, 0, null, 'c@a.com'],
    ]);
    // A lista da empresa é aberta: as contas usadas entraram nela.
    expect(tabelas.empresa_historicos).toEqual(expect.arrayContaining([expect.objectContaining({ empresa_id: 'emp-a1', historico_id: 'h-receita' })]));
    expect(tabelas.caixa_extrato_linhas.every((m) => m.empresa_id === 'emp-a1' && m.escritorio_id === ESC_A && m.lote === d.lote)).toBe(true);

    // Reimportar o mesmo extrato não duplica: tudo importado (ou parcial, que não foi escolhido).
    const r2 = await (await ler('contadorA', 'emp-a1')).json();
    expect(r2.itens.map((i: Json) => i.estado)).toEqual(['importada', 'importada', 'importada', 'parcial']);
    expect(r2.totais.novas).toBe(0);
    // Mandar o mesmo lote de novo (clique duplo, outra aba): 409 e nada gravado.
    const antes2 = estado();
    const dup = await confirmar('contadorA', 'emp-a1', itens);
    expect(dup.status).toBe(409);
    expect(estado()).toBe(antes2);

    // Desfazer o lote: os 5 lançamentos e as marcas saem; o que já existia fica.
    const desf = await desfazer('contadorA', 'emp-a1', { lote: d.lote });
    expect(desf.status).toBe(200);
    expect((await desf.json()).excluidos).toBe(5);
    expect(tabelas.lancamentos.map((l) => l.id).sort()).toEqual(['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333']);
    expect(tabelas.caixa_extrato_linhas).toEqual([]);
  });

  it('a mesma linha do OFX em dois arquivos (períodos que se sobrepõem) é reconhecida pela chave', async () => {
    const r = await (await ler('contadorA', 'emp-a1')).json();
    const saque = r.itens.find((i: Json) => i.historico.startsWith('SAQUE'));
    expect((await confirmar('contadorA', 'emp-a1', [{ chave: saque.chave, data: saque.data, valor: saque.valor, sentido: saque.sentido, historicoBanco: saque.historico, acao: 'lancar', pernas: saque.pernas }])).status).toBe(200);
    // Outro arquivo, de 15/01 a 15/02, com o mesmo saque.
    const outro = OFX.replace('<DTSTART>20260101<DTEND>20260131', '<DTSTART>20260115<DTEND>20260215');
    const r2 = await (await extrato.POST(await pedido('contadorA', '/api/caixa/extrato', { method: 'POST', body: { empresa: 'emp-a1', arquivo: { nome: 'b.ofx', base64: base64(outro) } } }))).json();
    expect(r2.itens.find((i: Json) => i.chave === saque.chave).estado).toBe('importada');
  });

  it('ignorar: a linha não volta como novidade', async () => {
    const r = await (await ler('contadorA', 'emp-a1')).json();
    const ted = r.itens[1];
    const res = await confirmar('contadorA', 'emp-a1', [{ chave: ted.chave, data: ted.data, valor: ted.valor, sentido: ted.sentido, historicoBanco: ted.historico, acao: 'ignorar' }]);
    expect(res.status).toBe(200);
    expect((await res.json()).criados).toBe(0);
    const r2 = await (await ler('contadorA', 'emp-a1')).json();
    expect(r2.itens[1]).toMatchObject({ estado: 'importada' });
    expect(r2.itens[1].notas[0]).toMatch(/ignorar/);
  });

  it('modo direto (banco dentro do caixa): um lançamento por linha, saque fora', async () => {
    const p = await extrato.PATCH(await pedido('contadorA', '/api/caixa/extrato', { method: 'PATCH', body: { empresa: 'emp-a1', modo: 'direto' } }));
    expect(p.status).toBe(200);
    expect((await (await extrato.GET(await pedido('contadorA', '/api/caixa/extrato?empresa=emp-a1'))).json()).modo).toBe('direto');
    const r = await (await ler('contadorA', 'emp-a1')).json();
    expect(r.modo).toBe('direto');
    expect(r.itens.map((i: Json) => [i.estado, i.pernas.length])).toEqual([['nova', 1], ['nova', 1], ['fora', 0], ['casada', 0]]);
    expect((await extrato.PATCH(await pedido('contadorA', '/api/caixa/extrato', { method: 'PATCH', body: { empresa: 'emp-a1', modo: 'outro' } }))).status).toBe(400);
  });

  it('extrato do portal (o cliente mandou em Documentos)', async () => {
    const r = await extrato.POST(await pedido('contadorA', '/api/caixa/extrato', { method: 'POST', body: { empresa: 'emp-a1', documento: 'doc-1' } }));
    expect(r.status).toBe(200);
    expect((await r.json()).origem).toEqual({ nome: 'extrato.ofx', documento: 'doc-1' });
    // Documento de outra empresa: 404; PDF: 415.
    expect((await extrato.POST(await pedido('contadorA', '/api/caixa/extrato', { method: 'POST', body: { empresa: 'emp-a1', documento: 'doc-b' } }))).status).toBe(404);
    expect((await extrato.POST(await pedido('contadorA', '/api/caixa/extrato', { method: 'POST', body: { empresa: 'emp-a1', documento: 'doc-pdf' } }))).status).toBe(415);
  });

  it('CSV sem colunas reconhecidas: 422 com as colunas para mapear; com o mapa, lê', async () => {
    const csv = 'quando;oque;quanto\n10/01/2026;PIX;-50,00\n';
    const corpo = { empresa: 'emp-a1', arquivo: { nome: 'x.csv', base64: base64(csv) } };
    const r = await extrato.POST(await pedido('contadorA', '/api/caixa/extrato', { method: 'POST', body: corpo }));
    expect(r.status).toBe(422);
    expect((await r.json()).csv.colunas).toEqual(['quando', 'oque', 'quanto']);
    const ok = await extrato.POST(await pedido('contadorA', '/api/caixa/extrato', { method: 'POST', body: { ...corpo, mapa: { data: 0, historico: 1, valor: 2 } } }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).itens).toHaveLength(1);
  });
});

describe('extrato: travas', () => {
  it('mês fechado: a linha vem travada e confirmar dá 409 sem gravar; desfazer também', async () => {
    const r = await (await ler('contadorA', 'emp-a1')).json();
    const itens = loteDaTela(r, { [r.itens[1].chave]: { historico: 'Recebido serviço', historicoId: 'h-receita', contaId: 'conta-receita' } });
    // Fecha janeiro depois da leitura (outra aba).
    tabelas.meses_confirmados = [{ exercicio_id: 'ex-a1', mes: 1 }];
    const antes = estado();
    const res = await confirmar('contadorA', 'emp-a1', itens);
    expect(res.status).toBe(409);
    expect((await res.json()).erro).toMatch(/Janeiro\/2026 está fechado pela contabilidade/);
    expect(estado()).toBe(antes);
    // Lida de novo, as linhas de janeiro vêm travadas.
    const r2 = await (await ler('contadorA', 'emp-a1')).json();
    expect(r2.itens.every((i: Json) => i.travada)).toBe(true);
    expect(r2.totais.travadas).toBe(4);
    // Casar e ignorar não mudam o livro: passam no mês fechado.
    const casar = loteDaTela(r2).filter((i) => i.acao === 'casar');
    expect((await confirmar('contadorA', 'emp-a1', [{ chave: r2.itens[1].chave, data: r2.itens[1].data, valor: 1500, sentido: 'credito', historicoBanco: 'x', acao: 'ignorar' }, ...casar])).status).toBe(200);
  });

  it('desfazer um lote cujo mês foi fechado depois: 409, nada sai', async () => {
    const r = await (await ler('contadorA', 'emp-a1')).json();
    const saque = r.itens[2];
    const d = await (await confirmar('contadorA', 'emp-a1', [{ chave: saque.chave, data: saque.data, valor: saque.valor, sentido: saque.sentido, historicoBanco: saque.historico, acao: 'lancar', pernas: saque.pernas }])).json();
    tabelas.meses_confirmados = [{ exercicio_id: 'ex-a1', mes: 2 }]; // fevereiro fechado trava janeiro
    const antes = estado();
    const res = await desfazer('contadorA', 'emp-a1', { lote: d.lote });
    expect(res.status).toBe(409);
    expect(estado()).toBe(antes);
  });

  it('conta de catálogo de outro escritório e analítica vazia: 400, nada gravado', async () => {
    const r = await (await ler('contadorA', 'emp-a1')).json();
    const luz = r.itens[0];
    const antes = estado();
    const comContaDeB = [{ chave: luz.chave, data: luz.data, valor: luz.valor, sentido: luz.sentido, historicoBanco: luz.historico, acao: 'lancar',
      pernas: luz.pernas.map((p: Json) => (p.transferencia ? p : { ...p, contaId: 'conta-de-b' })) }];
    expect((await confirmar('contadorA', 'emp-a1', comContaDeB)).status).toBe(400);
    const semAnalitica = [{ ...comContaDeB[0], pernas: luz.pernas.map((p: Json) => (p.transferencia ? p : { ...p, historico: '', historicoId: null })) }];
    const res = await confirmar('contadorA', 'emp-a1', semAnalitica);
    expect(res.status).toBe(400);
    expect((await res.json()).erro).toMatch(/Informe a conta analítica/);
    expect(estado()).toBe(antes);
  });

  it('casar com lançamento de outra empresa: 400, nada gravado', async () => {
    const r = await (await ler('contadorA', 'emp-a1')).json();
    const luz = r.itens[0];
    const antes = estado();
    const res = await confirmar('contadorA', 'emp-a1', [{ chave: luz.chave, data: luz.data, valor: luz.valor, sentido: luz.sentido, historicoBanco: 'x', acao: 'casar', lancamentoIds: ['33333333-3333-4333-8333-333333333333'] }]);
    expect(res.status).toBe(400);
    expect(estado()).toBe(antes);
    // Desfazer citando o lançamento da outra empresa não o apaga.
    const d = await desfazer('contadorA', 'emp-a1', { lote: crypto.randomUUID(), lancamentoIds: ['33333333-3333-4333-8333-333333333333'] });
    expect((await d.json()).excluidos).toBe(0);
    expect(estado()).toBe(antes);
  });

  it('isolamento: cliente, outro escritório, arquivada e sem sessão', async () => {
    const r = await (await ler('contadorA', 'emp-a1')).json();
    const itens = loteDaTela(r, { [r.itens[1].chave]: { historico: 'Recebido serviço', historicoId: 'h-receita', contaId: 'conta-receita' } });
    const antes = estado();
    // O cliente não importa extrato (nem da própria empresa) — é a conciliação da contabilidade.
    for (const quem of ['clienteA1', 'clienteA2'] as const) {
      expect((await ler(quem, 'emp-a1')).status).toBe(403);
      expect((await confirmar(quem, 'emp-a1', itens)).status).toBe(403);
      expect((await desfazer(quem, 'emp-a1', { lote: crypto.randomUUID() })).status).toBe(403);
      expect((await extrato.GET(await pedido(quem, '/api/caixa/extrato?empresa=emp-a1'))).status).toBe(403);
    }
    // Outro escritório.
    expect((await ler('contadorB', 'emp-a1')).status).toBe(403);
    expect((await confirmar('contadorB', 'emp-a1', itens)).status).toBe(403);
    expect((await extrato.PATCH(await pedido('contadorB', '/api/caixa/extrato', { method: 'PATCH', body: { empresa: 'emp-a1', modo: 'direto' } }))).status).toBe(403);
    // Arquivada: a contabilidade não importa (409); o cliente dela não entra.
    const arq = await ler('contadorA', 'emp-arq');
    expect(arq.status).toBe(409);
    expect((await arq.json()).erro).toMatch(/arquivada/i);
    expect((await confirmar('contadorA', 'emp-arq', itens)).status).toBe(409);
    expect((await ler('clienteArq', 'emp-arq')).status).toBe(403);
    // Sem sessão.
    expect((await ler(null, 'emp-a1')).status).toBe(401);
    expect((await confirmar(null, 'emp-a1', itens)).status).toBe(401);
    expect(estado()).toBe(antes);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('arquivo grande demais ou vazio', async () => {
    const grande = 'a'.repeat(3 * 1024 * 1024);
    const r = await extrato.POST(await pedido('contadorA', '/api/caixa/extrato', { method: 'POST', body: { empresa: 'emp-a1', arquivo: { nome: 'g.csv', base64: grande } } }));
    expect(r.status).toBe(413);
    expect((await extrato.POST(await pedido('contadorA', '/api/caixa/extrato', { method: 'POST', body: { empresa: 'emp-a1' } }))).status).toBe(400);
  });
});

describe('extrato sem a migração 0035', () => {
  it('lê e lança (o casamento por data e valor evita duplicar); não lembra e não muda o modo', async () => {
    semExtrato = true;
    const r = await (await ler('contadorA', 'emp-a1')).json();
    expect(r).toMatchObject({ instalada: false, modo: 'par' });
    const saque = r.itens[2];
    const res = await confirmar('contadorA', 'emp-a1', [{ chave: saque.chave, data: saque.data, valor: saque.valor, sentido: saque.sentido, historicoBanco: saque.historico, acao: 'lancar', pernas: saque.pernas }]);
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d).toMatchObject({ criados: 1, registrado: false });
    // Lido de novo, o saque casa com o lançamento criado (não duplica).
    const r2 = await (await ler('contadorA', 'emp-a1')).json();
    expect(r2.itens[2].estado).toBe('casada');
    // Desfazer pelos ids que a tela guardou.
    expect((await (await desfazer('contadorA', 'emp-a1', { lote: d.lote, lancamentoIds: d.lancamentoIds })).json()).excluidos).toBe(1);
    // Mudar o modo precisa da 0035.
    expect((await extrato.PATCH(await pedido('contadorA', '/api/caixa/extrato', { method: 'PATCH', body: { empresa: 'emp-a1', modo: 'direto' } }))).status).toBe(503);
  });

  it('o lançamento comum da empresa segue funcionando ao lado', async () => {
    const res = await lancamentosRota.POST(await pedido('clienteA1', '/api/caixa/lancamentos', { method: 'POST', body: { empresa: 'emp-a1', ano: 2026, data: '2026-01-05', historico: 'Venda', entrada: '10,00' } }));
    expect(res.status).toBe(200);
  });
});
