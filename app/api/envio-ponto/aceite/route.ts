// /api/envio-ponto/aceite — aceite do cliente no resumo do ponto (Sprint 17, frente C).
//
//   GET                                   → meses fechados dos últimos 13 meses, com a
//                                           foto do resumo e a situação do aceite
//   POST { ano, mes, assinatura, resposta: 'aceito' | 'duvida', duvida? }
//                                         → registra a resposta (usuário, data e hora)
//
// Só o `cliente`, e só a empresa DA SESSÃO (exigirClienteDaEmpresa: empresa e
// escritório vêm do cookie, nunca do corpo; empresa arquivada → 403). A foto do
// resumo tem só o que vai para a folha: nome do funcionário, dias e horas — nada de
// R$, CPF ou detalhe por dia. A contabilidade vê as respostas em
// /api/resumo-folha/fechamento. `/api/envio-ponto` já está em CLIENTE_PODE.
import { NextRequest } from 'next/server';
import { exigirClienteDaEmpresa } from '@/lib/acesso';
import { hojeBelem } from '@/lib/agenda';
import { desdeTrezeMeses } from '@/lib/avisosCliente';
import { ErroBancoPendente } from '@/lib/pontoDb';
import { ErroFechamento, fechamentosParaCliente, registrarAceite } from '@/lib/fechamentoPontoServidor';
import { avisoRespostaAceite, textoDuvida } from '@/lib/mesFechado';
import { registrarNotificacao } from '@/lib/notificacoesServidor';

export const runtime = 'nodejs';
const SEM_CACHE = { 'Cache-Control': 'no-store' };

function falha(e: unknown): Response {
  if (e instanceof ErroFechamento) return Response.json({ erro: e.message }, { status: e.status });
  if (e instanceof ErroBancoPendente) {
    return Response.json({ erro: 'O aceite do resumo ainda depende de uma atualização do sistema.', aguardandoBanco: true }, { status: 503 });
  }
  console.error('[aceite-ponto]', e instanceof Error ? e.message.slice(0, 120) : 'falha');
  return Response.json({ erro: 'Não foi possível concluir agora. Tente de novo.' }, { status: 502 });
}

export async function GET(req: NextRequest) {
  const g = await exigirClienteDaEmpresa(req);
  if (!g.ok) return g.resposta;
  try {
    const meses = await fechamentosParaCliente(g.sessao.escritorioId!, g.empresaId!, desdeTrezeMeses(hojeBelem()));
    return Response.json({ meses }, { headers: SEM_CACHE });
  } catch (e) {
    return falha(e);
  }
}

export async function POST(req: NextRequest) {
  const g = await exigirClienteDaEmpresa(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json().catch(() => ({}));
    const ano = Number(body.ano);
    const mes = Number(body.mes);
    if (!Number.isInteger(ano) || ano < 2000 || ano > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
      return Response.json({ erro: 'Mês inválido.' }, { status: 400 });
    }
    const assinatura = String(body.assinatura ?? '').trim();
    if (!assinatura || assinatura.length > 100) return Response.json({ erro: 'Atualize a página e tente de novo.' }, { status: 400 });
    const resposta = body.resposta === 'aceito' ? 'aceito' : body.resposta === 'duvida' ? 'duvida' : null;
    if (!resposta) return Response.json({ erro: 'Resposta inválida.' }, { status: 400 });
    const duvida = resposta === 'duvida' ? textoDuvida(body.duvida) : null;
    if (resposta === 'duvida' && !duvida) {
      return Response.json({ erro: 'Escreva a sua dúvida para a contabilidade (pelo menos 3 letras).', campo: 'duvida' }, { status: 400 });
    }
    const r = await registrarAceite({
      escritorioId: g.sessao.escritorioId!, empresaId: g.empresaId!, ano, mes, por: g.sessao.email, assinatura, resposta, duvida,
    });
    // Sino da contabilidade (Sprint 18 · A): só empresa e mês; a dúvida fica no fechamento.
    // `registrarNotificacao` nunca lança — avisar não derruba o aceite já gravado.
    await registrarNotificacao({
      escritorioId: g.sessao.escritorioId!, empresaId: g.empresaId!,
      ...avisoRespostaAceite({ empresaId: g.empresaId!, ano, mes, resposta: r.resposta, em: r.em }),
    });
    return Response.json({ ok: true, resposta: r });
  } catch (e) {
    return falha(e);
  }
}
