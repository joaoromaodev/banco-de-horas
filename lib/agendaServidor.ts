// Agenda de obrigações — parte de servidor: persistência no Postgres (migração
// 0014). Só de servidor (secret key, ignora RLS). A autorização é de quem chama
// (rotas em app/api/agenda, com lib/acesso.ts): aqui só se garante que toda
// escrita leva o `escritorio_id` informado e que toda leitura é recortada por ele.
import { getDb } from './db';
import { lerUsuarios } from './cadastro';
import { Conclusao, Frequencia, NovaObrigacao, Obrigacao } from './agenda';

export class ErroAgenda extends Error {
  constructor(msg: string, readonly status = 400) {
    super(msg);
  }
}

/** `{ escritorioId }` recorta pelo escritório; `'plataforma'` é o master (vê tudo). */
export type Escopo = { escritorioId: string } | 'plataforma';

/** Erro do PostgREST quando a 0014 ainda não foi aplicada vira 503 com instrução. */
function traduzir(e: { code?: string; message?: string } | null): never {
  if (e?.code === '42P01' || e?.code === 'PGRST205' || /agenda_(obrigacoes|conclusoes|avisos|envios)/.test(e?.message ?? '')) {
    throw new ErroAgenda('As tabelas da agenda ainda não existem no banco — aplique a migração 0014 (supabase db push).', 503);
  }
  throw new ErroAgenda(e?.message ?? 'Falha no banco.', 502);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const deLinha = (l: any): Obrigacao & { escritorioId: string } => ({
  id: String(l.id),
  escritorioId: String(l.escritorio_id),
  empresaId: String(l.empresa_id),
  tipo: String(l.tipo),
  nome: String(l.nome),
  recorrencia: l.recorrencia,
  modoDia: l.modo_dia,
  dia: Number(l.dia ?? 0),
  mes: l.mes ?? null,
  defasagem: Number(l.defasagem ?? 0),
  ajuste: l.ajuste,
  dataUnica: l.data_unica ?? null,
  avisoDias: Number(l.aviso_dias ?? 0),
  inicio: String(l.inicio),
  responsavel: l.responsavel ?? null,
  observacao: l.observacao ?? null,
  ativa: Boolean(l.ativa),
});

const paraLinha = (o: NovaObrigacao) => ({
  empresa_id: o.empresaId,
  tipo: o.tipo,
  nome: o.nome,
  recorrencia: o.recorrencia,
  modo_dia: o.modoDia,
  dia: o.dia,
  mes: o.mes ?? null,
  defasagem: o.defasagem,
  ajuste: o.ajuste,
  data_unica: o.dataUnica ?? null,
  aviso_dias: o.avisoDias,
  inicio: o.inicio,
  responsavel: o.responsavel ?? null,
  observacao: o.observacao ?? null,
  ativa: o.ativa,
});

const TABELA = 'agenda_obrigacoes';

// ------------------------------------------------------------ obrigações
export async function listarObrigacoes(escopo: Escopo, empresaId?: string) {
  let q = getDb().from(TABELA).select('*').is('excluido_em', null);
  if (escopo !== 'plataforma') q = q.eq('escritorio_id', escopo.escritorioId);
  if (empresaId) q = q.eq('empresa_id', empresaId);
  const { data, error } = await q.order('empresa_id').order('criado_em');
  if (error) traduzir(error);
  return (data ?? []).map(deLinha);
}

/** Dono da obrigação (para a checagem de acesso antes de editar/excluir/concluir). */
export async function obrigacaoPorId(id: string, incluirExcluida = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id ?? '')) return null;
  let q = getDb().from(TABELA).select('*').eq('id', id);
  if (!incluirExcluida) q = q.is('excluido_em', null);
  const { data, error } = await q.maybeSingle();
  if (error) traduzir(error);
  return data ? deLinha(data) : null;
}

export async function criarObrigacoes(lista: NovaObrigacao[], escritorioId: string, autor: string) {
  if (!lista.length) return [];
  const { data, error } = await getDb().from(TABELA)
    .insert(lista.map((o) => ({ ...paraLinha(o), escritorio_id: escritorioId, criado_por: autor })))
    .select('*');
  if (error) traduzir(error);
  return (data ?? []).map(deLinha);
}

/** Edita a regra. A empresa e o escritório não mudam por aqui. */
export async function atualizarObrigacao(id: string, o: NovaObrigacao, autor: string) {
  const { empresa_id: _empresa, ...campos } = paraLinha(o);
  void _empresa;
  const { data, error } = await getDb().from(TABELA)
    .update({ ...campos, atualizado_por: autor, atualizado_em: new Date().toISOString() })
    .eq('id', id).is('excluido_em', null).select('*').maybeSingle();
  if (error) traduzir(error);
  if (!data) throw new ErroAgenda('Obrigação não encontrada.', 404);
  return deLinha(data);
}

/** Exclusão lógica (ou o desfazer dela). Recortada pelo escritório. */
export async function excluirObrigacoes(ids: string[], escritorioId: string, restaurar = false) {
  if (!ids.length) return;
  const { error } = await getDb().from(TABELA)
    .update({ excluido_em: restaurar ? null : new Date().toISOString() })
    .in('id', ids).eq('escritorio_id', escritorioId);
  if (error) traduzir(error);
}

// ------------------------------------------------------------ conclusões
/**
 * Conclusões a partir do ano informado. Competências comparam como texto:
 * '2024' < '2024-05' < '2024-T2' < '2025' < 'unica' — então `gte('2024')` traz
 * mensais, trimestrais e anuais desde 2024 e todas as únicas.
 */
export async function listarConclusoes(escopo: Escopo, desdeAno: number, empresaId?: string): Promise<Conclusao[]> {
  let q = getDb().from('agenda_conclusoes')
    .select('obrigacao_id, competencia, feita_por, feita_em, agenda_obrigacoes!inner(empresa_id, excluido_em)')
    .gte('competencia', String(desdeAno))
    .is('agenda_obrigacoes.excluido_em', null);
  if (escopo !== 'plataforma') q = q.eq('escritorio_id', escopo.escritorioId);
  if (empresaId) q = q.eq('agenda_obrigacoes.empresa_id', empresaId);
  const { data, error } = await q;
  if (error) traduzir(error);
  return (data ?? []).map((l: any) => ({
    obrigacaoId: String(l.obrigacao_id), competencia: String(l.competencia),
    feitaPor: String(l.feita_por), feitaEm: String(l.feita_em),
  }));
}

export async function marcarFeita(obrigacaoId: string, escritorioId: string, competencia: string, autor: string): Promise<Conclusao> {
  // Marcar de novo o que já está feito mantém o registro original (quem fez primeiro).
  const { error } = await getDb().from('agenda_conclusoes')
    .upsert({ obrigacao_id: obrigacaoId, escritorio_id: escritorioId, competencia, feita_por: autor },
      { onConflict: 'obrigacao_id,competencia', ignoreDuplicates: true });
  if (error) traduzir(error);
  const { data, error: e2 } = await getDb().from('agenda_conclusoes')
    .select('obrigacao_id, competencia, feita_por, feita_em')
    .eq('obrigacao_id', obrigacaoId).eq('competencia', competencia).single();
  if (e2) traduzir(e2);
  return { obrigacaoId, competencia, feitaPor: String(data.feita_por), feitaEm: String(data.feita_em) };
}

export async function desmarcar(obrigacaoId: string, escritorioId: string, competencia: string) {
  const { error } = await getDb().from('agenda_conclusoes').delete()
    .eq('obrigacao_id', obrigacaoId).eq('escritorio_id', escritorioId).eq('competencia', competencia);
  if (error) traduzir(error);
}

// ------------------------------------------------------------ equipe e aviso
/** Contadores do escritório (para o "responsável" e os destinatários do aviso). */
export async function equipeDoEscritorio(escritorioId: string) {
  return (await lerUsuarios())
    .filter((u) => u.role === 'usuario' && u.escritorioId === escritorioId)
    .map((u) => ({ email: u.email.toLowerCase(), nome: u.nome || u.email, admin: Boolean(u.adminEscritorio) }));
}

export interface ConfigAviso { frequencia: Frequencia; destinatarios: string[] }
export const AVISO_PADRAO: ConfigAviso = { frequencia: 'semanal', destinatarios: [] };

export async function lerAviso(escritorioId: string): Promise<ConfigAviso> {
  const { data, error } = await getDb().from('agenda_avisos').select('frequencia, destinatarios')
    .eq('escritorio_id', escritorioId).maybeSingle();
  if (error) traduzir(error);
  return data ? { frequencia: data.frequencia, destinatarios: data.destinatarios ?? [] } : AVISO_PADRAO;
}

export async function salvarAviso(escritorioId: string, c: ConfigAviso, autor: string) {
  const { error } = await getDb().from('agenda_avisos').upsert({
    escritorio_id: escritorioId, frequencia: c.frequencia, destinatarios: c.destinatarios,
    atualizado_por: autor, atualizado_em: new Date().toISOString(),
  }, { onConflict: 'escritorio_id' });
  if (error) traduzir(error);
}

/** Para quem vai o resumo: os escolhidos (se ainda forem da equipe); senão os administradores; senão a equipe toda. */
export function destinatariosDoAviso(c: ConfigAviso, equipe: { email: string; admin: boolean }[]): string[] {
  const daEquipe = new Set(equipe.map((u) => u.email));
  const escolhidos = c.destinatarios.map((d) => d.toLowerCase()).filter((d) => daEquipe.has(d));
  if (escolhidos.length) return escolhidos;
  const admins = equipe.filter((u) => u.admin).map((u) => u.email);
  return admins.length ? admins : equipe.map((u) => u.email);
}

// ------------------------------------------------------------ cron
/** Escritórios com ao menos uma obrigação ativa (os únicos que podem receber resumo). */
export async function escritoriosComAgenda(): Promise<string[]> {
  const { data, error } = await getDb().from(TABELA).select('escritorio_id').is('excluido_em', null).eq('ativa', true);
  if (error) traduzir(error);
  return [...new Set((data ?? []).map((l: any) => String(l.escritorio_id)))];
}

/** Configurações de aviso de vários escritórios de uma vez. */
export async function avisosDe(ids: string[]): Promise<Map<string, ConfigAviso>> {
  if (!ids.length) return new Map();
  const { data, error } = await getDb().from('agenda_avisos').select('escritorio_id, frequencia, destinatarios').in('escritorio_id', ids);
  if (error) traduzir(error);
  return new Map((data ?? []).map((l: any) => [String(l.escritorio_id), { frequencia: l.frequencia, destinatarios: l.destinatarios ?? [] }]));
}

/**
 * Trava de idempotência: insere (escritório, dia). Devolve false se já existia —
 * outra chamada do cron já cuidou deste escritório hoje.
 */
export async function reservarEnvio(escritorioId: string, dia: string, frequencia: Frequencia): Promise<boolean> {
  const { error } = await getDb().from('agenda_envios').insert({ escritorio_id: escritorioId, dia, frequencia });
  if (!error) return true;
  if (error.code === '23505') return false;
  traduzir(error);
}

export async function concluirEnvio(escritorioId: string, dia: string, r: {
  situacao: 'enviado' | 'registrado' | 'falhou' | 'vazio'; destinatarios: string[]; itens: number; erro?: string;
}) {
  const { error } = await getDb().from('agenda_envios')
    .update({ situacao: r.situacao, destinatarios: r.destinatarios, itens: r.itens, erro: r.erro ?? null })
    .eq('escritorio_id', escritorioId).eq('dia', dia);
  if (error) traduzir(error);
}
