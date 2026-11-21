// GET/POST /api/funcionarios — lista e salva o cadastro de funcionários.
import { NextRequest } from 'next/server';
import { empresasVisiveis, exigirGestor, podeAcessarEmpresa } from '@/lib/acesso';
import { lerFuncionarios, salvarFuncionarios } from '@/lib/sheets';
import { Funcionario } from '@/lib/tipos';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const empresa = new URL(req.url).searchParams.get('empresa') || undefined;
    if (empresa) {
      if (!(await podeAcessarEmpresa(g.sessao, empresa))) return Response.json({ erro: 'Acesso restrito a esta empresa.' }, { status: 403 });
      return Response.json({ funcionarios: await lerFuncionarios(empresa) });
    }
    // Sem filtro: só os funcionários das empresas que a sessão enxerga (escritório).
    const visiveis = new Set((await empresasVisiveis(g.sessao)).map((e) => e.id));
    return Response.json({ funcionarios: (await lerFuncionarios()).filter((f) => visiveis.has(f.empresa)) });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao ler.' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json();
    const empresa: string = (body.empresa ?? '').trim();
    if (!empresa) return Response.json({ erro: 'Informe a empresa.' }, { status: 400 });
    if (!(await podeAcessarEmpresa(g.sessao, empresa))) return Response.json({ erro: 'Acesso restrito a esta empresa.' }, { status: 403 });
    const lista: Funcionario[] = body.funcionarios ?? [];
    const n = await salvarFuncionarios(empresa, lista);
    return Response.json({ ok: true, total: n });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao salvar.' }, { status: 502 });
  }
}
