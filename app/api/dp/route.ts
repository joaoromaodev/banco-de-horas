// /api/dp — empregados de uma empresa (Departamento Pessoal, migração 0021).
//
// GET  ?empresa=      → empregados, férias programadas, faltas do ponto e feriados do
//                       escritório (a tela calcula alertas, férias e 13º com lib/ferias.ts
//                       e lib/decimoTerceiro.ts).
// POST { empresa, dados }  → cadastra um empregado.
// PATCH { id, dados }      → edita (a empresa é a do registro, nunca a do corpo).
//
// Só a contabilidade (ver app/api/dp/comum.ts). Dado pessoal (CPF, salário) vai só
// para a contabilidade da empresa; nada disso entra em log.
import { NextRequest } from 'next/server';
import { exigirEmpresaPonto } from '@/lib/pontoAcesso';
import { cpfMascarado, validarEmpregado, type Empregado } from '@/lib/dp';
import {
  atualizarEmpregado, criarEmpregado, ErroDp, lerFaltas, listarEmpregados, listarFerias,
} from '@/lib/dpServidor';
import { exigirEmpregado, feriadosDoEscritorio, respostaErroDp } from './comum';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const g = await exigirEmpresaPonto(req, req.nextUrl.searchParams.get('empresa'));
  if (!g.ok) return g.resposta;
  try {
    const [empregados, ferias, feriados] = await Promise.all([
      listarEmpregados(g.escritorioId, [g.empresa.id]),
      listarFerias(g.escritorioId, { empresas: [g.empresa.id] }),
      feriadosDoEscritorio(g.escritorioId),
    ]);
    const faltas = await lerFaltas(g.escritorioId, empregados);
    // LGPD: a lista não precisa de CPF inteiro nem de salário — saem só na ficha.
    const resumo = (e: Empregado): Empregado => ({ ...e, cpf: e.cpf ? cpfMascarado(e.cpf) : null, salarioBase: null });
    return Response.json({
      empregados: empregados.map(resumo), ferias, feriados,
      faltas: Object.fromEntries(faltas),
      empresa: { id: g.empresa.id, nome: g.empresa.nome, jornadaUtilMin: g.empresa.jornadaUtilMin ?? null, jornadaSabadoMin: g.empresa.jornadaSabadoMin ?? null, trabalhaSabado: g.empresa.trabalhaSabado },
    });
  } catch (e) {
    if (e instanceof ErroDp && e.status === 503) {
      return Response.json({ empregados: [], ferias: [], feriados: [], faltas: {}, aguardandoBanco: true, erro: e.message });
    }
    return respostaErroDp(e, 'Falha ao carregar os empregados.');
  }
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ erro: 'Corpo inválido.' }, { status: 400 }); }
  const g = await exigirEmpresaPonto(req, String(body.empresa ?? ''));
  if (!g.ok) return g.resposta;
  const v = validarEmpregado((body.dados ?? {}) as Record<string, unknown>);
  if (!v.ok) return Response.json({ erro: v.erros.join(' ') }, { status: 400 });
  try {
    const empregado = await criarEmpregado(g.escritorioId, g.empresa.id, v.dados, g.sessao.email);
    return Response.json({ empregado });
  } catch (e) { return respostaErroDp(e, 'Falha ao cadastrar o empregado.'); }
}

export async function PATCH(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ erro: 'Corpo inválido.' }, { status: 400 }); }
  const r = await exigirEmpregado(req, String(body.id ?? ''));
  if (!r.ok) return r.resposta;
  const v = validarEmpregado((body.dados ?? {}) as Record<string, unknown>);
  if (!v.ok) return Response.json({ erro: v.erros.join(' ') }, { status: 400 });
  try {
    const empregado = await atualizarEmpregado(r.guarda.escritorioId, r.empregado.id, v.dados, r.guarda.sessao.email);
    return Response.json({ empregado });
  } catch (e) { return respostaErroDp(e, 'Falha ao salvar o empregado.'); }
}
