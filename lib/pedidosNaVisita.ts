// Pedidos mensais abertos na primeira visita do mês — "nada falha calado" (Sprint 14).
//
// O cron diário (/api/cron/agenda) abre os pedidos mensais do fechamento, mas sem
// `CRON_SECRET` ele responde 503 e os pedidos não saem. Aqui a primeira visita do mês
// da contadora ao /painel (GET /api/painel) e do cliente ao /inicio
// (GET /api/inicio-cliente) abre os pedidos do escritório dela.
//
// Barato: o escritório guarda a última competência aberta (`pedidos_competencia_aberta`,
// migração 0030) e o processo também a guarda em memória — as visitas seguintes do mês
// não fazem consulta nenhuma (ou só uma, num processo novo). Sem a 0030, vale só a memória.
//
// Idempotente sob visitas simultâneas: o índice único (modelo_id, competencia) da 0018
// barra a pendência duplicada; o conflito (23505) conta como "já existia"
// (lib/fechamentoServidor). No mesmo processo, visitas simultâneas compartilham a
// mesma promessa. A marca só é gravada se nada falhou — com falha, a próxima visita
// tenta de novo.
//
// Nenhuma função aqui decide QUEM pode: a rota que chama já passou pela guarda.
import { after } from 'next/server';
import { getDb } from './db';
import { hojeBelem } from './agenda';
import { competenciaDoPedido } from './fechamento';
import { abrirPendenciasRecorrentes, ResultadoAbertura } from './fechamentoServidor';
import { lerEmpresas } from './cadastro';
import { expurgarFotos } from './envioPontoServidor';

export type ResultadoVisita =
  | { situacao: 'ja_aberta'; competencia: string }
  | { situacao: 'aberta'; competencia: string; resultado: ResultadoAbertura }
  | { situacao: 'ignorada'; motivo: 'escritorio_suspenso' | 'escritorio_inexistente' };

/** Escritório → competência já aberta, neste processo. */
const abertaNoProcesso = new Map<string, string>();
/** Escritório+competência → abertura em andamento (visitas simultâneas no mesmo processo). */
const emCurso = new Map<string, Promise<ResultadoVisita>>();

const COLUNA = 'pedidos_competencia_aberta';
const semColuna = (e: { code?: string; message?: string } | null) =>
  e?.code === '42703' || e?.code === 'PGRST204' || new RegExp(COLUNA).test(e?.message ?? '');

/** Só para os testes: esquece a memória do processo. */
export function esquecerAberturas(): void {
  abertaNoProcesso.clear();
  emCurso.clear();
  faxinaNoDia = null;
}

/**
 * Abre os pedidos mensais do escritório se a competência do mês ainda não foi
 * aberta. Nunca lança: falha vira log e a visita segue (a próxima tenta de novo).
 */
export async function abrirPedidosNaVisita(escritorioId: string, hoje = hojeBelem()): Promise<ResultadoVisita | { situacao: 'falhou' }> {
  try {
    return await abrirPedidosDoEscritorio(escritorioId, hoje);
  } catch (e) {
    console.error('[pedidos na visita]', escritorioId, (e as { code?: string })?.code ?? '', e instanceof Error ? e.message.slice(0, 160) : e);
    return { situacao: 'falhou' };
  }
}

export async function abrirPedidosDoEscritorio(escritorioId: string, hoje = hojeBelem()): Promise<ResultadoVisita> {
  const competencia = competenciaDoPedido(hoje);
  if (abertaNoProcesso.get(escritorioId) === competencia) return { situacao: 'ja_aberta', competencia };
  const chave = `${escritorioId}|${competencia}`;
  const andamento = emCurso.get(chave);
  if (andamento) return andamento;
  const p = abrir(escritorioId, hoje, competencia).finally(() => emCurso.delete(chave));
  emCurso.set(chave, p);
  return p;
}

async function abrir(escritorioId: string, hoje: string, competencia: string): Promise<ResultadoVisita> {
  const db = getDb();
  // A marca do escritório (0030). Sem a coluna, segue só com a memória do processo.
  let temColuna = true;
  let { data, error } = await db.from('escritorios').select(`id, situacao, ${COLUNA}`).eq('id', escritorioId).maybeSingle();
  if (error && semColuna(error)) {
    temColuna = false;
    ({ data, error } = await db.from('escritorios').select('id, situacao').eq('id', escritorioId).maybeSingle());
  }
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  if (!data) return { situacao: 'ignorada', motivo: 'escritorio_inexistente' };
  const linha = data as { situacao?: string; pedidos_competencia_aberta?: string | null };
  if (linha.situacao === 'suspenso') return { situacao: 'ignorada', motivo: 'escritorio_suspenso' };
  const marca = linha.pedidos_competencia_aberta ?? null;
  if (marca && marca >= competencia) {
    abertaNoProcesso.set(escritorioId, competencia);
    return { situacao: 'ja_aberta', competencia };
  }

  // Empresas ativas (não arquivadas) do escritório — o mesmo recorte do cron.
  const ativas = new Map((await lerEmpresas())
    .filter((e) => e.escritorioId === escritorioId)
    .map((e) => [e.id, escritorioId]));
  const resultado = await abrirPendenciasRecorrentes(hoje, ativas, { escritorioId });

  if (resultado.falhas === 0) {
    abertaNoProcesso.set(escritorioId, competencia);
    if (temColuna) await marcarCompetenciaAberta([escritorioId], competencia);
  }
  return { situacao: 'aberta', competencia, resultado };
}

/**
 * Grava a competência aberta nos escritórios (visita ou cron). Só avança a marca,
 * nunca volta (`?dia=` do cron simulando um mês passado não apaga a do mês atual).
 * Falha calada de propósito: a marca é só atalho, a trava real é o índice único.
 */
export async function marcarCompetenciaAberta(escritorioIds: string[], competencia: string): Promise<void> {
  if (!escritorioIds.length) return;
  const { error } = await getDb().from('escritorios').update({ [COLUNA]: competencia })
    .in('id', escritorioIds).or(`${COLUNA}.is.null,${COLUNA}.lt.${competencia}`);
  if (error && !semColuna(error)) console.error('[pedidos na visita] marca:', error.code, error.message);
}

// ------------------------------------------------- faxina oportunista das fotos

/** Fotos apagadas por visita, no máximo — a visita não pode ficar lenta. */
export const LOTE_FAXINA_VISITA = 50;
let faxinaNoDia: string | null = null;

/**
 * A faxina das fotos do ponto (LGPD, lib/envioPontoServidor `expurgarFotos`) também
 * roda na visita da contadora ao /painel: no máximo uma vez por dia por processo,
 * com lote pequeno e DEPOIS da resposta (`after`), para não pesar na tela. O cron,
 * quando configurado, continua sendo o caminho principal (lote 200).
 */
export function agendarFaxinaOportunista(hoje = hojeBelem()): boolean {
  if (faxinaNoDia === hoje) return false;
  faxinaNoDia = hoje;
  const tarefa = async () => {
    try {
      const r = await expurgarFotos(new Date(), LOTE_FAXINA_VISITA);
      if (r.apagadas) console.info('[faxina na visita] fotos apagadas:', r.apagadas);
    } catch (e) {
      console.error('[faxina na visita]', (e as { code?: string })?.code ?? '', e instanceof Error ? e.message.slice(0, 160) : e);
    }
  };
  try {
    after(tarefa);
  } catch {
    void tarefa(); // fora de uma requisição (testes): roda solta
  }
  return true;
}
