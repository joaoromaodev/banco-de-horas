// GET/POST /api/empresas — lista e salva o cadastro de empresas-clientes.
//
// Multi-escritório: o contador enxerga e mexe nas empresas do **escritório** dele;
// o cliente, só na vinculada; o `master` (plataforma) vê e administra todas.
import { NextRequest } from 'next/server';
import { empresasVisiveis, exigirGestor, exigirSessao } from '@/lib/acesso';
import { lerEmpresas, salvarEmpresas } from '@/lib/cadastro';
import { Empresa } from '@/lib/tipos';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;
  try {
    return Response.json({ empresas: await empresasVisiveis(g.sessao) });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao ler.' }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json();
    const enviadas: Empresa[] = Array.isArray(body.empresas) ? body.empresas : [];
    const todas = await lerEmpresas();
    const porId = new Map(todas.map((e) => [e.id, e]));

    if (g.sessao.role === 'master') {
      // O master administra a plataforma: grava a lista como veio, e cada empresa
      // existente mantém o escritório que já tinha (a tela não o edita). Empresa
      // nova não tem a quem pertencer — quem cadastra é o escritório.
      const novas = enviadas.filter((e) => e.nome?.trim() && !porId.has(e.id?.trim() ?? ''));
      if (novas.length) {
        return Response.json({ erro: 'Empresas novas são cadastradas pelo próprio escritório.' }, { status: 400 });
      }
      const paraSalvar = enviadas.map((e) => ({ ...e, escritorioId: porId.get(e.id?.trim() ?? '')?.escritorioId ?? null }));
      const n = await salvarEmpresas(paraSalvar, 'plataforma');
      return Response.json({ ok: true, total: n });
    }

    const escritorioId = g.sessao.escritorioId;
    if (!escritorioId) return Response.json({ erro: 'Usuário sem escritório vinculado.' }, { status: 403 });

    // Um id enviado que já existe em OUTRO escritório seria sobrescrito pelo upsert
    // (e "roubado"). Recusa em vez de confiar no que veio do navegador.
    const alheia = enviadas.find((e) => {
      const atual = porId.get(e.id?.trim() ?? '');
      return atual && atual.escritorioId !== escritorioId;
    });
    if (alheia) return Response.json({ erro: 'Acesso restrito a esta empresa.' }, { status: 403 });

    // O responsável (`contador`) é preservado; empresa nova ganha quem a cadastrou.
    const email = g.sessao.email.toLowerCase();
    const paraSalvar = enviadas.map((e) => ({
      ...e,
      contador: porId.get(e.id?.trim() ?? '')?.contador ?? email,
    }));
    const n = await salvarEmpresas(paraSalvar, { escritorioId });
    return Response.json({ ok: true, total: n });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao salvar.' }, { status: 502 });
  }
}
