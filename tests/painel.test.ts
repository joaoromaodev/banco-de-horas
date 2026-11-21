import { describe, it, expect, vi } from 'vitest';
import { Obrigacao } from '@/lib/agenda';
import {
  blocoAgenda, blocoCaixa, blocoContratos, blocoDocumentos, blocoPendencias, blocoVazio, ehTabelaAusente,
  fraseResumo, isolar, ordenarBlocos, resumir, rotuloDias, textoRestante,
} from '@/lib/painel';

const HOJE = '2026-11-23'; // segunda
const nomes = new Map([['e1', 'Vaz & Vouzela'], ['e2', 'NÉLIO']]);

function obr(extra: Partial<Obrigacao>): Obrigacao {
  return {
    id: 'o1', empresaId: 'e1', tipo: 'das', nome: 'DAS', recorrencia: 'mensal', modoDia: 'dia_fixo',
    dia: 20, mes: null, defasagem: 1, ajuste: 'prorroga', dataUnica: null, avisoDias: 0,
    inicio: '2026-01-01', responsavel: null, observacao: null, ativa: true, ...extra,
  };
}

describe('rotuloDias', () => {
  it('descreve atraso e vencimento', () => {
    expect(rotuloDias(-1)).toBe('1 dia de atraso');
    expect(rotuloDias(-3)).toBe('3 dias de atraso');
    expect(rotuloDias(0)).toBe('vence hoje');
    expect(rotuloDias(1)).toBe('vence amanhã');
    expect(rotuloDias(5)).toBe('vence em 5 dias');
  });
});

describe('blocoAgenda', () => {
  it('separa atrasadas de próximas e põe a mais atrasada primeiro', () => {
    // DAS de 10/2026 vence 23/11 (hoje); 09/2026 venceu em 20/10 (atrasada se não feita).
    const b = blocoAgenda([obr({})], [], nomes, HOJE);
    expect(b.atrasados).toBeGreaterThan(0);
    expect(b.itens[0].tom).toBe('perigo');
    expect(b.itens[0].quando! <= b.itens[b.itens.length - 1].quando!).toBe(true);
    expect(b.total).toBe(b.atrasados + b.proximos);
  });

  it('não conta o que já foi marcado como feito', () => {
    const feitas = [{ obrigacaoId: 'o1', competencia: '2026-10' }];
    const sem = blocoAgenda([obr({ inicio: '2026-11-01' })], [], nomes, HOJE);
    const com = blocoAgenda([obr({ inicio: '2026-11-01' })], feitas, nomes, HOJE);
    expect(sem.total).toBe(1);
    expect(com.total).toBe(0);
  });

  it('respeita "acompanhar a partir de" e obrigação inativa', () => {
    expect(blocoAgenda([obr({ inicio: '2026-12-01' })], [], nomes, HOJE).total).toBe(0);
    expect(blocoAgenda([obr({ ativa: false })], [], nomes, HOJE).total).toBe(0);
  });

  it('corta a lista no limite mas mantém o total', () => {
    const lista = Array.from({ length: 8 }, (_, i) => obr({ id: `o${i}`, nome: `Obr ${i}`, inicio: '2026-11-01' }));
    const b = blocoAgenda(lista, [], nomes, HOJE, undefined, 3);
    expect(b.itens).toHaveLength(3);
    expect(b.total).toBe(8);
  });
});

describe('blocoDocumentos', () => {
  it('agrupa por empresa e ordena pela espera mais longa', () => {
    const b = blocoDocumentos([
      { empresaId: 'e1', enviadoEm: '2026-11-22T10:00:00Z' },
      { empresaId: 'e2', enviadoEm: '2026-11-10T10:00:00Z' },
      { empresaId: 'e2', enviadoEm: '2026-11-20T10:00:00Z' },
    ], nomes, HOJE);
    expect(b.total).toBe(3);
    expect(b.conferir).toBe(3);
    expect(b.itens.map((i) => i.empresa)).toEqual(['NÉLIO', 'Vaz & Vouzela']);
    expect(b.itens[0].titulo).toBe('2 documentos');
    expect(b.itens[0].rotuloPrazo).toBe('o mais antigo, há 13 dias');
  });

  it('ignora empresas fora do recorte', () => {
    expect(blocoDocumentos([{ empresaId: 'outra', enviadoEm: '2026-11-22T10:00:00Z' }], nomes, HOJE).total).toBe(0);
  });
});

describe('blocoPendencias', () => {
  const p = (id: string, prazo: string | null, status = 'aberta', empresaId = 'e1') =>
    ({ id, empresaId, titulo: `P${id}`, prazo, status });

  it('traz só abertas vencidas ou perto de vencer', () => {
    const b = blocoPendencias([
      p('1', '2026-11-20'), p('2', '2026-11-25'), p('3', '2026-12-30'), p('4', null),
      p('5', '2026-11-01', 'atendida'), p('6', '2026-11-01', 'aberta', 'outra'),
    ], nomes, HOJE);
    expect(b.itens.map((i) => i.id)).toEqual(['1', '2']);
    expect(b.atrasados).toBe(1);
    expect(b.proximos).toBe(1);
  });
});

describe('blocoContratos', () => {
  it('conta vencidos como atrasados', () => {
    const b = blocoContratos([
      { tipo: 'vencido', marco: '1º período', data: '2026-11-20', dias: -3, id: 'c1', empresa: 'e1', empresaNome: 'Vaz', nome: 'Ana' },
      { tipo: 'vence', marco: 'prorrogação', data: '2026-11-26', dias: 3, id: 'c2', empresa: 'e1', empresaNome: 'Vaz', nome: 'Bia' },
    ]);
    expect(b.atrasados).toBe(1);
    expect(b.proximos).toBe(1);
    expect(b.itens[0].tom).toBe('perigo');
  });
});

describe('blocoCaixa', () => {
  it('agrupa por empresa, maior fila primeiro', () => {
    const b = blocoCaixa([
      { empresaId: 'e1', criadoEm: '2026-11-01T00:00:00Z' },
      { empresaId: 'e2', criadoEm: '2026-11-02T00:00:00Z' },
      { empresaId: 'e2', criadoEm: '2026-11-05T00:00:00Z' },
    ], nomes);
    expect(b.total).toBe(3);
    expect(b.itens[0].empresa).toBe('NÉLIO');
    expect(b.itens[0].quando).toBe('2026-11-05');
  });

  it('"e mais" conta empresas fora da lista, não lançamentos', () => {
    const tres = [{ empresaId: 'e2', criadoEm: '2026-11-02T00:00:00Z' }, { empresaId: 'e2', criadoEm: '2026-11-03T00:00:00Z' }];
    expect(textoRestante(blocoCaixa(tres, nomes))).toBe('');
    const duas = blocoCaixa([...tres, { empresaId: 'e1', criadoEm: '2026-11-01T00:00:00Z' }], nomes, 1);
    expect(textoRestante(duas)).toBe('e mais 1 empresa');
  });
});

describe('isolar', () => {
  it('devolve o bloco quando a consulta funciona', async () => {
    const b = await isolar('agenda', async () => blocoVazio('agenda'));
    expect(b.estado).toBe('ok');
  });

  it('tabela ausente vira "migracao"; outro erro vira "erro" — sem lançar', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await isolar('agenda', async () => { throw Object.assign(new Error('x'), { code: '42P01' }); })).estado).toBe('migracao');
    expect((await isolar('documentos', async () => { throw Object.assign(new Error('x'), { code: 'PGRST205' }); })).estado).toBe('migracao');
    expect((await isolar('contratos', async () => { throw Object.assign(new Error('x'), { status: 503 }); })).estado).toBe('migracao');
    expect((await isolar('caixa', async () => { throw new Error('rede'); })).estado).toBe('erro');
    log.mockRestore();
  });

  it('ehTabelaAusente não confunde outros erros', () => {
    expect(ehTabelaAusente(new Error('x'))).toBe(false);
    expect(ehTabelaAusente({ code: '23505' })).toBe(false);
    expect(ehTabelaAusente(null)).toBe(false);
  });
});

describe('resumir / fraseResumo', () => {
  const b = (chave: Parameters<typeof blocoVazio>[0], o: Partial<ReturnType<typeof blocoVazio>>) => ({ ...blocoVazio(chave), ...o });

  it('soma só blocos que carregaram', () => {
    const r = resumir([
      b('agenda', { total: 4, atrasados: 3, proximos: 1 }),
      b('pendencias', { total: 4, proximos: 4 }),
      b('documentos', { total: 12, conferir: 12 }),
      b('caixa', { estado: 'erro', atrasados: 99 }),
    ]);
    expect(r).toMatchObject({ atrasadas: 3, semana: 5, conferir: 12, incompleto: true, tudoEmDia: false });
    expect(fraseResumo(r)).toBe('3 coisas atrasadas, 5 para esta semana e 12 para conferir');
  });

  it('singular e frases curtas', () => {
    expect(fraseResumo({ atrasadas: 1, semana: 0, conferir: 0, incompleto: false, tudoEmDia: false })).toBe('1 coisa atrasada');
    expect(fraseResumo({ atrasadas: 0, semana: 2, conferir: 1, incompleto: false, tudoEmDia: false })).toBe('2 para esta semana e 1 para conferir');
  });

  it('tudo em dia só quando nada falhou', () => {
    expect(resumir([blocoVazio('agenda'), blocoVazio('caixa')]).tudoEmDia).toBe(true);
    const r = resumir([blocoVazio('agenda'), blocoVazio('caixa', 'migracao')]);
    expect(r.tudoEmDia).toBe(false);
    expect(fraseResumo(r)).toMatch(/blocos que carregaram/);
  });
});

describe('ordenarBlocos', () => {
  it('atrasados primeiro, vazios depois, indisponíveis por último', () => {
    const ordem = ordenarBlocos([
      blocoVazio('caixa', 'erro'),
      blocoVazio('contratos'),
      { ...blocoVazio('documentos'), total: 2, conferir: 2 },
      { ...blocoVazio('agenda'), total: 1, atrasados: 1 },
    ]).map((x) => x.chave);
    expect(ordem).toEqual(['agenda', 'documentos', 'contratos', 'caixa']);
  });
});
