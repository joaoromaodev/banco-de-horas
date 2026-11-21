// GET/POST /api/empresas — lista e salva o cadastro de empresas-clientes.
//
// Multi-escritório: o contador enxerga e mexe nas empresas do **escritório** dele;
// o cliente, só na vinculada; o `master` (plataforma) vê e administra todas.
import { NextRequest } from 'next/server';
import { empresasArquivadasVisiveis, empresasVisiveis, ehGestor, exigirGestor, exigirSessao } from '@/lib/acesso';
import { definirArquivamento, lerEmpresasComArquivadas, salvarEmpresas } from '@/lib/cadastro';
import { estaArquivada, limparMotivo, podeReativar } from '@/lib/arquivamento';
import { Empresa } from '@/lib/tipos';
import { cabeNoPlano, limiteEmpresas, NOME_PLANO, PLANOS, planoMinimoPara } from '@/lib/cobranca';
import { planoDoEscritorio } from '@/lib/cobrancaServidor';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;
  try {
    // `?arquivadas=1`: a lista de arquivadas (para reativar) — só a gestão.
    if (req.nextUrl.searchParams.get('arquivadas') === '1') {
      if (!ehGestor(g.sessao)) return Response.json({ erro: 'Acesso restrito.' }, { status: 403 });
      return Response.json({ empresas: await empresasArquivadasVisiveis(g.sessao) });
    }
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
    // Com arquivadas: um id arquivado de OUTRO escritório também não pode ser "roubado".
    const todas = await lerEmpresasComArquivadas();
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

    // Limite de empresas do plano: só barra quando a lista CRESCE além do limite
    // (quem já passou dele, ex.: desceu de plano, continua editando as que tem).
    const atuais = todas.filter((e) => e.escritorioId === escritorioId && !estaArquivada(e)).length;
    // só as ativas contam; empresa arquivada enviada por engano não infla nem fura o limite
    const depois = enviadas.filter((e) => e.nome?.trim() && !(porId.get(e.id?.trim() ?? '') && estaArquivada(porId.get(e.id.trim())!))).length;
    const plano = await planoDoEscritorio(escritorioId);
    if (plano && !cabeNoPlano(plano, atuais, depois)) {
      const lim = limiteEmpresas(plano);
      const sugerido = PLANOS[planoMinimoPara(depois)].nome;
      return Response.json({
        erro: `O plano ${NOME_PLANO[plano]} comporta até ${lim} empresas-clientes. Para cadastrar mais, suba para o ${sugerido} em Assinatura.`,
        codigo: 'limite_plano', limite: lim,
      }, { status: 402 });
    }

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

/**
 * PATCH /api/empresas — `{ id, acao: 'arquivar' | 'reativar', motivo? }`.
 * Excluir empresa na tela = arquivar: some das listas, painel, agenda e cron e o
 * login do cliente dela é barrado; nenhum dado é apagado. Reativar volta a contar
 * no limite do plano. Exclusão definitiva só por SQL do master (docs/multi-escritorio.md).
 */
export async function PATCH(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json();
    const id = String(body.id ?? '').trim();
    const acao = body.acao;
    if (!id || (acao !== 'arquivar' && acao !== 'reativar')) {
      return Response.json({ erro: 'Informe a empresa e a ação (arquivar ou reativar).' }, { status: 400 });
    }
    const todas = await lerEmpresasComArquivadas();
    const alvo = todas.find((e) => e.id === id);
    // Empresa de outro escritório e empresa inexistente respondem igual (não vaza existência).
    if (!alvo || (g.sessao.role !== 'master' && alvo.escritorioId !== g.sessao.escritorioId)) {
      return Response.json({ erro: 'Empresa não encontrada.' }, { status: 404 });
    }
    if (acao === 'arquivar') {
      if (!estaArquivada(alvo)) await definirArquivamento(id, true, g.sessao.email, limparMotivo(body.motivo));
      return Response.json({ ok: true });
    }
    if (estaArquivada(alvo)) {
      const ativas = todas.filter((e) => e.escritorioId === alvo.escritorioId && !estaArquivada(e)).length;
      const plano = alvo.escritorioId ? await planoDoEscritorio(alvo.escritorioId) : null;
      const r = podeReativar(plano, ativas);
      if (!r.ok) return Response.json({ erro: r.erro, codigo: 'limite_plano', limite: r.limite }, { status: 402 });
      await definirArquivamento(id, false, g.sessao.email, null);
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao atualizar.' }, { status: 502 });
  }
}
