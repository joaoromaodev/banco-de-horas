// Fechamento mensal — regras puras (sem I/O, testadas em tests/fechamento.test.ts).
//
// Três pedaços:
//  1. Pendências recorrentes: quais pedidos abrir no dia 1º, o prazo e como o
//     envio de um documento fecha o pedido sozinho.
//  2. Checklist do mês anterior por empresa (caixa, conferência, confirmação,
//     documentos, obrigações) e o resumo "X de Y empresas fechadas".
//  3. Modelo padrão de documentos pedidos todo mês.
// Banco em lib/fechamentoServidor.ts. Ver docs/painel.md e docs/documentos.md.
import { Calendario, chaveConclusao, Conclusao, Obrigacao, ocorrenciasDe, somarDias } from './agenda';
import { Categoria, competenciaBR, competenciaPadrao, competenciaValida } from './documentos';

// ================================================ 1. pendências recorrentes

/** Um pedido mensal configurado para uma empresa. */
export interface ModeloRecorrente {
  id: string;
  empresaId: string;
  titulo: string;
  descricao: string | null;
  categoria: Categoria;
  /** Dia do mês (1–28) em que vence o pedido aberto no dia 1º. */
  diaPrazo: number;
  ativa: boolean;
  criadoEm: string;
  excluidoEm: string | null;
}

export const DIA_PRAZO_MIN = 1;
export const DIA_PRAZO_MAX = 28;
export const DIA_PRAZO_PADRAO = 10;

/**
 * Dia de prazo de um item: o enviado (validado) ou, se não veio (`undefined`,
 * `null`, ''), o padrão do escritório. Veio e é inválido → `null`.
 */
export function resolverDiaPrazo(bruto: unknown, padrao: number): number | null {
  if (bruto === undefined || bruto === null || bruto === '') return diaPrazoValido(padrao) ? padrao : DIA_PRAZO_PADRAO;
  const n = Number(bruto);
  return diaPrazoValido(n) ? n : null;
}

export function diaPrazoValido(d: unknown): d is number {
  return typeof d === 'number' && Number.isInteger(d) && d >= DIA_PRAZO_MIN && d <= DIA_PRAZO_MAX;
}

/** Competência que o pedido de `hoje` cobre: o mês anterior. */
export const competenciaDoPedido = competenciaPadrao;

/** Prazo do pedido: `diaPrazo` do mês SEGUINTE à competência (= o mês em que ele abre). */
export function prazoDoPedido(competencia: string, diaPrazo: number): string {
  const ano = Number(competencia.slice(0, 4));
  const mes = Number(competencia.slice(5, 7));
  const [a, m] = mes === 12 ? [ano + 1, 1] : [ano, mes + 1];
  const dia = Math.min(Math.max(Math.trunc(diaPrazo) || DIA_PRAZO_PADRAO, DIA_PRAZO_MIN), DIA_PRAZO_MAX);
  return `${a}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export interface PedidoAAbrir { modeloId: string; empresaId: string; competencia: string; prazo: string }

export const chavePedido = (modeloId: string, competencia: string) => `${modeloId}|${competencia}`;

/**
 * O que o cron precisa abrir hoje. Idempotente: pula o que já existe
 * (`jaAbertos`, chaves de `chavePedido`, inclusive o excluído de propósito).
 *
 * Roda todo dia, não só no dia 1º: a Vercel não refaz chamada que falhou, então
 * quem perdeu o dia 1º abre no dia 2. Modelo criado neste mês espera o mês
 * seguinte (não despeja pedido de um mês em que ninguém o pediu).
 */
export function pedidosAAbrir(
  modelos: ModeloRecorrente[], jaAbertos: Set<string>, hoje: string,
): PedidoAAbrir[] {
  const competencia = competenciaDoPedido(hoje);
  const primeiroDoMes = `${hoje.slice(0, 8)}01`;
  return modelos
    .filter((m) => m.ativa && !m.excluidoEm && m.criadoEm.slice(0, 10) < primeiroDoMes)
    .filter((m) => !jaAbertos.has(chavePedido(m.id, competencia)))
    .map((m) => ({ modeloId: m.id, empresaId: m.empresaId, competencia, prazo: prazoDoPedido(competencia, m.diaPrazo) }));
}

export interface PendenciaAberta {
  id: string; empresaId: string; categoria: Categoria | null; competencia: string | null;
  modeloId: string | null; prazo: string | null; criadoEm: string;
}

/**
 * A pendência recorrente aberta que um documento enviado atende: mesma empresa,
 * categoria e competência. Só as nascidas de um modelo fecham sozinhas — pedido
 * manual segue o vínculo explícito (`documentos.pendencia_id`). Havendo mais de
 * uma, a de prazo mais próximo.
 */
export function pendenciaDoDocumento(
  doc: { empresaId: string; categoria: string; competencia: string }, abertas: PendenciaAberta[],
): string | null {
  const candidatas = abertas
    .filter((p) => p.modeloId && p.empresaId === doc.empresaId && p.categoria === doc.categoria && p.competencia === doc.competencia)
    .sort((a, b) => (a.prazo ?? '9999').localeCompare(b.prazo ?? '9999') || a.criadoEm.localeCompare(b.criadoEm));
  return candidatas[0]?.id ?? null;
}

// ======================================================= 3. modelo padrão

export interface ItemModelo { titulo: string; descricao: string; categoria: Categoria; diaPrazo: number }

/** O que a maioria dos escritórios pede todo mês. O escritório marca o que vale. */
export const MODELO_PADRAO: ItemModelo[] = [
  { titulo: 'Extrato bancário', descricao: 'Extrato de todas as contas da empresa, do mês inteiro (PDF ou OFX).', categoria: 'extrato', diaPrazo: 5 },
  { titulo: 'Notas fiscais', descricao: 'Notas emitidas e recebidas no mês (XML ou PDF).', categoria: 'nota', diaPrazo: 5 },
  { titulo: 'Recibos e comprovantes', descricao: 'Recibos, comprovantes de pagamento e demais despesas do mês.', categoria: 'recibo', diaPrazo: 10 },
  { titulo: 'Informações da folha', descricao: 'Faltas, horas extras, admissões e demissões do mês.', categoria: 'folha', diaPrazo: 5 },
];

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** Itens do modelo que a empresa ainda não pede (mesmo título e categoria). */
export function itensNovos(itens: ItemModelo[], existentes: Pick<ModeloRecorrente, 'titulo' | 'categoria' | 'excluidoEm'>[]): ItemModelo[] {
  const ja = new Set(existentes.filter((e) => !e.excluidoEm).map((e) => `${norm(e.titulo)}|${e.categoria}`));
  const vistos = new Set<string>();
  return itens.filter((i) => {
    const k = `${norm(i.titulo)}|${i.categoria}`;
    if (ja.has(k) || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

// =========================================================== 2. checklist

export type EtapaFechamento = 'caixa' | 'conferencia' | 'confirmacao' | 'documentos' | 'obrigacoes';

export const ETAPAS: { chave: EtapaFechamento; rotulo: string; href: string }[] = [
  { chave: 'caixa', rotulo: 'Lançou no caixa', href: '/caixa' },
  { chave: 'conferencia', rotulo: 'Conferiu os lançamentos', href: '/caixa' },
  { chave: 'confirmacao', rotulo: 'Confirmou o mês', href: '/caixa/resumo' },
  { chave: 'documentos', rotulo: 'Documentos pedidos chegaram', href: '/documentos' },
  { chave: 'obrigacoes', rotulo: 'Obrigações feitas', href: '/agenda' },
];

/** Resultado de uma fonte: `ok: false` = não carregou (a etapa fica "indisponível"). */
export type Fonte<T> = { ok: true; dados: T } | { ok: false };

/** `null` em `dados` = a fonte não se aplica (ex.: contador sem o módulo caixa). */
export interface DadosCaixa { lancamentos: number; naoConferidos: number; confirmado: boolean }
export interface DadosDocumentos { pedidos: number; abertos: number }
export interface DadosObrigacoes { total: number; feitas: number }

export interface EntradaFechamento {
  empresaId: string;
  nome: string;
  caixa: Fonte<DadosCaixa | null>;
  documentos: Fonte<DadosDocumentos | null>;
  obrigacoes: Fonte<DadosObrigacoes | null>;
}

export type EstadoEtapa = 'ok' | 'falta' | 'na' | 'indisponivel';

export interface ResultadoEtapa { chave: EtapaFechamento; rotulo: string; href: string; estado: EstadoEtapa; detalhe: string }

/** `fechada` · `aberta` (falta algo) · `incompleta` (nada falta, mas uma fonte não carregou) · `sem_etapas`. */
export type SituacaoEmpresa = 'fechada' | 'aberta' | 'incompleta' | 'sem_etapas';

export interface EmpresaFechamento {
  empresaId: string; nome: string; etapas: ResultadoEtapa[]; situacao: SituacaoEmpresa; faltam: number;
}

const n = (q: number, um: string, varios: string) => `${q} ${q === 1 ? um : varios}`;

/** Aplica as regras do fechamento a uma empresa. Cada fonte falha sozinha. */
export function checklistDaEmpresa(e: EntradaFechamento, competencia: string): EmpresaFechamento {
  const mes = competenciaBR(competencia);
  const etapa = (chave: EtapaFechamento, estado: EstadoEtapa, detalhe: string): ResultadoEtapa => {
    const base = ETAPAS.find((x) => x.chave === chave)!;
    return { chave, rotulo: base.rotulo, href: base.href, estado, detalhe };
  };
  const etapas: ResultadoEtapa[] = [];

  // Caixa: "lançou" vale também para o mês confirmado sem movimento (a contadora
  // decidiu que o mês não teve nada); "conferiu" não se aplica sem lançamentos.
  if (!e.caixa.ok) {
    for (const c of ['caixa', 'conferencia', 'confirmacao'] as const) etapas.push(etapa(c, 'indisponivel', 'Não foi possível consultar o caixa.'));
  } else if (e.caixa.dados === null) {
    for (const c of ['caixa', 'conferencia', 'confirmacao'] as const) etapas.push(etapa(c, 'na', 'Sem o módulo Livro Caixa.'));
  } else {
    const c = e.caixa.dados;
    etapas.push(etapa('caixa', c.lancamentos > 0 || c.confirmado ? 'ok' : 'falta',
      c.lancamentos > 0 ? n(c.lancamentos, 'lançamento', 'lançamentos') : c.confirmado ? 'Mês confirmado sem movimento.' : `Nenhum lançamento em ${mes}.`));
    etapas.push(c.lancamentos === 0
      ? etapa('conferencia', 'na', 'Sem lançamentos para conferir.')
      : etapa('conferencia', c.naoConferidos === 0 ? 'ok' : 'falta',
        c.naoConferidos === 0 ? 'Tudo conferido.' : `${n(c.naoConferidos, 'lançamento', 'lançamentos')} a conferir.`));
    etapas.push(etapa('confirmacao', c.confirmado ? 'ok' : 'falta', c.confirmado ? `${mes} confirmado.` : `${mes} ainda não confirmado.`));
  }

  if (!e.documentos.ok) etapas.push(etapa('documentos', 'indisponivel', 'Não foi possível consultar os documentos.'));
  else if (e.documentos.dados === null || e.documentos.dados.pedidos === 0) etapas.push(etapa('documentos', 'na', 'Nenhum documento pedido para este mês.'));
  else {
    const d = e.documentos.dados;
    etapas.push(etapa('documentos', d.abertos === 0 ? 'ok' : 'falta',
      d.abertos === 0 ? `${d.pedidos} de ${d.pedidos} chegaram.` : `Faltam ${d.abertos} de ${d.pedidos}.`));
  }

  if (!e.obrigacoes.ok) etapas.push(etapa('obrigacoes', 'indisponivel', 'Não foi possível consultar a agenda.'));
  else if (e.obrigacoes.dados === null || e.obrigacoes.dados.total === 0) etapas.push(etapa('obrigacoes', 'na', 'Sem obrigações desta competência.'));
  else {
    const o = e.obrigacoes.dados;
    etapas.push(etapa('obrigacoes', o.feitas >= o.total ? 'ok' : 'falta',
      o.feitas >= o.total ? `${o.total} de ${o.total} feitas.` : `Faltam ${o.total - o.feitas} de ${o.total}.`));
  }

  const faltam = etapas.filter((x) => x.estado === 'falta').length;
  const algumaIndisponivel = etapas.some((x) => x.estado === 'indisponivel');
  const algumaOk = etapas.some((x) => x.estado === 'ok');
  const situacao: SituacaoEmpresa = faltam > 0 ? 'aberta' : algumaIndisponivel ? 'incompleta' : algumaOk ? 'fechada' : 'sem_etapas';
  return { empresaId: e.empresaId, nome: e.nome, etapas, situacao, faltam };
}

export interface ResumoFechamento {
  /** Empresas com alguma etapa aplicável (as `sem_etapas` ficam fora da conta). */
  total: number;
  fechadas: number;
  abertas: number;
  incompletas: number;
  frase: string;
}

export function resumirFechamento(lista: EmpresaFechamento[]): ResumoFechamento {
  const contadas = lista.filter((x) => x.situacao !== 'sem_etapas');
  const fechadas = contadas.filter((x) => x.situacao === 'fechada').length;
  const incompletas = contadas.filter((x) => x.situacao === 'incompleta').length;
  const abertas = contadas.filter((x) => x.situacao === 'aberta').length;
  let frase = contadas.length === 0
    ? 'Nenhuma empresa com etapas para fechar.'
    : `${fechadas} de ${contadas.length} ${contadas.length === 1 ? 'empresa fechada' : 'empresas fechadas'}`;
  if (incompletas) frase += ` · ${n(incompletas, 'sem todos os dados', 'sem todos os dados')}`;
  return { total: contadas.length, fechadas, abertas, incompletas, frase };
}

const peso: Record<SituacaoEmpresa, number> = { aberta: 0, incompleta: 1, fechada: 2, sem_etapas: 3 };

/** Quem mais precisa de atenção primeiro (mais etapas faltando), depois por nome. */
export function ordenarFechamento(lista: EmpresaFechamento[]): EmpresaFechamento[] {
  return [...lista].sort((a, b) => peso[a.situacao] - peso[b.situacao] || b.faltam - a.faltam || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/**
 * Obrigações da agenda de cada empresa cuja competência é `competencia`
 * (AAAA-MM) e quantas já têm conclusão. Só as mensais: trimestrais e anuais
 * não são "do mês". Respeita `inicio` e `ativa` (empresa nova não nasce atrasada).
 */
export function obrigacoesDaCompetencia(
  obrigacoes: Obrigacao[], conclusoes: Pick<Conclusao, 'obrigacaoId' | 'competencia'>[], competencia: string,
  cal = new Calendario(),
): Map<string, DadosObrigacoes> {
  const r = new Map<string, DadosObrigacoes>();
  if (!competenciaValida(competencia)) return r;
  const feitas = new Set(conclusoes.map((c) => chaveConclusao(c.obrigacaoId, c.competencia)));
  const de = `${competencia}-01`;
  // Com defasagem de até 12 meses o vencimento pode cair bem depois do mês.
  for (const oc of ocorrenciasDe(obrigacoes, de, somarDias(de, 400), cal)) {
    if (oc.competencia !== competencia) continue;
    const d = r.get(oc.empresaId) ?? { total: 0, feitas: 0 };
    d.total += 1;
    if (feitas.has(chaveConclusao(oc.obrigacaoId, oc.competencia))) d.feitas += 1;
    r.set(oc.empresaId, d);
  }
  return r;
}
