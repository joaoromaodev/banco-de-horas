// Leitura paginada (lib/db.ts): o Supabase corta a resposta em 1.000 linhas SEM
// avisar. Aqui um banco falso reproduz o corte e prova que o livro, o saldo e as
// leituras não perdem linha acima disso.
import { describe, expect, it, vi } from 'vitest';
import { bancoFalso, type BancoFalso } from './bancoFalso';

let atual: BancoFalso;
vi.mock('@/lib/db', async (original) => ({
  ...(await original<typeof import('@/lib/db')>()),
  getDb: () => atual,
}));

import { emLotes, lerAteTeto, lerTudo, PAGINA } from '@/lib/db';
import { lancamentosDoMes, montarLivro, saldoTransportado } from '@/lib/caixa';
import { lerEmpresasComArquivadas } from '@/lib/cadastro';

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: String(i).padStart(6, '0') }));

describe('o corte silencioso (a razão de existir do utilitário)', () => {
  it('`.limit(5000)` solto volta só 1.000 linhas, sem erro', async () => {
    atual = bancoFalso({ t: ids(2500) });
    const { data } = (await atual.from('t').select('id').limit(5000)) as { data: unknown[] };
    expect(data).toHaveLength(1000);
  });
});

describe('lerTudo', () => {
  it('lê 2.500 linhas em 3 páginas, sem repetir nem perder', async () => {
    atual = bancoFalso({ t: ids(2500) });
    const r = await lerTudo<{ id: string }>((de, ate) => atual.from('t').select('id').order('id').range(de, ate));
    expect(r).toHaveLength(2500);
    expect(new Set(r.map((l) => l.id)).size).toBe(2500);
    expect(r[0].id).toBe('000000');
    expect(r[2499].id).toBe('002499');
    expect(atual.consultas).toHaveLength(3);
  });

  it('exatamente 2 páginas cheias: confere a próxima e para (sem perder a borda)', async () => {
    atual = bancoFalso({ t: ids(2 * PAGINA) });
    const r = await lerTudo<{ id: string }>((de, ate) => atual.from('t').select('id').order('id').range(de, ate));
    expect(r).toHaveLength(2000);
  });

  it('tabela vazia e abaixo de uma página: uma consulta cada', async () => {
    atual = bancoFalso({ t: ids(10), v: [] });
    expect(await lerTudo((de, ate) => atual.from('v').select('id').range(de, ate))).toEqual([]);
    expect(await lerTudo((de, ate) => atual.from('t').select('id').order('id').range(de, ate))).toHaveLength(10);
    expect(atual.consultas).toHaveLength(2);
  });

  it('respeita o `max`', async () => {
    atual = bancoFalso({ t: ids(5000) });
    const r = await lerTudo<{ id: string }>((de, ate) => atual.from('t').select('id').order('id').range(de, ate), { max: 1500 });
    expect(r).toHaveLength(1500);
  });

  it('erro do banco vira exceção (e `falhar` troca o tipo)', async () => {
    const quebra = () => Promise.resolve({ data: null, error: { message: 'boom', code: '42P01' } });
    await expect(lerTudo(quebra)).rejects.toMatchObject({ message: 'boom', code: '42P01' });
    await expect(lerTudo(quebra, { falhar: (e) => new RangeError(e.message) })).rejects.toBeInstanceOf(RangeError);
  });
});

describe('lerAteTeto', () => {
  const ler = (teto: number) =>
    lerAteTeto<{ id: string }>((de, ate) => atual.from('t').select('id').order('id').range(de, ate), teto);

  it('mais que o teto: devolve o teto e marca truncado (o `>= TETO` antigo nunca acendia acima de 1.000)', async () => {
    atual = bancoFalso({ t: ids(2500) });
    const r = await ler(2000);
    expect(r.linhas).toHaveLength(2000);
    expect(r.truncado).toBe(true);
  });
  it('exatamente o teto: não é truncado', async () => {
    atual = bancoFalso({ t: ids(2000) });
    expect((await ler(2000)).truncado).toBe(false);
  });
  it('abaixo do teto', async () => {
    atual = bancoFalso({ t: ids(300) });
    const r = await ler(2000);
    expect(r.truncado).toBe(false);
    expect(r.linhas).toHaveLength(300);
  });
});

describe('emLotes', () => {
  it('divide os ids, roda os lotes e junta na ordem', async () => {
    const visto: number[] = [];
    const r = await emLotes(Array.from({ length: 250 }, (_, i) => i), async (lote) => { visto.push(lote.length); return lote; }, 100);
    expect(visto).toEqual([100, 100, 50]);
    expect(r).toHaveLength(250);
    expect(r[0]).toBe(0);
    expect(r[249]).toBe(249);
  });
  it('sem ids: nem chama', async () => {
    const fn = vi.fn(async () => [] as number[]);
    expect(await emLotes([], fn)).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('cadastro de empresas acima de 1.000 linhas', () => {
  it('lerEmpresasComArquivadas devolve todas, e leituras simultâneas dividem uma só ida ao banco', async () => {
    atual = bancoFalso({
      empresas: Array.from({ length: 1300 }, (_, i) => ({
        id: `emp-${String(i).padStart(5, '0')}`, nome: `Empresa ${i}`, tipo_pessoa: 'juridica', escritorio_id: 'esc1', ordem: i,
      })),
    });
    const [a, b, c] = await Promise.all([lerEmpresasComArquivadas(), lerEmpresasComArquivadas(), lerEmpresasComArquivadas()]);
    expect(a).toHaveLength(1300);
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(atual.consultas).toHaveLength(2); // 2 páginas, uma única vez
  });
});

describe('leituras do livro caixa acima de 1.000 lançamentos', () => {
  const lanc = (n: number, mes: number) => ({
    id: `l${String(n).padStart(6, '0')}`, exercicio_id: 'x1', mes,
    data: `2026-${String(mes).padStart(2, '0')}-10`, historico: 'Venda', complemento: null, conta_id: null,
    entrada: 10, saida: 0, juros: 0, multa: 0, pagador_nome: null, pagador_documento: null,
    criado_por: 'a', criado_em: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}Z`, atualizado_por: null,
    conferido_por: null, conferido_em: null,
  });

  it('montarLivro (PDF/xlsx) traz os 2.500 lançamentos e fecha o saldo', async () => {
    atual = bancoFalso({
      empresas: [{ id: 'livro-e1', nome: 'Empresa X', tipo_pessoa: 'juridica', escritorio_id: 'esc1', ordem: 1 }],
      escritorios: [{ id: 'esc1', contabilista_nome: null, contabilista_crc: null }],
      exercicios: [{ id: 'x1', empresa_id: 'livro-e1', ano: 2026, saldo_inicial: '100' }],
      lancamentos: Array.from({ length: 2500 }, (_, i) => lanc(i, (i % 12) + 1)),
    });
    const livro = await montarLivro('livro-e1', 2026);
    expect(livro.meses.reduce((s, m) => s + m.linhas.length, 0)).toBe(2500);
    expect(livro.totalEntradas).toBe(25_000);
    expect(livro.saldoFinalAno).toBe(25_100);
  });

  it('lancamentosDoMes devolve um mês de 1.500 linhas inteiro', async () => {
    atual = bancoFalso({ lancamentos: Array.from({ length: 1500 }, (_, i) => lanc(i, 3)) });
    const r = await lancamentosDoMes('x1', 3);
    expect(r).toHaveLength(1500);
    expect(new Set(r.map((l) => l.id)).size).toBe(1500);
  });

  it('saldoTransportado lê UMA linha da view (saldo do mês anterior) em vez de somar lançamentos', async () => {
    atual = bancoFalso({
      resumo_mensal: [
        { exercicio_id: 'x1', mes: 1, saldo_final: '1100.50' },
        { exercicio_id: 'x1', mes: 2, saldo_final: '2300.25' },
      ],
      lancamentos: Array.from({ length: 5000 }, (_, i) => lanc(i, 1)),
    });
    const ex = { id: 'x1', empresaId: 'e1', ano: 2026, saldoInicial: 100 };
    expect(await saldoTransportado(ex, 3)).toBe(2300.25);
    expect(await saldoTransportado(ex, 2)).toBe(1100.5);
    expect(await saldoTransportado(ex, 1)).toBe(100); // janeiro: o saldo inicial, sem consulta
    expect(atual.consultas.every((c) => c.tabela === 'resumo_mensal')).toBe(true);
  });
});
