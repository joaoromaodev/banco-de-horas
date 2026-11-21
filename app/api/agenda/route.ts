// /api/agenda — obrigações da agenda (a regra) e as conclusões por competência.
//
// Exclusivo da contabilidade: `exigirGestor` + acesso à empresa. O `cliente` já é
// barrado no proxy (a rota não está em CLIENTE_PODE). As ocorrências não vêm
// daqui: a tela as gera com lib/agenda.ts a partir das obrigações.
import { NextRequest } from 'next/server';
import { empresasVisiveis, exigirGestor, podeAcessarEmpresa } from '@/lib/acesso';
import { temModulo } from '@/lib/auth';
import { hojeBelem } from '@/lib/agenda';
import { itensDeContratos } from '@/lib/agendaDerivada';
import { listarEmExperiencia } from '@/lib/contratosServidor';
import { itensDoDp, itensNaJanela, type ItemDp } from '@/lib/dpAgenda';
import { dadosDpParaAgenda } from '@/lib/dpServidor';
import { conjuntoFeriados } from '@/lib/ferias';
import { NovaObrigacao, validarObrigacao } from '@/lib/agenda';
import {
  atualizarObrigacao, AVISO_PADRAO, criarObrigacoes, equipeDoEscritorio, ErroAgenda, excluirObrigacoes,
  lerAviso, listarConclusoes, listarObrigacoes,
} from '@/lib/agendaServidor';
import { escopoDe, escritorioDaEmpresa, falha, negado, obrigacaoAcessivel } from './comum';

export const runtime = 'nodejs';

function validar(b: unknown): NovaObrigacao {
  const r = validarObrigacao((b ?? {}) as Partial<NovaObrigacao>);
  if (!r.ok) throw new ErroAgenda(r.erros.join(' '));
  return r.obrigacao;
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? v : [v]).map((x) => String(x ?? '')).filter(Boolean).slice(0, 100);

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  const escopo = escopoDe(g.sessao);
  if (!escopo) return Response.json({ erro: 'Usuário sem escritório vinculado.' }, { status: 403 });
  const empresa = req.nextUrl.searchParams.get('empresa') || undefined;
  if (empresa && !(await podeAcessarEmpresa(g.sessao, empresa))) return negado();
  try {
    const anoAtual = new Date().getUTCFullYear();
    const [obrigacoes, conclusoes] = await Promise.all([
      listarObrigacoes(escopo, empresa),
      listarConclusoes(escopo, anoAtual - 2, empresa),
    ]);
    const escritorio = escopo === 'plataforma' ? null : escopo.escritorioId;
    const [equipe, aviso] = escritorio
      ? await Promise.all([equipeDoEscritorio(escritorio).catch(() => []), lerAviso(escritorio).catch(() => AVISO_PADRAO)])
      : [[], null];
    // Vencimentos dos contratos de experiência, derivados dos contratos salvos (nada duplicado).
    // Sem o módulo de ponto ou se a leitura falhar, a agenda segue sem eles.
    let contratos: ReturnType<typeof itensDeContratos> = [];
    let dp: ItemDp[] = [];
    if (temModulo(g.sessao, 'ponto')) {
      const visiveis = empresa ? [] : await empresasVisiveis(g.sessao).catch(() => []);
      const nomes = new Map(visiveis.map((e) => [e.id, e.nome]));
      const ids = empresa ? [empresa] : visiveis.map((e) => e.id);
      try {
        const lista = await listarEmExperiencia(ids);
        contratos = itensDeContratos(lista, nomes, hojeBelem(), 30);
      } catch (e) { console.error('[agenda] contratos:', e instanceof Error ? e.message : e); }
      // Departamento Pessoal (0021): férias e 13º derivados do cadastro do empregado.
      try {
        const d = await dadosDpParaAgenda(escritorio, ids);
        if (d) {
          const hoje = hojeBelem();
          const ano = Number(hoje.slice(0, 4));
          dp = itensNaJanela(itensDoDp({ ...d, feriados: conjuntoFeriados([ano, ano + 1]) }, nomes, hoje), 30);
        }
      } catch (e) { console.error('[agenda] dp:', e instanceof Error ? e.message : e); }
    }
    return Response.json({ obrigacoes, conclusoes, equipe, aviso, contratos, dp });
  } catch (e) {
    // Sem as tabelas (0014 pendente) a tela mostra o aviso em vez de quebrar.
    if (e instanceof ErroAgenda && e.status === 503) {
      return Response.json({ obrigacoes: [], conclusoes: [], equipe: [], aviso: null, contratos: [], dp: [], semTabela: true });
    }
    return falha(e);
  }
}

/** Cria uma obrigação. */
export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json();
    const o = validar(body.obrigacao);
    const escritorio = await escritorioDaEmpresa(g.sessao, o.empresaId);
    const [criada] = await criarObrigacoes([o], escritorio, g.sessao.email);
    return Response.json({ obrigacao: criada });
  } catch (e) { return falha(e); }
}

/** Edita a regra (`{ id, obrigacao }`) ou desfaz exclusões (`{ ids, restaurar: true }`). */
export async function PATCH(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json();
    if (body.restaurar) {
      const lista = ids(body.ids ?? body.id);
      for (const id of lista) {
        const o = await obrigacaoAcessivel(g.sessao, id, true);
        await excluirObrigacoes([id], o.escritorioId, true);
      }
      return Response.json({ ok: true });
    }
    const atual = await obrigacaoAcessivel(g.sessao, String(body.id ?? ''));
    // A empresa não muda numa edição (mudaria o escritório): força a atual.
    const o = validar({ ...body.obrigacao, empresaId: atual.empresaId });
    return Response.json({ obrigacao: await atualizarObrigacao(atual.id, o, g.sessao.email) });
  } catch (e) { return falha(e); }
}

/** Exclusão lógica de uma ou várias (`?id=` repetido). A tela oferece "Desfazer". */
export async function DELETE(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const lista = ids(req.nextUrl.searchParams.getAll('id'));
    if (!lista.length) throw new ErroAgenda('Informe a obrigação.');
    for (const id of lista) {
      const o = await obrigacaoAcessivel(g.sessao, id);
      await excluirObrigacoes([id], o.escritorioId);
    }
    return Response.json({ ok: true, ids: lista });
  } catch (e) { return falha(e); }
}
