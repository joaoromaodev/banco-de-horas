// GET /api/painel — "o que precisa de atenção hoje" para a contabilidade.
//
// Só gestor (`exigirGestor`), recortado pelas empresas que a sessão enxerga.
// Os blocos consultam em paralelo e cada um falha sozinho (lib/painel `isolar`):
// tabela de migração pendente vira bloco "indisponível", nunca derruba o painel.
// Bloco de módulo que o contador não tem (ponto → contratos, caixa) nem entra.
import { NextRequest } from 'next/server';
import { temModulo } from '@/lib/auth';
import { empresasVisiveis, exigirGestor } from '@/lib/acesso';
import { hojeBelem, somarDias } from '@/lib/agenda';
import { listarConclusoes, listarObrigacoes } from '@/lib/agendaServidor';
import { alertasConsolidados } from '@/lib/contratos';
import { listarEmExperiencia } from '@/lib/contratosServidor';
import {
  Bloco, blocoAgenda, blocoCaixa, blocoContratos, blocoDocumentos, blocoPendencias,
  isolar, ordenarBlocos, resumir,
} from '@/lib/painel';
import { documentosAConferir, lancamentosAConferir, pendenciasComPrazo, Recorte } from '@/lib/painelServidor';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  const { sessao } = g;

  let empresas;
  try {
    empresas = await empresasVisiveis(sessao);
  } catch (e) {
    console.error('[painel] empresas:', e instanceof Error ? e.message : e);
    return Response.json({ erro: 'Não foi possível carregar as empresas.' }, { status: 502 });
  }
  const nomes = new Map(empresas.map((e) => [e.id, e.nome]));
  const recorte: Recorte = { empresaIds: [...nomes.keys()], escritorioId: sessao.role === 'master' ? null : sessao.escritorioId ?? null };
  // Contador sem escritório não enxerga nada (falha fechada, como nas outras rotas).
  const semEscritorio = sessao.role !== 'master' && !recorte.escritorioId;
  const hoje = hojeBelem();
  const ano = Number(hoje.slice(0, 4));

  const tarefas: Promise<Bloco>[] = [
    isolar('agenda', async () => {
      if (semEscritorio) return blocoAgenda([], [], nomes, hoje);
      const escopo = sessao.role === 'master' ? 'plataforma' as const : { escritorioId: recorte.escritorioId! };
      const [obrigacoes, conclusoes] = await Promise.all([
        listarObrigacoes(escopo), listarConclusoes(escopo, ano - 2),
      ]);
      return blocoAgenda(obrigacoes.filter((o) => nomes.has(o.empresaId)), conclusoes, nomes, hoje);
    }),
    isolar('documentos', async () => {
      const { linhas, truncado } = await documentosAConferir(recorte);
      return { ...blocoDocumentos(linhas, nomes, hoje), truncado };
    }),
    isolar('pendencias', async () =>
      blocoPendencias(await pendenciasComPrazo(recorte, somarDias(hoje, 3)), nomes, hoje)),
  ];
  if (temModulo(sessao, 'ponto')) {
    tarefas.push(isolar('contratos', async () => {
      const contratos = await listarEmExperiencia(recorte.empresaIds);
      return blocoContratos(alertasConsolidados(
        contratos.map((c) => ({ ...c, empresaNome: nomes.get(c.empresa) ?? '' })), hoje,
      ));
    }));
  }
  if (temModulo(sessao, 'caixa')) {
    tarefas.push(isolar('caixa', async () => {
      const { linhas, truncado } = await lancamentosAConferir(recorte, ano);
      return { ...blocoCaixa(linhas, nomes), truncado };
    }));
  }

  const blocos = ordenarBlocos(await Promise.all(tarefas));
  return Response.json({ hoje, resumo: resumir(blocos), blocos }, { headers: { 'Cache-Control': 'no-store' } });
}
