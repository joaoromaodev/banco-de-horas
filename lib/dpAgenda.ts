// Departamento Pessoal na agenda e no resumo por e-mail — regras puras (testadas em
// tests/dpAgenda.test.ts). Mesmo padrão dos contratos (lib/agendaDerivada.ts): os itens
// saem do cadastro do empregado e das férias programadas a cada consulta — nada é
// duplicado na agenda nem precisa de "feita".
//
//  - férias vencidas: aparecem (como atrasadas) até serem programadas;
//  - férias vencendo: o limite para começar o gozo sem dobro;
//  - férias programadas: o próximo marco (dar o aviso até, pagar até, início);
//  - 13º: 1 item por empresa com empregados no 13º, nos 30 dias antes de cada prazo,
//    e some depois do prazo (o sistema não registra o pagamento).
//
// Nenhum item leva salário nem CPF: o e-mail só diz o nome do empregado.
import type { ItemResumo } from './agenda';
import { Calendario } from './agenda';
import { entraNoDecimo, prazosDecimo } from './decimoTerceiro';
import { br, type Empregado } from './dp';
import {
  alertasFerias, avisoAte, diasEntre, proximoMarco, ROTULO_MARCO, situacaoFerias, type FeriasProgramada,
} from './ferias';

export type TipoItemDp = 'ferias_vencida' | 'ferias_vencendo' | 'ferias_programada' | 'decimo';

export type ItemDp = ItemResumo & {
  id: string;
  empresaId: string;
  tipo: TipoItemDp;
  /** Dias até o vencimento (negativo = atrasado). */
  dias: number;
  /** Empregado (ausente no 13º, que é por empresa). */
  empregadoId?: string;
};

export interface DadosDp {
  empregados: Empregado[];
  ferias: FeriasProgramada[];
  /** Faltas (datas) por empregado. */
  faltas: Map<string, string[]>;
  /** Feriados do escritório + legais, para o prazo de pagamento. */
  feriados?: Set<string>;
}

/** Janela do 13º: aparece nos 30 dias antes de cada prazo. */
export const JANELA_13 = 30;

export function itensDoDp(d: DadosDp, nomeEmpresa: Map<string, string>, hoje: string, cal = new Calendario()): ItemDp[] {
  const itens: ItemDp[] = [];
  const nome = (id: string) => nomeEmpresa.get(id) ?? id;
  const feriasPorEmp = new Map<string, FeriasProgramada[]>();
  for (const f of d.ferias) feriasPorEmp.set(f.empregadoId, [...(feriasPorEmp.get(f.empregadoId) ?? []), f]);

  for (const e of d.empregados) {
    if (e.situacao === 'desligado') continue;
    const programadas = feriasPorEmp.get(e.id) ?? [];
    const periodos = situacaoFerias(e, d.faltas.get(e.id) ?? [], programadas, hoje);
    for (const a of alertasFerias(e, periodos, hoje)) {
      if (a.rotulo !== 'Férias vencidas' && a.rotulo !== 'Férias vencendo') continue;
      const vencida = a.rotulo === 'Férias vencidas';
      // Vencendo: o prazo que importa é o do AVISO (30 dias antes do limite de início).
      const venc = vencida ? a.data : avisoAte(a.data);
      itens.push({
        id: `ferias:${e.id}:${a.periodoInicio}`, empresaId: e.empresaId, empresa: nome(e.empresaId), empregadoId: e.id,
        tipo: vencida ? 'ferias_vencida' : 'ferias_vencendo',
        obrigacao: vencida
          ? `Férias vencidas de ${e.nome} (período de ${br(a.periodoInicio)}) — pagamento em dobro`
          : `Férias de ${e.nome} — dar o aviso até ${br(venc)} para começar até ${br(a.data)} (período de ${br(a.periodoInicio)})`,
        competencia: 'unica', vencimento: venc, responsavel: null, dias: diasEntre(hoje, venc),
      });
    }
    for (const f of programadas) {
      const m = proximoMarco(f, hoje, d.feriados);
      if (!m) continue;
      itens.push({
        id: `programada:${f.id}`, empresaId: e.empresaId, empresa: nome(e.empresaId), empregadoId: e.id,
        tipo: 'ferias_programada',
        obrigacao: `Férias de ${e.nome} (${br(f.inicio)}, ${f.dias} dias) — ${ROTULO_MARCO[m.marco]} ${br(m.data)}`,
        competencia: 'unica', vencimento: m.data, responsavel: null, dias: diasEntre(hoje, m.data),
      });
    }
  }

  // 13º: por empresa, com quantos empregados entram.
  const ano = Number(hoje.slice(0, 4));
  const prazos = prazosDecimo(ano, cal);
  const porEmpresa = new Map<string, number>();
  for (const e of d.empregados) if (entraNoDecimo(e, ano)) porEmpresa.set(e.empresaId, (porEmpresa.get(e.empresaId) ?? 0) + 1);
  for (const [empresaId, qtd] of porEmpresa) {
    for (const [parcela, data] of [['1ª parcela', prazos.primeira], ['2ª parcela', prazos.segunda]] as const) {
      const dias = diasEntre(hoje, data);
      if (dias < 0 || dias > JANELA_13) continue;
      itens.push({
        id: `decimo:${empresaId}:${ano}:${parcela[0]}`, empresaId, empresa: nome(empresaId), tipo: 'decimo',
        obrigacao: `13º salário ${ano} — ${parcela} (${qtd} ${qtd === 1 ? 'empregado' : 'empregados'})`,
        competencia: String(ano), vencimento: data, responsavel: null, dias,
      });
    }
  }
  return itens.sort((x, y) => x.vencimento.localeCompare(y.vencimento) || x.empresa.localeCompare(y.empresa, 'pt-BR') || x.obrigacao.localeCompare(y.obrigacao, 'pt-BR'));
}

/** Antecedência de cada tipo no resumo por e-mail (`avisoDias` de lib/agenda.ts). */
export function antecedenciaNoResumo(tipo: TipoItemDp): number {
  if (tipo === 'decimo') return JANELA_13;
  if (tipo === 'ferias_vencendo') return 15;
  return 0;
}

/**
 * Só os itens que valem a pena na agenda/no e-mail: atrasados e os que vencem em até
 * `janela` dias (o 13º já vem filtrado pela própria janela de 30 dias).
 */
export function itensNaJanela(itens: ItemDp[], janela: number): ItemDp[] {
  return itens.filter((i) => i.dias < 0 || i.dias <= janela || i.tipo === 'decimo');
}
