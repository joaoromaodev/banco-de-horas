// Mês fechado que trava (Sprint 17, frente C), pelas rotas e com as guardas REAIS de
// lib/acesso.ts (cookie assinado). Banco em memória (tests/bancoFalso.ts).
//
// Caixa: mês confirmado não aceita lançamento novo, edição nem exclusão — do cliente
// nem da contadora — e nem troca de saldo inicial; reabrir exige contabilidade e
// motivo, e o histórico guarda quem fechou/reabriu, quando e por quê.
// Ponto: a contadora fecha o mês depois do resumo (foto guardada), as frequências
// não mudam (salvar, aplicar envio, enviar foto), o cliente dá o aceite ou registra
// dúvida, e só a contabilidade reabre, com motivo.
// Isolamento: outro escritório, outra empresa do mesmo escritório, cliente em rota da
// contabilidade, empresa arquivada, sem sessão — sempre conferindo que nada foi gravado.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bancoFalso, type BancoFalso } from './bancoFalso';
import { ESC_A, pedido, type QuemTeste } from './rotaTeste';

type Linha = Record<string, unknown>;
let tabelas: Record<string, Linha[]>;
let banco: BancoFalso;
/** Simula o banco SEM a 0034: as tabelas novas respondem "não existe". */
let sem0034 = false;
const TABELAS_0034 = ['caixa_meses_historico', 'ponto_meses_fechados', 'ponto_meses_historico', 'ponto_aceites'];

vi.mock('@/lib/cadastro', async (orig) => {
  const { cadastroFalso, empresasTeste } = await import('./rotaTeste');
  const empresas = empresasTeste();
  return {
    ...(await orig<object>()), ...cadastroFalso(() => empresas),
    lerJornadaEmpresa: async () => ({ utilMin: 480, sabadoMin: 0, trabalhaSabado: false }),
  };
});

/** Tabela inexistente, como o PostgREST responde (PGRST205), para qualquer cadeia do builder. */
function tabelaInexistente() {
  const resposta = { data: null, error: { code: 'PGRST205', message: 'Could not find the table in the schema cache' } };
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'gte', 'order', 'limit', 'maybeSingle', 'in', 'is']) q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve(resposta).then(ok);
  return q;
}
vi.mock('@/lib/db', async (orig) => ({
  ...(await orig<object>()),
  getDb: () => ({ from: (t: string) => (sem0034 && TABELAS_0034.includes(t) ? tabelaInexistente() : banco.from(t)) }),
}));

// As leituras do ponto usam `.or()` (o banco falso não tem): aqui leem as tabelas direto.
// A gravação (salvarFrequencia, com a trava) é a REAL.
vi.mock('@/lib/pontoDb', async (orig) => {
  const real = await orig<typeof import('@/lib/pontoDb')>();
  return {
    ...real,
    lerFeriados: async () => [],
    lerFuncionarios: async () => [],
    lerFrequenciasParaRevisao: async (esc: string, empresa: string, ano: number, mes: number) => {
      const porFunc = new Map<string, { empresa: string; funcionario: string; ano: number; mes: number; dias: unknown[] }>();
      for (const r of tabelas.ponto_frequencias ?? []) {
        if (r.escritorio_id !== esc || r.empresa_id !== empresa || r.ano !== ano || r.mes !== mes) continue;
        const nome = String(r.funcionario);
        if (!porFunc.has(nome)) porFunc.set(nome, { empresa, funcionario: nome, ano, mes, dias: [] });
        porFunc.get(nome)!.dias.push({
          dia: r.dia, entradaManha: r.entrada_manha, saidaAlmoco: r.saida_almoco, retornoAlmoco: r.retorno_almoco,
          saidaTarde: r.saida_tarde, marcador: r.marcador ?? null,
        });
      }
      return { doMes: [...porFunc.values()], anteriores: new Map() };
    },
  };
});

const lancamentos = await import('@/app/api/caixa/lancamentos/route');
const meses = await import('@/app/api/caixa/meses/route');
const exercicio = await import('@/app/api/caixa/exercicio/route');
const salvar = await import('@/app/api/salvar/route');
const fechamento = await import('@/app/api/resumo-folha/fechamento/route');
const aceite = await import('@/app/api/envio-ponto/aceite/route');
const { aplicarEnvio, iniciarEnvio } = await import('@/lib/envioPontoServidor');
const { aceitesPendentes } = await import('@/lib/avisosClienteServidor');

function novoBanco() {
  sem0034 = false;
  tabelas = {
    plano_contas: [
      { id: 'conta-receita', codigo: '3.01.01', nome: 'Receita de vendas', grupo: '3', natureza: 'receita', escritorio_id: null, ativa: true, ordem: 1 },
    ],
    exercicios: [{ id: 'ex-arq', empresa_id: 'emp-arq', ano: 2026, saldo_inicial: 0 }],
    lancamentos: [],
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
beforeEach(novoBanco);

// =================================================================== CAIXA

const ANO = 2026;
const VENDA_JAN = { data: '2026-01-10', historico: 'Venda à vista', contaId: 'conta-receita', entrada: '1.000,00' };
const VENDA_FEV = { ...VENDA_JAN, data: '2026-02-10' };

const lancar = async (quem: QuemTeste, empresa: string, corpo: Linha) =>
  lancamentos.POST(await pedido(quem, '/api/caixa/lancamentos', { method: 'POST', body: { empresa, ano: ANO, ...corpo } }));
const editar = async (quem: QuemTeste, id: string, corpo: Linha) =>
  lancamentos.PATCH(await pedido(quem, '/api/caixa/lancamentos', { method: 'PATCH', body: { id, ...corpo } }));
const excluir = async (quem: QuemTeste, id: string) =>
  lancamentos.DELETE(await pedido(quem, `/api/caixa/lancamentos?id=${id}`, { method: 'DELETE' }));
const fechar = async (quem: QuemTeste | null, empresa: string, mes: number) =>
  meses.POST(await pedido(quem, '/api/caixa/meses', { method: 'POST', body: { empresa, ano: ANO, mes } }));
const reabrir = async (quem: QuemTeste | null, empresa: string, mes: number, motivo?: string) =>
  meses.DELETE(await pedido(quem, '/api/caixa/meses', { method: 'DELETE', body: { empresa, ano: ANO, mes, motivo } }));
const lerFechamentos = async (quem: QuemTeste, empresa: string) =>
  meses.GET(await pedido(quem, `/api/caixa/meses?empresa=${empresa}&ano=${ANO}`));

const lancsA1 = () => tabelas.lancamentos.filter((l) => l.exercicio_id !== 'ex-arq');
const estadoCaixa = () => JSON.stringify({ l: tabelas.lancamentos, m: tabelas.meses_confirmados ?? [], h: tabelas.caixa_meses_historico ?? [] });

/** Janeiro com uma venda do cliente, fechado pela contadora. Devolve o id da venda. */
async function janeiroFechado(): Promise<string> {
  expect((await lancar('clienteA1', 'emp-a1', VENDA_JAN)).status).toBe(200);
  const id = String(lancsA1()[0].id);
  expect((await fechar('contadorA', 'emp-a1', 1)).status).toBe(200);
  return id;
}

describe('caixa: mês fechado trava os lançamentos (servidor)', () => {
  it('ninguém cria, edita ou exclui lançamento de mês fechado: 409 com mensagem clara e nada gravado', async () => {
    const id = await janeiroFechado();
    const antes = estadoCaixa();
    for (const quem of ['clienteA1', 'contadorA'] as const) {
      for (const r of [
        await lancar(quem, 'emp-a1', VENDA_JAN),
        await lancar(quem, 'emp-a1', { ...VENDA_JAN, cheque: true, entrada: '', saida: '10,00' }),
        await editar(quem, id, { ...VENDA_JAN, entrada: '1,00' }),
        await excluir(quem, id),
      ]) {
        expect(r.status).toBe(409);
        const { erro } = await r.json();
        expect(erro).toMatch(/Janeiro\/2026 está fechado pela contabilidade/);
        expect(erro).toMatch(/reabre o mês informando o motivo/);
      }
    }
    expect(estadoCaixa()).toBe(antes);
  });

  it('não leva lançamento de um mês aberto para o fechado (nem tira do fechado)', async () => {
    await janeiroFechado();
    expect((await lancar('clienteA1', 'emp-a1', VENDA_FEV)).status).toBe(200); // fevereiro aberto: controle positivo
    const fev = String(lancsA1().find((l) => l.data === '2026-02-10')!.id);
    const r = await editar('clienteA1', fev, { ...VENDA_FEV, data: '2026-01-20' });
    expect(r.status).toBe(409);
    expect(tabelas.lancamentos.find((l) => l.id === fev)).toMatchObject({ data: '2026-02-10' });
  });

  it('os meses fecham em ordem: fevereiro não fecha com janeiro aberto', async () => {
    expect((await lancar('clienteA1', 'emp-a1', VENDA_FEV)).status).toBe(200);
    const r = await fechar('contadorA', 'emp-a1', 2);
    expect(r.status).toBe(409);
    expect((await r.json()).erro).toMatch(/Feche antes Janeiro\/2026/);
    expect(tabelas.meses_confirmados ?? []).toHaveLength(0);
    expect((await fechar('contadorA', 'emp-a1', 1)).status).toBe(200);
    expect((await fechar('contadorA', 'emp-a1', 2)).status).toBe(200);
  });

  it('mês anterior a um fechado também trava (o saldo dele é o transportado do fechado)', async () => {
    expect((await lancar('clienteA1', 'emp-a1', VENDA_JAN)).status).toBe(200);
    const ex = tabelas.exercicios.find((e) => e.empresa_id === 'emp-a1')!;
    // Dado de antes da regra de ordem: fevereiro confirmado com janeiro aberto.
    tabelas.meses_confirmados = [{ exercicio_id: ex.id, mes: 2, confirmado_por: 'c@a.com', confirmado_em: '2026-03-01T12:00:00Z' }];
    const antes = estadoCaixa();
    const r = await lancar('clienteA1', 'emp-a1', VENDA_JAN);
    expect(r.status).toBe(409);
    expect((await r.json()).erro).toMatch(/Fevereiro\/2026 está fechado e o saldo dele vem de Janeiro\/2026/);
    expect((await editar('contadorA', String(lancsA1()[0].id), { ...VENDA_JAN, entrada: '5,00' })).status).toBe(409);
    expect(estadoCaixa()).toBe(antes);
    expect((await lancar('clienteA1', 'emp-a1', { ...VENDA_JAN, data: '2026-03-02' })).status).toBe(200); // março, depois: livre
  });

  it('reabrir um mês reabre os fechados depois dele, com o mesmo motivo no histórico', async () => {
    await janeiroFechado();
    expect((await fechar('contadorA', 'emp-a1', 2)).status).toBe(200);
    const r = await reabrir('contadorA', 'emp-a1', 1, 'Venda de janeiro em duplicidade');
    expect(await r.json()).toMatchObject({ ok: true, reabertos: [1, 2] });
    expect(tabelas.meses_confirmados).toHaveLength(0);
    const reab = (tabelas.caixa_meses_historico ?? []).filter((h) => h.acao === 'reabriu');
    expect(reab.map((h) => h.mes).sort()).toEqual([1, 2]);
    expect(reab.every((h) => h.motivo === 'Venda de janeiro em duplicidade' && h.por === 'c@a.com')).toBe(true);
  });

  it('a conferência continua livre no mês fechado (não muda o livro)', async () => {
    const id = await janeiroFechado();
    const r = await lancamentos.PATCH(await pedido('contadorA', '/api/caixa/lancamentos', { method: 'PATCH', body: { id, conferido: true } }));
    expect(r.status).toBe(200);
    expect(tabelas.lancamentos.find((l) => l.id === id)).toMatchObject({ conferido_por: 'c@a.com', entrada: 1000 });
  });

  it('saldo inicial não muda com mês fechado no exercício', async () => {
    await janeiroFechado();
    const r = await exercicio.PATCH(await pedido('contadorA', '/api/caixa/exercicio', { method: 'PATCH', body: { empresa: 'emp-a1', ano: ANO, saldoInicial: '500,00' } }));
    expect(r.status).toBe(409);
    expect((await r.json()).erro).toMatch(/Janeiro\/2026 está fechado/);
    expect(tabelas.exercicios.find((e) => e.empresa_id === 'emp-a1')).toMatchObject({ saldo_inicial: 0 });
  });

  it('fechar de novo não muda quem fechou nem duplica o histórico', async () => {
    await janeiroFechado();
    expect((await (await fechar('contadorA', 'emp-a1', 1)).json())).toMatchObject({ jaFechado: true });
    expect(tabelas.meses_confirmados).toHaveLength(1);
    expect(tabelas.caixa_meses_historico).toHaveLength(1);
  });

  it('reabrir exige contabilidade e motivo; fica no histórico; depois o cliente volta a lançar', async () => {
    const id = await janeiroFechado();
    const antes = estadoCaixa();
    // Cliente não reabre (nem com motivo); sem motivo ou com motivo curto, 400.
    expect((await reabrir('clienteA1', 'emp-a1', 1, 'Quero corrigir a venda')).status).toBe(403);
    for (const motivo of [undefined, '', '   ', 'abc']) {
      const r = await reabrir('contadorA', 'emp-a1', 1, motivo);
      expect(r.status).toBe(400);
      expect((await r.json()).erro).toMatch(/motivo/i);
    }
    expect(estadoCaixa()).toBe(antes);

    expect((await reabrir('contadorA', 'emp-a1', 1, '  Venda   lançada em duplicidade ')).status).toBe(200);
    expect(tabelas.meses_confirmados).toHaveLength(0);
    const hist = await (await lerFechamentos('contadorA', 'emp-a1')).json();
    expect(hist.historicoDisponivel).toBe(true);
    expect(hist.historico).toEqual([
      expect.objectContaining({ mes: 1, acao: 'reabriu', por: 'c@a.com', motivo: 'Venda lançada em duplicidade' }),
      expect.objectContaining({ mes: 1, acao: 'fechou', por: 'c@a.com', motivo: null }),
    ]);
    // Reaberto: edição liberada de novo (para o cliente também).
    expect((await editar('clienteA1', id, { ...VENDA_JAN, entrada: '900,00' })).status).toBe(200);
    // Fecha de novo: novo registro "fechou".
    expect((await fechar('contadorA', 'emp-a1', 1)).status).toBe(200);
    expect((await (await lerFechamentos('contadorA', 'emp-a1')).json()).fechados).toEqual([expect.objectContaining({ mes: 1, por: 'c@a.com' })]);
    expect(tabelas.caixa_meses_historico).toHaveLength(3);
  });

  it('sem a 0034: fechar funciona, mas reabrir recusa (503) para o motivo não se perder', async () => {
    sem0034 = true;
    await janeiroFechado();
    const r = await reabrir('contadorA', 'emp-a1', 1, 'Venda em duplicidade');
    expect(r.status).toBe(503);
    expect((await r.json()).erro).toMatch(/0034/);
    expect(tabelas.meses_confirmados).toHaveLength(1);
    expect((await (await lerFechamentos('contadorA', 'emp-a1')).json()).historicoDisponivel).toBe(false);
  });

  it('isolamento: outro escritório, outra empresa, cliente no histórico, arquivada e sem sessão', async () => {
    await janeiroFechado();
    const antes = estadoCaixa();
    expect((await reabrir('contadorB', 'emp-a1', 1, 'Motivo qualquer')).status).toBe(403);
    expect((await fechar('contadorB', 'emp-a1', 2)).status).toBe(403);
    expect((await lerFechamentos('contadorB', 'emp-a1')).status).toBe(403);
    expect((await lerFechamentos('clienteA1', 'emp-a1')).status).toBe(403); // o histórico é da contabilidade
    expect((await reabrir('clienteA2', 'emp-a1', 1, 'Motivo qualquer')).status).toBe(403);
    expect((await reabrir(null, 'emp-a1', 1, 'Motivo qualquer')).status).toBe(401);
    expect((await fechar(null, 'emp-a1', 2)).status).toBe(401);
    const arq = await fechar('contadorA', 'emp-arq', 1);
    expect(arq.status).toBe(409);
    expect((await arq.json()).erro).toMatch(/arquivada/i);
    expect(estadoCaixa()).toBe(antes);
    // Fechar janeiro da A1 não trava a A2 (mesmo escritório).
    expect((await lancar('clienteA2', 'emp-a2', VENDA_JAN)).status).toBe(200);
  });
});

// =================================================================== PONTO

const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem' }).format(new Date());
// O mês passado (o cliente vê os fechamentos dos últimos 13 meses).
const P_ANO = Number(hoje.slice(5, 7)) === 1 ? Number(hoje.slice(0, 4)) - 1 : Number(hoje.slice(0, 4));
const P_MES = Number(hoje.slice(5, 7)) === 1 ? 12 : Number(hoje.slice(5, 7)) - 1;
/** Primeiro dia útil (seg–sex) do mês: com um dia só não há "dia útil em branco". */
const DIA_UTIL = (() => {
  for (let d = 1; d <= 7; d++) { const w = new Date(Date.UTC(P_ANO, P_MES - 1, d)).getUTCDay(); if (w >= 1 && w <= 5) return d; }
  return 1;
})();
const DIA = (extra: Linha = {}) => ({ dia: DIA_UTIL, entradaManha: '08:00', saidaAlmoco: '12:00', retornoAlmoco: '13:00', saidaTarde: '17:00', marcador: null, ...extra });

const salvarFolha = async (quem: QuemTeste, empresa: string, dias: Linha[] = [DIA()]) =>
  salvar.POST(await pedido(quem, '/api/salvar', { method: 'POST', body: { frequencia: { empresa, funcionario: 'MARIA SILVA', ano: P_ANO, mes: P_MES, dias } } }));
const acaoPonto = async (quem: QuemTeste | null, empresa: string, corpo: Linha) =>
  fechamento.POST(await pedido(quem, '/api/resumo-folha/fechamento', { method: 'POST', body: { empresa, ano: P_ANO, mes: P_MES, ...corpo } }));
const lerFechamentoPonto = async (quem: QuemTeste, empresa: string) =>
  fechamento.GET(await pedido(quem, `/api/resumo-folha/fechamento?empresa=${empresa}&ano=${P_ANO}&mes=${P_MES}`));
const lerAceite = async (quem: QuemTeste | null) => aceite.GET(await pedido(quem, '/api/envio-ponto/aceite'));
const responder = async (quem: QuemTeste | null, corpo: Linha) =>
  aceite.POST(await pedido(quem, '/api/envio-ponto/aceite', { method: 'POST', body: { ano: P_ANO, mes: P_MES, ...corpo } }));

const estadoPonto = () => JSON.stringify({
  f: tabelas.ponto_frequencias ?? [], m: tabelas.ponto_meses_fechados ?? [], h: tabelas.ponto_meses_historico ?? [], a: tabelas.ponto_aceites ?? [],
});

/** A contadora salva a folha da A1 e fecha o mês. Devolve a assinatura do fechamento. */
async function pontoFechado(): Promise<string> {
  expect((await salvarFolha('contadorA', 'emp-a1')).status).toBe(200);
  const r = await acaoPonto('contadorA', 'emp-a1', { acao: 'fechar' });
  expect(r.status).toBe(200);
  return String((await r.json()).fechamento.assinatura);
}

describe('ponto: fechar o mês trava as frequências', () => {
  it('fecha com a foto do resumo (só horas e dias) e registra no histórico', async () => {
    await pontoFechado();
    expect(tabelas.ponto_meses_fechados).toHaveLength(1);
    const f = tabelas.ponto_meses_fechados[0];
    expect(f).toMatchObject({ escritorio_id: ESC_A, empresa_id: 'emp-a1', ano: P_ANO, mes: P_MES, fechado_por: 'c@a.com' });
    const linha = (f.resumo as { funcionarios: Linha[] }).funcionarios[0];
    expect(linha).toMatchObject({ funcionario: 'MARIA SILVA', dias: 1, normaisMin: 480 });
    // Sem detalhe por dia, sem pendências internas, sem nada em reais.
    expect(Object.keys(linha).sort()).toEqual([
      'atestadoDias', 'atrasoMin', 'bancoMin', 'dias', 'dsrPerdidos', 'extrasDomFeriadoMin', 'extrasMin', 'faltas', 'feriasDias',
      'funcionario', 'normaisMin', 'noturnoMin',
    ]);
    expect(tabelas.ponto_meses_historico).toEqual([expect.objectContaining({ acao: 'fechou', por: 'c@a.com', empresa_id: 'emp-a1' })]);
    const g = await (await lerFechamentoPonto('contadorA', 'emp-a1')).json();
    expect(g.fechamento).toMatchObject({ por: 'c@a.com' });
    expect(g.aceite).toMatchObject({ situacao: 'pendente', ultimo: null });
  });

  it('fechado: salvar a folha dá 409 com mensagem clara e nada muda; fechar de novo, 409', async () => {
    await pontoFechado();
    const antes = estadoPonto();
    const r = await salvarFolha('contadorA', 'emp-a1', [DIA({ saidaTarde: '19:00' })]);
    expect(r.status).toBe(409);
    expect((await r.json()).erro).toMatch(/está fechado: as frequências desse mês não mudam.*reabre o mês informando o motivo/);
    expect((await acaoPonto('contadorA', 'emp-a1', { acao: 'fechar' })).status).toBe(409);
    expect(estadoPonto()).toBe(antes);
  });

  it('fechado: a folha enviada pelo cliente não é aplicada e nova foto não é aceita (409)', async () => {
    await pontoFechado();
    const antes = estadoPonto();
    const envio = {
      id: 'env-1', escritorioId: ESC_A, empresaId: 'emp-a1', funcionario: 'MARIA SILVA', ano: P_ANO, mes: P_MES, situacao: 'lida',
    } as unknown as Parameters<typeof aplicarEnvio>[0];
    await expect(aplicarEnvio(envio, 'MARIA SILVA', [DIA() as never], 'c@a.com')).rejects.toMatchObject({ status: 409 });
    await expect(iniciarEnvio({
      escritorioId: ESC_A, empresaId: 'emp-a1', funcionario: 'MARIA SILVA', empregadoId: null, ano: P_ANO, mes: P_MES,
      tamanho: 100, tipo: { mime: 'image/jpeg', ext: 'jpg' }, autor: 'cli@a1.com', maxHora: 30,
    } as Parameters<typeof iniciarEnvio>[0])).rejects.toMatchObject({ status: 409 });
    expect(tabelas.ponto_envios ?? []).toHaveLength(0);
    expect(estadoPonto()).toBe(antes);
  });

  it('com pendência impeditiva (marcação faltando) o mês não fecha', async () => {
    expect((await salvarFolha('contadorA', 'emp-a1', [DIA({ retornoAlmoco: null, saidaTarde: null, saidaAlmoco: null })])).status).toBe(200);
    const r = await acaoPonto('contadorA', 'emp-a1', { acao: 'fechar' });
    expect(r.status).toBe(409);
    expect((await r.json()).erro).toMatch(/Corrija antes de fechar/);
    expect(tabelas.ponto_meses_fechados ?? []).toHaveLength(0);
  });

  it('reabrir exige contabilidade e motivo; depois a folha volta a ser salva e o aceite é pedido de novo se os números mudarem', async () => {
    const assinatura = await pontoFechado();
    expect((await responder('clienteA1', { assinatura, resposta: 'aceito' })).status).toBe(200);
    const antes = estadoPonto();
    // O cliente não chega à rota de fechamento (guarda de gestor), nem para reabrir.
    expect((await acaoPonto('clienteA1', 'emp-a1', { acao: 'reabrir', motivo: 'Faltou o atestado do dia 12' })).status).toBe(403);
    for (const motivo of [undefined, '', 'ok']) {
      const r = await acaoPonto('contadorA', 'emp-a1', { acao: 'reabrir', motivo });
      expect(r.status).toBe(400);
      expect((await r.json()).erro).toMatch(/motivo/i);
    }
    expect(estadoPonto()).toBe(antes);

    expect((await acaoPonto('contadorA', 'emp-a1', { acao: 'reabrir', motivo: 'Faltou o atestado do dia 12' })).status).toBe(200);
    expect(tabelas.ponto_meses_fechados).toHaveLength(0);
    const hist = (await (await lerFechamentoPonto('contadorA', 'emp-a1')).json()).historico;
    expect(hist[0]).toMatchObject({ acao: 'reabriu', por: 'c@a.com', motivo: 'Faltou o atestado do dia 12' });
    expect((await (await lerAceite('clienteA1')).json()).meses).toEqual([]);

    // Reaberto: salva; fechado de novo com outros números → aceite pendente de novo.
    expect((await salvarFolha('contadorA', 'emp-a1', [DIA({ saidaTarde: '18:00' })])).status).toBe(200);
    const nova = await acaoPonto('contadorA', 'emp-a1', { acao: 'fechar' });
    expect((await nova.json()).fechamento.assinatura).not.toBe(assinatura);
    expect((await (await lerAceite('clienteA1')).json()).meses[0]).toMatchObject({ situacao: 'pendente' });
  });
});

describe('ponto: aceite do cliente', () => {
  it('vê o resumo, registra dúvida (com texto) e depois aceita; a contadora vê quem e quando', async () => {
    const assinatura = await pontoFechado();
    const lista = await (await lerAceite('clienteA1')).json();
    expect(lista.meses).toHaveLength(1);
    expect(lista.meses[0]).toMatchObject({ ano: P_ANO, mes: P_MES, situacao: 'pendente', assinatura });
    // Não diz quem da contabilidade fechou.
    expect(JSON.stringify(lista)).not.toContain('c@a.com');

    // O aviso do sino: um por mês pendente, sem nome de funcionário.
    const avisos = await aceitesPendentes(ESC_A, 'emp-a1');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ tipo: 'aceite_ponto', href: '/enviar-ponto#aceite' });
    expect(`${avisos[0].titulo} ${avisos[0].texto}`).not.toMatch(/MARIA/i);

    const semTexto = await responder('clienteA1', { assinatura, resposta: 'duvida', duvida: ' ' });
    expect(semTexto.status).toBe(400);
    expect((await responder('clienteA1', { assinatura, resposta: 'duvida', duvida: 'No dia 12 ela estava de atestado.' })).status).toBe(200);
    expect((await (await lerAceite('clienteA1')).json()).meses[0]).toMatchObject({ situacao: 'duvida' });
    expect(await aceitesPendentes(ESC_A, 'emp-a1')).toHaveLength(0); // já respondeu: o sino para de pedir

    expect((await responder('clienteA1', { assinatura, resposta: 'aceito' })).status).toBe(200);
    const g = await (await lerFechamentoPonto('contadorA', 'emp-a1')).json();
    expect(g.aceite.situacao).toBe('aceito');
    expect(g.aceite.ultimo).toMatchObject({ por: 'cli@a1.com', resposta: 'aceito' });
    expect(g.respostas).toHaveLength(2);
    expect(Date.parse(g.aceite.ultimo.em)).not.toBeNaN();

    // O aceite guarda a versão da declaração; a dúvida, não.
    expect(tabelas.ponto_aceites.map((a) => a.declaracao)).toEqual([null, 'v1']);

    // Aceito é definitivo para esses números.
    const de0 = (tabelas.ponto_aceites ?? []).length;
    expect((await responder('clienteA1', { assinatura, resposta: 'duvida', duvida: 'Mudei de ideia' })).status).toBe(409);
    expect(tabelas.ponto_aceites).toHaveLength(de0);
  });

  it('dúvidas repetidas têm teto por mês (429)', async () => {
    const assinatura = await pontoFechado();
    for (let i = 0; i < 30; i++) {
      expect((await responder('clienteA1', { assinatura, resposta: 'duvida', duvida: `Dúvida ${i}` })).status).toBe(200);
    }
    expect((await responder('clienteA1', { assinatura, resposta: 'duvida', duvida: 'Mais uma' })).status).toBe(429);
    expect(tabelas.ponto_aceites).toHaveLength(30);
  });

  it('assinatura velha (números mudaram) ou mês não fechado: 409, nada gravado', async () => {
    await pontoFechado();
    expect((await responder('clienteA1', { assinatura: 'outra', resposta: 'aceito' })).status).toBe(409);
    const r = await aceite.POST(await pedido('clienteA1', '/api/envio-ponto/aceite', {
      method: 'POST', body: { ano: P_ANO, mes: P_MES === 1 ? 2 : P_MES - 1, assinatura: 'x', resposta: 'aceito' },
    }));
    expect(r.status).toBe(409);
    expect(tabelas.ponto_aceites ?? []).toHaveLength(0);
  });

  it('isolamento: outra empresa, outro escritório, contabilidade na rota do cliente, arquivada e sem sessão', async () => {
    const assinatura = await pontoFechado();
    const antes = estadoPonto();
    // Cliente da A2 (mesmo escritório) não vê nem responde o mês da A1: a empresa vem da sessão.
    expect((await (await lerAceite('clienteA2')).json()).meses).toEqual([]);
    expect((await responder('clienteA2', { assinatura, resposta: 'aceito', empresa: 'emp-a1' })).status).toBe(409);
    // A rota do aceite é só do cliente; a contabilidade e o cliente arquivado não entram.
    expect((await lerAceite('contadorA')).status).toBe(403);
    expect((await responder('contadorA', { assinatura, resposta: 'aceito' })).status).toBe(403);
    expect((await lerAceite('clienteArq')).status).toBe(403);
    expect((await lerAceite(null)).status).toBe(401);
    expect((await responder(null, { assinatura, resposta: 'aceito' })).status).toBe(401);
    // Outro escritório não lê, não fecha nem reabre o mês da A1.
    expect((await lerFechamentoPonto('contadorB', 'emp-a1')).status).toBe(403);
    expect((await acaoPonto('contadorB', 'emp-a1', { acao: 'reabrir', motivo: 'Motivo qualquer' })).status).toBe(403);
    expect((await acaoPonto(null, 'emp-a1', { acao: 'reabrir', motivo: 'Motivo qualquer' })).status).toBe(401);
    const arq = await acaoPonto('contadorA', 'emp-arq', { acao: 'fechar' });
    expect(arq.status).toBe(409);
    expect((await arq.json()).erro).toMatch(/arquivada/i);
    expect(estadoPonto()).toBe(antes);
    // Fechar a A1 não trava a A2.
    expect((await salvarFolha('contadorA', 'emp-a2')).status).toBe(200);
  });

  it('sem a 0034: nada fica fechado, a folha salva normalmente e fechar avisa a atualização (503)', async () => {
    sem0034 = true;
    expect((await salvarFolha('contadorA', 'emp-a1')).status).toBe(200);
    const r = await acaoPonto('contadorA', 'emp-a1', { acao: 'fechar' });
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ aguardandoBanco: true });
    expect((await (await lerAceite('clienteA1')).json()).meses).toEqual([]);
  });
});
