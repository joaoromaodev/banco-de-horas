// Regras puras da página inicial do cliente (lib/inicioCliente.ts).
import { describe, expect, it } from 'vitest';
import {
  EntradaInicio, MAX_ITENS_BLOCO, mesAnterior, mesesParaLancar, montarInicioCliente, saudacaoDaHora, urgenciaDoPrazo,
} from '@/lib/inicioCliente';

const HOJE = '2026-11-21';
const ok = <T,>(dados: T) => ({ ok: true as const, dados });
const base = (o: Partial<EntradaInicio> = {}): EntradaInicio => ({
  hoje: HOJE, empresaNome: 'Padaria Sol', movimento: ok([
    { ano: 2026, mes: 10, lancamentos: 12, confirmado: true }, { ano: 2026, mes: 11, lancamentos: 3, confirmado: false },
  ]),
  pendencias: ok([]), folhasDevolvidas: ok([]), demonstrativo: ok(null), ...o,
});

describe('saudação e datas', () => {
  it('saudação pela hora', () => {
    expect(saudacaoDaHora(8)).toBe('Bom dia');
    expect(saudacaoDaHora(14)).toBe('Boa tarde');
    expect(saudacaoDaHora(21)).toBe('Boa noite');
    expect(saudacaoDaHora(3)).toBe('Boa noite');
  });
  it('mês anterior vira o ano em janeiro', () => {
    expect(mesAnterior('2026-01-10')).toEqual({ ano: 2025, mes: 12 });
    expect(mesAnterior(HOJE)).toEqual({ ano: 2026, mes: 10 });
  });
  it('urgência do prazo', () => {
    expect(urgenciaDoPrazo(null, HOJE)).toBeUndefined();
    expect(urgenciaDoPrazo('2026-11-20', HOJE)).toBe('atrasada');
    expect(urgenciaDoPrazo('2026-11-21', HOJE)).toBe('hoje');
    expect(urgenciaDoPrazo('2026-11-30T00:00:00Z', HOJE)).toBe('proxima');
  });
});

describe('movimento do caixa', () => {
  it('mês sem lançamentos pede ação; com lançamentos (mesmo sem confirmar) não', () => {
    const m = [{ ano: 2026, mes: 10, lancamentos: 0, confirmado: false }, { ano: 2026, mes: 11, lancamentos: 4, confirmado: false }];
    expect(mesesParaLancar(HOJE, m).map((x) => x.mes)).toEqual([10]);
  });
  it('mês ausente da leitura conta como sem lançamentos', () => {
    expect(mesesParaLancar(HOJE, []).map((x) => x.mes)).toEqual([10, 11]);
  });
  it('mês confirmado sem lançamentos não pede nada', () => {
    expect(mesesParaLancar(HOJE, [{ ano: 2026, mes: 10, lancamentos: 0, confirmado: true }, { ano: 2026, mes: 11, lancamentos: 1, confirmado: false }])).toEqual([]);
  });
  it('um mês: título nomeia o mês e leva ao caixa', () => {
    const r = montarInicioCliente(base({ movimento: ok([{ ano: 2026, mes: 10, lancamentos: 0, confirmado: false }, { ano: 2026, mes: 11, lancamentos: 2, confirmado: false }]) }));
    const b = r.blocos[0];
    expect(b.id).toBe('movimento');
    expect(b.titulo).toBe('Lance o movimento de outubro de 2026');
    expect(b.acao.href).toBe('/caixa');
    expect(r.tudoEmDia).toBe(false);
  });
  it('dois meses: lista os dois, anterior primeiro', () => {
    const r = montarInicioCliente(base({ movimento: ok([]) }));
    expect(r.blocos[0].itens.map((i) => i.texto)).toEqual(['Faltam os lançamentos de outubro de 2026', 'Faltam os lançamentos de novembro de 2026']);
  });
});

describe('pendências, folhas e demonstrativo', () => {
  it('pendências: atrasadas primeiro, depois hoje, próximas e sem prazo; corta em 5', () => {
    const lista = Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, titulo: `Doc ${i}`, prazo: null as string | null }));
    lista[3].prazo = '2026-11-25'; lista[4].prazo = '2026-11-01'; lista[5].prazo = HOJE;
    const b = montarInicioCliente(base({ pendencias: ok(lista) })).blocos.find((x) => x.id === 'pendencias')!;
    expect(b.titulo).toBe('A contabilidade pediu 7 documentos');
    expect(b.itens).toHaveLength(MAX_ITENS_BLOCO);
    expect(b.alemDoLimite).toBe(2);
    expect(b.itens.slice(0, 3).map((i) => i.chave)).toEqual(['p4', 'p5', 'p3']);
    expect(b.itens[0].detalhe).toBe('Venceu em 01/11');
    expect(b.acao.href).toBe('/documentos');
  });
  it('uma pendência fala no singular', () => {
    const b = montarInicioCliente(base({ pendencias: ok([{ id: 'a', titulo: 'Extrato', prazo: null }]) })).blocos.find((x) => x.id === 'pendencias')!;
    expect(b.titulo).toBe('A contabilidade pediu 1 documento');
  });
  it('folha devolvida mostra o motivo e leva a /enviar-ponto', () => {
    const r = montarInicioCliente(base({ folhasDevolvidas: ok([{ id: 'f1', funcionario: 'Maria', ano: 2026, mes: 10, motivo: 'Foto cortada' }]) }));
    const b = r.blocos.find((x) => x.id === 'folhas')!;
    expect(b.titulo).toBe('1 folha de ponto voltou para você');
    expect(b.itens[0]).toMatchObject({ texto: 'Maria · outubro/2026', detalhe: 'Motivo: Foto cortada' });
    expect(b.acao.href).toBe('/enviar-ponto');
  });
  it('demonstrativo é informativo: aparece, mas não tira o "tudo em dia"', () => {
    const r = montarInicioCliente(base({ demonstrativo: ok({ ano: 2026, mes: 10 }) }));
    const b = r.blocos.find((x) => x.id === 'demonstrativo')!;
    expect(b.pedeAcao).toBe(false);
    expect(b.acao.href).toBe('/caixa/demonstrativo?ano=2026&mes=10');
    expect(r.tudoEmDia).toBe(true);
  });
});

describe('estado vazio e falhas', () => {
  it('tudo em dia: sem blocos que pedem ação', () => {
    const r = montarInicioCliente(base());
    expect(r.blocos).toEqual([]);
    expect(r.tudoEmDia).toBe(true);
    expect(r.saudacao).toBe('Olá, Padaria Sol');
  });
  it('fonte que falha some sozinha e o resto segue; não declara "tudo em dia"', () => {
    const r = montarInicioCliente(base({
      pendencias: { ok: false }, demonstrativo: { ok: false },
      folhasDevolvidas: ok([{ id: 'f', funcionario: 'Ana', ano: 2026, mes: 11, motivo: null }]),
    }));
    expect(r.indisponiveis).toEqual(['pendencias', 'demonstrativo']);
    expect(r.blocos.map((b) => b.id)).toEqual(['folhas']);
    expect(r.blocos[0].itens[0].detalhe).toBe('A contabilidade pediu uma nova foto.');
    expect(r.tudoEmDia).toBe(false);
  });
  it('todas as fontes falhando não derruba nada', () => {
    const f = { ok: false as const };
    const r = montarInicioCliente({ hoje: HOJE, empresaNome: '', movimento: f, pendencias: f, folhasDevolvidas: f, demonstrativo: f });
    expect(r.blocos).toEqual([]);
    expect(r.indisponiveis).toHaveLength(4);
    expect(r.saudacao).toBe('Olá');
    expect(r.tudoEmDia).toBe(false);
  });
});
