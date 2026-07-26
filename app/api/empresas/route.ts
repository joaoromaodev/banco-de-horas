// GET/POST /api/empresas — lista e salva o cadastro de empresas-clientes.
//
// Cada contador (papel `usuario`) só enxerga e mexe nas **suas** empresas; o
// `master` vê e administra todas. O vínculo é a coluna `contador` (e-mail dono).
import { NextRequest } from 'next/server';
import { empresaVisivelPara, exigirGestor, exigirSessao } from '@/lib/acesso';
import { lerEmpresas, salvarEmpresas } from '@/lib/sheets';
import { Empresa } from '@/lib/tipos';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;
  try {
    const todas = await lerEmpresas();
    return Response.json({ empresas: todas.filter((e) => empresaVisivelPara(g.sessao, e)) });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao ler.' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json();
    const enviadas: Empresa[] = body.empresas ?? [];
    const todas = await lerEmpresas();

    let paraSalvar: Empresa[];
    if (g.sessao.role === 'master') {
      // O master administra tudo: grava a lista como veio, preservando o dono de
      // cada empresa (a tela do master traz e devolve o campo `contador`).
      paraSalvar = enviadas;
    } else {
      // Contador: só governa as próprias. As de outros donos ficam intactas; as
      // enviadas são carimbadas com o e-mail dele — o que reivindica as sem dono.
      const email = g.sessao.email.toLowerCase();
      const deOutros = todas.filter((e) => e.contador && e.contador !== email);
      const minhas = enviadas.map((e) => ({ ...e, contador: email }));
      paraSalvar = [...deOutros, ...minhas];
    }

    const n = await salvarEmpresas(paraSalvar);
    return Response.json({ ok: true, total: n });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao salvar.' }, { status: 502 });
  }
}
