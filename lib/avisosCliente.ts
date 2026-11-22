// Avisos ao cliente pelo sino (Sprint 13 · Frente A). Puro (sem I/O, testado em
// tests/avisosCliente.test.ts): monta os avisos da empresa-cliente a partir do que já
// existe — folha de ponto devolvida, pedido de documento novo e Demonstrativo do mês
// liberado. Nada é gravado em `notificacoes` (a contabilidade não passa a ver estes
// avisos). Leituras em lib/avisosClienteServidor.ts. Ver docs/notificacoes.md.
//
// Texto do aviso: SEM nome de funcionário nem dado pessoal. O título do pedido é escrito
// pela contabilidade PARA o cliente e entra cortado. O MOTIVO de uma devolução (folha ou
// documento) não entra (Sprint 18 · A): fica nas telas.
import type { ItemNotificacao } from './notificacoes';
import { competenciaBR, DIAS_LEMBRETE, diasAte, ROTULO_CATEGORIA, type Categoria } from './documentos';
import { ROTULO_TIPO_ENTREGA, type TipoEntrega } from './entregas';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const mesAno = (ano: number, mes: number) => `${MESES[mes - 1] ?? mes}/${ano}`;
const cortar = (s: string, n: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const iso = (v: string) => new Date(v).toISOString();
const valida = (v: string | null | undefined): v is string => !!v && !Number.isNaN(Date.parse(v));

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
    // Sem o motivo (Sprint 18 · A, como o documento devolvido — revisão do Escudo): é texto
    // livre da contadora e pode citar o funcionário ("a folha da Maria está cortada"). Ele
    // continua em /enviar-ponto e no /inicio, dentro do app.
    .map((e) => ({
      chave: `cli|folha|${e.id}|${iso(e.devolvidoEm!)}`, tipo: 'folha_devolvida' as const,
      titulo: 'Folha de ponto devolvida pela contabilidade',
      texto: `${mesAno(e.ano, e.mes)} · Veja o motivo em Folha de ponto e envie uma nova foto.`,
      href: '/enviar-ponto', quando: iso(e.devolvidoEm!),
    }));
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

// ------------------------------------------------------------------ lembrete do prazo (0032)

/** Meia-noite de Belém (UTC−3) do dia `DIAS_LEMBRETE` antes de `data`, em ISO. */
function inicioDoLembrete(data: string): string {
  const t = Date.parse(`${data.slice(0, 10)}T03:00:00.000Z`) - DIAS_LEMBRETE * 86_400_000;
  return new Date(t).toISOString();
}
const maisTarde = (a: string, b: string) => (a > b ? a : b);

/**
 * Lembrete ANTES do prazo: pedido ainda aberto que vence de hoje a `DIAS_LEMBRETE`
 * dias (`hoje` = AAAA-MM-DD de Belém). Um aviso por pedido e prazo (mudou o prazo →
 * lembrete novo), datado do começo da janela — ou da criação, se foi pedido já em cima.
 * Vencido não lembra mais (o "pediu" e a tela já mostram o atraso).
 */
export function avisosLembretePedido(pedidos: PedidoParaAviso[], hoje: string): ItemNotificacao[] {
  return pedidos
    .filter((p) => p.status === 'aberta' && valida(p.criadoEm))
    .flatMap((p) => {
      const dias = diasAte(p.prazo, hoje);
      if (dias === null || dias < 0 || dias > DIAS_LEMBRETE) return [];
      const prazo = p.prazo!.slice(0, 10);
      return [{
        chave: `cli|lembrete|${p.id}|${prazo}`, tipo: 'lembrete' as const,
        titulo: dias === 0 ? 'Um pedido da contabilidade vence hoje' : `Um pedido da contabilidade vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}`,
        texto: `${cortar(p.titulo, MAX_TITULO_PEDIDO)} · Prazo: ${dataBR(prazo)}`,
        href: '/documentos', quando: maisTarde(inicioDoLembrete(prazo), iso(p.criadoEm)),
      }];
    });
}

// ------------------------------------------------------------------ entregas (0032)

/**
 * Só o que o sino pode dizer de uma entrega: tipo, competência, vencimento e se já foi
 * aberta. O TÍTULO e o nome do arquivo ficam de fora de propósito (a contadora pode
 * escrever "Holerite da Maria"): o sino não leva dado pessoal.
 */
export interface EntregaParaAviso {
  id: string; tipo: TipoEntrega; competencia: string; vencimento: string | null;
  publicadoEm: string; abertoEm: string | null;
}

const textoEntrega = (e: EntregaParaAviso) =>
  `${ROTULO_TIPO_ENTREGA[e.tipo] ?? 'Documento'} · ${competenciaBR(e.competencia)}${e.vencimento ? ` · Vence em ${dataBR(e.vencimento)}` : ''}`;

/**
 * Documento novo da contabilidade, ainda não aberto pelo cliente (aberto, some — como
 * o pedido atendido), e o lembrete quando ele vence em até `DIAS_LEMBRETE` dias.
 */
export function avisosEntrega(entregas: EntregaParaAviso[], hoje: string): ItemNotificacao[] {
  const itens: ItemNotificacao[] = [];
  for (const e of entregas) {
    if (e.abertoEm || !valida(e.publicadoEm)) continue;
    itens.push({
      chave: `cli|entrega|${e.id}`, tipo: 'entrega', titulo: 'A contabilidade enviou um documento para você',
      texto: textoEntrega(e), href: '/documentos', quando: iso(e.publicadoEm),
    });
    const dias = diasAte(e.vencimento, hoje);
    if (dias !== null && dias >= 0 && dias <= DIAS_LEMBRETE) {
      itens.push({
        chave: `cli|entrega-vence|${e.id}|${e.vencimento}`, tipo: 'lembrete',
        titulo: dias === 0 ? 'Documento da contabilidade vence hoje' : `Documento da contabilidade vence em ${dias} ${dias === 1 ? 'dia' : 'dias'}`,
        texto: `${textoEntrega(e)} · Ainda não aberto`, href: '/documentos',
        quando: maisTarde(inicioDoLembrete(e.vencimento!), iso(e.publicadoEm)),
      });
    }
  }
  return itens;
}

// ------------------------------------------------------------------ documento devolvido (0032)

/**
 * Documento enviado pelo cliente e devolvido pela contabilidade (já filtrado pelos que
 * ainda não foram reenviados — `devolvidosSemReenvio`). Nem o nome do arquivo nem o
 * MOTIVO vão para o sino: os dois são texto livre e podem trazer nome de pessoa
 * ("holerite da Maria ilegível"). O motivo fica na tela de Documentos e no `/inicio`.
 */
export interface DevolvidoParaAviso { id: string; categoria: Categoria; competencia: string; devolvidoEm: string | null }

export function avisosDocumentoDevolvido(docs: DevolvidoParaAviso[]): ItemNotificacao[] {
  return docs
    .filter((d) => valida(d.devolvidoEm))
    .map((d) => ({
      chave: `cli|docdev|${d.id}|${iso(d.devolvidoEm!)}`, tipo: 'documento_devolvido' as const,
      titulo: 'Documento devolvido pela contabilidade',
      texto: `${ROTULO_CATEGORIA[d.categoria] ?? 'Documento'} · ${competenciaBR(d.competencia)} · Veja o motivo em Documentos.`,
      href: '/documentos', quando: iso(d.devolvidoEm!),
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
