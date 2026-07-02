// GET/POST /api/empresas — lista e salva o cadastro de empresas-clientes.
import { NextRequest } from 'next/server';
import { lerEmpresas, salvarEmpresas } from '@/lib/sheets';
import { Empresa } from '@/lib/tipos';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return Response.json({ empresas: await lerEmpresas() });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao ler.' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const lista: Empresa[] = body.empresas ?? [];
    const n = await salvarEmpresas(lista);
    return Response.json({ ok: true, total: n });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao salvar.' }, { status: 502 });
  }
}
