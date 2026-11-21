// GET/POST /api/funcionarios — lista e salva o cadastro de funcionários (Postgres,
// por escritório).
import { NextRequest } from 'next/server';
import { exigirGestor } from '@/lib/acesso';
import { exigirEmpresaPonto, respostaErroPonto } from '@/lib/pontoAcesso';
import { lerFuncionarios, salvarFuncionarios } from '@/lib/pontoDb';
import { Funcionario } from '@/lib/tipos';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const empresa = new URL(req.url).searchParams.get('empresa');
  try {
    if (empresa) {
      const g = await exigirEmpresaPonto(req, empresa);
      if (!g.ok) return g.resposta;
      return Response.json({ funcionarios: await lerFuncionarios(g.escritorioId, g.empresa.id) });
    }
    // Sem empresa: os do escritório da sessão (o master vê todos).
    const g = await exigirGestor(req);
    if (!g.ok) return g.resposta;
    if (g.sessao.role === 'master') return Response.json({ funcionarios: await lerFuncionarios(null) });
    if (!g.sessao.escritorioId) return Response.json({ funcionarios: [] });
    return Response.json({ funcionarios: await lerFuncionarios(g.sessao.escritorioId) });
  } catch (e) {
    return respostaErroPonto(e, 'Falha ao ler os funcionários.');
  }
}

export async function POST(req: NextRequest) {
  let body: { empresa?: string; funcionarios?: Funcionario[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ erro: 'JSON inválido.' }, { status: 400 });
  }
  const g = await exigirEmpresaPonto(req, body?.empresa);
  if (!g.ok) return g.resposta;
  const lista = Array.isArray(body.funcionarios) ? body.funcionarios : [];
  try {
    const n = await salvarFuncionarios(g.escritorioId, g.empresa.id, lista);
    return Response.json({ ok: true, total: n });
  } catch (e) {
    return respostaErroPonto(e, 'Falha ao salvar os funcionários.');
  }
}
