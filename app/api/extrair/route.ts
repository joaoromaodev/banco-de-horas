// POST /api/extrair — recebe a foto da folha (multipart) e devolve a frequência
// estruturada + campos incertos, pela IA (lib/ia: Cloudflare Workers AI ou Gemini).
// GET  /api/extrair?empresa=<id> — a situação da cota do mês e da cota diária da IA (para a tela).
//
// As credenciais da IA são da PLATAFORMA (variáveis de ambiente), nunca do
// escritório nem da planilha. Cada leitura bem-sucedida conta na cota mensal do escritório
// dono da empresa (lib/cotaOcr.ts). A contagem é feita aqui, no servidor:
//   1. avalia a cota com o que já foi usado; esgotada → 429 com convite de plano;
//   2. RESERVA a leitura (linha em ponto_leituras_ocr) e reconta — se a corrida com
//      outra leitura passou do limite, desfaz e recusa;
//   3. chama a IA; falhou → marca 'falhou' (não conta na cota, conta no ritmo);
//      deu certo → confirma.
// À parte da cota há um limite de ritmo (tentativas por 10 min, por escritório).
import { NextRequest } from 'next/server';
import { exigirEmpresaPonto, respostaErroPonto } from '@/lib/pontoAcesso';
import { extrairFolha } from '@/lib/ocr';
import { ErroIa } from '@/lib/ia';
import { iaConfigurada } from '@/lib/ia/config';
import { situacaoIa } from '@/lib/ia/cota';
import { avaliarCota, competenciaBelem, excedeuRitmo, MENSAGEM_RITMO } from '@/lib/cotaOcr';
import { lerEscritorio } from '@/lib/escritorios';
import {
  cancelarLeituraOcr, confirmarLeituraOcr, contarLeiturasOcr, contarTentativasRecentes, falharLeituraOcr, reservarLeituraOcr,
} from '@/lib/pontoDb';

export const runtime = 'nodejs';
export const maxDuration = 120;

/** A Vercel recusa corpo acima de ~4,5 MB; abaixo disso explicamos com educação. */
const TAMANHO_MAX = 4 * 1024 * 1024;
const TIPOS_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/** Situação da cota do escritório no mês corrente (Belém). */
async function estadoCota(escritorioId: string) {
  const [escritorio, usadas] = await Promise.all([
    lerEscritorio(escritorioId),
    contarLeiturasOcr(escritorioId, competenciaBelem()),
  ]);
  return avaliarCota({ plano: escritorio?.plano, situacao: escritorio?.situacao, usadas });
}

/** Só o nível e a mensagem da cota diária da IA (o aviso de 80% e o de esgotada). */
function iaDiaDe(ia: Awaited<ReturnType<typeof situacaoIa>> | null) {
  return ia?.cota && ia.cota.medida && ia.cota.nivel !== 'ok' ? { nivel: ia.cota.nivel, mensagem: ia.cota.mensagem } : null;
}

export async function GET(req: NextRequest) {
  const g = await exigirEmpresaPonto(req, new URL(req.url).searchParams.get('empresa'));
  if (!g.ok) return g.resposta;
  try {
    const [cota, ia] = await Promise.all([estadoCota(g.escritorioId), situacaoIa().catch(() => null)]);
    return Response.json({ cota, iaDia: iaDiaDe(ia) });
  } catch (e) {
    return respostaErroPonto(e, 'Falha ao consultar a cota de leituras.');
  }
}

export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ erro: 'Envio inválido (esperado multipart/form-data).' }, { status: 400 });
  }

  const empresaEnviada = form.get('empresa');
  if (typeof empresaEnviada !== 'string' || !empresaEnviada.trim()) {
    return Response.json({ erro: 'Selecione a empresa antes de ler a folha.' }, { status: 400 });
  }
  const g = await exigirEmpresaPonto(req, empresaEnviada);
  if (!g.ok) return g.resposta;

  const file = form.get('file');
  const ano = Number(form.get('ano'));
  const mes = Number(form.get('mes'));
  const funcionarioEnviado = form.get('funcionario');
  const funcionario = typeof funcionarioEnviado === 'string' && funcionarioEnviado.trim()
    ? funcionarioEnviado.trim().slice(0, 120) : undefined;

  if (!(file instanceof File)) {
    return Response.json({ erro: 'Arquivo de imagem não enviado.' }, { status: 400 });
  }
  if (file.size > TAMANHO_MAX) {
    return Response.json({ erro: 'A foto passa de 4 MB. Tire outra com resolução menor.' }, { status: 413 });
  }
  const mimeType = file.type || 'image/jpeg';
  if (!TIPOS_IMAGEM.includes(mimeType)) {
    return Response.json({ erro: 'Envie uma foto (JPG, PNG, WEBP ou HEIC).' }, { status: 415 });
  }
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    return Response.json({ erro: 'Mês/ano inválidos.' }, { status: 400 });
  }

  if (!iaConfigurada('ponto')) {
    console.error('[ponto] IA sem variáveis configuradas no servidor.');
    return Response.json(
      { erro: 'A leitura por IA está indisponível no momento. Você pode preencher a folha à mão enquanto isso.' },
      { status: 503 },
    );
  }

  const escritorioId = g.escritorioId;
  const competencia = competenciaBelem();
  let reserva: string;
  try {
    // 1. Cota antes de gastar.
    const escritorio = await lerEscritorio(escritorioId);
    const quem = { plano: escritorio?.plano, situacao: escritorio?.situacao };
    const antes = avaliarCota({ ...quem, usadas: await contarLeiturasOcr(escritorioId, competencia) });
    if (!antes.permitido) return Response.json({ erro: antes.mensagem, cota: antes }, { status: 429 });
    if (excedeuRitmo(await contarTentativasRecentes(escritorioId))) {
      return Response.json({ erro: MENSAGEM_RITMO, cota: antes }, { status: 429 });
    }

    // 2. Reserva e reconta (fecha a corrida entre leituras simultâneas).
    reserva = await reservarLeituraOcr({ escritorioId, competencia, empresaId: g.empresa.id, usuario: g.sessao.email });
    const comReserva = await contarLeiturasOcr(escritorioId, competencia);
    if (comReserva > antes.limite) {
      await cancelarLeituraOcr(reserva).catch(() => {});
      const cota = avaliarCota({ ...quem, usadas: antes.limite });
      return Response.json({ erro: cota.mensagem, cota }, { status: 429 });
    }
  } catch (e) {
    return respostaErroPonto(e, 'Falha ao conferir a cota de leituras.');
  }

  // 3. Leitura.
  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');
    const resultado = await extrairFolha({
      imagemBase64: base64,
      mimeType,
      ano,
      mes,
      empresa: g.empresa.id,
      funcionario,
    });
    await confirmarLeituraOcr(reserva).catch((e) => console.error('[ponto] confirmar leitura', e));
    const [depois, ia] = await Promise.all([estadoCota(escritorioId).catch(() => null), situacaoIa().catch(() => null)]);
    return Response.json({ ...resultado, cota: depois, iaDia: iaDiaDe(ia) });
  } catch (e) {
    await falharLeituraOcr(reserva).catch(() => {});
    if (e instanceof ErroIa) {
      // Mensagem para gente (limite diário, tempo, formato); no log só o detalhe curto.
      console.error('[ponto] leitura por IA falhou:', e.detalhe);
      return Response.json({ erro: `${e.mensagem} Esta tentativa não conta na cota.` }, { status: e.status });
    }
    console.error('[ponto] leitura por IA falhou', e instanceof Error ? e.message.slice(0, 160) : 'erro');
    return Response.json({ erro: 'Não foi possível ler a folha agora. Tente de novo ou preencha à mão — esta tentativa não conta na cota.' }, { status: 502 });
  }
}
