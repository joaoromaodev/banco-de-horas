// Teto diário da IA por escritório (Sprint 18 · A) — o contador de lib/ia/cota.ts com o
// banco em memória: cada escritório soma só o próprio gasto do dia (UTC) na Cloudflare,
// a gravação leva o escritório, e sem a 0037 (coluna ausente) tudo segue sem o teto.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bancoFalso, type BancoFalso } from './bancoFalso';

type Linha = Record<string, unknown>;
let tabelas: Record<string, Linha[]>;
let banco: BancoFalso;
/** Simula o banco SEM a 0037: qualquer uso de `escritorio_id` em `ia_uso` dá 42703. */
let sem0037 = false;

function semColuna() {
  const resposta = { data: null, error: { code: '42703', message: 'column ia_uso.escritorio_id does not exist' } };
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'insert', 'eq', 'limit', 'abortSignal']) q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve(resposta).then(ok);
  return q;
}

vi.mock('@/lib/db', async (orig) => ({
  ...(await orig<object>()),
  getDb: () => ({
    from: (t: string) => {
      const q = banco.from(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
      if (!sem0037 || t !== 'ia_uso') return q;
      // Sem a 0037: filtrar ou gravar `escritorio_id` falha; o resto funciona.
      const insert = q.insert.bind(q);
      const eq = q.eq.bind(q);
      q.insert = (v: unknown) => ((v as Linha).escritorio_id !== undefined ? semColuna() : insert(v));
      q.eq = (c: unknown, v: unknown) => (c === 'escritorio_id' ? semColuna() : eq(c, v));
      return q;
    },
  }),
}));

const { registrarUso, usoHojeEscritorio, esquecerSem0037, situacaoIa, diaUtc } = await import('@/lib/ia/cota');

const HOJE = diaUtc();
const linha = (escritorio_id: string | null, neuronios: number, extra: Linha = {}): Linha =>
  ({ provedor: 'cloudflare', modelo: 'm', finalidade: 'ponto', neuronios, estimado: false, ok: true, dia: HOJE, escritorio_id, ...extra });

beforeEach(() => {
  sem0037 = false;
  esquecerSem0037();
  tabelas = { ia_uso: [] };
  banco = bancoFalso(tabelas);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('usoHojeEscritorio', () => {
  it('soma só o escritório pedido, só hoje e só a Cloudflare (isolamento)', async () => {
    tabelas.ia_uso.push(
      linha('esc-a', 100), linha('esc-a', 50.5), linha('esc-b', 3000), linha(null, 999),
      linha('esc-a', 700, { dia: '2020-01-01' }), linha('esc-a', 400, { provedor: 'gemini' }),
    );
    expect(await usoHojeEscritorio('esc-a')).toBe(150.5);
    expect(await usoHojeEscritorio('esc-b')).toBe(3000);
    expect(await usoHojeEscritorio('esc-c')).toBe(0);
    expect(await usoHojeEscritorio('')).toBeNull();
  });

  it('sem a 0037: devolve null (sem teto) e não insiste por 5 min', async () => {
    sem0037 = true;
    expect(await usoHojeEscritorio('esc-a')).toBeNull();
    sem0037 = false; // mesmo que a coluna apareça, lembra por um tempo
    expect(await usoHojeEscritorio('esc-a')).toBeNull();
    esquecerSem0037();
    expect(await usoHojeEscritorio('esc-a')).toBe(0);
  });
});

describe('registrarUso com o escritório', () => {
  it('grava o escritório; sem ele, a linha fica sem escritório', async () => {
    await registrarUso({ provedor: 'cloudflare', modelo: 'm', finalidade: 'ponto', neuronios: 12.345, estimado: false, ok: true, escritorioId: 'esc-a' }, () => 1);
    await registrarUso({ provedor: 'cloudflare', modelo: 'm', finalidade: 'sugestao', neuronios: 1, estimado: true, ok: true }, () => 1);
    expect(tabelas.ia_uso).toEqual([
      expect.objectContaining({ escritorio_id: 'esc-a', neuronios: 12.35, dia: HOJE }),
      expect.not.objectContaining({ escritorio_id: expect.anything() }),
    ]);
    expect(await usoHojeEscritorio('esc-a')).toBe(12.35);
  });

  it('sem a 0037: grava sem o escritório (o dia da plataforma continua contando)', async () => {
    sem0037 = true;
    await registrarUso({ provedor: 'cloudflare', modelo: 'm', finalidade: 'ponto', neuronios: 5, estimado: false, ok: true, escritorioId: 'esc-a' }, () => 1);
    expect(tabelas.ia_uso).toHaveLength(1);
    expect(tabelas.ia_uso[0]).toMatchObject({ neuronios: 5 });
    expect(tabelas.ia_uso[0].escritorio_id).toBeUndefined();
  });
});

describe('situacaoIa com o escritório', () => {
  it('mostra o teto e a parte do escritório pedido — nunca a de outro', async () => {
    vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', 'conta'); vi.stubEnv('CLOUDFLARE_AI_TOKEN', 'token'); vi.stubEnv('IA_PROVEDOR', 'cloudflare');
    tabelas.ia_uso.push(linha('esc-a', 3900), linha('esc-b', 100));
    const a = await situacaoIa(process.env, 'esc-a');
    expect(a.tetoEscritorio).toEqual({ pct: 40, neuronios: 4000 });
    expect(a.escritorio).toMatchObject({ usados: 3900, limite: 4000, nivel: 'aviso', pct: 40 });
    const b = await situacaoIa(process.env, 'esc-b');
    expect(b.escritorio).toMatchObject({ usados: 100, nivel: 'ok' });
    // O master (sem escritório) vê o teto configurado, não o gasto de um escritório.
    const m = await situacaoIa(process.env);
    expect(m.escritorio).toBeNull();
    expect(m.tetoEscritorio).toEqual({ pct: 40, neuronios: 4000 });
  });
});
