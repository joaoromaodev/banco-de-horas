// GET /api/folha?empresa=<id>&funcionario=<nome>&ano=&mes= — folha de ponto
// em branco (PDF) de um funcionário, para preencher à mão.
import { NextRequest } from 'next/server';
import { exigirEmpresaPonto, respostaErroPonto } from '@/lib/pontoAcesso';
import { gerarFolhaPontoPDF } from '@/lib/folhaPonto';
import { lerFeriados, lerFuncionarios } from '@/lib/pontoDb';
import { lerJornadaEmpresa } from '@/lib/cadastro';
import { MESES } from '@/lib/calendario';

export const runtime = 'nodejs';

function slug(s: string): string {
  return s.normalize('NFD').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const g = await exigirEmpresaPonto(req, searchParams.get('empresa'));
  if (!g.ok) return g.resposta;
  const funcionario = (searchParams.get('funcionario') || '').trim();
  const ano = Number(searchParams.get('ano'));
  const mes = Number(searchParams.get('mes'));

  if (!funcionario) return Response.json({ erro: 'Informe o funcionário.' }, { status: 400 });
  if (!ano || !mes || mes < 1 || mes > 12) return Response.json({ erro: 'Mês/ano inválidos.' }, { status: 400 });

  try {
    const [feriadosArr, funcs, jornada] = await Promise.all([
      lerFeriados(g.escritorioId),
      lerFuncionarios(g.escritorioId, g.empresa.id),
      lerJornadaEmpresa(g.empresa.id),
    ]);
    const cargo = funcs.find((f) => f.nome === funcionario)?.cargo ?? null;
    const feriados = new Set(feriadosArr.map((f) => f.data));
    const pdf = await gerarFolhaPontoPDF({ nomeEmpresa: g.empresa.nome, funcionario, cargo, ano, mes, feriados, jornada });

    const nome = `folha_${slug(funcionario)}_${MESES[mes]}_${ano}.pdf`;
    return new Response(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${nome}"`,
      },
    });
  } catch (e) {
    return respostaErroPonto(e, 'Falha ao gerar a folha.');
  }
}
