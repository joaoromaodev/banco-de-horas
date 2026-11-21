// Agenda derivada do cadastro — regras puras (testadas em tests/agendaDerivada.test.ts).
//
//  1. Proposta de modelo de obrigações: a partir do REGIME que a contadora
//     registrou e de sinais do cadastro (funcionários no ponto, contrato ativo,
//     pessoa física, identifica pagador). Só sugere; aplicar é um clique dela.
//     Regime NÃO se deduz por CNAE nem por faturamento.
//  2. Marcos do contrato de experiência (fim do 1º período e da prorrogação)
//     como itens da agenda e do e-mail, derivados dos contratos salvos.
import { aplicarModelo, ItemResumo, MODELOS, Regime } from './agenda';
import { alertaDe, ContratoSalvo, br } from './contratos';

/** Regimes que a contadora escolhe. "Com folha" é derivado dos sinais, não escolhido. */
export type RegimeCadastro = 'mei' | 'simples' | 'presumido' | 'pessoa_fisica';
export const REGIMES_CADASTRO: { valor: RegimeCadastro; rotulo: string }[] = [
  { valor: 'mei', rotulo: 'MEI' },
  { valor: 'simples', rotulo: 'Simples Nacional' },
  { valor: 'presumido', rotulo: 'Lucro Presumido' },
  { valor: 'pessoa_fisica', rotulo: 'Pessoa física / autônomo' },
];

export function regimeCadastroValido(r: unknown): r is RegimeCadastro {
  return REGIMES_CADASTRO.some((x) => x.valor === r);
}

export interface SinaisEmpresa {
  tipoPessoa?: 'juridica' | 'fisica' | null;
  identificaPagador?: boolean | null;
  /** Funcionários no módulo de ponto; `null` = não foi possível consultar. */
  funcionarios: number | null;
  /** Contratos de experiência em andamento ou efetivados; `null` = não consultado. */
  contratosAtivos: number | null;
}

export type PropostaAgenda =
  /** Há o que aplicar: `modelo` é o regime do modelo, `faltam` os tipos que a empresa ainda não tem. */
  | { situacao: 'propor'; modelo: Regime; nomeModelo: string; origem: 'cadastro' | 'sinal'; motivos: string[]; faltam: string[]; sobram: string[] }
  /** O modelo já está todo na agenda. */
  | { situacao: 'em_dia'; modelo: Regime; nomeModelo: string; sobram: string[] }
  /** Sem regime registrado e sem sinal: a contadora precisa dizer qual é. */
  | { situacao: 'perguntar'; motivos: string[] };

/** Tipos de obrigação que algum modelo conhece (o resto é cadastrado à mão e nunca é "sobra"). */
const TIPOS_DE_MODELO = new Set(MODELOS.flatMap((m) => m.tipos));

export function propostaDeAgenda(
  regime: RegimeCadastro | null, sinais: SinaisEmpresa, tiposExistentes: string[],
): PropostaAgenda {
  const motivos: string[] = [];
  let base: RegimeCadastro | null = regime;
  let origem: 'cadastro' | 'sinal' = 'cadastro';

  if (regime) {
    motivos.push(`Regime registrado: ${REGIMES_CADASTRO.find((r) => r.valor === regime)!.rotulo}.`);
  } else if (sinais.tipoPessoa === 'fisica' || sinais.identificaPagador) {
    base = 'pessoa_fisica';
    origem = 'sinal';
    if (sinais.tipoPessoa === 'fisica') motivos.push('O cadastro é de pessoa física.');
    if (sinais.identificaPagador) motivos.push('Identifica o pagador nas entradas do caixa (Carnê-Leão).');
  } else {
    return { situacao: 'perguntar', motivos: ['A empresa ainda não tem regime registrado.'] };
  }

  let modelo: Regime = base!;
  if (base === 'simples') {
    const comFolha = (sinais.funcionarios ?? 0) > 0 || (sinais.contratosAtivos ?? 0) > 0;
    if (comFolha) {
      modelo = 'simples_folha';
      if ((sinais.funcionarios ?? 0) > 0) motivos.push(`Tem ${sinais.funcionarios} ${sinais.funcionarios === 1 ? 'funcionário' : 'funcionários'} no ponto.`);
      if ((sinais.contratosAtivos ?? 0) > 0) motivos.push(`Tem ${sinais.contratosAtivos} ${sinais.contratosAtivos === 1 ? 'contrato' : 'contratos'} de experiência ativo${sinais.contratosAtivos === 1 ? '' : 's'}.`);
    } else if (sinais.funcionarios === null && sinais.contratosAtivos === null) {
      motivos.push('Não foi possível ver os funcionários; confira se a empresa tem folha.');
    }
  }

  const m = MODELOS.find((x) => x.regime === modelo)!;
  const faltam = aplicarModelo(modelo, 'x', '2000-01-01', tiposExistentes).map((o) => o.tipo);
  // Do que existe, o que pertence a algum modelo mas não a este (ex.: folha que sobrou).
  const sobram = [...new Set(tiposExistentes)].filter((t) => TIPOS_DE_MODELO.has(t) && !m.tipos.includes(t));
  if (!faltam.length) return { situacao: 'em_dia', modelo, nomeModelo: m.nome, sobram };
  return { situacao: 'propor', modelo, nomeModelo: m.nome, origem, motivos, faltam, sobram };
}

// ------------------------------------------------------- contratos na agenda

/**
 * Próximo marco de cada contrato em experiência (fim do 1º período ou da
 * prorrogação) como item de agenda/e-mail. Vencido sem providência continua
 * aparecendo (vira prazo indeterminado) até a contadora marcar efetivado ou
 * encerrado — por isso não precisa de "feita": o dado vem do próprio contrato.
 */
export type ItemContrato = ItemResumo & { id: string; empresaId: string; marco: string; dias: number };

export function itensDeContratos(
  contratos: Pick<ContratoSalvo, 'id' | 'empresa' | 'situacao' | 'dados'>[],
  nomeEmpresa: Map<string, string>, hoje: string, janela: number,
): ItemContrato[] {
  const itens: ItemContrato[] = [];
  for (const c of contratos) {
    const a = alertaDe(c.dados, c.situacao, hoje, janela);
    if (!a) continue;
    itens.push({
      id: c.id,
      empresaId: c.empresa,
      empresa: nomeEmpresa.get(c.empresa) ?? c.empresa,
      obrigacao: `Contrato de experiência de ${c.dados.nome} — fim do ${a.marco} (${br(a.data)})`,
      competencia: 'unica',
      vencimento: a.data,
      responsavel: null,
      marco: a.marco,
      dias: a.dias,
    });
  }
  return itens.sort((x, y) => x.vencimento.localeCompare(y.vencimento) || x.empresa.localeCompare(y.empresa, 'pt-BR'));
}
