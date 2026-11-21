// /api/dp/lote — edição em lote dos empregados de uma empresa (grade "Completar
// cadastro" e importação por planilha). Só preenche e atualiza, nunca apaga.
//
// GET  ?empresa=                       → empregados com o que a grade edita (salário incluso; sem CPF).
// POST multipart { empresa, arquivo }  → prévia da planilha (.xlsx/.csv): nada é gravado.
// POST { empresa, acao:'aplicar', itens:[{ id, entrada }] }
//        → refaz a validação NO SERVIDOR (o navegador não manda "o que mudou", manda o que
//          foi digitado), grava só as colunas que mudam e devolve `aplicados` para o Desfazer.
// POST { empresa, acao:'desfazer', itens:[{ id, campos }] }
//        → volta cada campo ao valor de antes, só se ainda estiver como foi gravado.
//
// Só a contabilidade (exigirEmpresaPonto: escritório vem da empresa; arquivada = 409 ao gravar).
import { NextRequest } from 'next/server';
import { exigirEmpresaPonto } from '@/lib/pontoAcesso';
import { hojeBelem } from '@/lib/agenda';
import type { DadosEmpregado, Empregado } from '@/lib/dp';
import {
  CAMPOS_LOTE, lerCelula, lerPlanilha, MAX_LINHAS_LOTE, planejarDesfazer, planejarLinha, previaPlanilha, resumoPlanos,
  type AplicadoLote, type CampoLote, type EmpregadoDoLote, type EntradaLote, type ValorLote,
} from '@/lib/dpLote';
import { lerArquivoPlanilha, MAX_BYTES_PLANILHA } from '@/lib/dpLoteArquivo';
import { atualizarCamposEmpregado, ErroDp, listarEmpregados } from '@/lib/dpServidor';
import { respostaErroDp } from '../comum';

export const runtime = 'nodejs';

const paraLote = (e: Empregado): EmpregadoDoLote => ({
  id: e.id, nome: e.nome, situacao: e.situacao, cpf: e.cpf, cargo: e.cargo, admissao: e.admissao, salarioBase: e.salarioBase,
  horasSemanais: e.horasSemanais, escala: e.escala, dsr: e.dsr, bancoHoras: e.bancoHoras, bancoHorasDesde: e.bancoHorasDesde,
  situacaoDesde: e.situacaoDesde, afastamentoTipo: e.afastamentoTipo, aquisitivoBase: e.aquisitivoBase,
});

export async function GET(req: NextRequest) {
  const g = await exigirEmpresaPonto(req, req.nextUrl.searchParams.get('empresa'));
  if (!g.ok) return g.resposta;
  try {
    const lista = await listarEmpregados(g.escritorioId, [g.empresa.id]);
    // Sem CPF: a grade não precisa dele (LGPD). Salário vai: é o que se completa aqui.
    const empregados = lista.map((e) => {
      const { cpf: _cpf, ...resto } = paraLote(e); // eslint-disable-line @typescript-eslint/no-unused-vars
      return resto;
    });
    return Response.json({ empregados }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof ErroDp && e.status === 503) return Response.json({ empregados: [], aguardandoBanco: true, erro: e.message });
    return respostaErroDp(e, 'Falha ao carregar os empregados.');
  }
}

const entradaSegura = (v: unknown): EntradaLote => {
  const r: EntradaLote = {};
  if (v && typeof v === 'object') {
    for (const c of CAMPOS_LOTE) {
      const x = (v as Record<string, unknown>)[c];
      if (typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean') r[c] = String(x).slice(0, 120);
    }
  }
  return r;
};

/** `antes` vindo do navegador passa pela mesma leitura das células (nada de valor solto no banco). */
function valorSeguro(campo: CampoLote, v: unknown): { ok: true; valor: ValorLote } | { ok: false } {
  if (v === null) return { ok: true, valor: null };
  if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') return { ok: false };
  const l = lerCelula(campo, typeof v === 'boolean' ? (v ? 'sim' : 'nao') : String(v));
  return !l.vazio && l.ok ? { ok: true, valor: l.valor } : { ok: false };
}

export async function POST(req: NextRequest) {
  const tipo = req.headers.get('content-type') ?? '';
  if (tipo.startsWith('multipart/form-data')) return previa(req);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return Response.json({ erro: 'Corpo inválido.' }, { status: 400 }); }
  const g = await exigirEmpresaPonto(req, String(body.empresa ?? ''));
  if (!g.ok) return g.resposta;
  const itens = Array.isArray(body.itens) ? (body.itens as Record<string, unknown>[]) : [];
  if (!itens.length) return Response.json({ erro: 'Nada para gravar.' }, { status: 400 });
  if (itens.length > MAX_LINHAS_LOTE) return Response.json({ erro: `No máximo ${MAX_LINHAS_LOTE} empregados por vez.` }, { status: 400 });
  const acao = String(body.acao ?? '');
  if (acao !== 'aplicar' && acao !== 'desfazer') return Response.json({ erro: 'Ação inválida.' }, { status: 400 });

  try {
    // Só empregados desta empresa e deste escritório (o id do navegador não vale por si só).
    const porId = new Map((await listarEmpregados(g.escritorioId, [g.empresa.id])).map((e) => [e.id, paraLote(e)]));
    const por = g.sessao.email;
    const vistos = new Set<string>();

    if (acao === 'aplicar') {
      const hoje = hojeBelem();
      const aplicados: AplicadoLote[] = [];
      const falhas: { id: string; nome: string; erro: string }[] = [];
      let semMudanca = 0;
      for (const it of itens) {
        const id = String(it.id ?? '');
        const e = porId.get(id);
        if (!e || vistos.has(id)) { falhas.push({ id, nome: e?.nome ?? '', erro: e ? 'Empregado repetido na lista.' : 'Empregado não encontrado nesta empresa.' }); continue; }
        vistos.add(id);
        const plano = planejarLinha(e, entradaSegura(it.entrada), hoje);
        if (plano.status === 'erro') { falhas.push({ id, nome: e.nome, erro: [...Object.values(plano.erros), plano.erroLinha].filter(Boolean).join(' ') }); continue; }
        if (plano.status === 'igual') { semMudanca++; continue; }
        const valores = Object.fromEntries(Object.entries(plano.mudancas).map(([c, m]) => [c, m!.depois]));
        try {
          await atualizarCamposEmpregado(g.escritorioId, g.empresa.id, id, valores as Partial<DadosEmpregado>, por);
          aplicados.push({ id, nome: e.nome, campos: plano.mudancas });
        } catch (err) {
          if (err instanceof ErroDp && err.status === 503) throw err;
          falhas.push({ id, nome: e.nome, erro: 'Não foi possível gravar este empregado.' });
        }
      }
      return Response.json({ aplicados, falhas, semMudanca });
    }

    // desfazer
    let revertidos = 0;
    const ignorados: { nome: string; campos: CampoLote[] }[] = [];
    for (const it of itens) {
      const id = String(it.id ?? '');
      const e = porId.get(id);
      if (!e || vistos.has(id)) continue;
      vistos.add(id);
      const campos: AplicadoLote['campos'] = {};
      const brutos = (it.campos && typeof it.campos === 'object' ? it.campos : {}) as Record<string, { antes?: unknown; depois?: unknown }>;
      for (const c of CAMPOS_LOTE) {
        const m = brutos[c];
        if (!m) continue;
        const antes = valorSeguro(c, m.antes);
        const depois = valorSeguro(c, m.depois);
        if (antes.ok && depois.ok) campos[c] = { antes: antes.valor, depois: depois.valor };
      }
      const p = planejarDesfazer(e, campos);
      if (p.ignorados.length) ignorados.push({ nome: e.nome, campos: p.ignorados });
      if (Object.keys(p.restaurar).length) {
        await atualizarCamposEmpregado(g.escritorioId, g.empresa.id, id, p.restaurar as Partial<DadosEmpregado>, por);
        revertidos++;
      }
    }
    return Response.json({ revertidos, ignorados });
  } catch (e) { return respostaErroDp(e, 'Falha ao gravar em lote.'); }
}

async function previa(req: NextRequest): Promise<Response> {
  let form: FormData;
  try { form = await req.formData(); } catch { return Response.json({ erro: 'Arquivo inválido.' }, { status: 400 }); }
  const g = await exigirEmpresaPonto(req, String(form.get('empresa') ?? ''));
  if (!g.ok) return g.resposta;
  const arquivo = form.get('arquivo');
  if (!(arquivo instanceof File) || !arquivo.size) return Response.json({ erro: 'Escolha a planilha.' }, { status: 400 });
  if (arquivo.size > MAX_BYTES_PLANILHA) return Response.json({ erro: 'Arquivo grande demais (máximo 2 MB).' }, { status: 400 });
  let matriz: string[][];
  try { matriz = await lerArquivoPlanilha(arquivo.name, await arquivo.arrayBuffer()); } catch (e) {
    return Response.json({ erro: e instanceof Error ? e.message : 'Não consegui ler a planilha.' }, { status: 400 });
  }
  const lida = lerPlanilha(matriz);
  if (lida.erro) return Response.json({ erro: lida.erro }, { status: 400 });
  if (lida.linhas.length > MAX_LINHAS_LOTE) return Response.json({ erro: `A planilha tem mais de ${MAX_LINHAS_LOTE} linhas.` }, { status: 400 });
  try {
    const emps = (await listarEmpregados(g.escritorioId, [g.empresa.id])).map(paraLote);
    const linhas = previaPlanilha(lida.linhas, emps, hojeBelem());
    const resumo = resumoPlanos(linhas.map((l) => l.plano ?? { status: 'erro' as const }));
    return Response.json({ linhas, ignoradas: lida.ignoradas, resumo });
  } catch (e) { return respostaErroDp(e, 'Falha ao conferir a planilha.'); }
}
