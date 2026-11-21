// GET /api/revisao-ponto?empresa=&ano=&mes= — revisão inteligente das folhas de
// ponto salvas da empresa no mês (lib/revisaoPonto.ts).
//
// Uma leitura das frequências (o mês + a última semana do anterior, para a
// interjornada e o 7º dia seguido na virada) e o cálculo em memória. Só alerta,
// nunca altera o dado. Devolve também os dias de cada funcionário, para a
// Timesheet abrir a folha e corrigir. Contabilidade apenas (exigirEmpresaPonto:
// gestor + escritório da empresa); o cliente nem chega aqui (proxy.ts).
import { NextRequest } from 'next/server';
import { exigirEmpresaPonto, respostaErroPonto } from '@/lib/pontoAcesso';
import { lerFeriados, lerFrequenciasParaRevisao, lerFuncionarios } from '@/lib/pontoDb';
import { lerJornadaEmpresa } from '@/lib/cadastro';
import { revisarMes } from '@/lib/revisaoPonto';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const g = await exigirEmpresaPonto(req, searchParams.get('empresa'));
  if (!g.ok) return g.resposta;
  const ano = Number(searchParams.get('ano'));
  const mes = Number(searchParams.get('mes'));
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    return Response.json({ erro: 'Mês/ano inválidos.' }, { status: 400 });
  }

  try {
    const [freqs, feriadosArr, funcs, jornadaEmpresa] = await Promise.all([
      lerFrequenciasParaRevisao(g.escritorioId, g.empresa.id, ano, mes),
      lerFeriados(g.escritorioId),
      lerFuncionarios(g.escritorioId, g.empresa.id),
      lerJornadaEmpresa(g.empresa.id),
    ]);
    const feriados = new Set(feriadosArr.map((f) => f.data));
    const porNome = new Map(funcs.map((f) => [f.nome, f]));
    // Ordem do cadastro (empate de risco mantém a ordem da equipe).
    const ordem = (nome: string) => {
      const i = funcs.findIndex((f) => f.nome === nome);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    const doMes = [...freqs.doMes].sort((a, b) => ordem(a.funcionario) - ordem(b.funcionario) || a.funcionario.localeCompare(b.funcionario));
    const revisao = revisarMes(doMes.map((f) => {
      const cad = porNome.get(f.funcionario);
      return {
        funcionario: f.funcionario,
        dias: f.dias,
        anteriores: freqs.anteriores.get(f.funcionario),
        jornada: {
          utilMin: cad?.jornadaUtilMin ?? jornadaEmpresa.utilMin,
          sabadoMin: cad?.jornadaSabadoMin ?? jornadaEmpresa.sabadoMin,
          trabalhaSabado: jornadaEmpresa.trabalhaSabado,
        },
      };
    }), { ano, mes, feriados });

    return Response.json({
      ...revisao,
      folhas: doMes.map((f) => ({ funcionario: f.funcionario, dias: f.dias, anteriores: freqs.anteriores.get(f.funcionario) ?? [] })),
    });
  } catch (e) {
    return respostaErroPonto(e, 'Não foi possível revisar as folhas agora.');
  }
}
