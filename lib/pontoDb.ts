// Persistência da Folha de Ponto no Postgres (Supabase) — migração 0012.
//
// Substitui lib/sheets.ts no app. Só de servidor (secret key, ignora RLS): a
// autorização é das rotas (lib/acesso.ts + lib/pontoAcesso.ts). Mesmo assim TODA
// função recebe o escritório e filtra por ele junto com a empresa — se uma rota
// errar o recorte, a consulta não devolve nada de outro escritório.
//
// Se a 0012 ainda não foi aplicada, as funções lançam `ErroBancoPendente` e as
// rotas respondem 503 "aguardando o banco" em vez de quebrar.
import { getDb, lerTudo } from './db';
import { DiaFreq, Frequencia, Funcionario, Marcador, MARCADORES } from './tipos';
import { RESERVA_VALIDA_MIN, RITMO } from './cotaOcr';
import { PREFIXO_LEITURA_CLIENTE } from './documentoLancamento';

export interface Feriado {
  data: string; // AAAA-MM-DD
  descricao: string;
}

/** A migração 0012 ainda não está no banco (tabela inexistente). */
export class ErroBancoPendente extends Error {
  constructor() {
    super('A Folha de Ponto está aguardando a atualização do banco de dados. Tente de novo em alguns minutos.');
  }
}

interface ErroPg { code?: string; message: string }

/** PGRST205 = PostgREST não conhece a tabela; 42P01 = tabela não existe. */
export function ehTabelaInexistente(e: ErroPg | null | undefined): boolean {
  return Boolean(e && (e.code === 'PGRST205' || e.code === '42P01'));
}

function falhar(e: ErroPg): never {
  if (ehTabelaInexistente(e)) throw new ErroBancoPendente();
  throw new Error(e.message);
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------- Funcionários
function linhaParaFuncionario(r: any): Funcionario {
  return {
    empresa: String(r.empresa_id),
    nome: String(r.nome ?? ''),
    cargo: r.cargo ?? null,
    jornadaUtilMin: r.jornada_util_min ?? undefined,
    jornadaSabadoMin: r.jornada_sabado_min ?? undefined,
    ordem: r.ordem ?? null,
  };
}

/**
 * Funcionários do escritório; com `empresaId`, só os dessa empresa.
 * `escritorioId` null = todos os escritórios (só o master chega aqui assim).
 */
export async function lerFuncionarios(escritorioId: string | null, empresaId?: string): Promise<Funcionario[]> {
  const db = getDb();
  const data = await lerTudo<any>((de, ate) => {
    let q = db.from('ponto_funcionarios').select('*');
    if (escritorioId) q = q.eq('escritorio_id', escritorioId);
    if (empresaId) q = q.eq('empresa_id', empresaId);
    return q.order('ordem', { ascending: true, nullsFirst: false }).order('nome').order('id').range(de, ate);
  }, { falhar });
  return data.map(linhaParaFuncionario);
}

const minutos = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 1440 ? n : null;
};

/**
 * Substitui o cadastro de funcionários de UMA empresa: grava os enviados (por nome)
 * e remove os que sumiram da lista — só dentro desta empresa e deste escritório.
 * As frequências já lançadas não são apagadas (ficam ligadas pelo nome).
 */
export async function salvarFuncionarios(escritorioId: string, empresaId: string, lista: Funcionario[]): Promise<number> {
  const db = getDb();
  const porNome = new Map<string, Funcionario>();
  for (const f of lista) {
    const nome = String(f.nome ?? '').trim();
    if (nome) porNome.set(nome, { ...f, nome }); // nome repetido: o último vence
  }
  const agora = new Date().toISOString();
  const linhas = [...porNome.values()].map((f, i) => ({
    escritorio_id: escritorioId,
    empresa_id: empresaId,
    nome: f.nome,
    cargo: f.cargo?.trim() || null,
    jornada_util_min: minutos(f.jornadaUtilMin),
    jornada_sabado_min: minutos(f.jornadaSabadoMin),
    ordem: Number.isFinite(Number(f.ordem)) && f.ordem !== null ? Number(f.ordem) : i + 1,
    atualizado_em: agora,
  }));

  if (linhas.length) {
    const { error } = await db.from('ponto_funcionarios').upsert(linhas, { onConflict: 'empresa_id,nome' });
    if (error) falhar(error);
  }
  // Remove os que saíram da lista (dentro da empresa + escritório).
  const { data: atuais, error: e2 } = await db.from('ponto_funcionarios')
    .select('id, nome').eq('escritorio_id', escritorioId).eq('empresa_id', empresaId);
  if (e2) falhar(e2);
  const sair = (atuais ?? []).filter((r: any) => !porNome.has(String(r.nome))).map((r: any) => r.id);
  if (sair.length) {
    const { error } = await db.from('ponto_funcionarios').delete()
      .eq('escritorio_id', escritorioId).eq('empresa_id', empresaId).in('id', sair);
    if (error) falhar(error);
  }
  return linhas.length;
}

// ---------------------------------------------------------------- Frequências
const marcadorValido = (m: unknown): Marcador | null =>
  (MARCADORES as string[]).includes(String(m ?? '')) ? (m as Marcador) : null;

const hora = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, 16) : null;
};

/** Frequências de uma empresa num mês, agrupadas por funcionário. */
export async function lerFrequenciasDoMes(escritorioId: string, empresaId: string, ano: number, mes: number): Promise<Frequencia[]> {
  const db = getDb();
  // Funcionários × até 31 dias: passa de 1.000 linhas com ~33 funcionários.
  const data = await lerTudo<any>((de, ate) => db.from('ponto_frequencias')
    .select('funcionario, dia, entrada_manha, saida_almoco, retorno_almoco, saida_tarde, marcador')
    .eq('escritorio_id', escritorioId).eq('empresa_id', empresaId).eq('ano', ano).eq('mes', mes)
    .order('funcionario').order('dia').range(de, ate), { falhar });
  const porFunc = new Map<string, Frequencia>();
  for (const r of data) {
    const nome = String(r.funcionario);
    if (!porFunc.has(nome)) porFunc.set(nome, { empresa: empresaId, funcionario: nome, ano, mes, dias: [] });
    porFunc.get(nome)!.dias.push({
      dia: Number(r.dia),
      entradaManha: r.entrada_manha ?? null,
      saidaAlmoco: r.saida_almoco ?? null,
      retornoAlmoco: r.retorno_almoco ?? null,
      saidaTarde: r.saida_tarde ?? null,
      marcador: marcadorValido(r.marcador),
    });
  }
  return [...porFunc.values()];
}

/** Dias do mês anterior que a revisão usa (interjornada no dia 1 e 7º dia seguido). */
export const DIAS_ANTERIORES_REVISAO = 7;

/**
 * Para a revisão do mês (lib/revisaoPonto.ts), numa só consulta: as frequências do
 * mês e os últimos `DIAS_ANTERIORES_REVISAO` dias do mês anterior, por funcionário.
 */
export async function lerFrequenciasParaRevisao(escritorioId: string, empresaId: string, ano: number, mes: number): Promise<{
  doMes: Frequencia[];
  anteriores: Map<string, DiaFreq[]>;
}> {
  const db = getDb();
  const ant = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
  // dia ≥ 22: os últimos 7 dias até de fevereiro (22–28); nos meses longos vêm alguns a mais.
  const desde = 29 - DIAS_ANTERIORES_REVISAO;
  const filtro = `and(ano.eq.${ano},mes.eq.${mes}),and(ano.eq.${ant.ano},mes.eq.${ant.mes},dia.gte.${desde})`;
  const data = await lerTudo<any>((de, ate) => db.from('ponto_frequencias')
    .select('funcionario, ano, mes, dia, entrada_manha, saida_almoco, retorno_almoco, saida_tarde, marcador')
    .eq('escritorio_id', escritorioId).eq('empresa_id', empresaId).or(filtro)
    .order('funcionario').order('ano').order('mes').order('dia').range(de, ate), { falhar });
  const porFunc = new Map<string, Frequencia>();
  const anteriores = new Map<string, DiaFreq[]>();
  for (const r of data) {
    const nome = String(r.funcionario);
    const dia: DiaFreq = {
      dia: Number(r.dia),
      entradaManha: r.entrada_manha ?? null,
      saidaAlmoco: r.saida_almoco ?? null,
      retornoAlmoco: r.retorno_almoco ?? null,
      saidaTarde: r.saida_tarde ?? null,
      marcador: marcadorValido(r.marcador),
    };
    if (Number(r.ano) === ano && Number(r.mes) === mes) {
      if (!porFunc.has(nome)) porFunc.set(nome, { empresa: empresaId, funcionario: nome, ano, mes, dias: [] });
      porFunc.get(nome)!.dias.push(dia);
    } else {
      if (!anteriores.has(nome)) anteriores.set(nome, []);
      anteriores.get(nome)!.push(dia);
    }
  }
  return { doMes: [...porFunc.values()], anteriores };
}

/** Dias que vão para o banco: só os que têm horário ou marcador, dia válido, sem repetir. */
export function diasParaGravar(dias: DiaFreq[]): DiaFreq[] {
  const porDia = new Map<number, DiaFreq>();
  for (const d of dias ?? []) {
    const dia = Number(d?.dia);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) continue;
    const limpo: DiaFreq = {
      dia,
      entradaManha: hora(d.entradaManha),
      saidaAlmoco: hora(d.saidaAlmoco),
      retornoAlmoco: hora(d.retornoAlmoco),
      saidaTarde: hora(d.saidaTarde),
      marcador: marcadorValido(d.marcador),
    };
    if (limpo.entradaManha || limpo.saidaAlmoco || limpo.retornoAlmoco || limpo.saidaTarde || limpo.marcador) {
      porDia.set(dia, limpo);
    }
  }
  return [...porDia.values()].sort((a, b) => a.dia - b.dia);
}

/**
 * Grava a frequência do funcionário no mês: substitui o que havia (mesma empresa +
 * funcionário + ano + mês). Primeiro grava os dias novos (upsert), depois remove os
 * que deixaram de existir — se cair no meio, sobra no máximo um dia velho, nunca
 * se perde o mês. Retorna quantos dias foram gravados.
 */
export async function salvarFrequencia(escritorioId: string, freq: Frequencia, autor: string | null): Promise<number> {
  const db = getDb();
  const funcionario = String(freq.funcionario ?? '').trim();
  const dias = diasParaGravar(freq.dias);
  const agora = new Date().toISOString();
  const chave = { escritorio_id: escritorioId, empresa_id: freq.empresa, funcionario, ano: freq.ano, mes: freq.mes };

  if (dias.length) {
    const linhas = dias.map((d) => ({
      ...chave,
      dia: d.dia,
      entrada_manha: d.entradaManha,
      saida_almoco: d.saidaAlmoco,
      retorno_almoco: d.retornoAlmoco,
      saida_tarde: d.saidaTarde,
      marcador: d.marcador ?? null,
      atualizado_em: agora,
      atualizado_por: autor,
    }));
    const { error } = await db.from('ponto_frequencias').upsert(linhas, { onConflict: 'empresa_id,funcionario,ano,mes,dia' });
    if (error) falhar(error);
  }

  let del = db.from('ponto_frequencias').delete()
    .eq('escritorio_id', escritorioId).eq('empresa_id', freq.empresa)
    .eq('funcionario', funcionario).eq('ano', freq.ano).eq('mes', freq.mes);
  if (dias.length) del = del.not('dia', 'in', `(${dias.map((d) => d.dia).join(',')})`);
  const { error } = await del;
  if (error) falhar(error);
  return dias.length;
}

// ---------------------------------------------------------------- Feriados
export async function lerFeriados(escritorioId: string): Promise<Feriado[]> {
  const db = getDb();
  const data = await lerTudo<any>((de, ate) => db.from('ponto_feriados').select('data, descricao')
    .eq('escritorio_id', escritorioId).order('data').range(de, ate), { falhar });
  return data.map((r: any) => ({ data: String(r.data), descricao: String(r.descricao ?? '') }));
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Substitui a lista de feriados do escritório. Datas fora de AAAA-MM-DD são ignoradas. */
export async function salvarFeriados(escritorioId: string, lista: Feriado[]): Promise<number> {
  const db = getDb();
  const porData = new Map<string, string>();
  for (const f of lista ?? []) {
    const data = String(f?.data ?? '').trim();
    if (DATA_ISO.test(data) && !Number.isNaN(Date.parse(`${data}T00:00:00Z`))) porData.set(data, String(f.descricao ?? '').trim());
  }
  const linhas = [...porData].map(([data, descricao]) => ({ escritorio_id: escritorioId, data, descricao }));
  if (linhas.length) {
    const { error } = await db.from('ponto_feriados').upsert(linhas, { onConflict: 'escritorio_id,data' });
    if (error) falhar(error);
  }
  let del = db.from('ponto_feriados').delete().eq('escritorio_id', escritorioId);
  if (linhas.length) del = del.not('data', 'in', `(${linhas.map((l) => l.data).join(',')})`);
  const { error } = await del;
  if (error) falhar(error);
  return linhas.length;
}

// ---------------------------------------------------------------- Cota de leituras por IA
/**
 * Leituras do escritório na competência que contam na cota: concluídas e reservas
 * recentes (em andamento). Falhas e reservas órfãs (> 5 min) não contam.
 */
export async function contarLeiturasOcr(escritorioId: string, competencia: string, agora = new Date()): Promise<number> {
  const desde = new Date(agora.getTime() - RESERVA_VALIDA_MIN * 60_000).toISOString();
  const { count, error } = await getDb().from('ponto_leituras_ocr')
    .select('id', { count: 'exact', head: true })
    .eq('escritorio_id', escritorioId).eq('competencia', competencia)
    .or(`situacao.eq.concluida,and(situacao.eq.reservada,criado_em.gte.${desde})`);
  if (error) falhar(error);
  // Num HEAD sem a tabela o PostgREST devolve 204 sem erro e sem contagem: não é
  // "zero leituras", é banco sem a 0012 — falha fechada.
  if (count === null) throw new ErroBancoPendente();
  return count;
}

/**
 * Leituras de DOCUMENTO (0029) feitas PELO CLIENTE numa empresa, na competência, que
 * contam: concluídas e reservas recentes. É a subcota do cliente — um cliente não
 * esgota o escritório. As leituras da contabilidade na mesma empresa não entram
 * (contam só na cota do escritório): quem leu vem do prefixo em `usuario`.
 */
export async function contarLeiturasDocumentoDoCliente(empresaId: string, competencia: string, agora = new Date()): Promise<number> {
  const desde = new Date(agora.getTime() - RESERVA_VALIDA_MIN * 60_000).toISOString();
  const { count, error } = await getDb().from('ponto_leituras_ocr')
    .select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId).eq('competencia', competencia).eq('origem', 'documento')
    .like('usuario', `${PREFIXO_LEITURA_CLIENTE}%`)
    .or(`situacao.eq.concluida,and(situacao.eq.reservada,criado_em.gte.${desde})`);
  if (error) falhar(error);
  if (count === null) throw new ErroBancoPendente();
  return count;
}

/** Tentativas do escritório (qualquer situação) nos últimos `RITMO.janelaMin` minutos. */
export async function contarTentativasRecentes(escritorioId: string, agora = new Date()): Promise<number> {
  const desde = new Date(agora.getTime() - RITMO.janelaMin * 60_000).toISOString();
  const { count, error } = await getDb().from('ponto_leituras_ocr')
    .select('id', { count: 'exact', head: true })
    .eq('escritorio_id', escritorioId).gte('criado_em', desde);
  if (error) falhar(error);
  if (count === null) throw new ErroBancoPendente();
  return count;
}

/**
 * Reserva uma leitura antes de chamar a IA. Devolve o id da reserva.
 * `origem` (0029): a mesma cota conta a folha de ponto e o documento lido para o
 * Livro Caixa. Só é gravada quando informada — a folha continua funcionando em
 * banco sem a 0029 (a coluna nasce com default 'folha').
 */
export async function reservarLeituraOcr(r: {
  escritorioId: string; competencia: string; empresaId: string; usuario: string; origem?: 'documento';
}): Promise<string> {
  const { data, error } = await getDb().from('ponto_leituras_ocr').insert({
    escritorio_id: r.escritorioId,
    competencia: r.competencia,
    empresa_id: r.empresaId,
    usuario: r.usuario,
    ...(r.origem ? { origem: r.origem } : {}),
  }).select('id').single();
  if (error) falhar(error);
  return String(data.id);
}

export async function confirmarLeituraOcr(id: string): Promise<void> {
  const { error } = await getDb().from('ponto_leituras_ocr').update({ situacao: 'concluida' }).eq('id', id);
  if (error) falhar(error);
}

/** A IA falhou: não conta na cota, mas fica registrada (limite de ritmo, auditoria). */
export async function falharLeituraOcr(id: string): Promise<void> {
  const { error } = await getDb().from('ponto_leituras_ocr').update({ situacao: 'falhou' }).eq('id', id).eq('situacao', 'reservada');
  if (error) falhar(error);
}

/** Reserva desfeita porque a cota estourou na corrida com outra leitura. */
export async function cancelarLeituraOcr(id: string): Promise<void> {
  const { error } = await getDb().from('ponto_leituras_ocr').delete().eq('id', id).eq('situacao', 'reservada');
  if (error) falhar(error);
}
