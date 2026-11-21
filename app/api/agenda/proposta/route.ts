// /api/agenda/proposta — o modelo de obrigações que o sistema SUGERE para uma empresa.
//
// GET ?empresa= : regime registrado + sinais (funcionários no ponto, contratos
// ativos, pessoa física, identifica pagador) + a proposta. Nunca grava obrigação:
// aplicar é o clique da contadora em POST /api/agenda/modelo (que tem desfazer).
// POST { empresa, regime | null }: registra (ou limpa) o regime que ELA decidiu —
// regime não se deduz por CNAE nem faturamento. Só contabilidade.
import { NextRequest } from 'next/server';
import { exigirGestor, respostaNegadaEmpresa } from '@/lib/acesso';
import { temModulo } from '@/lib/auth';
import { listarObrigacoes } from '@/lib/agendaServidor';
import { propostaDeAgenda, regimeCadastroValido, RegimeCadastro, SinaisEmpresa } from '@/lib/agendaDerivada';
import { lerEmpresa } from '@/lib/cadastro';
import { listarContratos } from '@/lib/contratosServidor';
import { ErroFechamento, lerRegimes, limparRegime, salvarRegime } from '@/lib/fechamentoServidor';
import { lerFuncionarios } from '@/lib/pontoDb';
import { escritorioDaEmpresa, falha as falhaAgenda } from '../comum';

export const runtime = 'nodejs';

function falha(e: unknown) {
  if (e instanceof ErroFechamento) return Response.json({ erro: e.message }, { status: e.status });
  return falhaAgenda(e);
}

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const empresaId = req.nextUrl.searchParams.get('empresa') ?? '';
    { const r = await respostaNegadaEmpresa(g.sessao, empresaId); if (r) return r; }
    const escritorio = await escritorioDaEmpresa(g.sessao, empresaId);
    const empresa = await lerEmpresa(empresaId);

    // Cada sinal degrada sozinho: sem o módulo ou com falha, vira `null` (desconhecido).
    const comPonto = temModulo(g.sessao, 'ponto');
    const [regimes, obrigacoes, funcionarios, contratos] = await Promise.all([
      lerRegimes([empresaId], escritorio).catch((e) => { if (!(e instanceof ErroFechamento && e.status === 503)) throw e; return null; }),
      listarObrigacoes({ escritorioId: escritorio }, empresaId),
      comPonto ? lerFuncionarios(escritorio, empresaId).then((l) => l.length).catch(() => null) : Promise.resolve(null),
      comPonto ? listarContratos(empresaId).then((l) => l.filter((c) => c.situacao !== 'encerrado').length).catch(() => null) : Promise.resolve(null),
    ]);
    const regime = regimes?.get(empresaId) ?? null;
    const sinais: SinaisEmpresa = {
      tipoPessoa: empresa?.tipoPessoa ?? null, identificaPagador: empresa?.identificaPagador ?? null,
      funcionarios, contratosAtivos: contratos,
    };
    return Response.json({
      regime, semTabelaRegime: regimes === null, sinais,
      semObrigacoes: obrigacoes.length === 0,
      proposta: propostaDeAgenda(regime, sinais, obrigacoes.map((o) => o.tipo)),
    });
  } catch (e) { return falha(e); }
}

export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json().catch(() => ({}));
    const empresaId = String(body.empresa ?? '');
    const escritorio = await escritorioDaEmpresa(g.sessao, empresaId);
    if (body.regime === null) {
      await limparRegime(empresaId);
      return Response.json({ ok: true, regime: null });
    }
    if (!regimeCadastroValido(body.regime)) throw new ErroFechamento('Regime inválido.');
    await salvarRegime(empresaId, escritorio, body.regime as RegimeCadastro, g.sessao.email);
    return Response.json({ ok: true, regime: body.regime });
  } catch (e) { return falha(e); }
}
