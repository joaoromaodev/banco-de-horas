// GET/POST /api/caixa/fiscal — dados fiscais da empresa para o Termo de Abertura.
//
// É trabalho da contabilidade (a contadora preenche uma vez por empresa; ver a
// pendência 2 em docs/livro-caixa.md), então exige gestor — o cliente não mexe,
// mesmo alcançando /api/caixa. O contador só toca nas empresas dele.
import { NextRequest } from 'next/server';
import { exigirGestor, podeAcessarEmpresa } from '@/lib/acesso';
import { DadosFiscais, ErroCaixa, lerFiscal, salvarFiscal } from '@/lib/caixa';

export const runtime = 'nodejs';

function falha(e: unknown) {
  if (e instanceof ErroCaixa) return Response.json({ erro: e.message }, { status: e.status });
  return Response.json({ erro: e instanceof Error ? e.message : 'Falha no fiscal.' }, { status: 502 });
}

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const empresa = req.nextUrl.searchParams.get('empresa') ?? '';
    if (!empresa.trim()) throw new ErroCaixa('Informe a empresa.');
    if (!(await podeAcessarEmpresa(g.sessao, empresa))) throw new ErroCaixa('Acesso restrito a esta empresa.', 403);
    return Response.json({ fiscal: await lerFiscal(empresa) });
  } catch (e) {
    return falha(e);
  }
}

export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json();
    const empresa = String(body.empresa ?? '').trim();
    if (!empresa) throw new ErroCaixa('Informe a empresa.');
    if (!(await podeAcessarEmpresa(g.sessao, empresa))) throw new ErroCaixa('Acesso restrito a esta empresa.', 403);

    const f = (body.fiscal ?? {}) as Partial<DadosFiscais>;
    const dados: DadosFiscais = {
      endereco: f.endereco ?? null,
      numeroEndereco: f.numeroEndereco ?? null,
      municipio: f.municipio ?? null,
      estado: f.estado ?? null,
      inscricaoEstadual: f.inscricaoEstadual ?? null,
      inscricaoMunicipal: f.inscricaoMunicipal ?? null,
      registroJunta: f.registroJunta ?? null,
      registroNumero: f.registroNumero ?? null,
      prefeitura: f.prefeitura ?? null,
      cidadeTermo: f.cidadeTermo ?? null,
      contabilista: String(f.contabilista ?? '').trim() || 'Edilse Goes da Costa',
      crc: String(f.crc ?? '').trim() || '01619/0-3',
    };
    await salvarFiscal(empresa, dados, g.sessao.email);
    return Response.json({ ok: true });
  } catch (e) {
    return falha(e);
  }
}
