// /api/caixa/documento-ia — documento → lançamento sugerido por IA (Sprint 12, Frente A).
//
// GET   ?empresa=            → a situação das duas travas (a tela decide se mostra o botão).
// PATCH { empresa, ligada }  → liga/desliga a opção da empresa — SÓ a contabilidade.
// POST  { empresa, documento, ano, direcao? }
//                            → a IA lê o documento (já enviado ao portal, 0015) e
//                              devolve uma PROPOSTA de lançamento. Nada é gravado
//                              no livro: a tela preenche o formulário como rascunho
//                              e quem lança confere e confirma (POST de lançamentos
//                              com `documentoId`, que liga o anexo).
//
// Travas (decisão do dono, 21/11/2026): `CAIXA_IA_DOCUMENTO=ligada` na plataforma
// (sem ela: 503) e a opção da empresa (sem ela: 403); empresa que identifica
// pagador (saúde) nunca usa (403). Cada leitura conta na cota mensal de IA do
// escritório (a mesma da folha de ponto, lib/cotaOcr.ts), reservada antes de
// chamar a IA (lib/ia: Cloudflare Workers AI ou Gemini), como em /api/extrair.
//
// Acesso: `cliente` (só a própria empresa — /api/caixa está em CLIENTE_PODE) e a
// contabilidade do escritório (módulo caixa, recortado no proxy). O documento tem
// que ser da MESMA empresa e do escritório da sessão (podeVerRegistro).
import { NextRequest } from 'next/server';
import { ehGestor, exigirEmpresa, exigirGestor, exigirSessao, motivoNegado } from '@/lib/acesso';
import { contasDaEmpresa, ErroCaixa, historicosDaEmpresa } from '@/lib/caixa';
import { definirIaDocumento, lerEmpresa } from '@/lib/cadastro';
import { avaliarCota, competenciaBelem, excedeuRitmo } from '@/lib/cotaOcr';
import {
  categoriaLidaPelaIa, iaDocumentoNaPlataforma, interpretarLeitura, leitorDaLeitura, LIMITE_DOCUMENTOS_EMPRESA_CLIENTE, MENSAGEM_INDISPONIVEL,
  montarPromptDocumento, opcoesDocumento, situacaoIaDocumento, tipoLidoPelaIa,
} from '@/lib/documentoLancamento';
import { ErroArquivoIa, lerDocumentoPelaIa, prepararParaIa } from '@/lib/documentoLancamentoServidor';
import { podeVerRegistro } from '@/lib/documentos';
import { baixarArquivo, ErroDoc, lerDocumento, type Documento } from '@/lib/documentosServidor';
import { lerEscritorio } from '@/lib/escritorios';
import { ErroIa } from '@/lib/ia';
import { Limitador } from '@/lib/limite';
import {
  cancelarLeituraOcr, confirmarLeituraOcr, contarLeiturasDocumentoDoCliente, contarLeiturasOcr, contarTentativasRecentes,
  ErroBancoPendente, falharLeituraOcr, reservarLeituraOcr,
} from '@/lib/pontoDb';
import type { Direcao } from '@/lib/sugestaoConta';
import { visaoDoCatalogo } from '@/lib/visibilidadeCatalogo';

export const runtime = 'nodejs';
export const maxDuration = 120;

/** Ritmo por usuário, à parte da cota e do ritmo do escritório: 15 leituras a cada 10 min. */
const ritmo = new Limitador(15, 10 * 60_000);

const MIGRACAO = 'A leitura de documentos por IA ainda não está instalada (falta a migração 0029).';
/**
 * Coluna da 0029 ausente. O PostgREST diz "Could not find the 'origem' column of
 * 'ponto_leituras_ocr'" (insert) ou "column ponto_leituras_ocr.origem does not
 * exist" (filtro); lib/pontoDb repassa só a mensagem, então casamos as duas formas.
 */
const faltaColuna = (e: unknown) => {
  const m = String((e as { message?: string })?.message ?? '');
  return /caixa_ia_documento|'origem' column|ponto_leituras_ocr\.origem/.test(m);
};

function falha(e: unknown) {
  if (e instanceof ErroCaixa || e instanceof ErroDoc) return Response.json({ erro: e.message }, { status: e.status });
  if (e instanceof ErroBancoPendente || faltaColuna(e)) return Response.json({ erro: MIGRACAO }, { status: 503 });
  console.error('[caixa] documento-ia', e instanceof Error ? e.message : e);
  return Response.json({ erro: 'Não foi possível ler o documento agora.' }, { status: 502 });
}

const fmt = (n: number) => n.toLocaleString('pt-BR');

// ---------------------------------------------------------------------- situação
export async function GET(req: NextRequest) {
  const empresa = req.nextUrl.searchParams.get('empresa') ?? '';
  const g = await exigirEmpresa(req, empresa);
  if (!g.ok) return g.resposta;
  try {
    const s = situacaoIaDocumento(await lerEmpresa(empresa));
    // A contabilidade vê o estado das travas (para ligar); o cliente só se pode usar.
    return Response.json(ehGestor(g.sessao)
      ? { ...s, podeLigar: s.plataforma && !s.saude }
      : { disponivel: s.disponivel, podeLigar: false });
  } catch (e) {
    return falha(e);
  }
}

// ---------------------------------------------------------------- opção da empresa
export async function PATCH(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json().catch(() => ({}));
    const empresa = String(body.empresa ?? '').trim();
    if (!empresa) throw new ErroCaixa('Informe a empresa.');
    { const n = await motivoNegado(g.sessao, empresa); if (n) throw new ErroCaixa(n.erro, n.status); }
    if (typeof body.ligada !== 'boolean') throw new ErroCaixa('Informe se liga ou desliga.');
    const ligada = body.ligada;
    if (ligada) {
      // Desligar vale sempre; ligar só quando a plataforma permite e não é saúde.
      const s = situacaoIaDocumento(await lerEmpresa(empresa));
      if (!s.plataforma) throw new ErroCaixa(MENSAGEM_INDISPONIVEL.plataforma, 503);
      if (s.saude) throw new ErroCaixa(MENSAGEM_INDISPONIVEL.saude, 403);
    }
    await definirIaDocumento(empresa, ligada);
    return Response.json({ ok: true, ligada });
  } catch (e) {
    return falha(e);
  }
}


// ------------------------------------------------------------------- leitura
export async function POST(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;

  let empresa: string; let ano: number; let direcao: Direcao | null;
  let escritorioId: string; let doc: Documento;
  let bytes: Uint8Array;
  try {
    const body = await req.json().catch(() => ({}));
    empresa = String(body.empresa ?? '').trim();
    if (!empresa) throw new ErroCaixa('Informe a empresa.');
    { const n = await motivoNegado(g.sessao, empresa); if (n) throw new ErroCaixa(n.erro, n.status); }

    // Travas: plataforma (503), saúde e opção da empresa (403).
    const dados = await lerEmpresa(empresa);
    const s = situacaoIaDocumento(dados);
    if (!iaDocumentoNaPlataforma() || s.motivo === 'plataforma') throw new ErroCaixa(MENSAGEM_INDISPONIVEL.plataforma, 503);
    if (s.motivo) throw new ErroCaixa(MENSAGEM_INDISPONIVEL[s.motivo], 403);
    if (!dados?.escritorioId) throw new ErroCaixa('Esta empresa não está vinculada a um escritório.', 409);
    escritorioId = dados.escritorioId;

    ano = Number(body.ano);
    if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new ErroCaixa('Ano inválido.');
    direcao = body.direcao === 'entrada' || body.direcao === 'saida' ? body.direcao : null;

    // O documento: da MESMA empresa, do escritório da sessão, recebido e não excluído.
    const d = await lerDocumento(String(body.documento ?? ''));
    if (!d || d.excluidoEm || d.empresaId !== empresa || !podeVerRegistro(g.sessao, d)
      || (d.status !== 'recebido' && d.status !== 'conferido')) {
      throw new ErroCaixa('Documento não encontrado.', 404);
    }
    doc = d;
    // Extrato e folha (dados de terceiros e de empregados) nunca vão para a IA.
    if (!categoriaLidaPelaIa(doc.categoria)) {
      throw new ErroCaixa('A IA só lê documentos das categorias nota, recibo ou outros — não extrato nem folha.', 415);
    }
    if (!tipoLidoPelaIa(doc.tipo)) throw new ErroCaixa('A IA lê foto (JPG, PNG, WEBP) ou PDF. Este tipo de arquivo não.', 415);

    if (!ritmo.tentar(g.sessao.email.toLowerCase())) {
      throw new ErroCaixa('Muitas leituras em pouco tempo. Espere alguns minutos — dá para lançar à mão enquanto isso.', 429);
    }

    // O arquivo é preparado ANTES de gastar cota: PDF reduzido, foto sem metadados.
    // O que não dá para minimizar é recusado, nunca mandado como está.
    try {
      bytes = await prepararParaIa(await baixarArquivo(doc), doc.tipo);
    } catch (e) {
      if (e instanceof ErroArquivoIa) throw new ErroCaixa(e.message, 415);
      throw e;
    }
  } catch (e) {
    return falha(e);
  }

  // Cota do escritório dono da empresa (a mesma da folha de ponto) e, quando quem
  // lê é o cliente, a subcota da empresa — um cliente não esgota o escritório. A
  // subcota conta só as leituras DO CLIENTE (marcadas em `usuario`); as que a
  // contabilidade faz na empresa gastam só a cota do escritório.
  const competencia = competenciaBelem();
  const ehCliente = g.sessao.role === 'cliente';
  const esgotouEmpresa = () => Response.json({ erro: `Esta empresa já usou as ${LIMITE_DOCUMENTOS_EMPRESA_CLIENTE} leituras de documento por IA deste mês. Dá para lançar à mão; renova no dia 1º.` }, { status: 429 });
  let reserva: string;
  try {
    const escritorio = await lerEscritorio(escritorioId);
    const quem = { plano: escritorio?.plano, situacao: escritorio?.situacao };
    const antes = avaliarCota({ ...quem, usadas: await contarLeiturasOcr(escritorioId, competencia) });
    const limite = antes.limite;
    if (antes.nivel === 'suspensa') {
      return Response.json({ erro: 'A leitura por IA está pausada porque a assinatura do escritório está suspensa. Dá para lançar à mão.' }, { status: 429 });
    }
    if (!antes.permitido) {
      return Response.json({ erro: `O escritório já usou as ${fmt(limite)} leituras por IA deste mês (folhas e documentos). Dá para lançar à mão; a cota renova no dia 1º.` }, { status: 429 });
    }
    if (ehCliente && (await contarLeiturasDocumentoDoCliente(empresa, competencia)) >= LIMITE_DOCUMENTOS_EMPRESA_CLIENTE) {
      return esgotouEmpresa();
    }
    if (excedeuRitmo(await contarTentativasRecentes(escritorioId))) {
      return Response.json({ erro: 'Muitas leituras por IA no escritório em pouco tempo. Espere alguns minutos.' }, { status: 429 });
    }
    // Reserva ANTES da chamada e reconta com ela gravada: de vários pedidos
    // simultâneos, os que passaram do limite desfazem a própria reserva.
    reserva = await reservarLeituraOcr({ escritorioId, competencia, empresaId: empresa, usuario: leitorDaLeitura(g.sessao), origem: 'documento' });
    if ((await contarLeiturasOcr(escritorioId, competencia)) > limite) {
      await cancelarLeituraOcr(reserva).catch(() => {});
      return Response.json({ erro: `O escritório já usou as ${fmt(limite)} leituras por IA deste mês.` }, { status: 429 });
    }
    if (ehCliente && (await contarLeiturasDocumentoDoCliente(empresa, competencia)) > LIMITE_DOCUMENTOS_EMPRESA_CLIENTE) {
      await cancelarLeituraOcr(reserva).catch(() => {});
      return esgotouEmpresa();
    }
  } catch (e) {
    return falha(e);
  }

  try {
    // Só as contas desta empresa, no recorte da sessão (base + escritório dela).
    const visao = visaoDoCatalogo(g.sessao);
    const [contas, analiticas] = await Promise.all([contasDaEmpresa(empresa, visao), historicosDaEmpresa(empresa, visao)]);
    const opcoes = opcoesDocumento(direcao, contas, analiticas);
    const texto = await lerDocumentoPelaIa({
      bytes, mime: doc.tipo, prompt: montarPromptDocumento({ ano, direcao, opcoes }),
    });
    const proposta = interpretarLeitura(texto, opcoes, { ano, direcaoInformada: direcao });
    // A chamada foi feita: conta na cota mesmo se a leitura não serviu.
    await confirmarLeituraOcr(reserva).catch((e) => console.error('[caixa] confirmar leitura', e));
    const documento = { id: doc.id, nome: doc.nome };
    if (!proposta) {
      return Response.json({ proposta: null, documento, aviso: 'A IA não conseguiu ler este documento. Confira se é uma nota, recibo, boleto ou comprovante legível.' });
    }
    return Response.json({ proposta, documento });
  } catch (e) {
    await falharLeituraOcr(reserva).catch(() => {});
    if (e instanceof ErroCaixa || e instanceof ErroDoc) return falha(e);
    if (e instanceof ErroIa) {
      // Limite diário, tempo, PDF escaneado: mensagem para gente; no log só o detalhe curto.
      console.error('[caixa] leitura de documento por IA falhou:', e.detalhe);
      return Response.json({ erro: `${e.mensagem} Esta tentativa não conta na cota.` }, { status: e.status });
    }
    console.error('[caixa] leitura de documento por IA falhou', e instanceof Error ? e.message : e);
    return Response.json({ erro: 'Não foi possível ler o documento agora. Tente de novo ou lance à mão — esta tentativa não conta na cota.' }, { status: 502 });
  }
}
