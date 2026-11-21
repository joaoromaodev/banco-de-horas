// /api/caixa/sugestao — sugestão de Conta Titular + Analítica ao lançar.
//
// GET  ?empresa=  → os exemplos (lançamentos da empresa — conferidos pesam 1, não
//                   conferidos 0,3 —, reduzidos e compactados) para a tela sugerir
//                   sozinha, sem ida ao servidor a cada tecla (lib/sugestaoConta.ts
//                   roda no navegador).
// POST            → fonte (c): a IA escolhe entre as contas QUE A EMPRESA JÁ USA,
//                   só com CAIXA_IA_SUGESTAO=ligada e nunca em empresa de saúde,
//                   quando o histórico não resolve. Chamada explícita (botão), com
//                   cota diária por escritório e ritmo por usuário.
//
// Nada aqui grava lançamento, cria conta ou marca conferido. A tela mostra a
// sugestão e o usuário decide.
import { NextRequest } from 'next/server';
import { GoogleGenAI, Type } from '@google/genai';
import { exigirEmpresa, exigirSessao, motivoNegado } from '@/lib/acesso';
import { contasDaEmpresa, ErroCaixa, historicosDaEmpresa, paraValor } from '@/lib/caixa';
import { lerEmpresa } from '@/lib/cadastro';
import {
  chamadasIaHoje, exemplosDaEmpresa, iaPermitida, LIMITE_IA_DIA, LIMITE_IA_EMPRESA_CLIENTE, registrarChamadaIa,
} from '@/lib/caixaInteligente';
import { getGeminiApiKey, getGeminiModelo } from '@/lib/config';
import { Limitador } from '@/lib/limite';
import { interpretarRespostaIa, montarPromptIa, opcoesParaIa, type Direcao } from '@/lib/sugestaoConta';
import { visaoDoCatalogo } from '@/lib/visibilidadeCatalogo';

export const runtime = 'nodejs';

/** Ritmo por usuário, à parte da cota do escritório: 20 perguntas a cada 10 min. */
const ritmo = new Limitador(20, 10 * 60_000);

function falha(e: unknown) {
  if (e instanceof ErroCaixa) return Response.json({ erro: e.message }, { status: e.status });
  console.error('[caixa] sugestão', e);
  return Response.json({ erro: 'Não foi possível sugerir a conta agora.' }, { status: 502 });
}

export async function GET(req: NextRequest) {
  const empresa = req.nextUrl.searchParams.get('empresa') ?? '';
  const g = await exigirEmpresa(req, empresa);
  if (!g.ok) return g.resposta;
  try {
    const [{ exemplos, total, conferidos }, dados] = await Promise.all([exemplosDaEmpresa(empresa), lerEmpresa(empresa)]);
    return Response.json({ exemplos, lancamentos: total, conferidos, ia: iaPermitida(dados) });
  } catch (e) {
    return falha(e);
  }
}

const SCHEMA_IA = {
  type: Type.OBJECT,
  properties: {
    indice: { type: Type.INTEGER, nullable: true },
    confianca: { type: Type.NUMBER },
  },
  required: ['indice', 'confianca'],
};

export async function POST(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json().catch(() => ({}));
    const empresa = String(body.empresa ?? '').trim();
    if (!empresa) throw new ErroCaixa('Informe a empresa.');
    { const n = await motivoNegado(g.sessao, empresa); if (n) throw new ErroCaixa(n.erro, n.status); }

    const complemento = String(body.complemento ?? '').trim();
    if (complemento.length < 3) throw new ErroCaixa('Escreva o complemento para a IA ter o que ler.');
    const direcao: Direcao | null = body.direcao === 'entrada' || body.direcao === 'saida' ? body.direcao : null;
    const v = paraValor(body.valor);
    const valor = Number.isFinite(v) && v > 0 ? v : null;

    // Desligada por padrão; nunca para empresa que identifica pagador (saúde).
    const dados = await lerEmpresa(empresa);
    const apiKey = getGeminiApiKey();
    if (!apiKey || !iaPermitida(dados)) throw new ErroCaixa('A sugestão por IA não está disponível para esta empresa.', 403);
    if (!ritmo.tentar(g.sessao.email.toLowerCase())) {
      throw new ErroCaixa('Muitas perguntas à IA em pouco tempo. Espere alguns minutos.', 429);
    }

    // Cota por escritório DONO DA EMPRESA (o cliente herda a do escritório dele) e,
    // para o cliente, uma subcota da própria empresa — um cliente não esgota o escritório.
    const dono = dados?.escritorioId ?? null;
    const usadas = await chamadasIaHoje({ escritorioId: dono });
    if (usadas === null) throw new ErroCaixa('A sugestão por IA ainda não está ligada (falta a migração 0017).', 503);
    if (usadas >= LIMITE_IA_DIA) throw new ErroCaixa('O escritório já usou as sugestões por IA de hoje. Amanhã renova.', 429);
    if (g.sessao.role === 'cliente' && ((await chamadasIaHoje({ empresaId: empresa })) ?? 0) >= LIMITE_IA_EMPRESA_CLIENTE) {
      throw new ErroCaixa('Esta empresa já usou as sugestões por IA de hoje. Amanhã renova.', 429);
    }

    // Só as contas desta empresa, no recorte da sessão (base + escritório dela).
    const visao = visaoDoCatalogo(g.sessao);
    const [contas, analiticas] = await Promise.all([contasDaEmpresa(empresa, visao), historicosDaEmpresa(empresa, visao)]);
    const opcoes = opcoesParaIa(direcao, contas, analiticas);
    if (opcoes.length === 0) {
      return Response.json({ sugestao: null, aviso: 'A empresa ainda não tem contas próprias para a IA escolher.' });
    }

    const ai = new GoogleGenAI({ apiKey });
    const res = await ai.models.generateContent({
      model: getGeminiModelo(),
      contents: [{ role: 'user', parts: [{ text: montarPromptIa({ complemento, direcao, valor }, opcoes) }] }],
      config: { responseMimeType: 'application/json', responseSchema: SCHEMA_IA, temperature: 0 },
    });
    const sugestao = interpretarRespostaIa(res.text, opcoes);

    // Conta na cota mesmo sem resposta útil (a chamada foi feita).
    const id = await registrarChamadaIa({
      escritorioId: dono, empresaId: empresa, autor: g.sessao.email,
      contaId: sugestao?.contaId ?? null, historico: sugestao?.historico ?? null, confianca: sugestao?.confianca ?? null,
    });
    if (!sugestao) return Response.json({ sugestao: null, aviso: 'A IA não encontrou uma conta segura entre as da empresa.' });
    return Response.json({ sugestao: { ...sugestao, id } });
  } catch (e) {
    return falha(e);
  }
}
