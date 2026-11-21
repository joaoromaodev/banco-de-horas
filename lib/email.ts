// Envio de e-mail — abstrai o provedor. Só de servidor.
//
// Provedor escolhido pela variável de ambiente:
// - `RESEND_API_KEY` presente → Resend (API HTTP, sem SDK: um fetch só).
// - ausente → NÃO envia: registra no log do servidor e devolve `registrado`.
//   Assim o cron roda em dev/preview sem mandar e-mail de verdade.
//
// Remetente: `EMAIL_REMETENTE` (ex.: "ClickContas <avisos@clickcontas.com.br>");
// o domínio precisa estar verificado no Resend. Sem ele, usa o remetente de
// teste do Resend, que só entrega para o e-mail dono da conta.
//
// Para trocar de provedor, implemente outro ramo em `enviarEmail` — quem chama
// não muda.

export interface Email {
  para: string[];
  assunto: string;
  html: string;
  texto: string;
}

export type ResultadoEnvio =
  | { situacao: 'enviado'; id?: string }
  | { situacao: 'registrado' }
  | { situacao: 'falhou'; erro: string };

const REMETENTE_TESTE = 'ClickContas <onboarding@resend.dev>';

export function provedorEmail(): 'resend' | 'nenhum' {
  return process.env.RESEND_API_KEY?.trim() ? 'resend' : 'nenhum';
}

export async function enviarEmail(e: Email): Promise<ResultadoEnvio> {
  const para = [...new Set(e.para.map((p) => p.trim().toLowerCase()).filter(Boolean))];
  if (!para.length) return { situacao: 'falhou', erro: 'Sem destinatários.' };

  const chave = process.env.RESEND_API_KEY?.trim();
  if (!chave) {
    // Sem provedor: só o registro (sem o corpo, que pode ter nome de cliente).
    console.info(`[email] sem RESEND_API_KEY — não enviado: "${e.assunto}" para ${para.length} destinatário(s).`);
    return { situacao: 'registrado' };
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.EMAIL_REMETENTE?.trim() || REMETENTE_TESTE,
        to: para,
        subject: e.assunto,
        html: e.html,
        text: e.texto,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const corpo = await r.json().catch(() => ({}));
    if (!r.ok) return { situacao: 'falhou', erro: String(corpo?.message ?? `HTTP ${r.status}`).slice(0, 300) };
    return { situacao: 'enviado', id: corpo?.id };
  } catch (err) {
    return { situacao: 'falhou', erro: err instanceof Error ? err.message : 'Falha no envio.' };
  }
}
