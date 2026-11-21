// Alerta de limite de faturamento — MEI e Simples Nacional. Regras PURAS (sem I/O,
// testadas em tests/limiteFaturamento.test.ts). A leitura do caixa está em
// lib/limiteFaturamentoServidor.ts. Ver docs/resumo-cliente.md.
//
// É uma ESTIMATIVA pelo caixa: soma as entradas classificadas em conta de receita.
// Nunca conclui sozinho que a empresa estourou o limite nem manda desenquadrar —
// quem decide é a contadora (a receita bruta legal tem outras regras: notas
// emitidas, regime de competência no Presumido etc.). Por isso o texto é sempre
// "estimativa pelo caixa — confirme".

/** Regimes que têm limite de faturamento acompanhado aqui. */
export type RegimeLimite = 'mei' | 'simples';

export const AVISO_ESTIMATIVA = 'Estimativa pelo caixa — confirme com a contabilidade antes de decidir qualquer coisa.';

// ------------------------------------------------------------------ vigência
//
// TODOS os valores legais ficam aqui, com a data a partir da qual valem. Mudou a
// lei? Acrescente uma vigência nova NO FIM da lista (a que tem `desde` mais
// recente e ≤ hoje é a usada). Não espalhe número pelo código.

export interface Vigencia {
  /** AAAA-MM-DD — a partir de quando estes valores valem. */
  desde: string;
  /** Fonte para a contadora conferir. */
  fonte: string;
  mei: {
    /** Receita bruta anual (ano-calendário). */
    limiteAnual: number;
    /** No ano de abertura: valor por mês de atividade (fração de mês conta como mês inteiro). */
    limiteMensalNoAnoDeAbertura: number;
    /** Excesso acima do qual o desenquadramento é retroativo (0,2 = 20%). */
    margemRetroativa: number;
  };
  simples: {
    /** Limite geral (receita bruta dos últimos 12 meses / do ano-calendário). */
    limiteAnual: number;
    /** Sublimite de receita bruta para ICMS/ISS no Simples (a UF/município pode adotar um menor). */
    sublimite: number;
    /** No ano de início de atividade: valor por mês (limite geral e sublimite). */
    limiteMensalNoAnoDeInicio: number;
    sublimiteMensalNoAnoDeInicio: number;
    /** Excesso acima do qual os efeitos são retroativos ao início do ano (0,2 = 20%). */
    margemRetroativa: number;
    /** Teto de cada faixa da tabela (Anexos I a V) pela receita bruta dos últimos 12 meses. */
    faixas: number[];
  };
}

const BASE_SIMPLES: Vigencia['simples'] = {
  limiteAnual: 4_800_000, sublimite: 3_600_000,
  limiteMensalNoAnoDeInicio: 400_000, sublimiteMensalNoAnoDeInicio: 300_000,
  margemRetroativa: 0.2,
  faixas: [180_000, 360_000, 720_000, 1_800_000, 3_600_000, 4_800_000],
};

export const VIGENCIAS: Vigencia[] = [
  {
    desde: '2018-01-01',
    fonte: 'LC 123/2006, arts. 3º, 18-A e 19 (redação da LC 155/2016)',
    mei: { limiteAnual: 81_000, limiteMensalNoAnoDeAbertura: 6_750, margemRetroativa: 0.2 },
    simples: BASE_SIMPLES,
  },
  // LC 238/2026 (21/10/2026), segundo a revisão do contador: MEI sobe para R$ 110 mil em 2027 e
  // R$ 140 mil a partir de 2028 (proporcional: valor ÷ 12 por mês). Simples sem mudança. CONFIRA o
  // texto final da lei (sobretudo 2028) — ver docs/resumo-cliente.md.
  ...[
    { desde: '2027-01-01', limiteAnual: 110_000 },
    { desde: '2028-01-01', limiteAnual: 140_000 },
  ].map((n): Vigencia => ({
    desde: n.desde,
    fonte: 'LC 123/2006, art. 18-A (redação da LC 238/2026) — conferir o texto final',
    mei: { limiteAnual: n.limiteAnual, limiteMensalNoAnoDeAbertura: Math.round((n.limiteAnual / 12) * 100) / 100, margemRetroativa: 0.2 },
    simples: BASE_SIMPLES,
  })),
];

/** Vigência aplicável em `data` (a mais recente que já começou; antes da primeira, usa a primeira). */
export function vigenciaEm(data: string): Vigencia {
  const ordenadas = [...VIGENCIAS].sort((a, b) => a.desde.localeCompare(b.desde));
  let v = ordenadas[0];
  for (const x of ordenadas) if (x.desde <= data) v = x;
  return v;
}

/** Percentuais que acendem cada nível. */
export const PERCENTUAIS = { atencao: 0.8, limite: 1 } as const;

// --------------------------------------------------------------------- tipos

export type NivelLimite = 'ok' | 'atencao' | 'excedido' | 'retroativo';
/** Ordem de gravidade, para tirar o pior de uma lista. */
export const ORDEM_NIVEL: Record<NivelLimite, number> = { ok: 0, atencao: 1, excedido: 2, retroativo: 3 };

export type ChaveMedida = 'mei_ano' | 'simples_limite' | 'simples_sublimite' | 'simples_faixa';

export interface MedidaLimite {
  chave: ChaveMedida;
  rotulo: string;
  /** Receita estimada (R$). */
  valor: number;
  /** Limite comparado (R$). */
  limite: number;
  /** valor / limite (1 = 100%). */
  percentual: number;
  nivel: NivelLimite;
  /** Frase pronta para a tela e o e-mail; sempre fala em "estimativa". */
  mensagem: string;
}

export interface EntradaLimite {
  regime: RegimeLimite;
  /** AAAA-MM-DD. */
  hoje: string;
  /** Receita estimada por mês, chave AAAA-MM. Mês ausente = zero. */
  receitaPorMes: Record<string, number>;
  /** Data de abertura (AAAA-MM-DD), quando a contadora informou. */
  abertura?: string | null;
  /** Primeiro mês (AAAA-MM) com dados no caixa; antes dele a soma é desconhecida. */
  primeiroMesDados?: string | null;
}

export interface AlertaLimite {
  regime: RegimeLimite;
  nivel: NivelLimite;
  medidas: MedidaLimite[];
  /** Ressalvas da estimativa (primeiro ano, caixa começou depois, abertura não informada…). */
  observacoes: string[];
  /** A soma pode estar abaixo do real porque o caixa não cobre toda a janela. */
  incompleto: boolean;
  aviso: string;
  vigenciaDesde: string;
  fonte: string;
}

// ------------------------------------------------------------------ utilidades

const cent = (n: number) => Math.round(n * 100) / 100;

export const reais = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (p: number) => `${Math.round(p * 100)}%`;

/** AAAA-MM de uma data AAAA-MM-DD. */
export const mesDe = (iso: string) => iso.slice(0, 7);

/** Soma `n` meses (pode ser negativo) a um AAAA-MM. */
export function somarMeses(m: string, n: number): string {
  const total = Number(m.slice(0, 4)) * 12 + (Number(m.slice(5, 7)) - 1) + n;
  const ano = Math.floor(total / 12);
  return `${ano}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Quantos meses há de `de` até `ate`, ambos AAAA-MM e inclusive (mesmo mês = 1). */
export function mesesInclusive(de: string, ate: string): number {
  return (Number(ate.slice(0, 4)) - Number(de.slice(0, 4))) * 12 + (Number(ate.slice(5, 7)) - Number(de.slice(5, 7))) + 1;
}

/** Nível pelo percentual: <80% ok · 80–100% atenção · 100–120% excedido · >120% retroativo. */
export function nivelDoPercentual(p: number, margemRetroativa = 0.2): NivelLimite {
  if (p > 1 + margemRetroativa + 1e-9) return 'retroativo';
  if (p > PERCENTUAIS.limite + 1e-9) return 'excedido';
  if (p >= PERCENTUAIS.atencao - 1e-9) return 'atencao';
  return 'ok';
}

const somaMeses = (porMes: Record<string, number>, de: string, ate: string): number => {
  let s = 0;
  for (let m = de; m <= ate; m = somarMeses(m, 1)) s += porMes[m] ?? 0;
  return cent(s);
};

function medida(
  chave: ChaveMedida, rotulo: string, valor: number, limite: number, margem: number, textos: Record<NivelLimite, string>,
): MedidaLimite {
  const percentual = limite > 0 ? valor / limite : 0;
  const nivel = nivelDoPercentual(percentual, margem);
  return { chave, rotulo, valor: cent(valor), limite, percentual, nivel, mensagem: textos[nivel] };
}

// ------------------------------------------------------------------------ MEI

function alertaMei(e: EntradaLimite, v: Vigencia): { medidas: MedidaLimite[]; observacoes: string[]; incompleto: boolean } {
  const observacoes: string[] = [];
  const mesAtual = mesDe(e.hoje);
  const ano = mesAtual.slice(0, 4);
  const inicioAno = `${ano}-01`;
  let limite = v.mei.limiteAnual;
  let incompleto = false;
  let primeiroAno = false;

  if (e.abertura) {
    const mesAb = mesDe(e.abertura);
    if (mesAb.slice(0, 4) === ano) {
      primeiroAno = true;
      const meses = 12 - Number(mesAb.slice(5, 7)) + 1; // fração de mês conta como mês inteiro
      limite = v.mei.limiteMensalNoAnoDeAbertura * meses;
      observacoes.push(`Empresa aberta neste ano: o limite é proporcional — ${reais(v.mei.limiteMensalNoAnoDeAbertura)} × ${meses} ${meses === 1 ? 'mês' : 'meses'} = ${reais(limite)}.`);
    }
  } else {
    observacoes.push(`Data de abertura não informada. Se a empresa abriu neste ano, o limite é proporcional (${reais(v.mei.limiteMensalNoAnoDeAbertura)} por mês de atividade), e não ${reais(v.mei.limiteAnual)}.`);
  }

  const valor = somaMeses(e.receitaPorMes, inicioAno, mesAtual);
  if (e.primeiroMesDados && e.primeiroMesDados > inicioAno && !primeiroAno) {
    incompleto = true;
    observacoes.push(`O caixa só tem dados a partir de ${e.primeiroMesDados.slice(5)}/${e.primeiroMesDados.slice(0, 4)}; a soma do ano pode estar abaixo do real.`);
  }

  const limiteRetro = limite * (1 + v.mei.margemRetroativa);
  const m = medida('mei_ano', `Receita de ${ano} (MEI)`, valor, limite, v.mei.margemRetroativa, {
    ok: `Estimativa pelo caixa: ${reais(valor)} de ${reais(limite)} no ano (${pct(limite > 0 ? valor / limite : 0)}). Confirme com a contabilidade.`,
    atencao: `Estimativa pelo caixa: ${reais(valor)} — ${pct(limite > 0 ? valor / limite : 0)} do limite de ${reais(limite)}. Chegando perto: confirme com a contabilidade e acompanhe os próximos meses.`,
    excedido: `Estimativa pelo caixa: ${reais(valor)} — acima do limite de ${reais(limite)}, mas dentro dos 20% de tolerância (até ${reais(limiteRetro)}). Se confirmado, o excesso paga DAS com alíquotas de empresa comum e o desenquadramento vale a partir de 1º de janeiro do ano seguinte. A contabilidade precisa confirmar.`,
    retroativo: `Estimativa pelo caixa: ${reais(valor)} — mais de 20% acima do limite (${reais(limiteRetro)}). Se confirmado, o desenquadramento do MEI vale desde 1º de janeiro (ou da abertura) deste ano. Fale com a contabilidade agora.`,
  });

  // Ritmo atual: só informa; não vira nível.
  const decorridos = mesesInclusive(inicioAno, mesAtual);
  if (!primeiroAno && decorridos >= 3 && decorridos < 12 && valor > 0) {
    const projecao = cent((valor / decorridos) * 12);
    observacoes.push(`No ritmo atual (${reais(cent(valor / decorridos))} por mês), o ano fecharia perto de ${reais(projecao)} — só uma projeção.`);
  }
  observacoes.push('Receitas financeiras, aluguéis e recuperações classificadas em conta de receita estão incluídas; devoluções não foram abatidas.');
  return { medidas: [m], observacoes, incompleto };
}

// -------------------------------------------------------------------- Simples

function alertaSimples(e: EntradaLimite, v: Vigencia): { medidas: MedidaLimite[]; observacoes: string[]; incompleto: boolean } {
  const observacoes: string[] = [];
  const mesAtual = mesDe(e.hoje);
  const ano = mesAtual.slice(0, 4);
  const inicioAno = `${ano}-01`;
  const s = v.simples;
  let incompleto = false;

  const mesAb = e.abertura ? mesDe(e.abertura) : null;
  const anoDeInicio = mesAb != null && mesAb.slice(0, 4) === ano;
  const inicioJanela = somarMeses(mesAtual, -11);
  const abriuNaJanela = mesAb != null && mesAb > inicioJanela;

  // Limite e sublimite: receita bruta do ANO-CALENDÁRIO (janeiro até o mês corrente).
  const baseAno = somaMeses(e.receitaPorMes, inicioAno, mesAtual);
  if (e.primeiroMesDados && e.primeiroMesDados > inicioAno && !anoDeInicio) {
    incompleto = true;
    observacoes.push(`O caixa só tem dados a partir de ${e.primeiroMesDados.slice(5)}/${e.primeiroMesDados.slice(0, 4)}; a soma do ano pode estar abaixo do real.`);
  }
  let limiteGeral = s.limiteAnual;
  let sublimite = s.sublimite;
  if (anoDeInicio) {
    const meses = 12 - Number(mesAb!.slice(5, 7)) + 1;
    limiteGeral = s.limiteMensalNoAnoDeInicio * meses;
    sublimite = s.sublimiteMensalNoAnoDeInicio * meses;
    observacoes.push(`Ano de início de atividade: limites proporcionais — ${reais(s.limiteMensalNoAnoDeInicio)} × ${meses} = ${reais(limiteGeral)} (sublimite ${reais(sublimite)}).`);
  } else if (!e.abertura) {
    observacoes.push('Data de abertura não informada: se a empresa abriu neste ano, os limites são proporcionais (R$ 400 mil por mês de atividade).');
  }

  // O que acontece acima de 20%: no ano de início, retroage ao começo da atividade; nos demais, vale a partir do mês seguinte.
  const efeitoRetro = anoDeInicio ? 'desde o início da atividade' : 'a partir do mês seguinte ao excesso';
  const mensagens = (rotuloLimite: string, lim: number, ate20: string, depois20: string): Record<NivelLimite, string> => {
    const retro = lim * (1 + s.margemRetroativa);
    const texto = (nivel: string) => `Estimativa pelo caixa: ${reais(baseAno)} no ano — ${nivel}`;
    const p = lim > 0 ? baseAno / lim : 0;
    return {
      ok: texto(`${pct(p)} de ${rotuloLimite} (${reais(lim)}). Confirme com a contabilidade.`),
      atencao: texto(`${pct(p)} de ${rotuloLimite} (${reais(lim)}). Chegando perto: confirme com a contabilidade.`),
      excedido: texto(`acima de ${rotuloLimite} (${reais(lim)}), dentro dos 20% de tolerância (até ${reais(retro)}). ${ate20} A contabilidade precisa confirmar.`),
      retroativo: texto(`mais de 20% acima de ${rotuloLimite} (${reais(retro)}). ${depois20} Fale com a contabilidade agora.`),
    };
  };

  const medidas: MedidaLimite[] = [];
  medidas.push(medida('simples_limite', anoDeInicio ? 'Receita desde a abertura (Simples)' : `Receita de ${ano} (Simples)`, baseAno, limiteGeral, s.margemRetroativa,
    mensagens('o limite do Simples', limiteGeral,
      'Se confirmado, a exclusão do Simples vale a partir de 1º de janeiro do ano seguinte.',
      `Se confirmado, a exclusão do Simples vale ${efeitoRetro}.`)));

  medidas.push(medida('simples_sublimite', 'Sublimite estadual/municipal (ICMS e ISS)', baseAno, sublimite, s.margemRetroativa,
    mensagens('o sublimite de ICMS/ISS', sublimite,
      'Se confirmado, ICMS e ISS passam a ser recolhidos fora do DAS a partir de 1º de janeiro do ano seguinte. Seu estado ou município pode ter sublimite menor.',
      `Se confirmado, ICMS e ISS passam a ser recolhidos fora do DAS ${efeitoRetro}. Seu estado ou município pode ter sublimite menor.`)));

  // Faixa atual: pela receita dos 12 meses terminando no mês corrente (aproxima a RBT12; inclui o mês em andamento).
  if (!anoDeInicio) {
    let rbt12 = somaMeses(e.receitaPorMes, inicioJanela, mesAtual);
    if (abriuNaJanela) {
      const ativos = Math.min(12, mesesInclusive(mesAb!, mesAtual));
      rbt12 = cent((somaMeses(e.receitaPorMes, mesAb!, mesAtual) / ativos) * 12);
      observacoes.push(`Empresa com menos de 12 meses de atividade: a faixa usa a média de ${ativos} ${ativos === 1 ? 'mês' : 'meses'} × 12.`);
    } else if (e.primeiroMesDados && e.primeiroMesDados > inicioJanela) {
      observacoes.push(`A faixa usa os 12 meses até agora, mas o caixa só começa em ${e.primeiroMesDados.slice(5)}/${e.primeiroMesDados.slice(0, 4)}: a faixa pode estar subestimada.`);
    }
    const idx = s.faixas.findIndex((teto) => rbt12 <= teto);
    if (idx >= 0 && idx < s.faixas.length - 1) {
      const teto = s.faixas[idx];
      const p = teto > 0 ? rbt12 / teto : 0;
      const perto = p >= 0.9;
      medidas.push({
        chave: 'simples_faixa', rotulo: `Faixa ${idx + 1} da tabela do Simples`, valor: cent(rbt12), limite: teto, percentual: p,
        nivel: perto ? 'atencao' : 'ok',
        mensagem: perto
          ? `Estimativa pelo caixa: ${reais(rbt12)} nos últimos 12 meses — ${pct(p)} do teto da faixa ${idx + 1} (${reais(teto)}). Perto de passar para a faixa ${idx + 2}, com alíquota maior. Confirme com a contabilidade.`
          : `Estimativa pelo caixa: faixa ${idx + 1} (até ${reais(teto)}); ${reais(rbt12)} nos últimos 12 meses. Confirme com a contabilidade.`,
      });
    }
  }
  observacoes.push('O caixa mostra o que foi recebido: se a empresa apura a receita por competência, os números podem diferir. Receitas financeiras, aluguéis e recuperações classificadas em conta de receita estão incluídas; devoluções e vendas canceladas não foram abatidas.');
  return { medidas, observacoes, incompleto };
}

// ------------------------------------------------------------------- principal

/**
 * Calcula o alerta de uma empresa. Não decide nada: devolve medidas, níveis e
 * ressalvas para a contadora conferir. Regime fora de MEI/Simples não passa por
 * aqui (quem chama escolhe com `regimeComLimite`).
 */
export function calcularLimite(e: EntradaLimite): AlertaLimite {
  const v = vigenciaEm(e.hoje);
  const r = e.regime === 'mei' ? alertaMei(e, v) : alertaSimples(e, v);
  const nivel = r.medidas.reduce<NivelLimite>((pior, m) => (ORDEM_NIVEL[m.nivel] > ORDEM_NIVEL[pior] ? m.nivel : pior), 'ok');
  return {
    regime: e.regime, nivel, medidas: r.medidas, observacoes: r.observacoes, incompleto: r.incompleto,
    aviso: AVISO_ESTIMATIVA, vigenciaDesde: v.desde, fonte: v.fonte,
  };
}

/** O regime registrado tem limite acompanhado aqui? (presumido, pessoa física e sem regime: não). */
export function regimeComLimite(regime: string | null | undefined): RegimeLimite | null {
  return regime === 'mei' || regime === 'simples' ? regime : null;
}

/** Rótulo curto do nível, para selo. */
export const ROTULO_NIVEL: Record<NivelLimite, string> = {
  ok: 'Dentro do limite',
  atencao: 'Perto do limite',
  excedido: 'Acima do limite',
  retroativo: 'Muito acima do limite',
};

/**
 * Mês-a-mês: transforma entradas de receita (data, valor) em `receitaPorMes`.
 * Só soma o que for positivo e tiver data válida.
 */
export function receitaPorMes(entradas: { data: string; valor: number }[]): Record<string, number> {
  const r: Record<string, number> = {};
  for (const x of entradas) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x.data) || !(x.valor > 0)) continue;
    const m = mesDe(x.data);
    r[m] = cent((r[m] ?? 0) + x.valor);
  }
  return r;
}
