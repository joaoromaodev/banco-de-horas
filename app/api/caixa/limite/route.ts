// GET /api/caixa/limite?empresa= — alerta de limite de faturamento da empresa (MEI/Simples).
// PUT /api/caixa/limite — a contabilidade informa a data de abertura (limite proporcional no 1º ano).
//
// O cliente enxerga o alerta da própria empresa (é o caixa que ele mesmo lança);
// só a contabilidade grava. O texto é sempre "estimativa pelo caixa — confirme"
// (lib/limiteFaturamento.ts). Sem regime MEI/Simples registrado: `alerta: null`.
import { NextRequest } from 'next/server';
import { ehGestor, exigirEmpresa } from '@/lib/acesso';
import { hojeBelem, isoValida } from '@/lib/agenda';
import { lerEmpresa } from '@/lib/cadastro';
import { alertasDasEmpresas, regimesComLimite, salvarAbertura } from '@/lib/limiteFaturamentoServidor';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const empresa = req.nextUrl.searchParams.get('empresa') ?? '';
  const g = await exigirEmpresa(req, empresa);
  if (!g.ok) return g.resposta;
  try {
    const emp = await lerEmpresa(empresa);
    const [item] = await alertasDasEmpresas([empresa], emp?.escritorioId ?? null, hojeBelem());
    return Response.json(
      { alerta: item?.alerta ?? null, abertura: item?.abertura ?? null, podeEditar: ehGestor(g.sessao) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    console.error('[caixa/limite]', e instanceof Error ? e.message : e);
    return Response.json({ erro: 'Não foi possível calcular o limite agora.' }, { status: 502 });
  }
}

export async function PUT(req: NextRequest) {
  let corpo: { empresa?: unknown; abertura?: unknown } = {};
  try { corpo = await req.json(); } catch { /* corpo inválido: cai na validação */ }
  const empresa = String(corpo.empresa ?? '');
  const g = await exigirEmpresa(req, empresa);
  if (!g.ok) return g.resposta;
  if (!ehGestor(g.sessao)) return Response.json({ erro: 'Acesso restrito.' }, { status: 403 });

  const bruto = corpo.abertura == null || corpo.abertura === '' ? null : String(corpo.abertura);
  if (bruto !== null && !isoValida(bruto)) return Response.json({ erro: 'Informe a data no formato AAAA-MM-DD.' }, { status: 400 });
  try {
    const emp = await lerEmpresa(empresa);
    const regimes = await regimesComLimite([empresa], emp?.escritorioId ?? null);
    if (!regimes.has(empresa)) {
      return Response.json({ erro: 'Registre o regime da empresa (MEI ou Simples) na Agenda antes de informar a abertura.' }, { status: 409 });
    }
    await salvarAbertura(empresa, bruto);
    return Response.json({ ok: true, abertura: bruto });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === '42703') return Response.json({ erro: 'Falta aplicar a migração 0023 do banco.' }, { status: 503 });
    console.error('[caixa/limite PUT]', e instanceof Error ? e.message : e);
    return Response.json({ erro: 'Não foi possível salvar.' }, { status: 502 });
  }
}
