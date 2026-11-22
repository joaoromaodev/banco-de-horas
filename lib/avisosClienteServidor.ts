// Avisos ao cliente pelo sino — leituras (só de servidor). Regras em lib/avisosCliente.ts.
//
// SOMENTE LEITURA do que já existe (ponto_envios, pendencias, exercicios +
// meses_confirmados); a única gravação é o "lido" da pessoa em `notificacoes_leitura`
// (0027), com a mesma função do sino da contabilidade. A autorização é da rota
// (`exigirClienteDaEmpresa`): cada função recebe a empresa e o escritório já validados,
// vindos da SESSÃO. Nada é publicado em `notificacoes`: a contabilidade não vê estes avisos.
import { getDb } from './db';
import { listarDocumentos, listarPendencias } from './documentosServidor';
import { listarEntregasOuNada } from './entregasServidor';
import { listarEnvios } from './envioPontoServidor';
import { hojeBelem } from './agenda';
import { devolvidosSemReenvio } from './documentos';
import {
  avisosDemonstrativo, avisosDocumentoDevolvido, avisosEntrega, avisosFolhaDevolvida, avisosLembretePedido, avisosPedido,
  desdeTrezeMeses,
} from './avisosCliente';
import { desdeDaJanela, montarNotificacoes, type ItemNotificacao, type Leitura } from './notificacoes';
import { lerLeitura, type RespostaSino } from './notificacoesServidor';
import { fechamentosParaCliente } from './fechamentoPontoServidor';
import { avisosAceitePonto } from './mesFechado';

/**
 * Chave da leitura do cliente em `notificacoes_leitura.usuario`. Leva a empresa: se o
 * login for religado a outra empresa, o "lido" não atravessa de uma para a outra; e não
 * se confunde com a leitura de quem é da contabilidade.
 */
export const usuarioLeituraCliente = (empresaId: string, email: string) => `cliente|${empresaId}|${email.trim().toLowerCase()}`;

export async function folhasDevolvidas(escritorioId: string, empresaId: string, agora: Date = new Date()): Promise<ItemNotificacao[]> {
  const envios = await listarEnvios(escritorioId, empresaId, { desde: desdeTrezeMeses(hojeBelem(agora)) });
  return avisosFolhaDevolvida(envios.map((e) => ({
    id: e.id, funcionario: e.funcionario, ano: e.ano, mes: e.mes, situacao: e.situacao, devolvidoEm: e.devolvidoEm,
  })));
}

/** Pedidos novos e, dos abertos, o lembrete antes do prazo (0032) — uma leitura só. */
export async function pedidosNovos(escritorioId: string, empresaId: string, agora: Date = new Date()): Promise<ItemNotificacao[]> {
  const lista = (await listarPendencias({ empresaId, escritorioId }))
    .map((p) => ({ id: p.id, titulo: p.titulo, prazo: p.prazo, status: p.status, criadoEm: p.criadoEm }));
  return [...avisosPedido(lista), ...avisosLembretePedido(lista, hojeBelem(agora))];
}

/** Documentos que a contabilidade publicou e o cliente ainda não abriu (0032), com o lembrete do vencimento. */
export async function entregasNovas(escritorioId: string, empresaId: string, agora: Date = new Date()): Promise<ItemNotificacao[]> {
  const lista = await listarEntregasOuNada({ empresaId, escritorioId });
  return avisosEntrega(lista.map((e) => ({
    id: e.id, tipo: e.tipo, competencia: e.competencia, vencimento: e.vencimento, publicadoEm: e.publicadoEm, abertoEm: e.abertoEm,
  })), hojeBelem(agora));
}

/** Documentos do cliente devolvidos pela contabilidade e ainda não reenviados (0032). */
export async function documentosDevolvidos(escritorioId: string, empresaId: string): Promise<ItemNotificacao[]> {
  const docs = await listarDocumentos({ empresaId, escritorioId });
  return avisosDocumentoDevolvido(devolvidosSemReenvio(docs).map((d) => ({
    id: d.id, categoria: d.categoria, competencia: d.competencia, devolvidoEm: d.devolvidoEm,
  })));
}

/** Demonstrativos liberados nos anos que a janela alcança (o corrente e, em janeiro, o anterior). */
export async function demonstrativosProntos(empresaId: string, agora: Date): Promise<ItemNotificacao[]> {
  const db = getDb();
  const anos = [...new Set([Number(desdeDaJanela(agora).slice(0, 4)), agora.getUTCFullYear()])];
  const { data: exs, error } = await db.from('exercicios').select('id, ano').eq('empresa_id', empresaId).in('ano', anos);
  if (error) throw Object.assign(new Error(`exercicios: ${error.message}`), { code: error.code });
  const itens: ItemNotificacao[] = [];
  for (const ex of exs ?? []) {
    const { data, error: e2 } = await db.from('meses_confirmados').select('mes, confirmado_em').eq('exercicio_id', ex.id);
    if (e2) throw Object.assign(new Error(`meses_confirmados: ${e2.message}`), { code: e2.code });
    itens.push(...avisosDemonstrativo(Number(ex.ano), (data ?? []).map((m) => ({ mes: Number(m.mes), confirmadoEm: String(m.confirmado_em) }))));
  }
  return itens;
}

/** Resumos do ponto fechados à espera do aceite do cliente (0034; sem a tabela, nada). */
export async function aceitesPendentes(escritorioId: string, empresaId: string, agora: Date = new Date()): Promise<ItemNotificacao[]> {
  const meses = await fechamentosParaCliente(escritorioId, empresaId, desdeTrezeMeses(hojeBelem(agora)));
  return avisosAceitePonto(meses.map((m) => ({ ano: m.ano, mes: m.mes, fechadoEm: m.fechadoEm, situacao: m.situacao })));
}

export interface EntradaAvisosCliente {
  escritorioId: string;
  empresaId: string;
  email: string;
  /** Só vale sem a 0027: "visto até" que o navegador lembra. */
  vistoNoNavegador?: string | null;
}

/** Monta o sino do cliente. Cada fonte falha sozinha (vira `indisponiveis`). */
export async function lerAvisosCliente(e: EntradaAvisosCliente, agora: Date = new Date()): Promise<RespostaSino> {
  const indisponiveis: string[] = [];
  const isolada = async (rotulo: string, f: () => Promise<ItemNotificacao[]>): Promise<ItemNotificacao[]> => {
    try { return await f(); } catch (err) {
      indisponiveis.push(rotulo);
      console.error(`[avisos-cliente] ${rotulo}:`, (err as { code?: string })?.code ?? '', err instanceof Error ? err.message.slice(0, 100) : '');
      return [];
    }
  };
  const [{ leitura: lida, persistido }, folhas, pedidos, demos, aceites, entregas, devolvidos] = await Promise.all([
    lerLeitura(e.escritorioId, usuarioLeituraCliente(e.empresaId, e.email)),
    isolada('folhas de ponto', () => folhasDevolvidas(e.escritorioId, e.empresaId, agora)),
    isolada('pedidos de documento', () => pedidosNovos(e.escritorioId, e.empresaId, agora)),
    isolada('demonstrativo', () => demonstrativosProntos(e.empresaId, agora)),
    isolada('resumo do ponto', () => aceitesPendentes(e.escritorioId, e.empresaId, agora)),
    isolada('documentos da contabilidade', () => entregasNovas(e.escritorioId, e.empresaId, agora)),
    isolada('documentos devolvidos', () => documentosDevolvidos(e.escritorioId, e.empresaId)),
  ]);
  const leitura: Leitura = persistido ? lida : { lidasAte: e.vistoNoNavegador ?? null, lidas: [] };
  return {
    ...montarNotificacoes([...folhas, ...pedidos, ...demos, ...aceites, ...entregas, ...devolvidos], leitura, agora), persistido, indisponiveis,
  };
}
