// GET/POST /api/empresas — lista e salva o cadastro de empresas-clientes.
import { NextRequest } from 'next/server';
import { exigirGestor, exigirSessao, podeVerEmpresa } from '@/lib/acesso';
import { lerEmpresas, salvarEmpresas } from '@/lib/sheets';
import { Empresa } from '@/lib/tipos';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;
  try {
    // Cliente enxerga apenas a própria empresa (hoje o proxy já o barra aqui;
    // o filtro fica para quando a tela do caixa precisar do nome da empresa).
    const todas = await lerEmpresas();
    return Response.json({ empresas: todas.filter((e) => podeVerEmpresa(g.sessao, e.id)) });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao ler.' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json();
    const lista: Empresa[] = body.empresas ?? [];
    const n = await salvarEmpresas(lista);
    return Response.json({ ok: true, total: n });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao salvar.' }, { status: 502 });
  }
}
