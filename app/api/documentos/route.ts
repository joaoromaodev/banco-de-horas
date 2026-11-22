// /api/documentos — documentos que a empresa-cliente envia ao escritório.
//
// Acesso: `cliente` (só a própria empresa — está em CLIENTE_PODE no proxy) e
// contabilidade (empresas do escritório). Toda decisão passa por lib/acesso.ts
// (empresa) + lib/documentos.ts (registro carregado, com o escritório gravado
// nele). Ver docs/documentos.md.
//
// Envio em dois passos, para o arquivo não passar pela função serverless:
//   POST  → valida o que o navegador declara, grava `enviando` e devolve uma URL
//           de upload assinada para um caminho escolhido no servidor;
//   PATCH { acao: 'confirmar' } → o servidor baixa o objeto, confere tamanho e
//           assinatura dos bytes e só então o documento aparece como `recebido`.
import { NextRequest } from 'next/server';
import { ehGestor, exigirSessao, respostaNegadaEmpresa } from '@/lib/acesso';
import {
  categoriaValida, competenciaValida, motivoDevolucao, podeAtenderPendencia, podeExcluirDocumento, podeMudarSituacao,
  podeRestaurarDocumento, podeVerRegistro, validarArquivo,
} from '@/lib/documentos';
import {
  confirmarEnvio, enviosRecentes, ErroDoc, excluirDocumento, iniciarEnvio, lerDocumento,
  lerPendencia, listarDocumentos, mudarSituacao, publico, restaurarDocumento,
} from '@/lib/documentosServidor';
import { escopoLeitura, escritorioDaEmpresa, falha, guardaEmpresa, naoEncontrado, negado, textoOpcional } from './comum';

export const runtime = 'nodejs';

/** Envios por empresa por hora (inclui os que não terminaram). */
const MAX_ENVIOS_HORA = 60;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const g = await guardaEmpresa(req, p.get('empresa'));
  if (!g.ok) return g.resposta;
  try {
    const competencia = p.get('competencia') || undefined;
    if (competencia && !competenciaValida(competencia)) throw new ErroDoc('Competência inválida.');
    const docs = await listarDocumentos(escopoLeitura(g.sessao, g.empresaId!), competencia);
    return Response.json({ documentos: docs.map((d) => publico(d, ehGestor(g.sessao))) });
  } catch (e) { return falha(e); }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const g = await guardaEmpresa(req, body.empresa);
    if (!g.ok) return g.resposta;
    const empresaId = g.empresaId!;

    if (!competenciaValida(body.competencia)) throw new ErroDoc('Informe a competência (mês de referência).');
    if (!categoriaValida(body.categoria)) throw new ErroDoc('Escolha a categoria do documento.');
    const arq = validarArquivo({ nome: String(body.nome ?? ''), tamanho: Number(body.tamanho), tipo: body.tipo });
    if (!arq.ok) throw new ErroDoc(arq.erro);

    const escritorioId = await escritorioDaEmpresa(empresaId);

    let pendenciaId: string | null = null;
    if (body.pendencia) {
      const pend = await lerPendencia(String(body.pendencia));
      if (!pend || pend.excluidoEm || pend.empresaId !== empresaId || !podeAtenderPendencia(g.sessao, pend)) {
        throw new ErroDoc('Esta pendência não está aberta para esta empresa.', 409);
      }
      pendenciaId = pend.id;
    }

    if ((await enviosRecentes(empresaId)) >= MAX_ENVIOS_HORA) {
      throw new ErroDoc('Muitos envios na última hora. Aguarde um pouco e tente de novo.', 429);
    }

    const r = await iniciarEnvio({
      empresaId, escritorioId, competencia: body.competencia, categoria: body.categoria,
      nome: arq.nome, tamanho: Number(body.tamanho), tipo: arq.tipo,
      observacao: textoOpcional(body.observacao, 500), pendenciaId, autor: g.sessao.email,
    });
    return Response.json(r);
  } catch (e) { return falha(e); }
}

/**
 * `acao`: confirmar (fim do envio) · conferir (aceitar) · devolver (com `motivo`) ·
 * desconferir (volta a "recebido": desfaz o aceite ou a devolução) · restaurar
 * (desfazer exclusão). A situação só muda pela contabilidade (podeMudarSituacao).
 */
export async function PATCH(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json().catch(() => ({}));
    const d = await lerDocumento(String(body.id ?? ''));
    if (!d || !podeVerRegistro(g.sessao, d)) return naoEncontrado('Documento');
    { const r = await respostaNegadaEmpresa(g.sessao, d.empresaId); if (r) return r; }
    const s = g.sessao;

    switch (body.acao) {
      case 'confirmar': {
        // Só quem iniciou o envio o confirma.
        if (d.excluidoEm || d.enviadoPor !== s.email) return negado();
        return Response.json({ documento: publico(await confirmarEnvio(d, s.email), ehGestor(s)) });
      }
      case 'conferir':
      case 'devolver':
      case 'desconferir': {
        if (d.excluidoEm || !podeMudarSituacao(s, d, body.acao)) return negado();
        let motivo: string | null = null;
        if (body.acao === 'devolver') {
          const m = motivoDevolucao(body.motivo);
          if (!m.ok) throw new ErroDoc(m.erro);
          motivo = m.motivo;
        }
        return Response.json({ documento: publico(await mudarSituacao(d, body.acao, s.email, motivo), true) });
      }
      case 'restaurar': {
        if (!d.excluidoEm) return Response.json({ ok: true });
        if (!podeRestaurarDocumento(s, d)) return negado();
        await restaurarDocumento(d, s.email);
        return Response.json({ ok: true });
      }
      default:
        throw new ErroDoc('Ação inválida.');
    }
  } catch (e) { return falha(e); }
}

/** Exclusão lógica — a tela oferece "Desfazer" (PATCH restaurar). */
export async function DELETE(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;
  try {
    const d = await lerDocumento(req.nextUrl.searchParams.get('id') ?? '');
    if (!d || d.excluidoEm || !podeVerRegistro(g.sessao, d)) return naoEncontrado('Documento');
    { const r = await respostaNegadaEmpresa(g.sessao, d.empresaId); if (r) return r; }
    if (!podeExcluirDocumento(g.sessao, d)) return negado();
    await excluirDocumento(d, g.sessao.email, ehGestor(g.sessao));
    return Response.json({ ok: true });
  } catch (e) { return falha(e); }
}
