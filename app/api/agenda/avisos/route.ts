// /api/agenda/avisos — preferência do resumo por e-mail do escritório.
// Qualquer contador do escritório lê; só o administrador do escritório altera.
// Destinatários só podem ser da equipe do escritório (o sistema não manda e-mail
// para endereço de fora).
import { NextRequest } from 'next/server';
import { exigirGestor } from '@/lib/acesso';
import { Frequencia, FREQUENCIAS } from '@/lib/agenda';
import { provedorEmail } from '@/lib/email';
import { destinatariosDoAviso, equipeDoEscritorio, ErroAgenda, lerAviso, salvarAviso } from '@/lib/agendaServidor';
import { falha } from '../comum';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  const escritorio = g.sessao.escritorioId;
  if (!escritorio) return Response.json({ erro: 'O aviso é configurado por escritório.' }, { status: 400 });
  try {
    const [aviso, equipe] = await Promise.all([lerAviso(escritorio), equipeDoEscritorio(escritorio)]);
    return Response.json({
      aviso, equipe, efetivos: destinatariosDoAviso(aviso, equipe),
      podeEditar: Boolean(g.sessao.adminEscritorio), provedor: provedorEmail(),
    });
  } catch (e) { return falha(e); }
}

export async function PUT(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  const escritorio = g.sessao.escritorioId;
  if (!escritorio) return Response.json({ erro: 'O aviso é configurado por escritório.' }, { status: 400 });
  if (!g.sessao.adminEscritorio) return Response.json({ erro: 'Só o administrador do escritório altera o aviso.' }, { status: 403 });
  try {
    const body = await req.json();
    const frequencia = String(body.frequencia ?? '') as Frequencia;
    if (!FREQUENCIAS.includes(frequencia)) throw new ErroAgenda('Frequência inválida.');
    const equipe = await equipeDoEscritorio(escritorio);
    const daEquipe = new Set(equipe.map((u) => u.email));
    const pedidos: string[] = (Array.isArray(body.destinatarios) ? body.destinatarios : []).map((d: unknown) => String(d).trim().toLowerCase());
    const fora = pedidos.filter((d) => !daEquipe.has(d));
    if (fora.length) throw new ErroAgenda('Os destinatários precisam ser da equipe do escritório.');
    const aviso = { frequencia, destinatarios: [...new Set(pedidos)] };
    await salvarAviso(escritorio, aviso, g.sessao.email);
    return Response.json({ aviso, efetivos: destinatariosDoAviso(aviso, equipe) });
  } catch (e) { return falha(e); }
}
