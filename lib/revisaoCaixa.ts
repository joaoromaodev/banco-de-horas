// Revisão antes da conferência do Livro Caixa (Sprint 5, Frente A).
//
// Regras PURAS, determinísticas e explicáveis: cada alerta diz em uma frase por
// que apareceu. Só ALERTA, nunca bloqueia — no espírito do módulo (saldo negativo
// e CPF inválido já eram "só avisa"). Quem carrega os dados é
// lib/caixaInteligente.ts (`revisarExercicio`); a tela de conferência mostra o selo.
//
// Desempenho: tudo é agrupamento por Map — O(n log n) pela ordenação do saldo.
// Milhares de lançamentos revisam em milissegundos.
import { documentoValido } from './cobranca';

export type NivelAlerta = 'alto' | 'medio' | 'baixo';

export type CodigoAlerta =
  | 'duplicado' | 'quase_duplicado' | 'valor_fora_padrao' | 'natureza_invertida'
  | 'sem_pagador' | 'documento_invalido' | 'juros_multa_recorrentes' | 'saldo_negativo'
  | 'sem_titular' | 'mes_sem_lancamento' | 'data_futura' | 'alterado_apos_confirmar';

export interface Alerta {
  codigo: CodigoAlerta;
  nivel: NivelAlerta;
  /** Rótulo curto do selo ("Duplicado?"). */
  rotulo: string;
  /** A frase que explica. */
  motivo: string;
}

export interface AlertaGeral extends Alerta { mes?: number }

export interface LancamentoRevisao {
  id: string;
  data: string; // AAAA-MM-DD
  historico: string;
  complemento: string | null;
  contaId: string | null;
  entrada: number;
  saida: number;
  juros: number;
  multa: number;
  pagadorNome: string | null;
  pagadorDocumento: string | null;
  criadoEm?: string;
  atualizadoEm?: string | null;
}

export interface ContaRevisao { id: string; codigo: string; nome: string; natureza: 'receita' | 'despesa' }

export interface OpcoesRevisao {
  ano: number;
  saldoInicial: number;
  identificaPagador: boolean;
  /** Hoje (AAAA-MM-DD, fuso de Belém) — define até que mês cobrar "mês sem lançamento". */
  hoje: string;
  /** Meses já confirmados (libera o resumo ao cliente) e quando — para "alterado depois de confirmar". */
  confirmados?: { mes: number; em: string }[];
  /** Lançamentos de exercícios anteriores: só entram no padrão de valor da conta. */
  anteriores?: LancamentoRevisao[];
}

export interface RevisaoLancamento { id: string; risco: number; alertas: Alerta[] }

export interface ResultadoRevisao {
  /** Só os lançamentos que têm alerta. */
  porLancamento: Record<string, RevisaoLancamento>;
  gerais: AlertaGeral[];
  resumo: { alto: number; medio: number; baixo: number; lancamentos: number };
}

/** Quanto cada nível pesa no risco que ordena a fila. */
export const PESO_NIVEL: Record<NivelAlerta, number> = { alto: 5, medio: 2, baixo: 1 };

// Limiares — explicáveis em uma frase cada (ver docs/livro-caixa.md).
/** Quase-duplicidade: mesmo valor e conta a até N dias. */
export const DIAS_QUASE_DUPLICADO = 3;
/** O mesmo documento só conta como repetido dentro desta janela (dias). */
export const DIAS_MESMO_DOCUMENTO = 60;
/** Carência para cobrar "mês sem lançamento": dias depois do fim do mês. */
export const CARENCIA_MES_DIAS = 10;
/** Padrão de valor: só com pelo menos N outros lançamentos da conta. */
export const MINIMO_PADRAO = 4;
/** Fora do padrão: N vezes acima ou abaixo da mediana… */
export const FATOR_FORA_PADRAO = 3;
/** …e longe da dispersão normal da conta (desvio robusto em escala log). */
export const Z_FORA_PADRAO = 3;
/** Juros/multa recorrentes: em N meses (contando o atual) de uma janela de 6. */
export const MESES_JUROS_RECORRENTES = 3;

const MESES_LONGOS = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const brl = (n: number) =>
  `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const mesDe = (iso: string) => Number(iso.slice(5, 7));
const cent = (n: number) => Math.round(n * 100);

/** A saída efetiva: juros e multa são saídas adicionais (migração 0005). */
const saidaEfetiva = (l: LancamentoRevisao) => (l.saida || 0) + (l.juros || 0) + (l.multa || 0);
const direcao = (l: LancamentoRevisao) => (l.entrada > 0 ? 'entrada' : 'saida');
const valor = (l: LancamentoRevisao) => (l.entrada > 0 ? l.entrada : saidaEfetiva(l));

function diasEntre(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/** Transferência com o banco (depósito/retirada): legitimamente sem titular. */
export function ehTransferencia(historico: string): boolean {
  return /retirada|dep[oó]sito|transfer[eê]ncia|saque/i.test(historico);
}

/**
 * O documento que o complemento cita: um número de 3+ dígitos DEPOIS de NF, nota,
 * recibo, boleto, RPS, cupom, pedido, fatura ou duplicata ("NF 1590" → "nf 1590").
 * Número solto não conta: "sala 1203" ou "UC 123456" se repetem todo mês na
 * mesma conta sem ser o mesmo pagamento.
 */
export function chaveDocumento(complemento: string | null): string | null {
  const c = String(complemento ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const m = c.match(/\b(nfs?-?e?|nota(?: fiscal)?|recibo|boleto|rps|cupom|pedido|fatura|duplicata)\b\.?\s*(?:n[oº°.]*\s*)?(\d{3,})/);
  if (!m) return null;
  const tipo = m[1].startsWith('nf') || m[1].startsWith('nota') ? 'nf' : m[1];
  return `${tipo} ${m[2].replace(/^0+/, '')}`;
}

function mediana(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Revisa os lançamentos de um exercício. `lancamentos` são os do exercício
 * revisado; `opcoes.anteriores` só alimentam o padrão de valor.
 */
export function revisarLancamentos(
  lancamentos: LancamentoRevisao[], contas: ContaRevisao[], opcoes: OpcoesRevisao,
): ResultadoRevisao {
  const contaPorId = new Map(contas.map((c) => [c.id, c]));
  const alertas = new Map<string, Alerta[]>();
  const add = (id: string, a: Alerta) => {
    const lista = alertas.get(id) ?? [];
    if (!lista.some((x) => x.codigo === a.codigo)) lista.push(a);
    alertas.set(id, lista);
  };
  const nomeConta = (id: string | null) => {
    const c = id ? contaPorId.get(id) : undefined;
    return c ? `${c.codigo} ${c.nome}` : 'sem conta';
  };
  const gerais: AlertaGeral[] = [];

  // ------------------------------------------------ duplicidade
  // Mesma data + direção + valor + conta (+ pagador). Tudo por grupo, em tempo linear.
  const agrupar = (lista: LancamentoRevisao[], chave: (l: LancamentoRevisao) => string | null) => {
    const m = new Map<string, LancamentoRevisao[]>();
    for (const l of lista) {
      const k = chave(l);
      if (k === null) continue;
      const g = m.get(k);
      if (g) g.push(l); else m.set(k, [l]);
    }
    return m;
  };
  const compl = (l: LancamentoRevisao) => String(l.complemento ?? '').trim().toLowerCase();
  // Quem pagou entra na chave: duas consultas de R$ 800 de pacientes diferentes
  // no mesmo dia são o normal de uma clínica, não duplicidade.
  const pagador = (l: LancamentoRevisao) =>
    String(l.pagadorDocumento ?? '').replace(/\D/g, '') || String(l.pagadorNome ?? '').trim().toLowerCase();

  for (const g of agrupar(lancamentos, (l) => `${l.data}|${direcao(l)}|${cent(valor(l))}|${l.contaId ?? ''}|${pagador(l)}`).values()) {
    if (g.length < 2) continue;
    // "Mesmo documento" = outro lançamento do grupo com complemento igual ou vazio.
    const contagem = new Map<string, number>();
    for (const l of g) contagem.set(compl(l), (contagem.get(compl(l)) ?? 0) + 1);
    const vazios = contagem.get('') ?? 0;
    for (const l of g) {
      const c = compl(l);
      const mesmoDoc = c === '' || vazios > 0 || (contagem.get(c) ?? 0) > 1;
      const texto = `${diaMes(l.data)} · ${brl(valor(l))} · ${nomeConta(l.contaId)}`;
      const outros = g.length - 1;
      // Venda de balcão: duas entradas iguais no dia, sem pagador nem complemento, são comuns.
      const balcao = direcao(l) === 'entrada' && !pagador(l) && c === '';
      if (mesmoDoc && balcao) {
        add(l.id, {
          codigo: 'quase_duplicado', nivel: 'medio', rotulo: 'Parece repetido',
          motivo: `Entrada igual a outra do mesmo dia (${texto}), sem pagador nem complemento — confira se não foi lançada duas vezes.`,
        });
      } else if (mesmoDoc) {
        add(l.id, {
          codigo: 'duplicado', nivel: 'alto', rotulo: 'Duplicado?',
          motivo: `Há ${outros === 1 ? 'outro lançamento' : `${outros} outros lançamentos`} com a mesma data, valor e conta (${texto}).`,
        });
      } else {
        add(l.id, {
          codigo: 'quase_duplicado', nivel: 'medio', rotulo: 'Parece repetido',
          motivo: `Mesma data, valor e conta de outro lançamento (${texto}), com complemento diferente — confira se não é o mesmo pagamento.`,
        });
      }
    }
  }

  // Quase-duplicidade (1): mesmo valor + conta + direção (+ pagador) a até 3 dias (dias diferentes).
  // Só saídas (pagar duas vezes é o risco real) e entradas com pagador; fora
  // transferências (sem titular), onde valor redondo repetido é o normal.
  for (const g of agrupar(lancamentos, (l) =>
    (l.contaId && (direcao(l) === 'saida' || pagador(l)) ? `${direcao(l)}|${cent(valor(l))}|${l.contaId}|${pagador(l)}` : null)).values()) {
    if (g.length < 2) continue;
    // blocos por data, em ordem; basta olhar o bloco vizinho de cada lado
    const blocos = [...agrupar(g, (l) => l.data).entries()].sort((a, b) => a[0].localeCompare(b[0]));
    blocos.forEach(([data, ls], k) => {
      const viz = [blocos[k - 1], blocos[k + 1]].find((b) => b && diasEntre(b[0], data) <= DIAS_QUASE_DUPLICADO);
      if (!viz) return;
      for (const l of ls) {
        add(l.id, {
          codigo: 'quase_duplicado', nivel: 'medio', rotulo: 'Parece repetido',
          motivo: `Mesmo valor e conta de um lançamento de ${diaMes(viz[0])} (${brl(valor(l))} · ${nomeConta(l.contaId)}) — confira se não foi lançado duas vezes.`,
        });
      }
    });
  }

  // Quase-duplicidade (2): o mesmo documento ("NF 1590") lançado duas vezes na mesma conta
  // — em outro dia ou com outro valor (igual em tudo já é "duplicado").
  for (const g of agrupar(lancamentos, (l) => {
    const doc = chaveDocumento(l.complemento);
    return doc ? `${direcao(l)}|${l.contaId ?? ''}|${doc}` : null;
  }).values()) {
    if (g.length < 2) continue;
    const chaveDV = (x: LancamentoRevisao) => `${x.data}|${cent(valor(x))}`;
    // em ordem de data, basta o vizinho mais próximo de cada lado
    const ord = [...g].sort((x, y) => x.data.localeCompare(y.data));
    ord.forEach((l, k) => {
      const o = [ord[k - 1], ord[k + 1]].find((x) =>
        x && chaveDV(x) !== chaveDV(l) && diasEntre(x.data, l.data) <= DIAS_MESMO_DOCUMENTO);
      if (!o) return;
      add(l.id, {
        codigo: 'quase_duplicado', nivel: 'medio', rotulo: 'Parece repetido',
        motivo: `O mesmo documento ("${String(l.complemento).trim()}") também aparece em ${diaMes(o.data)} na mesma conta.`,
      });
    });
  }

  // ------------------------------------------------ valor fora do padrão da conta
  // Mediana e desvio robusto (MAD) em escala log, por conta e direção. Grupo
  // pequeno: calcula sem o próprio lançamento; grupo grande (≥ 30): o próprio
  // pesa nada na mediana e as estatísticas saem uma vez só.
  const porConta = agrupar([...lancamentos, ...(opcoes.anteriores ?? [])],
    (l) => (l.contaId && valor(l) > 0 ? `${l.contaId}|${direcao(l)}` : null));
  const estat = (vs: number[]) => {
    const med = mediana(vs);
    const logs = vs.map((v) => Math.log(v));
    const medLog = mediana(logs);
    const mad = mediana(logs.map((x) => Math.abs(x - medLog))) * 1.4826 || 0.1;
    return { med, medLog, mad, n: vs.length };
  };
  const estatGrupo = new Map<string, ReturnType<typeof estat>>();
  for (const l of lancamentos) {
    if (!l.contaId || valor(l) <= 0) continue;
    const k = `${l.contaId}|${direcao(l)}`;
    const grupo = porConta.get(k) ?? [];
    if (grupo.length - 1 < MINIMO_PADRAO) continue;
    let e: ReturnType<typeof estat>;
    if (grupo.length >= 30) {
      e = estatGrupo.get(k) ?? estat(grupo.map(valor));
      estatGrupo.set(k, e);
      e = { ...e, n: grupo.length - 1 };
    } else {
      e = estat(grupo.filter((x) => x.id !== l.id).map(valor));
    }
    const z = Math.abs(Math.log(valor(l)) - e.medLog) / e.mad;
    const fator = valor(l) / e.med;
    if (z >= Z_FORA_PADRAO && (fator >= FATOR_FORA_PADRAO || fator <= 1 / FATOR_FORA_PADRAO)) {
      const x = fator >= 1
        ? `${fator.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}× o habitual`
        : `${(1 / fator).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}× abaixo do habitual`;
      add(l.id, {
        codigo: 'valor_fora_padrao', nivel: 'medio', rotulo: 'Valor fora do padrão',
        motivo: `${brl(valor(l))} é ${x} em ${nomeConta(l.contaId)} nesta empresa (mediana ${brl(e.med)} em ${e.n} lançamentos).`,
      });
    }
  }

  // ------------------------------------------------ natureza x direção
  // Alto, salvo quando o complemento diz que é estorno/devolução (aí é médio e o
  // motivo aponta a conta certa).
  const estorno = (l: LancamentoRevisao) =>
    /estorn|devolu|reembols|ressarc/i.test(`${l.complemento ?? ''} ${l.historico}`);
  for (const l of lancamentos) {
    const c = l.contaId ? contaPorId.get(l.contaId) : undefined;
    if (!c) continue;
    const e = estorno(l);
    if (c.natureza === 'receita' && direcao(l) === 'saida') {
      add(l.id, {
        codigo: 'natureza_invertida', nivel: e ? 'medio' : 'alto', rotulo: 'Receita como saída',
        motivo: e
          ? `${nomeConta(l.contaId)} é conta de receita, e a devolução ao cliente é uma saída — confira a conta com a contabilidade.`
          : `${nomeConta(l.contaId)} é conta de receita, mas o lançamento é uma saída.`,
      });
    } else if (c.natureza === 'despesa' && direcao(l) === 'entrada') {
      add(l.id, {
        codigo: 'natureza_invertida', nivel: e ? 'medio' : 'alto', rotulo: 'Despesa como entrada',
        motivo: e
          ? `${nomeConta(l.contaId)} é conta de despesa, mas a devolução entrou no caixa — o usual é a conta de receita "Recuperação de despesas".`
          : `${nomeConta(l.contaId)} é conta de despesa, mas o lançamento é uma entrada.`,
      });
    }
  }

  // ------------------------------------------------ data futura
  for (const l of lancamentos) {
    if (l.data > opcoes.hoje) {
      add(l.id, {
        codigo: 'data_futura', nivel: 'alto', rotulo: 'Data futura',
        motivo: `A data (${diaMes(l.data)}) é depois de hoje — erro de dia, mês ou ano?`,
      });
    }
  }

  // ------------------------------------------------ alterado depois de confirmar o mês
  // A edição é sempre livre (decisão dela); este é o sinal de que o resumo já
  // liberado ao cliente mudou.
  const confirmadoEm = new Map((opcoes.confirmados ?? []).map((c) => [c.mes, c.em]));
  for (const l of lancamentos) {
    const em = confirmadoEm.get(mesDe(l.data));
    if (!em) continue;
    const quando = Date.parse(em);
    const mexeu = [l.criadoEm, l.atualizadoEm].some((x) => !!x && Date.parse(x) > quando);
    if (mexeu) {
      add(l.id, {
        codigo: 'alterado_apos_confirmar', nivel: 'alto', rotulo: 'Mudou após confirmar',
        motivo: `Lançado ou alterado depois que ${MESES_LONGOS[mesDe(l.data) - 1]} foi confirmado — o resumo que o cliente já viu mudou.`,
      });
    }
  }

  // ------------------------------------------------ pagador (Carnê-Leão / DMED)
  if (opcoes.identificaPagador) {
    for (const l of lancamentos) {
      if (direcao(l) !== 'entrada' || ehTransferencia(l.historico)) continue;
      const temNome = !!String(l.pagadorNome ?? '').trim();
      const doc = String(l.pagadorDocumento ?? '').replace(/\D/g, '');
      if (!temNome || !doc) {
        const falta = !temNome && !doc ? 'o nome e o CPF/CNPJ' : !temNome ? 'o nome' : 'o CPF/CNPJ';
        add(l.id, {
          codigo: 'sem_pagador', nivel: 'medio', rotulo: 'Falta o pagador',
          motivo: `Entrada sem ${falta} de quem pagou — o Carnê-Leão/DMED precisa.`,
        });
      } else if (!documentoValido(doc)) {
        add(l.id, {
          codigo: 'documento_invalido', nivel: 'medio', rotulo: 'CPF/CNPJ inválido',
          motivo: 'O CPF/CNPJ do pagador tem dígito verificador inválido.',
        });
      }
    }
  }

  // ------------------------------------------------ sem conta titular
  for (const l of lancamentos) {
    if (l.contaId || ehTransferencia(l.historico)) continue;
    add(l.id, {
      codigo: 'sem_titular', nivel: 'baixo', rotulo: 'Sem conta titular',
      motivo: 'Lançamento sem conta titular — só faz sentido em depósito ou retirada da conta corrente.',
    });
  }

  // ------------------------------------------------ juros/multa recorrentes
  const mesesComJuros = new Map<number, number>(); // mês → total de juros+multa
  for (const l of lancamentos) {
    const jm = (l.juros || 0) + (l.multa || 0);
    if (jm > 0) mesesComJuros.set(mesDe(l.data), (mesesComJuros.get(mesDe(l.data)) ?? 0) + jm);
  }
  for (const l of lancamentos) {
    if ((l.juros || 0) + (l.multa || 0) <= 0) continue;
    const m = mesDe(l.data);
    const naJanela = [...mesesComJuros.keys()].filter((x) => x <= m && x > m - 6).length;
    if (naJanela >= MESES_JUROS_RECORRENTES) {
      add(l.id, {
        codigo: 'juros_multa_recorrentes', nivel: 'baixo', rotulo: 'Juros/multa de novo',
        motivo: `Juros ou multa em ${naJanela} dos últimos 6 meses — vale rever o vencimento das contas.`,
      });
    }
  }
  if (mesesComJuros.size >= MESES_JUROS_RECORRENTES) {
    const total = [...mesesComJuros.values()].reduce((s, v) => s + v, 0);
    gerais.push({
      codigo: 'juros_multa_recorrentes', nivel: 'baixo', rotulo: 'Juros/multa recorrentes',
      motivo: `Juros ou multa em ${mesesComJuros.size} meses do exercício (${brl(total)} no total).`,
    });
  }

  // ------------------------------------------------ saldo negativo
  // Pelo saldo do FIM DO DIA: lançar os pagamentos antes dos recebimentos do
  // mesmo dia não é caixa negativo. O selo vai no último lançamento do dia.
  const porDia = [...agrupar(lancamentos, (l) => l.data).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  let saldo = opcoes.saldoInicial;
  let negativo = false;
  let dias = 0;
  let primeiro: LancamentoRevisao | null = null;
  for (const [, doDia] of porDia) {
    for (const l of doDia) saldo += l.entrada - saidaEfetiva(l);
    if (saldo < -0.004) {
      if (!negativo) {
        const ultimo = doDia.reduce((u, l) => (String(l.criadoEm ?? '') >= String(u.criadoEm ?? '') ? l : u));
        dias++;
        primeiro ??= ultimo;
        add(ultimo.id, {
          codigo: 'saldo_negativo', nivel: 'medio', rotulo: 'Saldo negativo',
          motivo: `O caixa fecha o dia ${diaMes(ultimo.data)} negativo (${brl(saldo)}). Falta alguma entrada?`,
        });
      }
      negativo = true;
    } else {
      negativo = false;
    }
  }
  if (primeiro) {
    gerais.push({
      codigo: 'saldo_negativo', nivel: 'medio', rotulo: 'Saldo negativo', mes: mesDe(primeiro.data),
      motivo: `O saldo fica negativo ${dias === 1 ? 'uma vez' : `${dias} vezes`} no exercício — a primeira em ${diaMes(primeiro.data)}.`,
    });
  }

  // ------------------------------------------------ mês sem lançamento
  // Cobra os meses encerrados há mais de 10 dias (o cliente lança no começo do
  // mês seguinte). O último mês cobrado é o que terminou antes de hoje − carência.
  const limite = new Date(Date.parse(`${opcoes.hoje}T00:00:00Z`) - CARENCIA_MES_DIAS * 86_400_000);
  const anoLimite = limite.getUTCFullYear();
  const mesLimite = limite.getUTCMonth() + 1; // este ainda está na carência ou em curso
  const ultimoMes = opcoes.ano < anoLimite ? 12 : opcoes.ano === anoLimite ? mesLimite - 1 : 0;
  if (lancamentos.length > 0 && ultimoMes > 0) {
    const comMovimento = new Set(lancamentos.map((l) => mesDe(l.data)));
    const vazios = Array.from({ length: ultimoMes }, (_, i) => i + 1).filter((m) => !comMovimento.has(m));
    for (const m of vazios) {
      gerais.push({
        codigo: 'mes_sem_lancamento', nivel: 'medio', rotulo: 'Mês sem lançamento', mes: m,
        motivo: `Nenhum lançamento em ${MESES_LONGOS[m - 1]} — a empresa não movimentou o caixa ou ainda não lançou?`,
      });
    }
  }

  // ------------------------------------------------ consolida
  const porLancamento: Record<string, RevisaoLancamento> = {};
  const resumo = { alto: 0, medio: 0, baixo: 0, lancamentos: 0 };
  for (const [id, lista] of alertas) {
    lista.sort((a, b) => PESO_NIVEL[b.nivel] - PESO_NIVEL[a.nivel]);
    porLancamento[id] = { id, alertas: lista, risco: lista.reduce((s, a) => s + PESO_NIVEL[a.nivel], 0) };
    resumo.lancamentos++;
    for (const a of lista) resumo[a.nivel]++;
  }
  return { porLancamento, gerais, resumo };
}

/** O nível mais grave de um lançamento revisado (para a cor do selo). */
export function nivelMaisAlto(r: RevisaoLancamento | undefined): NivelAlerta | null {
  if (!r || r.alertas.length === 0) return null;
  return r.alertas.reduce<NivelAlerta>((m, a) => (PESO_NIVEL[a.nivel] > PESO_NIVEL[m] ? a.nivel : m), 'baixo');
}
