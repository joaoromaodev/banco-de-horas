// GET /api/inicio-cliente — o que pede ação do cliente (página inicial `/inicio`).
//
// Só o papel `cliente`, e só da empresa da própria sessão (nunca `?empresa=`).
// Contabilidade não usa esta rota: tem o painel. Cada fonte falha sozinha e vira
// `indisponiveis` na resposta; o resto segue. Somente leitura — exceto a abertura
// dos pedidos mensais do escritório na primeira visita do mês (lib/pedidosNaVisita),
// que não depende do cron e falha sozinha.
import { NextRequest } from 'next/server';
import { exigirEmpresa, sessaoDe } from '@/lib/acesso';
import { lerEmpresa } from '@/lib/cadastro';
import { hojeBelem } from '@/lib/contratos';
import { Fonte, mesAnterior, montarInicioCliente } from '@/lib/inicioCliente';
import { abrirPedidosNaVisita } from '@/lib/pedidosNaVisita';
import {
  lerDocumentosDevolvidos, lerEntregasNaoAbertas, lerFolhasDevolvidas, lerMovimento, lerPendenciasAbertas, lerUltimoDemonstrativo,
} from '@/lib/inicioClienteServidor';

export const runtime = 'nodejs';

async function fonte<T>(nome: string, fn: () => Promise<T>): Promise<Fonte<T>> {
  try { return { ok: true, dados: await fn() }; } catch (e) {
    console.error(`[inicio-cliente] ${nome}:`, (e as { code?: string })?.code ?? '', e instanceof Error ? e.message.slice(0, 160) : '');
    return { ok: false };
  }
}

export async function GET(req: NextRequest) {
  const s = await sessaoDe(req);
  if (!s) return Response.json({ erro: 'Não autenticado.' }, { status: 401 });
  if (s.role !== 'cliente' || !s.empresa || !s.escritorioId) return Response.json({ erro: 'Acesso restrito.' }, { status: 403 });
  const empresaId = s.empresa;
  const escritorioId = s.escritorioId;
  const g = await exigirEmpresa(req, empresaId);
  if (!g.ok) return g.resposta;

  const hoje = hojeBelem();
  await abrirPedidosNaVisita(escritorioId, hoje);
  const atual = { ano: Number(hoje.slice(0, 4)), mes: Number(hoje.slice(5, 7)) };
  const empresa = await lerEmpresa(empresaId).catch(() => null);
  const [movimento, pendencias, folhasDevolvidas, demonstrativo, entregas, devolvidos] = await Promise.all([
    fonte('movimento', () => lerMovimento(empresaId, [mesAnterior(hoje), atual])),
    fonte('pendencias', () => lerPendenciasAbertas(empresaId, escritorioId)),
    fonte('folhas', () => lerFolhasDevolvidas(empresaId, escritorioId)),
    fonte('demonstrativo', () => lerUltimoDemonstrativo(empresaId, hoje)),
    fonte('entregas', () => lerEntregasNaoAbertas(empresaId, escritorioId)),
    fonte('devolvidos', () => lerDocumentosDevolvidos(empresaId, escritorioId)),
  ]);
  const inicio = montarInicioCliente({
    hoje, empresaNome: empresa?.nome ?? '', movimento, pendencias, folhasDevolvidas, demonstrativo, entregas, devolvidos,
  });
  return Response.json(inicio, { headers: { 'Cache-Control': 'no-store' } });
}
