// Entregas do escritório ao cliente (Sprint 17 · Frente A): regras puras.
//
// A contadora publica guia, DAS, holerite, declaração… para uma empresa; o cliente
// vê, baixa e fica registrado "aberto em …" (a primeira abertura pelo cliente). Sem
// I/O: testado em tests/entregas.test.ts e importável na tela. Banco e Storage em
// lib/entregasServidor.ts. Ver docs/documentos.md.
import type { Quem } from './visibilidade';
import { competenciaValida, dataValida, DIAS_LEMBRETE, diasAte, podeVerRegistro, tipoPorExtensao } from './documentos';

export type TipoEntrega = 'guia' | 'das' | 'holerite' | 'declaracao' | 'outro';
export const TIPOS_ENTREGA: TipoEntrega[] = ['guia', 'das', 'holerite', 'declaracao', 'outro'];
export const ROTULO_TIPO_ENTREGA: Record<TipoEntrega, string> = {
  guia: 'Guia de imposto',
  das: 'DAS',
  holerite: 'Holerite',
  declaracao: 'Declaração',
  outro: 'Outro documento',
};

export type StatusEntrega = 'enviando' | 'publicada' | 'rejeitada';

export const tipoEntregaValido = (t: unknown): t is TipoEntrega => typeof t === 'string' && (TIPOS_ENTREGA as string[]).includes(t);

/** Caminho no bucket `documentos`: prefixo `entregas/` (a faxina distingue do que o cliente enviou). Só uuids. */
export function caminhoEntrega(escritorioId: string, entregaId: string, ext: string): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(escritorioId) || !uuid.test(entregaId)) throw new Error('Identificador inválido.');
  const t = tipoPorExtensao(ext);
  if (!t) throw new Error('Tipo inválido.');
  return `${escritorioId.toLowerCase()}/entregas/${entregaId.toLowerCase()}.${t.ext}`;
}

export interface CamposEntrega {
  tipo: TipoEntrega;
  titulo: string | null;
  competencia: string;
  vencimento: string | null;
  observacao: string | null;
}

export type ErrosEntrega = Partial<Record<'tipo' | 'competencia' | 'vencimento' | 'titulo', string>>;

const texto = (v: unknown, max: number): string | null => {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return s ? s.slice(0, max) : null;
};

/**
 * O que a contadora preencheu, validado campo a campo (a tela mostra cada erro no
 * campo dele; a rota devolve o primeiro). Título e observação são opcionais.
 */
export function validarCamposEntrega(b: Record<string, unknown>): { ok: true; campos: CamposEntrega } | { ok: false; erros: ErrosEntrega } {
  const erros: ErrosEntrega = {};
  if (!tipoEntregaValido(b.tipo)) erros.tipo = 'Escolha o tipo do documento.';
  if (!competenciaValida(b.competencia)) erros.competencia = 'Escolha a competência (mês de referência).';
  const venc = b.vencimento === undefined || b.vencimento === null || b.vencimento === '' ? null : String(b.vencimento);
  if (venc !== null && !dataValida(venc)) erros.vencimento = 'Data de vencimento inválida.';
  if (Object.keys(erros).length) return { ok: false, erros };
  return {
    ok: true,
    campos: {
      tipo: b.tipo as TipoEntrega, titulo: texto(b.titulo, 200), competencia: b.competencia as string,
      vencimento: venc, observacao: texto(b.observacao, 500),
    },
  };
}

// ------------------------------------------------------------------ acesso

export interface EntregaRef { empresaId: string; escritorioId: string | null; status: StatusEntrega; excluidoEm: string | null }

const ehGestor = (q: Quem) => q.role === 'master' || q.role === 'usuario';

/** Ver (listar, baixar): quem vê o registro (empresa visível + escritório gravado = o da sessão), se já publicada. */
export function podeVerEntrega(q: Quem, e: EntregaRef): boolean {
  return e.status === 'publicada' && !e.excluidoEm && podeVerRegistro(q, e);
}

/** Publicar, excluir e desfazer: só a contabilidade do escritório da empresa. */
export function podeGerirEntrega(q: Quem, e: Pick<EntregaRef, 'empresaId' | 'escritorioId'>): boolean {
  return ehGestor(q) && podeVerRegistro(q, e);
}

/**
 * O download conta como "aberto"? Só o do **cliente**, e só o primeiro (a gravação
 * ainda leva `aberto_em is null`, então abrir de novo não muda a data). A
 * contabilidade conferindo o arquivo não é prova de entrega.
 */
export function registraAbertura(q: Quem, e: { abertoEm: string | null }): boolean {
  return q.role === 'cliente' && !e.abertoEm;
}

// ------------------------------------------------------------------ situação

/** `aberta` · `nao-aberta` · `vence-logo` (não aberta, vence em até 3 dias) · `vencida` (não aberta e vencida). */
export type SituacaoEntrega = 'aberta' | 'nao-aberta' | 'vence-logo' | 'vencida';

export function situacaoEntrega(e: { abertoEm: string | null; vencimento: string | null }, hoje: string): SituacaoEntrega {
  if (e.abertoEm) return 'aberta';
  const dias = diasAte(e.vencimento, hoje);
  if (dias === null) return 'nao-aberta';
  if (dias < 0) return 'vencida';
  return dias <= DIAS_LEMBRETE ? 'vence-logo' : 'nao-aberta';
}

/** Peso para "quem precisa de atenção primeiro": vencida, vence logo, não aberta, aberta. */
const PESO: Record<SituacaoEntrega, number> = { vencida: 0, 'vence-logo': 1, 'nao-aberta': 2, aberta: 3 };

/** Não abertas primeiro (as mais urgentes no topo, por vencimento), depois as abertas mais recentes. */
export function ordenarEntregas<T extends { abertoEm: string | null; vencimento: string | null; publicadoEm: string }>(lista: T[], hoje: string): T[] {
  return [...lista].sort((a, b) => PESO[situacaoEntrega(a, hoje)] - PESO[situacaoEntrega(b, hoje)]
    || (a.vencimento ?? '9999').localeCompare(b.vencimento ?? '9999')
    || b.publicadoEm.localeCompare(a.publicadoEm));
}

/** "Guia de imposto · DAS de outubro" — o título, quando a contadora escreveu um, depois do tipo. */
export function nomeEntrega(e: { tipo: TipoEntrega; titulo: string | null }): string {
  const tipo = ROTULO_TIPO_ENTREGA[e.tipo] ?? 'Documento';
  return e.titulo ? `${tipo} · ${e.titulo}` : tipo;
}
