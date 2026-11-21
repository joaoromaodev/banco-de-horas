// /api/resumo-folha — Resumo do ponto para a folha de pagamento (lib/resumoFolha.ts).
//
//   GET  ?empresa=&ano=&mes=[&formato=xlsx|csv][&banco=NOME…][&extra=50&dom=100&noturno=20]
//        Calcula o mês das folhas salvas (só horas e dias, nunca R$) e devolve o
//        resumo + o carimbo "conferido". Com `formato`, devolve o arquivo.
//   POST { empresa, ano, mes, conferido: boolean }
//        Marca/desmarca "conferido pela contadora" (migração 0022).
//
// Gestor + escritório da empresa (exigirEmpresaPonto); o cliente nem chega aqui
// (proxy.ts, ROTAS_PONTO). Não altera nenhuma folha.
import { NextRequest } from 'next/server';
import { exigirEmpresaPonto, respostaErroPonto } from '@/lib/pontoAcesso';
import { ErroBancoPendente, lerFeriados, lerFrequenciasParaRevisao, lerFuncionarios } from '@/lib/pontoDb';
import { lerJornadaEmpresa } from '@/lib/cadastro';
import { regrasDoEmpregado, resumirMes, resumoParaCsv, textoAssinatura, tituloPeriodo, type ResumoFolhaMes } from '@/lib/resumoFolha';
import { gerarPlanilhaResumo } from '@/lib/planilha';
import { assinar, lerConferencia, removerConferencia, salvarConferencia } from '@/lib/resumoFolhaDb';
import { MESES } from '@/lib/calendario';

export const runtime = 'nodejs';
export const maxDuration = 60;

function periodo(ano: number, mes: number): boolean {
  return Number.isInteger(ano) && ano >= 2000 && ano <= 2100 && Number.isInteger(mes) && mes >= 1 && mes <= 12;
}

const slug = (s: string) => s.normalize('NFD').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Percentual vindo da tela: número entre 0 e 300, senão o padrão. */
function pct(v: string | null): number | undefined {
  if (v === null || v.trim() === '') return undefined;
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 300 ? n : undefined;
}

async function calcular(g: { escritorioId: string; empresa: { id: string } }, ano: number, mes: number, p: URLSearchParams): Promise<ResumoFolhaMes> {
  const [freqs, feriadosArr, funcs, jornadaEmpresa] = await Promise.all([
    lerFrequenciasParaRevisao(g.escritorioId, g.empresa.id, ano, mes),
    lerFeriados(g.escritorioId),
    lerFuncionarios(g.escritorioId, g.empresa.id),
    lerJornadaEmpresa(g.empresa.id),
  ]);
  const feriados = new Set(feriadosArr.map((f) => f.data));
  const porNome = new Map(funcs.map((f) => [f.nome, f]));
  const banco = new Set(p.getAll('banco'));
  const ordem = (nome: string) => { const i = funcs.findIndex((f) => f.nome === nome); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  const doMes = [...freqs.doMes].sort((a, b) => ordem(a.funcionario) - ordem(b.funcionario) || a.funcionario.localeCompare(b.funcionario));
  return resumirMes(doMes.map((f) => ({
    funcionario: f.funcionario,
    dias: f.dias,
    anteriores: freqs.anteriores.get(f.funcionario),
    regras: regrasDoEmpregado(porNome.get(f.funcionario), jornadaEmpresa, f.funcionario, banco),
  })), {
    ano, mes, feriados,
    percentuais: { extraUtil: pct(p.get('extra')), extraDomFeriado: pct(p.get('dom')), adicionalNoturno: pct(p.get('noturno')) },
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const g = await exigirEmpresaPonto(req, searchParams.get('empresa'));
  if (!g.ok) return g.resposta;
  const ano = Number(searchParams.get('ano'));
  const mes = Number(searchParams.get('mes'));
  if (!periodo(ano, mes)) return Response.json({ erro: 'Mês/ano inválidos.' }, { status: 400 });

  try {
    const resumo = await calcular(g, ano, mes, searchParams);
    // Carimbo: sem a 0022 o resumo segue funcionando, só o "conferido" fica indisponível.
    let conferido: { por: string; em: string; atual: boolean } | null = null;
    let conferidoIndisponivel = false;
    try {
      const c = await lerConferencia(g.escritorioId, g.empresa.id, ano, mes);
      if (c) conferido = { por: c.por, em: c.em, atual: c.assinatura === assinar(textoAssinatura(resumo)) };
    } catch (e) {
      if (!(e instanceof ErroBancoPendente)) throw e;
      conferidoIndisponivel = true;
    }

    const formato = searchParams.get('formato');
    const base = `${slug(g.empresa.nome || g.empresa.id)}_resumo_folha_${MESES[mes]}_${ano}`;
    if (formato === 'csv') {
      return new Response(resumoParaCsv(resumo), {
        headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${base}.csv"` },
      });
    }
    if (formato === 'xlsx') {
      const dataBr = conferido?.atual ? new Date(conferido.em).toLocaleDateString('pt-BR', { timeZone: 'America/Belem' }) : '';
      const wb = gerarPlanilhaResumo(resumo, g.empresa.nome, conferido?.atual ? `${conferido.por} em ${dataBr}` : null);
      const buf = await wb.xlsx.writeBuffer();
      return new Response(buf as ArrayBuffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${base}.xlsx"`,
        },
      });
    }
    return Response.json({ resumo, periodo: tituloPeriodo(resumo), conferido, conferidoIndisponivel });
  } catch (e) {
    return respostaErroPonto(e, 'Não foi possível montar o resumo agora.');
  }
}

export async function POST(req: NextRequest) {
  let corpo: { empresa?: string; ano?: number; mes?: number; conferido?: boolean; banco?: string[] };
  try { corpo = await req.json(); } catch { return Response.json({ erro: 'JSON inválido.' }, { status: 400 }); }
  const g = await exigirEmpresaPonto(req, corpo.empresa);
  if (!g.ok) return g.resposta;
  const ano = Number(corpo.ano);
  const mes = Number(corpo.mes);
  if (!periodo(ano, mes)) return Response.json({ erro: 'Mês/ano inválidos.' }, { status: 400 });

  try {
    if (corpo.conferido === false) {
      await removerConferencia(g.escritorioId, g.empresa.id, ano, mes);
      return Response.json({ ok: true, conferido: null });
    }
    // A assinatura sai do cálculo do servidor, com os mesmos ajustes que a tela estava vendo.
    const p = new URLSearchParams();
    for (const b of corpo.banco ?? []) p.append('banco', String(b));
    const resumo = await calcular(g, ano, mes, p);
    await salvarConferencia(g.escritorioId, g.empresa.id, ano, mes, g.sessao.email, assinar(textoAssinatura(resumo)));
    return Response.json({ ok: true, conferido: { por: g.sessao.email, em: new Date().toISOString(), atual: true } });
  } catch (e) {
    return respostaErroPonto(e, 'Não foi possível registrar a conferência.');
  }
}
