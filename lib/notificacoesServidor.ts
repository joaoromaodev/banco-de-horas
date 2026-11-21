// Notificações dentro do app — parte de servidor (migração 0027 + leituras do que já
// existe). As regras de montagem estão em lib/notificacoes.ts. Sem a 0027 o sino segue
// só com o que é derivado e sem "lidas" persistentes (`persistido: false`).
//
// Quem publica um evento (outra frente) chama `registrarNotificacao()`: nunca lança,
// nunca derruba quem chamou, e é idempotente pela `chave`.
import { emLotes, getDb, lerAteTeto } from './db';
import { conferirEmpresas } from './conferenciaModulosServidor';
import {
  desdeDaJanela, EPOCA, hrefInterno, montarNotificacoes, notifCaixa, notifConferencia, notifDocumentos, notifEventos,
  notifPendencias, type ItemNotificacao, type Leitura, type ListaNotificacoes, type RegistroNotificacao,
} from './notificacoes';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TETO = 2000;
const MAX_LIDAS = 200;
const MARCA_SEMEADO = 'conf|semeado';

const ausente = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === '42P01' || e.code === 'PGRST205' || /notificacoes/.test(e.message ?? ''));

// ------------------------------------------------------------------ publicar

export interface EventoNotificacao {
  escritorioId: string;
  empresaId?: string | null;
  /** Rótulo livre ("folha_ponto_cliente"…); só agrupa e documenta. */
  tipo: string;
  titulo: string;
  texto?: string | null;
  /** Caminho interno do app ("/ponto?empresa=…&ano=2026&mes=10"). Outra coisa é descartada. */
  href?: string | null;
  /** Idempotência: o mesmo evento publicado de novo não duplica (ex.: `folha|<id>`). */
  chave?: string | null;
}

/**
 * Publica um evento no sino de TODO o escritório. Devolve `true` se gravou (ou se já
 * existia pela `chave`); `false` se a 0027 ainda não foi aplicada ou deu erro — nunca
 * lança, porque notificar não pode derrubar quem notifica. Não ponha CPF, salário nem
 * outro dado pessoal no texto: ele aparece para a equipe inteira do escritório.
 */
export async function registrarNotificacao(n: EventoNotificacao): Promise<boolean> {
  try {
    const titulo = String(n.titulo ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!n.escritorioId || !titulo) return false;
    const { error } = await getDb().from('notificacoes').insert({
      escritorio_id: n.escritorioId, empresa_id: n.empresaId ?? null,
      tipo: String(n.tipo || 'evento').slice(0, 40), titulo,
      texto: n.texto ? String(n.texto).slice(0, 500) : null,
      href: n.href ? hrefInterno(n.href) : null,
      chave: n.chave ? String(n.chave).slice(0, 200) : null,
    });
    if (!error || error.code === '23505') return true;
    if (!ausente(error)) console.error('[notificacoes] registrar:', error.code ?? '', (error.message ?? '').slice(0, 100));
    return false;
  } catch (e) {
    console.error('[notificacoes] registrar:', e instanceof Error ? e.message.slice(0, 100) : 'falha');
    return false;
  }
}

// ------------------------------------------------------------------ leitura (por usuário)

/** Leitura da pessoa (`usuario` = e-mail na contabilidade; `cliente|empresa|e-mail` no cliente). */
export async function lerLeitura(escritorioId: string, usuario: string): Promise<{ leitura: Leitura; persistido: boolean }> {
  const db = getDb();
  const { data, error } = await db.from('notificacoes_leitura').select('lidas_ate, lidas')
    .eq('escritorio_id', escritorioId).eq('usuario', usuario).maybeSingle();
  if (error) {
    if (!ausente(error)) console.error('[notificacoes] leitura:', error.code ?? '');
    return { leitura: { lidasAte: null, lidas: [] }, persistido: false };
  }
  if (data) return { leitura: { lidasAte: String(data.lidas_ate), lidas: (data.lidas as string[]) ?? [] }, persistido: true };
  // Primeira visita: o sino começa limpo (nada do que já existia vira "novo").
  const agora = new Date().toISOString();
  const r = await db.from('notificacoes_leitura').upsert(
    { escritorio_id: escritorioId, usuario, lidas_ate: agora, lidas: [], atualizado_em: agora },
    { onConflict: 'escritorio_id,usuario', ignoreDuplicates: true });
  if (r.error && !ausente(r.error)) console.error('[notificacoes] primeira visita:', r.error.code ?? '');
  return { leitura: { lidasAte: null, lidas: [] }, persistido: !r.error };
}

/** Marca um item (`chave`) ou tudo (`chave` omitida) como lido. `false` = não foi possível persistir (sem a 0027). */
export async function marcarLidas(escritorioId: string, usuario: string, chave?: string): Promise<boolean> {
  const db = getDb();
  const agora = new Date().toISOString();
  let linha: Record<string, unknown>;
  if (chave) {
    const { data, error } = await db.from('notificacoes_leitura').select('lidas_ate, lidas')
      .eq('escritorio_id', escritorioId).eq('usuario', usuario).maybeSingle();
    if (error) return false;
    const lidas = [...((data?.lidas as string[]) ?? []).filter((c) => c !== chave), chave.slice(0, 200)].slice(-MAX_LIDAS);
    linha = { escritorio_id: escritorioId, usuario, lidas_ate: data?.lidas_ate ?? agora, lidas, atualizado_em: agora };
  } else {
    linha = { escritorio_id: escritorioId, usuario, lidas_ate: agora, lidas: [], atualizado_em: agora };
  }
  const { error } = await db.from('notificacoes_leitura').upsert(linha, { onConflict: 'escritorio_id,usuario' });
  if (error && !ausente(error)) console.error('[notificacoes] marcar:', error.code ?? '');
  return !error;
}

// ------------------------------------------------------------------ fontes derivadas

async function documentosNovos(escritorioId: string, ids: string[], desde: string) {
  const db = getDb();
  const partes = await emLotes(ids, async (lote) => (await lerAteTeto<any>((de, ate) => db.from('documentos')
    .select('id, empresa_id, enviado_em').eq('escritorio_id', escritorioId).in('empresa_id', lote)
    .eq('status', 'recebido').is('excluido_em', null).gte('enviado_em', desde)
    .order('id').range(de, ate), TETO)).linhas);
  return partes.map((l) => ({ empresaId: String(l.empresa_id), enviadoEm: new Date(l.enviado_em).toISOString() }));
}

async function pendenciasAtendidas(escritorioId: string, ids: string[], desde: string) {
  const db = getDb();
  const partes = await emLotes(ids, async (lote) => (await lerAteTeto<any>((de, ate) => db.from('pendencias')
    .select('id, empresa_id, titulo, atendida_em, atendida_por').eq('escritorio_id', escritorioId).in('empresa_id', lote)
    .eq('status', 'atendida').is('excluido_em', null).gte('atendida_em', desde)
    .order('id').range(de, ate), TETO)).linhas);
  return partes.filter((l) => l.atendida_em).map((l) => ({
    id: String(l.id), empresaId: String(l.empresa_id), titulo: String(l.titulo),
    atendidaEm: new Date(l.atendida_em).toISOString(), atendidaPor: (l.atendida_por as string | null) ?? null,
  }));
}

async function lancamentosNovos(ids: string[], desde: string) {
  const db = getDb();
  const partes = await emLotes(ids, async (lote) => (await lerAteTeto<any>((de, ate) => db.from('lancamentos')
    .select('id, criado_em, criado_por, exercicios!inner(empresa_id)')
    .is('conferido_em', null).gte('criado_em', desde).in('exercicios.empresa_id', lote)
    .order('criado_em', { ascending: false }).order('id').range(de, ate), TETO)).linhas);
  return partes.map((l) => {
    const ex = Array.isArray(l.exercicios) ? l.exercicios[0] : l.exercicios;
    return { empresaId: String(ex.empresa_id), criadoEm: new Date(l.criado_em).toISOString(), criadoPor: (l.criado_por as string | null) ?? null };
  });
}

async function registrosDoEscritorio(escritorioId: string, desde: string): Promise<RegistroNotificacao[]> {
  const { data, error } = await getDb().from('notificacoes')
    .select('chave, tipo, titulo, texto, href, empresa_id, criado_em')
    .eq('escritorio_id', escritorioId).gte('criado_em', desde).order('criado_em', { ascending: false }).limit(200);
  if (error) {
    if (ausente(error)) return [];
    throw Object.assign(new Error(error.message), { code: error.code });
  }
  return (data ?? []).map((r: any) => ({
    chave: r.chave ?? null, tipo: String(r.tipo), titulo: String(r.titulo), texto: r.texto ?? null, href: r.href ?? null,
    empresaId: r.empresa_id ?? null, criadoEm: new Date(r.criado_em).toISOString(),
  }));
}

// Conferência entre módulos lê ponto de 3 meses de todas as empresas: guarda o resultado
// por alguns minutos (o sino consulta a cada visita à tela).
const CACHE_CONFERENCIA_MS = 10 * 60_000;
const cacheConferencia = new Map<string, { ate: number; achados: Awaited<ReturnType<typeof conferirEmpresas>>['achados'] }>();
export const limparCacheConferencia = () => cacheConferencia.clear();

async function conferenciaNova(escritorioId: string, nomes: Map<string, string>, hoje: string, agora: string): Promise<ItemNotificacao[]> {
  const ids = [...nomes.keys()].sort();
  const k = `${escritorioId}|${ids.join(',')}`;
  let c = cacheConferencia.get(k);
  if (!c || c.ate < Date.now()) {
    const r = await conferirEmpresas(escritorioId, nomes, hoje);
    // Fonte indisponível = a conferência está incompleta: não registra nada agora (não vira "novo" depois).
    if (r.indisponiveis.length) return [];
    c = { ate: Date.now() + CACHE_CONFERENCIA_MS, achados: r.achados };
    cacheConferencia.set(k, c);
  }
  const db = getDb();
  const { data, error } = await db.from('notificacoes').select('chave, criado_em')
    .eq('escritorio_id', escritorioId).eq('tipo', 'conferencia').like('chave', 'conf|%').limit(5000);
  if (error) {
    if (ausente(error)) return []; // sem a 0027 não há como saber o que é novo
    throw Object.assign(new Error(error.message), { code: error.code });
  }
  const vistos = new Map<string, string>((data ?? []).map((r: any) => [String(r.chave), new Date(r.criado_em).toISOString()]));
  const semeado = vistos.has(MARCA_SEMEADO);
  const novos = c.achados.map((a) => `conf|${a.chave}`).filter((ch) => !vistos.has(ch));
  const linhas = novos.map((chave) => ({
    escritorio_id: escritorioId, tipo: 'conferencia', titulo: 'Alerta da conferência', chave,
    // Primeira vez do escritório: o que já existia fica como "velho" (não avisa); depois, é novo.
    criado_em: semeado ? agora : EPOCA,
  }));
  if (!semeado) linhas.push({ escritorio_id: escritorioId, tipo: 'conferencia', titulo: 'Conferência iniciada', chave: MARCA_SEMEADO, criado_em: EPOCA });
  if (linhas.length) {
    const r = await db.from('notificacoes').insert(linhas);
    if (r.error && r.error.code === '23505') {
      for (const l of linhas) await db.from('notificacoes').insert(l); // corrida: o que já existe é ignorado
    } else if (r.error && !ausente(r.error)) console.error('[notificacoes] conferencia:', r.error.code ?? '');
    for (const l of linhas) vistos.set(l.chave, l.criado_em);
  }
  return notifConferencia(c.achados, vistos, agora);
}

// ------------------------------------------------------------------ montagem

export interface EntradaSino {
  escritorioId: string;
  /** E-mail do usuário (a leitura é por pessoa). */
  usuario: string;
  /** Empresas que a sessão enxerga (id → nome). */
  empresas: Map<string, string>;
  temPonto: boolean;
  temCaixa: boolean;
  hoje: string;
  /** Só vale quando o banco não guarda a leitura (sem a 0027): "visto até" que o navegador lembra. */
  vistoNoNavegador?: string | null;
}

export interface RespostaSino extends ListaNotificacoes {
  /** A leitura está sendo guardada no banco (0027 aplicada). */
  persistido: boolean;
  /** Fontes que não deu para ler agora (a lista pode estar incompleta). */
  indisponiveis: string[];
}

export async function lerNotificacoes(e: EntradaSino, agora: Date = new Date()): Promise<RespostaSino> {
  const desde = desdeDaJanela(agora);
  const ids = [...e.empresas.keys()];
  const indisponiveis: string[] = [];
  const isolada = async <T,>(rotulo: string, f: () => Promise<T>, vazio: T): Promise<T> => {
    try { return await f(); } catch (err) {
      indisponiveis.push(rotulo);
      console.error(`[notificacoes] ${rotulo}:`, (err as { code?: string })?.code ?? '', err instanceof Error ? err.message.slice(0, 100) : '');
      return vazio;
    }
  };

  const [{ leitura: lida, persistido }, docs, pend, lancs, regs, conf] = await Promise.all([
    lerLeitura(e.escritorioId, e.usuario),
    isolada('documentos', () => documentosNovos(e.escritorioId, ids, desde), []),
    isolada('pendências', () => pendenciasAtendidas(e.escritorioId, ids, desde), []),
    e.temCaixa ? isolada('livro caixa', () => lancamentosNovos(ids, desde), []) : Promise.resolve([]),
    isolada('eventos', () => registrosDoEscritorio(e.escritorioId, desde), []),
    e.temPonto ? isolada('conferência', () => conferenciaNova(e.escritorioId, e.empresas, e.hoje, agora.toISOString()), [] as ItemNotificacao[]) : Promise.resolve([] as ItemNotificacao[]),
  ]);

  // Sem a 0027 não há "lidas" no banco: vale o que o navegador lembrou.
  const leitura: Leitura = persistido ? lida : { lidasAte: e.vistoNoNavegador ?? null, lidas: [] };
  const itens = [
    ...notifDocumentos(docs, e.empresas),
    ...notifPendencias(pend, e.empresas, e.usuario),
    ...notifCaixa(lancs, e.empresas, e.usuario),
    ...notifEventos(regs, e.empresas),
    ...conf,
  ];
  return { ...montarNotificacoes(itens, leitura, agora), persistido, indisponiveis };
}
