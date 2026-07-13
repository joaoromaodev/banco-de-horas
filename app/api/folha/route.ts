// GET /api/folha?empresa=<id>&funcionario=<nome>&ano=&mes= — folha de ponto
// em branco (.xlsx) de um funcionário, para preencher à mão.
import { NextRequest } from 'next/server';
import { gerarFolhaPontoPDF } from '@/lib/folhaPonto';
import { lerEmpresa, lerFeriados, lerFuncionarios, lerJornadaEmpresa } from '@/lib/sheets';
import { MESES } from '@/lib/calendario';

export const runtime = 'nodejs';

function slug(s: string): string {
  return s.normalize('NFD').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const empresa = (searchParams.get('empresa') || '').trim();
  const funcionario = (searchParams.get('funcionario') || '').trim();
  const ano = Number(searchParams.get('ano'));
  const mes = Number(searchParams.get('mes'));

  if (!empresa) return Response.json({ erro: 'Informe a empresa.' }, { status: 400 });
  if (!funcionario) return Response.json({ erro: 'Informe o funcionário.' }, { status: 400 });
  if (!ano || !mes || mes < 1 || mes > 12) return Response.json({ erro: 'Mês/ano inválidos.' }, { status: 400 });

  try {
    const [emp, feriadosArr, funcs, jornada] = await Promise.all([
      lerEmpresa(empresa),
      lerFeriados(),
      lerFuncionarios(empresa),
      lerJornadaEmpresa(empresa),
    ]);
    const cargo = funcs.find((f) => f.nome === funcionario)?.cargo ?? null;
    const feriados = new Set(feriadosArr.map((f) => f.data));
    const pdf = await gerarFolhaPontoPDF({ nomeEmpresa: emp?.nome ?? '', funcionario, cargo, ano, mes, feriados, jornada });

    const nome = `folha_${slug(funcionario)}_${MESES[mes]}_${ano}.pdf`;
    return new Response(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${nome}"`,
      },
    });
  } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Falha ao gerar folha.' }, { status: 502 });
  }
}
