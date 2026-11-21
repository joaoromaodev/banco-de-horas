// Folha de ponto enviada pelo cliente — regras puras (Sprint 10 · Frente A).
//
// Sem I/O: testável (tests/envioPonto.test.ts) e importável na tela. Banco,
// Storage e a leitura pela IA ficam em lib/envioPontoServidor.ts. Ver a seção
// "Folha enviada pelo cliente" em docs/folha-de-ponto.md.
import type { Papel } from './auth';
import { conferirAssinatura, extensao, nomeSeguro, uuidValido } from './documentos';
import { MARCADORES, type DiaFreq, type Marcador } from './tipos';
import { empresaVisivel, type Quem } from './visibilidade';

// ------------------------------------------------------------------ situação

export type SituacaoEnvio =
  | 'enviando' | 'recebida' | 'lendo' | 'lida' | 'falhou' | 'aplicada' | 'devolvida' | 'rejeitada';

/** Por que uma foto recebida ainda não foi lida. */
export type MotivoEspera = 'cota' | 'ritmo' | 'limite_empresa' | 'sem_ia';

/** O que a contabilidade ainda precisa fazer com o envio. */
export const SITUACOES_PENDENTES: SituacaoEnvio[] = ['recebida', 'lendo', 'lida', 'falhou'];

export const ehPendente = (s: SituacaoEnvio) => SITUACOES_PENDENTES.includes(s);

type TomSelo = 'neutro' | 'primaria' | 'sucesso' | 'aviso' | 'perigo';

/**
 * O que o CLIENTE vê. Ele não precisa saber se a IA leu ou falhou: para ele a
 * folha foi recebida, está na conferência, foi conferida ou voltou com motivo.
 */
export function situacaoParaCliente(s: SituacaoEnvio): { rotulo: string; tom: TomSelo; explicacao: string } {
  switch (s) {
    case 'enviando':
      return { rotulo: 'Enviando', tom: 'neutro', explicacao: 'A foto ainda não terminou de subir.' };
    case 'recebida':
    case 'lendo':
    case 'falhou':
      return { rotulo: 'Recebida', tom: 'primaria', explicacao: 'A contabilidade recebeu a foto e vai conferir.' };
    case 'lida':
      return { rotulo: 'Em conferência', tom: 'aviso', explicacao: 'A folha foi lida e está com a contabilidade para conferir.' };
    case 'aplicada':
      return { rotulo: 'Conferida', tom: 'sucesso', explicacao: 'A contabilidade conferiu e lançou esta folha.' };
    case 'devolvida':
      return { rotulo: 'Devolvida', tom: 'perigo', explicacao: 'A contabilidade pediu uma nova foto. Veja o motivo e envie de novo.' };
    case 'rejeitada':
      return { rotulo: 'Recusada', tom: 'perigo', explicacao: 'O arquivo não era uma foto válida. Envie de novo.' };
  }
}

/** O que a CONTABILIDADE vê, com o motivo da espera quando há. */
export function situacaoParaContador(s: SituacaoEnvio, espera?: MotivoEspera | null): { rotulo: string; tom: TomSelo; dica?: string } {
  switch (s) {
    case 'enviando': return { rotulo: 'Enviando', tom: 'neutro' };
    case 'recebida':
      if (espera === 'cota') return { rotulo: 'Na fila', tom: 'neutro', dica: 'A cota de leituras por IA do mês acabou. Leia à mão ou suba de plano.' };
      if (espera === 'ritmo') return { rotulo: 'Na fila', tom: 'neutro', dica: 'Muitas leituras em pouco tempo; a fila continua em alguns minutos.' };
      if (espera === 'limite_empresa') {
        return { rotulo: 'Aguardando você', tom: 'aviso', dica: 'Esta empresa já passou do limite de leituras automáticas do mês. Clique em "Ler" para gastar uma leitura da cota.' };
      }
      if (espera === 'sem_ia') return { rotulo: 'Na fila', tom: 'neutro', dica: 'A leitura por IA está indisponível no momento.' };
      return { rotulo: 'Na fila', tom: 'neutro', dica: 'A IA vai ler em instantes.' };
    case 'lendo': return { rotulo: 'Lendo…', tom: 'primaria' };
    case 'lida': return { rotulo: 'Lida pela IA', tom: 'aviso', dica: 'Confira ao lado da foto e aplique à frequência.' };
    case 'falhou': return { rotulo: 'Leitura falhou', tom: 'perigo', dica: 'A IA não conseguiu ler (não contou na cota). Tente de novo ou preencha à mão.' };
    case 'aplicada': return { rotulo: 'Aplicada', tom: 'sucesso' };
    case 'devolvida': return { rotulo: 'Devolvida', tom: 'perigo' };
    case 'rejeitada': return { rotulo: 'Recusada', tom: 'perigo' };
  }
}

// ------------------------------------------------------------------ foto

/** 8 MB — o mesmo `file_size_limit` do bucket `ponto` e do CHECK da 0028. */
export const LIMITE_FOTO_BYTES = 8 * 1024 * 1024;
export const LIMITE_FOTO_TEXTO = '8 MB';

/** Tipos aceitos. Precisam andar junto com o bucket e o CHECK de `ponto_envios.tipo` (0028). */
export const TIPOS_FOTO = [
  { ext: 'jpg', mime: 'image/jpeg', apelidos: ['jpeg'], navegador: ['image/pjpeg'] },
  { ext: 'png', mime: 'image/png', apelidos: [] as string[], navegador: [] as string[] },
  { ext: 'webp', mime: 'image/webp', apelidos: [] as string[], navegador: [] as string[] },
  { ext: 'heic', mime: 'image/heic', apelidos: ['heif'], navegador: ['image/heif'] },
] as const;

export type TipoFoto = (typeof TIPOS_FOTO)[number];

export const ACCEPT_FOTO = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif';

const tipoPorExt = (ext: string): TipoFoto | null =>
  TIPOS_FOTO.find((t) => t.ext === ext || (t.apelidos as readonly string[]).includes(ext)) ?? null;
const tipoPorMime = (mime: string): TipoFoto | null =>
  TIPOS_FOTO.find((t) => t.mime === mime || (t.navegador as readonly string[]).includes(mime)) ?? null;

export type ResultadoFoto = { ok: true; tipo: TipoFoto; nome: string } | { ok: false; erro: string };

/**
 * Primeira barreira (o que o navegador declara). Câmera de celular costuma mandar
 * `image.jpg` ou um nome sem extensão: vale a extensão OU o MIME, desde que não
 * se contradigam. A palavra final é da assinatura dos bytes (`fotoValida`).
 */
export function validarFoto(a: { nome?: string | null; tamanho: number; tipo?: string | null }): ResultadoFoto {
  const nome = nomeSeguro(a.nome ?? '');
  const porExt = tipoPorExt(extensao(nome));
  const mime = (a.tipo ?? '').toLowerCase().split(';')[0].trim();
  const porMime = mime && mime !== 'application/octet-stream' ? tipoPorMime(mime) : null;
  if (mime && mime !== 'application/octet-stream' && !porMime) return { ok: false, erro: 'Envie uma foto (JPG, PNG, WEBP ou HEIC).' };
  if (porExt && porMime && porExt.ext !== porMime.ext) return { ok: false, erro: 'A extensão do arquivo não bate com o tipo da foto.' };
  const tipo = porMime ?? porExt;
  if (!tipo) return { ok: false, erro: 'Envie uma foto (JPG, PNG, WEBP ou HEIC).' };
  const tamanho = Number(a.tamanho);
  if (!Number.isFinite(tamanho) || tamanho <= 0) return { ok: false, erro: 'A foto está vazia.' };
  if (tamanho > LIMITE_FOTO_BYTES) return { ok: false, erro: `A foto passa de ${LIMITE_FOTO_TEXTO}. Tire outra com resolução menor.` };
  return { ok: true, tipo, nome };
}

/** Os bytes que chegaram ao Storage são mesmo uma imagem do tipo gravado? */
export function fotoValida(bytes: Uint8Array, ext: string): boolean {
  if (!tipoPorExt(ext) || bytes.length === 0 || bytes.length > LIMITE_FOTO_BYTES) return false;
  return conferirAssinatura(bytes, ext);
}

/** Caminho no bucket `ponto`: só ids gerados no servidor. */
export function caminhoFoto(escritorioId: string, envioId: string, ext: string): string {
  if (!uuidValido(escritorioId) || !uuidValido(envioId)) throw new Error('Identificador inválido.');
  const t = tipoPorExt(ext);
  if (!t) throw new Error('Tipo inválido.');
  return `${escritorioId.toLowerCase()}/${envioId.toLowerCase()}.${t.ext}`;
}

// ------------------------------------------------------------------ freios

/** Envios iniciados por empresa por hora (inclui os que não terminaram). */
export const MAX_ENVIOS_HORA = 40;

/**
 * Leituras AUTOMÁTICAS (disparadas por envio do cliente) por empresa e mês. A cota
 * é do escritório: sem este teto, um cliente mandando foto em sequência gastaria
 * a cota de todas as outras empresas. Folga para frente e verso e reenvios: 3 por
 * funcionário, no mínimo 10 e no máximo 300. Acima disso a foto fica guardada e a
 * contadora decide ler (gasta uma leitura normal da cota).
 */
export function limiteLeiturasAutomaticas(funcionarios: number): number {
  const n = Math.max(0, Math.floor(Number(funcionarios) || 0));
  return Math.min(300, Math.max(10, n * 3));
}

/** Tentativas automáticas de leitura de uma foto antes de esperar a contadora. */
export const MAX_TENTATIVAS_AUTO = 2;
/** Leitura "lendo" mais velha que isto (função morta no meio) volta para a fila. */
export const LEITURA_PRESA_MIN = 5;
/** O "desfazer" de uma aplicação vale por este tempo (depois, edite a folha). */
export const DESFAZER_APLICACAO_H = 12;
/** Retenção da foto depois de o envio terminar (LGPD — ver a 0028). */
export const RETENCAO_FOTO_DIAS = 90;
/** Envio recusado ou abandonado (nunca confirmado): a foto some em 1 dia. */
export const RETENCAO_ORFA_DIAS = 1;

// ------------------------------------------------------------------ rascunho

export interface CampoIncerto { dia: number; campo: string }

export interface Rascunho {
  dias: DiaFreq[];
  incertos: CampoIncerto[];
  /** Nome que a IA leu no cabeçalho (só para a contadora comparar). */
  funcionarioLido: string | null;
}

const CAMPOS_HORA = ['entradaManha', 'saidaAlmoco', 'retornoAlmoco', 'saidaTarde'] as const;

const texto = (v: unknown, max: number): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/**
 * Normaliza um rascunho (vindo da IA ou do banco): dia 1..31 sem repetir,
 * horários como texto curto (o dado da folha não é reescrito — a revisão aponta
 * `12>54`), marcador só da lista, incertos só de campos que existem.
 */
export function normalizarRascunho(bruto: unknown): Rascunho {
  const r = (bruto && typeof bruto === 'object' ? bruto : {}) as Record<string, unknown>;
  const porDia = new Map<number, DiaFreq>();
  for (const d of Array.isArray(r.dias) ? r.dias : []) {
    if (!d || typeof d !== 'object') continue;
    const x = d as Record<string, unknown>;
    const dia = Number(x.dia);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) continue;
    const marcador = (MARCADORES as string[]).includes(String(x.marcador ?? '')) ? (x.marcador as Marcador) : null;
    porDia.set(dia, {
      dia,
      entradaManha: texto(x.entradaManha, 16),
      saidaAlmoco: texto(x.saidaAlmoco, 16),
      retornoAlmoco: texto(x.retornoAlmoco, 16),
      saidaTarde: texto(x.saidaTarde, 16),
      marcador,
    });
  }
  const incertos: CampoIncerto[] = [];
  for (const c of Array.isArray(r.incertos) ? r.incertos : []) {
    const x = (c ?? {}) as Record<string, unknown>;
    const dia = Number(x.dia);
    const campo = String(x.campo ?? '');
    if (Number.isInteger(dia) && porDia.has(dia) && (CAMPOS_HORA as readonly string[]).concat('marcador').includes(campo)) {
      incertos.push({ dia, campo });
    }
  }
  return {
    dias: [...porDia.values()].sort((a, b) => a.dia - b.dia),
    incertos: incertos.slice(0, 200),
    funcionarioLido: texto(r.funcionarioLido, 120),
  };
}

/** Dias com algum horário ou marcador. */
export const diasPreenchidos = (dias: DiaFreq[]) =>
  dias.filter((d) => d.entradaManha || d.saidaAlmoco || d.retornoAlmoco || d.saidaTarde || d.marcador).length;

// ------------------------------------------------------------------ campos

/** Nome de funcionário na lista da empresa (comparação sem caixa e espaços extras). */
export const chaveNome = (s: string) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();

export function anoMesValidos(ano: unknown, mes: unknown): boolean {
  const a = Number(ano);
  const m = Number(mes);
  return Number.isInteger(a) && a >= 2000 && a <= 2100 && Number.isInteger(m) && m >= 1 && m <= 12;
}

/**
 * O cliente só manda folha de mês que já começou e de até 13 meses atrás:
 * nem o futuro (erro de digitação) nem o histórico antigo, que a contadora lança.
 */
export function mesAceitoParaEnvio(ano: number, mes: number, hojeIso: string): boolean {
  if (!anoMesValidos(ano, mes)) return false;
  const atual = Number(hojeIso.slice(0, 4)) * 12 + Number(hojeIso.slice(5, 7)) - 1;
  const pedido = ano * 12 + mes - 1;
  return pedido <= atual && pedido >= atual - 13;
}

// ------------------------------------------------------------------ acesso

export interface EnvioRef {
  empresaId: string;
  escritorioId: string | null;
  situacao: SituacaoEnvio;
  enviadoPor?: string;
  excluidoPorGestor?: boolean;
}

const gestor = (r: Papel) => r === 'master' || r === 'usuario';

/** Ver o envio (e a foto): empresa visível e escritório do REGISTRO = o da sessão. */
export function podeVerEnvio(q: Quem, e: EnvioRef): boolean {
  if (q.role === 'master') return true;
  if (!e.escritorioId || e.escritorioId !== q.escritorioId) return false;
  return empresaVisivel(q, { id: e.empresaId, escritorioId: e.escritorioId });
}

/** Ler (de novo), aplicar, devolver: só a contabilidade. */
export function podeConferirEnvio(q: Quem, e: EnvioRef): boolean {
  return gestor(q.role) && podeVerEnvio(q, e);
}

/** Pode ser lida pela IA a partir desta situação. */
export const podeLer = (s: SituacaoEnvio) => s === 'recebida' || s === 'falhou';
/** Pode ser aplicada à frequência (a contadora pode ter preenchido à mão se a leitura falhou). */
export const podeAplicar = (s: SituacaoEnvio) => s === 'lida' || s === 'falhou' || s === 'recebida';
/** Pode ser devolvida ao cliente. */
export const podeDevolver = (s: SituacaoEnvio) => s === 'lida' || s === 'falhou' || s === 'recebida';

/**
 * Excluir (lógico, com desfazer): o cliente, o que ainda não foi aplicado; a
 * contabilidade também. Envio aplicado já virou frequência e não some daqui.
 */
export function podeExcluirEnvio(q: Quem, e: EnvioRef): boolean {
  if (!podeVerEnvio(q, e) || e.situacao === 'aplicada' || e.situacao === 'lendo') return false;
  if (gestor(q.role)) return true;
  return q.role === 'cliente';
}

/** Desfazer a exclusão: a mesma regra; exclusão da contabilidade o cliente não desfaz. */
export function podeRestaurarEnvio(q: Quem, e: EnvioRef): boolean {
  if (e.excluidoPorGestor && !gestor(q.role)) return false;
  return podeVerEnvio(q, e) && (gestor(q.role) || q.role === 'cliente');
}

/** Situação para onde volta um envio quando a aplicação ou a devolução é desfeita. */
export function situacaoAoReabrir(e: { rascunho: unknown; tentativas: number }): SituacaoEnvio {
  if (e.rascunho) return 'lida';
  return e.tentativas > 0 ? 'falhou' : 'recebida';
}

/** Motivo da devolução: obrigatório, aparado, até 500 caracteres. */
export function motivoValido(v: unknown): string | null {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return s.length >= 3 ? s.slice(0, 500) : null;
}
