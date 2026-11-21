// GET /api/envio-ponto/foto?id=… — mostra a foto de uma folha enviada.
//
// Bucket privado: depois da guarda, URL assinada de 60 s e redirect. A URL não
// fica na tela (cada carregamento gera outra) e não vaza por Referer.
import { NextRequest } from 'next/server';
import { ehGestor, exigirSessao, respostaNegadaEmpresa } from '@/lib/acesso';
import { escritorioDaEmpresa } from '@/lib/pontoAcesso';
import { podeVerEnvio } from '@/lib/envioPonto';
import { ErroEnvio, lerEnvio, urlFoto } from '@/lib/envioPontoServidor';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;
  try {
    const e = await lerEnvio(req.nextUrl.searchParams.get('id') ?? '');
    const nao = Response.json({ erro: 'Foto não encontrada.' }, { status: 404 });
    if (!e || e.excluidoEm || e.situacao === 'enviando' || e.situacao === 'rejeitada' || !podeVerEnvio(g.sessao, e)) return nao;
    { const r = await respostaNegadaEmpresa(g.sessao, e.empresaId); if (r) return r; }
    if (ehGestor(g.sessao) && !(await escritorioDaEmpresa(g.sessao, e.empresaId))) return nao;
    const url = await urlFoto(e);
    return new Response(null, {
      status: 302,
      headers: { Location: url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    });
  } catch (err) {
    if (err instanceof ErroEnvio) return Response.json({ erro: err.message }, { status: err.status });
    console.error('[envio-ponto] foto:', err instanceof Error ? err.message.slice(0, 160) : err);
    return Response.json({ erro: 'Foto indisponível.' }, { status: 502 });
  }
}
