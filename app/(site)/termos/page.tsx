import { meta } from '../_partes';
import { Documento, type SecaoDoc } from '../_documento';

export const metadata = meta(
  'Termos de uso',
  'Condições de uso do ClickContas: contratação, teste grátis, pagamento, responsabilidades do escritório contábil e da plataforma. Rascunho em revisão.',
  '/termos',
);

// RASCUNHO. Campos entre [colchetes] dependem de dados da empresa (razão social, CNPJ, foro, e-mail).
const SECOES: SecaoDoc[] = [
  {
    titulo: 'Quem somos e o que é o serviço',
    paragrafos: [
      'O ClickContas é uma plataforma on-line (software como serviço) operada por [razão social], inscrita no CNPJ [número], doravante “ClickContas”. Ela oferece aos escritórios de contabilidade ferramentas de Livro Caixa, Folha de Ponto com leitura assistida por inteligência artificial e Contrato de Experiência.',
      'Ao criar uma conta ou usar o serviço, o escritório contábil (“Contratante”) declara ter lido e aceito estes Termos. Se você aceita em nome de uma pessoa jurídica, declara ter poderes para isso.',
    ],
  },
  {
    titulo: 'Definições',
    itens: [
      'Contratante: o escritório de contabilidade que contrata o ClickContas.',
      'Usuários: pessoas autorizadas pelo Contratante a acessar a conta, como contadores, auxiliares e empresas-clientes do escritório.',
      'Empresa-cliente: pessoa física ou jurídica atendida pelo Contratante, cujos dados são inseridos na plataforma.',
      'Dados do Contratante: todas as informações inseridas ou geradas na plataforma, incluindo as de empresas-clientes e seus colaboradores.',
    ],
  },
  {
    titulo: 'Cadastro e conta',
    paragrafos: [
      'Para usar o serviço é preciso criar uma conta com informações verdadeiras e atualizadas. O Contratante é responsável por manter o sigilo das senhas e por toda atividade realizada com as credenciais dos seus Usuários.',
      'Cada conta pertence a um único escritório. Os dados de um escritório não são visíveis a outro. Avise-nos imediatamente se suspeitar de uso indevido da sua conta.',
    ],
  },
  {
    titulo: 'Teste grátis',
    paragrafos: [
      'Novos escritórios têm 14 dias de teste gratuito, sem necessidade de cartão de crédito. Ao fim do teste, é necessário contratar um plano para continuar usando o serviço. Sem contratação, a conta passa a modo somente leitura e os dados são mantidos pelo prazo informado na Política de Privacidade, para que o Contratante possa assinar ou exportá-los.',
    ],
  },
  {
    titulo: 'Planos, preços e pagamento',
    paragrafos: [
      'Os planos, os limites de empresas-clientes e os valores vigentes estão na página de Planos. A cobrança é recorrente, mensal ou anual, conforme a escolha do Contratante, e pode ser paga por Pix, boleto ou cartão de crédito por meio de um processador de pagamentos parceiro.',
      'O não pagamento pode levar à suspensão do acesso após aviso prévio. Podemos reajustar os preços mediante comunicação com antecedência mínima de 30 dias, sem efeito sobre o período já pago.',
    ],
  },
  {
    titulo: 'Cancelamento',
    paragrafos: [
      'O Contratante pode cancelar a qualquer momento, pelo painel ou por contato com o suporte, sem multa ou fidelidade. O acesso permanece até o fim do período já pago.',
      '[A definir com o advogado: política de reembolso proporcional do plano anual e direito de arrependimento do art. 49 do Código de Defesa do Consumidor, quando aplicável.]',
    ],
  },
  {
    titulo: 'Papéis na proteção de dados (LGPD)',
    paragrafos: [
      'Em relação aos Dados do Contratante, que incluem dados pessoais de empresas-clientes e de colaboradores delas, o Contratante é o controlador e o ClickContas é o operador, nos termos da Lei nº 13.709/2018 (LGPD). O ClickContas trata esses dados somente para prestar o serviço e conforme as instruções do Contratante.',
      'O Contratante é responsável por ter base legal para inserir esses dados na plataforma e por informar adequadamente seus clientes e os titulares. Os detalhes estão na Política de Privacidade, que integra estes Termos.',
    ],
  },
  {
    titulo: 'Responsabilidades do Contratante',
    itens: [
      'Usar o serviço de forma lícita e de acordo com estes Termos.',
      'Conferir os resultados antes de usá-los. A leitura por inteligência artificial pode errar: horários, valores e datas extraídos de imagens devem ser revisados por um profissional antes de qualquer uso fiscal, trabalhista ou contábil.',
      'Conferir os documentos gerados (contratos, declarações, avisos) e adequá-los à legislação e à convenção coletiva aplicáveis a cada caso.',
      'Não tentar acessar dados de outros escritórios, nem comprometer a segurança, a disponibilidade ou o desempenho da plataforma.',
      'Não inserir conteúdo ilícito, nem dados que não tenha o direito de tratar.',
    ],
  },
  {
    titulo: 'Responsabilidades do ClickContas',
    itens: [
      'Manter o serviço disponível com esforço razoável, ressalvadas paradas programadas, manutenção e eventos fora do nosso controle.',
      'Adotar medidas técnicas e administrativas adequadas para proteger os Dados do Contratante.',
      'Comunicar incidentes de segurança relevantes nos termos da Política de Privacidade e da lei.',
    ],
    paragrafos: [
      'O ClickContas é uma ferramenta de apoio e não presta serviços de contabilidade, jurídicos ou trabalhistas. A responsabilidade técnica pelo trabalho entregue às empresas-clientes é do Contratante.',
    ],
  },
  {
    titulo: 'Propriedade intelectual',
    paragrafos: [
      'A plataforma, sua marca, interface e código pertencem ao ClickContas. O Contratante recebe uma licença limitada, não exclusiva e intransferível de uso enquanto a assinatura estiver ativa. Os Dados do Contratante, bem como os modelos de documentos que ele enviar, continuam sendo dele.',
    ],
  },
  {
    titulo: 'Limitação de responsabilidade',
    paragrafos: [
      'Na extensão permitida pela lei, a responsabilidade total do ClickContas perante o Contratante limita-se ao valor pago nos 12 meses anteriores ao fato que originou a reclamação, e não abrange lucros cessantes ou danos indiretos. Nada nestes Termos exclui responsabilidades que a lei não permita excluir.',
    ],
  },
  {
    titulo: 'Disponibilidade, suspensão e encerramento',
    paragrafos: [
      'Podemos suspender ou encerrar contas que violem estes Termos, ofereçam risco à plataforma ou a terceiros, ou estejam inadimplentes, em geral com aviso prévio. Após o encerramento, o Contratante poderá exportar seus dados pelo prazo informado na Política de Privacidade; depois disso eles serão excluídos ou anonimizados, salvo obrigação legal de guarda.',
    ],
  },
  {
    titulo: 'Alterações destes Termos',
    paragrafos: [
      'Podemos atualizar estes Termos. Mudanças relevantes serão comunicadas por e-mail ou pelo painel com antecedência razoável. O uso do serviço após a vigência da nova versão indica concordância; quem não concordar poderá cancelar.',
    ],
  },
  {
    titulo: 'Contato, lei aplicável e foro',
    paragrafos: [
      'Dúvidas e solicitações: [e-mail de contato]. Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro da comarca de [cidade/UF] para resolver controvérsias, ressalvado o foro do domicílio do consumidor quando a lei assim determinar.',
    ],
  },
];

export default function Termos() {
  return (
    <Documento
      titulo="Termos de uso"
      atualizado="21 de novembro de 2026"
      intro="Estes Termos explicam as regras para usar o ClickContas. Leia com atenção: eles valem para o escritório contábil que contrata o serviço e para todas as pessoas que ele autoriza a usá-lo."
      secoes={SECOES}
    />
  );
}
