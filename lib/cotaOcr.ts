// Cota mensal de leituras de folha por IA, por plano do escritório.
//
// Regra pura (sem I/O): quem conta as leituras é lib/pontoDb.ts e quem aplica é
// /api/extrair. Números decididos em 21/11/2026 (docs/empresa/decisoes.md): a cota
// existe para conter abuso, não para segmentar — uma leitura custa centavos.

/** Limite de folhas lidas por IA em um mês, por plano. */
export const COTA_POR_PLANO: Record<string, number> = {
  teste: 50,
  essencial: 150,
  escritorio: 600,
  ilimitado: 2000, // "ilimitado" com uso justo
  fundador: 10000, // sem limite prático; o teto só segura uma sessão vazada
};

/** Plano desconhecido (a cobrança pode criar nomes novos) cai no menor pago. */
export const COTA_PLANO_DESCONHECIDO = COTA_POR_PLANO.essencial;

/** A partir de que fração do limite avisamos. */
export const FRACAO_AVISO = 0.8;

const NOME_PLANO: Record<string, string> = {
  teste: 'teste grátis',
  essencial: 'Essencial',
  escritorio: 'Escritório',
  ilimitado: 'Ilimitado',
  fundador: 'Fundador',
};

/** Próximo plano para o convite de upgrade (null = já é o maior). */
const PROXIMO_PLANO: Record<string, string | null> = {
  teste: 'essencial',
  essencial: 'escritorio',
  escritorio: 'ilimitado',
  ilimitado: null,
  fundador: null,
};

export type NivelCota = 'ok' | 'aviso' | 'esgotada' | 'suspensa';

export interface EstadoCota {
  /** Pode fazer MAIS UMA leitura agora? */
  permitido: boolean;
  nivel: NivelCota;
  usadas: number;
  limite: number;
  restantes: number;
  /** Texto para a tela (aviso ou bloqueio); null quando não há o que dizer. */
  mensagem: string | null;
}

/** Só chaves próprias: `in` aceitaria "toString"/"__proto__" vindos do banco. */
const tem = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function limiteDoPlano(plano: string | null | undefined): number {
  const p = String(plano ?? '').trim();
  return tem(COTA_POR_PLANO, p) ? COTA_POR_PLANO[p] : COTA_PLANO_DESCONHECIDO;
}

const fmt = (n: number) => n.toLocaleString('pt-BR');

function convite(plano: string): string {
  const prox = PROXIMO_PLANO[plano];
  if (prox) {
    return ` Para continuar ainda este mês, mude para o plano ${NOME_PLANO[prox]} ` +
      `(${fmt(COTA_POR_PLANO[prox])} folhas por mês) na área de assinatura.`;
  }
  return ' Se o escritório precisa de mais, fale com a gente pelo suporte.';
}

/**
 * Estado da cota com `usadas` leituras já feitas no mês (incluindo as reservadas).
 * - escritório `suspenso` não lê (a cobrança decide quando suspende);
 * - `usadas >= limite` bloqueia, com convite para subir de plano;
 * - a partir de 80% do limite, avisa quantas restam.
 */
export function avaliarCota(opts: {
  plano: string | null | undefined;
  situacao?: string | null;
  usadas: number;
}): EstadoCota {
  const plano = String(opts.plano ?? '').trim();
  const limite = limiteDoPlano(plano);
  const usadas = Math.max(0, Math.floor(Number(opts.usadas) || 0));
  const restantes = Math.max(0, limite - usadas);

  if (opts.situacao === 'suspenso') {
    return {
      permitido: false, nivel: 'suspensa', usadas, limite, restantes,
      mensagem: 'A leitura por IA está pausada porque a assinatura do escritório está suspensa. ' +
        'Regularize na área de assinatura para voltar a ler as folhas — o preenchimento manual continua disponível.',
    };
  }
  if (usadas >= limite) {
    return {
      permitido: false, nivel: 'esgotada', usadas, limite, restantes: 0,
      mensagem: `O escritório já usou as ${fmt(limite)} leituras por IA deste mês. ` +
        'Você ainda pode preencher a folha à mão; a cota renova no dia 1º.' + convite(tem(PROXIMO_PLANO, plano) ? plano : 'essencial'),
    };
  }
  if (usadas >= Math.ceil(limite * FRACAO_AVISO)) {
    return {
      permitido: true, nivel: 'aviso', usadas, limite, restantes,
      mensagem: `Restam ${fmt(restantes)} de ${fmt(limite)} leituras por IA neste mês.`,
    };
  }
  return { permitido: true, nivel: 'ok', usadas, limite, restantes, mensagem: null };
}

/**
 * Limite de ritmo, à parte da cota: tentativas (inclusive as que falharam, que não
 * contam na cota) por escritório numa janela curta. Segura abuso de custo — uma
 * sessão mandando imagem quebrada em sequência.
 */
export const RITMO = { janelaMin: 10, maximo: 30 };
/** Reserva mais velha que isto (função morta no meio) deixa de contar na cota. */
export const RESERVA_VALIDA_MIN = 5;

export function excedeuRitmo(tentativasNaJanela: number): boolean {
  return (Number(tentativasNaJanela) || 0) >= RITMO.maximo;
}

export const MENSAGEM_RITMO = 'Muitas leituras em pouco tempo. Espere alguns minutos e tente de novo — ' +
  'enquanto isso, dá para preencher a folha à mão.';

/** Competência AAAA-MM no fuso de Belém (UTC−3, sem horário de verão). */
export function competenciaBelem(agora: Date = new Date()): string {
  const belem = new Date(agora.getTime() - 3 * 60 * 60 * 1000);
  return `${belem.getUTCFullYear()}-${String(belem.getUTCMonth() + 1).padStart(2, '0')}`;
}
