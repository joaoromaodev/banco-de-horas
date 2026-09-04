// GET  /api/caixa/livro?empresa=&ano=&formato=pdf|xlsx — o livro caixa inteiro
//      (Termo de Abertura + 12 meses + Termo de Encerramento) para entrega.
// POST /api/caixa/livro — grava os campos por-livro do termo (nº do livro, nº de
//      ordem, data), que ficam em `exercicios`.
//
// Só gestor, e só das empresas dele. A identidade vem de `empresas`, o fiscal de
// `empresa_fiscal` e os campos por-livro de `exercicios` — ver docs/livro-caixa.md.
import { NextRequest } from 'next/server';
import { exigirGestor, exigirEmpresa, podeAcessarEmpresa } from '@/lib/acesso';
import { ErroCaixa, montarLivro, garantirExercicio, salvarTermo } from '@/lib/caixa';
import { gerarLivroCaixaPDF } from '@/lib/livroCaixa';
import { gerarLivroCaixaXLSX } from '@/lib/planilhaCaixa';

export const runtime = 'nodejs';

function slug(s: string): string {
  return s.normalize('NFD').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'livro';
}

function anoDe(v: string | null): number {
  const ano = Number(v);
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new ErroCaixa('Ano inválido.');
  return ano;
}

function falha(e: unknown) {
  if (e instanceof ErroCaixa) return Response.json({ erro: e.message }, { status: e.status });
  return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao gerar o livro.' }, { status: 502 });
}

export async function GET(req: NextRequest) {
  const empresa = req.nextUrl.searchParams.get('empresa') ?? '';
  const g = await exigirEmpresa(req, empresa);
  if (!g.ok) return g.resposta;
  // Documentos são entrega da contabilidade — o cliente não baixa o livro fechado.
  if (g.sessao.role === 'cliente') return Response.json({ erro: 'Acesso restrito.' }, { status: 403 });

  try {
    const ano = anoDe(req.nextUrl.searchParams.get('ano'));
    const formato = (req.nextUrl.searchParams.get('formato') ?? 'pdf').toLowerCase();
    const dados = await montarLivro(empresa, ano);
    const base = `livro_caixa_${slug(dados.empresa.nome)}_${ano}`;

    if (formato === 'xlsx') {
      const buffer = await gerarLivroCaixaXLSX(dados);
      return new Response(buffer as ArrayBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${base}.xlsx"`,
        },
      });
    }

    const { pdf, qtdFolhas } = await gerarLivroCaixaPDF(dados);
    // A qtd de folhas é o total de páginas; grava para o termo citá-la e o painel exibi-la.
    await salvarTermo(dados.exercicioId, { qtdFolhas });
    return new Response(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${base}.pdf"`,
      },
    });
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

    const ano = anoDe(String(body.ano ?? ''));
    const ex = await garantirExercicio(empresa, ano);
    await salvarTermo(ex.id, {
      numeroLivro: body.numeroLivro,
      numeroOrdem: body.numeroOrdem,
      dataTermo: body.dataTermo,
    });
    return Response.json({ ok: true });
  } catch (e) {
    return falha(e);
  }
}
