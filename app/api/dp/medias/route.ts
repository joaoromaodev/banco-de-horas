// GET /api/dp/medias?id=&ate=AAAA-MM-DD — horas de HE e adicional noturno do ponto do
// empregado, mês a mês, para as médias da simulação de rescisão (lib/mediasPonto.ts).
//
// Só leitura e só horas (nunca R$): o valor sai no navegador, com o salário da simulação.
// Devolve até 48 meses antes de `ate` (desde a admissão), inclusive o mês de `ate`: o
// aviso usa 12, o 13º o ano e as férias o aquisitivo (vencidas em dobro podem ser antigas).
// Acesso: mesma guarda da ficha (exigirEmpregado → só a contabilidade do escritório da
// empresa; o cliente não chega a /api/dp — proxy.ts).
import { NextRequest } from 'next/server';
import { funcionarioDoPonto, lerPontoDoEmpregado } from '@/lib/dpServidor';
import { isoOk, jornadaDaFolha, temBancoDeHoras } from '@/lib/dp';
import { conjuntoFeriados } from '@/lib/ferias';
import { diasNoMes } from '@/lib/calendario';
import { mesesEntre, mesPontoDoResumo, somarMes } from '@/lib/mediasPonto';
import { exigirEmpregado, feriadosDoEscritorio, respostaErroDp } from '../comum';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** Quantos meses antes de `ate` a rota devolve. */
const MESES_MEDIAS = 48;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const r = await exigirEmpregado(req, p.get('id'));
  if (!r.ok) return r.resposta;
  const { empregado: e, guarda: g } = r;
  const ate = p.get('ate') ?? '';
  if (!isoOk(ate)) return Response.json({ erro: 'Informe a data do desligamento.' }, { status: 400 });
  if (!e.admissao) return Response.json({ meses: [] });
  const ultimo = ate.slice(0, 7);
  const primeiroPossivel = somarMes(ultimo, -(MESES_MEDIAS - 1));
  const desde = e.admissao.slice(0, 7) > primeiroPossivel ? e.admissao.slice(0, 7) : primeiroPossivel;
  if (desde > ultimo) return Response.json({ meses: [] });
  try {
    const [dias, funcionario, feriadosEsc] = await Promise.all([
      lerPontoDoEmpregado(g.escritorioId, e, desde, ultimo),
      funcionarioDoPonto(g.escritorioId, e),
      feriadosDoEscritorio(g.escritorioId),
    ]);
    const anos: number[] = [];
    for (let a = Number(desde.slice(0, 4)); a <= Number(ultimo.slice(0, 4)); a++) anos.push(a);
    const feriados = conjuntoFeriados(anos, feriadosEsc);
    const empresa = {
      utilMin: g.empresa.jornadaUtilMin ?? 480, sabadoMin: g.empresa.jornadaSabadoMin ?? 240, trabalhaSabado: g.empresa.trabalhaSabado,
    };
    const jornada = jornadaDaFolha(e, funcionario, empresa);
    const meses = mesesEntre(desde, ultimo).map((mes) => {
      const [a, m] = mes.split('-').map(Number);
      const fimDoMes = `${mes}-${String(diasNoMes(a, m)).padStart(2, '0')}`;
      return mesPontoDoResumo(mes, dias.get(mes), { jornada, temBanco: temBancoDeHoras(e, fimDoMes) }, feriados);
    });
    return Response.json({ meses });
  } catch (err) { return respostaErroDp(err, 'Não foi possível ler o ponto para as médias.'); }
}
