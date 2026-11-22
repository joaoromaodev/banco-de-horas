// Regras puras da Sprint 17 · Frente A (documentos de mão dupla, migração 0032):
// situação do documento enviado (recebido → aceito / devolvido), "não tenho este mês",
// entregas do escritório ao cliente (protocolo de leitura) e o lembrete antes do prazo
// (sino e /inicio). As rotas, com as guardas reais, estão em documentosMaoDuplaRotas.test.ts.
import { describe, expect, it } from 'vitest';
import {
  devolvidosSemReenvio, diasAte, motivoDevolucao, podeDesfazerSemMovimento, podeMarcarSemMovimento, podeMudarSituacao,
  proximaSituacao, situacaoPrazo, type StatusDocumento,
} from '@/lib/documentos';
import {
  caminhoEntrega, nomeEntrega, ordenarEntregas, podeGerirEntrega, podeVerEntrega, registraAbertura, situacaoEntrega,
  validarCamposEntrega,
} from '@/lib/entregas';
import { avisosDocumentoDevolvido, avisosEntrega, avisosLembretePedido } from '@/lib/avisosCliente';
import { montarInicioCliente, type EntradaInicio } from '@/lib/inicioCliente';
import { notifPendencias } from '@/lib/notificacoes';
import type { Quem } from '@/lib/visibilidade';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const ID = '11111111-1111-4111-8111-111111111111';
const contadora: Quem = { email: 'c@a.com', role: 'usuario', escritorioId: A };
const contadorB: Quem = { email: 'c@b.com', role: 'usuario', escritorioId: B };
const cliente: Quem = { email: 'cli@a1.com', role: 'cliente', escritorioId: A, empresa: 'emp-a1' };
const clienteOutra: Quem = { email: 'cli@a2.com', role: 'cliente', escritorioId: A, empresa: 'emp-a2' };
const master: Quem = { email: 'm@x.com', role: 'master' };
const reg = (status: StatusDocumento) => ({ empresaId: 'emp-a1', escritorioId: A, status });

describe('situação do documento: recebido → aceito / devolvido', () => {
  it('transições', () => {
    expect(proximaSituacao('recebido', 'conferir')).toBe('conferido');
    expect(proximaSituacao('recebido', 'devolver')).toBe('devolvido');
    expect(proximaSituacao('recebido', 'desconferir')).toBeNull();
    expect(proximaSituacao('conferido', 'conferir')).toBeNull();
    expect(proximaSituacao('conferido', 'devolver')).toBe('devolvido');
    expect(proximaSituacao('conferido', 'desconferir')).toBe('recebido');
    expect(proximaSituacao('devolvido', 'devolver')).toBeNull();
    expect(proximaSituacao('devolvido', 'conferir')).toBe('conferido');
    expect(proximaSituacao('devolvido', 'desconferir')).toBe('recebido');
    // envio que não terminou ou foi recusado pelos bytes: nada muda
    for (const a of ['conferir', 'devolver', 'desconferir'] as const) {
      expect(proximaSituacao('enviando', a)).toBeNull();
      expect(proximaSituacao('rejeitado', a)).toBeNull();
    }
  });

  it('só a contabilidade do escritório muda a situação', () => {
    expect(podeMudarSituacao(contadora, reg('recebido'), 'devolver')).toBe(true);
    expect(podeMudarSituacao(master, reg('recebido'), 'conferir')).toBe(true);
    expect(podeMudarSituacao(cliente, reg('recebido'), 'conferir')).toBe(false);
    expect(podeMudarSituacao(contadorB, reg('recebido'), 'devolver')).toBe(false);
    expect(podeMudarSituacao(contadora, { ...reg('recebido'), escritorioId: null }, 'devolver')).toBe(false);
    expect(podeMudarSituacao(contadora, reg('conferido'), 'conferir')).toBe(false);
  });

  it('motivo da devolução: obrigatório, aparado, cortado em 500', () => {
    expect(motivoDevolucao('').ok).toBe(false);
    expect(motivoDevolucao('  ok ').ok).toBe(false);
    expect(motivoDevolucao(undefined).ok).toBe(false);
    expect(motivoDevolucao('  Foto   cortada  ')).toEqual({ ok: true, motivo: 'Foto cortada' });
    const longo = motivoDevolucao('x'.repeat(900));
    expect(longo.ok && longo.motivo.length).toBe(500);
  });

  it('devolvido sem reenvio: some quando chega outro envio vivo da mesma categoria e competência', () => {
    const dev = { id: 'd1', categoria: 'extrato', competencia: '2026-10', status: 'devolvido' as const, enviadoEm: '2026-11-01T10:00:00Z', devolvidoEm: '2026-11-02T10:00:00Z' };
    expect(devolvidosSemReenvio([dev]).map((d) => d.id)).toEqual(['d1']);
    // enviado ANTES da devolução não conta como reenvio
    expect(devolvidosSemReenvio([dev, { ...dev, id: 'd0', status: 'recebido', enviadoEm: '2026-11-01T09:00:00Z' }]).map((d) => d.id)).toEqual(['d1']);
    // outra categoria ou competência não conta
    expect(devolvidosSemReenvio([dev, { ...dev, id: 'd2', status: 'recebido', categoria: 'nota', enviadoEm: '2026-11-03T10:00:00Z' }])).toHaveLength(1);
    expect(devolvidosSemReenvio([dev, { ...dev, id: 'd3', status: 'recebido', competencia: '2026-09', enviadoEm: '2026-11-03T10:00:00Z' }])).toHaveLength(1);
    // reenviado (recebido ou aceito) depois: resolvido
    expect(devolvidosSemReenvio([dev, { ...dev, id: 'd4', status: 'recebido', enviadoEm: '2026-11-03T10:00:00Z' }])).toEqual([]);
    expect(devolvidosSemReenvio([dev, { ...dev, id: 'd5', status: 'conferido', enviadoEm: '2026-11-03T10:00:00Z' }])).toEqual([]);
    // reenviado e devolvido de novo: o mais novo segue pendente
    expect(devolvidosSemReenvio([dev, { ...dev, id: 'd6', enviadoEm: '2026-11-03T10:00:00Z', devolvidoEm: '2026-11-04T10:00:00Z' }]).map((d) => d.id).sort()).toEqual(['d1', 'd6']);
  });
});

describe('"não tenho este mês"', () => {
  const p = (status: 'aberta' | 'atendida', semMovimentoEm: string | null = null) => ({ empresaId: 'emp-a1', escritorioId: A, status, semMovimentoEm });
  it('marcar: cliente da empresa ou contabilidade, só pedido aberto', () => {
    expect(podeMarcarSemMovimento(cliente, p('aberta'))).toBe(true);
    expect(podeMarcarSemMovimento(contadora, p('aberta'))).toBe(true);
    expect(podeMarcarSemMovimento(cliente, p('atendida'))).toBe(false);
    expect(podeMarcarSemMovimento(clienteOutra, p('aberta'))).toBe(false);
    expect(podeMarcarSemMovimento(contadorB, p('aberta'))).toBe(false);
  });
  it('desfazer: só o pedido fechado PELO "não tenho"', () => {
    expect(podeDesfazerSemMovimento(cliente, p('atendida', '2026-11-01T00:00:00Z'))).toBe(true);
    expect(podeDesfazerSemMovimento(cliente, p('atendida'))).toBe(false); // atendido com arquivo
    expect(podeDesfazerSemMovimento(cliente, p('aberta', '2026-11-01T00:00:00Z'))).toBe(false);
    expect(podeDesfazerSemMovimento(clienteOutra, p('atendida', '2026-11-01T00:00:00Z'))).toBe(false);
  });
  it('o sino da contabilidade diz "não tem", não "atendido"', () => {
    const nomes = new Map([['emp-a1', 'Padaria']]);
    const base = { id: 'p1', empresaId: 'emp-a1', titulo: 'Extrato', atendidaEm: '2026-11-01T00:00:00Z', atendidaPor: 'cli@a1.com' };
    expect(notifPendencias([{ ...base, semMovimento: true }], nomes, 'c@a.com')[0].titulo).toMatch(/não tem/);
    expect(notifPendencias([base], nomes, 'c@a.com')[0].titulo).toBe('Pedido atendido pelo cliente');
  });
});

describe('entregas do escritório ao cliente', () => {
  it('campos: tipo, competência e vencimento validados por campo; título e observação opcionais', () => {
    expect(validarCamposEntrega({ tipo: 'das', competencia: '2026-10' })).toEqual({
      ok: true, campos: { tipo: 'das', titulo: null, competencia: '2026-10', vencimento: null, observacao: null },
    });
    const r = validarCamposEntrega({ tipo: 'boleto', competencia: '10/2026', vencimento: '2026-02-30' });
    expect(r.ok).toBe(false);
    expect(!r.ok && Object.keys(r.erros).sort()).toEqual(['competencia', 'tipo', 'vencimento']);
    const t = validarCamposEntrega({ tipo: 'guia', competencia: '2026-10', titulo: '  DAS   de outubro ', vencimento: '' });
    expect(t.ok && t.campos).toMatchObject({ titulo: 'DAS de outubro', vencimento: null });
  });

  it('caminho no Storage: só uuids, prefixo entregas/, extensão canônica', () => {
    expect(caminhoEntrega(A, ID, 'JPEG')).toBe(`${A}/entregas/${ID}.jpg`);
    expect(() => caminhoEntrega('../x', ID, 'pdf')).toThrow();
    expect(() => caminhoEntrega(A, ID, 'exe')).toThrow();
  });

  it('ver: publicada, não excluída, do escritório e da empresa da sessão', () => {
    const e = { empresaId: 'emp-a1', escritorioId: A, status: 'publicada' as const, excluidoEm: null };
    expect(podeVerEntrega(cliente, e)).toBe(true);
    expect(podeVerEntrega(contadora, e)).toBe(true);
    expect(podeVerEntrega(clienteOutra, e)).toBe(false);
    expect(podeVerEntrega(contadorB, e)).toBe(false);
    expect(podeVerEntrega(cliente, { ...e, status: 'enviando' })).toBe(false);
    expect(podeVerEntrega(cliente, { ...e, excluidoEm: '2026-11-01' })).toBe(false);
    expect(podeVerEntrega(cliente, { ...e, escritorioId: B })).toBe(false);
    expect(podeGerirEntrega(contadora, e)).toBe(true);
    expect(podeGerirEntrega(cliente, e)).toBe(false);
    expect(podeGerirEntrega(contadorB, e)).toBe(false);
  });

  it('"aberto em": só o cliente, só a primeira vez', () => {
    expect(registraAbertura(cliente, { abertoEm: null })).toBe(true);
    expect(registraAbertura(cliente, { abertoEm: '2026-11-01T00:00:00Z' })).toBe(false);
    expect(registraAbertura(contadora, { abertoEm: null })).toBe(false);
    expect(registraAbertura(master, { abertoEm: null })).toBe(false);
  });

  it('situação e destaque perto do vencimento (até 3 dias)', () => {
    const hoje = '2026-11-21';
    expect(situacaoEntrega({ abertoEm: '2026-11-20T00:00:00Z', vencimento: '2026-11-01' }, hoje)).toBe('aberta');
    expect(situacaoEntrega({ abertoEm: null, vencimento: null }, hoje)).toBe('nao-aberta');
    expect(situacaoEntrega({ abertoEm: null, vencimento: '2026-11-25' }, hoje)).toBe('nao-aberta');
    expect(situacaoEntrega({ abertoEm: null, vencimento: '2026-11-24' }, hoje)).toBe('vence-logo');
    expect(situacaoEntrega({ abertoEm: null, vencimento: hoje }, hoje)).toBe('vence-logo');
    expect(situacaoEntrega({ abertoEm: null, vencimento: '2026-11-20' }, hoje)).toBe('vencida');
    const ordem = ordenarEntregas([
      { id: 'aberta', abertoEm: '2026-11-20T00:00:00Z', vencimento: '2026-11-22', publicadoEm: '2026-11-19' },
      { id: 'sem-venc', abertoEm: null, vencimento: null, publicadoEm: '2026-11-19' },
      { id: 'logo', abertoEm: null, vencimento: '2026-11-23', publicadoEm: '2026-11-19' },
      { id: 'vencida', abertoEm: null, vencimento: '2026-11-10', publicadoEm: '2026-11-01' },
    ], hoje).map((x) => x.id);
    expect(ordem).toEqual(['vencida', 'logo', 'sem-venc', 'aberta']);
  });

  it('nome: o tipo e, se houver, o título', () => {
    expect(nomeEntrega({ tipo: 'das', titulo: null })).toBe('DAS');
    expect(nomeEntrega({ tipo: 'holerite', titulo: 'Outubro' })).toBe('Holerite · Outubro');
  });
});

describe('lembrete antes do prazo e avisos novos no sino do cliente', () => {
  const hoje = '2026-11-21';
  const pedido = (prazo: string | null, status = 'aberta') => ({ id: 'p1', titulo: 'Extrato de outubro', prazo, status, criadoEm: '2026-11-01T12:00:00Z' });

  it('lembra de hoje a 3 dias antes; vencido, longe, sem prazo ou atendido não lembra', () => {
    expect(avisosLembretePedido([pedido('2026-11-24')], hoje)).toHaveLength(1);
    expect(avisosLembretePedido([pedido(hoje)], hoje)[0].titulo).toMatch(/vence hoje/);
    expect(avisosLembretePedido([pedido('2026-11-22')], hoje)[0].titulo).toMatch(/1 dia$/);
    expect(avisosLembretePedido([pedido('2026-11-25')], hoje)).toEqual([]);
    expect(avisosLembretePedido([pedido('2026-11-20')], hoje)).toEqual([]);
    expect(avisosLembretePedido([pedido(null)], hoje)).toEqual([]);
    expect(avisosLembretePedido([pedido('2026-11-23', 'atendida')], hoje)).toEqual([]);
  });

  it('o lembrete é datado do começo da janela (meia-noite de Belém) e muda de chave se o prazo mudar', () => {
    const [a] = avisosLembretePedido([pedido('2026-11-24')], hoje);
    expect(a.quando).toBe('2026-11-21T03:00:00.000Z');
    expect(a.chave).toBe('cli|lembrete|p1|2026-11-24');
    expect(a.texto).toBe('Extrato de outubro · Prazo: 24/11/2026');
    // pedido feito já dentro da janela: datado da criação
    const [b] = avisosLembretePedido([{ ...pedido('2026-11-24'), criadoEm: '2026-11-22T15:00:00Z' }], '2026-11-22');
    expect(b.quando).toBe('2026-11-22T15:00:00.000Z');
  });

  it('entrega: aviso sem título (pode ter nome de pessoa); some ao abrir; lembrete do vencimento', () => {
    const e = { id: 'e1', tipo: 'holerite' as const, competencia: '2026-10', vencimento: '2026-11-23', publicadoEm: '2026-11-20T12:00:00Z', abertoEm: null };
    const itens = avisosEntrega([e], hoje);
    expect(itens.map((i) => i.tipo)).toEqual(['entrega', 'lembrete']);
    expect(itens[0].texto).toBe('Holerite · out/2026 · Vence em 23/11/2026');
    expect(itens[1].chave).toBe('cli|entrega-vence|e1|2026-11-23');
    expect(avisosEntrega([{ ...e, abertoEm: '2026-11-21T00:00:00Z' }], hoje)).toEqual([]);
    expect(avisosEntrega([{ ...e, vencimento: null }], hoje).map((i) => i.tipo)).toEqual(['entrega']);
  });

  it('documento devolvido: categoria e competência; sem nome do arquivo nem motivo (texto livre); a chave muda se devolver de novo', () => {
    const [i] = avisosDocumentoDevolvido([{ id: 'd1', categoria: 'extrato', competencia: '2026-10', devolvidoEm: '2026-11-20T12:00:00Z' }]);
    expect(i).toMatchObject({ tipo: 'documento_devolvido', href: '/documentos', texto: 'Extrato bancário · out/2026 · Veja o motivo em Documentos.' });
    expect(i.chave).toBe('cli|docdev|d1|2026-11-20T12:00:00.000Z');
  });
});

describe('/inicio: documentos da contabilidade, devolvidos e o lembrete', () => {
  const HOJE = '2026-11-21';
  const ok = <T>(dados: T) => ({ ok: true as const, dados });
  const base = (x: Partial<EntradaInicio> = {}): EntradaInicio => ({
    hoje: HOJE, empresaNome: 'Padaria', movimento: ok([{ ano: 2026, mes: 10, lancamentos: 3, confirmado: false }, { ano: 2026, mes: 11, lancamentos: 1, confirmado: false }]),
    pendencias: ok([]), folhasDevolvidas: ok([]), demonstrativo: ok(null), ...x,
  });

  it('pedido que vence em até 3 dias ganha o lembrete no texto', () => {
    const b = montarInicioCliente(base({ pendencias: ok([{ id: 'p', titulo: 'Extrato', prazo: '2026-11-23' }]) })).blocos[0];
    expect(b.itens[0]).toMatchObject({ detalhe: 'Vence em 2 dias (23/11)', urgencia: 'logo' });
    const longe = montarInicioCliente(base({ pendencias: ok([{ id: 'p', titulo: 'Extrato', prazo: '2026-12-10' }]) })).blocos[0];
    expect(longe.itens[0]).toMatchObject({ detalhe: 'Até 10/12', urgencia: 'proxima' });
  });

  it('entregas não abertas: bloco com link de download por item, as mais urgentes primeiro', () => {
    const r = montarInicioCliente(base({
      entregas: ok([
        { id: 'e1', tipo: 'holerite', titulo: null, competencia: '2026-10', vencimento: null, publicadoEm: '2026-11-20', abertoEm: null },
        { id: 'e2', tipo: 'das', titulo: 'DAS de outubro', competencia: '2026-10', vencimento: '2026-11-20', publicadoEm: '2026-11-10', abertoEm: null },
        { id: 'e3', tipo: 'guia', titulo: null, competencia: '2026-10', vencimento: null, publicadoEm: '2026-11-10', abertoEm: '2026-11-11' },
      ]),
    }));
    const b = r.blocos.find((x) => x.id === 'entregas')!;
    expect(b.titulo).toBe('A contabilidade enviou 2 documentos para você');
    expect(b.itens.map((i) => i.chave)).toEqual(['e2', 'e1']);
    expect(b.itens[0]).toMatchObject({ texto: 'DAS · DAS de outubro · out/2026', detalhe: 'Venceu em 20/11', urgencia: 'atrasada', href: '/api/entregas/arquivo?id=e2' });
    expect(r.tudoEmDia).toBe(false);
  });

  it('documento devolvido vira bloco com o motivo; sem as fontes novas nada muda', () => {
    const r = montarInicioCliente(base({ devolvidos: ok([{ id: 'd1', nome: 'extrato.pdf', categoria: 'extrato', competencia: '2026-10', motivo: 'Cortado' }]) }));
    const b = r.blocos.find((x) => x.id === 'devolvidos')!;
    expect(b).toMatchObject({ titulo: '1 documento voltou para você', acao: { href: '/documentos' } });
    expect(b.itens[0]).toMatchObject({ texto: 'extrato.pdf', detalhe: 'Extrato bancário · out/2026 · Motivo: Cortado' });
    expect(montarInicioCliente(base()).tudoEmDia).toBe(true);
    expect(montarInicioCliente(base({ entregas: { ok: false } })).indisponiveis).toEqual(['entregas']);
  });

  it('diasAte e "vence logo" usam a mesma janela', () => {
    expect(diasAte('2026-11-24', HOJE)).toBe(3);
    expect(diasAte('2026-11-20', HOJE)).toBe(-1);
    expect(diasAte('lixo', HOJE)).toBeNull();
    expect(situacaoPrazo('2026-11-24', HOJE)).toBe('vence-logo');
    expect(situacaoPrazo('2026-11-25', HOJE)).toBe('no-prazo');
  });
});
