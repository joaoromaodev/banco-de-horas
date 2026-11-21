// Avisos ao cliente pelo sino (Sprint 13 · Frente A). Puro (sem I/O, testado em
// tests/avisosCliente.test.ts): monta os avisos da empresa-cliente a partir do que já
// existe — folha de ponto devolvida, pedido de documento novo e Demonstrativo do mês
// liberado. Nada é gravado em `notificacoes` (a contabilidade não passa a ver estes
// avisos). Leituras em lib/avisosClienteServidor.ts. Ver docs/notificacoes.md.
//
// Texto do aviso: SEM nome de funcionário nem dado pessoal. O motivo da devolução e o
// título do pedido são escritos pela contabilidade PARA o cliente e ele já os vê nas
// telas; aqui entram cortados.
import type { ItemNotificacao } from './notificacoes';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const mesAno = (ano: number, mes: number) => `${MESES[mes - 1] ?? mes}/${ano}`;
const cortar = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const iso = (v: string) => new Date(v).toISOString();
const valida = (v: string | null | undefined): v is string => !!v && !Number.isNaN(Date.parse(v));

export const MAX_MOTIVO = 160;
export const MAX_TITULO_PEDIDO = 120;

// ------------------------------------------------------------------ folha devolvida

/**
 * Mesmo corte da tela `/enviar-ponto` (desdeTrezeMeses em app/api/envio-ponto/route.ts):
 * os últimos 13 meses. Folha mais antiga não avisa — o link levaria a uma tela que não a mostra.
 */
export function desdeTrezeMeses(hoje: string): { ano: number; mes: number } {
  let a = Number(hoje.slice(0, 4));
  let m = Number(hoje.slice(5, 7)) - 13;
  while (m < 1) { m += 12; a -= 1; }
  return { ano: a, mes: m };
}

/** Envio do ponto, só com o que o aviso usa. `funcionario` serve só para saber se já foi reenviado: NÃO vai ao texto. */
export interface EnvioParaAviso {
  id: string;
  funcionario: string;
  ano: number;
  mes: number;
  situacao: string;
  motivo: string | null;
  devolvidoEm: string | null;
}

/**
 * Folhas devolvidas pela contadora e ainda não reenviadas (mesmo funcionário e mês).
 * Um aviso por envio; a chave leva o instante da devolução (desfazer e devolver de novo
 * volta a ser não lida).
 */
export function avisosFolhaDevolvida(envios: EnvioParaAviso[]): ItemNotificacao[] {
  const chave = (e: EnvioParaAviso) => `${e.funcionario.trim().toLowerCase()}|${e.ano}|${e.mes}`;
  const reenviadas = new Set(envios.filter((e) => e.situacao !== 'devolvida' && e.situacao !== 'rejeitada').map(chave));
  return envios
    .filter((e) => e.situacao === 'devolvida' && valida(e.devolvidoEm) && !reenviadas.has(chave(e)))
    .map((e) => {
      const motivo = e.motivo ? cortar(e.motivo, MAX_MOTIVO) : '';
      return {
        chave: `cli|folha|${e.id}|${iso(e.devolvidoEm!)}`, tipo: 'folha_devolvida' as const,
        titulo: 'Folha de ponto devolvida pela contabilidade',
        texto: `${mesAno(e.ano, e.mes)} · ${motivo ? `Motivo: ${motivo}` : 'A contabilidade pediu uma nova foto.'}`,
        href: '/enviar-ponto', quando: iso(e.devolvidoEm!),
      };
    });
}

// ------------------------------------------------------------------ pedido de documento

export interface PedidoParaAviso { id: string; titulo: string; prazo: string | null; status: string; criadoEm: string }

/** Pedidos (pendências) da contabilidade ainda abertos. Um aviso por pedido, na data em que foi feito. */
export function avisosPedido(pedidos: PedidoParaAviso[]): ItemNotificacao[] {
  return pedidos
    .filter((p) => p.status === 'aberta' && valida(p.criadoEm))
    .map((p) => ({
      chave: `cli|pedido|${p.id}`, tipo: 'pedido' as const,
      titulo: 'A contabilidade pediu um documento',
      texto: `${cortar(p.titulo, MAX_TITULO_PEDIDO)} · ${p.prazo && /^\d{4}-\d{2}-\d{2}/.test(p.prazo) ? `Prazo: ${dataBR(p.prazo)}` : 'Sem prazo'}`,
      href: '/documentos', quando: iso(p.criadoEm),
    }));
}

// ------------------------------------------------------------------ demonstrativo

export interface MesConfirmado { mes: number; confirmadoEm: string }

/**
 * Demonstrativo liberado: o cliente vê de janeiro até o último mês confirmado em
 * sequência (lib/demonstrativo.ts → liberadoAte). O mês M fica pronto quando o último
 * de 1..M é confirmado: `quando(M) = max(confirmado_em[1..M])`. Meses liberados no mesmo
 * instante (ex.: confirmar janeiro depois de fevereiro e março) viram UM aviso, do mês
 * mais alto — não chove aviso por mês.
 */
export function avisosDemonstrativo(ano: number, meses: MesConfirmado[]): ItemNotificacao[] {
  const em = new Map<number, string>();
  for (const m of meses) if (m.mes >= 1 && m.mes <= 12 && valida(m.confirmadoEm)) em.set(m.mes, iso(m.confirmadoEm));
  const quando: string[] = [];
  for (let m = 1; m <= 12 && em.has(m); m++) {
    const q = em.get(m)!;
    quando.push(m === 1 || q > quando[m - 2] ? q : quando[m - 2]);
  }
  const itens: ItemNotificacao[] = [];
  quando.forEach((q, i) => {
    const mes = i + 1;
    if (i + 1 < quando.length && quando[i + 1] === q) return; // liberado junto com o seguinte: avisa só o mais alto
    itens.push({
      chave: `cli|demo|${ano}|${mes}|${q}`, tipo: 'demonstrativo',
      titulo: 'Demonstrativo de caixa pronto',
      texto: `${mesAno(ano, mes)} · confirmado pela contabilidade.`,
      href: `/caixa/demonstrativo?ano=${ano}&mes=${mes}`, quando: q,
    });
  });
  return itens;
}
