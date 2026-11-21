// Peças comuns das rotas do portal (documentos e pendências). Não é rota: o
// Next só expõe arquivos `route.ts`.
import { NextRequest } from 'next/server';
import { exigirEmpresa, Guarda, sessaoDe } from '@/lib/acesso';
import { Sessao } from '@/lib/auth';
import { lerEmpresa } from '@/lib/cadastro';
import { ErroDoc } from '@/lib/documentosServidor';

export const negado = () => Response.json({ erro: 'Acesso restrito.' }, { status: 403 });
export const naoEncontrado = (o = 'Registro') => Response.json({ erro: `${o} não encontrado.` }, { status: 404 });

export function falha(e: unknown) {
  if (e instanceof ErroDoc) return Response.json({ erro: e.message }, { status: e.status });
  console.error('[documentos] erro inesperado:', e);
  return Response.json({ erro: 'Falha inesperada. Tente de novo.' }, { status: 500 });
}

/** Escritório usado como filtro nas leituras: o da sessão; `null` só para o master. */
export function escopoLeitura(s: Sessao, empresaId: string) {
  return { empresaId, escritorioId: s.role === 'master' ? null : (s.escritorioId ?? '__nenhum__') };
}

/**
 * Empresa do pedido + guarda. O cliente pode omitir (vale a vinculada); para os
 * demais é obrigatória. Usa `exigirEmpresa` (lib/acesso.ts): recorte por
 * escritório e, para o cliente, só a própria empresa.
 */
export async function guardaEmpresa(req: NextRequest, informada: string | null | undefined): Promise<Guarda & { empresaId?: string }> {
  let empresaId = (informada ?? '').trim();
  if (!empresaId) {
    const s = await sessaoDe(req);
    if (s?.role === 'cliente' && s.empresa) empresaId = s.empresa;
  }
  const g = await exigirEmpresa(req, empresaId);
  return g.ok ? { ...g, empresaId } : g;
}

/**
 * Escritório dono da empresa, para gravar. Lido do cadastro (nunca do navegador).
 * Empresa sem escritório: falha fechada.
 */
export async function escritorioDaEmpresa(empresaId: string): Promise<string> {
  const e = await lerEmpresa(empresaId);
  if (!e) throw new ErroDoc('Empresa não encontrada.', 404);
  if (!e.escritorioId) throw new ErroDoc('Esta empresa não está vinculada a um escritório.', 409);
  return e.escritorioId;
}

/** Texto opcional: aparado, vazio → null, cortado no máximo. */
export function textoOpcional(v: unknown, max: number): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s.slice(0, max) : null;
}
