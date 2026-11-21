// GET /api/caixa/atividade — "as empresas lançaram algo novo?".
//
// A contadora pediu para **ser avisada quando a empresa lançar**. O aviso é a
// própria fila de conferência: lançamento sem `conferido_em` é coisa que ela
// ainda não olhou. Não há tabela de notificação — quando ela confere, sai da
// fila sozinho.
import { NextRequest } from 'next/server';
import { empresaVisivelPara, exigirGestor } from '@/lib/acesso';
import { ErroCaixa } from '@/lib/caixa';
import { emLotes, getDb, lerAteTeto } from '@/lib/db';
import { lerEmpresas } from '@/lib/cadastro';

export const runtime = 'nodejs';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- linha crua do PostgREST
type Linha = Record<string, any>;
const TETO = 500; // ~5 empresas × 40 lançamentos/mês: dois meses de fila cabem aqui

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;

  try {
    const ano = Number(req.nextUrl.searchParams.get('ano'));
    if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new ErroCaixa('Ano inválido.');

    // O recorte pelas empresas visíveis vai na PRÓPRIA consulta. Antes lia as 500 mais
    // novas da plataforma inteira e só depois filtrava: com vários escritórios, as de
    // outros ocupavam o teto e a fila do contador saía incompleta (e o banco lia à toa).
    const visiveis = new Set((await lerEmpresas()).filter((e) => empresaVisivelPara(g.sessao, e)).map((e) => e.id));
    const db = getDb();
    const partes = await emLotes([...visiveis], async (lote) => (await lerAteTeto<Linha>((de, ate) => db
      .from('lancamentos')
      .select('id, mes, historico, criado_em, criado_por, exercicios!inner(empresa_id, ano)')
      .is('conferido_em', null)
      .eq('exercicios.ano', ano)
      .in('exercicios.empresa_id', lote)
      .order('criado_em', { ascending: false }).order('id').range(de, ate), TETO,
    { falhar: (e) => new ErroCaixa(`lancamentos: ${e.message}`, 502) })).linhas);
    partes.sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
    const data = partes.slice(0, TETO);

    // Agrupa por empresa mantendo o mais recente de cada uma (a lista já vem
    // em ordem decrescente, então o primeiro que aparece é o mais novo).
    const porEmpresa = new Map<string, { empresaId: string; pendentes: number; meses: number[]; ultimo: { historico: string; criadoEm: string; criadoPor: string; mes: number } }>();
    for (const l of data) {
      const ex = (Array.isArray(l.exercicios) ? l.exercicios[0] : l.exercicios) as { empresa_id: string };
      const atual = porEmpresa.get(ex.empresa_id);
      if (atual) {
        atual.pendentes++;
        if (!atual.meses.includes(l.mes)) atual.meses.push(l.mes);
      } else {
        porEmpresa.set(ex.empresa_id, {
          empresaId: ex.empresa_id, pendentes: 1, meses: [l.mes],
          ultimo: { historico: l.historico, criadoEm: l.criado_em, criadoPor: l.criado_por, mes: l.mes },
        });
      }
    }

    const empresas = [...porEmpresa.values()]
      .map((e) => ({ ...e, meses: e.meses.sort((a, b) => a - b) }));
    return Response.json({
      empresas,
      total: empresas.reduce((s, e) => s + e.pendentes, 0),
      truncado: partes.length > TETO,
    });
  } catch (e) {
    if (e instanceof ErroCaixa) return Response.json({ erro: e.message }, { status: e.status });
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao ler a atividade.' }, { status: 502 });
  }
}
