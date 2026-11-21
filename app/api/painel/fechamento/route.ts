// GET /api/painel/fechamento — checklist de fechamento do mês anterior, por empresa.
//
// Só gestor (`exigirGestor`), recortado pelas empresas que a sessão enxerga. Só
// leitura. Cada fonte (caixa, documentos, agenda) falha sozinha: a etapa vira
// "indisponível" e o resto segue (regras em lib/fechamento.ts). `?dia=AAAA-MM-DD`
// simula outro "hoje" (só para testar).
import { NextRequest } from 'next/server';
import { temModulo } from '@/lib/auth';
import { empresasVisiveis, exigirGestor } from '@/lib/acesso';
import { hojeBelem, isoValida } from '@/lib/agenda';
import { competenciaPadrao } from '@/lib/documentos';
import {
  checklistDaEmpresa, ordenarFechamento, resumirFechamento,
} from '@/lib/fechamento';
import { fonte, fontesDoFechamento } from '@/lib/fechamentoServidor';
import { Recorte } from '@/lib/painelServidor';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  const { sessao } = g;

  let empresas;
  try {
    empresas = await empresasVisiveis(sessao);
  } catch (e) {
    console.error('[painel/fechamento] empresas:', e instanceof Error ? e.message : e);
    return Response.json({ erro: 'Não foi possível carregar as empresas.' }, { status: 502 });
  }
  const pedido = req.nextUrl.searchParams.get('dia');
  const hoje = isoValida(pedido) ? pedido : hojeBelem();
  const competencia = competenciaPadrao(hoje);
  const ano = Number(competencia.slice(0, 4));
  const mes = Number(competencia.slice(5, 7));

  const escritorioId = sessao.role === 'master' ? null : sessao.escritorioId ?? null;
  const semEscritorio = sessao.role !== 'master' && !escritorioId;
  const recorte: Recorte = { empresaIds: semEscritorio ? [] : empresas.map((e) => e.id), escritorioId };

  const f = await fontesDoFechamento(recorte, ano, mes, competencia, {
    comCaixa: temModulo(sessao, 'caixa'),
    escopoAgenda: semEscritorio ? null : sessao.role === 'master' ? 'plataforma' : { escritorioId: escritorioId! },
  });

  const lista = ordenarFechamento(empresas.filter((e) => recorte.empresaIds.includes(e.id)).map((e) => checklistDaEmpresa({
    empresaId: e.id, nome: e.nome,
    // Sem o módulo caixa: fonte "não se aplica" (n/a), não "indisponível".
    caixa: f.caixa === null && f.caixaOk ? fonte(true, null) : fonte(f.caixaOk, f.caixa?.get(e.id) ?? { lancamentos: 0, naoConferidos: 0, confirmado: false }),
    documentos: fonte(f.documentosOk, f.documentos.get(e.id) ?? { pedidos: 0, abertos: 0 }),
    obrigacoes: fonte(f.obrigacoesOk, f.obrigacoes.get(e.id) ?? { total: 0, feitas: 0 }),
  }, competencia)));

  return Response.json(
    { hoje, competencia, resumo: resumirFechamento(lista), empresas: lista },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
