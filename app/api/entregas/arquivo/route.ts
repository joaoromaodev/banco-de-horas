// GET /api/entregas/arquivo?id=… — abre/baixa um documento que o escritório publicou.
//
// Depois da guarda, o servidor gera uma URL assinada de 60 s (com `download` = nome
// original, que força anexo) e redireciona. Se quem abre é o CLIENTE da empresa e é a
// primeira vez, grava "aberto em …" (protocolo de leitura) antes do redirect. A
// contabilidade abrindo o arquivo não conta. Empresa arquivada: a contabilidade
// baixa (consulta); o cliente dela leva 403.
import { NextRequest } from 'next/server';
import { exigirSessao, respostaNegadaEmpresa } from '@/lib/acesso';
import { podeVerEntrega, registraAbertura } from '@/lib/entregas';
import { lerEntrega, registrarAbertura, urlDownloadEntrega } from '@/lib/entregasServidor';
import { falha, naoEncontrado } from '../../documentos/comum';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;
  try {
    const e = await lerEntrega(req.nextUrl.searchParams.get('id') ?? '');
    if (!e || !podeVerEntrega(g.sessao, e)) return naoEncontrado('Documento');
    { const r = await respostaNegadaEmpresa(g.sessao, e.empresaId); if (r) return r; }
    const url = await urlDownloadEntrega(e);
    // "Aberto em" = o primeiro download PELO PORTAL. Um link vindo de outro site
    // (Sec-Fetch-Site cross-site/same-site), com o cookie `lax` do cliente, baixa mas não
    // conta. Sem o cabeçalho (navegador antigo) ou digitado/favorito (`none`), conta.
    const origem = req.headers.get('sec-fetch-site');
    const peloPortal = !origem || origem === 'same-origin' || origem === 'none';
    if (peloPortal && registraAbertura(g.sessao, e)) {
      // A falha ao gravar não impede o cliente de baixar: no pior caso a contadora o
      // vê como "não aberto" e lembra de novo — nunca o contrário.
      try { await registrarAbertura(e, g.sessao.email); } catch (err) {
        console.error('[entregas] registrar abertura:', err instanceof Error ? err.message : err);
      }
    }
    return new Response(null, {
      status: 302,
      headers: { Location: url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    });
  } catch (e) { return falha(e); }
}
