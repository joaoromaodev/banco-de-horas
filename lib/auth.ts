// Autenticação: hash de senha (PBKDF2) e sessão em cookie assinado (HMAC).
// Usa Web Crypto — funciona tanto no runtime Node quanto no edge (proxy.ts).

/** `master` administra o sistema; `usuario` é a contadora (vê todas as empresas);
 *  `cliente` é o administrativo da empresa-cliente (vê só a empresa dele). */
export type Papel = 'master' | 'usuario' | 'cliente';

export interface Sessao {
  email: string;
  nome: string;
  role: Papel;
  /** Empresa vinculada — obrigatória no papel `cliente`, ausente nos demais. */
  empresa?: string;
  exp: number; // epoch ms
}

const DURACAO_MS = 1000 * 60 * 60 * 12; // 12h

function getSecret(): string {
  return process.env.SESSION_SECRET || 'dev-secret-troque-em-producao';
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
