// Configurações do escritório — banco (só de servidor). Regras puras em
// lib/escritorioConfig.ts; autorização em lib/acesso.ts.
import { getDb } from './db';
import { lerEmpresas } from './cadastro';
import { lerEscritorio, type Escritorio } from './escritorios';
import { ConfigEscritorio, empresasSemContabilista, FiscalLinha } from './escritorioConfig';

export class ErroEscritorio extends Error {
  constructor(msg: string, public status = 400) { super(msg); }
}

/** Mensagem amigável quando o Postgres ainda não recebeu a 0019. */
function traduzir(error: { message: string }): never {
  if (/prazo_pedidos_padrao/.test(error.message)) {
    throw new ErroEscritorio('O prazo padrão ainda não está disponível neste ambiente (falta aplicar a migração 0019).', 503);
  }
  throw new ErroEscritorio(`Não foi possível salvar: ${error.message}`, 502);
}

export async function escritorioOuErro(id: string): Promise<Escritorio> {
  const e = await lerEscritorio(id);
  if (!e) throw new ErroEscritorio('Escritório não encontrado.', 404);
  return e;
}

export async function salvarConfig(id: string, c: ConfigEscritorio): Promise<Escritorio> {
  const { error } = await getDb().from('escritorios').update({
    nome: c.nome, cnpj: c.cnpj,
    contabilista_nome: c.contabilistaNome || null, contabilista_crc: c.contabilistaCrc || null,
    prazo_pedidos_padrao: c.prazoPedidosPadrao,
  }).eq('id', id);
  if (error) traduzir(error);
  return escritorioOuErro(id);
}

/** Prazo padrão dos pedidos mensais do escritório (10 se não houver). */
export async function prazoPadraoDoEscritorio(id: string | undefined): Promise<number> {
  if (!id) return 10;
  try { return (await lerEscritorio(id))?.prazoPedidosPadrao ?? 10; } catch { return 10; }
}

// ------------------------------------------------------------------ aplicar às empresas
async function fiscaisDe(ids: string[]): Promise<FiscalLinha[]> {
  if (!ids.length) return [];
  const { data, error } = await getDb().from('empresa_fiscal').select('empresa_id, contabilista, crc').in('empresa_id', ids);
  if (error) throw new ErroEscritorio(`empresa_fiscal: ${error.message}`, 502);
  return (data ?? []).map((r) => ({ empresaId: String(r.empresa_id), contabilista: r.contabilista, crc: r.crc }));
}

async function idsDoEscritorio(escritorioId: string): Promise<string[]> {
  return (await lerEmpresas()).filter((e) => e.escritorioId === escritorioId).map((e) => e.id);
}

/** Quantas empresas (ativas) do escritório ainda estão sem contabilista. */
export async function contarSemContabilista(escritorioId: string): Promise<{ total: number; semContabilista: number }> {
  const ids = await idsDoEscritorio(escritorioId);
  return { total: ids.length, semContabilista: empresasSemContabilista(ids, await fiscaisDe(ids)).length };
}

export interface Aplicada { empresaId: string; crcAnterior: string }

/**
 * Grava o responsável técnico do escritório nas empresas que ainda NÃO têm
 * contabilista. As que já têm não são tocadas. Devolve o que mudou, para o
 * "Desfazer".
 */
export async function aplicarResponsavel(escritorioId: string, por: string): Promise<{ nome: string; crc: string; aplicadas: Aplicada[] }> {
  const e = await escritorioOuErro(escritorioId);
  if (!e.contabilistaNome) throw new ErroEscritorio('Salve o nome do responsável técnico antes de aplicar.');
  const ids = await idsDoEscritorio(escritorioId);
  const fiscais = await fiscaisDe(ids);
  const alvo = empresasSemContabilista(ids, fiscais);
  const porId = new Map(fiscais.map((f) => [f.empresaId, f]));
  const agora = new Date().toISOString();
  const db = getDb();
  const aplicadas: Aplicada[] = [];
  for (const id of alvo) {
    const f = porId.get(id);
    const crcAnterior = String(f?.crc ?? '').trim();
    const crc = crcAnterior || e.contabilistaCrc;
    const { error } = f
      ? await db.from('empresa_fiscal').update({ contabilista: e.contabilistaNome, crc, atualizado_por: por, atualizado_em: agora })
          .eq('empresa_id', id).eq('contabilista', f.contabilista ?? '')
      : await db.from('empresa_fiscal').insert({ empresa_id: id, contabilista: e.contabilistaNome, crc, atualizado_por: por, atualizado_em: agora });
    if (error) throw new ErroEscritorio(`empresa_fiscal: ${error.message}`, 502);
    aplicadas.push({ empresaId: id, crcAnterior });
  }
  return { nome: e.contabilistaNome, crc: e.contabilistaCrc, aplicadas };
}

/**
 * Desfaz `aplicarResponsavel`: volta a '' só nas empresas do escritório que ainda
 * estão com o nome aplicado (se alguém mudou no meio tempo, a mudança dela fica).
 */
export async function desfazerAplicacao(escritorioId: string, nome: string, aplicadas: Aplicada[], por: string): Promise<number> {
  if (!nome.trim()) throw new ErroEscritorio('Nada para desfazer.');
  const doEscritorio = new Set(await idsDoEscritorio(escritorioId));
  const db = getDb();
  let desfeitas = 0;
  for (const a of aplicadas.slice(0, 1000)) {
    if (!doEscritorio.has(a.empresaId)) continue;
    const { data, error } = await db.from('empresa_fiscal')
      .update({ contabilista: '', crc: String(a.crcAnterior ?? '').trim(), atualizado_por: por, atualizado_em: new Date().toISOString() })
      .eq('empresa_id', a.empresaId).eq('contabilista', nome).select('empresa_id');
    if (error) throw new ErroEscritorio(`empresa_fiscal: ${error.message}`, 502);
    desfeitas += data?.length ?? 0;
  }
  return desfeitas;
}
