// GET/POST /api/funcionarios — lista e salva o cadastro de funcionários.
import { NextRequest } from 'next/server';
import { lerFuncionarios, salvarFuncionarios } from '@/lib/sheets';
import { Funcionario } from '@/lib/tipos';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return Response.json({ funcionarios: await lerFuncionarios() });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao ler.' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const lista: Funcionario[] = body.funcionarios ?? [];
    const n = await salvarFuncionarios(lista);
    return Response.json({ ok: true, total: n });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao salvar.' }, { status: 502 });
  }
}
