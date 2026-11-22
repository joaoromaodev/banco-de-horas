// Notificações dentro do app (o sino do topo). Puro (sem I/O, testado em
// tests/notificacoes.test.ts): monta a lista a partir do que já existe — documentos
// enviados, pendências atendidas, lançamentos do caixa a conferir, alertas novos da
// conferência entre módulos — e de eventos que outras frentes publicam
// (`registrarNotificacao`, em lib/notificacoesServidor.ts). Ver docs/notificacoes.md.
import type { AchadoConferencia } from './conferenciaModulos';

export type TipoNotificacao = 'documento' | 'pendencia' | 'caixa' | 'conferencia' | 'evento'
  // Avisos ao cliente (lib/avisosCliente.ts): só o papel `cliente` recebe.
  | 'folha_devolvida' | 'pedido' | 'demonstrativo' | 'aceite_ponto';

export interface Notificacao {
  /** Estável: identifica o item para "marcar como lida". Muda quando chega algo novo do mesmo tipo. */
  chave: string;
  tipo: TipoNotificacao;
  titulo: string;
  texto?: string;
  empresa?: string;
  /** Caminho interno do app. */
  href: string;
  /** Quando aconteceu (ISO). */
  quando: string;
  lida: boolean;
}

export type ItemNotificacao = Omit<Notificacao, 'lida'>;

/** O sino lembra dos últimos N dias (o que é mais velho já deu tempo de ver). */
export const JANELA_DIAS = 14;
export const MAX_ITENS = 30;
/** Marca "já existia antes do sino": o alerta da conferência vira velho e não avisa. */
export const EPOCA = '1970-01-01T00:00:00.000Z';

export const desdeDaJanela = (agora: Date = new Date()): string =>
  new Date(agora.getTime() - JANELA_DIAS * 86_400_000).toISOString();

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

// ------------------------------------------------------------------ derivadas

export interface DocumentoNovo { empresaId: string; enviadoEm: string }

/** Documentos recebidos e ainda não conferidos, por empresa. A chave leva o envio mais recente: chegou outro → volta a ser não lida. */
export function notifDocumentos(docs: DocumentoNovo[], nomes: ReadonlyMap<string, string>): ItemNotificacao[] {
  const g = new Map<string, { n: number; ultimo: string }>();
  for (const d of docs) {
    if (!nomes.has(d.empresaId)) continue;
    const a = g.get(d.empresaId);
    if (!a) g.set(d.empresaId, { n: 1, ultimo: d.enviadoEm });
    else { a.n++; if (d.enviadoEm > a.ultimo) a.ultimo = d.enviadoEm; }
  }
  return [...g.entries()].map(([empresaId, a]) => ({
    chave: `doc|${empresaId}|${a.ultimo}`, tipo: 'documento' as const, empresa: nomes.get(empresaId),
    titulo: a.n === 1 ? 'Documento novo enviado pelo cliente' : `${a.n} documentos novos enviados pelo cliente`,
    texto: 'Aguardando conferência.', href: '/documentos', quando: a.ultimo,
  }));
}

export interface PendenciaAtendida { id: string; empresaId: string; titulo: string; atendidaEm: string; atendidaPor: string | null }

/** Pendências que o cliente atendeu. O que o próprio usuário fechou à mão não é novidade. */
export function notifPendencias(lista: PendenciaAtendida[], nomes: ReadonlyMap<string, string>, usuario: string): ItemNotificacao[] {
  return lista
    .filter((p) => nomes.has(p.empresaId) && (p.atendidaPor ?? '').toLowerCase() !== usuario.toLowerCase())
    .map((p) => ({
      chave: `pend|${p.id}|${p.atendidaEm}`, tipo: 'pendencia' as const, empresa: nomes.get(p.empresaId),
      titulo: 'Pedido atendido pelo cliente', texto: p.titulo, href: '/documentos', quando: p.atendidaEm,
    }));
}

export interface LancamentoNovo { empresaId: string; criadoEm: string; criadoPor: string | null }

/** Lançamentos sem conferência, por empresa (o que o próprio usuário lançou não conta). */
export function notifCaixa(lancs: LancamentoNovo[], nomes: ReadonlyMap<string, string>, usuario: string): ItemNotificacao[] {
  const g = new Map<string, { n: number; ultimo: string }>();
  for (const l of lancs) {
    if (!nomes.has(l.empresaId) || (l.criadoPor ?? '').toLowerCase() === usuario.toLowerCase()) continue;
    const a = g.get(l.empresaId);
    if (!a) g.set(l.empresaId, { n: 1, ultimo: l.criadoEm });
    else { a.n++; if (l.criadoEm > a.ultimo) a.ultimo = l.criadoEm; }
  }
  return [...g.entries()].map(([empresaId, a]) => ({
    chave: `cx|${empresaId}|${a.ultimo}`, tipo: 'caixa' as const, empresa: nomes.get(empresaId),
    titulo: a.n === 1 ? 'Lançamento novo do cliente' : `${a.n} lançamentos novos do cliente`,
    texto: 'Aguardando conferência no Livro Caixa.', href: '/caixa', quando: a.ultimo,
  }));
}

/** Linha de `notificacoes` (eventos publicados e primeira vista de alertas). */
export interface RegistroNotificacao {
  chave: string | null; tipo: string; titulo: string; texto: string | null; href: string | null;
  empresaId: string | null; criadoEm: string;
}

/** Eventos genéricos (outras frentes). Href fora do app é descartado. */
export function notifEventos(regs: RegistroNotificacao[], nomes: ReadonlyMap<string, string>): ItemNotificacao[] {
  return regs
    .filter((r) => r.tipo !== 'conferencia' && (!r.empresaId || nomes.has(r.empresaId)))
    .map((r) => ({
      chave: `ev|${r.chave ?? r.criadoEm}|${r.empresaId ?? ''}`, tipo: 'evento' as const,
      empresa: r.empresaId ? nomes.get(r.empresaId) : undefined,
      titulo: r.titulo, texto: r.texto ?? undefined, href: hrefInterno(r.href), quando: r.criadoEm,
    }));
}

/** Só caminho interno ("/x"); qualquer outra coisa vira o painel. */
export function hrefInterno(href: string | null | undefined): string {
  return href && /^\/(?!\/)/.test(href) && href.length <= 300 ? href : '/painel';
}

/**
 * Alertas da conferência entre módulos que estão ATIVOS agora, com o instante em que
 * foram vistos pela primeira vez (`vistos`: chave do achado → ISO). Achado sem registro
 * ainda não foi visto: o servidor grava agora e ele entra como novo.
 */
export function notifConferencia(
  achados: AchadoConferencia[], vistos: ReadonlyMap<string, string>, agora: string,
): ItemNotificacao[] {
  return achados.map((a) => ({
    chave: `conf|${a.chave}`, tipo: 'conferencia' as const, empresa: a.empresaNome,
    titulo: a.titulo, texto: a.empregado ? `${a.empregado}: ${a.texto}` : a.texto, href: a.href,
    quando: vistos.get(`conf|${a.chave}`) ?? agora,
  }));
}

// ------------------------------------------------------------------ montagem

export interface Leitura {
  /** Tudo até aqui já foi visto (null = primeira visita: o servidor grava `agora`). */
  lidasAte: string | null;
  /** Chaves marcadas como lidas depois disso. */
  lidas: string[];
}

export interface ListaNotificacoes {
  itens: Notificacao[];
  naoLidas: number;
}

/**
 * Junta tudo, mantém só a janela, ordena do mais novo e marca o que já foi lido: lido =
 * aconteceu até `lidasAte` OU a chave foi marcada. Primeira visita (`lidasAte` nulo):
 * nada é "não lido" — o sino começa limpo.
 */
export function montarNotificacoes(
  itens: ItemNotificacao[], leitura: Leitura, agora: Date = new Date(), max = MAX_ITENS,
): ListaNotificacoes {
  const desde = desdeDaJanela(agora);
  const marcadas = new Set(leitura.lidas);
  const lista = itens
    .filter((i) => i.quando >= desde)
    .sort((a, b) => b.quando.localeCompare(a.quando) || a.chave.localeCompare(b.chave))
    .map((i): Notificacao => ({ ...i, lida: leitura.lidasAte === null || i.quando <= leitura.lidasAte || marcadas.has(i.chave) }));
  return { itens: lista.slice(0, max), naoLidas: lista.filter((i) => !i.lida).length };
}

/** "3 novidades", "1 novidade", "Nada novo". */
export const rotuloSino = (naoLidas: number): string =>
  naoLidas ? `${plural(naoLidas, 'novidade', 'novidades')} não ${naoLidas === 1 ? 'lida' : 'lidas'}` : 'Notificações';

/** Quanto tempo atrás, em português ("agora", "há 5 min", "há 2 h", "ontem", "há 3 dias"). */
export function quandoRelativo(iso: string, agora: Date = new Date()): string {
  const ms = agora.getTime() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}
