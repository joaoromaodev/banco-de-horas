// Contrato de experiência — modelo, datas, valor por extenso e os campos que
// preenchem os modelos .docx. Puro (sem I/O): roda no navegador e no servidor.
//
// Ver docs/contratos-experiencia.md para as decisões e armadilhas.

export const DIAS = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'] as const;
export type Dia = (typeof DIAS)[number];

export interface HorarioDia {
  folga: boolean;
  entrada: string; // "HH:MM"
  saida: string;
  /** Intervalo de almoço; vazio = sem intervalo. */
  intervaloInicio: string;
  intervaloFim: string;
}

export interface Trajeto { linha: string; operadora: string; tarifa: string }

export type Situacao = 'experiencia' | 'efetivado' | 'encerrado';

export interface DadosContrato {
  // empregadora
  empresaNome: string;
  empresaEndereco: string;
  cidade: string; // local de assinatura ("Belém")
  // empregado
  nome: string;
  sexo: 'M' | 'F';
  cpf: string;
  ctps: string;
  ctpsUf: string;
  nacionalidade: string;
  estadoCivil: string;
  profissao: string;
  // contrato
  funcao: string;
  salario: string; // "1.518,00" — texto, como a contadora digita
  salarioExtenso: string;
  admissao: string; // AAAA-MM-DD (= data de assinatura)
  diasPeriodo: number;
  diasProrrogacao: number;
  horario: Record<Dia, HorarioDia>;
  repouso: string; // "DOM"
  // vale-transporte
  vt: 'sim' | 'nao' | '';
  endRua: string;
  endNum: string;
  endBairro: string;
  endCidade: string;
  endCep: string;
  endUf: string;
  ida: Trajeto[];
  volta: Trajeto[];
  // aviso de término
  termino: string; // AAAA-MM-DD
  retorno: string;
  dataAviso: string;
}

export interface ContratoSalvo {
  id: string;
  empresa: string;
  situacao: Situacao;
  criadoPor: string;
  criadoEm: string;
  atualizadoEm: string | null;
  dados: DadosContrato;
}

export const TRAJETOS = 3;
const trajetoVazio = (): Trajeto => ({ linha: '', operadora: '', tarifa: '' });

// ------------------------------------------------------------------ datas
// Sempre AAAA-MM-DD + Date.UTC: a Vercel roda em UTC e Belém em UTC−3.

export function somarDias(iso: string, n: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

export function diaSemanaIso(iso: string): number {
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d)).getUTCDay();
}

export function hojeBelem(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Belem' }).format(new Date());
}

export function diasEntre(de: string, ate: string): number {
  const t = (iso: string) => { const [a, m, d] = iso.split('-').map(Number); return Date.UTC(a, m - 1, d); };
  return Math.round((t(ate) - t(de)) / 86_400_000);
}

export const isoValida = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? '');

export function br(iso: string): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

const MESES_EXT = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function dataExtenso(iso: string): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${Number(m[3])} de ${MESES_EXT[Number(m[2]) - 1]} de ${m[1]}` : '';
}

/** Vencimento do 1º período: o dia da admissão conta como o 1º dia. */
export const vencimento1 = (d: Pick<DadosContrato, 'admissao' | 'diasPeriodo'>) =>
  somarDias(d.admissao, d.diasPeriodo - 1);

/** Fim da prorrogação (ou null, quando não há prorrogação prevista). */
export const vencimento2 = (d: Pick<DadosContrato, 'admissao' | 'diasPeriodo' | 'diasProrrogacao'>) =>
  d.diasProrrogacao > 0 ? somarDias(d.admissao, d.diasPeriodo + d.diasProrrogacao - 1) : null;

/**
 * Retorno para receber a rescisão: CLT art. 477 §6 dá até 10 dias corridos
 * após o término. Sugere o 10º dia, recuando para sexta se cair no fim de semana.
 */
export function retornoSugerido(termino: string): string {
  let r = somarDias(termino, 10);
  while ([0, 6].includes(diaSemanaIso(r))) r = somarDias(r, -1);
  return r;
}

// ------------------------------------------------------------------ horário

const minutos = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm?.trim() ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Horário padrão derivado da jornada da empresa (cadastro do ponto). */
export function horarioPadrao(j: { utilMin?: number; sabadoMin?: number; trabalhaSabado?: boolean } = {}): Record<Dia, HorarioDia> {
  const util = j.utilMin ?? 480;
  const sab = j.sabadoMin ?? 240;
  const inicio = 8 * 60;
  const comAlmoco = util > 6 * 60;
  const diaUtil: HorarioDia = {
    folga: false,
    entrada: hhmm(inicio),
    saida: hhmm(inicio + util + (comAlmoco ? 60 : 0)),
    intervaloInicio: comAlmoco ? '12:00' : '',
    intervaloFim: comAlmoco ? '13:00' : '',
  };
  const h = {} as Record<Dia, HorarioDia>;
  for (const d of DIAS) h[d] = { ...diaUtil };
  h.SAB = j.trabalhaSabado
    ? { folga: false, entrada: hhmm(inicio), saida: hhmm(inicio + sab), intervaloInicio: '', intervaloFim: '' }
    : { folga: true, entrada: '', saida: '', intervaloInicio: '', intervaloFim: '' };
  return h;
}

/** Minutos trabalhados na semana (para o limite de 44h da CF art. 7º, XIII). */
export function minutosSemana(h: Record<Dia, HorarioDia>): number | null {
  let total = 0;
  for (const d of DIAS) {
    const x = h[d];
    if (!x || x.folga) continue;
    const e = minutos(x.entrada), s = minutos(x.saida);
    if (e == null || s == null || s <= e) return null;
    let dia = s - e;
    const ii = minutos(x.intervaloInicio), fi = minutos(x.intervaloFim);
    if (ii != null && fi != null && fi > ii) dia -= fi - ii;
    total += dia;
  }
  return total;
}

// ------------------------------------------------------------------ valor por extenso

const UNIDADES = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez',
  'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const DEZENAS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const CENTENAS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos',
  'setecentos', 'oitocentos', 'novecentos'];

function ate999(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'cem';
  const c = Math.floor(n / 100), r = n % 100;
  const partes: string[] = [];
  if (c) partes.push(CENTENAS[c]);
  if (r) {
    if (r < 20) partes.push(UNIDADES[r]);
    else {
      const d = Math.floor(r / 10), u = r % 10;
      partes.push(u ? `${DEZENAS[d]} e ${UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(' e ');
}

/** Inteiro por extenso, até 999.999.999 ("mil quinhentos e dezoito"). */
export function inteiroExtenso(n: number): string {
  if (n === 0) return 'zero';
  const grupos = [Math.floor(n / 1e6) % 1000, Math.floor(n / 1e3) % 1000, n % 1000];
  const partes: { txt: string; v: number }[] = [];
  if (grupos[0]) partes.push({ txt: grupos[0] === 1 ? 'um milhão' : `${ate999(grupos[0])} milhões`, v: grupos[0] });
  if (grupos[1]) partes.push({ txt: grupos[1] === 1 ? 'mil' : `${ate999(grupos[1])} mil`, v: grupos[1] });
  if (grupos[2]) partes.push({ txt: ate999(grupos[2]), v: grupos[2] });
  // "e" antes do último grupo quando ele é < 100 ou centena redonda:
  // "mil e quinhentos", "mil e um", mas "mil quinhentos e dezoito".
  return partes.map((p, i) => {
    if (i === 0) return p.txt;
    const usaE = i === partes.length - 1 && (p.v < 100 || p.v % 100 === 0);
    return (usaE ? ' e ' : ' ') + p.txt;
  }).join('');
}

/** "1.518,00" | "1518.5" | 1518 → número (ou null). */
export function lerValor(v: string | number): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function formatarValor(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Valor em reais por extenso ("mil quinhentos e dezoito reais"). */
export function reaisExtenso(valor: number): string {
  const centavosTot = Math.round(valor * 100);
  const reais = Math.floor(centavosTot / 100), cent = centavosTot % 100;
  if (reais >= 1e9) return '';
  const pReais = reais === 0 ? '' :
    `${inteiroExtenso(reais)}${reais >= 1e6 && reais % 1e6 === 0 ? ' de' : ''} ${reais === 1 ? 'real' : 'reais'}`;
  const pCent = cent === 0 ? '' : `${inteiroExtenso(cent)} ${cent === 1 ? 'centavo' : 'centavos'}`;
  if (!pReais && !pCent) return 'zero reais';
  return [pReais, pCent].filter(Boolean).join(' e ');
}

// ------------------------------------------------------------------ formulário

export function dadosVazios(): DadosContrato {
  const hoje = hojeBelem();
  const termino = somarDias(hoje, 44);
  return {
    empresaNome: '', empresaEndereco: '', cidade: 'Belém',
    nome: '', sexo: 'M', cpf: '', ctps: '', ctpsUf: 'PA', nacionalidade: '', estadoCivil: '', profissao: '',
    funcao: '', salario: '', salarioExtenso: '',
    admissao: hoje, diasPeriodo: 45, diasProrrogacao: 45,
    horario: horarioPadrao(), repouso: 'DOM',
    vt: '', endRua: '', endNum: '', endBairro: '', endCidade: 'Belém', endCep: '', endUf: 'PA',
    ida: Array.from({ length: TRAJETOS }, trajetoVazio),
    volta: Array.from({ length: TRAJETOS }, trajetoVazio),
    termino, retorno: retornoSugerido(termino), dataAviso: hoje,
  };
}

/** Completa um registro antigo/parcial com os campos que faltarem. */
export function normalizarDados(d: Partial<DadosContrato>): DadosContrato {
  const base = dadosVazios();
  const r = { ...base, ...d } as DadosContrato;
  r.horario = { ...base.horario, ...(d.horario ?? {}) };
  const tr = (l?: Trajeto[]) => Array.from({ length: TRAJETOS }, (_, i) => ({ ...trajetoVazio(), ...(l?.[i] ?? {}) }));
  r.ida = tr(d.ida);
  r.volta = tr(d.volta);
  r.diasPeriodo = Number(r.diasPeriodo) || 0;
  r.diasProrrogacao = Number(r.diasProrrogacao) || 0;
  return r;
}

/** Erros que impedem salvar/gerar. Vazio = ok. */
export function validar(d: DadosContrato): string[] {
  const e: string[] = [];
  if (!d.nome.trim()) e.push('Informe o nome do empregado.');
  if (!isoValida(d.admissao)) e.push('Data de admissão inválida.');
  if (!Number.isInteger(d.diasPeriodo) || d.diasPeriodo < 1) e.push('Prazo do 1º período inválido.');
  if (!Number.isInteger(d.diasProrrogacao) || d.diasProrrogacao < 0) e.push('Prazo da prorrogação inválido.');
  if (d.diasPeriodo + d.diasProrrogacao > 90) e.push('O contrato de experiência não pode passar de 90 dias somados (CLT art. 445).');
  return e;
}

/** Avisos que não bloqueiam (a contadora decide). */
export function avisos(d: DadosContrato): string[] {
  const a: string[] = [];
  const sem = minutosSemana(d.horario);
  if (sem == null) a.push('Algum horário está incompleto ou com saída antes da entrada.');
  else if (sem > 44 * 60) a.push(`O horário soma ${Math.floor(sem / 60)}h${sem % 60 ? String(sem % 60).padStart(2, '0') : ''} por semana — acima do limite de 44h.`);
  if (d.cpf && d.cpf.replace(/\D/g, '').length !== 11) a.push('CPF não tem 11 dígitos.');
  return a;
}

// ------------------------------------------------------------------ campos dos modelos

export type Documento = 'contrato' | 'vale' | 'encerramento';

export const NOME_DOCUMENTO: Record<Documento, string> = {
  contrato: 'CONTRATO DE EXPERIÊNCIA',
  vale: 'DECLARAÇÃO DE OPÇÃO DE VALE-TRANSPORTE',
  encerramento: 'AVISO DE TÉRMINO DO CONTRATO DE EXPERIÊNCIA',
};

const intervalo = (h: HorarioDia) =>
  h.intervaloInicio && h.intervaloFim ? `${h.intervaloInicio} ${h.intervaloFim}` : '';

/** Valores dos {{PLACEHOLDERS}} dos três modelos. */
export function campos(d: DadosContrato): Record<string, string> {
  const f = d.sexo === 'F';
  const v1 = vencimento1(d), v2 = vencimento2(d);
  const c: Record<string, string> = {
    EMPRESA: d.empresaNome.trim(),
    EMPRESA_MAIUSC: d.empresaNome.trim().toUpperCase(),
    EMPRESA_ENDERECO: d.empresaEndereco.trim(),
    CIDADE: d.cidade.trim(),
    CIDADE_MAIUSC: d.cidade.trim().toUpperCase(),
    NOME: d.nome.trim().toUpperCase(),
    O_SR: f ? 'a Sra.' : 'o Sr.',
    PORTADOR: f ? 'portadora' : 'portador',
    CHAMADO: f ? 'chamada' : 'chamado',
    REGISTRADO: f ? 'registrada' : 'registrado',
    CPF: d.cpf.trim(),
    CTPS: d.ctps.trim(),
    CTPS_UF: d.ctpsUf.trim().toUpperCase(),
    NACIONALIDADE: d.nacionalidade.trim() || (f ? 'Brasileira' : 'Brasileiro'),
    ESTADO_CIVIL: d.estadoCivil.trim(),
    PROFISSAO: d.profissao.trim() || d.funcao.trim(),
    FUNCAO: d.funcao.trim().toUpperCase(),
    SALARIO: d.salario.trim(),
    SALARIO_EXTENSO: d.salarioExtenso.trim(),
    VENCIMENTO: br(v1),
    PRORROGADO_ATE: v2 ? br(v2) : '___ / ___ / _______',
    DATA_EXTENSO: dataExtenso(d.admissao),
    REPOUSO: d.repouso || 'DOM',
    // vale-transporte
    END_RUA: d.endRua.trim(), END_NUM: d.endNum.trim(), END_BAIRRO: d.endBairro.trim(),
    END_CIDADE: d.endCidade.trim(), END_CEP: d.endCep.trim(), END_UF: d.endUf.trim().toUpperCase(),
    VT_SIM: d.vt === 'sim' ? 'X' : '   ',
    VT_NAO: d.vt === 'nao' ? 'X' : '   ',
    // aviso de término
    INICIO: br(d.admissao),
    TERMINO: br(d.termino),
    RETORNO: br(d.retorno),
  };
  for (const dia of DIAS) {
    const h = d.horario[dia];
    const trabalha = h && !h.folga;
    c[`${dia}_E`] = trabalha ? h.entrada : 'FOLGA';
    c[`${dia}_AS`] = trabalha ? 'às' : '';
    c[`${dia}_S`] = trabalha ? h.saida : '';
    c[`${dia}_I`] = trabalha ? intervalo(h) : '';
  }
  d.ida.forEach((t, i) => {
    c[`IDA${i + 1}_LINHA`] = t.linha; c[`IDA${i + 1}_OPER`] = t.operadora; c[`IDA${i + 1}_TARIFA`] = t.tarifa;
  });
  d.volta.forEach((t, i) => {
    c[`VOLTA${i + 1}_LINHA`] = t.linha; c[`VOLTA${i + 1}_OPER`] = t.operadora; c[`VOLTA${i + 1}_TARIFA`] = t.tarifa;
  });
  return c;
}

/** Data por extenso de cada documento: contrato = admissão; aviso = data do aviso. */
export function camposDoDocumento(doc: Documento, d: DadosContrato): Record<string, string> {
  const c = campos(d);
  if (doc === 'encerramento') c.DATA_EXTENSO = dataExtenso(d.dataAviso);
  return c;
}

// ------------------------------------------------------------------ alertas

export interface Alerta { tipo: 'vencido' | 'vence'; marco: '1º período' | 'prorrogação'; data: string; dias: number }

/**
 * Próximo marco de um contrato ainda em experiência, se estiver a ≤ `janela`
 * dias (ou já passado). Contrato vencido sem providência vira prazo
 * indeterminado — por isso o alerta não some sozinho: ela marca efetivado/encerrado.
 */
export function alertaDe(d: DadosContrato, situacao: Situacao, hoje = hojeBelem(), janela = 7): Alerta | null {
  if (situacao !== 'experiencia' || !isoValida(d.admissao)) return null;
  const v1 = vencimento1(d), v2 = vencimento2(d);
  const marco = diasEntre(hoje, v1) >= 0 || !v2
    ? { marco: '1º período' as const, data: v1 }
    : { marco: 'prorrogação' as const, data: v2 };
  const dias = diasEntre(hoje, marco.data);
  if (dias < 0) return { tipo: 'vencido', ...marco, dias };
  if (dias <= janela) return { tipo: 'vence', ...marco, dias };
  return null;
}

// ------------------------------------------------------------------ alertas consolidados

/** Linha da faixa de alertas do topo: um contrato de qualquer empresa do escritório. */
export interface AlertaConsolidado extends Alerta {
  id: string;
  empresa: string;
  empresaNome: string;
  nome: string;
}

export interface ContratoParaAlerta {
  id: string; empresa: string; empresaNome: string; situacao: Situacao; dados: DadosContrato;
}

/**
 * O que é urgente (pura, testada): contrato **em experiência** cujo próximo marco
 * (fim do 1º período ou da prorrogação) já passou — porque vencido sem aviso vira
 * prazo indeterminado — ou cai nos próximos `janela` dias (padrão 7).
 *
 * Ordem: vencidos primeiro, do mais atrasado ao menos; depois os que vencem, do
 * mais próximo ao mais distante. Empate: nome do empregado, depois empresa.
 */
export function alertasConsolidados(
  contratos: ContratoParaAlerta[], hoje = hojeBelem(), janela = 7,
): AlertaConsolidado[] {
  const lista: AlertaConsolidado[] = [];
  for (const c of contratos) {
    const a = alertaDe(c.dados, c.situacao, hoje, janela);
    if (a) lista.push({ ...a, id: c.id, empresa: c.empresa, empresaNome: c.empresaNome, nome: c.dados.nome });
  }
  // `dias` negativo = vencido; ordenar por `dias` crescente já põe o mais atrasado primeiro.
  return lista.sort((x, y) =>
    x.dias - y.dias
    || x.nome.localeCompare(y.nome, 'pt-BR')
    || x.empresaNome.localeCompare(y.empresaNome, 'pt-BR'));
}
