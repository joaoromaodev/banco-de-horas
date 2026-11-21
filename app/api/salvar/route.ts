// POST /api/salvar — grava a frequência revisada (Postgres, por escritório).
import { NextRequest } from 'next/server';
import { exigirEmpresaPonto, respostaErroPonto } from '@/lib/pontoAcesso';
import { salvarFrequencia } from '@/lib/pontoDb';
import { Frequencia } from '@/lib/tipos';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let freq: Frequencia;
  try {
    const body = await req.json();
    freq = body.frequencia;
  } catch {
    return Response.json({ erro: 'JSON inválido.' }, { status: 400 });
  }

  const g = await exigirEmpresaPonto(req, freq?.empresa);
  if (!g.ok) return g.resposta;

  const ano = Number(freq.ano);
  const mes = Number(freq.mes);
  if (!String(freq.funcionario ?? '').trim() || !Number.isInteger(ano) || ano < 2000 || ano > 2100
    || !Number.isInteger(mes) || mes < 1 || mes > 12 || !Array.isArray(freq.dias)) {
    return Response.json({ erro: 'Frequência incompleta (empresa, funcionário, mês e ano).' }, { status: 400 });
  }

  try {
    const dias = await salvarFrequencia(g.escritorioId, { ...freq, empresa: g.empresa.id, ano, mes }, g.sessao.email);
    return Response.json({ ok: true, dias });
  } catch (e) {
    return respostaErroPonto(e, 'Falha ao salvar a frequência.');
  }
}
