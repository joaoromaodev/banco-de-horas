// Alerta de limite de faturamento — leitura do caixa (Postgres). Só LEITURA.
// A regra está em lib/limiteFaturamento.ts. Quem decide o acesso é a rota.
import { emLotes, getDb, lerTudo } from './db';
import {
  AlertaLimite, calcularLimite, mesDe, receitaPorMes, regimeComLimite, RegimeLimite, somarMeses,
} from './limiteFaturamento';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- linhas cruas do PostgREST
type Linha = any;

function lancar(e: { code?: string; message?: string }): never {
  throw Object.assign(new Error(e.message ?? 'falha no banco'), { code: e.code });
}

export interface DadosReceita {
  porMes: Record<string, number>;
  /** Primeiro mês (AAAA-MM) em que o caixa tem alguma movimentação. */
  primeiroMes: string | null;
}

/**
 * Receita estimada por mês de cada empresa: ENTRADAS classificadas em conta de
 * natureza `receita`. Ficam de fora as entradas sem conta (retirada de conta
 * corrente e outras movimentações bancárias — transferência não é faturamento) e
 * as classificadas em conta de despesa (estorno). Janela: de `desde` (AAAA-MM) em
 * diante, no máximo os exercícios de `desde` até o ano de `ate`.
 */
export async function receitaDasEmpresas(empresaIds: string[], desde: string, ate: string): Promise<Map<string, DadosReceita>> {
  const r = new Map<string, DadosReceita>();
  for (const id of empresaIds) r.set(id, { porMes: {}, primeiroMes: null });
  if (!empresaIds.length) return r;
  const db = getDb();
  const anoDe = Number(desde.slice(0, 4));
  const anoAte = Number(ate.slice(0, 4));

  const exercicios = await emLotes(empresaIds, (lote) => lerTudo<Linha>((de, a) => db.from('exercicios')
    .select('id, empresa_id, ano').gte('ano', anoDe).lte('ano', anoAte).in('empresa_id', lote).order('id').range(de, a), { falhar: lancar }));
  if (!exercicios.length) return r;
  const dono = new Map<string, string>(exercicios.map((e) => [String(e.id), String(e.empresa_id)]));
  const ids = [...dono.keys()];

  const [naturezas, lancs, meses] = await Promise.all([
    lerTudo<Linha>((de, a) => db.from('plano_contas').select('id, natureza').order('id').range(de, a), { falhar: lancar }),
    emLotes(ids, (lote) => lerTudo<Linha>((de, a) => db.from('lancamentos')
      .select('id, exercicio_id, data, entrada, conta_id').gt('entrada', 0).gte('data', `${desde}-01`)
      .in('exercicio_id', lote).order('id').range(de, a), { falhar: lancar })),
    emLotes(ids, (lote) => lerTudo<Linha>((de, a) => db.from('resumo_mensal')
      .select('exercicio_id, mes, entradas, saidas').in('exercicio_id', lote).order('exercicio_id').order('mes').range(de, a), { falhar: lancar })),
  ]);

  const natureza = new Map<string, string>(naturezas.map((c) => [String(c.id), String(c.natureza)]));
  const entradas = new Map<string, { data: string; valor: number }[]>();
  for (const l of lancs) {
    if (!l.conta_id || natureza.get(String(l.conta_id)) !== 'receita') continue;
    const emp = dono.get(String(l.exercicio_id));
    if (!emp) continue;
    (entradas.get(emp) ?? entradas.set(emp, []).get(emp)!).push({ data: String(l.data), valor: Number(l.entrada) });
  }
  for (const [emp, lista] of entradas) r.get(emp)!.porMes = receitaPorMes(lista);

  const anoDoExercicio = new Map<string, number>(exercicios.map((e) => [String(e.id), Number(e.ano)]));
  for (const m of meses) {
    if (!(Number(m.entradas) > 0) && !(Number(m.saidas) > 0)) continue;
    const emp = dono.get(String(m.exercicio_id));
    if (!emp) continue;
    const chave = `${anoDoExercicio.get(String(m.exercicio_id))}-${String(m.mes).padStart(2, '0')}`;
    const d = r.get(emp)!;
    if (!d.primeiroMes || chave < d.primeiroMes) d.primeiroMes = chave;
  }
  return r;
}

export interface RegimeDaEmpresa { regime: RegimeLimite; abertura: string | null }

/**
 * Regime (MEI/Simples) e data de abertura de cada empresa, de `empresa_regime`. A
 * coluna `abertura` é da migração 0023: sem ela a leitura cai para só o regime.
 * Empresa sem regime registrado, ou com regime sem limite aqui, não entra.
 */
export async function regimesComLimite(empresaIds: string[], escritorioId: string | null): Promise<Map<string, RegimeDaEmpresa>> {
  const r = new Map<string, RegimeDaEmpresa>();
  if (!empresaIds.length) return r;
  const db = getDb();
  const ler = (colunas: string) => emLotes(empresaIds, (lote) => lerTudo<Linha>((de, a) => {
    let q = db.from('empresa_regime').select(colunas).in('empresa_id', lote);
    if (escritorioId) q = q.eq('escritorio_id', escritorioId);
    return q.order('empresa_id').range(de, a);
  }, { falhar: lancar }));
  let linhas: Linha[];
  try {
    linhas = await ler('empresa_id, regime, abertura');
  } catch (e) {
    // 42703 = coluna inexistente (0023 ainda não aplicada): segue sem a abertura.
    if ((e as { code?: string })?.code !== '42703') throw e;
    linhas = await ler('empresa_id, regime');
  }
  for (const l of linhas) {
    const regime = regimeComLimite(l.regime);
    if (regime) r.set(String(l.empresa_id), { regime, abertura: l.abertura ? String(l.abertura).slice(0, 10) : null });
  }
  return r;
}

/** Grava a data de abertura (AAAA-MM-DD ou null) de uma empresa que já tem regime registrado. */
export async function salvarAbertura(empresaId: string, abertura: string | null): Promise<boolean> {
  const { data, error } = await getDb().from('empresa_regime').update({ abertura }).eq('empresa_id', empresaId).select('empresa_id');
  if (error) lancar(error);
  return (data ?? []).length > 0;
}

export interface AlertaDaEmpresa { empresaId: string; alerta: AlertaLimite; abertura: string | null }

/** Alertas de várias empresas de uma vez (3 grupos de consulta, não uma por empresa). */
export async function alertasDasEmpresas(
  empresaIds: string[], escritorioId: string | null, hoje: string,
): Promise<AlertaDaEmpresa[]> {
  const regimes = await regimesComLimite(empresaIds, escritorioId);
  if (!regimes.size) return [];
  const desde = somarMeses(mesDe(hoje), -11);
  const receita = await receitaDasEmpresas([...regimes.keys()], desde, mesDe(hoje));
  return [...regimes.entries()].map(([empresaId, g]) => {
    const d = receita.get(empresaId) ?? { porMes: {}, primeiroMes: null };
    return {
      empresaId, abertura: g.abertura,
      alerta: calcularLimite({ regime: g.regime, hoje, receitaPorMes: d.porMes, abertura: g.abertura, primeiroMesDados: d.primeiroMes }),
    };
  });
}
