// Regras de validação — destacam células suspeitas antes de gravar.
import { Frequencia } from './tipos';
import { parseHoraParaMin, formatarMin } from './tempo';
import { tipoDoDia, diasNoMes } from './calendario';

export type CampoDia =
  | 'entradaManha'
  | 'saidaAlmoco'
  | 'retornoAlmoco'
  | 'saidaTarde'
  | 'geral';

export interface Alerta {
  dia: number;
  campo: CampoDia;
  nivel: 'erro' | 'alerta';
  msg: string;
}

const ORDEM: { campo: Exclude<CampoDia, 'geral'>; get: (d: any) => string | null | undefined }[] = [
  { campo: 'entradaManha', get: (d) => d?.entradaManha },
  { campo: 'saidaAlmoco', get: (d) => d?.saidaAlmoco },
  { campo: 'retornoAlmoco', get: (d) => d?.retornoAlmoco },
  { campo: 'saidaTarde', get: (d) => d?.saidaTarde },
];

export function validar(freq: Frequencia, feriados: Set<string>): Alerta[] {
  const alertas: Alerta[] = [];
  const N = diasNoMes(freq.ano, freq.mes);
  const porDia = new Map(freq.dias.map((d) => [d.dia, d]));

  for (let dia = 1; dia <= N; dia++) {
    const tipo = tipoDoDia(freq.ano, freq.mes, dia, feriados);
    const reg = porDia.get(dia);
    const marc = reg?.marcador ?? null;

    const mins = ORDEM.map(({ campo, get }) => ({ campo, v: parseHoraParaMin(get(reg)) }));
    const temAlgum = mins.some((m) => m.v != null);

    // Domingo/feriado não deveria ter horários (a menos que marcado)
    if ((tipo === 'domingo' || tipo === 'feriado') && temAlgum && !marc) {
      alertas.push({ dia, campo: 'geral', nivel: 'alerta', msg: `Dia ${dia} é ${tipo} mas tem horários lançados.` });
    }

    // Dia de trabalho totalmente vazio e sem marcador
    if ((tipo === 'util' || tipo === 'sabado') && !temAlgum && !marc) {
      alertas.push({ dia, campo: 'geral', nivel: 'alerta', msg: `Dia ${dia} (${tipo}) está vazio e sem marcador (falta? folga?).` });
    }

    // Ordem cronológica
    let prevV: number | null = null;
    let prevC = '';
    for (const { campo, v } of mins) {
      if (v == null) continue;
      if (prevV != null && v < prevV) {
        alertas.push({ dia, campo, nivel: 'erro', msg: `Dia ${dia}: ${campo} (${formatarMin(v)}) vem antes de ${prevC} (${formatarMin(prevV)}).` });
      } else if (prevV != null && v === prevV) {
        alertas.push({ dia, campo, nivel: 'alerta', msg: `Dia ${dia}: ${campo} igual a ${prevC} (${formatarMin(v)}) — confira.` });
      }
      prevV = v;
      prevC = campo;
    }

    // Plausibilidade de horários
    const em = mins[0].v;
    const st = mins[3].v;
    if (em != null && (em < 300 || em > 600)) {
      alertas.push({ dia, campo: 'entradaManha', nivel: 'alerta', msg: `Dia ${dia}: entrada ${formatarMin(em)} fora do usual (05:00–10:00).` });
    }
    if (st != null && (st < 720 || st > 1320)) {
      alertas.push({ dia, campo: 'saidaTarde', nivel: 'alerta', msg: `Dia ${dia}: saída ${formatarMin(st)} fora do usual (12:00–22:00).` });
    }

    // Jornada total plausível
    const [sa, ra] = [mins[1].v, mins[2].v];
    if (em != null && sa != null && ra != null && st != null) {
      const total = (sa - em) + (st - ra);
      if (total > 720) {
        alertas.push({ dia, campo: 'geral', nivel: 'alerta', msg: `Dia ${dia}: jornada de ${formatarMin(total)} acima de 12h.` });
      }
    }

    // Horários incompletos num dia de trabalho
    if ((tipo === 'util' || tipo === 'sabado') && temAlgum && !marc) {
      const faltando = mins.filter((m) => m.v == null).map((m) => m.campo);
      if (faltando.length) {
        alertas.push({ dia, campo: 'geral', nivel: 'alerta', msg: `Dia ${dia}: horários incompletos (${faltando.join(', ')}).` });
      }
    }
  }

  return alertas;
}
