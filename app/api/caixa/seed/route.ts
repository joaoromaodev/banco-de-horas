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
    // O seed só toca o catálogo BASE (`escritorio_id` nulo, migração 0013): contas
    // e analíticas criadas pelos escritórios não são lidas, alteradas nem apagadas.
    // O índice único do código é parcial (só no base), então o upsert por
    // `onConflict` não serve: lê o base, atualiza o que existe e insere o que falta.
    const { data: existentes, error: errBase } = await db
      .from('plano_contas').select('id, codigo').is('escritorio_id', null);
    if (errBase) throw new Error(`plano_contas (leitura): ${errBase.message}`);
    const idBase = new Map((existentes ?? []).map((c) => [c.codigo as string, c.id as string]));

    const faltam = contas.filter((c) => !idBase.has(c.codigo));
    if (faltam.length) {
      const { error } = await db.from('plano_contas').insert(faltam.map((c) => ({ ...c, escritorio_id: null })));
      if (error) throw new Error(`plano_contas: ${error.message}`);
    }
    for (const c of contas.filter((c) => idBase.has(c.codigo))) {
      const { error } = await db.from('plano_contas').update({
        nome: c.nome, grupo: c.grupo, natureza: c.natureza, linha_balanco: c.linha_balanco, ordem: c.ordem,
      }).eq('id', idBase.get(c.codigo)!);
      if (error) throw new Error(`plano_contas: ${error.message}`);
    }

    // Históricos referenciam a conta sugerida pelo código (do base).
    const { data: salvas, error: errLer } = await db
      .from('plano_contas').select('id, codigo').is('escritorio_id', null);
    if (errLer) throw new Error(`plano_contas (leitura): ${errLer.message}`);
    const idPorCodigo = new Map((salvas ?? []).map((c) => [c.codigo as string, c.id as string]));

    // Sem chave natural nos históricos: recria a lista do BASE, que é pequena.
    // As analíticas de escritório (`escritorio_id` preenchido) ficam intactas.
    const { error: errApaga } = await db.from('historicos_padrao').delete().is('escritorio_id', null);
    if (errApaga) throw new Error(`historicos_padrao: ${errApaga.message}`);
    const historicos = HISTORICOS_PADRAO.map((h, ordem) => ({
      texto: h.texto,
      natureza: h.natureza,
      conta_id: h.codigoConta ? idPorCodigo.get(h.codigoConta) ?? null : null,
      ordem,
      escritorio_id: null,
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
