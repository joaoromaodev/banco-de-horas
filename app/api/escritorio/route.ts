// /api/escritorio — configurações do PRÓPRIO escritório (tela "Escritório").
//
// Leitura: qualquer contador do escritório (o master pode olhar um, com
// `?escritorio=`). Gravação: só o administrador do escritório, e sempre no
// escritório da sessão — o corpo nunca escolhe qual escritório mexer.
import { NextRequest } from 'next/server';
import { exigirAdminEscritorio, exigirGestor } from '@/lib/acesso';
import { acessoAoEscritorio, validarConfig } from '@/lib/escritorioConfig';
import { contarSemContabilista, ErroEscritorio, escritorioOuErro, salvarConfig } from '@/lib/escritorioServidor';
import { falha } from './comum';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  const id = g.sessao.role === 'master'
    ? (req.nextUrl.searchParams.get('escritorio') ?? '')
    : (g.sessao.escritorioId ?? '');
  const acesso = acessoAoEscritorio(g.sessao, id);
  if (!acesso) return Response.json({ erro: 'Informe o escritório.' }, { status: 400 });
  try {
    const [e, empresas] = await Promise.all([escritorioOuErro(id), contarSemContabilista(id)]);
    return Response.json({
      escritorio: {
        id: e.id, nome: e.nome, cnpj: e.cnpj, plano: e.plano, situacao: e.situacao,
        contabilistaNome: e.contabilistaNome, contabilistaCrc: e.contabilistaCrc,
        prazoPedidosPadrao: e.prazoPedidosPadrao,
      },
      podeEditar: acesso === 'editar', empresas,
    });
  } catch (err) { return falha(err); }
}

export async function PATCH(req: NextRequest) {
  const g = await exigirAdminEscritorio(req, 'altera os dados do escritório');
  if (!g.ok) return g.resposta;
  try {
    const id = g.sessao.escritorioId!;
    if (acessoAoEscritorio(g.sessao, id) !== 'editar') throw new ErroEscritorio('Acesso restrito.', 403);
    const v = validarConfig(await req.json().catch(() => ({})));
    if (!v.ok) return Response.json({ erro: Object.values(v.erros)[0], erros: v.erros }, { status: 400 });
    const e = await salvarConfig(id, v.config);
    return Response.json({
      escritorio: {
        id: e.id, nome: e.nome, cnpj: e.cnpj, plano: e.plano, situacao: e.situacao,
        contabilistaNome: e.contabilistaNome, contabilistaCrc: e.contabilistaCrc,
        prazoPedidosPadrao: e.prazoPedidosPadrao,
      },
      empresas: await contarSemContabilista(id),
    });
  } catch (err) { return falha(err); }
}
