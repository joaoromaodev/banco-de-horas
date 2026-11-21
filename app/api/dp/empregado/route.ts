// GET /api/dp/empregado?id= — a ficha do empregado: cadastro, férias programadas,
// faltas e meses com ponto lançado (para dizer se a contagem do art. 130 está completa),
// a jornada diária do cadastro do ponto e os feriados do escritório.
import { NextRequest } from 'next/server';
import { funcionarioDoPonto, lerFaltas, listarFerias, mesesComPonto } from '@/lib/dpServidor';
import { baseAquisitivo } from '@/lib/ferias';
import { exigirEmpregado, feriadosDoEscritorio, respostaErroDp } from '../comum';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const r = await exigirEmpregado(req, req.nextUrl.searchParams.get('id'));
  if (!r.ok) return r.resposta;
  const { empregado: e, guarda: g } = r;
  try {
    const base = baseAquisitivo(e);
    const desdeAno = base ? Number(base.slice(0, 4)) : new Date().getUTCFullYear() - 1;
    const [ferias, faltas, meses, funcionario, feriados] = await Promise.all([
      listarFerias(g.escritorioId, { empregadoId: e.id }),
      lerFaltas(g.escritorioId, [e]),
      mesesComPonto(g.escritorioId, e, desdeAno),
      funcionarioDoPonto(g.escritorioId, e),
      feriadosDoEscritorio(g.escritorioId),
    ]);
    return Response.json({
      empregado: e, ferias, faltas: faltas.get(e.id) ?? [], mesesComPonto: meses, funcionario, feriados,
      empresa: { id: g.empresa.id, nome: g.empresa.nome, jornadaUtilMin: g.empresa.jornadaUtilMin ?? null, jornadaSabadoMin: g.empresa.jornadaSabadoMin ?? null, trabalhaSabado: g.empresa.trabalhaSabado },
    });
  } catch (e) { return respostaErroDp(e, 'Falha ao carregar a ficha.'); }
}
