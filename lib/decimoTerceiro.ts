// 13º salário — regras puras (testadas em tests/decimoTerceiro.test.ts). Só prazos e
// conferência de avos; nada de valores em reais nesta etapa. Ver docs/departamento-pessoal.md.
//
//  - avos (Lei 4.090/62 art. 1º §2º): 1/12 por mês do ano em que o empregado tem 15
//    dias ou mais de trabalho — dias de contrato no mês menos as FALTAS lançadas no ponto;
//  - prazos (Lei 4.749/65): 1ª parcela até 30/11 e 2ª até 20/12; quando não é dia útil,
//    antecipa para o dia útil anterior (20/12/2026 é domingo → 18/12);
//  - afastamento muda o cálculo conforme o tipo (contador, 21/11/2026): doença → a
//    empresa paga até o 15º dia e o INSS o abono do resto (Lei 8.213 art. 40); acidente
//    não reduz (Súmula 46 TST); maternidade conta integralmente. Aqui vira aviso na ficha.
import { Calendario } from './agenda';
import type { Empregado } from './dp';

const pad = (n: number) => String(n).padStart(2, '0');
const ultimoDia = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
const diasEntreIncl = (de: string, ate: string) => {
  const t = (iso: string) => { const [a, m, d] = iso.split('-').map(Number); return Date.UTC(a, m - 1, d); };
  return Math.round((t(ate) - t(de)) / 86_400_000) + 1;
};

export const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export interface MesAvo {
  mes: number;
  /** Dias de contrato no mês (da admissão ao desligamento). */
  diasContrato: number;
  faltas: number;
  conta: boolean;
  /** Mês ainda por vir (o avo é previsão). */
  projetado: boolean;
}

export interface Avos {
  ano: number;
  meses: MesAvo[];
  /** Avos que já contam (meses passados ou o atual). */
  avos: number;
  /** Avos previstos até dezembro (se nada mudar). */
  previstos: number;
}

/**
 * Avos do 13º no ano. `faltasPorMes`: mês (1–12) → faltas lançadas. Desligado: até o
 * desligamento. Sem admissão ou admitido depois do ano: zero.
 */
export function avosDecimo(
  e: Pick<Empregado, 'admissao' | 'situacao' | 'situacaoDesde'>, ano: number,
  faltasPorMes: Map<number, number> = new Map(), hoje?: string,
): Avos {
  const meses: MesAvo[] = [];
  const fimContrato = e.situacao === 'desligado' && e.situacaoDesde ? e.situacaoDesde : null;
  for (let mes = 1; mes <= 12; mes++) {
    const ini = `${ano}-${pad(mes)}-01`;
    const fim = `${ano}-${pad(mes)}-${pad(ultimoDia(ano, mes))}`;
    let diasContrato = 0;
    if (e.admissao) {
      const de = e.admissao > ini ? e.admissao : ini;
      const ate = fimContrato && fimContrato < fim ? fimContrato : fim;
      diasContrato = ate >= de ? diasEntreIncl(de, ate) : 0;
    }
    const faltas = Math.min(faltasPorMes.get(mes) ?? 0, diasContrato);
    meses.push({
      mes, diasContrato, faltas,
      conta: diasContrato - faltas >= 15,
      projetado: Boolean(hoje && ini > hoje),
    });
  }
  return {
    ano, meses,
    avos: meses.filter((m) => m.conta && !m.projetado).length,
    previstos: meses.filter((m) => m.conta).length,
  };
}

/** Faltas (datas AAAA-MM-DD) agrupadas por mês do ano. */
export function faltasPorMesDoAno(faltas: string[], ano: number): Map<number, number> {
  const m = new Map<number, number>();
  for (const d of faltas) {
    if (Number(d.slice(0, 4)) !== ano) continue;
    const mes = Number(d.slice(5, 7));
    m.set(mes, (m.get(mes) ?? 0) + 1);
  }
  return m;
}

export interface Prazos13 { primeira: string; segunda: string }

/** Prazos do ano, antecipados para o dia útil anterior quando caem em fim de semana ou feriado. */
export function prazosDecimo(ano: number, cal = new Calendario()): Prazos13 {
  return { primeira: cal.ajustar(`${ano}-11-30`, 'antecipa'), segunda: cal.ajustar(`${ano}-12-20`, 'antecipa') };
}

/** O empregado entra no 13º do ano? (ativo ou afastado, admitido até o fim do ano.) */
export function entraNoDecimo(e: Pick<Empregado, 'admissao' | 'situacao' | 'situacaoDesde'>, ano: number): boolean {
  if (!e.admissao || e.admissao > `${ano}-12-31`) return false;
  if (e.situacao === 'desligado') return false; // vai na rescisão
  return true;
}

/** Aviso da ficha conforme o afastamento (o número de avos muda com o tipo). */
export function avisoAfastamento13(e: Pick<Empregado, 'situacao' | 'afastamentoTipo'>): string | null {
  if (e.situacao !== 'afastado') return null;
  switch (e.afastamentoTipo) {
    case 'doenca': return 'Afastado por doença: a empresa paga os avos até o 15º dia; o restante é abono anual do INSS (Lei 8.213 art. 40). Confira os avos à mão.';
    case 'acidente': return 'Afastado por acidente de trabalho: o afastamento não reduz o 13º (Súmula 46 TST).';
    case 'maternidade': return 'Licença-maternidade: conta integralmente para o 13º.';
    default: return 'Afastado: confira se o afastamento reduz os avos do 13º.';
  }
}
