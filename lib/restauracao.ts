// Desfazer a exclusão de um usuário sem guardar estado no servidor.
//
// Ao excluir, a rota devolve uma "ficha" com o registro removido CIFRADO
// (AES-GCM, chave derivada do segredo do servidor) e com validade curta. O
// navegador só a guarda e a devolve no "Desfazer" — não consegue ler o hash da
// senha nem forjar uma ficha. Funciona em serverless (nada em memória).
import { getSecret } from './auth';
import type { UsuarioRec } from './cadastro';

const VALIDADE_MS = 30 * 60 * 1000; // 30 min: o toast de desfazer não tem cronômetro

async function chave(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const bruto = await crypto.subtle.digest('SHA-256', enc.encode(`${getSecret()}:restaurar-usuario`));
  return crypto.subtle.importKey('raw', bruto, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

const paraB64 = (b: Uint8Array) => Buffer.from(b).toString('base64url');
const deB64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64url'));

export async function selarUsuario(u: UsuarioRec): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const corpo = new TextEncoder().encode(JSON.stringify({ u, exp: Date.now() + VALIDADE_MS }));
  const cifra = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await chave(), corpo);
  return `${paraB64(iv)}.${paraB64(new Uint8Array(cifra))}`;
}

/** O registro selado, ou `null` se a ficha for inválida, adulterada ou vencida. */
export async function abrirUsuario(ficha: string): Promise<UsuarioRec | null> {
  const [iv, cifra] = String(ficha ?? '').split('.');
  if (!iv || !cifra) return null;
  try {
    const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(iv) }, await chave(), deB64(cifra));
    const { u, exp } = JSON.parse(new TextDecoder().decode(claro)) as { u: UsuarioRec; exp: number };
    return exp > Date.now() && u?.email ? u : null;
  } catch {
    return null;
  }
}
