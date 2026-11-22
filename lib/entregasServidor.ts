// Entregas do escritório ao cliente — parte de servidor: Postgres (`entregas`,
// migração 0032) e o mesmo bucket privado `documentos` (0015), no prefixo
// `<escritorio_id>/entregas/`.
//
// Nenhuma função aqui decide QUEM pode — isso é das rotas (lib/acesso.ts + as regras
// puras de lib/entregas.ts e lib/documentos.ts). Aqui só se lê/grava o que a rota já
// autorizou. Mesmo envio em dois passos dos documentos: o arquivo não passa pela função.
import { randomUUID } from 'crypto';
import { emLotes, getDb, lerAteTeto } from './db';
import { conferirAssinatura, extensao, LIMITE_BYTES, TipoAceito, uuidValido } from './documentos';
import { BUCKET, ErroDoc, VALIDADE_DOWNLOAD_S } from './documentosServidor';
import { caminhoEntrega, CamposEntrega, StatusEntrega, TipoEntrega } from './entregas';

export const SEM_TABELA_ENTREGAS = 'O envio de documentos ao cliente ainda não está instalado — aplique a migração 0032 do banco.';

function traduzir(e: { code?: string; message?: string } | null): never {
  if (e?.code === '42P01' || e?.code === 'PGRST205' || e?.code === '42703' || e?.code === 'PGRST204') {
    throw new ErroDoc(SEM_TABELA_ENTREGAS, 503);
  }
  console.error('[entregas] falha no banco:', e?.code, e?.message);
  throw new ErroDoc('Falha ao acessar o banco.', 502);
}

export interface Entrega {
  id: string;
  empresaId: string;
  escritorioId: string | null;
  tipo: TipoEntrega;
  titulo: string | null;
  competencia: string;
  vencimento: string | null;
  observacao: string | null;
  caminho: string;
  nome: string;
  tamanho: number;
  mime: string;
  status: StatusEntrega;
  publicadoPor: string;
  publicadoEm: string;
  abertoEm: string | null;
  abertoPor: string | null;
  excluidoEm: string | null;
}

const COLS = 'id, empresa_id, escritorio_id, tipo, titulo, competencia, vencimento, observacao, caminho, nome_original, tamanho, mime, status, publicado_por, publicado_em, aberto_em, aberto_por, excluido_em';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- linha crua do PostgREST
const linha = (l: any): Entrega => ({
  id: l.id, empresaId: l.empresa_id, escritorioId: l.escritorio_id ?? null, tipo: l.tipo, titulo: l.titulo ?? null,
  competencia: l.competencia, vencimento: l.vencimento ? String(l.vencimento).slice(0, 10) : null, observacao: l.observacao ?? null,
  caminho: l.caminho, nome: l.nome_original, tamanho: Number(l.tamanho), mime: l.mime, status: l.status,
  publicadoPor: l.publicado_por, publicadoEm: l.publicado_em, abertoEm: l.aberto_em ?? null, abertoPor: l.aberto_por ?? null,
  excluidoEm: l.excluido_em ?? null,
});

/**
 * O que vai para a tela: nunca o caminho interno do Storage. O cliente não recebe os
 * e-mails de quem publicou nem de quem abriu (minimização — a tela dele não os usa).
 */
export function entregaPublica(e: Entrega, gestor: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { caminho: _c, ...resto } = e;
  return gestor ? resto : { ...resto, publicadoPor: '', abertoPor: null };
}

type Escopo = { empresaId: string; escritorioId: string | null };

/** Publicadas e não excluídas da empresa (as mais novas primeiro). `escritorioId` null = master. */
export async function listarEntregas(e: Escopo): Promise<Entrega[]> {
  let q = getDb().from('entregas').select(COLS)
    .eq('empresa_id', e.empresaId).eq('status', 'publicada').is('excluido_em', null);
  if (e.escritorioId) q = q.eq('escritorio_id', e.escritorioId);
  const { data, error } = await q.order('publicado_em', { ascending: false }).limit(300);
  if (error) traduzir(error);
  return (data ?? []).map(linha);
}

/**
 * Para quem só ENFEITA a tela com as entregas (sino, `/inicio`): sem a 0032 não há o
 * que mostrar — devolve vazio em vez de marcar a fonte como "indisponível" para sempre.
 */
export async function listarEntregasOuNada(e: Escopo): Promise<Entrega[]> {
  try { return await listarEntregas(e); } catch (err) {
    if (err instanceof ErroDoc && err.message === SEM_TABELA_ENTREGAS) return [];
    throw err;
  }
}

/** Ainda não abertas pelo cliente, das empresas dadas (já recortadas pela rota), do escritório. */
export async function listarNaoAbertas(empresaIds: string[], escritorioId: string | null): Promise<Entrega[]> {
  if (!empresaIds.length) return [];
  const db = getDb();
  const partes = await emLotes(empresaIds, async (lote) => (await lerAteTeto<unknown>((de, ate) => {
    let q = db.from('entregas').select(COLS).in('empresa_id', lote)
      .eq('status', 'publicada').is('excluido_em', null).is('aberto_em', null);
    if (escritorioId) q = q.eq('escritorio_id', escritorioId);
    return q.order('id').range(de, ate);
  }, 500, { falhar: traduzir })).linhas);
  return partes.map(linha);
}

/** Lê pelo id, inclusive excluída (para o desfazer). A rota decide o acesso. */
export async function lerEntrega(id: string): Promise<Entrega | null> {
  if (!uuidValido(id)) return null;
  const { data, error } = await getDb().from('entregas').select(COLS).eq('id', id).maybeSingle();
  if (error) traduzir(error);
  return data ? linha(data) : null;
}

/** Publicações iniciadas para a empresa na última hora — freio contra abuso do upload. */
export async function publicacoesRecentes(empresaId: string): Promise<number> {
  const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await getDb().from('entregas').select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId).gte('publicado_em', desde);
  if (error) traduzir(error);
  return count ?? 0;
}

export interface NovaEntrega {
  empresaId: string;
  escritorioId: string;
  campos: CamposEntrega;
  nome: string;
  tamanho: number;
  tipoArquivo: TipoAceito;
  autor: string;
}

/** Passo 1: grava em `enviando` e devolve a URL de upload assinada para o caminho escolhido AQUI. */
export async function iniciarEntrega(n: NovaEntrega): Promise<{ id: string; url: string; mime: string }> {
  const id = randomUUID();
  const caminho = caminhoEntrega(n.escritorioId, id, n.tipoArquivo.ext);
  const db = getDb();
  const { error } = await db.from('entregas').insert({
    id, empresa_id: n.empresaId, escritorio_id: n.escritorioId, tipo: n.campos.tipo, titulo: n.campos.titulo,
    competencia: n.campos.competencia, vencimento: n.campos.vencimento, observacao: n.campos.observacao,
    caminho, nome_original: n.nome, tamanho: n.tamanho, mime: n.tipoArquivo.mime, status: 'enviando', publicado_por: n.autor,
  });
  if (error) traduzir(error);
  const { data, error: eUp } = await db.storage.from(BUCKET).createSignedUploadUrl(caminho);
  if (eUp || !data) {
    await db.from('entregas').update({ status: 'rejeitada' }).eq('id', id);
    console.error('[entregas] falha ao assinar upload:', eUp?.message);
    throw new ErroDoc('Não foi possível preparar o envio. Tente de novo.', 502);
  }
  return { id, url: data.signedUrl, mime: n.tipoArquivo.mime };
}

/**
 * Passo 2: confere tamanho e assinatura dos bytes que chegaram ao Storage. Não bateu:
 * apaga o objeto e a linha fica `rejeitada` (mesmo motivo dos documentos: o token de
 * upload ainda vale). Bateu: `publicada` — o cliente passa a ver.
 */
export async function confirmarEntrega(e: Entrega): Promise<Entrega> {
  if (e.status === 'rejeitada') throw new ErroDoc('Este envio foi recusado. Envie o arquivo de novo.', 409);
  if (e.status !== 'enviando') return e; // idempotente
  const db = getDb();
  const { data: blob, error } = await db.storage.from(BUCKET).download(e.caminho);
  if (error || !blob) throw new ErroDoc('O arquivo ainda não chegou. Tente enviar de novo.', 409);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length === 0 || bytes.length > LIMITE_BYTES || !conferirAssinatura(bytes, extensao(e.caminho))) {
    await db.storage.from(BUCKET).remove([e.caminho]).catch(() => {});
    await db.from('entregas').update({ status: 'rejeitada' }).eq('id', e.id).eq('status', 'enviando');
    throw new ErroDoc('O conteúdo do arquivo não corresponde ao tipo informado. Envie um arquivo válido.', 422);
  }
  const { data, error: eUp } = await db.from('entregas')
    .update({ status: 'publicada', tamanho: bytes.length, publicado_em: new Date().toISOString() })
    .eq('id', e.id).eq('status', 'enviando').select(COLS).maybeSingle();
  if (eUp) traduzir(eUp);
  return data ? linha(data) : { ...e, status: 'publicada' };
}

/**
 * Protocolo de leitura: grava a PRIMEIRA abertura pelo cliente. `aberto_em is null`
 * na própria gravação — abrir de novo (ou dois cliques ao mesmo tempo) não muda a data.
 */
export async function registrarAbertura(e: Entrega, quem: string): Promise<void> {
  const { error } = await getDb().from('entregas')
    .update({ aberto_em: new Date().toISOString(), aberto_por: quem })
    .eq('id', e.id).eq('status', 'publicada').is('aberto_em', null).is('excluido_em', null);
  if (error) traduzir(error);
}

/** Exclusão lógica (o arquivo fica no Storage para o desfazer). */
export async function excluirEntrega(e: Entrega, autor: string): Promise<void> {
  const { error } = await getDb().from('entregas')
    .update({ excluido_em: new Date().toISOString(), excluido_por: autor }).eq('id', e.id).is('excluido_em', null);
  if (error) traduzir(error);
}

export async function restaurarEntrega(e: Entrega): Promise<void> {
  const { error } = await getDb().from('entregas').update({ excluido_em: null, excluido_por: null }).eq('id', e.id);
  if (error) traduzir(error);
}

/** URL de 60 s com `Content-Disposition: attachment` e o nome original. */
export async function urlDownloadEntrega(e: Entrega): Promise<string> {
  const { data, error } = await getDb().storage.from(BUCKET)
    .createSignedUrl(e.caminho, VALIDADE_DOWNLOAD_S, { download: e.nome });
  if (error || !data) {
    console.error('[entregas] falha ao assinar download:', error?.message);
    throw new ErroDoc('Arquivo indisponível.', 404);
  }
  return data.signedUrl;
}
