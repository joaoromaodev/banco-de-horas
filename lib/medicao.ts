// Medição própria (Sprint 15, frente A) — regras puras, usadas no navegador e no servidor.
//
// O que se mede: o tempo das chamadas a `/api/*` (método, rota, status, ms), o
// carregamento das telas (LCP, TTFB, INP) e as visitas por tela, numa AMOSTRA de
// `TAXA_AMOSTRA` das cargas de página — os erros entram sempre.
//
// NADA DE DADO PESSOAL. A rota é a única coisa "livre" que sai do navegador e,
// antes de sair, passa por `normalizarRota`: sem query string, sem âncora, e
// qualquer trecho que não seja um nome fixo de rota (uuid, número, data, e-mail,
// CPF, texto com dígito ou maiúscula) vira placeholder. No servidor a rota ainda
// precisa constar da lista fechada de rotas do app (lib/medicaoRotas.ts) — o que
// não consta vira `/[outra]`. Não se grava id, e-mail, nome, escritório, empresa,
// corpo nem mensagem de erro: só o papel da sessão e um código de erro curto.

/** Fração das cargas de página que entram na amostra (os erros entram sempre). */
export const TAXA_AMOSTRA = 0.25;

/** Métricas de navegador gravadas. `VISITA` é uma abertura de tela (sem ms). */
export const METRICAS = ['LCP', 'TTFB', 'INP', 'VISITA'] as const;
export type Metrica = (typeof METRICAS)[number];

export const METODOS_HTTP = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type MetodoHttp = (typeof METODOS_HTTP)[number];

export const TIPOS = ['api', 'pagina', 'erro'] as const;
/** `api` = chamada a /api vista do navegador; `pagina` = web vital ou visita; `erro` = exceção no servidor. */
export type TipoMedicao = (typeof TIPOS)[number];

/** Teto de uma medição em ms (2 min): acima disso é relógio errado, não lentidão. */
export const MS_MAX = 120_000;
/** Rota de destino dos envios do navegador (nunca se mede a si mesma). */
export const ROTA_ENVIO = '/api/medicao';
/** Telas sem sessão (site e login): o navegador não envia nada delas. */
export const TELAS_PUBLICAS: readonly string[] = ['/login', '/criar-conta', '/conheca', '/planos', '/termos', '/privacidade'];

/** O item que o navegador envia (o servidor revalida tudo; ver `validarItem`). */
export interface ItemMedicao {
  tipo: 'api' | 'pagina';
  rota: string;
  metodo?: MetodoHttp;
  status?: number;
  ms?: number;
  metrica?: Metrica;
  /** `rede` quando a chamada nem chegou ao servidor. */
  erro?: string;
  /** Esta carga de página estava na amostra? (erros fora da amostra também chegam). */
  amostra: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATA = /^\d{4}-\d{2}(-\d{2})?$|^\d{2}[-.]\d{2}[-.]\d{4}$/;
/** Nome fixo de rota: minúsculas e hífen, sem dígito (ex.: `envio-ponto`, `folha-lote`). */
const SEGMENTO_FIXO = /^[a-z]+(-[a-z]+)*$/;
const SEGMENTO_MAX = 40;

/**
 * Rota sem nada que identifique alguém: tira query e âncora, e troca todo trecho
 * que não é nome fixo por placeholder — uuid e número viram `[id]`, data vira
 * `[data]`, o resto (e-mail, CPF formatado, nome com maiúscula, codificado) vira `[id]`.
 */
export function normalizarRota(caminho: string): string {
  let p = String(caminho ?? '');
  // URL absoluta: só o caminho.
  const m = p.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*(.*)$/i);
  if (m) p = m[1];
  p = p.split(/[?#]/, 1)[0];
  const segs = p.split('/').filter(Boolean).map((s) => {
    if (UUID.test(s)) return '[id]';
    if (DATA.test(s)) return '[data]';
    if (s.length <= SEGMENTO_MAX && SEGMENTO_FIXO.test(s)) return s;
    return '[id]';
  });
  return '/' + segs.slice(0, 8).join('/');
}

/** Chamada à API do próprio app que vale medir (o envio da medição não conta). */
export function ehRotaDaApi(caminho: string): boolean {
  return caminho.startsWith('/api/') && caminho !== ROTA_ENVIO && !caminho.startsWith(ROTA_ENVIO + '/');
}

/** Status que sempre entra (fora da amostra): resposta de erro ou falha de rede (0). */
export function ehErro(status: number | undefined, erro?: string): boolean {
  return Boolean(erro) || (typeof status === 'number' && (status === 0 || status >= 400));
}

/**
 * Código de erro curto e seguro (nome da classe e/ou código do banco), nunca a
 * mensagem: `TypeError`, `Error:23505`, `PGRST116`. O que não casa vira `Erro`.
 */
export function codigoDoErro(e: unknown): string {
  const nome = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : '';
  const cod = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
  const limpo = (s: string) => (/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(s) ? s : '');
  const n = limpo(nome) || 'Erro';
  const c = /^[A-Za-z0-9_]{1,12}$/.test(cod) ? cod : '';
  return c ? `${n}:${c}` : n;
}

/** Erro já no formato gravável (o que `codigoDoErro` produz, ou `rede`). */
export const ERRO_VALIDO = /^[A-Za-z][A-Za-z0-9_]{0,39}(:[A-Za-z0-9_]{1,12})?$/;

/**
 * Revalida no servidor o que veio do navegador: tipos, faixas e a rota de novo
 * normalizada. Devolve `null` para item inválido (descartado em silêncio — é medição).
 */
export function validarItem(x: unknown): ItemMedicao | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (o.tipo !== 'api' && o.tipo !== 'pagina') return null;
  if (typeof o.rota !== 'string' || o.rota.length > 300) return null;
  const rota = normalizarRota(o.rota);
  const amostra = o.amostra === true;
  const ms = typeof o.ms === 'number' && Number.isFinite(o.ms) && o.ms >= 0 && o.ms <= MS_MAX ? Math.round(o.ms) : undefined;
  // Do navegador só vem `rede` (falha antes de chegar ao servidor): nenhum texto livre entra.
  const erro = o.erro === 'rede' ? 'rede' : undefined;
  if (o.tipo === 'api') {
    if (!rota.startsWith('/api/')) return null;
    const metodo = METODOS_HTTP.find((m) => m === o.metodo);
    if (!metodo) return null;
    const status = typeof o.status === 'number' && Number.isInteger(o.status) && o.status >= 0 && o.status <= 599 ? o.status : undefined;
    if (status === undefined) return null;
    // Fora da amostra, só erro entra.
    if (!amostra && !ehErro(status, erro)) return null;
    return { tipo: 'api', rota, metodo, status, ms, erro, amostra };
  }
  if (rota.startsWith('/api')) return null;
  const metrica = METRICAS.find((m) => m === o.metrica);
  if (!metrica || !amostra) return null;
  if (metrica !== 'VISITA' && ms === undefined) return null;
  return { tipo: 'pagina', rota, metrica, ms: metrica === 'VISITA' ? undefined : ms, amostra };
}

// ------------------------------------------------------------------ resumo (master)

/** Linha como sai da tabela `medicoes`. */
export interface LinhaMedicao {
  tipo: TipoMedicao;
  rota: string;
  metodo: string | null;
  status: number | null;
  ms: number | null;
  metrica: string | null;
  erro: string | null;
  taxa: number;
  amostra: boolean;
}

/** Percentil por posição (nearest-rank) de uma lista já ordenada. */
export function percentil(ordenados: number[], p: number): number {
  if (!ordenados.length) return 0;
  const i = Math.min(ordenados.length - 1, Math.max(0, Math.ceil((p / 100) * ordenados.length) - 1));
  return ordenados[i];
}

export interface Lenta { rota: string; metodo?: string; n: number; p50: number; p95: number }
export interface ErroFrequente { tipo: TipoMedicao; rota: string; metodo?: string; codigo: string; n: number }
export interface VolumeTela { rota: string; visitas: number }
export interface PaginaLenta extends Lenta { ttfbP50: number | null; inpP95: number | null }

export interface ResumoMedicao {
  rotasLentas: Lenta[];
  paginasLentas: PaginaLenta[];
  erros: ErroFrequente[];
  volume: VolumeTela[];
  /** Linhas lidas (amostra + erros). */
  linhas: number;
}

const ordenar = (v: number[]) => [...v].sort((a, b) => a - b);

/** Agrega as linhas dos últimos dias para a seção do master. Função pura. */
export function resumirMedicoes(linhas: LinhaMedicao[], limite = 10): ResumoMedicao {
  const api = new Map<string, { rota: string; metodo: string; ms: number[] }>();
  const pag = new Map<string, Record<string, number[]>>();
  const erros = new Map<string, ErroFrequente>();
  const volume = new Map<string, number>();

  for (const l of linhas) {
    const codigo = l.erro ?? (l.status !== null && l.status >= 400 ? String(l.status) : null);
    if (codigo) {
      const k = `${l.tipo}|${l.metodo ?? ''}|${l.rota}|${codigo}`;
      const e = erros.get(k) ?? { tipo: l.tipo, rota: l.rota, metodo: l.metodo ?? undefined, codigo, n: 0 };
      e.n += 1;
      erros.set(k, e);
    }
    if (!l.amostra) continue;
    if (l.tipo === 'api' && l.ms !== null && l.metodo) {
      const k = `${l.metodo} ${l.rota}`;
      const a = api.get(k) ?? { rota: l.rota, metodo: l.metodo, ms: [] };
      a.ms.push(l.ms);
      api.set(k, a);
    } else if (l.tipo === 'pagina' && l.metrica) {
      if (l.metrica === 'VISITA') {
        volume.set(l.rota, (volume.get(l.rota) ?? 0) + 1 / (l.taxa > 0 ? l.taxa : 1));
      } else if (l.ms !== null) {
        const p = pag.get(l.rota) ?? {};
        (p[l.metrica] ??= []).push(l.ms);
        pag.set(l.rota, p);
      }
    }
  }

  const rotasLentas = [...api.values()].map((a) => {
    const o = ordenar(a.ms);
    return { rota: a.rota, metodo: a.metodo, n: o.length, p50: percentil(o, 50), p95: percentil(o, 95) };
  }).sort((x, y) => y.p95 - x.p95 || y.p50 - x.p50).slice(0, limite);

  const paginasLentas = [...pag.entries()].map(([rota, m]) => {
    const base = ordenar(m.LCP ?? m.TTFB ?? []);
    const ttfb = m.TTFB ? ordenar(m.TTFB) : null;
    const inp = m.INP ? ordenar(m.INP) : null;
    return {
      rota, n: base.length, p50: percentil(base, 50), p95: percentil(base, 95),
      ttfbP50: ttfb ? percentil(ttfb, 50) : null, inpP95: inp ? percentil(inp, 95) : null,
    };
  }).filter((p) => p.n > 0).sort((x, y) => y.p95 - x.p95 || y.p50 - x.p50).slice(0, limite);

  return {
    rotasLentas,
    paginasLentas,
    erros: [...erros.values()].sort((a, b) => b.n - a.n).slice(0, limite),
    volume: [...volume.entries()].map(([rota, v]) => ({ rota, visitas: Math.round(v) })).sort((a, b) => b.visitas - a.visitas),
    linhas: linhas.length,
  };
}
