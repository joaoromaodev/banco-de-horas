// Gancho do e-mail ao cliente para os avisos do sino (Sprint 13 · Frente A).
//
// NÃO está ligado em nenhuma rota de propósito (ver "Gancho do e-mail ao cliente" em
// docs/notificacoes.md): devolver folha e confirmar mês têm "desfazer", e um e-mail
// enviado na hora não volta atrás. Quem ligar decide onde (de preferência um resumo
// diário no cron, com os avisos ainda não lidos de lib/avisosClienteServidor.ts).
//
// Travas — sem qualquer uma delas, NÃO envia nada e nem chama o provedor ou o banco:
//   1. `RESEND_API_KEY` configurada (lib/email.ts → provedorEmail);
//   2. `AVISOS_CLIENTE_EMAIL=ligado` (a chave já existe em produção por causa do
//      Demonstrativo; a segunda trava evita que este gancho comece a mandar e-mail
//      sozinho no dia em que alguém o chamar);
//   3. `APP_URL` configurada — o link nunca é montado com o `Host` da requisição.
//
// O corpo é um RESUMO NEUTRO ("Você tem N avisos…"): nem o motivo da devolução nem o
// título do pedido saem do app (são texto livre da contadora e podem trazer nome de
// funcionário). A pessoa entra com o login dela e lê no sino. (Revisão do Escudo, 21/11/2026.)
import { getDb } from './db';
import { enviarEmail, provedorEmail, type ResultadoEnvio } from './email';

export type MotivoDesligado = 'sem_chave' | 'trava' | 'sem_app_url';
export type ResultadoAvisoEmail = ResultadoEnvio | { situacao: 'desligado'; motivo: MotivoDesligado } | { situacao: 'sem_destinatario' };

export function emailDeAvisosLigado(): { ligado: true; base: string } | { ligado: false; motivo: MotivoDesligado } {
  if (provedorEmail() === 'nenhum') return { ligado: false, motivo: 'sem_chave' };
  if (process.env.AVISOS_CLIENTE_EMAIL?.trim().toLowerCase() !== 'ligado') return { ligado: false, motivo: 'trava' };
  const base = process.env.APP_URL?.trim();
  if (!base || !/^https?:\/\/[^/\s]+/.test(base)) return { ligado: false, motivo: 'sem_app_url' };
  return { ligado: true, base: base.replace(/\/+$/, '') };
}

/** Corpo do e-mail (puro; testado): só a contagem e o link para o início do cliente. */
export function montarEmailAviso(quantos: number, base: string) {
  const link = `${base.replace(/\/+$/, '')}/inicio`;
  const assunto = quantos === 1 ? 'Você tem 1 aviso no ClickContas' : `Você tem ${quantos} avisos no ClickContas`;
  const linha = 'A contabilidade deixou avisos para a sua empresa. Entre no ClickContas e confira no sino.';
  const texto = `${assunto}\n\n${linha}\n\n${link}`;
  const html = `<p><strong>${assunto}</strong></p><p>${linha}</p><p><a href="${link.replace(/"/g, '&quot;')}">Abrir o ClickContas</a></p>`;
  return { assunto, texto, html };
}

/** Logins `cliente` da empresa, NO escritório dela (defesa em profundidade). */
async function emailsDoClienteNoEscritorio(escritorioId: string, empresaId: string): Promise<string[]> {
  const { data, error } = await getDb().from('usuarios').select('email')
    .eq('role', 'cliente').eq('empresa', empresaId).eq('escritorio_id', escritorioId);
  if (error) throw new Error(`usuarios: ${error.message}`);
  return [...new Set((data ?? []).map((u) => String(u.email).trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
}

/**
 * Avisa os logins `cliente` da empresa de que há `quantos` avisos não lidos. Nunca lança.
 * Sem as três travas devolve `desligado` sem tocar no provedor nem no banco.
 * `escritorioId`/`empresaId` vêm do cadastro (cron) ou da sessão já autorizada, nunca do navegador.
 */
export async function avisarClientePorEmail(escritorioId: string, empresaId: string, quantos: number): Promise<ResultadoAvisoEmail> {
  const l = emailDeAvisosLigado();
  if (!l.ligado) return { situacao: 'desligado', motivo: l.motivo };
  if (!(quantos > 0)) return { situacao: 'sem_destinatario' };
  try {
    const para = await emailsDoClienteNoEscritorio(escritorioId, empresaId);
    if (!para.length) return { situacao: 'sem_destinatario' };
    return await enviarEmail({ para, ...montarEmailAviso(Math.floor(quantos), l.base) });
  } catch (e) {
    return { situacao: 'falhou', erro: e instanceof Error ? e.message.slice(0, 120) : 'falha' };
  }
}
