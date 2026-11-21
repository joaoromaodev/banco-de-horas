// Folha de ponto enviada pelo cliente — banco (`ponto_envios`, 0028), Storage
// (bucket privado `ponto`) e a leitura pela IA em fila.
//
// Só de servidor (secret key). Quem PODE é decidido nas rotas (lib/acesso.ts,
// lib/pontoAcesso.ts e as regras de lib/envioPonto.ts); aqui toda leitura de
// lista também filtra pelo escritório (defesa em profundidade).
//
// A "fila" não tem worker: a Vercel só roda código dentro de uma requisição. A
// leitura começa logo depois do envio (`after()` na rota que confirma) e, se
// esperou (cota, ritmo, função morta), é retomada sempre que alguém da empresa
// ou da contabilidade abre a lista (`processarFila`, também com `after()`).
import { randomUUID } from 'crypto';
import { getDb, lerTudo } from './db';
import { extrairFolha } from './ocr';
import { getGeminiApiKey, getGeminiModelo } from './config';
import { avaliarCota, competenciaBelem, excedeuRitmo, RESERVA_VALIDA_MIN } from './cotaOcr';
import { lerEscritorio } from './escritorios';
import {
  cancelarLeituraOcr, confirmarLeituraOcr, contarLeiturasOcr, contarTentativasRecentes, falharLeituraOcr,
  lerFrequenciasDoMes, reservarLeituraOcr, salvarFrequencia,
} from './pontoDb';
import {
  caminhoFoto, chaveNome, DESFAZER_APLICACAO_H, fotoValida, LEITURA_PRESA_MIN, limiteLeiturasAutomaticas,
  MAX_TENTATIVAS_AUTO, type MotivoEspera, normalizarRascunho, type Rascunho, RETENCAO_FOTO_DIAS, RETENCAO_ORFA_DIAS,
  situacaoAoReabrir, type SituacaoEnvio, type TipoFoto,
} from './envioPonto';
import { extensao, uuidValido } from './documentos';
import type { DiaFreq } from './tipos';
import { notificarEnvioPonto } from './envioPontoEventos';

export const BUCKET_PONTO = 'ponto';
/** Validade da URL da foto: só o tempo de a imagem carregar. */
export const VALIDADE_FOTO_S = 60;

export class ErroEnvio extends Error {
  constructor(msg: string, readonly status = 400) {
    super(msg);
  }
}

export const MENSAGEM_SEM_0028 = 'O envio de folhas pelo cliente está aguardando a atualização do banco de dados (migração 0028).';

interface ErroPg { code?: string; message?: string }

function traduzir(e: ErroPg | null): never {
  if (e?.code === '42P01' || e?.code === 'PGRST205') {
    throw new ErroEnvio(MENSAGEM_SEM_0028, 503);
  }
  // Mensagem do banco não vai para a tela (pode citar coluna/valor).
  console.error('[envio-ponto] banco:', e?.code ?? '', (e?.message ?? '').slice(0, 160));
  throw new ErroEnvio('Falha ao acessar o banco.', 502);
}

// ------------------------------------------------------------------ tipos

export interface Envio {
  id: string;
  escritorioId: string;
  empresaId: string;
  funcionario: string;
  empregadoId: string | null;
  ano: number;
  mes: number;
  caminho: string;
  tipo: string;
  tamanho: number;
  situacao: SituacaoEnvio;
  aguardando: MotivoEspera | null;
  rascunho: Rascunho | null;
  tentativas: number;
  lendoDesde: string | null;
  lidoEm: string | null;
  motivo: string | null;
  devolvidoPor: string | null;
  devolvidoEm: string | null;
  aplicadoPor: string | null;
  aplicadoEm: string | null;
  frequenciaAnterior: DiaFreq[] | null;
  enviadoPor: string;
  enviadoEm: string;
  excluidoEm: string | null;
  excluidoPorGestor: boolean;
  fotoApagadaEm: string | null;
}

const COLS = 'id, escritorio_id, empresa_id, funcionario, empregado_id, ano, mes, caminho, tipo, tamanho, situacao, aguardando, rascunho, tentativas, lendo_desde, lido_em, motivo, devolvido_por, devolvido_em, aplicado_por, aplicado_em, frequencia_anterior, enviado_por, enviado_em, excluido_em, excluido_por_gestor, foto_apagada_em';

/* eslint-disable @typescript-eslint/no-explicit-any -- linhas cruas do PostgREST */
const deLinha = (l: any): Envio => ({
  id: String(l.id), escritorioId: String(l.escritorio_id), empresaId: String(l.empresa_id),
  funcionario: String(l.funcionario ?? ''), empregadoId: l.empregado_id ?? null,
  ano: Number(l.ano), mes: Number(l.mes), caminho: String(l.caminho), tipo: String(l.tipo), tamanho: Number(l.tamanho),
  situacao: l.situacao, aguardando: l.aguardando ?? null,
  rascunho: l.rascunho ? normalizarRascunho(l.rascunho) : null,
  tentativas: Number(l.tentativas ?? 0), lendoDesde: l.lendo_desde ?? null, lidoEm: l.lido_em ?? null,
  motivo: l.motivo ?? null, devolvidoPor: l.devolvido_por ?? null, devolvidoEm: l.devolvido_em ?? null,
  aplicadoPor: l.aplicado_por ?? null, aplicadoEm: l.aplicado_em ?? null,
  frequenciaAnterior: Array.isArray(l.frequencia_anterior) ? normalizarRascunho({ dias: l.frequencia_anterior }).dias : null,
  enviadoPor: String(l.enviado_por ?? ''), enviadoEm: String(l.enviado_em ?? ''),
  excluidoEm: l.excluido_em ?? null, excluidoPorGestor: Boolean(l.excluido_por_gestor),
  fotoApagadaEm: l.foto_apagada_em ?? null,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * O que vai para a tela. Nunca o caminho do Storage nem a frequência anterior.
 * Para o cliente, também não o rascunho da IA nem e-mails da equipe (minimização:
 * a tela dele mostra só a situação e o motivo da devolução).
 */
export function envioPublico(e: Envio, gestor: boolean) {
  const base = {
    id: e.id, empresaId: e.empresaId, funcionario: e.funcionario, ano: e.ano, mes: e.mes,
    situacao: e.situacao, motivo: e.motivo, enviadoEm: e.enviadoEm, devolvidoEm: e.devolvidoEm,
    aplicadoEm: e.aplicadoEm, temFoto: !e.fotoApagadaEm, tipo: e.tipo,
  };
  if (!gestor) return { ...base, minha: true };
  return {
    ...base, empregadoId: e.empregadoId, aguardando: e.aguardando, rascunho: e.rascunho, tentativas: e.tentativas,
    lidoEm: e.lidoEm, enviadoPor: e.enviadoPor, devolvidoPor: e.devolvidoPor, aplicadoPor: e.aplicadoPor,
  };
}

// ------------------------------------------------------------------ leitura

/** Envios da empresa (não excluídos), mais recentes primeiro. `escritorioId` null = master. */
export async function listarEnvios(escritorioId: string | null, empresaId: string, filtro: { desde?: { ano: number; mes: number } } = {}): Promise<Envio[]> {
  let q = getDb().from('ponto_envios').select(COLS).eq('empresa_id', empresaId).is('excluido_em', null)
    .neq('situacao', 'enviando');
  if (escritorioId) q = q.eq('escritorio_id', escritorioId);
  if (filtro.desde) q = q.or(`ano.gt.${filtro.desde.ano},and(ano.eq.${filtro.desde.ano},mes.gte.${filtro.desde.mes})`);
  const { data, error } = await q.order('enviado_em', { ascending: false }).limit(300);
  if (error) traduzir(error);
  return (data ?? []).map(deLinha);
}

/** Um envio pelo id (inclusive excluído, para o desfazer). A rota decide o acesso. */
export async function lerEnvio(id: string): Promise<Envio | null> {
  if (!uuidValido(id)) return null;
  const { data, error } = await getDb().from('ponto_envios').select(COLS).eq('id', id).maybeSingle();
  if (error) traduzir(error);
  return data ? deLinha(data) : null;
}

/** Envios iniciados pela empresa na última hora (inclui recusados e abandonados). */
export async function enviosNaUltimaHora(empresaId: string): Promise<number> {
  const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await getDb().from('ponto_envios').select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId).gte('enviado_em', desde);
  if (error) traduzir(error);
  if (count === null) throw new ErroEnvio(MENSAGEM_SEM_0028, 503);
  return count;
}

export interface FuncionarioDoEnvio { nome: string; empregadoId: string | null }

/**
 * Quem o cliente pode escolher: o cadastro do ponto da empresa + os empregados
 * do DP que não foram desligados, sem repetir nome. Só o nome sai daqui (o DP
 * guarda CPF e salário, que o cliente não precisa ver). DP ausente: só o ponto.
 */
export async function funcionariosParaEnvio(escritorioId: string, empresaId: string): Promise<FuncionarioDoEnvio[]> {
  const db = getDb();
  const porNome = new Map<string, FuncionarioDoEnvio>();
  const ponto = await lerTudo<{ nome: string }>((de, ate) => db.from('ponto_funcionarios').select('nome')
    .eq('escritorio_id', escritorioId).eq('empresa_id', empresaId).order('nome').range(de, ate),
  { falhar: (e) => traduzir(e) });
  for (const f of ponto) {
    const nome = String(f.nome ?? '').trim();
    if (nome) porNome.set(chaveNome(nome), { nome, empregadoId: null });
  }
  try {
    const { data, error } = await db.from('dp_empregados').select('id, nome, situacao')
      .eq('escritorio_id', escritorioId).eq('empresa_id', empresaId).neq('situacao', 'desligado').limit(1000);
    if (!error) {
      for (const e of data ?? []) {
        const nome = String(e.nome ?? '').trim();
        if (!nome) continue;
        const k = chaveNome(nome);
        const atual = porNome.get(k);
        porNome.set(k, { nome: atual?.nome ?? nome, empregadoId: String(e.id) });
      }
    }
  } catch { /* DP indisponível: fica a lista do ponto */ }
  return [...porNome.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// ------------------------------------------------------------------ envio

export interface NovoEnvio {
  escritorioId: string;
  empresaId: string;
  funcionario: string;
  empregadoId: string | null;
  ano: number;
  mes: number;
  tamanho: number;
  tipo: TipoFoto;
  autor: string;
}

/**
 * Passo 1: grava a linha em `enviando` e devolve uma URL de upload assinada para
 * o caminho escolhido AQUI. A foto vai direto do navegador ao Storage (não passa
 * pelo limite de corpo da função).
 */
export async function iniciarEnvio(n: NovoEnvio): Promise<{ id: string; url: string; mime: string }> {
  const id = randomUUID();
  const caminho = caminhoFoto(n.escritorioId, id, n.tipo.ext);
  const db = getDb();
  const { error } = await db.from('ponto_envios').insert({
    id, escritorio_id: n.escritorioId, empresa_id: n.empresaId, funcionario: n.funcionario,
    empregado_id: n.empregadoId, ano: n.ano, mes: n.mes, caminho, tipo: n.tipo.mime, tamanho: n.tamanho,
    situacao: 'enviando', enviado_por: n.autor,
  });
  if (error) traduzir(error);
  const { data, error: eUp } = await db.storage.from(BUCKET_PONTO).createSignedUploadUrl(caminho);
  if (eUp || !data) {
    await db.from('ponto_envios').update({ situacao: 'rejeitada' }).eq('id', id);
    console.error('[envio-ponto] falha ao assinar upload:', eUp?.message);
    throw new ErroEnvio('Não foi possível preparar o envio. Tente de novo.', 502);
  }
  return { id, url: data.signedUrl, mime: n.tipo.mime };
}

/**
 * Passo 2: o navegador avisa que terminou. O servidor baixa a foto e confere
 * tamanho e assinatura dos bytes; se não for imagem, apaga e marca `rejeitada`
 * (a linha fica: conta no limite por hora e guia a faxina).
 */
export async function confirmarEnvio(e: Envio): Promise<Envio> {
  if (e.situacao === 'rejeitada') throw new ErroEnvio('Esta foto foi recusada. Envie de novo.', 409);
  if (e.situacao !== 'enviando') return e; // idempotente
  const db = getDb();
  const { data: blob, error } = await db.storage.from(BUCKET_PONTO).download(e.caminho);
  if (error || !blob) throw new ErroEnvio('A foto ainda não chegou. Tente enviar de novo.', 409);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (!fotoValida(bytes, extensao(e.caminho))) {
    await db.storage.from(BUCKET_PONTO).remove([e.caminho]).catch(() => {});
    await db.from('ponto_envios').update({ situacao: 'rejeitada', foto_apagada_em: new Date().toISOString() })
      .eq('id', e.id).eq('situacao', 'enviando');
    throw new ErroEnvio('O arquivo não é uma foto válida. Tire outra foto e envie de novo.', 422);
  }
  const { data, error: eUp } = await db.from('ponto_envios')
    .update({ situacao: 'recebida', tamanho: bytes.length, enviado_em: new Date().toISOString() })
    .eq('id', e.id).eq('situacao', 'enviando').select(COLS).maybeSingle();
  if (eUp) traduzir(eUp);
  const r = data ? deLinha(data) : { ...e, situacao: 'recebida' as const };
  notificarEnvioPonto({ tipo: 'recebida', envioId: r.id, escritorioId: r.escritorioId, empresaId: r.empresaId, ano: r.ano, mes: r.mes });
  return r;
}

/** URL curta para a tela mostrar a foto (inline: o conteúdo já foi conferido como imagem). */
export async function urlFoto(e: Envio): Promise<string> {
  if (e.fotoApagadaEm) throw new ErroEnvio('A foto deste envio já foi apagada (prazo de guarda).', 410);
  const { data, error } = await getDb().storage.from(BUCKET_PONTO).createSignedUrl(e.caminho, VALIDADE_FOTO_S);
  if (error || !data) {
    console.error('[envio-ponto] falha ao assinar a foto:', error?.message);
    throw new ErroEnvio('Foto indisponível.', 404);
  }
  return data.signedUrl;
}

// ------------------------------------------------------------------ leitura pela IA

export type Origem = 'auto' | 'contadora';

/** Leituras automáticas (disparadas por envio de cliente) da empresa no mês da cota. */
async function leiturasAutomaticasDaEmpresa(escritorioId: string, empresaId: string, competencia: string): Promise<number> {
  const desde = new Date(Date.now() - RESERVA_VALIDA_MIN * 60_000).toISOString();
  const { count, error } = await getDb().from('ponto_leituras_ocr').select('id', { count: 'exact', head: true })
    .eq('escritorio_id', escritorioId).eq('competencia', competencia).eq('empresa_id', empresaId)
    .like('usuario', 'cliente:%')
    .or(`situacao.eq.concluida,and(situacao.eq.reservada,criado_em.gte.${desde})`);
  if (error) traduzir(error);
  return count ?? 0;
}

async function contarFuncionarios(escritorioId: string, empresaId: string): Promise<number> {
  try { return (await funcionariosParaEnvio(escritorioId, empresaId)).length; } catch { return 0; }
}

/** Devolve o envio à fila com o motivo da espera. */
async function esperar(id: string, motivo: MotivoEspera) {
  await getDb().from('ponto_envios').update({ situacao: 'recebida', aguardando: motivo, lendo_desde: null })
    .eq('id', id).eq('situacao', 'lendo');
}

export type ResultadoLeitura = 'lida' | 'falhou' | 'esperando' | 'ocupada';

/**
 * Lê UMA foto pela IA e guarda o rascunho. Fluxo igual ao de /api/extrair:
 * reivindica o envio (só um processo lê de cada vez) → cota, ritmo e, se for
 * automática, o teto da empresa → reserva na cota e reconta → Gemini → `lida`
 * (conta) ou `falhou` (não conta). NUNCA grava na frequência.
 */
export async function lerEnvioPelaIa(envioId: string, origem: Origem, usuario: string): Promise<ResultadoLeitura> {
  const db = getDb();
  const agora = new Date();
  const presa = new Date(agora.getTime() - LEITURA_PRESA_MIN * 60_000).toISOString();
  // 1. Reivindica: recebida/falhou, ou "lendo" largada por uma função que morreu.
  let claim = db.from('ponto_envios')
    .update({ situacao: 'lendo', lendo_desde: agora.toISOString(), aguardando: null })
    .eq('id', envioId).is('excluido_em', null)
    .or(`situacao.in.(recebida,falhou),and(situacao.eq.lendo,lendo_desde.lt.${presa})`);
  if (origem === 'auto') claim = claim.lt('tentativas', MAX_TENTATIVAS_AUTO);
  const { data: linha, error } = await claim.select(COLS).maybeSingle();
  if (error) traduzir(error);
  if (!linha) return 'ocupada';
  const e = deLinha(linha);

  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    console.error('[envio-ponto] GEMINI_API_KEY não configurada.');
    await esperar(e.id, 'sem_ia');
    return 'esperando';
  }

  // 2. Cota do escritório, ritmo e (automática) o teto da empresa.
  const competencia = competenciaBelem(agora);
  let reserva: string;
  try {
    const escritorio = await lerEscritorio(e.escritorioId);
    const quem = { plano: escritorio?.plano, situacao: escritorio?.situacao };
    const antes = avaliarCota({ ...quem, usadas: await contarLeiturasOcr(e.escritorioId, competencia) });
    if (!antes.permitido) { await esperar(e.id, 'cota'); return 'esperando'; }
    if (excedeuRitmo(await contarTentativasRecentes(e.escritorioId))) { await esperar(e.id, 'ritmo'); return 'esperando'; }
    if (origem === 'auto') {
      const teto = limiteLeiturasAutomaticas(await contarFuncionarios(e.escritorioId, e.empresaId));
      if ((await leiturasAutomaticasDaEmpresa(e.escritorioId, e.empresaId, competencia)) >= teto) {
        await esperar(e.id, 'limite_empresa');
        return 'esperando';
      }
    }
    reserva = await reservarLeituraOcr({
      escritorioId: e.escritorioId, competencia, empresaId: e.empresaId,
      // Prefixo "cliente:" = leitura automática; é por ele que o teto da empresa conta.
      usuario: origem === 'auto' ? `cliente:${e.enviadoPor}` : usuario,
    });
    if ((await contarLeiturasOcr(e.escritorioId, competencia)) > antes.limite) {
      await cancelarLeituraOcr(reserva).catch(() => {});
      await esperar(e.id, 'cota');
      return 'esperando';
    }
  } catch (err) {
    console.error('[envio-ponto] cota:', err instanceof Error ? err.message : err);
    await esperar(e.id, 'ritmo').catch(() => {});
    return 'esperando';
  }

  // 3. Leitura. A tentativa conta só agora (esperar na fila não gasta tentativa).
  await db.from('ponto_envios').update({ tentativas: e.tentativas + 1 }).eq('id', e.id);
  try {
    const { data: blob, error: eDown } = await db.storage.from(BUCKET_PONTO).download(e.caminho);
    if (eDown || !blob) throw new Error(`foto indisponível: ${eDown?.message ?? ''}`);
    const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64');
    const r = await extrairFolha({
      apiKey, imagemBase64: base64, mimeType: e.tipo, ano: e.ano, mes: e.mes,
      empresa: e.empresaId, funcionario: e.funcionario, modelo: getGeminiModelo(),
    });
    const rascunho = normalizarRascunho({ dias: r.frequencia.dias, incertos: r.incertos, funcionarioLido: r.frequencia.funcionario || null });
    const { error: eUp } = await db.from('ponto_envios').update({
      situacao: 'lida', rascunho, leitura_id: reserva, lido_em: new Date().toISOString(), lendo_desde: null, aguardando: null,
    }).eq('id', e.id).eq('situacao', 'lendo');
    if (eUp) throw new Error(eUp.message);
    await confirmarLeituraOcr(reserva).catch((x) => console.error('[envio-ponto] confirmar leitura', x));
    notificarEnvioPonto({ tipo: 'lida', envioId: e.id, escritorioId: e.escritorioId, empresaId: e.empresaId, ano: e.ano, mes: e.mes });
    return 'lida';
  } catch (err) {
    await falharLeituraOcr(reserva).catch(() => {});
    // Sem a mensagem crua da IA na tela; no log, sem o conteúdo da folha.
    console.error('[envio-ponto] leitura falhou:', err instanceof Error ? err.message.slice(0, 160) : 'erro');
    await db.from('ponto_envios').update({ situacao: 'falhou', lendo_desde: null })
      .eq('id', e.id).eq('situacao', 'lendo');
    notificarEnvioPonto({ tipo: 'falhou', envioId: e.id, escritorioId: e.escritorioId, empresaId: e.empresaId, ano: e.ano, mes: e.mes });
    return 'falhou';
  }
}

/**
 * Retoma a fila de uma empresa: fotos recebidas (que não esperam a contadora),
 * falhas com tentativa automática sobrando e leituras presas. Poucas por vez —
 * roda depois da resposta, dentro do tempo da função.
 */
export async function processarFila(escritorioId: string, empresaId: string, limite = 2): Promise<number> {
  const presa = new Date(Date.now() - LEITURA_PRESA_MIN * 60_000).toISOString();
  const { data, error } = await getDb().from('ponto_envios').select('id, situacao, aguardando')
    .eq('escritorio_id', escritorioId).eq('empresa_id', empresaId).is('excluido_em', null)
    .lt('tentativas', MAX_TENTATIVAS_AUTO)
    .or(`situacao.in.(recebida,falhou),and(situacao.eq.lendo,lendo_desde.lt.${presa})`)
    .order('enviado_em', { ascending: true }).limit(10);
  if (error) traduzir(error);
  let lidas = 0;
  for (const l of (data ?? []).filter((x) => x.aguardando !== 'limite_empresa').slice(0, limite)) {
    const r = await lerEnvioPelaIa(String(l.id), 'auto', 'fila');
    if (r === 'lida') lidas++;
    // Cota/ritmo/IA fora: as próximas também esperariam; para por aqui.
    if (r === 'esperando') break;
  }
  return lidas;
}

// ------------------------------------------------------------------ conferência

/**
 * Aplica o rascunho conferido à frequência do funcionário no mês. Primeiro
 * reivindica o envio (não aplica duas vezes) guardando os dias que havia — o
 * "desfazer" volta para eles; se gravar a frequência falhar, devolve o envio.
 */
export async function aplicarEnvio(e: Envio, funcionario: string, dias: DiaFreq[], autor: string): Promise<{ dias: number; anteriores: number }> {
  const db = getDb();
  const atual = (await lerFrequenciasDoMes(e.escritorioId, e.empresaId, e.ano, e.mes))
    .find((f) => f.funcionario === funcionario);
  const anteriores = atual?.dias ?? [];
  const { data, error } = await db.from('ponto_envios').update({
    situacao: 'aplicada', aplicado_por: autor, aplicado_em: new Date().toISOString(), funcionario,
    frequencia_anterior: anteriores, aguardando: null,
  }).eq('id', e.id).is('excluido_em', null).in('situacao', ['recebida', 'lida', 'falhou']).select('id').maybeSingle();
  if (error) traduzir(error);
  if (!data) throw new ErroEnvio('Esta folha já foi aplicada, devolvida ou está sendo lida. Atualize a lista.', 409);
  try {
    const n = await salvarFrequencia(e.escritorioId, { empresa: e.empresaId, funcionario, ano: e.ano, mes: e.mes, dias }, autor);
    notificarEnvioPonto({ tipo: 'aplicada', envioId: e.id, escritorioId: e.escritorioId, empresaId: e.empresaId, ano: e.ano, mes: e.mes });
    return { dias: n, anteriores: anteriores.length };
  } catch (err) {
    await db.from('ponto_envios').update({
      situacao: situacaoAoReabrir(e), aplicado_por: null, aplicado_em: null, frequencia_anterior: null, funcionario: e.funcionario,
    }).eq('id', e.id).eq('situacao', 'aplicada');
    throw err;
  }
}

/** Desfaz a aplicação: a frequência volta aos dias de antes e o envio volta à conferência. */
export async function desfazerAplicacao(e: Envio): Promise<void> {
  if (e.situacao !== 'aplicada') throw new ErroEnvio('Esta folha não está aplicada.', 409);
  const limite = Date.now() - DESFAZER_APLICACAO_H * 3_600_000;
  if (!e.aplicadoEm || Date.parse(e.aplicadoEm) < limite) {
    throw new ErroEnvio('Já passou o prazo para desfazer. Abra a folha salva e corrija os dias.', 409);
  }
  const { data, error } = await getDb().from('ponto_envios').update({
    situacao: situacaoAoReabrir(e), aplicado_por: null, aplicado_em: null, frequencia_anterior: null,
  }).eq('id', e.id).eq('situacao', 'aplicada').select('id').maybeSingle();
  if (error) traduzir(error);
  if (!data) throw new ErroEnvio('Esta folha não está mais aplicada.', 409);
  await salvarFrequencia(e.escritorioId, {
    empresa: e.empresaId, funcionario: e.funcionario, ano: e.ano, mes: e.mes, dias: e.frequenciaAnterior ?? [],
  }, 'desfazer-envio');
}

/** Devolve ao cliente com motivo (ele vê e pode reenviar). */
export async function devolverEnvio(e: Envio, motivo: string, autor: string): Promise<void> {
  const { data, error } = await getDb().from('ponto_envios').update({
    situacao: 'devolvida', motivo, devolvido_por: autor, devolvido_em: new Date().toISOString(), aguardando: null,
  }).eq('id', e.id).is('excluido_em', null).in('situacao', ['recebida', 'lida', 'falhou']).select('id').maybeSingle();
  if (error) traduzir(error);
  if (!data) throw new ErroEnvio('Esta folha já foi aplicada, devolvida ou está sendo lida. Atualize a lista.', 409);
  notificarEnvioPonto({ tipo: 'devolvida', envioId: e.id, escritorioId: e.escritorioId, empresaId: e.empresaId, ano: e.ano, mes: e.mes });
}

export async function desfazerDevolucao(e: Envio): Promise<void> {
  const { data, error } = await getDb().from('ponto_envios').update({
    situacao: situacaoAoReabrir(e), motivo: null, devolvido_por: null, devolvido_em: null,
  }).eq('id', e.id).eq('situacao', 'devolvida').select('id').maybeSingle();
  if (error) traduzir(error);
  if (!data) throw new ErroEnvio('Esta folha não está devolvida.', 409);
}

/** Exclusão lógica (a foto fica até a faxina; o "desfazer" traz de volta). */
export async function excluirEnvio(e: Envio, autor: string, porGestor: boolean): Promise<void> {
  const { error } = await getDb().from('ponto_envios')
    .update({ excluido_em: new Date().toISOString(), excluido_por: autor, excluido_por_gestor: porGestor })
    .eq('id', e.id).is('excluido_em', null).not('situacao', 'in', '(aplicada,lendo)');
  if (error) traduzir(error);
}

export async function restaurarEnvio(e: Envio): Promise<void> {
  const { error } = await getDb().from('ponto_envios')
    .update({ excluido_em: null, excluido_por: null, excluido_por_gestor: false }).eq('id', e.id);
  if (error) traduzir(error);
}

// ------------------------------------------------------------------ retenção

/**
 * Faxina das fotos (LGPD): apaga do Storage a foto de envio terminado (aplicado,
 * devolvido ou excluído) há mais de 90 dias e a de envio recusado ou abandonado
 * há mais de 1 dia. A linha fica (histórico e rascunho), com `foto_apagada_em`.
 * Chamada pelo cron diário.
 */
export async function expurgarFotos(agora = new Date(), lote = 200): Promise<{ apagadas: number }> {
  const db = getDb();
  const velho = new Date(agora.getTime() - RETENCAO_FOTO_DIAS * 86_400_000).toISOString();
  const orfao = new Date(agora.getTime() - RETENCAO_ORFA_DIAS * 86_400_000).toISOString();
  const { data, error } = await db.from('ponto_envios').select('id, caminho').is('foto_apagada_em', null)
    .or([
      `and(situacao.in.(enviando,rejeitada),enviado_em.lt.${orfao})`,
      `and(situacao.eq.aplicada,aplicado_em.lt.${velho})`,
      `and(situacao.eq.devolvida,devolvido_em.lt.${velho})`,
      `excluido_em.lt.${velho}`,
    ].join(','))
    .limit(lote);
  if (error) traduzir(error);
  const linhas = data ?? [];
  if (!linhas.length) return { apagadas: 0 };
  const { error: eRm } = await db.storage.from(BUCKET_PONTO).remove(linhas.map((l) => String(l.caminho)));
  if (eRm) {
    console.error('[envio-ponto] faxina: falha ao remover do Storage:', eRm.message);
    return { apagadas: 0 };
  }
  const { error: eUp } = await db.from('ponto_envios').update({ foto_apagada_em: agora.toISOString() })
    .in('id', linhas.map((l) => String(l.id)));
  if (eUp) traduzir(eUp);
  return { apagadas: linhas.length };
}
