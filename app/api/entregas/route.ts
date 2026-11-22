// /api/entregas — documentos que o ESCRITÓRIO publica para a empresa-cliente (guia,
// DAS, holerite, declaração…), com protocolo de leitura. Migração 0032.
//
// Acesso:
//   GET ?empresa=          → cliente (só a própria empresa; `/api/entregas` está em
//                            CLIENTE_PODE) e contabilidade (empresas do escritório).
//   GET ?visao=nao-abertas → só a contabilidade: o que os clientes ainda não abriram,
//                            em todas as empresas que ela enxerga.
//   POST · PATCH · DELETE  → só a contabilidade do escritório da empresa.
// Toda decisão passa por lib/acesso.ts (empresa) + lib/entregas.ts (registro
// carregado, com o escritório gravado nele). Empresa arquivada: a contabilidade lê,
// ninguém grava (409); o cliente dela leva 403. Ver docs/documentos.md.
//
// Publicar em dois passos, como os documentos (o arquivo não passa pela função):
//   POST → valida, grava `enviando` e devolve a URL de upload assinada;
//   PATCH { acao: 'confirmar' } → o servidor confere os bytes e publica.
import { NextRequest } from 'next/server';
import { ehGestor, empresasVisiveis, exigirGestor, respostaNegadaEmpresa } from '@/lib/acesso';
import { hojeBelem } from '@/lib/contratos';
import { podeVerRegistro, validarArquivo } from '@/lib/documentos';
import { ErroDoc } from '@/lib/documentosServidor';
import { ordenarEntregas, podeGerirEntrega, validarCamposEntrega } from '@/lib/entregas';
import {
  confirmarEntrega, entregaPublica, excluirEntrega, iniciarEntrega, lerEntrega, listarEntregas, listarNaoAbertas,
  publicacoesRecentes, restaurarEntrega,
} from '@/lib/entregasServidor';
import { escopoLeitura, escritorioDaEmpresa, falha, guardaEmpresa, naoEncontrado, negado } from '../documentos/comum';

export const runtime = 'nodejs';

/** Publicações por empresa por hora (inclui as que não terminaram). */
const MAX_PUBLICACOES_HORA = 60;
/** Quantas "não abertas" a visão do escritório devolve (as mais urgentes). */
const MAX_NAO_ABERTAS = 100;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get('visao') === 'nao-abertas') return naoAbertas(req);
  const g = await guardaEmpresa(req, p.get('empresa'));
  if (!g.ok) return g.resposta;
  try {
    const hoje = hojeBelem();
    const lista = ordenarEntregas(await listarEntregas(escopoLeitura(g.sessao, g.empresaId!)), hoje);
    return Response.json({ entregas: lista.map((e) => entregaPublica(e, ehGestor(g.sessao))) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return falha(e); }
}

/** Contabilidade: as não abertas de todas as empresas visíveis (ativas), as mais urgentes primeiro. */
async function naoAbertas(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  const s = g.sessao;
  try {
    // Contador sem escritório não enxerga nada (falha fechada).
    if (s.role !== 'master' && !s.escritorioId) return Response.json({ entregas: [] });
    const empresas = await empresasVisiveis(s);
    const nomes = new Map(empresas.map((e) => [e.id, e.nome]));
    const lista = await listarNaoAbertas([...nomes.keys()], s.role === 'master' ? null : s.escritorioId!);
    const hoje = hojeBelem();
    return Response.json({
      entregas: ordenarEntregas(lista, hoje).slice(0, MAX_NAO_ABERTAS)
        .map((e) => ({ ...entregaPublica(e, true), empresaNome: nomes.get(e.empresaId) ?? '' })),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return falha(e); }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const g = await guardaEmpresa(req, body.empresa);
    if (!g.ok) return g.resposta;
    if (!ehGestor(g.sessao)) return negado();
    const empresaId = g.empresaId!;

    const v = validarCamposEntrega(body);
    if (!v.ok) return Response.json({ erro: Object.values(v.erros)[0], campos: v.erros }, { status: 400 });
    const arq = validarArquivo({ nome: String(body.nome ?? ''), tamanho: Number(body.tamanho), tipo: body.mime });
    if (!arq.ok) return Response.json({ erro: arq.erro, campos: { arquivo: arq.erro } }, { status: 400 });

    const escritorioId = await escritorioDaEmpresa(empresaId);
    if (!podeGerirEntrega(g.sessao, { empresaId, escritorioId })) return negado();
    if ((await publicacoesRecentes(empresaId)) >= MAX_PUBLICACOES_HORA) {
      throw new ErroDoc('Muitos envios na última hora. Aguarde um pouco e tente de novo.', 429);
    }
    const r = await iniciarEntrega({
      empresaId, escritorioId, campos: v.campos, nome: arq.nome, tamanho: Number(body.tamanho), tipoArquivo: arq.tipo,
      autor: g.sessao.email,
    });
    return Response.json(r);
  } catch (e) { return falha(e); }
}

/** `acao`: confirmar (fim da publicação; só quem iniciou) · restaurar (desfazer a exclusão). */
export async function PATCH(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json().catch(() => ({}));
    const e = await lerEntrega(String(body.id ?? ''));
    if (!e || !podeVerRegistro(g.sessao, e)) return naoEncontrado('Documento');
    { const r = await respostaNegadaEmpresa(g.sessao, e.empresaId); if (r) return r; }
    if (!podeGerirEntrega(g.sessao, e)) return negado();
    switch (body.acao) {
      case 'confirmar':
        if (e.excluidoEm || e.publicadoPor !== g.sessao.email) return negado();
        return Response.json({ entrega: entregaPublica(await confirmarEntrega(e), true) });
      case 'restaurar':
        if (e.excluidoEm) await restaurarEntrega(e);
        return Response.json({ ok: true });
      default:
        throw new ErroDoc('Ação inválida.');
    }
  } catch (e) { return falha(e); }
}

/** Exclusão lógica — a tela oferece "Desfazer" (PATCH restaurar). */
export async function DELETE(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const e = await lerEntrega(req.nextUrl.searchParams.get('id') ?? '');
    if (!e || e.excluidoEm || !podeVerRegistro(g.sessao, e)) return naoEncontrado('Documento');
    { const r = await respostaNegadaEmpresa(g.sessao, e.empresaId); if (r) return r; }
    if (!podeGerirEntrega(g.sessao, e)) return negado();
    await excluirEntrega(e, g.sessao.email);
    return Response.json({ ok: true });
  } catch (e) { return falha(e); }
}
