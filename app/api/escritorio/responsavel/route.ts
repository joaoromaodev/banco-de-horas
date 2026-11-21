// /api/escritorio/responsavel — "aplicar às empresas sem contabilista" e desfazer.
// Só o administrador do escritório, sempre no escritório da sessão.
//   POST  {}                                  → aplica nas empresas sem contabilista
//   PATCH { nome, aplicadas: [{empresaId, crcAnterior}] } → desfaz
import { NextRequest } from 'next/server';
import { exigirAdminEscritorio } from '@/lib/acesso';
import { aplicarResponsavel, contarSemContabilista, desfazerAplicacao } from '@/lib/escritorioServidor';
import { falha } from '../comum';

export const runtime = 'nodejs';
const OQUE = 'aplica o responsável técnico às empresas';

export async function POST(req: NextRequest) {
  const g = await exigirAdminEscritorio(req, OQUE);
  if (!g.ok) return g.resposta;
  try {
    const id = g.sessao.escritorioId!;
    const r = await aplicarResponsavel(id, g.sessao.email);
    return Response.json({ ...r, empresas: await contarSemContabilista(id) });
  } catch (e) { return falha(e); }
}

export async function PATCH(req: NextRequest) {
  const g = await exigirAdminEscritorio(req, OQUE);
  if (!g.ok) return g.resposta;
  try {
    const id = g.sessao.escritorioId!;
    const body = await req.json().catch(() => ({}));
    const aplicadas = (Array.isArray(body.aplicadas) ? body.aplicadas : [])
      .map((a: { empresaId?: unknown; crcAnterior?: unknown }) => ({ empresaId: String(a?.empresaId ?? ''), crcAnterior: String(a?.crcAnterior ?? '') }))
      .filter((a: { empresaId: string }) => a.empresaId);
    const desfeitas = await desfazerAplicacao(id, String(body.nome ?? ''), aplicadas, g.sessao.email);
    return Response.json({ desfeitas, empresas: await contarSemContabilista(id) });
  } catch (e) { return falha(e); }
}
