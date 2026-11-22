// /api/caixa/documento-leitura — nota e boleto SEM IA (Sprint 17, Frente B).
//
// POST { empresa, ano, direcao?, documento }  → lê um documento já enviado ao
//        portal (XML de NF-e/NFC-e/NFS-e ou PDF com texto);
// POST { empresa, ano, direcao?, codigo }     → lê a linha digitável/código de
//        barras do boleto digitado.
//
// Devolve uma PROPOSTA de lançamento no formato da leitura por IA (Sprint 12):
// nada é gravado no livro. A tela a põe como rascunho; quem lança confere e
// clica em Lançar (POST de lançamentos com `documentoId` e `chaveDocumento`).
// Junto vêm os lançamentos que JÁ vieram deste documento (mesma chave da nota ou
// do boleto, ou o mesmo arquivo), para a tela apontar a duplicidade antes de gravar.
//
// Sem nenhum serviço externo: o XML e o texto do PDF são lidos aqui, a linha
// digitável é conta. Por isso não passa pelas travas da IA (plataforma, opção da
// empresa, saúde, cota) — mas respeita as mesmas guardas e o isolamento: empresa
// da sessão (`motivoNegado`) e documento da MESMA empresa e do escritório da
// sessão (`podeVerRegistro`), recebido ou conferido e não excluído.
import { NextRequest } from 'next/server';
import { exigirSessao, motivoNegado } from '@/lib/acesso';
import { contasDaEmpresa, ErroCaixa, historicosDaEmpresa } from '@/lib/caixa';
import { exemplosDaEmpresa, hojeBelem } from '@/lib/caixaInteligente';
import { lerEmpresa } from '@/lib/cadastro';
import { categoriaLidaPelaIa } from '@/lib/documentoLancamento';
import { podeVerRegistro } from '@/lib/documentos';
import { baixarArquivo, ErroDoc, lerDocumento, type Documento } from '@/lib/documentosServidor';
import {
  comContaSugerida, propostaDoCodigo, propostaDoTextoPdf, propostaDoXml, tipoLidoSemIa,
  type ContextoLeitura, type EmpresaLeitura, type PropostaLeitura,
} from '@/lib/leituraSemIa';
import { ErroPdf, lancamentosDoDocumento, textoDoPdf } from '@/lib/leituraSemIaServidor';
import { Limitador } from '@/lib/limite';
import type { Direcao } from '@/lib/sugestaoConta';
import { visaoDoCatalogo } from '@/lib/visibilidadeCatalogo';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** Freio por usuário (ler PDF gasta CPU): 40 leituras a cada 10 min. */
const ritmo = new Limitador(40, 10 * 60_000);

function falha(e: unknown) {
  if (e instanceof ErroCaixa || e instanceof ErroDoc) return Response.json({ erro: e.message }, { status: e.status });
  console.error('[caixa] leitura sem IA', e instanceof Error ? e.message : e);
  return Response.json({ erro: 'Não foi possível ler o documento agora. Dá para lançar à mão.' }, { status: 502 });
}

export async function POST(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json().catch(() => ({}));
    const empresa = String(body.empresa ?? '').trim();
    if (!empresa) throw new ErroCaixa('Informe a empresa.');
    { const n = await motivoNegado(g.sessao, empresa); if (n) throw new ErroCaixa(n.erro, n.status); }

    const ano = Number(body.ano);
    if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) throw new ErroCaixa('Ano inválido.');
    const direcaoInformada: Direcao | null = body.direcao === 'entrada' || body.direcao === 'saida' ? body.direcao : null;
    const ctx: ContextoLeitura = { ano, hoje: hojeBelem(), direcaoInformada };
    const codigo = typeof body.codigo === 'string' ? body.codigo.trim() : '';
    const documentoId = typeof body.documento === 'string' ? body.documento.trim() : '';
    if (!codigo && !documentoId) throw new ErroCaixa('Escolha o documento ou digite o código do boleto.');

    if (!ritmo.tentar(g.sessao.email.toLowerCase())) {
      throw new ErroCaixa('Muitas leituras em pouco tempo. Espere alguns minutos — dá para lançar à mão enquanto isso.', 429);
    }

    const dados = await lerEmpresa(empresa);
    const daEmpresa: EmpresaLeitura = { documento: dados?.cnpj ?? null, identificaPagador: !!dados?.identificaPagador };

    let proposta: PropostaLeitura | null;
    let doc: Documento | null = null;
    if (codigo) {
      const r = propostaDoCodigo(codigo, ctx);
      if (!r.ok) throw new ErroCaixa(r.erro, 422);
      proposta = r.proposta;
    } else {
      // O documento: da MESMA empresa, do escritório da sessão, recebido e não excluído.
      const d = await lerDocumento(documentoId);
      if (!d || d.excluidoEm || d.empresaId !== empresa || !podeVerRegistro(g.sessao, d)
        || (d.status !== 'recebido' && d.status !== 'conferido')) {
        throw new ErroCaixa('Documento não encontrado.', 404);
      }
      doc = d;
      // Um lançamento por documento: extrato e folha não são um lançamento só.
      if (!categoriaLidaPelaIa(doc.categoria)) throw new ErroCaixa('Dá para ler nota, recibo ou outros — não extrato nem folha.', 415);
      if (!tipoLidoSemIa(doc.tipo)) {
        throw new ErroCaixa('Sem IA dá para ler o XML da nota ou um PDF com texto. Foto precisa ser lançada à mão (ou pela leitura por IA, se estiver ligada).', 415);
      }
      const bytes = await baixarArquivo(doc);
      if (doc.tipo === 'application/xml') {
        const r = propostaDoXml(new TextDecoder('utf-8').decode(bytes), daEmpresa, ctx);
        if (!r.ok) throw new ErroCaixa(r.erro, 422);
        proposta = r.proposta;
      } else {
        let texto: string;
        try { texto = await textoDoPdf(bytes); } catch (e) {
          if (e instanceof ErroPdf) throw new ErroCaixa(e.message, 415);
          throw e;
        }
        proposta = propostaDoTextoPdf(texto, daEmpresa, ctx);
      }
    }

    const documento = doc ? { id: doc.id, nome: doc.nome } : null;
    if (!proposta) {
      return Response.json({
        proposta: null, documento,
        aviso: 'Este PDF não tem texto (parece uma imagem escaneada), então não dá para ler sem IA. Preencha o lançamento à mão.',
      });
    }

    // A conta: pelo histórico e pelas analíticas da empresa, no recorte da sessão.
    const visao = visaoDoCatalogo(g.sessao);
    const [{ exemplos }, contas, analiticas, anteriores] = await Promise.all([
      exemplosDaEmpresa(empresa), contasDaEmpresa(empresa, visao), historicosDaEmpresa(empresa, visao),
      lancamentosDoDocumento(empresa, { chave: proposta.chave, documentoId: doc?.id ?? null }),
    ]);
    comContaSugerida(proposta, { exemplos, contas, analiticas });

    return Response.json({
      proposta, documento,
      duplicados: anteriores.encontrados,
      duplicidadeVerificada: anteriores.verificado,
    });
  } catch (e) {
    return falha(e);
  }
}
