// /api/caixa/extrato — extrato bancário no Livro Caixa (Sprint 17, Frente D).
//
// GET   ?empresa=                          → o modo da empresa ('par' | 'direto')
// PATCH { empresa, modo }                   → muda o modo (precisa da 0035)
// POST  { empresa, arquivo: { nome, base64 } | documento, mapa? }
//        → lê o OFX/CSV e devolve a CONFERÊNCIA: cada linha com o que viraria no
//          caixa (sugestão, conta pela caixaInteligente), o que já casou com o livro
//          e o que está no caixa e não no banco. NADA é gravado aqui — quem grava é
//          POST /api/caixa/extrato/lote, com a escolha da contadora.
//
// Só a contabilidade (exigirGestor): conciliar é o trabalho dela no módulo ("a
// empresa lança, a contadora concilia"), e a regra da conta bancária fora do caixa
// ainda tem pergunta aberta com a Edilse — o cliente que quiser manda o OFX pelo
// portal (Documentos) e a contadora importa de lá (`documento`).
// Sem serviço externo nem IA: o arquivo é lido aqui.
import { NextRequest } from 'next/server';
import { exigirGestor, motivoNegado } from '@/lib/acesso';
import { contasDaEmpresa, ErroCaixa, historicosDaEmpresa } from '@/lib/caixa';
import { exemplosDaEmpresa } from '@/lib/caixaInteligente';
import { lerEmpresa } from '@/lib/cadastro';
import { podeVerRegistro } from '@/lib/documentos';
import { baixarArquivo, ErroDoc, lerDocumento } from '@/lib/documentosServidor';
import {
  conciliar, decodificarExtrato, JANELA_DIAS, lerExtrato, MAX_BYTES_EXTRATO, MODOS, somarDias, sugerirPerna,
  type ModoExtrato,
} from '@/lib/extratoBancario';
import { fechadosPorAno, lancamentosDoPeriodo, lerModoExtrato, marcasDoExtrato, salvarModoExtrato } from '@/lib/extratoServidor';
import { Limitador } from '@/lib/limite';
import { visaoDoCatalogo } from '@/lib/visibilidadeCatalogo';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** Freio por usuário (ler e conciliar gasta CPU): 30 leituras a cada 10 min. */
const ritmo = new Limitador(30, 10 * 60_000);

const TIPOS_EXTRATO = ['application/x-ofx', 'text/csv'];

function falha(e: unknown) {
  if (e instanceof ErroCaixa || e instanceof ErroDoc) return Response.json({ erro: e.message }, { status: e.status });
  console.error('[caixa] extrato', e instanceof Error ? e.message : e);
  return Response.json({ erro: 'Não foi possível ler o extrato agora. Tente de novo.' }, { status: 502 });
}

async function guarda(req: NextRequest, empresa: string) {
  const g = await exigirGestor(req);
  if (!g.ok) return g;
  if (!empresa) return { ok: false as const, resposta: Response.json({ erro: 'Informe a empresa.' }, { status: 400 }) };
  const n = await motivoNegado(g.sessao, empresa);
  if (n) return { ok: false as const, resposta: Response.json({ erro: n.erro }, { status: n.status }) };
  return g;
}

export async function GET(req: NextRequest) {
  const empresa = (req.nextUrl.searchParams.get('empresa') ?? '').trim();
  const g = await guarda(req, empresa);
  if (!g.ok) return g.resposta;
  try {
    return Response.json(await lerModoExtrato(empresa));
  } catch (e) { return falha(e); }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const empresa = String(body.empresa ?? '').trim();
  const g = await guarda(req, empresa);
  if (!g.ok) return g.resposta;
  try {
    const modo = body.modo as ModoExtrato;
    if (!MODOS.includes(modo)) throw new ErroCaixa('Modo inválido.');
    const dados = await lerEmpresa(empresa);
    await salvarModoExtrato(empresa, dados?.escritorioId ?? null, modo, g.sessao.email);
    return Response.json({ ok: true, modo });
  } catch (e) { return falha(e); }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const empresa = String(body.empresa ?? '').trim();
  const g = await guarda(req, empresa);
  if (!g.ok) return g.resposta;
  try {
    let bytes: Uint8Array;
    let origem: { nome: string; documento: string | null };
    if (typeof body.documento === 'string' && body.documento.trim()) {
      // O extrato que o cliente mandou pelo portal: da MESMA empresa, do escritório
      // da sessão, recebido ou conferido e não excluído.
      const d = await lerDocumento(body.documento.trim());
      if (!d || d.excluidoEm || d.empresaId !== empresa || !podeVerRegistro(g.sessao, d)
        || (d.status !== 'recebido' && d.status !== 'conferido')) {
        throw new ErroCaixa('Documento não encontrado.', 404);
      }
      if (!TIPOS_EXTRATO.includes(d.tipo)) throw new ErroCaixa('Escolha um extrato em OFX ou CSV.', 415);
      if (!ritmo.tentar(g.sessao.email.toLowerCase())) throw new ErroCaixa('Muitas leituras em pouco tempo. Espere alguns minutos.', 429);
      bytes = await baixarArquivo(d);
      origem = { nome: d.nome, documento: d.id };
    } else {
      const a = body.arquivo as { nome?: unknown; base64?: unknown } | undefined;
      if (!a || typeof a.base64 !== 'string' || !a.base64) throw new ErroCaixa('Escolha o arquivo do extrato (OFX ou CSV).');
      if (a.base64.length > Math.ceil(MAX_BYTES_EXTRATO * 4 / 3) + 4) throw new ErroCaixa('O extrato passa de 2 MB. Exporte um período menor.', 413);
      if (!ritmo.tentar(g.sessao.email.toLowerCase())) throw new ErroCaixa('Muitas leituras em pouco tempo. Espere alguns minutos.', 429);
      bytes = new Uint8Array(Buffer.from(a.base64, 'base64'));
      origem = { nome: String(a.nome ?? 'extrato').slice(0, 120), documento: null };
    }
    if (bytes.length === 0) throw new ErroCaixa('O arquivo está vazio.');
    if (bytes.length > MAX_BYTES_EXTRATO) throw new ErroCaixa('O extrato passa de 2 MB. Exporte um período menor.', 413);

    const r = lerExtrato(decodificarExtrato(bytes), body.mapa);
    if (!r.ok) return Response.json({ erro: r.erro, csv: r.csv ?? null, origem }, { status: 422 });
    const leitura = r.leitura;

    const anos = [...new Set(leitura.linhas.map((l) => Number(l.data.slice(0, 4))))];
    const visao = visaoDoCatalogo(g.sessao);
    const [{ modo, instalada }, caixa, marcas, fechados, { exemplos }, contas, analiticas] = await Promise.all([
      lerModoExtrato(empresa),
      // ± a janela do casamento: lançamento de 31/12 casa com o banco de 02/01.
      lancamentosDoPeriodo(empresa, somarDias(leitura.periodo.de, -JANELA_DIAS), somarDias(leitura.periodo.ate, JANELA_DIAS)),
      marcasDoExtrato(empresa, leitura.linhas.map((l) => l.chave)),
      fechadosPorAno(empresa, anos),
      exemplosDaEmpresa(empresa), contasDaEmpresa(empresa, visao), historicosDaEmpresa(empresa, visao),
    ]);
    const base = { exemplos, contas, analiticas };
    const c = conciliar(leitura.linhas, caixa, {
      modo, periodo: leitura.periodo, marcas: marcas ?? undefined, fechadosPorAno: fechados,
      sugerir: (p) => sugerirPerna(p, base),
    });

    return Response.json({
      origem, modo, instalada: instalada && marcas !== null,
      formato: leitura.formato, conta: leitura.conta, periodo: leitura.periodo,
      descartadas: leitura.descartadas, avisos: leitura.avisos, csv: leitura.csv ?? null,
      ...c,
    });
  } catch (e) { return falha(e); }
}
