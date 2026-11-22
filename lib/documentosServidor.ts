// Portal do cliente — parte de servidor: Postgres (`documentos`, `pendencias`)
// e Supabase Storage (bucket privado `documentos`). Migração 0015.
//
// Só de servidor (secret key). Nenhuma função aqui decide QUEM pode — isso é das
// rotas, com lib/acesso.ts + as regras puras de lib/documentos.ts. Aqui só
// lemos/gravamos o que a rota já autorizou.
import { randomUUID } from 'crypto';
import { getDb } from './db';
import { fecharRecorrenteDoDocumento } from './fechamentoServidor';
import {
  AcaoSituacao, caminhoNoStorage, Categoria, conferirAssinatura, deveReabrir, extensao, LIMITE_BYTES, proximaSituacao,
  STATUS_VISIVEIS, STATUS_VIVOS, StatusDocumento, StatusPendencia, TipoAceito, uuidValido,
} from './documentos';

export const BUCKET = 'documentos';
/** Validade da URL de download: curta, só para o clique abrir o arquivo. */
export const VALIDADE_DOWNLOAD_S = 60;

export class ErroDoc extends Error {
  constructor(msg: string, readonly status = 400) {
    super(msg);
  }
}

/** Erro do PostgREST quando a migração 0015 ainda não foi aplicada. */
function traduzir(e: { code?: string; message?: string } | null): never {
  if (e?.code === '42P01' || e?.code === 'PGRST205') {
    throw new ErroDoc('As tabelas de documentos ainda não existem no banco — aplique a migração 0015.', 503);
  }
  // Mensagem do banco não vai para a tela (pode citar coluna/constraint).
  console.error('[documentos] falha no banco:', e?.code, e?.message);
  throw new ErroDoc('Falha ao acessar o banco.', 502);
}

// ------------------------------------------------------------------ migração 0032
// A 0032 acrescenta colunas (devolução do documento, "não tenho este mês" do
// pedido). O código pode chegar à produção antes dela: a LEITURA cai para as
// colunas antigas (as telas seguem funcionando) e só as ações novas respondem 503.

/** Coluna inexistente: 42703 no select, PGRST204 no insert/update (cache do PostgREST). */
export const colunaAusente = (e: { code?: string } | null | undefined) => e?.code === '42703' || e?.code === 'PGRST204';

export const SEM_0032 = 'Esta ação ainda não está disponível — aplique a migração 0032 do banco.';

/** Sem a 0032 (coluna ausente, ou `devolvido` barrado pelo CHECK antigo): 503 com o recado; o resto, `traduzir`. */
function traduzir0032(e: { code?: string; message?: string } | null): never {
  if (colunaAusente(e) || e?.code === '23514') throw new ErroDoc(SEM_0032, 503);
  traduzir(e);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- resposta crua do PostgREST
type Res = { data: any; error: { code?: string; message?: string } | null; count?: number | null };
let sem0032Ate = 0;

/**
 * Lê com as colunas da 0032; se o banco ainda não as tem, repete com as antigas e
 * lembra disso por 5 min (sem pagar duas consultas a cada leitura).
 */
async function lerCom0032(montar: (com0032: boolean) => PromiseLike<Res>): Promise<Res> {
  if (Date.now() >= sem0032Ate) {
    const r = await montar(true);
    if (!colunaAusente(r.error)) return r;
    sem0032Ate = Date.now() + 5 * 60_000;
    console.warn('[documentos] migração 0032 ainda não aplicada: lendo sem as colunas novas.');
  }
  return montar(false);
}

// ------------------------------------------------------------------ tipos

export interface Documento {
  id: string;
  empresaId: string;
  escritorioId: string | null;
  competencia: string;
  categoria: Categoria;
  caminho: string;
  nome: string;
  tamanho: number;
  tipo: string;
  observacao: string | null;
  pendenciaId: string | null;
  status: StatusDocumento;
  enviadoPor: string;
  enviadoEm: string;
  conferidoPor: string | null;
  conferidoEm: string | null;
  excluidoEm: string | null;
  excluidoPorGestor: boolean;
  /** Devolução (0032): quando, por quem (só a contabilidade vê) e o motivo para o cliente. */
  devolvidoEm: string | null;
  devolvidoPor: string | null;
  motivoDevolucao: string | null;
}

export interface Pendencia {
  id: string;
  empresaId: string;
  escritorioId: string | null;
  titulo: string;
  descricao: string | null;
  categoria: Categoria | null;
  competencia: string | null;
  prazo: string | null;
  status: StatusPendencia;
  atendidaEm: string | null;
  atendidaPor: string | null;
  criadoPor: string;
  criadoEm: string;
  excluidoEm: string | null;
  /** "Não tenho este mês" (0032): quando, por quem (só a contabilidade vê) e a observação. */
  semMovimentoEm: string | null;
  semMovimentoPor: string | null;
  semMovimentoObs: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- linhas cruas do PostgREST */
const doc = (l: any): Documento => ({
  id: l.id, empresaId: l.empresa_id, escritorioId: l.escritorio_id ?? null, competencia: l.competencia,
  categoria: l.categoria, caminho: l.caminho, nome: l.nome_original, tamanho: Number(l.tamanho), tipo: l.tipo,
  observacao: l.observacao ?? null, pendenciaId: l.pendencia_id ?? null, status: l.status,
  enviadoPor: l.enviado_por, enviadoEm: l.enviado_em, conferidoPor: l.conferido_por ?? null,
  conferidoEm: l.conferido_em ?? null, excluidoEm: l.excluido_em ?? null,
  excluidoPorGestor: Boolean(l.excluido_por_gestor),
  devolvidoEm: l.devolvido_em ?? null, devolvidoPor: l.devolvido_por ?? null, motivoDevolucao: l.motivo_devolucao ?? null,
});

const pend = (l: any): Pendencia => ({
  id: l.id, empresaId: l.empresa_id, escritorioId: l.escritorio_id ?? null, titulo: l.titulo,
  descricao: l.descricao ?? null, categoria: l.categoria ?? null, competencia: l.competencia ?? null,
  prazo: l.prazo ?? null, status: l.status, atendidaEm: l.atendida_em ?? null, atendidaPor: l.atendida_por ?? null,
  criadoPor: l.criado_por, criadoEm: l.criado_em, excluidoEm: l.excluido_em ?? null,
  semMovimentoEm: l.sem_movimento_em ?? null, semMovimentoPor: l.sem_movimento_por ?? null, semMovimentoObs: l.sem_movimento_obs ?? null,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * O que vai para a tela: sem o caminho interno do Storage e, para o cliente,
 * sem os e-mails de quem enviou/conferiu (minimização — a tela dele não os usa).
 */
export function publico(d: Documento, gestor: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { caminho: _c, excluidoPorGestor: _x, ...resto } = d;
  return gestor ? resto : { ...resto, enviadoPor: '', conferidoPor: null, devolvidoPor: null };
}

export function pendenciaPublica(p: Pendencia, gestor: boolean) {
  return gestor ? p : { ...p, criadoPor: '', atendidaPor: null, semMovimentoPor: null };
}

/**
 * Recorte do escritório na própria consulta: além de a rota já ter checado a
 * empresa, toda leitura de não-master filtra pelo escritório da sessão.
 * `null` = master (plataforma).
 */
type Escopo = { empresaId: string; escritorioId: string | null };

// ------------------------------------------------------------------ documentos

const COLS_DOC_0015 = 'id, empresa_id, escritorio_id, competencia, categoria, caminho, nome_original, tamanho, tipo, observacao, pendencia_id, status, enviado_por, enviado_em, conferido_por, conferido_em, excluido_em, excluido_por_gestor';
const COLS_DOC = `${COLS_DOC_0015}, devolvido_em, devolvido_por, motivo_devolucao`;
const colsDoc = (com0032: boolean) => (com0032 ? COLS_DOC : COLS_DOC_0015);

export async function listarDocumentos(e: Escopo, competencia?: string): Promise<Documento[]> {
  const { data, error } = await lerCom0032((c) => {
    let q = getDb().from('documentos').select(colsDoc(c))
      .eq('empresa_id', e.empresaId).is('excluido_em', null).in('status', STATUS_VISIVEIS);
    if (e.escritorioId) q = q.eq('escritorio_id', e.escritorioId);
    if (competencia) q = q.eq('competencia', competencia);
    return q.order('competencia', { ascending: false }).order('enviado_em', { ascending: false }).limit(500);
  });
  if (error) traduzir(error);
  return (data ?? []).map(doc);
}

/** Lê um documento pelo id, inclusive excluído (para o desfazer). A rota decide o acesso. */
export async function lerDocumento(id: string): Promise<Documento | null> {
  if (!uuidValido(id)) return null;
  const { data, error } = await lerCom0032((c) => getDb().from('documentos').select(colsDoc(c)).eq('id', id).maybeSingle());
  if (error) traduzir(error);
  return data ? doc(data) : null;
}

/** Envios iniciados pela empresa na última hora (inclui recusados) — freio contra abuso do upload. */
export async function enviosRecentes(empresaId: string): Promise<number> {
  const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await getDb().from('documentos').select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId).gte('enviado_em', desde);
  if (error) traduzir(error);
  return count ?? 0;
}

export interface NovoEnvio {
  empresaId: string;
  escritorioId: string;
  competencia: string;
  categoria: Categoria;
  nome: string;
  tamanho: number;
  tipo: TipoAceito;
  observacao: string | null;
  pendenciaId: string | null;
  autor: string;
}

/**
 * Passo 1 do envio: grava a linha em `enviando` e devolve uma URL de upload
 * assinada para o caminho escolhido AQUI (o navegador não escolhe caminho).
 * O arquivo vai direto do navegador ao Storage — não passa pelo limite de corpo
 * da função serverless.
 */
export async function iniciarEnvio(n: NovoEnvio): Promise<{ id: string; url: string; mime: string }> {
  const id = randomUUID();
  const caminho = caminhoNoStorage(n.escritorioId, id, n.tipo.ext);
  const db = getDb();
  const { error } = await db.from('documentos').insert({
    id, empresa_id: n.empresaId, escritorio_id: n.escritorioId, competencia: n.competencia, categoria: n.categoria,
    caminho, nome_original: n.nome, tamanho: n.tamanho, tipo: n.tipo.mime, observacao: n.observacao,
    pendencia_id: n.pendenciaId, status: 'enviando', enviado_por: n.autor,
  });
  if (error) traduzir(error);
  const { data, error: eUp } = await db.storage.from(BUCKET).createSignedUploadUrl(caminho);
  if (eUp || !data) {
    await db.from('documentos').update({ status: 'rejeitado' }).eq('id', id);
    console.error('[documentos] falha ao assinar upload:', eUp?.message);
    throw new ErroDoc('Não foi possível preparar o envio. Tente de novo.', 502);
  }
  return { id, url: data.signedUrl, mime: n.tipo.mime };
}

/**
 * Recusa um envio que não passou na conferência: apaga o objeto, mas a LINHA
 * fica como `rejeitado` — continua contando no limite por hora e aponta o
 * caminho para a faxina (o token de upload ainda vale e alguém poderia subir de
 * novo ali; ver docs/documentos.md).
 */
async function rejeitar(d: Documento) {
  const db = getDb();
  await db.storage.from(BUCKET).remove([d.caminho]).catch(() => {});
  await db.from('documentos').update({ status: 'rejeitado' }).eq('id', d.id).eq('status', 'enviando');
}

/**
 * Passo 2: o navegador avisa que terminou. Baixamos o objeto e conferimos
 * tamanho e assinatura dos bytes; se não bater, o arquivo e a linha somem.
 * Ok → `recebido`, e a pendência vinculada (se ainda aberta) fica atendida.
 */
export async function confirmarEnvio(d: Documento, autor: string): Promise<Documento> {
  if (d.status === 'rejeitado') throw new ErroDoc('Este envio foi recusado. Envie o arquivo de novo.', 409);
  if (d.status !== 'enviando') return d; // idempotente
  const db = getDb();
  const { data: blob, error } = await db.storage.from(BUCKET).download(d.caminho);
  if (error || !blob) throw new ErroDoc('O arquivo ainda não chegou. Tente enviar de novo.', 409);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length === 0 || bytes.length > LIMITE_BYTES || !conferirAssinatura(bytes, extensao(d.caminho))) {
    await rejeitar(d);
    throw new ErroDoc('O conteúdo do arquivo não corresponde ao tipo informado. Envie um arquivo válido.', 422);
  }
  const { data, error: eUp } = await lerCom0032((c) => db.from('documentos')
    .update({ status: 'recebido', tamanho: bytes.length, enviado_em: new Date().toISOString() })
    .eq('id', d.id).eq('status', 'enviando').select(colsDoc(c)).maybeSingle());
  if (eUp) traduzir(eUp);
  if (d.pendenciaId) await atenderPendencia(d.pendenciaId, autor);
  else {
    // Sem pedido explícito: fecha a pendência mensal (recorrente) da mesma empresa,
    // categoria e competência. Falha aqui não derruba o envio (o arquivo já chegou).
    try { await fecharRecorrenteDoDocumento(d, autor); }
    catch (e) { console.error('[documentos] fechar pendência recorrente:', e instanceof Error ? e.message : e); }
  }
  return data ? doc(data) : { ...d, status: 'recebido' };
}

/**
 * Muda a situação de um documento recebido (a rota já conferiu quem pode e a
 * transição, em lib/documentos.ts): aceitar (`conferido`), devolver com motivo, ou
 * voltar a "recebido". A gravação ainda exige a situação de partida (`eq status`):
 * duas abas clicando ao mesmo tempo não atropelam uma à outra.
 *
 * Pedido ligado ao documento: devolver não atende — se não sobrar outro envio vivo,
 * o pedido REABRE (como ao excluir); voltar de devolvido para recebido/aceito
 * atende de novo.
 */
export async function mudarSituacao(
  d: Documento, acao: AcaoSituacao, autor: string, motivo: string | null = null,
): Promise<Documento> {
  const destino = proximaSituacao(d.status, acao);
  if (!destino) throw new ErroDoc('Este documento não pode mudar para essa situação.', 409);
  const agora = new Date().toISOString();
  const mud: Record<string, unknown> = { status: destino };
  if (destino === 'conferido') Object.assign(mud, { conferido_por: autor, conferido_em: agora });
  else Object.assign(mud, { conferido_por: null, conferido_em: null });
  // Colunas da 0032 só quando a devolução entra ou sai — aceitar/desfazer um
  // documento que nunca foi devolvido continua funcionando sem a migração.
  const usa0032 = destino === 'devolvido' || d.status === 'devolvido';
  if (destino === 'devolvido') Object.assign(mud, { devolvido_em: agora, devolvido_por: autor, motivo_devolucao: motivo });
  else if (d.status === 'devolvido') Object.assign(mud, { devolvido_em: null, devolvido_por: null, motivo_devolucao: null });

  const db = getDb();
  const { data, error } = usa0032
    ? await db.from('documentos').update(mud).eq('id', d.id).eq('status', d.status).is('excluido_em', null).select(COLS_DOC).maybeSingle()
    : await lerCom0032((c) => db.from('documentos').update(mud)
      .eq('id', d.id).eq('status', d.status).is('excluido_em', null).select(colsDoc(c)).maybeSingle());
  if (error) (usa0032 ? traduzir0032 : traduzir)(error);
  if (!data) throw new ErroDoc('O documento mudou enquanto você olhava. Recarregue a lista.', 409);

  if (d.pendenciaId) {
    if (destino === 'devolvido') await reabrirSeSemEnvioVivo(d.pendenciaId);
    else if (d.status === 'devolvido') await atenderPendencia(d.pendenciaId, autor);
  }
  return doc(data);
}

/**
 * Pedido atendido por envios: sem nenhum envio vivo (recebido/aceito, não excluído),
 * volta a ficar aberto. Pedido fechado por "não tenho este mês" (0032) NÃO reabre: a
 * resposta do cliente não dependia daquele arquivo (e o "não tenho" não fica
 * grudado num pedido aberto — ver `podeDesfazerSemMovimento`).
 */
async function reabrirSeSemEnvioVivo(pendenciaId: string) {
  const db = getDb();
  const { count, error } = await db.from('documentos').select('id', { count: 'exact', head: true })
    .eq('pendencia_id', pendenciaId).is('excluido_em', null).in('status', STATUS_VIVOS);
  if (error) traduzir(error);
  if (deveReabrir(count ?? 0)) {
    const reabrir = () => db.from('pendencias').update({ status: 'aberta', atendida_em: null, atendida_por: null })
      .eq('id', pendenciaId).eq('status', 'atendida');
    let { error: eU } = await reabrir().is('sem_movimento_em', null);
    if (colunaAusente(eU)) ({ error: eU } = await reabrir()); // sem a 0032 não existe "não tenho"
    if (eU) traduzir(eU);
  }
}

/** Exclusão lógica (o arquivo fica no Storage para o desfazer). */
export async function excluirDocumento(d: Documento, autor: string, porGestor: boolean): Promise<void> {
  const db = getDb();
  const { error } = await db.from('documentos')
    .update({ excluido_em: new Date().toISOString(), excluido_por: autor, excluido_por_gestor: porGestor })
    .eq('id', d.id).is('excluido_em', null);
  if (error) traduzir(error);
  if (d.pendenciaId) await reabrirSeSemEnvioVivo(d.pendenciaId);
}

export async function restaurarDocumento(d: Documento, autor: string): Promise<void> {
  const { error } = await getDb().from('documentos')
    .update({ excluido_em: null, excluido_por: null, excluido_por_gestor: false }).eq('id', d.id);
  if (error) traduzir(error);
  if (d.pendenciaId && (STATUS_VIVOS as string[]).includes(d.status)) await atenderPendencia(d.pendenciaId, autor);
}

/**
 * Os bytes de um documento já recebido, conferidos de novo (tamanho e assinatura)
 * — para a leitura por IA do Livro Caixa (0029). A rota decide o acesso antes.
 */
export async function baixarArquivo(d: Documento): Promise<Uint8Array> {
  const { data: blob, error } = await getDb().storage.from(BUCKET).download(d.caminho);
  if (error || !blob) {
    console.error('[documentos] falha ao baixar para leitura:', error?.message);
    throw new ErroDoc('Arquivo indisponível.', 404);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length === 0 || bytes.length > LIMITE_BYTES || !conferirAssinatura(bytes, extensao(d.caminho))) {
    throw new ErroDoc('O conteúdo do arquivo não corresponde ao tipo informado.', 422);
  }
  return bytes;
}

/** URL curta de download, com `Content-Disposition: attachment` e o nome original. */
export async function urlDownload(d: Documento): Promise<string> {
  const { data, error } = await getDb().storage.from(BUCKET)
    .createSignedUrl(d.caminho, VALIDADE_DOWNLOAD_S, { download: d.nome });
  if (error || !data) {
    console.error('[documentos] falha ao assinar download:', error?.message);
    throw new ErroDoc('Arquivo indisponível.', 404);
  }
  return data.signedUrl;
}

// ------------------------------------------------------------------ pendências

const COLS_PEND_0015 = 'id, empresa_id, escritorio_id, titulo, descricao, categoria, competencia, prazo, status, atendida_em, atendida_por, criado_por, criado_em, excluido_em';
const COLS_PEND = `${COLS_PEND_0015}, sem_movimento_em, sem_movimento_por, sem_movimento_obs`;
const colsPend = (com0032: boolean) => (com0032 ? COLS_PEND : COLS_PEND_0015);

export async function listarPendencias(e: Escopo): Promise<Pendencia[]> {
  const { data, error } = await lerCom0032((c) => {
    let q = getDb().from('pendencias').select(colsPend(c)).eq('empresa_id', e.empresaId).is('excluido_em', null);
    if (e.escritorioId) q = q.eq('escritorio_id', e.escritorioId);
    return q.order('status', { ascending: true })
      .order('prazo', { ascending: true, nullsFirst: false }).order('criado_em', { ascending: false }).limit(300);
  });
  if (error) traduzir(error);
  return (data ?? []).map(pend);
}

export async function lerPendencia(id: string): Promise<Pendencia | null> {
  if (!uuidValido(id)) return null;
  const { data, error } = await lerCom0032((c) => getDb().from('pendencias').select(colsPend(c)).eq('id', id).maybeSingle());
  if (error) traduzir(error);
  return data ? pend(data) : null;
}

export interface CamposPendencia {
  titulo: string;
  descricao: string | null;
  categoria: Categoria | null;
  competencia: string | null;
  prazo: string | null;
}

export async function criarPendencia(
  e: { empresaId: string; escritorioId: string }, c: CamposPendencia, autor: string,
): Promise<Pendencia> {
  const { data, error } = await lerCom0032((col) => getDb().from('pendencias').insert({
    empresa_id: e.empresaId, escritorio_id: e.escritorioId, ...c, criado_por: autor,
  }).select(colsPend(col)).single());
  if (error) traduzir(error);
  return pend(data);
}

export async function editarPendencia(id: string, c: CamposPendencia): Promise<Pendencia> {
  const { data, error } = await lerCom0032((col) => getDb().from('pendencias').update(c)
    .eq('id', id).is('excluido_em', null).select(colsPend(col)).maybeSingle());
  if (error) traduzir(error);
  if (!data) throw new ErroDoc('Pendência não encontrada.', 404);
  return pend(data);
}

async function atenderPendencia(id: string, autor: string) {
  const { error } = await getDb().from('pendencias')
    .update({ status: 'atendida', atendida_em: new Date().toISOString(), atendida_por: autor })
    .eq('id', id).eq('status', 'aberta').is('excluido_em', null);
  if (error) traduzir(error);
}

/** Fecha (atendida à mão) ou reabre. Reabrir também apaga um "não tenho este mês" (0032). */
export async function mudarStatusPendencia(id: string, status: StatusPendencia, autor: string): Promise<Pendencia> {
  const base = status === 'atendida'
    ? { status, atendida_em: new Date().toISOString(), atendida_por: autor }
    : { status, atendida_em: null, atendida_por: null };
  const limpar = { sem_movimento_em: null, sem_movimento_por: null, sem_movimento_obs: null };
  // Fechar à mão ou reabrir sempre apaga um "não tenho" anterior: a marca só vale para o
  // pedido fechado POR ela (senão o cliente "desfaria" um fechamento da contabilidade).
  // Sem a 0032 as colunas não existem: grava só o de sempre.
  const { data, error } = await lerCom0032((c) => getDb().from('pendencias').update(c ? { ...base, ...limpar } : base)
    .eq('id', id).is('excluido_em', null).select(colsPend(c)).maybeSingle());
  if (error) traduzir(error);
  if (!data) throw new ErroDoc('Pendência não encontrada.', 404);
  return pend(data);
}

/**
 * "Não tenho este mês" (0032): o pedido aberto passa a `atendida`, marcado como sem
 * movimento, com a observação opcional. Só sai de `aberta` (`eq status`): não
 * sobrescreve um pedido que acabou de ser atendido com arquivo.
 */
export async function marcarSemMovimento(id: string, autor: string, obs: string | null): Promise<Pendencia> {
  const agora = new Date().toISOString();
  const { data, error } = await getDb().from('pendencias').update({
    status: 'atendida', atendida_em: agora, atendida_por: autor,
    sem_movimento_em: agora, sem_movimento_por: autor, sem_movimento_obs: obs,
  }).eq('id', id).eq('status', 'aberta').is('excluido_em', null).select(COLS_PEND).maybeSingle();
  if (error) traduzir0032(error);
  if (!data) throw new ErroDoc('Este pedido não está mais aberto. Recarregue a lista.', 409);
  return pend(data);
}

/** Desfaz o "não tenho": o pedido volta a ficar aberto — só se ainda estiver fechado por ele. */
export async function desfazerSemMovimento(id: string): Promise<Pendencia> {
  const { data, error } = await getDb().from('pendencias').update({
    status: 'aberta', atendida_em: null, atendida_por: null,
    sem_movimento_em: null, sem_movimento_por: null, sem_movimento_obs: null,
  }).eq('id', id).eq('status', 'atendida').not('sem_movimento_em', 'is', null).is('excluido_em', null)
    .select(COLS_PEND).maybeSingle();
  if (error) traduzir0032(error);
  if (!data) throw new ErroDoc('Este pedido mudou enquanto você olhava. Recarregue a lista.', 409);
  return pend(data);
}

export async function excluirPendencia(id: string, restaurar = false): Promise<void> {
  const { error } = await getDb().from('pendencias')
    .update({ excluido_em: restaurar ? null : new Date().toISOString() }).eq('id', id);
  if (error) traduzir(error);
}
