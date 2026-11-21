// Férias — regras puras (testadas em tests/ferias.test.ts). Ver docs/departamento-pessoal.md.
//
// Critérios revisados com o subagente `contador` em 21/11/2026:
//  - aquisitivo: 12 meses a partir da admissão (ou do início editado, art. 133 §2º);
//    concessivo: os 12 meses seguintes (art. 134);
//  - direito pelo art. 130, contando só as faltas INJUSTIFICADAS (marcador FALTA do ponto);
//  - fracionamento (art. 134 §1º): até 3 períodos, um ≥ 14 dias, os demais ≥ 5; com
//    direito < 14 (faltas), período único (leitura conservadora);
//  - início não pode cair nos 2 dias antes de feriado ou do DSR (art. 134 §3º) — bloqueia;
//  - aviso 30 dias antes (art. 135) e pagamento até 2 dias antes (art. 145) — só avisam;
//  - vencidas: concessivo acabou com saldo → em dobro (art. 137; Súmula 81 TST). Pagar fora
//    do prazo do art. 145 NÃO é dobro (Súmula 450 caiu na ADPF 501/STF): só multa (art. 153);
//  - cada período tem saldo próprio (um vencido e um simples ao mesmo tempo não se somam).
import { pascoa } from './agenda';
import { br, isoOk, type Empregado } from './dp';

// ------------------------------------------------------------------ datas (AAAA-MM-DD, UTC)
const partes = (iso: string) => iso.split('-').map(Number) as [number, number, number];

export function somarDias(iso: string, n: number): string {
  const [a, m, d] = partes(iso);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Mesmo dia `n` anos depois; 29/02 vira 01/03 em ano não bissexto. */
export function somarAnos(iso: string, n: number): string {
  const [a, m, d] = partes(iso);
  return new Date(Date.UTC(a + n, m - 1, d)).toISOString().slice(0, 10);
}

export function diasEntre(de: string, ate: string): number {
  const t = (iso: string) => { const [a, m, d] = partes(iso); return Date.UTC(a, m - 1, d); };
  return Math.round((t(ate) - t(de)) / 86_400_000);
}

export const diaDaSemana = (iso: string) => { const [a, m, d] = partes(iso); return new Date(Date.UTC(a, m - 1, d)).getUTCDay(); };

const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

// ------------------------------------------------------------------ feriados para férias
const FIXOS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-25'];

/**
 * Feriados nacionais **em lei** (Lei 662/49, 6.802/80, 9.093/95, 14.759/23 — inclui
 * 20/11) e a Sexta-feira Santa. Diferente da agenda: Carnaval e Corpus Christi NÃO
 * entram (são ponto facultativo — contador, 21/11/2026). Estaduais e municipais
 * (em Belém: 15/08, 12/01…) entram pelos feriados cadastrados no ponto do escritório.
 */
export function feriadosLegais(ano: number): string[] {
  return [...FIXOS.map((md) => `${ano}-${md}`), somarDias(pascoa(ano), -2)].sort();
}

/** Conjunto de feriados para checar o início das férias: legais + os do escritório. */
export function conjuntoFeriados(anos: number[], doEscritorio: Iterable<string> = []): Set<string> {
  const s = new Set<string>(doEscritorio);
  for (const a of anos) for (const d of feriadosLegais(a)) s.add(d);
  return s;
}

// ------------------------------------------------------------------ períodos

export interface PeriodoAquisitivo {
  numero: number;
  inicio: string;
  fim: string;
  /** Último dia para o gozo terminar sem dobro. */
  concessivoFim: string;
}

/** Início do 1º aquisitivo: o editado pela contadora (art. 133 §2º, readmissão) ou a admissão. */
export const baseAquisitivo = (e: Pick<Empregado, 'admissao' | 'aquisitivoBase'>) => e.aquisitivoBase ?? e.admissao;

/** Períodos aquisitivos que começaram até `ate` (inclusive). */
export function periodosAquisitivos(base: string, ate: string, max = 60): PeriodoAquisitivo[] {
  const lista: PeriodoAquisitivo[] = [];
  if (!isoOk(base) || !isoOk(ate)) return lista;
  for (let n = 0; n < max; n++) {
    const inicio = somarAnos(base, n);
    if (inicio > ate) break;
    lista.push({ numero: n + 1, inicio, fim: somarDias(somarAnos(base, n + 1), -1), concessivoFim: somarDias(somarAnos(base, n + 2), -1) });
  }
  return lista;
}

/** CLT art. 130: dias de férias pelo número de faltas injustificadas no aquisitivo. */
export function diasDeDireito(faltas: number): number {
  if (faltas <= 5) return 30;
  if (faltas <= 14) return 24;
  if (faltas <= 23) return 18;
  if (faltas <= 32) return 12;
  return 0;
}

export const FAIXAS_ART130 = [
  { ate: 5, dias: 30 }, { ate: 14, dias: 24 }, { ate: 23, dias: 18 }, { ate: 32, dias: 12 },
] as const;

/** Faltas (datas AAAA-MM-DD) que caem no período. */
export const faltasNoPeriodo = (p: Pick<PeriodoAquisitivo, 'inicio' | 'fim'>, faltas: string[]) =>
  faltas.filter((d) => d >= p.inicio && d <= p.fim).length;

/** Meses de calendário que o período toca, como AAAA-MM. */
export function mesesDoPeriodo(p: Pick<PeriodoAquisitivo, 'inicio' | 'fim'>): string[] {
  const r: string[] = [];
  let [a, m] = partes(p.inicio);
  const [af, mf] = partes(p.fim);
  while (a < af || (a === af && m <= mf)) {
    r.push(`${a}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; a++; }
  }
  return r;
}

// ------------------------------------------------------------------ programação

export interface FeriasProgramada {
  id: string;
  empregadoId: string;
  empresaId: string;
  aquisitivoInicio: string;
  inicio: string;
  dias: number;
  abonoDias: number;
  avisoEm: string | null;
  pagamentoEm: string | null;
  observacao?: string | null;
}

export const fimDoGozo = (f: Pick<FeriasProgramada, 'inicio' | 'dias'>) => somarDias(f.inicio, f.dias - 1);
export const retornoDoGozo = (f: Pick<FeriasProgramada, 'inicio' | 'dias'>) => somarDias(f.inicio, f.dias);
/** Prazo do aviso (art. 135): 30 dias antes do início. */
export const avisoAte = (inicio: string) => somarDias(inicio, -30);

/**
 * Prazo do pagamento (art. 145): até 2 dias antes do início; sugere o dia útil
 * (seg–sex, sem feriado) igual ou anterior.
 */
export function pagamentoAte(inicio: string, feriados: Set<string> = new Set()): string {
  let d = somarDias(inicio, -2);
  while ([0, 6].includes(diaDaSemana(d)) || feriados.has(d)) d = somarDias(d, -1);
  return d;
}

export type EstadoPeriodo = 'aquisitivo' | 'aberto' | 'vencendo' | 'vencido' | 'quitado' | 'perdido' | 'suspenso';

export interface SituacaoPeriodo {
  periodo: PeriodoAquisitivo;
  faltas: number;
  direito: number;
  /** Dias já programados (gozo + abono), passados e futuros. */
  usados: number;
  /** Dias ainda sem programação. */
  saldo: number;
  gozo: FeriasProgramada[];
  estado: EstadoPeriodo;
  /** Último dia para começar o saldo sem cair em dobro. */
  limiteInicio: string | null;
  /** Dias programados que caem depois do fim do concessivo (pagos em dobro). */
  diasEmDobro: number;
}

export interface OpcoesSituacao {
  /** Antecedência do alerta "vencendo", em dias até o limite de início (padrão 60). */
  antecedencia?: number;
}

export const ANTECEDENCIA_PADRAO = 60;

/** Dias de uma programação que passam do fim do concessivo. */
export function diasDepoisDe(f: Pick<FeriasProgramada, 'inicio' | 'dias'>, limite: string): number {
  const fim = fimDoGozo(f);
  if (fim <= limite) return 0;
  return f.inicio > limite ? f.dias : diasEntre(limite, fim);
}

export function situacaoDoPeriodo(
  p: PeriodoAquisitivo, faltas: string[], programadas: FeriasProgramada[], hoje: string, o: OpcoesSituacao = {},
): SituacaoPeriodo {
  const nFaltas = faltasNoPeriodo(p, faltas);
  const direito = diasDeDireito(nFaltas);
  const gozo = programadas.filter((f) => f.aquisitivoInicio === p.inicio).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const usados = gozo.reduce((s, f) => s + f.dias + f.abonoDias, 0);
  const saldo = Math.max(0, direito - usados);
  const diasEmDobro = gozo.reduce((s, f) => s + diasDepoisDe(f, p.concessivoFim), 0);
  const limiteInicio = saldo > 0 ? somarDias(p.concessivoFim, -saldo + 1) : null;
  let estado: EstadoPeriodo;
  if (direito === 0) estado = 'perdido';
  else if (hoje <= p.fim) estado = 'aquisitivo';
  else if (saldo === 0) estado = 'quitado';
  else if (hoje > p.concessivoFim) estado = 'vencido';
  else if (limiteInicio && diasEntre(hoje, limiteInicio) <= (o.antecedencia ?? ANTECEDENCIA_PADRAO)) estado = 'vencendo';
  else estado = 'aberto';
  return { periodo: p, faltas: nFaltas, direito, usados, saldo, gozo, estado, limiteInicio, diasEmDobro };
}

/**
 * Todos os períodos do empregado até hoje (só os que ainda importam: os com saldo,
 * os em aquisição e os dos últimos 2 anos). Desligado: até o desligamento (o resto é
 * da rescisão). Sem admissão: lista vazia.
 */
export function situacaoFerias(
  e: Pick<Empregado, 'admissao' | 'aquisitivoBase' | 'situacao' | 'situacaoDesde'>,
  faltas: string[], programadas: FeriasProgramada[], hoje: string, o: OpcoesSituacao = {},
): SituacaoPeriodo[] {
  const base = baseAquisitivo(e);
  if (!base) return [];
  const ate = e.situacao === 'desligado' && e.situacaoDesde && e.situacaoDesde < hoje ? e.situacaoDesde : hoje;
  return periodosAquisitivos(base, ate).map((p) => situacaoDoPeriodo(p, faltas, programadas, hoje, o));
}

export const ROTULO_ESTADO: Record<EstadoPeriodo, string> = {
  aquisitivo: 'Em aquisição',
  aberto: 'A programar',
  vencendo: 'Vencendo',
  vencido: 'Vencidas (dobro)',
  quitado: 'Programadas',
  perdido: 'Sem direito (art. 130)',
  suspenso: 'Suspenso',
};

// ------------------------------------------------------------------ validar a programação

export interface PedidoFerias {
  aquisitivoInicio: string;
  inicio: string;
  dias: number;
  abonoDias: number;
  avisoEm?: string | null;
}

export interface ContextoFerias {
  empregado: Pick<Empregado, 'situacao' | 'situacaoDesde' | 'dsr' | 'admissao' | 'aquisitivoBase'>;
  /** Situação do período escolhido (já calculada com as programações existentes). */
  periodo: SituacaoPeriodo | null;
  /** Todas as programações ativas do empregado (para não sobrepor). */
  todas: FeriasProgramada[];
  feriados: Set<string>;
  hoje: string;
}

export interface ResultadoValidacao {
  erros: string[];
  avisos: string[];
  fim: string | null;
  retorno: string | null;
  avisoAte: string | null;
  pagamentoAte: string | null;
}

/** Motivo pelo qual o dia não serve para começar férias (art. 134 §3º), ou null. */
export function inicioVedado(inicio: string, dsr: number, feriados: Set<string>): string | null {
  for (const n of [1, 2]) {
    const d = somarDias(inicio, n);
    if (feriados.has(d)) return `o dia ${br(d)} é feriado e as férias não podem começar nos 2 dias antes dele (CLT art. 134 §3º)`;
    if (diaDaSemana(d) === dsr) return `${SEMANA[dsr]} é o repouso semanal e as férias não podem começar nos 2 dias antes dele (CLT art. 134 §3º)`;
  }
  return null;
}

/** Próximo dia (a partir de `desde`) em que as férias podem começar. */
export function proximoInicioPermitido(desde: string, dsr: number, feriados: Set<string>): string {
  let d = desde;
  for (let i = 0; i < 14 && (inicioVedado(d, dsr, feriados) || feriados.has(d) || diaDaSemana(d) === dsr); i++) d = somarDias(d, 1);
  return d;
}

export function validarProgramacao(pedido: PedidoFerias, ctx: ContextoFerias): ResultadoValidacao {
  const erros: string[] = [];
  const avisos: string[] = [];
  const r: ResultadoValidacao = { erros, avisos, fim: null, retorno: null, avisoAte: null, pagamentoAte: null };
  const { empregado: e, periodo: sp } = ctx;

  if (!isoOk(pedido.inicio)) erros.push('Informe a data de início.');
  const dias = Number(pedido.dias);
  const abono = Number(pedido.abonoDias ?? 0);
  if (!Number.isInteger(dias) || dias < 1) erros.push('Informe os dias de gozo.');
  if (!Number.isInteger(abono) || abono < 0) erros.push('Dias de abono inválidos.');
  if (!sp) erros.push('Escolha o período aquisitivo.');
  if (e.situacao === 'desligado') erros.push('Empregado desligado: férias entram na rescisão.');
  if (e.situacao === 'afastado') erros.push('Empregado afastado: registre o retorno antes de programar férias (não podem começar durante o afastamento).');
  if (erros.length || !sp) return r;

  const { periodo: p, direito } = sp;
  if (direito === 0) { erros.push(`Sem direito a férias neste período: ${sp.faltas} faltas injustificadas (CLT art. 130).`); return r; }

  r.fim = fimDoGozo({ inicio: pedido.inicio, dias });
  r.retorno = retornoDoGozo({ inicio: pedido.inicio, dias });
  r.avisoAte = avisoAte(pedido.inicio);
  r.pagamentoAte = pagamentoAte(pedido.inicio, ctx.feriados);

  // Períodos do mesmo aquisitivo (sem o que está sendo criado).
  const existentes = sp.gozo;
  const periodos = [...existentes.map((f) => f.dias), dias];
  const abonoTotal = existentes.reduce((s, f) => s + f.abonoDias, 0) + abono;
  const usados = sp.usados + dias + abono;
  const restante = direito - usados;
  const maxAbono = Math.floor(direito / 3);

  if (dias < 5) erros.push('Cada período de férias tem no mínimo 5 dias corridos (CLT art. 134 §1º).');
  if (abonoTotal > maxAbono) erros.push(`O abono pecuniário é de no máximo 1/3 do direito: ${maxAbono} dias (CLT art. 143).`);
  if (usados > direito) erros.push(`Passa do direito do período: ${direito} dias, ${sp.usados} já programados.`);
  if (periodos.length > 3) erros.push('As férias podem ser divididas em no máximo 3 períodos (CLT art. 134 §1º).');

  if (!erros.length) {
    if (direito < 14 && (existentes.length > 0 || restante > 0)) {
      erros.push(`Com direito a ${direito} dias (menos de 14, por faltas), as férias não podem ser fracionadas: programe todos de uma vez.`);
    } else if (restante > 0) {
      const tem14 = periodos.some((d) => d >= 14);
      if (periodos.length >= 3) erros.push(`Sobrariam ${restante} dia(s) sem período disponível (máximo de 3). Use todos os dias neste período.`);
      else if (restante < 5) erros.push(`Sobrariam ${restante} dia(s) — o próximo período precisaria de pelo menos 5. Ajuste para usar todos ou deixar 5 ou mais.`);
      else if (!tem14 && restante < 14) erros.push('Um dos períodos precisa ter 14 dias ou mais (CLT art. 134 §1º). Aumente este período ou deixe 14 dias para o próximo.');
    } else if (!periodos.some((d) => d >= 14) && direito >= 14) {
      erros.push('Um dos períodos precisa ter 14 dias ou mais (CLT art. 134 §1º).');
    }
  }

  const vedado = inicioVedado(pedido.inicio, e.dsr, ctx.feriados);
  if (vedado) erros.push(`Não pode começar em ${br(pedido.inicio)}: ${vedado}.`);
  if (ctx.feriados.has(pedido.inicio)) erros.push(`${br(pedido.inicio)} é feriado: escolha outro dia para começar.`);
  else if (diaDaSemana(pedido.inicio) === e.dsr) erros.push(`${br(pedido.inicio)} é o dia do repouso semanal: escolha outro dia para começar.`);

  const sobrepoe = ctx.todas.find((f) => f.inicio <= r.fim! && fimDoGozo(f) >= pedido.inicio);
  if (sobrepoe) erros.push(`Sobrepõe as férias de ${br(sobrepoe.inicio)} a ${br(fimDoGozo(sobrepoe))}.`);
  if (e.admissao && pedido.inicio < e.admissao) erros.push('O início é antes da admissão.');

  // Avisos (não bloqueiam).
  if (pedido.inicio <= p.fim) avisos.push(`Começa antes de completar o período aquisitivo (${br(p.fim)}): a CLT não prevê férias antecipadas — é risco do empregador.`);
  const dobro = diasDepoisDe({ inicio: pedido.inicio, dias }, p.concessivoFim);
  if (dobro > 0) avisos.push(`${dobro} dia(s) depois do fim do período concessivo (${br(p.concessivoFim)}): pagos em dobro (CLT art. 137; Súmula 81 TST).`);
  const dataAviso = pedido.avisoEm && isoOk(pedido.avisoEm) ? pedido.avisoEm : ctx.hoje;
  if (diasEntre(dataAviso, pedido.inicio) < 30) avisos.push(`O aviso deve ser dado com pelo menos 30 dias de antecedência — até ${br(r.avisoAte)} (CLT art. 135).`);
  if (diasEntre(ctx.hoje, r.pagamentoAte) < 0) avisos.push(`O pagamento deveria sair até ${br(r.pagamentoAte)} (2 dias antes, CLT art. 145). Atraso gera multa administrativa (art. 153).`);
  if (periodos.length > 1 || restante > 0) avisos.push('Fracionar as férias depende da concordância do empregado (CLT art. 134 §1º).');
  if (abono > 0) avisos.push('O abono é pedido pelo empregado; se pedido até 15 dias antes do fim do aquisitivo, a empresa não pode negar (CLT art. 143 §1º).');
  return r;
}

// ------------------------------------------------------------------ alertas da ficha e da lista

export type NivelAlerta = 'perigo' | 'aviso' | 'info';

export interface AlertaFerias {
  nivel: NivelAlerta;
  /** Texto curto para o selo. */
  rotulo: string;
  texto: string;
  /** Data que ordena e vai para a agenda. */
  data: string;
  periodoInicio?: string;
}

const MESES_SUSPENSAO = 180;

/**
 * Alertas de férias do empregado. Desligado não alerta (é da rescisão). Afastado por
 * doença/acidente há mais de 6 meses: suspende (art. 133 IV — o novo aquisitivo começa
 * no retorno; a contadora ajusta o início do aquisitivo na ficha).
 */
export function alertasFerias(
  e: Pick<Empregado, 'admissao' | 'aquisitivoBase' | 'situacao' | 'situacaoDesde' | 'afastamentoTipo'>,
  periodos: SituacaoPeriodo[], hoje: string,
): AlertaFerias[] {
  if (e.situacao === 'desligado') return [];
  if (!e.admissao) {
    return [{ nivel: 'info', rotulo: 'Sem admissão', texto: 'Cadastre a data de admissão para calcular férias e 13º.', data: hoje }];
  }
  if (e.situacao === 'afastado' && (e.afastamentoTipo === 'doenca' || e.afastamentoTipo === 'acidente')
    && e.situacaoDesde && diasEntre(e.situacaoDesde, hoje) > MESES_SUSPENSAO) {
    return [{ nivel: 'info', rotulo: 'Aquisitivo suspenso', texto: 'Afastado há mais de 6 meses (CLT art. 133 IV): o novo período aquisitivo começa no retorno. Ajuste o início do aquisitivo na volta.', data: hoje }];
  }
  const r: AlertaFerias[] = [];
  for (const s of periodos) {
    const ref = `${br(s.periodo.inicio)} a ${br(s.periodo.fim)}`;
    if (s.estado === 'vencido') {
      r.push({ nivel: 'perigo', rotulo: 'Férias vencidas', periodoInicio: s.periodo.inicio, data: s.periodo.concessivoFim,
        texto: `${s.saldo} dia(s) do período ${ref} venceram em ${br(s.periodo.concessivoFim)}: pagamento em dobro (CLT art. 137).` });
    } else if (s.estado === 'vencendo' && s.limiteInicio) {
      r.push({ nivel: 'aviso', rotulo: 'Férias vencendo', periodoInicio: s.periodo.inicio, data: s.limiteInicio,
        texto: `Programe ${s.saldo} dia(s) do período ${ref}: para não pagar em dobro, o gozo precisa começar até ${br(s.limiteInicio)} (aviso até ${br(avisoAte(s.limiteInicio))}).` });
    }
    if (s.diasEmDobro > 0 && s.estado !== 'vencido') {
      r.push({ nivel: 'aviso', rotulo: 'Dias em dobro', periodoInicio: s.periodo.inicio, data: s.periodo.concessivoFim,
        texto: `${s.diasEmDobro} dia(s) programados do período ${ref} caem depois de ${br(s.periodo.concessivoFim)}: pagos em dobro.` });
    }
    if (e.situacao === 'afastado' && s.estado !== 'quitado' && s.estado !== 'aquisitivo' && s.estado !== 'perdido') {
      r.push({ nivel: 'info', rotulo: 'Afastado', periodoInicio: s.periodo.inicio, data: hoje,
        texto: 'Empregado afastado: as férias só podem ser programadas depois do retorno.' });
    }
  }
  return r.sort((a, b) => ({ perigo: 0, aviso: 1, info: 2 }[a.nivel] - { perigo: 0, aviso: 1, info: 2 }[b.nivel]) || a.data.localeCompare(b.data));
}

/**
 * Próximo marco de uma programação ainda por vir: dar o aviso até, pagar até ou o
 * início. O marco já passado some (o sistema não registra se o aviso foi dado).
 */
export function proximoMarco(f: Pick<FeriasProgramada, 'inicio' | 'avisoEm' | 'pagamentoEm'>, hoje: string, feriados: Set<string> = new Set()):
  { marco: 'aviso' | 'pagamento' | 'inicio'; data: string } | null {
  const aviso = f.avisoEm ?? avisoAte(f.inicio);
  const pag = f.pagamentoEm ?? pagamentoAte(f.inicio, feriados);
  if (!f.avisoEm && aviso >= hoje) return { marco: 'aviso', data: aviso };
  if (pag >= hoje) return { marco: 'pagamento', data: pag };
  if (f.inicio >= hoje) return { marco: 'inicio', data: f.inicio };
  return null;
}

export const ROTULO_MARCO = { aviso: 'dar o aviso até', pagamento: 'pagar até', inicio: 'início' } as const;
