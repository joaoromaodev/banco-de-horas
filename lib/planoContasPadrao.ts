// Plano de contas padrão do Livro Caixa, derivado da aba "Plano de Contas" da
// planilha da contadora — que não tinha códigos. Aqui cada conta ganha um
// código N.GG.CC (1 = receita, 2 = despesa · grupo · conta), porque é pelo
// código que a classificação é feita no lançamento.
//
// `linhaBalanco` é o de-para para o Balanço Financeiro. É um RASCUNHO para a
// contadora corrigir: o modelo de balanço tem ~30 linhas e o plano tem ~120
// contas, então muita coisa fica `null` — ver LINHAS_BALANCO abaixo.

export interface ContaPadrao {
  codigo: string;
  nome: string;
  grupo: string;
  natureza: 'receita' | 'despesa';
  linhaBalanco: string | null;
  ordem: number;
}

/** Linhas do Balanço Financeiro (aba "Balanço Financeiro" da planilha). */
export const LINHAS_BALANCO = {
  entradaCaixa: [
    'Vendas a Vista', 'Vendas a Prazo', 'Recebimento de Duplicatas', 'Receitas de Juros',
    'Receitas de Comissões', 'Recuperações', 'Rendas de Investimentos', 'Cheques Recebidos',
    'Vendas de Bens do Ativo',
  ],
  entradaBancos: [
    'Depósitos Efetuados', 'Duplicatas Recebidas', 'Descontos de Duplicatas',
    'Caução de Duplicatas', 'Juros Creditados',
  ],
  saidaCaixa: [
    'Gastos iniciais', 'Compras de Ativos a vista', 'Compras de mercadorias', 'Duplicatas Pagas',
    'Titulos Pagos', 'Salarios', 'Honorários Contabeis', 'Comissões', 'Previdência Social',
    'Licença e funcionamento', 'Material de Escritório', 'Agua e Esgotos', 'Energia Elétrica',
    'Telefones', 'Icms', 'Imposto Simples', 'Multas e Juros Pagos',
  ],
  saidaBancos: ['Cheques emitidos', 'Despesas Bancarias', 'Duplicatas Debitadas'],
} as const;

// grupo → [natureza, código do grupo, contas: [nome, linha do balanço]]
type Def = [string, 'receita' | 'despesa', string, [string, string | null][]];

const DEFS: Def[] = [
  ['RECEITAS', 'receita', '1.01', [
    ['Rendimentos PF não Assalariado', 'Vendas a Vista'],
    ['Rendimentos PJ não Assalariado', 'Vendas a Vista'],
    ['Rendimentos PJ Assalariado', 'Vendas a Vista'],
    ['Receitas de aluguéis', 'Rendas de Investimentos'],
    ['Lucros na Venda de bens patrimoniais', 'Vendas de Bens do Ativo'],
    ['Rendas Extraordinárias', 'Recuperações'],
  ]],
  ['RECEITAS DE SERVIÇOS', 'receita', '1.02', [
    ['Serviços Prestados no Estado', 'Vendas a Vista'],
    ['Serviços Prestados em outro Estado', 'Vendas a Vista'],
    ['Serviços Prestados no Exterior', 'Vendas a Vista'],
    ['( - ) Serviços não Recebidos', null],
  ]],
  ['RECEITAS DE VENDAS DE MERCADORIAS', 'receita', '1.03', [
    ['Mercadorias Vendidas no Estado', 'Vendas a Vista'],
    ['Mercadorias Vendidas para outro Estado', 'Vendas a Vista'],
    ['Mercadorias Vendidas para o Exterior', 'Vendas a Vista'],
    ['( - ) Devoluções de Mercadorias', null],
  ]],
  ['RECEITAS DE VENDAS DE PRODUTOS', 'receita', '1.04', [
    ['Produtos fabricados / Vendas no Estado', 'Vendas a Vista'],
    ['Produtos fabricados / Vendas para outro Estado', 'Vendas a Vista'],
    ['Produtos fabricados / Vendas no Exterior', 'Vendas a Vista'],
    ['( - ) Devoluções de Produtos', null],
  ]],
  ['RECEITAS OPERACIONAIS', 'receita', '1.05', [
    ['Aluguéis ativos', 'Rendas de Investimentos'],
    ['Multas e Juros Recebidos', 'Receitas de Juros'],
  ]],
  ['RECEITAS FINANCEIRAS', 'receita', '1.06', [
    ['Descontos Obtidos', 'Receitas de Juros'],
    ['Rendimentos s/ aplicações financeiras', 'Rendas de Investimentos'],
    ['Variações Cambiais', 'Rendas de Investimentos'],
  ]],
  ['RECEITAS DIVERSAS', 'receita', '1.07', [
    ['Receitas de aluguéis', 'Rendas de Investimentos'],
    ['Superveniências Ativas', 'Recuperações'],
    ['Lucros na Venda de bens patrimoniais', 'Vendas de Bens do Ativo'],
    ['Rendas Extraordinárias', 'Recuperações'],
    ['Valorização de bens', 'Vendas de Bens do Ativo'],
  ]],
  ['RECEITAS EVENTUAIS', 'receita', '1.08', [
    ['Recuperação de FGTS', 'Recuperações'],
    ['Recuperação de materiais', 'Recuperações'],
    ['Recuperação de despesas', 'Recuperações'],
    ['Reversão de provisões', 'Recuperações'],
    ['Lucros em partic. em outras companhias', 'Rendas de Investimentos'],
    ['Perdas recuperadas', 'Recuperações'],
    ['Variações monetárias ativas', 'Rendas de Investimentos'],
    ['Ganhos em transações do ativo permanente', 'Vendas de Bens do Ativo'],
    ['Dividendos', 'Rendas de Investimentos'],
    ['Aumento do valor ações outras empresas', 'Rendas de Investimentos'],
    ['Ações bonificadas', 'Rendas de Investimentos'],
  ]],

  ['DESPESAS COM VENDAS', 'despesa', '2.01', [
    ['Compras de mercadorias', 'Compras de mercadorias'],
    ['Fretes e Seguros sobre compras', 'Compras de mercadorias'],
    ['Compras anuladas', null],
    ['Bonificações a compradores', null],
    ['Devedores duvidosos', null],
    ['Despesas diversas com vendas', null],
  ]],
  ['DESPESAS OPERACIONAIS', 'despesa', '2.02', [
    ['Água e esgoto', 'Agua e Esgotos'],
    ['Energia Elétrica', 'Energia Elétrica'],
    ['Telefones', 'Telefones'],
    ['Provedor - Internet', 'Telefones'],
    ['Material de Limpeza', 'Material de Escritório'],
    ['Material de Expediente', 'Material de Escritório'],
    ['Material de Embalagem', 'Material de Escritório'],
    ['Lanches e Refeições', null],
    ['Condução e Transportes', null],
    ['Combustível', null],
    ['Peças e Material de Reposição', null],
    ['Manutenção de Computadores e Impressoras', null],
  ]],
  ['DESPESAS ADMINISTRATIVAS', 'despesa', '2.03', [
    ['Aluguel', null],
    ['Depreciação', null],
    ['Amortização', null],
    ['Exaustão', null],
    ['Prêmios de Seguro', null],
    ['Gratificações', 'Salarios'],
    ['Viagens e estadias', null],
    ['Publicidade e propaganda', null],
    ['Correios e Telégrafos', null],
    ['Despesas legais e Jurídicas', null],
    ['Despesas com Cartórios', null],
    ['Despesas com cobranças', null],
    ['Jornais e Revistas', null],
  ]],
  ['DESPESAS TRABALHISTAS', 'despesa', '2.04', [
    ['Pró-labore', 'Salarios'],
    ['Honorários de Diretoria', 'Salarios'],
    ['Salários', 'Salarios'],
    ['INSS', 'Previdência Social'],
    ['IRRF', null],
    ['FGTS', 'Previdência Social'],
    ['Férias', 'Salarios'],
    ['13º Salário', 'Salarios'],
    ['Indenizações', 'Salarios'],
    ['Multa de Natureza contratual', 'Multas e Juros Pagos'],
    ['Vale-Transporte', 'Salarios'],
    ['Refeições e Lanches', null],
  ]],
  ['DESPESAS SINDICAIS', 'despesa', '2.05', [
    ['Assistência Médica', null],
    ['Contribuição Sindical Anual', null],
    ['Contribuição Confederativa', null],
    ['Contribuição Assistencial', null],
    ['Seguros de Acidentes do Trabalho', null],
    ['Outras Despesas com pessoal', null],
    ['Contribuições a Órgãos de Classe', null],
    ['Contribuição Sindical Patronal', null],
  ]],
  ['SERVIÇOS DE TERCEIROS', 'despesa', '2.06', [
    ['Serviços Prestados por Pessoa Física', 'Comissões'],
    ['Serviços Prestados por Pessoa Jurídica', 'Comissões'],
    ['Serviços Contábeis', 'Honorários Contabeis'],
    ['Serviços Advocatícios', null],
  ]],
  ['DESPESAS TRIBUTÁRIAS — FEDERAIS', 'despesa', '2.07', [
    ['SIMPLES', 'Imposto Simples'],
    ['IRRF s/ Salários', null],
    ['IRRF s/ Serviços de Terceiros', null],
    ['IRRF s/ Aluguéis', null],
    ['IRPJ', null],
    ['CSLL', null],
    ['COFINS', null],
    ['PIS/PASEP / Faturamento', null],
    ['PIS - Folha de Pagamento', null],
    ['IPI', null],
  ]],
  ['DESPESAS TRIBUTÁRIAS — ESTADUAIS', 'despesa', '2.08', [
    ['ICMS', 'Icms'],
    ['IPVA', null],
  ]],
  ['DESPESAS TRIBUTÁRIAS — MUNICIPAIS', 'despesa', '2.09', [
    ['ISSQN a Recolher', null],
    ['TLIF a Recolher', 'Licença e funcionamento'],
    ['IPTU a Recolher', null],
    ['Taxa de propaganda a Recolher (CADAM)', null],
    ['Contribuição de Melhoria', null],
  ]],
  ['DESPESAS FINANCEIRAS', 'despesa', '2.10', [
    ['Descontos Concedidos', null],
    ['Despesas Bancárias', 'Despesas Bancarias'],
    ['Multas e Juros Pagos', 'Multas e Juros Pagos'],
    ['Despesas c/ Créditos de liquidação Duvidosa', null],
  ]],
  ['DESPESAS GERAIS', 'despesa', '2.11', [
    ['Brindes e Presentes', null],
    ['Despesas Eventuais', null],
    ['Outros Gastos com Conservação', null],
  ]],
];

export const PLANO_CONTAS_PADRAO: ContaPadrao[] = DEFS
  .flatMap(([grupo, natureza, codGrupo, contas]) =>
    contas.map(([nome, linhaBalanco], iConta): Omit<ContaPadrao, 'ordem'> => ({
      codigo: `${codGrupo}.${String(iConta + 1).padStart(2, '0')}`,
      nome,
      grupo,
      natureza,
      linhaBalanco,
    })))
  .map((c, ordem) => ({ ...c, ordem }));

/** Históricos padronizados — a lista que aparece para quem lança escolher. */
export const HISTORICOS_PADRAO: { texto: string; natureza: 'receita' | 'despesa'; codigoConta?: string }[] = [
  // entradas
  { texto: 'Recebido de cliente', natureza: 'receita', codigoConta: '1.02.01' },
  { texto: 'Recebido cheque pré-datado', natureza: 'receita', codigoConta: '1.02.01' },
  { texto: 'Recebido honorários', natureza: 'receita', codigoConta: '1.02.01' },
  { texto: 'Recebido aluguel', natureza: 'receita', codigoConta: '1.05.01' },
  { texto: 'Recebido multa e juros', natureza: 'receita', codigoConta: '1.05.02' },
  { texto: 'Retirada de conta corrente', natureza: 'receita' },
  { texto: 'Venda de mercadoria', natureza: 'receita', codigoConta: '1.03.01' },
  // saídas
  { texto: 'Pago conta de luz', natureza: 'despesa', codigoConta: '2.02.02' },
  { texto: 'Pago conta de água', natureza: 'despesa', codigoConta: '2.02.01' },
  { texto: 'Pago conta de telefone', natureza: 'despesa', codigoConta: '2.02.03' },
  { texto: 'Pago internet', natureza: 'despesa', codigoConta: '2.02.04' },
  { texto: 'Pago aluguel do escritório', natureza: 'despesa', codigoConta: '2.03.01' },
  { texto: 'Pago salário de funcionário', natureza: 'despesa', codigoConta: '2.04.03' },
  { texto: 'Pago pró-labore', natureza: 'despesa', codigoConta: '2.04.01' },
  { texto: 'Pago INSS', natureza: 'despesa', codigoConta: '2.04.04' },
  { texto: 'Pago FGTS', natureza: 'despesa', codigoConta: '2.04.06' },
  { texto: 'Pago honorários contábeis', natureza: 'despesa', codigoConta: '2.06.03' },
  { texto: 'Pago SIMPLES', natureza: 'despesa', codigoConta: '2.07.01' },
  { texto: 'Pago material de expediente', natureza: 'despesa', codigoConta: '2.02.06' },
  { texto: 'Pago combustível', natureza: 'despesa', codigoConta: '2.02.10' },
  { texto: 'Pago multa e juros', natureza: 'despesa', codigoConta: '2.10.03' },
  { texto: 'Despesa bancária', natureza: 'despesa', codigoConta: '2.10.02' },
  { texto: 'Depósito em conta corrente', natureza: 'despesa' },
  { texto: 'Cheque devolvido', natureza: 'despesa' },
];
