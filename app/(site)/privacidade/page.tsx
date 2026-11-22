import { meta } from '../_partes';
import { Documento, type SecaoDoc } from '../_documento';

export const metadata = meta(
  'Política de privacidade',
  'Como o ClickContas trata dados pessoais conforme a LGPD: o escritório contábil é o controlador dos dados de seus clientes e o ClickContas atua como operador. Rascunho em revisão.',
  '/privacidade',
);

// RASCUNHO. Campos entre [colchetes] dependem de dados da empresa. Prazos de retenção são propostas.
const SECOES: SecaoDoc[] = [
  {
    titulo: 'Quem é quem',
    paragrafos: [
      'Esta Política descreve como o ClickContas (operado por [razão social], CNPJ [número]) trata dados pessoais, em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018). Nosso tratamento tem dois papéis diferentes:',
    ],
    itens: [
      'Dados dos clientes do escritório (empresas-clientes, seus sócios, colaboradores, lançamentos de caixa, folhas de ponto, contratos): o escritório contábil é o CONTROLADOR — decide por que e como usar esses dados — e o ClickContas é o OPERADOR — trata os dados em nome do escritório, segundo as instruções dele, apenas para prestar o serviço.',
      'Dados do próprio escritório e de seus usuários (cadastro, login, cobrança, uso do site): aqui o ClickContas é o CONTROLADOR.',
    ],
  },
  {
    titulo: 'Quais dados tratamos',
    itens: [
      'Cadastro e acesso: nome, e-mail, telefone, nome e CNPJ do escritório, senha (guardada de forma protegida, nunca em texto aberto) e registros de acesso.',
      'Cobrança: plano, histórico de pagamentos e dados fiscais. Os dados de cartão ficam com o processador de pagamentos, não conosco.',
      'Dados inseridos pelo escritório e por seus clientes: razão social, CNPJ/CPF, lançamentos financeiros, nomes, cargos, jornadas e horários de colaboradores, dados de contratos de experiência e imagens de folhas de ponto.',
      'Dados técnicos: endereço IP, tipo de navegador e registros de erro, para segurança e diagnóstico.',
    ],
  },
  {
    titulo: 'Para que usamos (finalidades e bases legais)',
    itens: [
      'Prestar o serviço contratado — execução de contrato (art. 7º, V).',
      'Cobrar e emitir documentos fiscais — execução de contrato e cumprimento de obrigação legal (art. 7º, II e V).',
      'Garantir a segurança e prevenir fraudes — legítimo interesse (art. 7º, IX) e obrigação legal.',
      'Enviar avisos do serviço, como vencimentos e alterações — execução de contrato.',
      'Comunicações de novidades do produto — legítimo interesse ou consentimento, com opção de sair a qualquer momento.',
      'Quanto aos dados dos clientes do escritório, o ClickContas só os trata conforme as instruções do escritório; a base legal é definida por ele, como controlador.',
    ],
  },
  {
    titulo: 'Inteligência artificial e leitura de folhas',
    paragrafos: [
      'A Folha de Ponto usa um serviço de inteligência artificial de terceiros para ler a imagem enviada e extrair horários. A imagem é enviada somente para essa finalidade. Não usamos os dados e imagens dos clientes do escritório para treinar modelos próprios. [Confirmar com o fornecedor de IA as condições de retenção e treinamento antes do lançamento.]',
      'O resultado é uma sugestão e deve ser revisado pelo escritório antes do uso.',
    ],
  },
  {
    titulo: 'Compartilhamento e suboperadores',
    paragrafos: [
      'Não vendemos dados pessoais. Para operar o serviço, contratamos prestadores que tratam dados em nosso nome (suboperadores), como: hospedagem e banco de dados, processamento de pagamentos, envio de e-mails e leitura por inteligência artificial. A lista atual está em [endereço da lista de suboperadores] e será atualizada quando houver mudanças relevantes.',
      'Também podemos compartilhar dados quando a lei ou ordem de autoridade competente exigir.',
    ],
  },
  {
    titulo: 'Transferência internacional',
    paragrafos: [
      'Alguns prestadores podem armazenar ou processar dados fora do Brasil. Nesses casos adotamos as salvaguardas previstas na LGPD (art. 33), como cláusulas contratuais adequadas e fornecedores com nível de proteção compatível. [Informar países e fornecedores definitivos.]',
    ],
  },
  {
    titulo: 'Por quanto tempo guardamos',
    itens: [
      'Enquanto a assinatura estiver ativa: durante toda a vigência do contrato.',
      'Após cancelamento ou fim do teste sem contratação: os dados do escritório ficam disponíveis para exportação por [90] dias e depois são excluídos ou anonimizados.',
      'Dados fiscais e de cobrança: pelo prazo exigido pela legislação tributária e civil (em regra, cinco anos).',
      'Cópias de segurança: removidas em ciclo regular, até [30] dias após a exclusão.',
    ],
  },
  {
    titulo: 'Segurança',
    paragrafos: [
      'Usamos conexão criptografada (HTTPS), senhas protegidas, controle de acesso por papel, separação entre os dados de cada escritório e registros de acesso. Nenhum sistema é totalmente imune a falhas; em caso de incidente que possa causar risco ou dano relevante, comunicaremos o escritório (controlador) sem demora, para que ele possa cumprir os seus deveres de notificação, e a ANPD quando cabível.',
    ],
  },
  {
    titulo: 'Direitos dos titulares',
    paragrafos: [
      'A LGPD garante, entre outros, os direitos de confirmar o tratamento, acessar, corrigir, anonimizar, portar, eliminar dados e revogar consentimento (art. 18).',
    ],
    itens: [
      'Se você é titular de dados de um escritório ou de uma empresa-cliente dele, faça o pedido diretamente ao escritório, que é o controlador. Se enviar a nós, encaminharemos a ele e o apoiaremos tecnicamente para atender ao pedido.',
      'Se você é usuário ou responsável pelo escritório, escreva para [e-mail do encarregado/DPO]. Respondemos em até 15 dias.',
    ],
  },
  {
    titulo: 'Responsabilidades do escritório (controlador)',
    itens: [
      'Ter base legal para inserir dados de seus clientes e colaboradores deles na plataforma e informá-los de forma clara.',
      'Dar acesso apenas a quem precisa, e remover usuários que deixaram o escritório ou a empresa-cliente.',
      'Não inserir dados pessoais sensíveis ou além do necessário para a finalidade.',
      'Atender os pedidos dos titulares e comunicar incidentes à ANPD e aos afetados quando exigido.',
    ],
  },
  {
    titulo: 'Cookies',
    paragrafos: [
      'Usamos apenas cookies essenciais, como o cookie de sessão que mantém você conectado. Se passarmos a usar cookies de análise ou publicidade, pediremos o seu consentimento antes.',
      'Para manter o sistema rápido e estável, registramos uma medição técnica de desempenho: qual tela ou função foi usada, quanto tempo levou e se houve erro. Essa medição não guarda nome, e-mail, documento, empresa nem conteúdo do que você lançou, não usa cookies e é apagada depois de 30 dias.',
    ],
  },
  {
    titulo: 'Contato e alterações',
    paragrafos: [
      'Encarregado pelo tratamento de dados (DPO): [nome e e-mail]. Podemos atualizar esta Política; mudanças relevantes serão avisadas por e-mail ou pelo painel. Esta Política integra os Termos de uso.',
    ],
  },
];

export default function Privacidade() {
  return (
    <Documento
      titulo="Política de privacidade"
      atualizado="21 de novembro de 2026"
      intro="Cuidamos de dados de empresas e de pessoas. Aqui explicamos, em linguagem direta, quais dados tratamos, por quê, com quem os compartilhamos e como você exerce seus direitos."
      secoes={SECOES}
    />
  );
}
