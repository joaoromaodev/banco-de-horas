// Painel do contador — "o que precisa de atenção hoje". Regras puras (sem I/O,
// testadas em tests/painel.test.ts). A parte de banco está em lib/painelServidor.ts
// e a rota em app/api/painel/route.ts. Ver docs/painel.md.
import { Calendario, chaveConclusao, Conclusao, diasEntre, Obrigacao, ocorrenciasDe, situacao, somarDias } from './agenda';
import { AlertaConsolidado } from './contratos';
import { situacaoPrazo } from './documentos';

export type ChaveBloco = 'agenda' | 'documentos' | 'pendencias' | 'contratos' | 'caixa';
export type TomItem = 'perigo' | 'aviso' | 'neutro';

/** Uma linha de um bloco. `quando` é uma data AAAA-MM-DD, quando existir. */
export interface ItemPainel {
  id: string;
  titulo: string;
  detalhe?: string;
  empresa: string;
  quando?: string;
  /** Texto curto de prazo: "3 dias de atraso", "vence hoje"… */
  rotuloPrazo?: string;
  tom: TomItem;
}

export type EstadoBloco = 'ok' | 'migracao' | 'erro';

export interface Bloco {
  chave: ChaveBloco;
  titulo: string;
  href: string;
  estado: EstadoBloco;
  /** Total de itens que pedem atenção (não só os mostrados). */
  total: number;
  /** Quantos desses já passaram do prazo. */
  atrasados: number;
  /** Quantos vencem na janela (hoje inclusive). */
  proximos: number;
  /** Quantos aguardam conferência (documentos e caixa). */
  conferir: number;
  itens: ItemPainel[];
  /** A lista foi cortada pelo teto da consulta: o número é "pelo menos". */
  truncado?: boolean;
  /** Blocos agrupados por empresa (caixa, documentos): quantas empresas ficaram
   *  fora da lista. Nos demais, o que falta mostrar é `total - itens.length`. */
  empresasOcultas?: number;
}

/** Texto do "e mais…" no rodapé do bloco; vazio quando nada ficou de fora. */
export function textoRestante(b: Bloco): string {
  if (b.empresasOcultas != null) {
    const n = b.empresasOcultas;
    return n > 0 ? `e mais ${n} ${n === 1 ? 'empresa' : 'empresas'}` : '';
  }
  const n = b.total - b.itens.length;
  return n > 0 ? `e mais ${n}${b.truncado ? ' ou mais' : ''}` : '';
}

export const LIMITE_ITENS = 5;
export const JANELA_DIAS = 7;
/** Obrigação atrasada olha no máximo um ano para trás (igual ao e-mail da agenda). */
export const ATRASO_MAX_DIAS = 365;

export const TITULOS: Record<ChaveBloco, string> = {
  agenda: 'Obrigações da agenda',
  documentos: 'Documentos enviados pelos clientes',
  pendencias: 'Pendências com prazo',
  contratos: 'Contratos de experiência',
  caixa: 'Livro Caixa a conferir',
};

export const HREF: Record<ChaveBloco, string> = {
  agenda: '/agenda',
  documentos: '/documentos',
  pendencias: '/documentos',
  contratos: '/contratos',
  caixa: '/caixa',
};

const porNome = (a: string, b: string) => a.localeCompare(b, 'pt-BR');

export function blocoVazio(chave: ChaveBloco, estado: EstadoBloco = 'ok'): Bloco {
  return { chave, titulo: TITULOS[chave], href: HREF[chave], estado, total: 0, atrasados: 0, proximos: 0, conferir: 0, itens: [] };
}

/** "3 dias de atraso", "vence hoje", "vence amanhã", "vence em 4 dias". */
export function rotuloDias(dias: number): string {
  if (dias < 0) return dias === -1 ? '1 dia de atraso' : `${-dias} dias de atraso`;
  if (dias === 0) return 'vence hoje';
  return dias === 1 ? 'vence amanhã' : `vence em ${dias} dias`;
}

// ------------------------------------------------------------------ agenda

/**
 * Obrigações ainda não feitas que estão atrasadas, vencem hoje ou caem na
 * janela (a maior entre a janela e o `avisoDias` da obrigação — como a agenda).
 * Mais atrasadas primeiro, depois as mais próximas.
 */
export function blocoAgenda(
  obrigacoes: Obrigacao[], conclusoes: Pick<Conclusao, 'obrigacaoId' | 'competencia'>[],
  nomes: Map<string, string>, hoje: string, cal = new Calendario(), limite = LIMITE_ITENS,
): Bloco {
  const feitas = new Set(conclusoes.map((c) => chaveConclusao(c.obrigacaoId, c.competencia)));
  const porId = new Map(obrigacoes.map((o) => [o.id, o]));
  const maior = Math.max(JANELA_DIAS, ...obrigacoes.map((o) => o.avisoDias));
  const pendentes = ocorrenciasDe(obrigacoes, somarDias(hoje, -ATRASO_MAX_DIAS), somarDias(hoje, maior), cal)
    .filter((oc) => !feitas.has(chaveConclusao(oc.obrigacaoId, oc.competencia)))
    .map((oc) => {
      const o = porId.get(oc.obrigacaoId)!;
      return { oc, o, sit: situacao(oc, hoje, false, o.avisoDias, JANELA_DIAS) };
    })
    .filter((x) => x.sit === 'atrasada' || x.sit === 'hoje' || x.sit === 'proxima');

  const itens: (ItemPainel & { dias: number })[] = pendentes.map(({ oc, o, sit }) => {
    const dias = diasEntre(hoje, oc.vencimento);
    return {
      id: `${oc.obrigacaoId}|${oc.competencia}`,
      titulo: o.nome,
      detalhe: oc.competencia === 'unica' ? undefined : `competência ${oc.competencia}`,
      empresa: nomes.get(oc.empresaId) ?? '—',
      quando: oc.vencimento,
      rotuloPrazo: rotuloDias(dias),
      tom: (sit === 'atrasada' ? 'perigo' : sit === 'hoje' ? 'aviso' : 'neutro') as TomItem,
      dias,
    };
  }).sort((a, b) => a.dias - b.dias || porNome(a.empresa, b.empresa) || porNome(a.titulo, b.titulo));

  const atrasados = itens.filter((i) => i.dias < 0).length;
  return {
    ...blocoVazio('agenda'), total: itens.length, atrasados, proximos: itens.length - atrasados,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    itens: itens.slice(0, limite).map(({ dias: _d, ...i }) => i),
  };
}

// -------------------------------------------------------------- documentos

export interface DocumentoParaPainel { empresaId: string; enviadoEm: string }

/** Aguardando conferência, agrupado por empresa: a que espera há mais tempo vem primeiro. */
export function blocoDocumentos(
  docs: DocumentoParaPainel[], nomes: Map<string, string>, hoje: string, limite = LIMITE_ITENS,
): Bloco {
  const grupos = new Map<string, { n: number; maisAntigo: string }>();
  for (const d of docs) {
    if (!nomes.has(d.empresaId)) continue;
    const g = grupos.get(d.empresaId);
    if (!g) grupos.set(d.empresaId, { n: 1, maisAntigo: d.enviadoEm });
    else { g.n++; if (d.enviadoEm < g.maisAntigo) g.maisAntigo = d.enviadoEm; }
  }
  const itens = [...grupos.entries()]
    .map(([empresaId, g]) => ({ empresaId, ...g, dias: Math.max(0, diasEntre(g.maisAntigo.slice(0, 10), hoje)) }))
    .sort((a, b) => b.dias - a.dias || b.n - a.n || porNome(nomes.get(a.empresaId)!, nomes.get(b.empresaId)!));
  const total = itens.reduce((s, g) => s + g.n, 0);
  return {
    ...blocoVazio('documentos'), total, conferir: total, empresasOcultas: Math.max(0, itens.length - limite),
    itens: itens.slice(0, limite).map((g) => ({
      id: g.empresaId,
      titulo: g.n === 1 ? '1 documento' : `${g.n} documentos`,
      empresa: nomes.get(g.empresaId)!,
      quando: g.maisAntigo.slice(0, 10),
      rotuloPrazo: g.dias === 0 ? 'enviado hoje' : g.dias === 1 ? 'o mais antigo, de ontem' : `o mais antigo, há ${g.dias} dias`,
      tom: g.dias >= 7 ? 'aviso' : 'neutro',
    })),
  };
}

// -------------------------------------------------------------- pendências

export interface PendenciaParaPainel {
  id: string; empresaId: string; titulo: string; prazo: string | null; status: string;
}

/** Pendências abertas com prazo vencido ou nos próximos dias (a regra de `situacaoPrazo`). */
export function blocoPendencias(
  lista: PendenciaParaPainel[], nomes: Map<string, string>, hoje: string, limite = LIMITE_ITENS,
): Bloco {
  const itens = lista
    .filter((p) => p.status === 'aberta' && nomes.has(p.empresaId) && p.prazo)
    .map((p) => ({ p, sit: situacaoPrazo(p.prazo, hoje), dias: diasEntre(hoje, p.prazo!) }))
    .filter((x) => x.sit === 'vencida' || x.sit === 'vence-logo')
    .sort((a, b) => a.dias - b.dias || porNome(nomes.get(a.p.empresaId)!, nomes.get(b.p.empresaId)!) || porNome(a.p.titulo, b.p.titulo));
  const atrasados = itens.filter((x) => x.sit === 'vencida').length;
  return {
    ...blocoVazio('pendencias'), total: itens.length, atrasados, proximos: itens.length - atrasados,
    itens: itens.slice(0, limite).map(({ p, sit, dias }) => ({
      id: p.id, titulo: p.titulo, empresa: nomes.get(p.empresaId)!, quando: p.prazo!,
      rotuloPrazo: rotuloDias(dias), tom: sit === 'vencida' ? 'perigo' : 'aviso',
    })),
  };
}

// --------------------------------------------------------------- contratos

/** Vem pronto de `alertasConsolidados` (já ordenado: vencidos primeiro). */
export function blocoContratos(alertas: AlertaConsolidado[], limite = LIMITE_ITENS): Bloco {
  const atrasados = alertas.filter((a) => a.tipo === 'vencido').length;
  return {
    ...blocoVazio('contratos'), total: alertas.length, atrasados, proximos: alertas.length - atrasados,
    itens: alertas.slice(0, limite).map((a) => ({
      id: a.id, titulo: a.nome, detalhe: a.marco, empresa: a.empresaNome, quando: a.data,
      rotuloPrazo: rotuloDias(a.dias), tom: a.tipo === 'vencido' ? 'perigo' : 'aviso',
    })),
  };
}

// ------------------------------------------------------------------- caixa

export interface LancamentoParaPainel { empresaId: string; criadoEm: string }

/** Lançamentos sem `conferido_em`, por empresa (mais numerosa primeiro). */
export function blocoCaixa(
  lancs: LancamentoParaPainel[], nomes: Map<string, string>, limite = LIMITE_ITENS,
): Bloco {
  const grupos = new Map<string, { n: number; ultimo: string }>();
  for (const l of lancs) {
    if (!nomes.has(l.empresaId)) continue;
    const g = grupos.get(l.empresaId);
    if (!g) grupos.set(l.empresaId, { n: 1, ultimo: l.criadoEm });
    else { g.n++; if (l.criadoEm > g.ultimo) g.ultimo = l.criadoEm; }
  }
  const itens = [...grupos.entries()].map(([empresaId, g]) => ({ empresaId, ...g }))
    .sort((a, b) => b.n - a.n || porNome(nomes.get(a.empresaId)!, nomes.get(b.empresaId)!));
  const total = itens.reduce((s, g) => s + g.n, 0);
  return {
    ...blocoVazio('caixa'), total, conferir: total, empresasOcultas: Math.max(0, itens.length - limite),
    itens: itens.slice(0, limite).map((g) => ({
      id: g.empresaId, titulo: g.n === 1 ? '1 lançamento' : `${g.n} lançamentos`,
      empresa: nomes.get(g.empresaId)!, quando: g.ultimo.slice(0, 10), rotuloPrazo: 'aguardando conferência', tom: 'neutro',
    })),
  };
}

// ------------------------------------------------------- isolamento e resumo

/** Erro que significa "tabela ainda não existe" (migração pendente) no PostgREST. */
export function ehTabelaAusente(e: unknown): boolean {
  const x = e as { code?: string; status?: number } | null;
  return x?.code === '42P01' || x?.code === 'PGRST205' || x?.status === 503;
}

/**
 * Roda a consulta de um bloco isolada: qualquer falha vira só aquele bloco
 * indisponível (`migracao` se a tabela não existe, `erro` no resto). O motivo
 * real vai para o log; a tela recebe texto genérico.
 */
export async function isolar(chave: ChaveBloco, consulta: () => Promise<Bloco>): Promise<Bloco> {
  try {
    return await consulta();
  } catch (e) {
    if (ehTabelaAusente(e)) return blocoVazio(chave, 'migracao');
    console.error(`[painel] bloco ${chave}:`, e instanceof Error ? e.message : e);
    return blocoVazio(chave, 'erro');
  }
}

export interface ResumoPainel {
  atrasadas: number;
  semana: number;
  conferir: number;
  /** Algum bloco não carregou — "tudo em dia" não pode ser afirmado. */
  incompleto: boolean;
  tudoEmDia: boolean;
}

/** Totais do topo. Só conta blocos que carregaram. */
export function resumir(blocos: Bloco[]): ResumoPainel {
  const ok = blocos.filter((b) => b.estado === 'ok');
  const atrasadas = ok.reduce((s, b) => s + b.atrasados, 0);
  const semana = ok.reduce((s, b) => s + b.proximos, 0);
  const conferir = ok.reduce((s, b) => s + b.conferir, 0);
  const incompleto = ok.length < blocos.length;
  return { atrasadas, semana, conferir, incompleto, tudoEmDia: !incompleto && atrasadas + semana + conferir === 0 };
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "3 coisas atrasadas, 5 para esta semana e 12 para conferir". */
export function fraseResumo(r: ResumoPainel): string {
  const partes: string[] = [];
  if (r.atrasadas) partes.push(`${plural(r.atrasadas, 'coisa atrasada', 'coisas atrasadas')}`);
  if (r.semana) partes.push(`${r.semana} para esta semana`);
  if (r.conferir) partes.push(`${r.conferir} para conferir`);
  if (!partes.length) return r.incompleto ? 'Nada urgente nos blocos que carregaram.' : 'Tudo em dia.';
  return partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}

/** Blocos com algo a mostrar primeiro (mais atrasados no topo); os vazios e os indisponíveis depois. */
export function ordenarBlocos(blocos: Bloco[]): Bloco[] {
  const rank = (b: Bloco) => (b.estado !== 'ok' ? 3 : b.total === 0 ? 2 : b.atrasados > 0 ? 0 : 1);
  return [...blocos].sort((a, b) => rank(a) - rank(b) || b.atrasados - a.atrasados || b.total - a.total);
}
