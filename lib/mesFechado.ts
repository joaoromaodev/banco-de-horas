// Mês fechado que trava (Sprint 17, frente C) — regras puras, sem I/O (testadas em
// tests/mesFechado.test.ts). Valem para o Livro Caixa e para a Folha de Ponto:
//
// - Fechado, o mês não muda: nenhum lançamento (caixa) ou frequência (ponto) é
//   criado, alterado ou excluído — nem pelo cliente, nem pela contabilidade.
// - Caixa: o saldo transportado faz parte do mês fechado, então os meses fecham EM
//   ORDEM (janeiro primeiro) e mês anterior a um fechado também trava; reabrir um mês
//   reabre os fechados depois dele (parecer do `contador` e do `escudo`).
// - Só a contabilidade reabre, e reabrir exige o MOTIVO. Fica registrado quem fechou,
//   quem reabriu, quando e por quê.
// - No ponto, a empresa-cliente dá o aceite da FOTO do resumo (horas e dias por
//   funcionário, nunca R$) ou registra uma dúvida. O aceite vale para a assinatura
//   dos números que ela viu. NÃO é espelho de ponto assinado (esse é do empregado,
//   art. 74 CLT / Portaria MTP 671): é a confirmação do cliente ao escritório de que
//   conferiu o que vai para a folha.
// A trava vale no servidor (rotas e gatilho da 0034); a tela só explica.
import type { ResumoFolhaMes } from './resumoFolha';
import type { ItemNotificacao } from './notificacoes';

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
export const mesAno = (ano: number, mes: number) => `${MESES[mes - 1] ?? mes}/${ano}`;

export const MOTIVO_MIN = 5;
export const MOTIVO_MAX = 500;
export const DUVIDA_MIN = 3;
export const DUVIDA_MAX = 1000;

const limpar = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Motivo da reabertura: obrigatório, de 5 a 500 caracteres. `null` = inválido. */
export function motivoReabertura(v: unknown): string | null {
  const t = limpar(v);
  return t.length >= MOTIVO_MIN && t.length <= MOTIVO_MAX ? t : null;
}

/** Texto da dúvida do cliente: de 3 a 1.000 caracteres (quebras de linha viram espaço). */
export function textoDuvida(v: unknown): string | null {
  const t = limpar(v);
  return t.length >= DUVIDA_MIN && t.length <= DUVIDA_MAX ? t : null;
}

export const ERRO_MOTIVO = `Informe o motivo da reabertura (pelo menos ${MOTIVO_MIN} letras). Ele fica registrado no histórico do mês.`;

/** Mensagem do 409 ao gravar em mês fechado do caixa. */
export const mensagemCaixaFechado = (ano: number, mes: number) =>
  `${mesAno(ano, mes)} está fechado pela contabilidade: nenhum lançamento desse mês pode ser criado, alterado ou excluído. `
  + 'Para corrigir, a contabilidade reabre o mês informando o motivo.';

/** Mês aberto, mas com mês posterior fechado: mudar aqui mudaria o saldo transportado dele. */
export const mensagemCaixaPosteriorFechado = (ano: number, mes: number, posterior: number) =>
  `${mesAno(ano, posterior)} está fechado e o saldo dele vem de ${mesAno(ano, mes)}: nenhum lançamento de `
  + `${mesAno(ano, mes)} pode ser criado, alterado ou excluído. Para corrigir, a contabilidade reabre ${mesAno(ano, posterior)} `
  + 'informando o motivo.';

/** Os meses do caixa fecham em ordem: o saldo transportado vem dos anteriores. */
export const mensagemFecharEmOrdem = (ano: number, abertos: number[]) =>
  `Feche antes ${abertos.map((m) => mesAno(ano, m)).join(', ')}: o saldo transportado vem dos meses anteriores, `
  + 'então os meses fecham em ordem.';

/** Mensagem do 409 ao gravar em mês fechado do ponto. */
export const mensagemPontoFechado = (ano: number, mes: number) =>
  `O ponto de ${mesAno(ano, mes)} está fechado: as frequências desse mês não mudam. `
  + 'Para corrigir, a contabilidade reabre o mês informando o motivo.';

/** Saldo inicial muda o saldo transportado de todos os meses: com mês fechado, não muda. */
export const mensagemSaldoInicialFechado = (ano: number, fechados: number[]) =>
  `O saldo inicial de ${ano} muda o saldo transportado de todos os meses, e ${fechados.map((m) => mesAno(ano, m)).join(', ')} `
  + `${fechados.length === 1 ? 'está fechado' : 'estão fechados'}. Reabra ${fechados.length === 1 ? 'o mês' : 'os meses'} informando o motivo para alterar.`;

// ------------------------------------------------------------------ histórico

export interface EventoMes {
  acao: 'fechou' | 'reabriu';
  por: string;
  em: string;
  motivo: string | null;
}

/** Mais recente primeiro. */
export const ordenarHistorico = <T extends { em: string }>(h: T[]): T[] =>
  [...h].sort((a, b) => (a.em < b.em ? 1 : a.em > b.em ? -1 : 0));

// ------------------------------------------------------------------ ponto: foto do resumo

/** Uma linha do resumo que o cliente vê para aceitar. Só horas (em minutos) e dias. */
export interface LinhaFoto {
  funcionario: string;
  dias: number;
  normaisMin: number;
  extrasMin: number;
  bancoMin: number;
  extrasDomFeriadoMin: number;
  noturnoMin: number;
  atrasoMin: number;
  faltas: number;
  dsrPerdidos: number;
  atestadoDias: number;
  feriasDias: number;
}

export interface FotoResumo {
  percentuais: { extraUtil: number; extraDomFeriado: number; adicionalNoturno: number };
  funcionarios: LinhaFoto[];
}

/**
 * A foto guardada no fechamento: o que vai para a folha, por funcionário. Sem o
 * detalhe por dia, sem as pendências internas e sem nenhum valor em reais.
 */
export function fotoDoResumo(r: ResumoFolhaMes): FotoResumo {
  return {
    percentuais: { ...r.percentuais },
    funcionarios: r.funcionarios.map((f) => ({
      funcionario: f.funcionario,
      dias: f.diasTrabalhados,
      normaisMin: f.normaisMin,
      extrasMin: f.extrasUtilPagarMin,
      bancoMin: f.extrasUtilBancoMin,
      extrasDomFeriadoMin: f.extrasDomFeriadoMin,
      noturnoMin: f.noturnoComputadoMin,
      atrasoMin: f.atrasoMin,
      faltas: f.faltas,
      dsrPerdidos: f.dsrPerdidos,
      atestadoDias: f.atestadoDias,
      feriasDias: f.feriasDias,
    })),
  };
}

/** Serialização estável (o jsonb do Postgres reordena as chaves). */
function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

/** A foto guardada no fechamento é igual ao cálculo de agora? (feriado, jornada, percentual ou banco podem ter mudado) */
export const mesmaFoto = (a: FotoResumo | null | undefined, b: FotoResumo | null | undefined): boolean =>
  !!a && !!b && canonico(a) === canonico(b);

/** Por que o mês ainda não pode ser fechado; `null` = pode. */
export function impedimentoParaFechar(r: ResumoFolhaMes): string | null {
  if (!r.funcionarios.length) return 'Não há folha salva neste mês para fechar.';
  if (r.comImpedimento > 0) {
    return `${r.comImpedimento} funcionário(s) com marcação faltando, horário ilegível ou marcador em conflito. Corrija antes de fechar o mês.`;
  }
  return null;
}

// ------------------------------------------------------------------ ponto: aceite do cliente

export type RespostaAceite = 'aceito' | 'duvida';

/**
 * O que o cliente declara ao clicar em "Aceito". Guardado pela VERSÃO em
 * `ponto_aceites.declaracao`: mudou o texto, suba a versão (o registro antigo
 * continua dizendo o que foi aceito).
 */
export const DECLARACAO_ACEITE = {
  versao: 'v1',
  texto: (mesAnoTexto: string) => `Declaro que conferi as horas e os dias acima, informados com base nos controles de ponto `
    + `da empresa, e autorizo o seu uso na folha de pagamento de ${mesAnoTexto}.`,
} as const;

export interface AceiteRegistro {
  assinatura: string;
  resposta: RespostaAceite;
  duvida: string | null;
  por: string;
  em: string;
}

export type SituacaoAceite = 'pendente' | 'aceito' | 'duvida';

/**
 * Situação do aceite para o fechamento atual: só contam os registros com a mesma
 * assinatura (os números que o cliente viu). O mais recente decide; um "aceito"
 * é definitivo para aquela assinatura.
 */
export function situacaoAceite(assinatura: string, aceites: AceiteRegistro[]): { situacao: SituacaoAceite; ultimo: AceiteRegistro | null } {
  const doFechamento = ordenarHistorico(aceites.filter((a) => a.assinatura === assinatura));
  const aceito = doFechamento.find((a) => a.resposta === 'aceito');
  if (aceito) return { situacao: 'aceito', ultimo: aceito };
  const ultimo = doFechamento[0] ?? null;
  return { situacao: ultimo ? 'duvida' : 'pendente', ultimo };
}

/** Meses fechados com resumo para o cliente aceitar, só com o que o aviso usa. */
export interface FechamentoParaAviso { ano: number; mes: number; fechadoEm: string; situacao: SituacaoAceite }

/**
 * Aviso no sino do cliente: um por mês fechado ainda sem aceite (pendente). Sem nome
 * de funcionário nem número no texto. A chave leva o instante do fechamento: reabrir
 * e fechar de novo volta a ser não lida.
 */
export function avisosAceitePonto(fechados: FechamentoParaAviso[]): ItemNotificacao[] {
  return fechados
    .filter((f) => f.situacao === 'pendente' && !Number.isNaN(Date.parse(f.fechadoEm)))
    .map((f) => {
      const quando = new Date(f.fechadoEm).toISOString();
      return {
        chave: `cli|aceite|${f.ano}|${f.mes}|${quando}`, tipo: 'aceite_ponto' as const,
        titulo: 'Resumo do ponto para o seu aceite',
        texto: `${mesAno(f.ano, f.mes)} · confira as horas do mês e responda à contabilidade.`,
        href: '/enviar-ponto#aceite', quando,
      };
    });
}

/** O que vai para o sino da CONTABILIDADE quando o cliente responde ao resumo (Sprint 18 · A). */
export interface AvisoRespostaAceite { tipo: string; titulo: string; texto: string; href: string; chave: string }

/**
 * Aviso à contabilidade: o cliente aceitou o resumo ou registrou uma dúvida. Só a empresa
 * (o sino põe o nome) e o mês — **sem nome de funcionário e sem o texto da dúvida** (texto
 * livre do cliente, pode citar pessoa ou saúde; ele fica na seção do fechamento, na
 * Timesheet). A chave leva o instante da resposta: cada resposta é um aviso.
 */
export function avisoRespostaAceite(n: {
  empresaId: string; ano: number; mes: number; resposta: RespostaAceite; em: string;
}): AvisoRespostaAceite {
  const q = new URLSearchParams({ empresa: n.empresaId, ano: String(n.ano), mes: String(n.mes) });
  const base = { tipo: 'aceite_ponto_cliente', href: `/ponto?${q}`, chave: `aceite-ponto|${n.empresaId}|${n.ano}|${n.mes}|${n.em}` };
  const periodo = mesAno(n.ano, n.mes);
  return n.resposta === 'aceito'
    ? { ...base, titulo: 'O cliente aceitou o resumo do ponto', texto: `${periodo} · confirmado pela empresa.` }
    : { ...base, titulo: 'O cliente tem uma dúvida no resumo do ponto', texto: `${periodo} · leia a dúvida no fechamento do mês, na Timesheet.` };
}
