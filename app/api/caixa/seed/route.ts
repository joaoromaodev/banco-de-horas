// POST /api/caixa/seed — carrega o catálogo padrão de contas e os históricos
// no Postgres. Idempotente: pode rodar de novo sem duplicar (upsert por código).
// Só o master executa.
import { NextRequest } from 'next/server';
import { exigirMaster } from '@/lib/acesso';
import { getDb } from '@/lib/db';
import { HISTORICOS_PADRAO, PLANO_CONTAS_PADRAO } from '@/lib/planoContasPadrao';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const g = await exigirMaster(req);
  if (!g.ok) return g.resposta;

  try {
    const db = getDb();

    const contas = PLANO_CONTAS_PADRAO.map((c) => ({
      codigo: c.codigo,
      nome: c.nome,
      grupo: c.grupo,
      natureza: c.natureza,
      linha_balanco: c.linhaBalanco,
      ordem: c.ordem,
    }));
    const { error: errContas } = await db.from('plano_contas').upsert(contas, { onConflict: 'codigo' });
    if (errContas) throw new Error(`plano_contas: ${errContas.message}`);

    // Históricos referenciam a conta sugerida pelo código.
    const { data: salvas, error: errLer } = await db.from('plano_contas').select('id, codigo');
    if (errLer) throw new Error(`plano_contas (leitura): ${errLer.message}`);
    const idPorCodigo = new Map((salvas ?? []).map((c) => [c.codigo as string, c.id as string]));

    // Sem chave natural nos históricos: recria a lista inteira, que é pequena
    // e ainda não é editada pela contadora.
    await db.from('historicos_padrao').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    const historicos = HISTORICOS_PADRAO.map((h, ordem) => ({
      texto: h.texto,
      natureza: h.natureza,
      conta_id: h.codigoConta ? idPorCodigo.get(h.codigoConta) ?? null : null,
      ordem,
    }));
    const { error: errHist } = await db.from('historicos_padrao').insert(historicos);
    if (errHist) throw new Error(`historicos_padrao: ${errHist.message}`);

    const semDePara = PLANO_CONTAS_PADRAO.filter((c) => !c.linhaBalanco).length;
    return Response.json({
      ok: true,
      contas: contas.length,
      historicos: historicos.length,
      contasSemLinhaDeBalanco: semDePara,
    });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha no seed.' }, { status: 502 });
  }
}
