// "O que está desligado" — a situação das variáveis de ambiente da plataforma, para
// o master (Sprint 14, frente A). Só de servidor; testada em tests/ambienteMaster.test.ts.
//
// NUNCA devolve valor de variável: só se está configurada e o que ela destrava. A
// decisão de cada item reusa a regra de quem usa a variável (senha do master, IA —
// lib/ia/config —, e-mail ao cliente), para o painel nunca dizer "ligado" quando a função
// está, na prática, desligada.
import { senhaMasterAceitavel } from './config';
import { iaDocumentoNaPlataforma } from './documentoLancamento';
import { cloudflareConfigurada, cotaDiariaCloudflare, descricaoProvedor, iaConfigurada } from './ia/config';

export type SituacaoItem = 'ligado' | 'parcial' | 'desligado';

export interface ItemAmbiente {
  id: string;
  /** Nomes das variáveis envolvidas (o master procura por elas na Vercel). */
  variaveis: string[];
  titulo: string;
  situacao: SituacaoItem;
  /** O que fica funcionando quando está ligado. */
  destrava: string;
  /** Em linguagem simples, o que acontece agora (sem valor de variável). */
  agora: string;
}

const tem = (v: string | undefined) => Boolean(v?.trim());
const igual = (v: string | undefined, esperado: string) => String(v ?? '').trim().toLowerCase() === esperado;

export function situacaoDoAmbiente(env: NodeJS.ProcessEnv = process.env): ItemAmbiente[] {
  const temEmail = tem(env.RESEND_API_KEY);
  const temRemetente = tem(env.EMAIL_REMETENTE);
  const ia = descricaoProvedor(env);
  const temIa = ia.configurado;
  const temIaSugestao = iaConfigurada('sugestao', env);
  const faltaIa = ia.provedor === 'cloudflare'
    ? 'falta configurar a Cloudflare (CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_AI_TOKEN)'
    : 'falta uma chave do Gemini';
  const appUrl = String(env.APP_URL ?? '').trim();
  const temAppUrl = /^https?:\/\/[^/\s]+/.test(appUrl);

  const itens: ItemAmbiente[] = [
    {
      id: 'cron', variaveis: ['CRON_SECRET'], titulo: 'Rotina diária (cron)',
      situacao: tem(env.CRON_SECRET) ? 'ligado' : 'desligado',
      destrava: 'O resumo diário da agenda por e-mail, a abertura dos pedidos mensais logo no dia 1º e a faxina diária das fotos do ponto (LGPD).',
      agora: tem(env.CRON_SECRET)
        ? 'A rotina diária roda.'
        : 'A rotina diária recusa as chamadas. Os pedidos mensais ainda abrem na primeira visita do mês ao painel ou ao início, e as fotos antigas são apagadas aos poucos nas visitas ao painel, mas o resumo da agenda por e-mail não sai.',
    },
    {
      id: 'email', variaveis: ['RESEND_API_KEY', 'EMAIL_REMETENTE'], titulo: 'Envio de e-mail',
      situacao: temEmail ? (temRemetente ? 'ligado' : 'parcial') : 'desligado',
      destrava: 'O resumo da agenda, o envio do Demonstrativo de caixa ao cliente e os demais e-mails da plataforma.',
      agora: !temEmail
        ? 'Nenhum e-mail sai: o sistema só registra no log o que teria enviado.'
        : temRemetente
          ? 'Os e-mails saem pelo remetente configurado.'
          : 'Falta o remetente: os e-mails saem pelo remetente de teste do provedor, que só entrega na caixa do dono da conta.',
    },
    {
      id: 'master', variaveis: ['MASTER_PASSWORD'], titulo: 'Senha forte do administrador',
      situacao: senhaMasterAceitavel(env.MASTER_PASSWORD, true) ? 'ligado' : 'desligado',
      destrava: 'A entrada do administrador da plataforma no ambiente publicado.',
      agora: senhaMasterAceitavel(env.MASTER_PASSWORD, true)
        ? 'A senha atende ao mínimo (12 caracteres, fora da lista de senhas comuns).'
        : 'Sem senha forte, ninguém entra como administrador no ambiente publicado.',
    },
    {
      id: 'ia', variaveis: ['IA_PROVEDOR', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_AI_TOKEN', 'GEMINI_API_KEY'],
      titulo: `Leitura por IA (${ia.nome})`,
      situacao: temIa ? 'ligado' : 'desligado',
      destrava: 'A leitura das folhas de ponto por foto (inclusive as enviadas pelo cliente) e é a base das funções de IA do caixa.',
      agora: !temIa
        ? `Nenhuma leitura por IA funciona (${faltaIa}): as folhas precisam ser digitadas.`
        : ia.provedor === 'cloudflare'
          ? `Ativa: ${ia.nome}, modelo ${ia.modelo}. Cota gratuita de ${cotaDiariaCloudflare(env).toLocaleString('pt-BR')} neurônios por dia (renova às 21h de Brasília); o uso de hoje aparece em "Leitura por IA", mais abaixo.`
          : `Ativa: ${ia.nome}, modelo ${ia.modelo}.${cloudflareConfigurada(env) ? '' : ' No nível gratuito o Google pode usar o conteúdo enviado — configure a Cloudflare para trocar.'}`,
    },
    {
      id: 'caixa_documento', variaveis: ['CAIXA_IA_DOCUMENTO', 'GEMINI_API_KEY_CAIXA'], titulo: 'IA: lançamento a partir de documento',
      situacao: iaDocumentoNaPlataforma(env) ? 'ligado' : 'desligado',
      destrava: 'No Livro Caixa, ler uma nota ou recibo e já sugerir o lançamento (ainda depende de cada escritório ligar).',
      agora: iaDocumentoNaPlataforma(env)
        ? 'Ligada na plataforma.'
        : igual(env.CAIXA_IA_DOCUMENTO, 'ligada')
          ? `A trava está ligada, mas ${faltaIa}.`
          : 'Desligada na plataforma (a trava precisa valer "ligada").',
    },
    {
      id: 'caixa_sugestao', variaveis: ['CAIXA_IA_SUGESTAO'], titulo: 'IA: sugestão de conta no caixa',
      situacao: igual(env.CAIXA_IA_SUGESTAO, 'ligada') && temIaSugestao ? 'ligado' : 'desligado',
      destrava: 'A sugestão de conta por IA ao lançar no Livro Caixa (nunca para empresa de saúde). Sem ela, a sugestão usa só o histórico.',
      agora: igual(env.CAIXA_IA_SUGESTAO, 'ligada')
        ? temIaSugestao ? 'Ligada.' : `A trava está ligada, mas ${faltaIa}.`
        : 'Desligada (a trava precisa valer "ligada"): a sugestão usa só o histórico da empresa.',
    },
    {
      id: 'avisos_email', variaveis: ['AVISOS_CLIENTE_EMAIL', 'APP_URL'], titulo: 'E-mail dos avisos ao cliente',
      situacao: igual(env.AVISOS_CLIENTE_EMAIL, 'ligado') && temEmail && temAppUrl ? 'ligado' : 'desligado',
      destrava: 'Avisar o cliente por e-mail quando há aviso novo no sino (folha devolvida, pedido novo). O envio está pronto, mas ainda não é chamado por nenhuma tela ou rotina.',
      agora: !igual(env.AVISOS_CLIENTE_EMAIL, 'ligado')
        ? 'Desligado (a trava precisa valer "ligado"): o cliente vê os avisos só no sino.'
        : !temEmail
          ? 'A trava está ligada, mas o envio de e-mail não está configurado.'
          : !temAppUrl
            ? 'A trava está ligada, mas falta o endereço público do sistema (APP_URL).'
            : 'Ligado.',
    },
  ];
  return itens;
}

export function resumoDoAmbiente(itens: ItemAmbiente[]): { desligados: number; parciais: number } {
  return {
    desligados: itens.filter((i) => i.situacao === 'desligado').length,
    parciais: itens.filter((i) => i.situacao === 'parcial').length,
  };
}
