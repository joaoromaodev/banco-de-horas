// Departamento Pessoal — o cadastro único do empregado (migração 0021). Puro (sem
// I/O): roda no navegador e no servidor. Ver docs/departamento-pessoal.md.
//
// Para a frente do resumo do ponto para a folha (lib/resumoFolha.ts):
//   - `jornadaDoEmpregado(empregado, funcionario, empresa)` → jornada contratual;
//   - `temBancoDeHoras(empregado, data?)` → há acordo de banco de horas vigente?
// O servidor entrega os empregados de uma empresa já com o nome do ponto em
// `lerEmpregadosParaFolha` (lib/dpServidor.ts).
import { JORNADA_PADRAO, type Jornada } from './calendario';
import type { Empresa, Funcionario } from './tipos';

export type SituacaoEmpregado = 'ativo' | 'afastado' | 'desligado';
export const SITUACOES_EMPREGADO: { valor: SituacaoEmpregado; rotulo: string }[] = [
  { valor: 'ativo', rotulo: 'Ativo' },
  { valor: 'afastado', rotulo: 'Afastado' },
  { valor: 'desligado', rotulo: 'Desligado' },
];

export type TipoAfastamento = 'doenca' | 'acidente' | 'maternidade' | 'outro';
export const TIPOS_AFASTAMENTO: { valor: TipoAfastamento; rotulo: string }[] = [
  { valor: 'doenca', rotulo: 'Doença (auxílio por incapacidade)' },
  { valor: 'acidente', rotulo: 'Acidente de trabalho' },
  { valor: 'maternidade', rotulo: 'Licença-maternidade' },
  { valor: 'outro', rotulo: 'Outro' },
];

export type Escala = '5x2' | '6x1' | '12x36' | 'outra';
export const ESCALAS: { valor: Escala; rotulo: string }[] = [
  { valor: '5x2', rotulo: '5x2 (segunda a sexta)' },
  { valor: '6x1', rotulo: '6x1 (segunda a sábado)' },
  { valor: '12x36', rotulo: '12x36' },
  { valor: 'outra', rotulo: 'Outra' },
];

export const DIAS_SEMANA_CURTO = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

export type OrigemEmpregado = 'ponto' | 'contrato' | 'manual';

export interface Empregado {
  id: string;
  escritorioId: string;
  empresaId: string;
  nome: string;
  /** Só dígitos (11) ou null. Dado pessoal: não vai para e-mail, log nem IA. */
  cpf: string | null;
  cargo: string | null;
  admissao: string | null; // AAAA-MM-DD
  salarioBase: number | null;
  horasSemanais: number | null;
  escala: Escala | null;
  /** Dia do repouso semanal: 0 = domingo … 6 = sábado. */
  dsr: number;
  bancoHoras: boolean;
  bancoHorasDesde: string | null;
  situacao: SituacaoEmpregado;
  situacaoDesde: string | null;
  afastamentoTipo: TipoAfastamento | null;
  /** Início do 1º aquisitivo a considerar (null = admissão). Ver lib/ferias.ts. */
  aquisitivoBase: string | null;
  origem: OrigemEmpregado;
  atualizadoEm: string | null;
  atualizadoPor: string | null;
}

/** Campos que a tela edita (o resto é do servidor). */
export type DadosEmpregado = Pick<Empregado,
  'nome' | 'cpf' | 'cargo' | 'admissao' | 'salarioBase' | 'horasSemanais' | 'escala' | 'dsr'
  | 'bancoHoras' | 'bancoHorasDesde' | 'situacao' | 'situacaoDesde' | 'afastamentoTipo' | 'aquisitivoBase'>;

// ------------------------------------------------------------------ validação

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const isoOk = (s: unknown): s is string =>
  typeof s === 'string' && ISO.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export function br(iso: string | null | undefined): string {
  const m = String(iso ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

const texto = (v: unknown, max = 120): string | null => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
};

const dataOuNull = (v: unknown): string | null => (isoOk(v) ? v : null);

/** "1.518,00", "1518.5", 1518 → 1518.5; vazio → null; inválido → NaN. */
export function lerDinheiro(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
  let s = String(v).replace(/[R$\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

export const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** CPF pelos dígitos verificadores. */
export function cpfValido(v: string): boolean {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

/** Mostra o CPF mascarado (LGPD: na lista, só os 3 do meio). */
export function cpfMascarado(cpf: string | null): string {
  const d = soDigitos(cpf);
  return d.length === 11 ? `***.${d.slice(3, 6)}.***-**` : '';
}

export function cpfFormatado(cpf: string | null): string {
  const d = soDigitos(cpf);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : '';
}

/**
 * Normaliza e valida o que veio da tela. Erros bloqueiam; o resultado já está
 * pronto para gravar.
 */
export function validarEmpregado(b: Record<string, unknown>): { ok: true; dados: DadosEmpregado } | { ok: false; erros: string[] } {
  const erros: string[] = [];
  const nome = texto(b.nome, 120);
  if (!nome) erros.push('Informe o nome.');

  const cpfDig = soDigitos(b.cpf);
  let cpf: string | null = null;
  if (cpfDig) {
    if (!cpfValido(cpfDig)) erros.push('CPF inválido.');
    else cpf = cpfDig;
  }

  const salario = lerDinheiro(b.salarioBase);
  if (salario !== null && (Number.isNaN(salario) || salario < 0 || salario > 9_999_999)) erros.push('Salário inválido.');

  let horas: number | null = null;
  if (b.horasSemanais !== null && b.horasSemanais !== undefined && b.horasSemanais !== '') {
    horas = Number(String(b.horasSemanais).replace(',', '.'));
    if (!Number.isFinite(horas) || horas < 0 || horas > 70) { erros.push('Horas por semana inválidas.'); horas = null; }
    else horas = Math.round(horas * 10) / 10;
  }

  const escala = ESCALAS.some((e) => e.valor === b.escala) ? (b.escala as Escala) : null;
  const dsrN = Number(b.dsr ?? 0);
  const dsr = Number.isInteger(dsrN) && dsrN >= 0 && dsrN <= 6 ? dsrN : 0;

  const situacao = SITUACOES_EMPREGADO.some((s) => s.valor === b.situacao) ? (b.situacao as SituacaoEmpregado) : 'ativo';
  const situacaoDesde = dataOuNull(b.situacaoDesde);
  if (situacao !== 'ativo' && !situacaoDesde) erros.push(situacao === 'desligado' ? 'Informe a data do desligamento.' : 'Informe a data do afastamento.');
  const afastamentoTipo = situacao === 'afastado' && TIPOS_AFASTAMENTO.some((t) => t.valor === b.afastamentoTipo)
    ? (b.afastamentoTipo as TipoAfastamento) : null;
  if (situacao === 'afastado' && !afastamentoTipo) erros.push('Informe o tipo do afastamento.');

  const admissao = dataOuNull(b.admissao);
  if (b.admissao && !admissao) erros.push('Data de admissão inválida.');
  if (admissao && situacaoDesde && situacao !== 'ativo' && situacaoDesde < admissao) {
    erros.push('A data da situação não pode ser antes da admissão.');
  }

  const bancoHoras = Boolean(b.bancoHoras);
  const bancoHorasDesde = bancoHoras ? dataOuNull(b.bancoHorasDesde) : null;
  const aquisitivoBase = dataOuNull(b.aquisitivoBase);
  if (aquisitivoBase && admissao && aquisitivoBase < admissao) erros.push('O início do aquisitivo não pode ser antes da admissão.');

  if (erros.length) return { ok: false, erros };
  return {
    ok: true,
    dados: {
      nome: nome!, cpf, cargo: texto(b.cargo, 80), admissao, salarioBase: salario, horasSemanais: horas, escala, dsr,
      bancoHoras, bancoHorasDesde, situacao, situacaoDesde: situacao === 'ativo' ? null : situacaoDesde,
      afastamentoTipo, aquisitivoBase,
    },
  };
}

/** Avisos que não bloqueiam (mostrados na ficha). */
export function avisosEmpregado(e: Pick<Empregado, 'admissao' | 'horasSemanais' | 'bancoHoras' | 'bancoHorasDesde' | 'situacao'>): string[] {
  const a: string[] = [];
  if (!e.admissao) a.push('Sem data de admissão: férias e 13º não podem ser calculados.');
  if (e.horasSemanais != null && e.horasSemanais > 44) a.push('Jornada acima de 44h semanais (CLT art. 58; CF art. 7º XIII).');
  if (e.bancoHoras && !e.bancoHorasDesde) a.push('Acordo de banco de horas sem data de início.');
  return a;
}

// ------------------------------------------------------------------ jornada (para a frente B)

export interface JornadaContratual extends Jornada {
  /** Horas por semana do contrato (informada no DP ou calculada da jornada diária). */
  horasSemanais: number;
  escala: Escala | null;
  /** Dia do repouso semanal (0 = domingo). */
  dsr: number;
  /** De onde veio a jornada diária. */
  fonte: 'funcionario' | 'empresa' | 'padrao';
}

/**
 * Jornada contratual do empregado. A jornada **diária** continua vindo do cadastro
 * do ponto (funcionário → empresa → padrão 8h, sábado conforme a empresa), que é o
 * que o Timesheet usa; o DP acrescenta horas semanais, escala e o DSR. Horas por
 * semana não informadas no DP = 5 × dia útil + sábado (se trabalha).
 */
export function jornadaDoEmpregado(
  empregado: Pick<Empregado, 'horasSemanais' | 'escala' | 'dsr'> | null | undefined,
  funcionario?: Pick<Funcionario, 'jornadaUtilMin' | 'jornadaSabadoMin'> | null,
  empresa?: Pick<Empresa, 'jornadaUtilMin' | 'jornadaSabadoMin' | 'trabalhaSabado'> | null,
): JornadaContratual {
  const fonte: JornadaContratual['fonte'] = funcionario?.jornadaUtilMin != null ? 'funcionario'
    : empresa?.jornadaUtilMin != null ? 'empresa' : 'padrao';
  const utilMin = funcionario?.jornadaUtilMin ?? empresa?.jornadaUtilMin ?? JORNADA_PADRAO.utilMin;
  const sabadoMin = funcionario?.jornadaSabadoMin ?? empresa?.jornadaSabadoMin ?? JORNADA_PADRAO.sabadoMin;
  const trabalhaSabado = empresa?.trabalhaSabado ?? JORNADA_PADRAO.trabalhaSabado;
  const calculadas = Math.round(((utilMin * 5 + (trabalhaSabado ? sabadoMin : 0)) / 60) * 10) / 10;
  return {
    utilMin, sabadoMin, trabalhaSabado,
    horasSemanais: empregado?.horasSemanais ?? calculadas,
    escala: empregado?.escala ?? null,
    dsr: empregado?.dsr ?? 0,
    fonte,
  };
}

/**
 * Há acordo de banco de horas vigente na data (padrão: sem data, só "tem acordo")?
 * Sem data de início no cadastro, vale para qualquer data (a ficha avisa).
 * Empregado desconhecido (null) → false: sem acordo, hora além da jornada é extra.
 */
export function temBancoDeHoras(
  empregado: Pick<Empregado, 'bancoHoras' | 'bancoHorasDesde'> | null | undefined,
  data?: string,
): boolean {
  if (!empregado?.bancoHoras) return false;
  if (!data || !empregado.bancoHorasDesde) return true;
  return data >= empregado.bancoHorasDesde;
}

/** O empregado estava com contrato na data (admitido e ainda não desligado)? */
export function vinculadoEm(e: Pick<Empregado, 'admissao' | 'situacao' | 'situacaoDesde'>, data: string): boolean {
  if (!e.admissao || data < e.admissao) return false;
  if (e.situacao === 'desligado' && e.situacaoDesde && data > e.situacaoDesde) return false;
  return true;
}

/** Normaliza o nome para casar ponto ↔ contrato ↔ DP (maiúsculas, espaços simples). */
export const nomeChave = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

/**
 * Jornada diária que revisão do ponto, resumo da folha e planilha usam — a MESMA
 * para os três (sai de `jornadaDoEmpregado`: funcionário → empresa → padrão), para
 * eles não discordarem. Devolve só o que o cálculo do dia precisa (`Jornada`).
 */
export function jornadaDaFolha(
  empregado: Pick<Empregado, 'horasSemanais' | 'escala' | 'dsr'> | null | undefined,
  funcionario: Pick<Funcionario, 'jornadaUtilMin' | 'jornadaSabadoMin'> | null | undefined,
  empresa: Jornada,
): Jornada {
  const j = jornadaDoEmpregado(empregado, funcionario, {
    jornadaUtilMin: empresa.utilMin, jornadaSabadoMin: empresa.sabadoMin, trabalhaSabado: empresa.trabalhaSabado,
  });
  return { utilMin: j.utilMin, sabadoMin: j.sabadoMin, trabalhaSabado: j.trabalhaSabado };
}
