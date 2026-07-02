// Modelo de domínio do banco de horas.

export type Marcador =
  | 'FERIADO'
  | 'BANCO DE HORAS'
  | 'ATESTADO'
  | 'FOLGA'
  | 'FALTA'
  | 'FÉRIAS';

export const MARCADORES: Marcador[] = [
  'FERIADO',
  'BANCO DE HORAS',
  'ATESTADO',
  'FOLGA',
  'FALTA',
  'FÉRIAS',
];

/** Um dia da folha de ponto. Horários no formato "HH:MM" ou null. */
export interface DiaFreq {
  dia: number; // 1..31
  entradaManha: string | null;
  saidaAlmoco: string | null;
  retornoAlmoco: string | null;
  saidaTarde: string | null;
  marcador?: Marcador | null;
}

/** Frequência de um funcionário num mês. */
export interface Frequencia {
  empresa: string; // razão social da empresa-cliente
  funcionario: string;
  cargo?: string | null;
  ano: number;
  mes: number; // 1..12
  dias: DiaFreq[];
}

export interface Funcionario {
  empresa: string; // a qual empresa-cliente pertence
  nome: string;
  cargo?: string | null;
  ordem?: number | null;
  // jornada em minutos; padrão 8h dia útil, 4h sábado
  jornadaUtilMin?: number;
  jornadaSabadoMin?: number;
}

/** Empresa-cliente da contadora. O `nome` (razão social) vai no cabeçalho da planilha. */
export interface Empresa {
  nome: string;
  cnpj?: string | null;
  /** A empresa trabalha aos sábados? Quando false, sábado vira folga. */
  trabalhaSabado: boolean;
  // jornada padrão da empresa em minutos (funcionário pode sobrescrever)
  jornadaUtilMin?: number;
  jornadaSabadoMin?: number;
  ordem?: number | null;
}
