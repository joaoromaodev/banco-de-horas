// Fluxo crítico do Livro Caixa pelas rotas, ponta a ponta:
//   cliente lança → contadora confere → confirma o mês → o cliente passa a ver o
//   resumo e o Demonstrativo → a contadora baixa o livro.
// E o isolamento nessas mesmas rotas: outro escritório, outra empresa do mesmo
// escritório, cliente em rota da contabilidade e empresa arquivada.
//
// As guardas de lib/acesso.ts rodam DE VERDADE (cookie assinado). Simulados: o
// cadastro (empresas), o banco (tests/bancoFalso.ts, em memória, com a view
// `resumo_mensal`) e a agenda do Demonstrativo.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bancoFalso, type BancoFalso } from './bancoFalso';
import { pedido, type QuemTeste } from './rotaTeste';

type Linha = Record<string, unknown>;
let tabelas: Record<string, Linha[]>;
let banco: BancoFalso;

vi.mock('@/lib/cadastro', async (orig) => {
  const { cadastroFalso, empresasTeste } = await import('./rotaTeste');
  const empresas = empresasTeste();
  return { ...(await orig<object>()), ...cadastroFalso(() => empresas) };
});
vi.mock('@/lib/db', async (orig) => ({ ...(await orig<object>()), getDb: () => banco }));
vi.mock('@/lib/agendaServidor', async (orig) => ({
  ...(await orig<object>()), listarObrigacoes: async () => [], listarConclusoes: async () => [],
}));

const lancamentos = await import('@/app/api/caixa/lancamentos/route');
const meses = await import('@/app/api/caixa/meses/route');
const resumo = await import('@/app/api/caixa/resumo/route');
const demonstrativo = await import('@/app/api/caixa/demonstrativo/route');
const livro = await import('@/app/api/caixa/livro/route');
const revisao = await import('@/app/api/caixa/revisao/route');

const num = (v: unknown) => Number(v ?? 0);
/** A view `resumo_mensal` (0005): 12 meses por exercício, saldo acumulado desde o saldo inicial. */
function resumoMensal(t: Record<string, Linha[]>): Linha[] {
  const r: Linha[] = [];
  for (const ex of t.exercicios ?? []) {
    let saldo = num(ex.saldo_inicial);
    for (let mes = 1; mes <= 12; mes++) {
      const ls = (t.lancamentos ?? []).filter((l) => l.exercicio_id === ex.id && l.mes === mes);
      const entradas = ls.reduce((s, l) => s + num(l.entrada), 0);
      const saidas = ls.reduce((s, l) => s + num(l.saida) + num(l.juros) + num(l.multa), 0);
      saldo += entradas - saidas;
      r.push({ exercicio_id: ex.id, mes, entradas, saidas, saldo_final: saldo });
    }
  }
  return r;
}

function novoBanco() {
  tabelas = {
    plano_contas: [
      { id: 'conta-receita', codigo: '3.01.01', nome: 'Receita de vendas', grupo: '3', natureza: 'receita', escritorio_id: null, ativa: true, ordem: 1 },
      { id: 'conta-aluguel', codigo: '4.01.01', nome: 'Aluguel', grupo: '4', natureza: 'despesa', escritorio_id: null, ativa: true, ordem: 2 },
      // Extensão do catálogo do escritório B: o escritório A não pode usar.
      { id: 'conta-de-b', codigo: '4.01.99', nome: 'Conta do B', grupo: '4', natureza: 'despesa', escritorio_id: '00000000-0000-4000-8000-00000000000b', ativa: true, ordem: 3 },
    ],
    // Exercício da empresa arquivada já existente, com um lançamento antigo.
    exercicios: [{ id: 'ex-arq', empresa_id: 'emp-arq', ano: 2026, saldo_inicial: 0 }],
    lancamentos: [{ id: 'l-arq', exercicio_id: 'ex-arq', data: '2026-01-05', mes: 1, historico: 'Venda', entrada: 50, saida: 0, juros: 0, multa: 0, criado_por: 'cli@arq.com', criado_em: '2026-01-05T10:00:00Z' }],
  };
  banco = bancoFalso(tabelas, 1000, {
    // `mes` é coluna gerada a partir da data; o default numérico vem do banco.
    aoGravar: {
      lancamentos: (l) => {
        if (typeof l.data === 'string') l.mes = Number(l.data.slice(5, 7));
        for (const c of ['entrada', 'saida', 'juros', 'multa']) l[c] ??= 0;
      },
      exercicios: (l) => { l.saldo_inicial ??= 0; },
    },
    // `exercicios!inner(empresa_id, ano)` em empresaDoLancamento.
    aoLer: {
      lancamentos: (l, t) => {
        const ex = (t.exercicios ?? []).find((e) => e.id === l.exercicio_id);
        return { ...l, exercicios: ex ? { empresa_id: ex.empresa_id, ano: ex.ano } : null };
      },
    },
    visoes: { resumo_mensal: resumoMensal },
  });
}

beforeEach(novoBanco);

const ANO = 2026;
const lancar = async (quem: QuemTeste, empresa: string, corpo: Record<string, unknown>) =>
  lancamentos.POST(await pedido(quem, '/api/caixa/lancamentos', { method: 'POST', body: { empresa, ano: ANO, ...corpo } }));
const lerMes = async (quem: QuemTeste, empresa: string, mes = 1) =>
  lancamentos.GET(await pedido(quem, `/api/caixa/lancamentos?empresa=${empresa}&ano=${ANO}&mes=${mes}`));
const conferir = async (quem: QuemTeste, id: string, conferido = true) =>
  lancamentos.PATCH(await pedido(quem, '/api/caixa/lancamentos', { method: 'PATCH', body: { id, conferido } }));
const editar = async (quem: QuemTeste, id: string, corpo: Record<string, unknown>) =>
  lancamentos.PATCH(await pedido(quem, '/api/caixa/lancamentos', { method: 'PATCH', body: { id, ...corpo } }));
const excluir = async (quem: QuemTeste, id: string) =>
  lancamentos.DELETE(await pedido(quem, `/api/caixa/lancamentos?id=${id}`, { method: 'DELETE' }));
const confirmarMes = async (quem: QuemTeste, empresa: string, mes: number, method = 'POST') =>
  meses[method as 'POST' | 'DELETE'](await pedido(quem, '/api/caixa/meses', { method, body: { empresa, ano: ANO, mes } }));
const lerResumo = async (quem: QuemTeste, empresa: string) =>
  resumo.GET(await pedido(quem, `/api/caixa/resumo?empresa=${empresa}&ano=${ANO}`));
const lerDemonstrativo = async (quem: QuemTeste, empresa: string, mes = 1) =>
  demonstrativo.GET(await pedido(quem, `/api/caixa/demonstrativo?empresa=${empresa}&ano=${ANO}&mes=${mes}`));
const baixarLivro = async (quem: QuemTeste, empresa: string, formato = 'pdf') =>
  livro.GET(await pedido(quem, `/api/caixa/livro?empresa=${empresa}&ano=${ANO}&formato=${formato}`));

const VENDA = { data: '2026-01-10', historico: 'Venda à vista', contaId: 'conta-receita', entrada: '1.000,00' };
const ALUGUEL = { data: '2026-01-15', historico: 'Aluguel da loja', contaId: 'conta-aluguel', saida: '300,00' };

/** Lança a venda e o aluguel de janeiro como o cliente da A1 e devolve os ids. */
async function janeiroDoCliente(): Promise<{ venda: string; aluguel: string }> {
  expect((await lancar('clienteA1', 'emp-a1', VENDA)).status).toBe(200);
  expect((await lancar('clienteA1', 'emp-a1', ALUGUEL)).status).toBe(200);
  const doMes = tabelas.lancamentos.filter((l) => l.exercicio_id !== 'ex-arq');
  return {
    venda: String(doMes.find((l) => l.historico === VENDA.historico)!.id),
    aluguel: String(doMes.find((l) => l.historico === ALUGUEL.historico)!.id),
  };
}

const estadoDoBanco = () => JSON.stringify({ l: tabelas.lancamentos, m: tabelas.meses_confirmados ?? [] });

describe('fluxo: cliente lança → contadora confere e confirma → resumo, Demonstrativo e livro', () => {
  it('ponta a ponta', async () => {
    const ids = await janeiroDoCliente();
    // O exercício nasceu sob demanda, na empresa da sessão; o autor é o cliente.
    expect(tabelas.exercicios.find((e) => e.empresa_id === 'emp-a1' && e.ano === ANO)).toBeTruthy();
    expect(tabelas.lancamentos.find((l) => l.id === ids.venda)).toMatchObject({ criado_por: 'cli@a1.com', entrada: 1000, mes: 1 });
    // A conta usada entrou na lista da empresa (lista aberta).
    expect(tabelas.empresa_contas).toEqual(expect.arrayContaining([expect.objectContaining({ empresa_id: 'emp-a1', conta_id: 'conta-aluguel' })]));

    // O cliente vê o mês que lançou, ainda não confirmado.
    const mes = await (await lerMes('clienteA1', 'emp-a1')).json();
    expect(mes).toMatchObject({ entradas: 1000, saidas: 300, saldoTransportado: 0, saldoFinal: 700, confirmado: false });
    expect(mes.lancamentos).toHaveLength(2);

    // Antes de confirmar: o cliente não vê resumo nem Demonstrativo (nem os números).
    const antes = await (await lerResumo('clienteA1', 'emp-a1')).json();
    expect(antes.liberadoAte).toBe(0);
    expect(antes.meses[0]).toMatchObject({ entradas: null, saidas: null, saldoFinal: null, liberado: false });
    expect(antes.total).toMatchObject({ entradas: 0, saidas: 0 });
    expect(await (await lerDemonstrativo('clienteA1', 'emp-a1')).json()).toMatchObject({ situacao: 'nao_liberado', liberadoAte: 0 });
    // A contabilidade vê o ano inteiro desde já.
    expect((await (await lerResumo('contadorA', 'emp-a1')).json()).total).toMatchObject({ entradas: 1000, saidas: 300, saldoFinal: 700 });

    // A contadora confere os dois lançamentos.
    expect((await conferir('contadorA', ids.venda)).status).toBe(200);
    expect((await conferir('contadorA', ids.aluguel)).status).toBe(200);
    expect(tabelas.lancamentos.find((l) => l.id === ids.venda)).toMatchObject({ conferido_por: 'c@a.com' });

    // Confirma janeiro: libera o resumo e o Demonstrativo ao cliente.
    expect((await confirmarMes('contadorA', 'emp-a1', 1)).status).toBe(200);
    expect(tabelas.meses_confirmados).toEqual([expect.objectContaining({ mes: 1, confirmado_por: 'c@a.com' })]);
    // Confirmar de novo não duplica (upsert).
    expect((await confirmarMes('contadorA', 'emp-a1', 1)).status).toBe(200);
    expect(tabelas.meses_confirmados).toHaveLength(1);

    const depois = await (await lerResumo('clienteA1', 'emp-a1')).json();
    expect(depois.liberadoAte).toBe(1);
    expect(depois.meses[0]).toMatchObject({ entradas: 1000, saidas: 300, saldoFinal: 700, confirmado: true, liberado: true });
    expect(depois.meses[1]).toMatchObject({ entradas: null, liberado: false });
    expect(depois.total).toMatchObject({ entradas: 1000, saidas: 300, saldoFinal: 700 });
    expect((await (await lerMes('clienteA1', 'emp-a1')).json()).confirmado).toBe(true);

    const demoCliente = await (await lerDemonstrativo('clienteA1', 'emp-a1')).json();
    expect(demoCliente.situacao).toBe('ok');
    expect(demoCliente.demonstrativo).toMatchObject({ entradas: 1000, saidas: 300, resultado: 700, saldoFinal: 700 });
    expect(demoCliente.demonstrativo.maioresSaidas).toEqual([{ conta: 'Aluguel', valor: 300 }]);
    // Registro de envio e destinatários são só da contabilidade.
    expect(demoCliente).not.toHaveProperty('destinatarios');
    expect(demoCliente).not.toHaveProperty('envio');
    const demoContadora = await (await lerDemonstrativo('contadorA', 'emp-a1')).json();
    expect(demoContadora).toMatchObject({ situacao: 'ok', destinatarios: 0 });
    // Fevereiro não foi confirmado: nem a prévia da contadora mostra.
    expect((await (await lerDemonstrativo('contadorA', 'emp-a1', 2)).json()).situacao).toBe('nao_liberado');

    // O livro: a contadora baixa PDF e planilha; o PDF grava a quantidade de folhas no termo.
    const pdf = await baixarLivro('contadorA', 'emp-a1');
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(pdf.headers.get('content-disposition')).toContain('livro_caixa_Padaria_A1_2026.pdf');
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    expect(num(tabelas.exercicios.find((e) => e.empresa_id === 'emp-a1')!.qtd_folhas)).toBeGreaterThan(0);
    const xlsx = await baixarLivro('contadorA', 'emp-a1', 'xlsx');
    expect(xlsx.status).toBe(200);
    expect(xlsx.headers.get('content-type')).toContain('spreadsheetml');
  });

  it('o cliente edita o lançamento conferido: a conferência cai e volta para a fila', async () => {
    const ids = await janeiroDoCliente();
    await conferir('contadorA', ids.aluguel);
    expect((await editar('clienteA1', ids.aluguel, { ...ALUGUEL, saida: '350,00' })).status).toBe(200);
    expect(tabelas.lancamentos.find((l) => l.id === ids.aluguel)).toMatchObject({ saida: 350, conferido_por: null, atualizado_por: 'cli@a1.com' });
  });

  it('desconfirmar o mês esconde de novo o resumo do cliente', async () => {
    await janeiroDoCliente();
    await confirmarMes('contadorA', 'emp-a1', 1);
    expect((await (await lerResumo('clienteA1', 'emp-a1')).json()).liberadoAte).toBe(1);
    expect((await confirmarMes('contadorA', 'emp-a1', 1, 'DELETE')).status).toBe(200);
    expect((await (await lerResumo('clienteA1', 'emp-a1')).json()).liberadoAte).toBe(0);
  });

  it('pagamento em cheque grava a retirada e o pagamento (o par é neutro no saldo do pagamento)', async () => {
    const r = await lancar('clienteA1', 'emp-a1', { ...ALUGUEL, cheque: true, juros: '10,00' });
    expect(await r.json()).toMatchObject({ ok: true, criados: 2 });
    const mes = await (await lerMes('clienteA1', 'emp-a1')).json();
    // Retirada de 310 (principal + juros) entra; o pagamento de 300 + 10 sai.
    expect(mes).toMatchObject({ entradas: 310, saidas: 310, saldoFinal: 0 });
    expect(mes.lancamentos.map((l: { historico: string }) => l.historico)).toEqual(['Retirada de conta corrente', ALUGUEL.historico]);
  });
});

describe('isolamento nas rotas do fluxo do caixa', () => {
  it('cliente não confere, não confirma mês, não baixa livro nem vê a revisão', async () => {
    const ids = await janeiroDoCliente();
    const antes = estadoDoBanco();
    expect((await conferir('clienteA1', ids.venda)).status).toBe(403);
    expect((await confirmarMes('clienteA1', 'emp-a1', 1)).status).toBe(403);
    expect((await confirmarMes('clienteA1', 'emp-a1', 1, 'DELETE')).status).toBe(403);
    expect((await baixarLivro('clienteA1', 'emp-a1')).status).toBe(403);
    expect((await livro.POST(await pedido('clienteA1', '/api/caixa/livro', { method: 'POST', body: { empresa: 'emp-a1', ano: ANO, numeroLivro: 9 } }))).status).toBe(403);
    expect((await revisao.GET(await pedido('clienteA1', `/api/caixa/revisao?empresa=emp-a1&ano=${ANO}`))).status).toBe(403);
    expect(estadoDoBanco()).toBe(antes);
  });

  it('contador de OUTRO escritório: 403 em tudo, nada gravado nem lido', async () => {
    const ids = await janeiroDoCliente();
    const antes = estadoDoBanco();
    expect((await lerMes('contadorB', 'emp-a1')).status).toBe(403);
    expect((await lancar('contadorB', 'emp-a1', VENDA)).status).toBe(403);
    expect((await conferir('contadorB', ids.venda)).status).toBe(403);
    expect((await editar('contadorB', ids.venda, { ...VENDA, entrada: '1,00' })).status).toBe(403);
    expect((await excluir('contadorB', ids.venda)).status).toBe(403);
    expect((await confirmarMes('contadorB', 'emp-a1', 1)).status).toBe(403);
    expect((await lerResumo('contadorB', 'emp-a1')).status).toBe(403);
    expect((await lerDemonstrativo('contadorB', 'emp-a1')).status).toBe(403);
    expect((await baixarLivro('contadorB', 'emp-a1')).status).toBe(403);
    expect(estadoDoBanco()).toBe(antes);
  });

  it('cliente de OUTRA empresa do mesmo escritório: 403 em tudo', async () => {
    const ids = await janeiroDoCliente();
    await confirmarMes('contadorA', 'emp-a1', 1);
    const antes = estadoDoBanco();
    expect((await lerMes('clienteA2', 'emp-a1')).status).toBe(403);
    expect((await lancar('clienteA2', 'emp-a1', VENDA)).status).toBe(403);
    expect((await editar('clienteA2', ids.venda, { ...VENDA, entrada: '1,00' })).status).toBe(403);
    expect((await excluir('clienteA2', ids.venda)).status).toBe(403);
    expect((await lerResumo('clienteA2', 'emp-a1')).status).toBe(403);
    expect((await lerDemonstrativo('clienteA2', 'emp-a1')).status).toBe(403);
    expect(estadoDoBanco()).toBe(antes);
  });

  it('conta do catálogo de outro escritório não entra no lançamento', async () => {
    const r = await lancar('clienteA1', 'emp-a1', { ...ALUGUEL, contaId: 'conta-de-b' });
    expect(r.status).toBe(400);
    expect(tabelas.lancamentos.filter((l) => l.exercicio_id !== 'ex-arq')).toHaveLength(0);
  });

  it('o cliente exclui o próprio lançamento (controle positivo)', async () => {
    const ids = await janeiroDoCliente();
    expect((await excluir('clienteA1', ids.venda)).status).toBe(200);
    expect(tabelas.lancamentos.find((l) => l.id === ids.venda)).toBeUndefined();
  });

  it('empresa arquivada: a contabilidade consulta, mas não grava (409); o cliente dela não entra (403)', async () => {
    const antes = estadoDoBanco();
    const leitura = await lerMes('contadorA', 'emp-arq');
    expect(leitura.status).toBe(200);
    expect((await leitura.json()).lancamentos).toHaveLength(1);
    expect((await lerResumo('contadorA', 'emp-arq')).status).toBe(200);

    for (const r of [
      await lancar('contadorA', 'emp-arq', VENDA),
      await conferir('contadorA', 'l-arq'),
      await editar('contadorA', 'l-arq', { ...VENDA, entrada: '1,00' }),
      await excluir('contadorA', 'l-arq'),
      await confirmarMes('contadorA', 'emp-arq', 1),
    ]) {
      expect(r.status).toBe(409);
      expect((await r.json()).erro).toMatch(/arquivada/i);
    }

    expect((await lerMes('clienteArq', 'emp-arq')).status).toBe(403);
    expect((await lancar('clienteArq', 'emp-arq', VENDA)).status).toBe(403);
    expect((await excluir('clienteArq', 'l-arq')).status).toBe(403);
    expect((await lerResumo('clienteArq', 'emp-arq')).status).toBe(403);
    expect(estadoDoBanco()).toBe(antes);
  });

  it('sem sessão: 401 e nada gravado', async () => {
    expect((await lancamentos.POST(await pedido(null, '/api/caixa/lancamentos', { method: 'POST', body: { empresa: 'emp-a1', ano: ANO, ...VENDA } }))).status).toBe(401);
    expect((await meses.POST(await pedido(null, '/api/caixa/meses', { method: 'POST', body: { empresa: 'emp-a1', ano: ANO, mes: 1 } }))).status).toBe(401);
    expect(tabelas.lancamentos).toHaveLength(1);
    expect(tabelas.meses_confirmados ?? []).toHaveLength(0);
  });
});
