// /api/pendencias — o contador pede algo a uma empresa; o cliente vê e atende
// (enviando um documento vinculado, em /api/documentos).
//
// Ler: cliente (só a própria empresa) e contabilidade. Criar, editar, fechar,
// reabrir e excluir: só a contabilidade do escritório (podeGerirPendencia).
import { NextRequest } from 'next/server';
import { exigirSessao, respostaNegadaEmpresa } from '@/lib/acesso';
import { Sessao } from '@/lib/auth';
import { hojeBelem } from '@/lib/contratos';
import {
  categoriaValida, competenciaValida, dataValida, MAX_OBS_SEM_MOVIMENTO, podeDesfazerSemMovimento, podeGerirPendencia,
  podeMarcarSemMovimento, podeVerRegistro, resumoPendencias,
} from '@/lib/documentos';
import {
  CamposPendencia, criarPendencia, desfazerSemMovimento, editarPendencia, ErroDoc, excluirPendencia, lerPendencia,
  listarPendencias, marcarSemMovimento, mudarStatusPendencia, pendenciaPublica,
} from '@/lib/documentosServidor';
import {
  escopoLeitura, escritorioDaEmpresa, falha, guardaEmpresa, naoEncontrado, negado, textoOpcional,
} from '../documentos/comum';

export const runtime = 'nodejs';

const ehGestor = (s: Sessao) => s.role === 'master' || s.role === 'usuario';

/* eslint-disable @typescript-eslint/no-explicit-any -- corpo JSON livre, validado aqui */
function campos(b: any): CamposPendencia {
  const titulo = textoOpcional(b.titulo, 200);
  if (!titulo) throw new ErroDoc('Diga o que a empresa precisa enviar.');
  const categoria = b.categoria ? String(b.categoria) : null;
  if (categoria && !categoriaValida(categoria)) throw new ErroDoc('Categoria inválida.');
  const competencia = b.competencia ? String(b.competencia) : null;
  if (competencia && !competenciaValida(competencia)) throw new ErroDoc('Competência inválida.');
  const prazo = b.prazo ? String(b.prazo) : null;
  if (prazo && !dataValida(prazo)) throw new ErroDoc('Prazo inválido.');
  return { titulo, descricao: textoOpcional(b.descricao, 2000), categoria: categoria as CamposPendencia['categoria'], competencia, prazo };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function GET(req: NextRequest) {
  const g = await guardaEmpresa(req, req.nextUrl.searchParams.get('empresa'));
  if (!g.ok) return g.resposta;
  try {
    const pendencias = await listarPendencias(escopoLeitura(g.sessao, g.empresaId!));
    const gestor = ehGestor(g.sessao);
    return Response.json({
      pendencias: pendencias.map((x) => pendenciaPublica(x, gestor)),
      resumo: resumoPendencias(pendencias, hojeBelem()),
    });
  } catch (e) { return falha(e); }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const g = await guardaEmpresa(req, body.empresa);
    if (!g.ok) return g.resposta;
    if (!ehGestor(g.sessao)) return negado();
    const empresaId = g.empresaId!;
    const escritorioId = await escritorioDaEmpresa(empresaId);
    const pendencia = await criarPendencia({ empresaId, escritorioId }, campos(body), g.sessao.email);
    return Response.json({ pendencia });
  } catch (e) { return falha(e); }
}

/**
 * `acao`: editar · fechar · reabrir · restaurar (desfazer exclusão) — só a contabilidade.
 * `nao-tenho` (com `observacao` opcional) e `desfazer-nao-tenho` (0032): também o
 * cliente da empresa, no pedido dele.
 */
export async function PATCH(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json().catch(() => ({}));
    const p = await lerPendencia(String(body.id ?? ''));
    if (!p || (p.excluidoEm && body.acao !== 'restaurar') || !podeVerRegistro(g.sessao, p)) return naoEncontrado('Pendência');
    const s = g.sessao;
    if (body.acao === 'nao-tenho' || body.acao === 'desfazer-nao-tenho') {
      // Empresa primeiro (arquivada: contabilidade 409, cliente 403), depois o estado do pedido.
      { const r = await respostaNegadaEmpresa(s, p.empresaId); if (r) return r; }
      const pode = body.acao === 'nao-tenho' ? podeMarcarSemMovimento(s, p) : podeDesfazerSemMovimento(s, p);
      // Quem vê o pedido, mas ele já não está no estado certo (outra aba, o arquivo chegou antes): 409.
      if (!pode) return Response.json({ erro: 'Este pedido mudou enquanto você olhava. Recarregue a lista.' }, { status: 409 });
      const pendencia = body.acao === 'nao-tenho'
        ? await marcarSemMovimento(p.id, s.email, textoOpcional(body.observacao, MAX_OBS_SEM_MOVIMENTO))
        : await desfazerSemMovimento(p.id);
      return Response.json({ pendencia: pendenciaPublica(pendencia, ehGestor(s)) });
    }
    if (!podeGerirPendencia(s, p)) return negado();
    { const r = await respostaNegadaEmpresa(s, p.empresaId); if (r) return r; }
    switch (body.acao) {
      case 'editar': return Response.json({ pendencia: await editarPendencia(p.id, campos(body)) });
      case 'fechar': return Response.json({ pendencia: await mudarStatusPendencia(p.id, 'atendida', s.email) });
      case 'reabrir': return Response.json({ pendencia: await mudarStatusPendencia(p.id, 'aberta', s.email) });
      case 'restaurar': await excluirPendencia(p.id, true); return Response.json({ ok: true });
      default: throw new ErroDoc('Ação inválida.');
    }
  } catch (e) { return falha(e); }
}

export async function DELETE(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;
  try {
    const p = await lerPendencia(req.nextUrl.searchParams.get('id') ?? '');
    if (!p || p.excluidoEm || !podeVerRegistro(g.sessao, p)) return naoEncontrado('Pendência');
    if (!podeGerirPendencia(g.sessao, p)) return negado();
    { const r = await respostaNegadaEmpresa(g.sessao, p.empresaId); if (r) return r; }
    await excluirPendencia(p.id);
    return Response.json({ ok: true });
  } catch (e) { return falha(e); }
}
