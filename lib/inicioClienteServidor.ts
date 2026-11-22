// Início do cliente — leituras do banco (só de servidor). Regras em lib/inicioCliente.ts.
// SOMENTE LEITURA: não cria exercício nem grava nada. A autorização é da rota
// (exigirEmpresa); cada função recebe a empresa e o escritório já validados.
import { lancamentosDoMes, mesesConfirmados } from './caixa';
import { liberadoAte } from './demonstrativo';
import { getDb } from './db';
import { devolvidosSemReenvio } from './documentos';
import { listarDocumentos, listarPendencias } from './documentosServidor';
import { listarEntregasOuNada } from './entregasServidor';
import { listarEnvios } from './envioPontoServidor';
import type {
  DemonstrativoDisponivel, DevolvidoInicio, EntregaInicio, FolhaDevolvida, MesDoMovimento, PendenciaAberta,
} from './inicioCliente';

async function exercicioExistente(empresaId: string, ano: number): Promise<string | null> {
  const { data, error } = await getDb().from('exercicios').select('id').eq('empresa_id', empresaId).eq('ano', ano).maybeSingle();
  if (error) throw new Error(`exercicios: ${error.message}`);
  return data ? String(data.id) : null;
}

/** Lançamentos e confirmação dos meses pedidos (sem exercício = sem lançamentos). */
export async function lerMovimento(empresaId: string, meses: { ano: number; mes: number }[]): Promise<MesDoMovimento[]> {
  const porAno = new Map<number, string | null>();
  for (const { ano } of meses) if (!porAno.has(ano)) porAno.set(ano, await exercicioExistente(empresaId, ano));
  const confirmadosPorAno = new Map<number, number[]>();
  for (const [ano, id] of porAno) confirmadosPorAno.set(ano, id ? await mesesConfirmados(id) : []);
  return Promise.all(meses.map(async ({ ano, mes }) => {
    const id = porAno.get(ano);
    const lancs = id ? await lancamentosDoMes(id, mes) : [];
    return { ano, mes, lancamentos: lancs.length, confirmado: (confirmadosPorAno.get(ano) ?? []).includes(mes) };
  }));
}

export async function lerPendenciasAbertas(empresaId: string, escritorioId: string | null): Promise<PendenciaAberta[]> {
  const todas = await listarPendencias({ empresaId, escritorioId });
  return todas.filter((p) => p.status === 'aberta').map((p) => ({ id: p.id, titulo: p.titulo, prazo: p.prazo ? p.prazo.slice(0, 10) : null }));
}

/** Documentos da contabilidade ainda não abertos pelo cliente (0032; sem a migração, nenhum). */
export async function lerEntregasNaoAbertas(empresaId: string, escritorioId: string | null): Promise<EntregaInicio[]> {
  return (await listarEntregasOuNada({ empresaId, escritorioId })).filter((e) => !e.abertoEm).map((e) => ({
    id: e.id, tipo: e.tipo, titulo: e.titulo, competencia: e.competencia, vencimento: e.vencimento,
    publicadoEm: e.publicadoEm, abertoEm: e.abertoEm,
  }));
}

/** Documentos do cliente devolvidos pela contabilidade e ainda não reenviados (0032). */
export async function lerDocumentosDevolvidos(empresaId: string, escritorioId: string | null): Promise<DevolvidoInicio[]> {
  return devolvidosSemReenvio(await listarDocumentos({ empresaId, escritorioId })).map((d) => ({
    id: d.id, nome: d.nome, categoria: d.categoria, competencia: d.competencia, motivo: d.motivoDevolucao,
  }));
}

/** Folhas devolvidas e ainda não reenviadas para o mesmo funcionário e mês. */
export async function lerFolhasDevolvidas(empresaId: string, escritorioId: string | null): Promise<FolhaDevolvida[]> {
  const envios = await listarEnvios(escritorioId, empresaId);
  const chave = (e: { funcionario: string; ano: number; mes: number }) => `${e.funcionario.toLowerCase()}|${e.ano}|${e.mes}`;
  const reenviadas = new Set(envios.filter((e) => e.situacao !== 'devolvida' && e.situacao !== 'rejeitada').map(chave));
  return envios
    .filter((e) => e.situacao === 'devolvida' && !reenviadas.has(chave(e)))
    .map((e) => ({ id: e.id, funcionario: e.funcionario, ano: e.ano, mes: e.mes, motivo: e.motivo }));
}

/** O mês mais recente liberado (confirmado em sequência desde janeiro): no ano corrente e, se não houver, no anterior. */
export async function lerUltimoDemonstrativo(empresaId: string, hoje: string): Promise<DemonstrativoDisponivel | null> {
  const ano = Number(hoje.slice(0, 4));
  for (const a of [ano, ano - 1]) {
    const id = await exercicioExistente(empresaId, a);
    if (!id) continue;
    const ate = liberadoAte(await mesesConfirmados(id));
    if (ate > 0) return { ano: a, mes: ate };
  }
  return null;
}
