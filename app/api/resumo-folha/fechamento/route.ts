// /api/resumo-folha/fechamento — fechar e reabrir o mês de ponto (Sprint 17, frente C).
//
//   GET  ?empresa=&ano=&mes=
//        → { fechamento, historico, aceite: { situacao, ultimo }, respostas, disponivel }
//   POST { empresa, ano, mes, acao: 'fechar', banco?, extra?, dom?, noturno? }
//        Fecha com a FOTO do resumo calculado no servidor (os mesmos ajustes da tela).
//        Recusa com pendência impeditiva. Fechado, as frequências do mês não mudam
//        (lib/pontoDb.ts → salvarFrequencia) e o cliente recebe o resumo para aceite.
//   POST { empresa, ano, mes, acao: 'reabrir', motivo }
//        Reabre; motivo obrigatório, registrado no histórico antes de reabrir.
//
// Só a contabilidade do escritório da empresa (exigirEmpresaPonto). O cliente nem
// chega aqui (proxy.ts, ROTAS_PONTO); ele responde em /api/envio-ponto/aceite.
import { NextRequest } from 'next/server';
import { exigirEmpresaPonto, respostaErroPonto } from '@/lib/pontoAcesso';
import { ErroBancoPendente } from '@/lib/pontoDb';
import { assinar } from '@/lib/resumoFolhaDb';
import { calcularResumo } from '@/lib/resumoFolhaServidor';
import {
  aceitesDoMes, ErroFechamento, fecharMesPonto, historicoPonto, lerFechamento, reabrirMesPonto,
} from '@/lib/fechamentoPontoServidor';
import { ERRO_MOTIVO, fotoDoResumo, impedimentoParaFechar, motivoReabertura, situacaoAceite } from '@/lib/mesFechado';

export const runtime = 'nodejs';
export const maxDuration = 60;

const periodo = (ano: number, mes: number) =>
  Number.isInteger(ano) && ano >= 2000 && ano <= 2100 && Number.isInteger(mes) && mes >= 1 && mes <= 12;

function falha(e: unknown, padrao: string): Response {
  if (e instanceof ErroFechamento) return Response.json({ erro: e.message }, { status: e.status });
  if (e instanceof ErroBancoPendente) {
    return Response.json({ erro: 'O fechamento do mês depende de uma atualização do banco (migração 0034).', aguardandoBanco: true }, { status: 503 });
  }
  return respostaErroPonto(e, padrao);
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const g = await exigirEmpresaPonto(req, p.get('empresa'));
  if (!g.ok) return g.resposta;
  const ano = Number(p.get('ano'));
  const mes = Number(p.get('mes'));
  if (!periodo(ano, mes)) return Response.json({ erro: 'Mês/ano inválidos.' }, { status: 400 });
  try {
    const [fechamento, historico, respostas] = await Promise.all([
      lerFechamento(g.escritorioId, g.empresa.id, ano, mes),
      historicoPonto(g.escritorioId, g.empresa.id, ano, mes),
      aceitesDoMes(g.escritorioId, g.empresa.id, ano, mes),
    ]);
    const aceite = fechamento ? situacaoAceite(fechamento.assinatura, respostas) : null;
    return Response.json({ fechamento, historico, aceite, respostas });
  } catch (e) {
    return falha(e, 'Não foi possível ler o fechamento do mês.');
  }
}

export async function POST(req: NextRequest) {
  let corpo: Record<string, unknown>;
  try { corpo = await req.json(); } catch { return Response.json({ erro: 'JSON inválido.' }, { status: 400 }); }
  const g = await exigirEmpresaPonto(req, corpo.empresa as string | undefined);
  if (!g.ok) return g.resposta;
  const ano = Number(corpo.ano);
  const mes = Number(corpo.mes);
  if (!periodo(ano, mes)) return Response.json({ erro: 'Mês/ano inválidos.' }, { status: 400 });
  const base = { escritorioId: g.escritorioId, empresaId: g.empresa.id, ano, mes, por: g.sessao.email };

  try {
    if (corpo.acao === 'reabrir') {
      const motivo = motivoReabertura(corpo.motivo);
      if (!motivo) return Response.json({ erro: ERRO_MOTIVO }, { status: 400 });
      await reabrirMesPonto({ ...base, motivo });
      return Response.json({ ok: true, fechamento: null });
    }
    if (corpo.acao !== 'fechar') return Response.json({ erro: 'Ação inválida.' }, { status: 400 });

    // A foto sai do cálculo do servidor, com os mesmos ajustes que a tela estava vendo.
    const q = new URLSearchParams();
    for (const b of Array.isArray(corpo.banco) ? corpo.banco : []) q.append('banco', String(b));
    for (const k of ['extra', 'dom', 'noturno']) if (corpo[k] !== undefined && corpo[k] !== null) q.set(k, String(corpo[k]));
    const resumo = await calcularResumo(g, ano, mes, q);
    const impede = impedimentoParaFechar(resumo);
    if (impede) return Response.json({ erro: impede }, { status: 409 });
    const foto = fotoDoResumo(resumo);
    const fechamento = await fecharMesPonto({ ...base, assinatura: assinar(JSON.stringify(foto)), resumo: foto });
    return Response.json({ ok: true, fechamento });
  } catch (e) {
    return falha(e, 'Não foi possível concluir o fechamento do mês.');
  }
}
