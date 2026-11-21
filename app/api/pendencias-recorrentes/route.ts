// /api/pendencias-recorrentes — o que o escritório pede todo mês, por empresa.
//
// Só a contabilidade (`exigirGestor`) e só empresas que a sessão enxerga. Fica
// FORA de `/api/pendencias` de propósito: aquele prefixo está em CLIENTE_PODE e
// o cliente não pode configurar o que o escritório pede. O cron (dia 1º, em
// /api/cron/agenda) abre as pendências; o envio do documento fecha. Ver
// docs/documentos.md.
import { NextRequest } from 'next/server';
import { empresasVisiveis, exigirGestor, motivoNegado, respostaNegadaEmpresa } from '@/lib/acesso';
import { lerEmpresa } from '@/lib/cadastro';
import { categoriaValida } from '@/lib/documentos';
import { CamposRecorrente, criarRecorrentes, editarRecorrente, ErroFechamento, excluirRecorrente, lerRecorrente, listarRecorrentes } from '@/lib/fechamentoServidor';
import { DIA_PRAZO_MAX, DIA_PRAZO_MIN, ItemModelo, itensNovos, resolverDiaPrazo } from '@/lib/fechamento';
import { prazoPadraoDoEscritorio } from '@/lib/escritorioServidor';
import { textoOpcional } from '../documentos/comum';

export const runtime = 'nodejs';

const MAX_EMPRESAS = 50;
const MAX_ITENS = 12;

function falha(e: unknown) {
  if (e instanceof ErroFechamento) return Response.json({ erro: e.message }, { status: e.status });
  console.error('[pendencias-recorrentes]', e);
  return Response.json({ erro: 'Falha ao processar o pedido mensal.' }, { status: 502 });
}


/* eslint-disable @typescript-eslint/no-explicit-any -- corpo JSON livre, validado aqui */
/** `padrao`: dia usado quando o corpo não traz `diaPrazo` (prazo padrão do escritório). */
function campos(b: any, padrao: number): CamposRecorrente {
  const titulo = textoOpcional(b?.titulo, 200);
  if (!titulo) throw new ErroFechamento('Diga o que a empresa deve enviar todo mês.');
  const categoria = String(b?.categoria ?? '');
  if (!categoriaValida(categoria)) throw new ErroFechamento('Escolha a categoria do documento.');
  const diaPrazo = resolverDiaPrazo(b?.diaPrazo, padrao);
  if (diaPrazo === null) throw new ErroFechamento(`O dia do prazo vai de ${DIA_PRAZO_MIN} a ${DIA_PRAZO_MAX}.`);
  return { titulo, descricao: textoOpcional(b?.descricao, 2000), categoria, diaPrazo };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Escritório do registro (da EMPRESA dele, não da sessão) e acesso à empresa. */
async function recorrenteAcessivel(g: { sessao: Parameters<typeof motivoNegado>[0] }, id: string, incluirExcluido = false) {
  const m = await lerRecorrente(id, incluirExcluido);
  if (!m) throw new ErroFechamento('Pedido mensal não encontrado.', 404);
  { const n = await motivoNegado(g.sessao, m.empresaId); if (n) throw new ErroFechamento(n.erro, n.status); }
  return m;
}

/** Lista os pedidos mensais: de uma empresa (`?empresa=`) ou de todas as que a sessão vê. */
export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const empresa = req.nextUrl.searchParams.get('empresa') || '';
    if (empresa) { const r = await respostaNegadaEmpresa(g.sessao, empresa); if (r) return r; }
    const ids = empresa ? [empresa] : (await empresasVisiveis(g.sessao)).map((e) => e.id);
    const escritorio = g.sessao.role === 'master' ? null : (g.sessao.escritorioId ?? '__nenhum__');
    return Response.json({ modelos: await listarRecorrentes(ids, escritorio) });
  } catch (e) {
    if (e instanceof ErroFechamento && e.status === 503) return Response.json({ modelos: [], semTabela: true });
    return falha(e);
  }
}

/**
 * Aplica itens a várias empresas de uma vez (`{ empresas: [id], itens: [...] }`).
 * Só cria o que a empresa ainda não pede (mesmo título e categoria); devolve os
 * ids criados — a tela oferece "Desfazer" com eles.
 */
export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json().catch(() => ({}));
    const empresas = [...new Set((Array.isArray(body.empresas) ? body.empresas : [body.empresa]).map((x: unknown) => String(x ?? '')).filter(Boolean))] as string[];
    if (!empresas.length) throw new ErroFechamento('Escolha ao menos uma empresa.');
    if (empresas.length > MAX_EMPRESAS) throw new ErroFechamento(`Escolha até ${MAX_EMPRESAS} empresas por vez.`);
    const brutos = Array.isArray(body.itens) ? body.itens : [];
    if (!brutos.length) throw new ErroFechamento('Escolha ao menos um documento.');
    if (brutos.length > MAX_ITENS) throw new ErroFechamento(`Até ${MAX_ITENS} documentos por vez.`);

    // Confere TODAS as empresas antes de gravar qualquer uma (tudo ou nada).
    const donas = new Map<string, string>();
    for (const id of empresas) {
      { const r = await respostaNegadaEmpresa(g.sessao, id); if (r) return r; }
      const e = await lerEmpresa(id);
      if (!e?.escritorioId) throw new ErroFechamento('Empresa sem escritório vinculado.', 409);
      donas.set(id, e.escritorioId);
    }
    // Sem `diaPrazo` no item vale o prazo padrão do escritório (o da sessão; o master usa o da 1ª empresa).
    const padrao = await prazoPadraoDoEscritorio(g.sessao.escritorioId ?? donas.get(empresas[0]));
    const itens: ItemModelo[] = brutos.map((b: unknown) => {
      const c = campos(b, padrao);
      return { titulo: c.titulo, descricao: c.descricao ?? '', categoria: c.categoria, diaPrazo: c.diaPrazo };
    });
    const existentes = await listarRecorrentes(empresas, g.sessao.role === 'master' ? null : (g.sessao.escritorioId ?? '__nenhum__'));
    const linhas = empresas.flatMap((empresaId) =>
      itensNovos(itens, existentes.filter((m) => m.empresaId === empresaId)).map((i) => ({
        empresaId, escritorioId: donas.get(empresaId)!,
        campos: { titulo: i.titulo, descricao: i.descricao || null, categoria: i.categoria, diaPrazo: i.diaPrazo },
      })));
    const criados = await criarRecorrentes(linhas, g.sessao.email);
    return Response.json({ criados, ids: criados.map((m) => m.id), pulados: empresas.length * itens.length - criados.length });
  } catch (e) { return falha(e); }
}

/** `{ id, acao: 'editar' | 'ativar' | 'desativar' }` ou `{ ids, restaurar: true }` (desfazer). */
export async function PATCH(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json().catch(() => ({}));
    if (body.restaurar) {
      const lista = (Array.isArray(body.ids) ? body.ids : [body.id]).map((x: unknown) => String(x ?? '')).filter(Boolean).slice(0, 600);
      for (const id of lista) {
        const m = await recorrenteAcessivel(g, id, true);
        await excluirRecorrente(m.id, true);
      }
      return Response.json({ ok: true });
    }
    const m = await recorrenteAcessivel(g, String(body.id ?? ''));
    switch (body.acao) {
      case 'editar': return Response.json({ modelo: await editarRecorrente(m.id, campos(body, m.diaPrazo)) });
      case 'ativar': return Response.json({ modelo: await editarRecorrente(m.id, { ativa: true }) });
      case 'desativar': return Response.json({ modelo: await editarRecorrente(m.id, { ativa: false }) });
      default: throw new ErroFechamento('Ação inválida.');
    }
  } catch (e) { return falha(e); }
}

/** Exclusão lógica de um ou vários (`?id=` repetido). A tela oferece "Desfazer". */
export async function DELETE(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const lista = req.nextUrl.searchParams.getAll('id').filter(Boolean).slice(0, 600);
    if (!lista.length) throw new ErroFechamento('Informe o pedido mensal.');
    for (const id of lista) {
      const m = await recorrenteAcessivel(g, id);
      await excluirRecorrente(m.id);
    }
    return Response.json({ ok: true, ids: lista });
  } catch (e) { return falha(e); }
}
