// POST /api/caixa/demonstrativo/enviar — a contadora manda o demonstrativo ao cliente.
//
// Corpo: { empresa, ano, mes, reenviar? }. Só gestor. Vai por e-mail para os logins
// `cliente` da empresa (lib/email.ts: sem RESEND_API_KEY só registra no log). O envio
// fica registrado em `demonstrativos_enviados` (0023): o mesmo mês não sai duas vezes
// sem `reenviar: true`. Não existe cron: é a contadora quem dispara, da prévia.
import { NextRequest } from 'next/server';
import { ehGestor, exigirEmpresa } from '@/lib/acesso';
import { hojeBelem } from '@/lib/agenda';
import { lerEmpresa } from '@/lib/cadastro';
import { emailDoDemonstrativo } from '@/lib/demonstrativo';
import {
  concluirEnvio, emailsDoCliente, lerDemonstrativo, nomeDoEscritorio, reservarEnvio,
} from '@/lib/demonstrativoServidor';
import { enviarEmail } from '@/lib/email';

export const runtime = 'nodejs';

const tabelaAusente = (e: unknown) => ['42P01', 'PGRST205'].includes((e as { code?: string })?.code ?? '');

export async function POST(req: NextRequest) {
  let corpo: { empresa?: unknown; ano?: unknown; mes?: unknown; reenviar?: unknown } = {};
  try { corpo = await req.json(); } catch { /* cai na validação */ }
  const empresa = String(corpo.empresa ?? '');
  const g = await exigirEmpresa(req, empresa);
  if (!g.ok) return g.resposta;
  if (!ehGestor(g.sessao)) return Response.json({ erro: 'Acesso restrito.' }, { status: 403 });

  const ano = Number(corpo.ano);
  const mes = Number(corpo.mes);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) return Response.json({ erro: 'Ano inválido.' }, { status: 400 });
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return Response.json({ erro: 'Mês inválido.' }, { status: 400 });
  const reenviar = corpo.reenviar === true;

  try {
    const emp = await lerEmpresa(empresa);
    if (!emp?.escritorioId) return Response.json({ erro: 'A empresa não pertence a um escritório.' }, { status: 409 });

    const r = await lerDemonstrativo(empresa, ano, mes, hojeBelem());
    if (r.situacao !== 'ok') {
      return Response.json({ erro: 'Confirme este mês (e os anteriores) no Livro Caixa antes de enviar.', codigo: 'nao_liberado' }, { status: 409 });
    }
    const para = await emailsDoCliente(empresa);
    if (!para.length) {
      return Response.json({ erro: 'Esta empresa não tem login de cliente com e-mail. Cadastre em Equipe → clientes.', codigo: 'sem_destinatario' }, { status: 409 });
    }

    let reservado: boolean;
    try {
      reservado = await reservarEnvio({ empresaId: empresa, escritorioId: emp.escritorioId, ano, mes, por: g.sessao.email }, reenviar);
    } catch (e) {
      if (tabelaAusente(e)) return Response.json({ erro: 'Falta aplicar a migração 0023 do banco.', codigo: 'migracao' }, { status: 503 });
      throw e;
    }
    if (!reservado) {
      return Response.json({ erro: 'Este demonstrativo já foi enviado. Use "Reenviar" se quiser mandar de novo.', codigo: 'ja_enviado' }, { status: 409 });
    }

    const escritorio = await nomeDoEscritorio(emp.escritorioId);
    const origem = process.env.APP_URL?.trim() || req.nextUrl.origin;
    const email = emailDoDemonstrativo(r.demonstrativo, {
      empresa: emp.nome, escritorio, url: `${origem}/caixa/demonstrativo?ano=${ano}&mes=${mes}`,
    });
    const envio = await enviarEmail({ para, ...email });
    const situacao = envio.situacao === 'enviado' ? 'enviado' : envio.situacao === 'registrado' ? 'registrado' : 'falhou';
    await concluirEnvio(empresa, ano, mes, {
      situacao, destinatarios: para.length, erro: envio.situacao === 'falhou' ? envio.erro : undefined,
    });
    if (envio.situacao === 'falhou') return Response.json({ erro: `O e-mail não saiu: ${envio.erro}`, codigo: 'falhou' }, { status: 502 });
    return Response.json({ situacao, destinatarios: para.length });
  } catch (e) {
    console.error('[caixa/demonstrativo/enviar]', e instanceof Error ? e.message : e);
    return Response.json({ erro: 'Não foi possível enviar agora.' }, { status: 502 });
  }
}
