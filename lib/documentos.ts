// Portal do cliente — documentos enviados e pendências: regras puras.
//
// Sem I/O e sem imports de runtime: dá para testar isoladamente
// (tests/documentos.test.ts) e importar na tela. A parte de banco e Storage
// fica em lib/documentosServidor.ts. Ver docs/documentos.md.
import type { Papel } from './auth';
import { empresaVisivel, type Quem } from './visibilidade';

// ------------------------------------------------------------------ catálogo

export type Categoria = 'nota' | 'extrato' | 'recibo' | 'folha' | 'outros';
export const CATEGORIAS: Categoria[] = ['nota', 'extrato', 'recibo', 'folha', 'outros'];
export const ROTULO_CATEGORIA: Record<Categoria, string> = {
  nota: 'Nota fiscal',
  extrato: 'Extrato bancário',
  recibo: 'Recibo / comprovante',
  folha: 'Folha / ponto',
  outros: 'Outros',
};

export type StatusDocumento = 'enviando' | 'recebido' | 'conferido' | 'rejeitado';
export type StatusPendencia = 'aberta' | 'atendida';

/** 10 MB — o mesmo `file_size_limit` do bucket na migração 0015. */
export const LIMITE_BYTES = 10 * 1024 * 1024;
export const LIMITE_TEXTO = '10 MB';

/** Tipo aceito: extensão canônica, MIME gravado no Storage e como reconhecer os bytes. */
export interface TipoAceito {
  ext: string;
  mime: string;
  rotulo: string;
  /** Outras extensões que viram esta (ex.: .jpeg → jpg). */
  apelidos?: string[];
  /** MIMEs que o navegador costuma informar para este tipo (além de `mime`). */
  mimesNavegador?: string[];
}

// Lista de PERMISSÃO. Nada que o navegador execute ao abrir (HTML, SVG, JS) e
// nada que rode macro (docm/xlsm). Precisa andar junto com `allowed_mime_types`
// do bucket e com o CHECK de `documentos.tipo` (migração 0015).
export const TIPOS_ACEITOS: TipoAceito[] = [
  { ext: 'pdf', mime: 'application/pdf', rotulo: 'PDF' },
  { ext: 'jpg', mime: 'image/jpeg', rotulo: 'JPG', apelidos: ['jpeg'], mimesNavegador: ['image/pjpeg'] },
  { ext: 'png', mime: 'image/png', rotulo: 'PNG' },
  { ext: 'webp', mime: 'image/webp', rotulo: 'WEBP' },
  { ext: 'heic', mime: 'image/heic', rotulo: 'HEIC (iPhone)', apelidos: ['heif'], mimesNavegador: ['image/heif'] },
  { ext: 'xml', mime: 'application/xml', rotulo: 'XML (NF-e)', mimesNavegador: ['text/xml'] },
  { ext: 'ofx', mime: 'application/x-ofx', rotulo: 'OFX (extrato)', mimesNavegador: ['application/ofx', 'text/ofx'] },
  { ext: 'csv', mime: 'text/csv', rotulo: 'CSV', mimesNavegador: ['application/vnd.ms-excel', 'text/plain'] },
  {
    ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', rotulo: 'Excel (XLSX)',
  },
];

/** `accept` do campo de arquivo. */
export const ACCEPT = TIPOS_ACEITOS
  .flatMap((t) => [`.${t.ext}`, ...(t.apelidos ?? []).map((a) => `.${a}`), t.mime])
  .join(',');

export const TIPOS_TEXTO = TIPOS_ACEITOS.map((t) => t.rotulo).join(', ');

/** Extensão do nome, em minúsculas, sem ponto ('' se não houver). */
export function extensao(nome: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(nome.trim());
  return m ? m[1].toLowerCase() : '';
}

export function tipoPorExtensao(ext: string): TipoAceito | null {
  const e = ext.toLowerCase();
  return TIPOS_ACEITOS.find((t) => t.ext === e || (t.apelidos ?? []).includes(e)) ?? null;
}

export function tipoPorMime(mime: string): TipoAceito | null {
  return TIPOS_ACEITOS.find((t) => t.mime === mime) ?? null;
}

/**
 * Nome original limpo para exibir e para o `download=` da URL assinada: sem
 * caminho, sem caracteres de controle nem separadores, até 120 caracteres
 * preservando a extensão. Nunca é usado como caminho no Storage.
 */
export function nomeSeguro(nome: string): string {
  const base = (nome.split(/[\\/]/).pop() ?? '')
    // controle, separadores e os bidirecionais (U+202E disfarça "fdp.exe" de "exe.pdf")
    .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (!base) return 'documento';
  if (base.length <= 120) return base;
  const ext = extensao(base);
  const corpo = ext ? base.slice(0, -(ext.length + 1)) : base;
  return ext ? `${corpo.slice(0, 119 - ext.length)}.${ext}` : base.slice(0, 120);
}

export interface ArquivoDeclarado { nome: string; tamanho: number; tipo?: string | null }

export type ResultadoArquivo =
  | { ok: true; tipo: TipoAceito; nome: string }
  | { ok: false; erro: string };

/**
 * Primeira barreira (o que o navegador declara): extensão na lista, MIME
 * coerente com ela quando informado, tamanho dentro do limite. A palavra final é
 * de `conferirAssinatura`, sobre os bytes que chegaram ao Storage.
 */
export function validarArquivo(a: ArquivoDeclarado): ResultadoArquivo {
  const nome = nomeSeguro(a.nome ?? '');
  const tipo = tipoPorExtensao(extensao(nome));
  if (!tipo) return { ok: false, erro: `Tipo de arquivo não aceito. Envie ${TIPOS_TEXTO}.` };
  const tamanho = Number(a.tamanho);
  if (!Number.isFinite(tamanho) || tamanho <= 0) return { ok: false, erro: 'O arquivo está vazio.' };
  if (tamanho > LIMITE_BYTES) return { ok: false, erro: `O arquivo passa de ${LIMITE_TEXTO}.` };
  const mime = (a.tipo ?? '').toLowerCase().split(';')[0].trim();
  // Navegador sem MIME (comum em .ofx/.heic) ou genérico: vale a extensão.
  const generico = !mime || mime === 'application/octet-stream';
  if (!generico && mime !== tipo.mime && !(tipo.mimesNavegador ?? []).includes(mime)) {
    return { ok: false, erro: 'A extensão do arquivo não bate com o conteúdo informado pelo navegador.' };
  }
  return { ok: true, tipo, nome };
}

const comeca = (b: Uint8Array, sig: number[], desde = 0) =>
  b.length >= desde + sig.length && sig.every((v, i) => b[desde + i] === v);

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** Começo do arquivo como texto (sem BOM e espaços iniciais), para os formatos de texto. */
function inicioTexto(b: Uint8Array): string | null {
  const amostra = b.subarray(0, 4096);
  // Byte nulo = binário: não é XML/OFX/CSV de verdade.
  if (amostra.includes(0)) return null;
  let i = comeca(amostra, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (i < amostra.length && [0x20, 0x09, 0x0a, 0x0d].includes(amostra[i])) i++;
  return String.fromCharCode(...amostra.subarray(i, i + 64));
}

/** HTML/XHTML/SVG/script nos primeiros 4 KB. */
function perigosoEmXml(b: Uint8Array): boolean {
  const amostra = String.fromCharCode(...b.subarray(0, 4096));
  return /<!doctype|<\s*(html|script|svg|iframe|object|embed)\b|xhtml|xmlns:xlink|javascript:/i.test(amostra);
}

/**
 * Os bytes são mesmo do tipo declarado? Assinaturas ("magic numbers") dos
 * binários e um teste de texto para XML/OFX/CSV. Um .exe renomeado para .pdf,
 * ou um HTML renomeado para .xml, não passa.
 */
export function conferirAssinatura(bytes: Uint8Array, ext: string): boolean {
  const t = tipoPorExtensao(ext);
  if (!t) return false;
  switch (t.ext) {
    case 'pdf': return comeca(bytes, ascii('%PDF-'));
    case 'jpg': return comeca(bytes, [0xff, 0xd8, 0xff]);
    case 'png': return comeca(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'webp': return comeca(bytes, ascii('RIFF')) && comeca(bytes, ascii('WEBP'), 8);
    case 'heic': {
      if (!comeca(bytes, ascii('ftyp'), 4)) return false;
      const marca = String.fromCharCode(...bytes.subarray(8, 12));
      return ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(marca);
    }
    // XLSX é um ZIP. (Não abrimos o ZIP: o arquivo só é baixado, nunca executado.)
    case 'xlsx': return comeca(bytes, [0x50, 0x4b, 0x03, 0x04]);
    case 'xml': {
      const s = inicioTexto(bytes);
      // Nada que um navegador renderize como página (o `download=` da URL assinada
      // pode ser removido por quem a tem): sem HTML/XHTML/SVG/script na amostra.
      return s !== null && s.startsWith('<') && !perigosoEmXml(bytes);
    }
    case 'ofx': {
      const s = inicioTexto(bytes);
      return s !== null && (/^OFXHEADER/i.test(s) || /^<\?xml/i.test(s) || /^<OFX>/i.test(s));
    }
    case 'csv': {
      const s = inicioTexto(bytes);
      return s !== null && !s.startsWith('<');
    }
    default: return false;
  }
}

/** Caminho no bucket. Só ids gerados no servidor — nada que o usuário digitou. */
export function caminhoNoStorage(escritorioId: string, documentoId: string, ext: string): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(escritorioId) || !uuid.test(documentoId)) throw new Error('Identificador inválido.');
  const t = tipoPorExtensao(ext);
  if (!t) throw new Error('Tipo inválido.');
  return `${escritorioId.toLowerCase()}/${documentoId.toLowerCase()}.${t.ext}`;
}

// ------------------------------------------------------------------ campos

/** AAAA-MM com mês válido. */
export function competenciaValida(c: unknown): c is string {
  return typeof c === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(c) && Number(c.slice(0, 4)) >= 2000;
}

export function categoriaValida(c: unknown): c is Categoria {
  return typeof c === 'string' && (CATEGORIAS as string[]).includes(c);
}

/** AAAA-MM-DD de calendário. */
export function dataValida(d: unknown): d is string {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** "2026-10" → "out/2026". */
export function competenciaBR(c: string): string {
  if (!competenciaValida(c)) return c;
  return `${MESES[Number(c.slice(5, 7)) - 1]}/${c.slice(0, 4)}`;
}

/** Competência do mês anterior ao de `hoje` (AAAA-MM-DD) — o padrão do envio. */
export function competenciaPadrao(hoje: string): string {
  const [a, m] = [Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))];
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

/** Últimas `n` competências a partir de `hoje` (a atual primeiro). */
export function competenciasRecentes(hoje: string, n = 13): string[] {
  let a = Number(hoje.slice(0, 4));
  let m = Number(hoje.slice(5, 7));
  const r: string[] = [];
  for (let i = 0; i < n; i++) {
    r.push(`${a}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) { m = 12; a -= 1; }
  }
  return r;
}

export function tamanhoBR(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

// ------------------------------------------------------------------ acesso
// Tudo parte de `empresaVisivel` (lib/visibilidade.ts): master vê tudo;
// contador, as empresas do escritório; cliente, só a vinculada. Aqui entram as
// regras próprias do portal sobre o registro já carregado — que traz o
// escritório gravado nele, segunda trava contra empresa trocada de escritório.

export interface RegistroRef { empresaId: string; escritorioId: string | null }

export interface DocumentoRef extends RegistroRef { status: StatusDocumento; excluidoPorGestor?: boolean }

const ehGestor = (role: Papel) => role === 'master' || role === 'usuario';

/** Pode ver o registro (documento ou pendência)? Empresa visível E escritório do registro = o da sessão. */
export function podeVerRegistro(q: Quem, r: RegistroRef): boolean {
  if (q.role === 'master') return true;
  if (!r.escritorioId || r.escritorioId !== q.escritorioId) return false;
  return empresaVisivel(q, { id: r.empresaId, escritorioId: r.escritorioId });
}

/** Conferir / desfazer a conferência: só a contabilidade. */
export function podeConferir(q: Quem, d: DocumentoRef): boolean {
  return ehGestor(q.role) && (d.status === 'recebido' || d.status === 'conferido') && podeVerRegistro(q, d);
}

/**
 * Excluir (lógico, com desfazer): a contabilidade, sempre; o cliente, só o que
 * ainda não foi conferido — depois disso o contador já usou o documento.
 */
export function podeExcluirDocumento(q: Quem, d: DocumentoRef): boolean {
  if (!podeVerRegistro(q, d)) return false;
  if (ehGestor(q.role)) return true;
  return q.role === 'cliente' && d.status === 'recebido';
}

/**
 * Desfazer a exclusão: a mesma regra de excluir e, se quem excluiu foi a
 * contabilidade (ex.: arquivo com dado de terceiro), o cliente não traz de volta.
 */
export function podeRestaurarDocumento(q: Quem, d: DocumentoRef): boolean {
  if (d.excluidoPorGestor && !ehGestor(q.role)) return false;
  return podeExcluirDocumento(q, d);
}

/** Uuid canônico (ids de documento/pendência que chegam do navegador). */
export function uuidValido(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** Abrir, editar, fechar, reabrir e excluir pendência: só a contabilidade. */
export function podeGerirPendencia(q: Quem, p: RegistroRef): boolean {
  return ehGestor(q.role) && podeVerRegistro(q, p);
}

/** Atender (vincular um envio): quem vê a pendência, se ela está aberta. */
export function podeAtenderPendencia(q: Quem, p: RegistroRef & { status: StatusPendencia }): boolean {
  return p.status === 'aberta' && podeVerRegistro(q, p);
}

// ------------------------------------------------------------------ pendências

export type SituacaoPrazo = 'sem-prazo' | 'no-prazo' | 'vence-logo' | 'vencida';

/** Situação do prazo de uma pendência aberta em relação a `hoje` (AAAA-MM-DD). "Logo" = até 3 dias. */
export function situacaoPrazo(prazo: string | null | undefined, hoje: string): SituacaoPrazo {
  if (!prazo || !dataValida(prazo)) return 'sem-prazo';
  if (prazo < hoje) return 'vencida';
  const dias = Math.round((Date.parse(`${prazo}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) / 86_400_000);
  return dias <= 3 ? 'vence-logo' : 'no-prazo';
}

export interface PendenciaResumo { status: StatusPendencia; prazo: string | null }

/** Contagem para o resumo da entrada: abertas e, delas, vencidas. */
export function resumoPendencias(lista: PendenciaResumo[], hoje: string): { abertas: number; vencidas: number } {
  const abertas = lista.filter((p) => p.status === 'aberta');
  return { abertas: abertas.length, vencidas: abertas.filter((p) => situacaoPrazo(p.prazo, hoje) === 'vencida').length };
}

/**
 * Ao excluir um documento que atendia uma pendência: se não sobrou nenhum outro
 * envio vivo para ela, a pendência volta a ficar aberta — o cliente não deve
 * "atender" apagando o arquivo.
 */
export function deveReabrir(outrosEnviosVivos: number): boolean {
  return outrosEnviosVivos === 0;
}

/** Erros do formulário "Enviar documentos", por campo (vazio = pode enviar). */
export type ErrosEnvioDocumentos = Partial<Record<'categoria' | 'arquivos', string>>;

/**
 * O que falta antes de enviar documentos — tudo de uma vez, para a tela marcar cada
 * campo com a mensagem ligada a ele. `arquivosProntos` = arquivos da lista que ainda
 * podem ir (não enviados e de tipo/tamanho aceitos).
 */
export function conferirEnvioDocumentos(a: { categoria: string; arquivosProntos: number }): ErrosEnvioDocumentos {
  const erros: ErrosEnvioDocumentos = {};
  if (!a.categoria) erros.categoria = 'Escolha o tipo de documento.';
  if (a.arquivosProntos <= 0) erros.arquivos = 'Escolha ao menos um arquivo (ou tire uma foto do documento).';
  return erros;
}
