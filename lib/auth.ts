// Autenticação: hash de senha (PBKDF2) e sessão em cookie assinado (HMAC).
// Usa Web Crypto — funciona tanto no runtime Node quanto no edge (proxy.ts).

/** `master` administra a plataforma (vê todos os escritórios); `usuario` é o
 *  contador de um escritório (vê as empresas do escritório); `cliente` é o
 *  administrativo da empresa-cliente (vê só a empresa dele). */
export type Papel = 'master' | 'usuario' | 'cliente';

/** Os dois módulos da plataforma. Cada contador é liberado por módulo. */
export type Modulo = 'ponto' | 'caixa';
export const MODULOS: Modulo[] = ['ponto', 'caixa'];

export interface Sessao {
  email: string;
  nome: string;
  role: Papel;
  /** Empresa vinculada — obrigatória no papel `cliente`, ausente nos demais. */
  empresa?: string;
  /** Módulos liberados para esta sessão. Já resolvido no login (ver `resolverModulos`). */
  modulos?: Modulo[];
  /** Escritório contábil (o inquilino). Ausente só no `master`. Sessões emitidas
   *  antes do multi-escritório não têm o campo — lib/acesso.ts completa do banco. */
  escritorioId?: string;
  /** Administrador do escritório (só papel `usuario`): gerencia a equipe. */
  adminEscritorio?: boolean;
  exp: number; // epoch ms
}

/**
 * Módulos efetivos de um usuário, resolvidos no login e gravados na sessão para
 * a checagem sair sem I/O (proxy e rotas leem `sessao.modulos`).
 *
 * - `master` tem tudo.
 * - `cliente` é sempre só o caixa (nem enxerga a folha de ponto).
 * - `usuario` (contador) usa o que o master habilitou; **vazio = legado = tudo**,
 *   para não tirar acesso de quem já usava o sistema antes deste campo existir.
 *   Contador novo nasce com o padrão do cadastro (só caixa).
 */
export function resolverModulos(role: Papel, guardados?: Modulo[] | null): Modulo[] {
  if (role === 'cliente') return ['caixa'];
  if (role === 'master') return [...MODULOS];
  return guardados && guardados.length ? guardados : [...MODULOS];
}

/** A sessão tem acesso ao módulo? Master sempre; demais pelo que foi resolvido. */
export function temModulo(s: Sessao | null | undefined, m: Modulo): boolean {
  if (!s) return false;
  if (s.role === 'master') return true;
  return (s.modulos ?? MODULOS).includes(m);
}

/** Tamanho mínimo de senha nova (cadastro self-service e convites da equipe). */
export const SENHA_MIN = 8;

/** Formato básico de e-mail — a confirmação de verdade é o login. */
export function emailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) && email.length <= 254;
}

const DURACAO_MS = 1000 * 60 * 60 * 12; // 12h

/** Segredo do servidor (sessão e fichas de desfazer). */
export function getSecret(): string {
  const s = process.env.SESSION_SECRET?.trim();
  if (s) return s;
  // Publicado sem segredo, qualquer um forjaria sessão de administrador com o
  // texto fixo abaixo: melhor falhar alto do que aceitar cookie forjável.
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV) {
    throw new Error('SESSION_SECRET não configurado no ambiente publicado.');
  }
  return 'dev-secret-troque-em-producao';
}

// ---- base64url ----
function bytesParaB64url(bytes: ArrayBuffer): string {
  const bin = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function strParaB64url(s: string): string {
  const bin = String.fromCharCode(...new TextEncoder().encode(s));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlParaStr(b: string): string {
  const pad = b.replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function hexParaBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.substr(i * 2, 2), 16);
  return arr;
}
function u8ParaHex(u: Uint8Array): string {
  return [...u].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function bytesParaHex(buf: ArrayBuffer): string {
  return u8ParaHex(new Uint8Array(buf));
}

// ---- HMAC (sessão) ----
async function hmac(dados: string): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(getSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(dados));
}

export async function criarSessao(s: Omit<Sessao, 'exp'>): Promise<string> {
  const payload: Sessao = { ...s, exp: Date.now() + DURACAO_MS };
  const corpo = strParaB64url(JSON.stringify(payload));
  const assinatura = bytesParaB64url(await hmac(corpo));
  return `${corpo}.${assinatura}`;
}

export async function lerSessao(token: string | undefined | null): Promise<Sessao | null> {
  if (!token || !token.includes('.')) return null;
  const [corpo, assinatura] = token.split('.');
  const esperada = bytesParaB64url(await hmac(corpo));
  if (assinatura !== esperada) return null;
  try {
    const s = JSON.parse(b64urlParaStr(corpo)) as Sessao;
    if (!s.exp || s.exp < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

// ---- senha (PBKDF2) ----
export async function hashSenha(senha: string, saltHex?: string): Promise<{ salt: string; hash: string }> {
  const enc = new TextEncoder();
  const salt = saltHex ? hexParaBytes(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100_000, hash: 'SHA-256' },
    key,
    256,
  );
  return { salt: u8ParaHex(salt), hash: bytesParaHex(bits) };
}

export async function conferirSenha(senha: string, saltHex: string, hashHex: string): Promise<boolean> {
  const { hash } = await hashSenha(senha, saltHex);
  return hash === hashHex;
}

export const COOKIE_SESSAO = 'sessao';
