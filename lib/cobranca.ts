// Regras puras da cobrança (Sprint 2 / Frente A). Sem I/O e sem imports de
// runtime — testadas em tests/cobranca.test.ts. O I/O fica em
// lib/cobrancaServidor.ts (banco) e lib/gatewayAsaas.ts (gateway).
//
// Ideia central: o banco guarda FATOS (plano do escritório, fim do teste,
// assinatura, cobranças do gateway) e a situação de acesso é DERIVADA aqui, na
// hora. Assim nenhum cron precisa "virar" um escritório para somente leitura:
// passou a data, a regra já responde diferente.
import type { SituacaoEscritorio } from './visibilidade';

export type Plano = 'teste' | 'essencial' | 'escritorio' | 'ilimitado' | 'fundador';
export type PlanoPago = 'essencial' | 'escritorio' | 'ilimitado';
export type Ciclo = 'mensal' | 'anual';
export type StatusAssinatura = 'pendente' | 'ativa' | 'inadimplente' | 'cancelada';

export const PLANOS_PAGOS: PlanoPago[] = ['essencial', 'escritorio', 'ilimitado'];
export const CICLOS: Ciclo[] = ['mensal', 'anual'];

/** Tabela de preços e limites (docs/empresa/estrategia.md). Limite `null` = sem limite. */
export const PLANOS: Record<PlanoPago, { nome: string; limite: number | null; mensal: number; anual: number }> = {
  essencial: { nome: 'Essencial', limite: 10, mensal: 89, anual: 890 },
  escritorio: { nome: 'Escritório', limite: 40, mensal: 189, anual: 1890 },
  ilimitado: { nome: 'Ilimitado', limite: null, mensal: 349, anual: 3490 },
};

export const NOME_PLANO: Record<Plano, string> = {
  teste: 'Teste grátis',
  essencial: 'Essencial',
  escritorio: 'Escritório',
  ilimitado: 'Ilimitado',
  fundador: 'Fundador',
};

/** Dias depois do vencimento em aberto até a conta virar somente leitura. */
export const CARENCIA_DIAS = 7;

/** Abaixo disto o ajuste proporcional não vira cobrança (o gateway tem valor mínimo). */
export const AJUSTE_MINIMO = 5;

export const ehPlanoPago = (p: unknown): p is PlanoPago => PLANOS_PAGOS.includes(p as PlanoPago);
export const ehCiclo = (c: unknown): c is Ciclo => CICLOS.includes(c as Ciclo);

export function preco(plano: PlanoPago, ciclo: Ciclo): number {
  return ciclo === 'anual' ? PLANOS[plano].anual : PLANOS[plano].mensal;
}

/**
 * Quantas empresas-clientes o plano comporta (`null` = sem limite). No teste o
 * escritório experimenta sem limite; o fundador também não tem.
 */
export function limiteEmpresas(plano: Plano): number | null {
  return ehPlanoPago(plano) ? PLANOS[plano].limite : null;
}

/** O menor plano pago que comporta `n` empresas. */
export function planoMinimoPara(n: number): PlanoPago {
  return PLANOS_PAGOS.find((p) => { const l = PLANOS[p].limite; return l === null || n <= l; }) ?? 'ilimitado';
}

/**
 * Cadastrar empresas novas cabe no plano? Só barra o que **cresce**: um escritório
 * que já passou do limite (ex.: desceu de plano) continua editando as que tem.
 */
export function cabeNoPlano(plano: Plano, atuais: number, depois: number): boolean {
  const lim = limiteEmpresas(plano);
  if (lim === null || depois <= atuais) return true;
  return depois <= lim;
}

// ---------------------------------------------------------------- Datas
// Datas de cobrança são dias (`YYYY-MM-DD`), contadas no fuso de Belém (UTC−3,
// sem horário de verão) — o mesmo "hoje" da contadora.
const DIA_MS = 86_400_000;

export function hojeEm(agora: number = Date.now()): string {
  return new Date(agora - 3 * 3_600_000).toISOString().slice(0, 10);
}

const paraUTC = (iso: string) => { const [a, m, d] = iso.slice(0, 10).split('-').map(Number); return Date.UTC(a, m - 1, d); };
const deUTC = (t: number) => new Date(t).toISOString().slice(0, 10);

export function somarDias(iso: string, n: number): string {
  return deUTC(paraUTC(iso) + n * DIA_MS);
}

/** Dias de `de` até `ate` (positivo se `ate` é depois). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((paraUTC(ate) - paraUTC(de)) / DIA_MS);
}

/** Soma meses mantendo o dia; dia que não existe no mês de destino vira o último (31/01 + 1 = 28/02). */
export function somarMeses(iso: string, n: number): string {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  const alvo = new Date(Date.UTC(a, m - 1 + n, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  alvo.setUTCDate(Math.min(d, ultimo));
  return deUTC(alvo.getTime());
}

export function somarCiclo(iso: string, ciclo: Ciclo, vezes = 1): string {
  return somarMeses(iso, (ciclo === 'anual' ? 12 : 1) * vezes);
}

const valida = (iso?: string | null): iso is string => Boolean(iso && /^\d{4}-\d{2}-\d{2}/.test(iso) && !Number.isNaN(paraUTC(iso)));
const centavos = (v: number) => Math.round(v * 100) / 100;

// ---------------------------------------------------------------- Situação
/** O que a regra precisa da assinatura guardada (tabela `assinaturas`). */
export interface AssinaturaRef {
  plano: PlanoPago;
  ciclo: Ciclo;
  status: StatusAssinatura;
  /** Último dia já pago (inclusive). */
  pagoAte: string | null;
  inadimplenteDesde: string | null;
  proximoVencimento: string | null;
  planoAgendado?: PlanoPago | null;
  cicloAgendado?: Ciclo | null;
  /** A partir de que dia a troca agendada vale (a renovação). */
  agendadoAPartir?: string | null;
}

export interface EstadoCobranca {
  plano: Plano;
  situacao: SituacaoEscritorio;
  testeAte: string | null;
  assinatura?: AssinaturaRef | null;
}

export type MotivoLiberado =
  | 'fundador' | 'teste' | 'assinante' | 'carencia' | 'aguardando_pagamento' | 'cancelada_vigente' | 'cortesia'
  /** Teste vencido, mas a cobrança ainda não está configurada: não há como assinar, então não trava. */
  | 'cobranca_desligada';
export type MotivoBloqueio = 'teste_vencido' | 'inadimplente' | 'cancelada' | 'aguardando_pagamento' | 'suspenso';

export type Situacao =
  | { somenteLeitura: false; motivo: MotivoLiberado; /** dias até o fim (teste, carência, cancelada) */ dias?: number; ate?: string }
  | { somenteLeitura: true; motivo: MotivoBloqueio; desde?: string };

/**
 * Aplica a troca agendada (descida de plano, troca de ciclo) se a renovação já
 * chegou. O servidor grava o resultado quando lê; a regra também o usa na hora,
 * então ninguém depende de cron nem da ordem dos webhooks.
 */
export function consolidarAgendamento<T extends AssinaturaRef>(a: T, hoje: string): T {
  if (!valida(a.agendadoAPartir) || hoje < a.agendadoAPartir) return a;
  return {
    ...a,
    plano: a.planoAgendado ?? a.plano,
    ciclo: a.cicloAgendado ?? a.ciclo,
    planoAgendado: null, cicloAgendado: null, agendadoAPartir: null,
  };
}

/** Plano em vigor hoje, com a troca agendada já aplicada se chegou a data. */
export function planoVigente(a: AssinaturaRef, hoje: string): PlanoPago {
  return consolidarAgendamento(a, hoje).plano;
}

/**
 * Situação de acesso do escritório. Regras, na ordem:
 * 1. `fundador` nunca cai em somente leitura (gratuito vitalício).
 * 2. `suspenso` (decisão manual do master) bloqueia.
 * 3. Com assinatura, ela decide:
 *    - ativa → liberado;
 *    - inadimplente → liberado durante a carência ({@link CARENCIA_DIAS} dias a
 *      partir do vencimento mais antigo em aberto), depois somente leitura;
 *    - pendente (assinou e ainda não pagou a 1ª) → liberado enquanto o teste
 *      vale ou até o 1º vencimento + carência (boleto leva dias para compensar);
 *    - cancelada → liberado até o fim do período pago, depois somente leitura.
 * 4. Sem assinatura: `ativo` (liberado à mão pelo master) segue liberado; em
 *    teste, liberado até `testeAte`; depois, somente leitura.
 */
export function situacaoEfetiva(e: EstadoCobranca, agora: number = Date.now()): Situacao {
  if (e.plano === 'fundador') return { somenteLeitura: false, motivo: 'fundador' };
  if (e.situacao === 'suspenso') return { somenteLeitura: true, motivo: 'suspenso' };

  const hoje = hojeEm(agora);
  const fimTeste = e.testeAte ? Date.parse(e.testeAte) : NaN;
  const emTeste = !Number.isNaN(fimTeste) && fimTeste > agora;
  const diasTeste = emTeste ? Math.ceil((fimTeste - agora) / DIA_MS) : 0;
  const a = e.assinatura;

  if (a) {
    switch (a.status) {
      case 'ativa':
        return { somenteLeitura: false, motivo: 'assinante' };
      case 'inadimplente': {
        if (!valida(a.inadimplenteDesde)) return { somenteLeitura: false, motivo: 'assinante' };
        const limite = somarDias(a.inadimplenteDesde, CARENCIA_DIAS);
        if (hoje <= limite) return { somenteLeitura: false, motivo: 'carencia', dias: diasEntre(hoje, limite) + 1, ate: limite };
        return { somenteLeitura: true, motivo: 'inadimplente', desde: a.inadimplenteDesde };
      }
      case 'pendente': {
        if (emTeste) return { somenteLeitura: false, motivo: 'aguardando_pagamento', dias: diasTeste };
        // A folga da carência só vale para quem assinou DURANTE o teste (1º
        // vencimento até o fim dele): cobre o boleto que leva dias para compensar.
        // Quem assina depois espera a confirmação — senão "assinar e cancelar"
        // em loop daria uso grátis sem fim. Pix e cartão confirmam na hora.
        const assinouNoTeste = valida(a.proximoVencimento) && valida(e.testeAte) && a.proximoVencimento <= hojeEm(Date.parse(e.testeAte));
        if (assinouNoTeste && valida(a.proximoVencimento)) {
          const limite = somarDias(a.proximoVencimento, CARENCIA_DIAS);
          if (hoje <= limite) return { somenteLeitura: false, motivo: 'aguardando_pagamento', dias: diasEntre(hoje, limite) + 1, ate: limite };
        }
        return { somenteLeitura: true, motivo: 'aguardando_pagamento' };
      }
      case 'cancelada': {
        // Cancelou com cobrança vencida em aberto (ex.: o ajuste de uma subida de
        // plano): passada a carência, o período pago não protege mais.
        if (valida(a.inadimplenteDesde) && hoje > somarDias(a.inadimplenteDesde, CARENCIA_DIAS)) {
          return { somenteLeitura: true, motivo: 'inadimplente', desde: a.inadimplenteDesde };
        }
        if (valida(a.pagoAte) && hoje <= a.pagoAte) {
          return { somenteLeitura: false, motivo: 'cancelada_vigente', dias: diasEntre(hoje, a.pagoAte) + 1, ate: a.pagoAte };
        }
        if (emTeste) return { somenteLeitura: false, motivo: 'teste', dias: diasTeste };
        return { somenteLeitura: true, motivo: 'cancelada', desde: a.pagoAte ?? undefined };
      }
    }
  }

  if (e.situacao === 'ativo') return { somenteLeitura: false, motivo: 'cortesia' };
  if (emTeste) return { somenteLeitura: false, motivo: 'teste', dias: diasTeste };
  return { somenteLeitura: true, motivo: 'teste_vencido', desde: e.testeAte?.slice(0, 10) };
}

/**
 * Sem gateway configurado não há como assinar: o teste vencido não pode travar
 * a conta (seria um beco sem saída). Só o `suspenso` manual continua valendo.
 * Com assinatura no banco a regra normal vale (ela veio de um gateway).
 */
export function comGateway(s: Situacao, configurada: boolean): Situacao {
  if (configurada || !s.somenteLeitura || s.motivo !== 'teste_vencido') return s;
  return { somenteLeitura: false, motivo: 'cobranca_desligada' };
}

/** Plano que vale para limites (empresas) hoje. */
export function planoEfetivo(e: EstadoCobranca, agora: number = Date.now()): Plano {
  if (e.plano === 'fundador') return 'fundador';
  const a = e.assinatura;
  if (a && a.status !== 'cancelada') return planoVigente(a, hojeEm(agora));
  if (a && a.status === 'cancelada' && valida(a.pagoAte) && hojeEm(agora) <= a.pagoAte) return a.plano;
  return e.plano;
}

// ---------------------------------------------------------------- Escrita
const METODOS_ESCRITA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Rotas de escrita que continuam abertas em somente leitura: entrar, sair e pagar. */
const ESCRITA_LIVRE = ['/api/login', '/api/logout', '/api/criar-conta', '/api/cobranca'];

/**
 * POSTs que só GERAM arquivo a partir do que já existe (exportar), sem gravar
 * nada. Somente leitura ainda exporta tudo. Conferido em 21/11/2026: não gravam.
 */
const EXPORTACOES_POST = ['/api/gerar', '/api/contratos/documento'];

const casa = (caminho: string, lista: string[]) =>
  lista.some((p) => caminho === p || caminho.startsWith(p + '/'));

/** O POST só gera arquivo (exportar), sem gravar? (usado também pela consulta de arquivadas) */
export const ehExportacaoPost = (caminho: string): boolean => casa(caminho, EXPORTACOES_POST);

/**
 * Esta requisição é uma escrita que o modo somente leitura barra? Falha fechada:
 * todo método de escrita em `/api/*` é barrado, exceto a lista curta acima.
 * Método desconhecido também conta como escrita (só GET/HEAD/OPTIONS passam).
 */
export function escritaBarrada(metodo: string, caminho: string): boolean {
  if (!caminho.startsWith('/api/')) return false;
  const m = metodo.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
  if (!METODOS_ESCRITA.has(m)) return true;
  return !casa(caminho, ESCRITA_LIVRE) && !casa(caminho, EXPORTACOES_POST);
}

/** Texto do 402 — o gestor vê o convite para assinar; o cliente, para falar com a contabilidade. */
export function mensagemSomenteLeitura(motivo: MotivoBloqueio, papel: 'usuario' | 'cliente' | 'master'): string {
  if (papel === 'cliente') {
    return 'Por enquanto dá para consultar e exportar, mas não para lançar ou alterar. A assinatura da contabilidade que atende sua empresa está pendente — fale com ela.';
  }
  const porque: Record<MotivoBloqueio, string> = {
    teste_vencido: 'O teste grátis do escritório terminou.',
    inadimplente: 'Há uma cobrança da assinatura em aberto.',
    cancelada: 'A assinatura do escritório foi cancelada.',
    aguardando_pagamento: 'O primeiro pagamento da assinatura ainda não foi confirmado.',
    suspenso: 'O acesso do escritório está suspenso.',
  };
  return `${porque[motivo]} A conta está em modo somente leitura: tudo continua visível e exportável, mas nada pode ser gravado. Assine ou regularize em Assinatura.`;
}

// ---------------------------------------------------------------- Assinar
/**
 * Primeiro vencimento de uma assinatura nova: no fim do teste (o escritório não
 * perde dias grátis por assinar cedo) ou hoje, se o teste já acabou.
 */
export function primeiroVencimento(testeAte: string | null, agora: number = Date.now()): string {
  const hoje = hojeEm(agora);
  if (!testeAte) return hoje;
  const fim = Date.parse(testeAte);
  if (Number.isNaN(fim) || fim <= agora) return hoje;
  const dia = hojeEm(fim);
  return dia > hoje ? dia : hoje;
}

// ---------------------------------------------------------------- Pagamentos
/** Cobrança espelhada do gateway, no formato neutro. */
export interface PagamentoRef {
  id: string;
  /** Cobrança da assinatura (renova período) ou avulsa (ajuste proporcional). */
  daAssinatura: boolean;
  status: StatusPagamento;
  vencimento: string | null;
  valor: number;
  /** Último dia coberto (cobrança de assinatura paga), congelado quando foi paga. */
  periodoAte?: string | null;
}

/**
 * Até que dia uma cobrança de assinatura com este vencimento cobre: vencimento
 * + 1 ciclo − 1 dia, com o ciclo que vale NAQUELE vencimento (a troca de ciclo
 * agendada conta só a partir de `agendadoAPartir`). Calculado quando a cobrança
 * é paga e congelado — mudar de ciclo depois não estica o que já foi pago.
 */
export function periodoDoPagamento(vencimento: string, a: Pick<AssinaturaRef, 'ciclo' | 'cicloAgendado' | 'agendadoAPartir'>): string {
  const ciclo = a.cicloAgendado && valida(a.agendadoAPartir) && vencimento >= a.agendadoAPartir ? a.cicloAgendado : a.ciclo;
  return somarDias(somarCiclo(vencimento, ciclo), -1);
}

/** Status do pagamento, já traduzidos do gateway. */
export type StatusPagamento = 'pendente' | 'pago' | 'vencido' | 'estornado' | 'removido';

/**
 * Recalcula a assinatura a partir do conjunto de cobranças conhecidas — não do
 * evento isolado. Como o gateway não garante ordem nem entrega única, olhar o
 * estado inteiro torna o processamento idempotente e insensível à ordem.
 *
 * - `pagoAte` = o maior `periodoAte` entre as cobranças de assinatura pagas;
 * - `inadimplenteDesde` = vencimento mais antigo entre as cobranças vencidas;
 * - status: cancelada continua cancelada; senão inadimplente se há vencida;
 *   senão ativa se há algo pago; senão pendente.
 */
export function recalcularAssinatura(
  a: Pick<AssinaturaRef, 'ciclo' | 'status' | 'proximoVencimento'>,
  pagamentos: PagamentoRef[],
): Pick<AssinaturaRef, 'status' | 'pagoAte' | 'inadimplenteDesde' | 'proximoVencimento'> {
  const pagos = pagamentos.filter((p) => p.daAssinatura && p.status === 'pago' && valida(p.vencimento));
  // Período congelado de cada cobrança paga; sem ele (não deveria acontecer),
  // a conta conservadora é 1 mês — nunca o ciclo atual, que pode ter mudado.
  const pagoAte = pagos
    .map((p) => (valida(p.periodoAte) ? p.periodoAte : somarDias(somarCiclo(p.vencimento as string, 'mensal'), -1)))
    .sort().at(-1) ?? null;

  const vencidas = pagamentos.filter((p) => p.status === 'vencido' && valida(p.vencimento)).map((p) => p.vencimento as string).sort();
  const inadimplenteDesde = vencidas[0] ?? null;

  const abertas = pagamentos
    .filter((p) => p.daAssinatura && (p.status === 'pendente' || p.status === 'vencido') && valida(p.vencimento))
    .map((p) => p.vencimento as string).sort();
  const proximoVencimento = abertas[0] ?? (pagoAte ? somarDias(pagoAte, 1) : a.proximoVencimento);

  let status: StatusAssinatura;
  if (a.status === 'cancelada') status = 'cancelada';
  else if (inadimplenteDesde) status = 'inadimplente';
  else if (pagoAte) status = 'ativa';
  else status = 'pendente';

  return { status, pagoAte, inadimplenteDesde, proximoVencimento };
}

// ---------------------------------------------------------------- Trocar de plano
export interface PedidoTroca {
  planoAtual: PlanoPago;
  cicloAtual: Ciclo;
  planoNovo: PlanoPago;
  cicloNovo: Ciclo;
  /** Último dia pago do período corrente (null = nada pago ainda). */
  pagoAte: string | null;
  hoje: string;
}

export type ResultadoTroca =
  | { tipo: 'nada' }
  /** Nada pago ainda: troca na hora, sem ajuste (só muda o valor das cobranças em aberto). */
  | { tipo: 'imediata'; valorNovo: number }
  /** Subida de plano no meio do período: vale na hora e cobra a diferença dos dias que faltam. */
  | { tipo: 'subida'; valorNovo: number; cobrarAgora: number; diasRestantes: number; diasPeriodo: number }
  /** Descida de plano e/ou troca de ciclo: vale na renovação, sem cobrança nem crédito. */
  | { tipo: 'agendada'; valorNovo: number; aPartir: string; planoJa?: PlanoPago; cobrarAgora: number };

/**
 * Troca de plano com ajuste proporcional (decisão em docs/cobranca.md):
 * - nada pago ainda → imediata;
 * - plano mais caro no mesmo ciclo → imediata + cobrança avulsa de
 *   (novo − atual) × dias restantes ÷ dias do período (arredondada em centavos;
 *   abaixo de {@link AJUSTE_MINIMO} não cobra);
 * - plano mais barato → vale na renovação (`pagoAte + 1`): o escritório já
 *   pagou o período e usa o plano maior até o fim, sem crédito;
 * - troca de ciclo → vale na renovação; se vier junto com subida de plano, a
 *   subida vale na hora com o ajuste calculado no ciclo atual.
 */
export function calcularTroca(p: PedidoTroca): ResultadoTroca {
  const mudaPlano = p.planoNovo !== p.planoAtual;
  const mudaCiclo = p.cicloNovo !== p.cicloAtual;
  if (!mudaPlano && !mudaCiclo) return { tipo: 'nada' };
  const valorNovo = preco(p.planoNovo, p.cicloNovo);

  if (!valida(p.pagoAte) || p.pagoAte < p.hoje) return { tipo: 'imediata', valorNovo };

  const fim = somarDias(p.pagoAte, 1); // início do próximo período
  const inicio = somarCiclo(fim, p.cicloAtual, -1);
  const diasPeriodo = Math.max(1, diasEntre(inicio, fim));
  const diasRestantes = Math.min(diasPeriodo, Math.max(0, diasEntre(p.hoje, fim)));
  const diferenca = preco(p.planoNovo, p.cicloAtual) - preco(p.planoAtual, p.cicloAtual);
  const ajuste = centavos((diferenca * diasRestantes) / diasPeriodo);
  const cobrarAgora = ajuste >= AJUSTE_MINIMO ? ajuste : 0;

  if (diferenca > 0) {
    if (!mudaCiclo) return { tipo: 'subida', valorNovo, cobrarAgora, diasRestantes, diasPeriodo };
    return { tipo: 'agendada', valorNovo, aPartir: fim, planoJa: p.planoNovo, cobrarAgora };
  }
  return { tipo: 'agendada', valorNovo, aPartir: fim, cobrarAgora: 0 };
}

// ---------------------------------------------------------------- Exibição
export const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const dataBR = (iso: string | null | undefined) => (valida(iso) ? iso.slice(0, 10).split('-').reverse().join('/') : '—');

// ---------------------------------------------------------------- CPF/CNPJ do pagador
// O Asaas exige CPF ou CNPJ para criar o cliente. Conferimos os dígitos antes
// de mandar e NÃO guardamos (minimização, LGPD): o documento fica só no gateway.
export const soDigitos = (s: unknown) => String(s ?? '').replace(/\D/g, '');

export function documentoValido(doc: string): boolean {
  const d = soDigitos(doc);
  if (d.length !== 11 && d.length !== 14) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  const n = d.split('').map(Number);
  if (d.length === 11) {
    const dv = (len: number) => {
      const soma = n.slice(0, len).reduce((s, x, i) => s + x * (len + 1 - i), 0);
      const r = (soma * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return dv(9) === n[9] && dv(10) === n[10];
  }
  const dv = (len: number) => {
    const pesos = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = pesos.reduce((s, p, i) => s + p * n[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === n[12] && dv(13) === n[13];
}
