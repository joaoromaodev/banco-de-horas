// Página inicial do cliente (empresa): regras puras de montagem, sem I/O.
// A leitura do banco está em lib/inicioClienteServidor.ts. Ver docs/portal-cliente.md.
//
// Princípio: a tela só mostra o que pede ação do cliente. Cada fonte chega como
// `Fonte<T>`; se uma falhar, só o bloco dela some (vira "indisponível") e o resto
// segue. Nada aqui chama banco, relógio ou rede: `hoje` entra por parâmetro.
import { competenciaBR, competenciaPadrao, DIAS_LEMBRETE, diasAte, ROTULO_CATEGORIA, type Categoria } from './documentos';
import { nomeEntrega, ordenarEntregas, type TipoEntrega } from './entregas';

export type Fonte<T> = { ok: true; dados: T } | { ok: false };

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const nomeMes = (ano: number, mes: number) => `${MESES[mes - 1]} de ${ano}`;
const nomeMesCurto = (mes: number) => MESES[mes - 1];

/** Máximo de itens listados por bloco (o resto vira "e mais N"). */
export const MAX_ITENS_BLOCO = 5;

export interface MesDoMovimento { ano: number; mes: number; lancamentos: number; confirmado: boolean }
export interface PendenciaAberta { id: string; titulo: string; prazo: string | null }
export interface FolhaDevolvida { id: string; funcionario: string; ano: number; mes: number; motivo: string | null }
export interface DemonstrativoDisponivel { ano: number; mes: number }
/** Documento que a contabilidade publicou e o cliente ainda não abriu (0032). */
export interface EntregaInicio {
  id: string; tipo: TipoEntrega; titulo: string | null; competencia: string; vencimento: string | null;
  publicadoEm: string; abertoEm: string | null;
}
/** Documento do cliente devolvido pela contabilidade e ainda não reenviado (0032). */
export interface DevolvidoInicio { id: string; nome: string; categoria: Categoria; competencia: string; motivo: string | null }

export interface EntradaInicio {
  hoje: string; // AAAA-MM-DD
  empresaNome: string;
  /** Mês corrente e anterior (a regra completa o que faltar). */
  movimento: Fonte<MesDoMovimento[]>;
  pendencias: Fonte<PendenciaAberta[]>;
  folhasDevolvidas: Fonte<FolhaDevolvida[]>;
  demonstrativo: Fonte<DemonstrativoDisponivel | null>;
  /** Opcionais (0032): sem elas, os blocos simplesmente não aparecem. */
  entregas?: Fonte<EntregaInicio[]>;
  devolvidos?: Fonte<DevolvidoInicio[]>;
}

/** `logo` = vence em até `DIAS_LEMBRETE` dias (o lembrete antes do prazo). */
export interface ItemBloco {
  chave: string; texto: string; detalhe?: string; urgencia?: 'atrasada' | 'hoje' | 'logo' | 'proxima';
  /** Link do próprio item (ex.: baixar o documento da contabilidade). */
  href?: string;
}
export interface Bloco {
  id: 'movimento' | 'pendencias' | 'devolvidos' | 'entregas' | 'folhas' | 'demonstrativo';
  titulo: string;
  itens: ItemBloco[];
  /** Quantos itens ficaram de fora do limite. */
  alemDoLimite: number;
  acao: { rotulo: string; href: string };
  /** Só o demonstrativo é informativo: não conta como pendência do cliente. */
  pedeAcao: boolean;
}
export interface InicioCliente {
  saudacao: string;
  blocos: Bloco[];
  /** Fontes que falharam (a tela avisa em uma linha, sem derrubar o resto). */
  indisponiveis: Bloco['id'][];
  /** Nada pede ação do cliente (e nenhuma fonte falhou): estado caloroso. */
  tudoEmDia: boolean;
}

/** "Bom dia" / "Boa tarde" / "Boa noite" pela hora local (0–23). */
export function saudacaoDaHora(hora: number): string {
  if (hora >= 5 && hora < 12) return 'Bom dia';
  if (hora >= 12 && hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

/** Compara datas AAAA-MM-DD (aceita ISO com hora: usa só os 10 primeiros). */
export function urgenciaDoPrazo(prazo: string | null, hoje: string): ItemBloco['urgencia'] | undefined {
  if (!prazo) return undefined;
  const p = prazo.slice(0, 10);
  if (p < hoje) return 'atrasada';
  if (p === hoje) return 'hoje';
  const dias = diasAte(p, hoje);
  return dias !== null && dias <= DIAS_LEMBRETE ? 'logo' : 'proxima';
}

const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** O lembrete antes do prazo mora aqui também: "Vence em 2 dias (24/11)". */
function textoPrazo(prazo: string | null, hoje: string, verbo = 'Até'): string | undefined {
  if (!prazo) return undefined;
  const u = urgenciaDoPrazo(prazo, hoje);
  if (u === 'atrasada') return `Venceu em ${dataBR(prazo)}`;
  if (u === 'hoje') return 'Vence hoje';
  if (u === 'logo') {
    const d = diasAte(prazo, hoje)!;
    return `Vence em ${d} ${d === 1 ? 'dia' : 'dias'} (${dataBR(prazo)})`;
  }
  return `${verbo} ${dataBR(prazo)}`;
}

const ORDEM_URGENCIA = { atrasada: 0, hoje: 1, logo: 2, proxima: 3 } as const;

/** Mês anterior ao corrente. */
export function mesAnterior(hoje: string): { ano: number; mes: number } {
  const c = competenciaPadrao(hoje);
  return { ano: Number(c.slice(0, 4)), mes: Number(c.slice(5, 7)) };
}

function cortar<T>(lista: T[]): { itens: T[]; alem: number } {
  return { itens: lista.slice(0, MAX_ITENS_BLOCO), alem: Math.max(0, lista.length - MAX_ITENS_BLOCO) };
}

/**
 * Meses (anterior e corrente) em que o cliente ainda não lançou nada. Mês com
 * lançamentos, mesmo sem confirmar, não pede ação dele: a conferência é da
 * contabilidade. Mês anterior primeiro (é o mais atrasado).
 */
export function mesesParaLancar(hoje: string, meses: MesDoMovimento[]): MesDoMovimento[] {
  const atual = { ano: Number(hoje.slice(0, 4)), mes: Number(hoje.slice(5, 7)) };
  return [mesAnterior(hoje), atual]
    .map((a) => meses.find((m) => m.ano === a.ano && m.mes === a.mes) ?? { ...a, lancamentos: 0, confirmado: false })
    .filter((m) => m.lancamentos === 0 && !m.confirmado);
}

export function montarInicioCliente(e: EntradaInicio): InicioCliente {
  const blocos: Bloco[] = [];
  const indisponiveis: Bloco['id'][] = [];

  if (e.movimento.ok) {
    const falta = mesesParaLancar(e.hoje, e.movimento.dados);
    if (falta.length) {
      const unico = falta.length === 1 ? falta[0] : null;
      blocos.push({
        id: 'movimento',
        titulo: unico ? `Lance o movimento de ${nomeMes(unico.ano, unico.mes)}` : 'Lance o movimento do caixa',
        itens: unico ? [] : falta.map((m) => ({ chave: `${m.ano}-${m.mes}`, texto: `Faltam os lançamentos de ${nomeMes(m.ano, m.mes)}` })),
        alemDoLimite: 0,
        acao: { rotulo: 'Lançar no caixa', href: '/caixa' },
        pedeAcao: true,
      });
    }
  } else indisponiveis.push('movimento');

  if (e.pendencias.ok) {
    const ordenadas = [...e.pendencias.dados].sort((a, b) => {
      const ua = urgenciaDoPrazo(a.prazo, e.hoje);
      const ub = urgenciaDoPrazo(b.prazo, e.hoje);
      const oa = ua ? ORDEM_URGENCIA[ua] : 4;
      const ob = ub ? ORDEM_URGENCIA[ub] : 4;
      return oa - ob || (a.prazo ?? '').localeCompare(b.prazo ?? '');
    });
    if (ordenadas.length) {
      const { itens, alem } = cortar(ordenadas);
      blocos.push({
        id: 'pendencias',
        titulo: ordenadas.length === 1 ? 'A contabilidade pediu 1 documento' : `A contabilidade pediu ${ordenadas.length} documentos`,
        itens: itens.map((p) => ({ chave: p.id, texto: p.titulo, detalhe: textoPrazo(p.prazo, e.hoje), urgencia: urgenciaDoPrazo(p.prazo, e.hoje) })),
        alemDoLimite: alem,
        acao: { rotulo: 'Enviar documentos', href: '/documentos' },
        pedeAcao: true,
      });
    }
  } else indisponiveis.push('pendencias');

  if (e.devolvidos) {
    if (e.devolvidos.ok) {
      const lista = e.devolvidos.dados;
      if (lista.length) {
        const { itens, alem } = cortar(lista);
        blocos.push({
          id: 'devolvidos',
          titulo: lista.length === 1 ? '1 documento voltou para você' : `${lista.length} documentos voltaram para você`,
          itens: itens.map((d) => ({
            chave: d.id, texto: d.nome,
            detalhe: `${ROTULO_CATEGORIA[d.categoria] ?? 'Documento'} · ${competenciaBR(d.competencia)}${d.motivo ? ` · Motivo: ${d.motivo}` : ''}`,
          })),
          alemDoLimite: alem,
          acao: { rotulo: 'Enviar de novo', href: '/documentos' },
          pedeAcao: true,
        });
      }
    } else indisponiveis.push('devolvidos');
  }

  if (e.entregas) {
    if (e.entregas.ok) {
      const lista = ordenarEntregas(e.entregas.dados.filter((x) => !x.abertoEm), e.hoje);
      if (lista.length) {
        const { itens, alem } = cortar(lista);
        blocos.push({
          id: 'entregas',
          titulo: lista.length === 1 ? 'A contabilidade enviou 1 documento para você' : `A contabilidade enviou ${lista.length} documentos para você`,
          itens: itens.map((x) => ({
            chave: x.id, texto: `${nomeEntrega(x)} · ${competenciaBR(x.competencia)}`,
            detalhe: textoPrazo(x.vencimento, e.hoje, 'Vence em'), urgencia: urgenciaDoPrazo(x.vencimento, e.hoje),
            href: `/api/entregas/arquivo?id=${encodeURIComponent(x.id)}`,
          })),
          alemDoLimite: alem,
          acao: { rotulo: 'Ver documentos', href: '/documentos' },
          pedeAcao: true,
        });
      }
    } else indisponiveis.push('entregas');
  }

  if (e.folhasDevolvidas.ok) {
    const lista = e.folhasDevolvidas.dados;
    if (lista.length) {
      const { itens, alem } = cortar(lista);
      blocos.push({
        id: 'folhas',
        titulo: lista.length === 1 ? '1 folha de ponto voltou para você' : `${lista.length} folhas de ponto voltaram para você`,
        itens: itens.map((f) => ({
          chave: f.id, texto: `${f.funcionario || 'Funcionário'} · ${nomeMesCurto(f.mes)}/${f.ano}`,
          detalhe: f.motivo ? `Motivo: ${f.motivo}` : 'A contabilidade pediu uma nova foto.',
        })),
        alemDoLimite: alem,
        acao: { rotulo: 'Reenviar folhas', href: '/enviar-ponto' },
        pedeAcao: true,
      });
    }
  } else indisponiveis.push('folhas');

  if (e.demonstrativo.ok) {
    const d = e.demonstrativo.dados;
    if (d) {
      blocos.push({
        id: 'demonstrativo',
        titulo: `Seu Demonstrativo de caixa de ${nomeMes(d.ano, d.mes)} está pronto`,
        itens: [], alemDoLimite: 0,
        acao: { rotulo: 'Ver demonstrativo', href: `/caixa/demonstrativo?ano=${d.ano}&mes=${d.mes}` },
        pedeAcao: false,
      });
    }
  } else indisponiveis.push('demonstrativo');

  const nome = e.empresaNome.trim();
  return {
    saudacao: nome ? `Olá, ${nome}` : 'Olá',
    blocos,
    indisponiveis,
    tudoEmDia: indisponiveis.length === 0 && !blocos.some((b) => b.pedeAcao),
  };
}
