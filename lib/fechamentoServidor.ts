// Fechamento mensal — parte de servidor (Postgres). Migração 0018.
//
// Nenhuma função aqui decide QUEM pode: isso é das rotas (lib/acesso.ts). Aqui só
// se lê/grava o que a rota ou o cron já autorizou. As leituras do checklist são
// só leitura e cada fonte falha sozinha (devolve `{ ok: false }`).
import { emLotes, getDb, lerAteTeto, lerTudo } from './db';
import { Calendario, Obrigacao } from './agenda';
import { listarConclusoes, listarObrigacoes } from './agendaServidor';
import {
  DadosCaixa, DadosDocumentos, DadosObrigacoes, Fonte, ModeloRecorrente, obrigacoesDaCompetencia,
  PendenciaAberta, pedidosAAbrir, chavePedido, pendenciaDoDocumento,
} from './fechamento';
import { Categoria } from './documentos';
import { RegimeCadastro } from './agendaDerivada';
import { TETO, Recorte } from './painelServidor';

export class ErroFechamento extends Error {
  constructor(msg: string, readonly status = 400) {
    super(msg);
  }
}

function traduzir(e: { code?: string; message?: string } | null): never {
  if (e?.code === '42P01' || e?.code === 'PGRST205' || e?.code === '42703') {
    throw new ErroFechamento('O fechamento mensal ainda não está instalado — aplique a migração 0018.', 503);
  }
  console.error('[fechamento] falha no banco:', e?.code, e?.message);
  throw new ErroFechamento('Falha ao acessar o banco.', 502);
}

/* eslint-disable @typescript-eslint/no-explicit-any -- linhas cruas do PostgREST */
const COLS = 'id, empresa_id, escritorio_id, titulo, descricao, categoria, dia_prazo, ativa, criado_em, excluido_em';
const modelo = (l: any): ModeloRecorrente & { escritorioId: string } => ({
  id: l.id, empresaId: l.empresa_id, escritorioId: l.escritorio_id, titulo: l.titulo, descricao: l.descricao ?? null,
  categoria: l.categoria, diaPrazo: Number(l.dia_prazo), ativa: Boolean(l.ativa), criadoEm: l.criado_em, excluidoEm: l.excluido_em ?? null,
});
/* eslint-enable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- linha crua do PostgREST
type LinhaBanco = any;

export type ModeloComEscritorio = ModeloRecorrente & { escritorioId: string };

// -------------------------------------------------- modelos recorrentes (CRUD)

/** Modelos de uma empresa (ou de várias). `escritorioId` null = master. */
export async function listarRecorrentes(empresaIds: string[], escritorioId: string | null): Promise<ModeloComEscritorio[]> {
  if (!empresaIds.length) return [];
  const db = getDb();
  const partes = await emLotes(empresaIds, (lote) => lerAteTeto<LinhaBanco>((de, ate) => {
    let q = db.from('pendencias_recorrentes').select(COLS).in('empresa_id', lote).is('excluido_em', null);
    if (escritorioId) q = q.eq('escritorio_id', escritorioId);
    return q.order('empresa_id').order('criado_em').order('id').range(de, ate);
  }, TETO, { falhar: traduzir }).then((r) => r.linhas));
  return partes.slice(0, TETO).map(modelo);
}

export async function lerRecorrente(id: string, incluirExcluido = false): Promise<ModeloComEscritorio | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) return null;
  let q = getDb().from('pendencias_recorrentes').select(COLS).eq('id', id);
  if (!incluirExcluido) q = q.is('excluido_em', null);
  const { data, error } = await q.maybeSingle();
  if (error) traduzir(error);
  return data ? modelo(data) : null;
}

export interface CamposRecorrente {
  titulo: string; descricao: string | null; categoria: Categoria; diaPrazo: number;
}

export async function criarRecorrentes(
  linhas: { empresaId: string; escritorioId: string; campos: CamposRecorrente }[], autor: string,
): Promise<ModeloComEscritorio[]> {
  if (!linhas.length) return [];
  const { data, error } = await getDb().from('pendencias_recorrentes').insert(linhas.map((l) => ({
    empresa_id: l.empresaId, escritorio_id: l.escritorioId, titulo: l.campos.titulo, descricao: l.campos.descricao,
    categoria: l.campos.categoria, dia_prazo: l.campos.diaPrazo, criado_por: autor,
  }))).select(COLS);
  if (error) traduzir(error);
  return (data ?? []).map(modelo);
}

export async function editarRecorrente(id: string, c: Partial<CamposRecorrente> & { ativa?: boolean }): Promise<ModeloComEscritorio> {
  const mud: Record<string, unknown> = {};
  if (c.titulo !== undefined) mud.titulo = c.titulo;
  if (c.descricao !== undefined) mud.descricao = c.descricao;
  if (c.categoria !== undefined) mud.categoria = c.categoria;
  if (c.diaPrazo !== undefined) mud.dia_prazo = c.diaPrazo;
  if (c.ativa !== undefined) mud.ativa = c.ativa;
  const { data, error } = await getDb().from('pendencias_recorrentes').update(mud)
    .eq('id', id).is('excluido_em', null).select(COLS).maybeSingle();
  if (error) traduzir(error);
  if (!data) throw new ErroFechamento('Pedido mensal não encontrado.', 404);
  return modelo(data);
}

export async function excluirRecorrente(id: string, restaurar = false): Promise<void> {
  const { error } = await getDb().from('pendencias_recorrentes')
    .update({ excluido_em: restaurar ? null : new Date().toISOString() }).eq('id', id);
  if (error) traduzir(error);
}

// ------------------------------------------------------------ o dia 1º (cron)

export interface ResultadoAbertura { modelos: number; abertas: number; ja_existiam: number; falhas: number }

/**
 * Abre as pendências da competência anterior. Idempotente: o índice único
 * (modelo_id, competencia) barra a repetição mesmo se a Vercel chamar duas vezes.
 * `empresasAtivas`: empresa id → escritório (só empresas não arquivadas, de
 * escritório não suspenso — quem chama monta).
 */
export async function abrirPendenciasRecorrentes(hoje: string, empresasAtivas: Map<string, string>): Promise<ResultadoAbertura> {
  const db = getDb();
  // Todos os modelos ativos da plataforma, por páginas (um `.limit(10000)` voltava 1.000).
  const data = await lerTudo<LinhaBanco>((de, ate) => db.from('pendencias_recorrentes').select(COLS)
    .eq('ativa', true).is('excluido_em', null).order('id').range(de, ate), { falhar: traduzir });
  const modelos = data.map(modelo).filter((m) => empresasAtivas.get(m.empresaId) === m.escritorioId);
  const r: ResultadoAbertura = { modelos: modelos.length, abertas: 0, ja_existiam: 0, falhas: 0 };
  if (!modelos.length) return r;

  const comp = pedidosAAbrir(modelos, new Set(), hoje)[0]?.competencia;
  if (!comp) return r; // nenhum modelo elegível ainda (todos criados neste mês)
  const feitos = await emLotes(modelos.map((m) => m.id), (lote) => lerTudo<LinhaBanco>((de, ate) => db.from('pendencias')
    .select('id, modelo_id, competencia').eq('competencia', comp).in('modelo_id', lote).order('id').range(de, ate), { falhar: traduzir }));
  const ja = new Set(feitos.map((l: { modelo_id: string; competencia: string }) => chavePedido(l.modelo_id, l.competencia)));
  const abrir = pedidosAAbrir(modelos, ja, hoje);
  r.ja_existiam = modelos.length - abrir.length;

  const porId = new Map(modelos.map((m) => [m.id, m]));
  for (const p of abrir) {
    const m = porId.get(p.modeloId)!;
    const { error: eI } = await db.from('pendencias').insert({
      empresa_id: p.empresaId, escritorio_id: m.escritorioId, titulo: m.titulo, descricao: m.descricao,
      categoria: m.categoria, competencia: p.competencia, prazo: p.prazo, modelo_id: m.id,
      criado_por: 'Fechamento mensal (automático)',
    });
    if (!eI) r.abertas++;
    else if (eI.code === '23505') r.ja_existiam++; // outra chamada chegou primeiro
    else { r.falhas++; console.error('[fechamento] abrir pendência:', eI.code, eI.message); }
  }
  return r;
}

/**
 * Documento confirmado sem pedido explícito: fecha a pendência recorrente aberta
 * da mesma empresa, categoria e competência e liga o documento a ela (assim o
 * "reabrir ao excluir o último envio" continua valendo). Devolve o id fechado.
 * Nunca derruba o envio: quem chama trata a exceção.
 */
export async function fecharRecorrenteDoDocumento(
  doc: { id: string; empresaId: string; categoria: string; competencia: string }, autor: string,
): Promise<string | null> {
  const db = getDb();
  const { data, error } = await db.from('pendencias')
    .select('id, empresa_id, categoria, competencia, modelo_id, prazo, criado_em')
    .eq('empresa_id', doc.empresaId).eq('categoria', doc.categoria).eq('competencia', doc.competencia)
    .eq('status', 'aberta').is('excluido_em', null).not('modelo_id', 'is', null).limit(20);
  if (error) traduzir(error);
  const abertas: PendenciaAberta[] = (data ?? []).map((l: any) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    id: l.id, empresaId: l.empresa_id, categoria: l.categoria, competencia: l.competencia,
    modeloId: l.modelo_id ?? null, prazo: l.prazo ?? null, criadoEm: l.criado_em,
  }));
  const id = pendenciaDoDocumento(doc, abertas);
  if (!id) return null;
  const { error: eA } = await db.from('pendencias')
    .update({ status: 'atendida', atendida_em: new Date().toISOString(), atendida_por: autor })
    .eq('id', id).eq('status', 'aberta');
  if (eA) traduzir(eA);
  const { error: eD } = await db.from('documentos').update({ pendencia_id: id }).eq('id', doc.id).is('pendencia_id', null);
  if (eD) traduzir(eD);
  return id;
}

// ---------------------------------------------------- checklist (só leitura)

export interface FontesFechamento {
  caixa: Map<string, DadosCaixa> | null; // null = não se aplica (sem o módulo)
  caixaOk: boolean;
  documentos: Map<string, DadosDocumentos>;
  documentosOk: boolean;
  obrigacoes: Map<string, DadosObrigacoes>;
  obrigacoesOk: boolean;
}

export const fonte = <T>(ok: boolean, dados: T): Fonte<T> => (ok ? { ok: true, dados } : { ok: false });

/** Caixa do mês: lançamentos, não conferidos e confirmação, por empresa (leitura). */
async function lerCaixa(empresaIds: string[], ano: number, mes: number): Promise<Map<string, DadosCaixa>> {
  const db = getDb();
  const r = new Map<string, DadosCaixa>();
  for (const id of empresaIds) r.set(id, { lancamentos: 0, naoConferidos: 0, confirmado: false });
  if (!empresaIds.length) return r;
  const lista = await emLotes(empresaIds, (lote) => lerTudo<{ id: string; empresa_id: string }>((de, ate) =>
    db.from('exercicios').select('id, empresa_id').eq('ano', ano).in('empresa_id', lote).order('id').range(de, ate)));
  if (!lista.length) return r;
  const ids = lista.map((e) => e.id);
  // Meses confirmados e lançamentos do mês em consultas por lote — antes eram 2 consultas
  // de contagem POR EMPRESA (N+1). Aqui só vêm 2 colunas estreitas, paginadas.
  const [conf, lancs] = await Promise.all([
    emLotes(ids, (lote) => lerTudo<{ exercicio_id: string }>((de, ate) => db.from('meses_confirmados')
      .select('exercicio_id').eq('mes', mes).in('exercicio_id', lote).order('exercicio_id').range(de, ate))),
    emLotes(ids, (lote) => lerTudo<{ id: string; exercicio_id: string; conferido_em: string | null }>((de, ate) => db.from('lancamentos')
      .select('id, exercicio_id, conferido_em').eq('mes', mes).in('exercicio_id', lote).order('id').range(de, ate))),
  ]);
  const confirmados = new Set(conf.map((c) => c.exercicio_id));
  const total = new Map<string, { t: number; n: number }>();
  for (const l of lancs) {
    const c = total.get(l.exercicio_id) ?? { t: 0, n: 0 };
    c.t++;
    if (!l.conferido_em) c.n++;
    total.set(l.exercicio_id, c);
  }
  for (const e of lista) {
    const c = total.get(e.id);
    r.set(e.empresa_id, { lancamentos: c?.t ?? 0, naoConferidos: c?.n ?? 0, confirmado: confirmados.has(e.id) });
  }
  return r;
}

async function lerDocumentosPedidos(rec: Recorte, competencia: string): Promise<Map<string, DadosDocumentos>> {
  const r = new Map<string, DadosDocumentos>();
  if (!rec.empresaIds.length) return r;
  const db = getDb();
  const data = await emLotes(rec.empresaIds, (lote) => lerTudo<{ empresa_id: string; status: string }>((de, ate) => {
    let q = db.from('pendencias').select('id, empresa_id, status')
      .eq('competencia', competencia).is('excluido_em', null).in('empresa_id', lote);
    if (rec.escritorioId) q = q.eq('escritorio_id', rec.escritorioId);
    return q.order('id').range(de, ate);
  }));
  for (const l of data) {
    const d = r.get(l.empresa_id) ?? { pedidos: 0, abertos: 0 };
    d.pedidos++;
    if (l.status === 'aberta') d.abertos++;
    r.set(l.empresa_id, d);
  }
  return r;
}

/** Junta as três fontes do checklist; cada uma falha sozinha. */
export async function fontesDoFechamento(
  rec: Recorte, ano: number, mes: number, competencia: string,
  opcoes: { comCaixa: boolean; escopoAgenda: { escritorioId: string } | 'plataforma' | null },
): Promise<FontesFechamento> {
  const f: FontesFechamento = {
    caixa: null, caixaOk: true, documentos: new Map(), documentosOk: true, obrigacoes: new Map(), obrigacoesOk: true,
  };
  const ids = new Set(rec.empresaIds);
  await Promise.all([
    opcoes.comCaixa ? lerCaixa(rec.empresaIds, ano, mes).then((m) => { f.caixa = m; }).catch((e) => {
      f.caixaOk = false; console.error('[fechamento] caixa:', e?.code, e?.message);
    }) : Promise.resolve(),
    lerDocumentosPedidos(rec, competencia).then((m) => { f.documentos = m; }).catch((e) => {
      f.documentosOk = false; console.error('[fechamento] documentos:', e?.code, e?.message);
    }),
    (async () => {
      if (!opcoes.escopoAgenda) return; // contador sem escritório: nada a consultar
      const [obr, con] = await Promise.all([listarObrigacoes(opcoes.escopoAgenda), listarConclusoes(opcoes.escopoAgenda, ano - 1)]);
      f.obrigacoes = obrigacoesDaCompetencia(obr.filter((o: Obrigacao) => ids.has(o.empresaId)), con, competencia, new Calendario());
    })().catch((e) => { f.obrigacoesOk = false; console.error('[fechamento] agenda:', e?.code ?? '', e?.message); }),
  ]);
  return f;
}

// ------------------------------------------------------------ regime (0018)

export async function lerRegimes(empresaIds: string[], escritorioId: string | null): Promise<Map<string, RegimeCadastro>> {
  const r = new Map<string, RegimeCadastro>();
  if (!empresaIds.length) return r;
  const db = getDb();
  const data = await emLotes(empresaIds, (lote) => lerTudo<{ empresa_id: string; regime: RegimeCadastro }>((de, ate) => {
    let q = db.from('empresa_regime').select('empresa_id, regime').in('empresa_id', lote);
    if (escritorioId) q = q.eq('escritorio_id', escritorioId);
    return q.order('empresa_id').range(de, ate);
  }, { falhar: traduzir }));
  for (const l of data) r.set(l.empresa_id, l.regime);
  return r;
}

export async function salvarRegime(empresaId: string, escritorioId: string, regime: RegimeCadastro, autor: string): Promise<void> {
  const { error } = await getDb().from('empresa_regime').upsert(
    { empresa_id: empresaId, escritorio_id: escritorioId, regime, definido_por: autor, definido_em: new Date().toISOString() },
    { onConflict: 'empresa_id' },
  );
  if (error) traduzir(error);
}

export async function limparRegime(empresaId: string): Promise<void> {
  const { error } = await getDb().from('empresa_regime').delete().eq('empresa_id', empresaId);
  if (error) traduzir(error);
}
