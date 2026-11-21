// GET /api/documentos/arquivo?id=… — abre/baixa um documento.
//
// O bucket é privado: depois da guarda, o servidor gera uma URL assinada de
// 60 s (com `download` = nome original, que força anexo) e redireciona. A URL
// não fica em lugar nenhum da tela; cada clique gera outra.
import { NextRequest } from 'next/server';
import { exigirSessao } from '@/lib/acesso';
import { podeVerRegistro } from '@/lib/documentos';
import { lerDocumento, urlDownload } from '@/lib/documentosServidor';
import { falha, naoEncontrado } from '../comum';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;
  try {
    const d = await lerDocumento(req.nextUrl.searchParams.get('id') ?? '');
    if (!d || d.excluidoEm || (d.status !== 'recebido' && d.status !== 'conferido') || !podeVerRegistro(g.sessao, d)) return naoEncontrado('Documento');
    const url = await urlDownload(d);
    return new Response(null, {
      status: 302,
      headers: { Location: url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    });
  } catch (e) { return falha(e); }
}
