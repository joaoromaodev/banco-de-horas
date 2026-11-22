// Erro da IA com mensagem para gente (nunca a mensagem crua do provedor na tela).

export type TipoErroIa = 'cota_diaria' | 'cota_escritorio' | 'ocupada' | 'tempo' | 'indisponivel' | 'resposta' | 'arquivo';

const MENSAGEM: Record<TipoErroIa, string> = {
  cota_diaria: 'O limite diário da IA foi atingido. Tente amanhã — enquanto isso, dá para preencher à mão.',
  // Sprint 18 · A: a parte do dia que cabe a este escritório (lib/ia/cota.ts monta o texto com o %).
  cota_escritorio: 'O seu escritório já usou a parte dele da IA hoje. As leituras voltam amanhã — enquanto isso, dá para preencher à mão.',
  ocupada: 'A IA está recebendo muitos pedidos agora. Tente de novo em alguns minutos.',
  tempo: 'A IA demorou demais para responder. Tente de novo — se repetir, preencha à mão.',
  indisponivel: 'A leitura por IA está indisponível no momento. Dá para preencher à mão enquanto isso.',
  resposta: 'A IA respondeu num formato que não deu para usar. Tente de novo ou preencha à mão.',
  arquivo: 'Não foi possível preparar este arquivo para a IA.',
};

const STATUS: Record<TipoErroIa, number> = {
  cota_diaria: 429, cota_escritorio: 429, ocupada: 429, tempo: 504, indisponivel: 503, resposta: 502, arquivo: 415,
};

export class ErroIa extends Error {
  readonly tipo: TipoErroIa;
  /** O que a tela mostra. */
  readonly mensagem: string;
  readonly status: number;
  /** Detalhe técnico curto, só para o log (sem conteúdo do documento). */
  readonly detalhe: string;
  /** Neurônios gastos mesmo com a resposta inútil (a chamada foi feita) — entra na cota. */
  neuronios: number | null = null;

  constructor(tipo: TipoErroIa, detalhe = '', mensagem?: string) {
    super(`[ia:${tipo}] ${detalhe}`.slice(0, 300));
    this.tipo = tipo;
    this.mensagem = mensagem ?? MENSAGEM[tipo];
    this.status = STATUS[tipo];
    this.detalhe = detalhe.slice(0, 200);
  }
}

export const MENSAGEM_COTA_DIARIA = MENSAGEM.cota_diaria;
