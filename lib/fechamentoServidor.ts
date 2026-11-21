// Fechamento mensal — parte de servidor (Postgres). Migração 0018.
//
// Nenhuma função aqui decide QUEM pode: isso é das rotas (lib/acesso.ts). Aqui só
// se lê/grava o que a rota ou o cron já autorizou. As leituras do checklist são
// só leitura e cada fonte falha sozinha (devolve `{ ok: false }`).
import { getDb } from './db';
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

export type ModeloComEscritorio = ModeloRecorrente & { escritorioId: string };

// -------------------------------------------------- modelos recorrentes (CRUD)

/** Modelos de uma empresa (ou de várias). `escritorioId` null = master. */
export async function listarRecorrentes(empresaIds: string[], escritorioId: string | null): Promise<ModeloComEscritorio[]> {
  if (!empresaIds.length) return [];
  let q = getDb().from('pendencias_recorrentes').select(COLS).in('empresa_id', empresaIds).is('excluido_em', null);
  if (escritorioId) q = q.eq('escritorio_id', escritorioId);
  const { data, error } = await q.order('empresa_id').order('criado_em').limit(TETO);
  if (error) traduzir(error);
  return (data ?? []).map(modelo);
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
  const { data, error } = await db.from('pendencias_recorrentes').select(COLS).eq('ativa', true).is('excluido_em', null).limit(TETO * 5);
  if (error) traduzir(error);
  const modelos = (data ?? []).map(modelo).filter((m) => empresasAtivas.get(m.empresaId) === m.escritorioId);
  const r: ResultadoAbertura = { modelos: modelos.length, abertas: 0, ja_existiam: 0, falhas: 0 };
  if (!modelos.length) return r;

  const comp = pedidosAAbrir(modelos, new Set(), hoje)[0]?.competencia;
  if (!comp) return r; // nenhum modelo elegível ainda (todos criados neste mês)
  const { data: feitos, error: eF } = await db.from('pendencias').select('modelo_id, competencia')
    .eq('competencia', comp).in('modelo_id', modelos.map((m) => m.id)).limit(TETO * 5);
  if (eF) traduzir(eF);
  const ja = new Set((feitos ?? []).map((l: { modelo_id: string; competencia: string }) => chavePedido(l.modelo_id, l.competencia)));
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
  const { data: ex, error } = await db.from('exercicios').select('id, empresa_id').eq('ano', ano).in('empresa_id', empresaIds);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  const lista = (ex ?? []) as { id: string; empresa_id: string }[];
  if (!lista.length) return r;
  const { data: conf, error: eC } = await db.from('meses_confirmados').select('exercicio_id')
    .eq('mes', mes).in('exercicio_id', lista.map((e) => e.id));
  if (eC) throw Object.assign(new Error(eC.message), { code: eC.code });
  const confirmados = new Set((conf ?? []).map((c: { exercicio_id: string }) => c.exercicio_id));
  // Contagens exatas (head) por exercício: o limite de linhas do PostgREST cortaria a soma.
  await Promise.all(lista.map(async (e) => {
    const base = () => db.from('lancamentos').select('id', { count: 'exact', head: true }).eq('exercicio_id', e.id).eq('mes', mes);
    const [t, n] = await Promise.all([base(), base().is('conferido_em', null)]);
    if (t.error) throw Object.assign(new Error(t.error.message), { code: t.error.code });
    if (n.error) throw Object.assign(new Error(n.error.message), { code: n.error.code });
    r.set(e.empresa_id, { lancamentos: t.count ?? 0, naoConferidos: n.count ?? 0, confirmado: confirmados.has(e.id) });
  }));
  return r;
}

async function lerDocumentosPedidos(rec: Recorte, competencia: string): Promise<Map<string, DadosDocumentos>> {
  const r = new Map<string, DadosDocumentos>();
  if (!rec.empresaIds.length) return r;
  let q = getDb().from('pendencias').select('empresa_id, status')
    .eq('competencia', competencia).is('excluido_em', null).in('empresa_id', rec.empresaIds);
  if (rec.escritorioId) q = q.eq('escritorio_id', rec.escritorioId);
  const { data, error } = await q.limit(TETO);
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  for (const l of (data ?? []) as { empresa_id: string; status: string }[]) {
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
  let q = getDb().from('empresa_regime').select('empresa_id, regime').in('empresa_id', empresaIds);
  if (escritorioId) q = q.eq('escritorio_id', escritorioId);
  const { data, error } = await q;
  if (error) traduzir(error);
  for (const l of (data ?? []) as { empresa_id: string; regime: RegimeCadastro }[]) r.set(l.empresa_id, l.regime);
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
