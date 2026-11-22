// Extração da folha de ponto manuscrita pela IA (saída estruturada em JSON).
// O provedor (Cloudflare Workers AI ou Gemini) é escolhido em lib/ia — aqui ficam
// o prompt, o esquema e a validação, iguais para os dois.
import { Frequencia, DiaFreq, Marcador, MARCADORES } from './tipos';
import { fotoParaIa } from './fotoParaIa';
import { lerComIa, ErroIa, type Esquema } from './ia';

export interface CampoIncerto {
  dia: number;
  campo: string;
}

export interface ResultadoOCR {
  frequencia: Frequencia;
  incertos: CampoIncerto[];
}

export const ESQUEMA_FOLHA: Esquema = {
  type: 'object',
  properties: {
    funcionario: { type: 'string', nullable: true },
    dias: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dia: { type: 'integer' },
          entradaManha: { type: 'string', nullable: true },
          saidaAlmoco: { type: 'string', nullable: true },
          retornoAlmoco: { type: 'string', nullable: true },
          saidaTarde: { type: 'string', nullable: true },
          marcador: { type: 'string', nullable: true },
          incerto: { type: 'array', items: { type: 'string' }, nullable: true },
        },
        required: ['dia'],
      },
    },
  },
  required: ['dias'],
};

/**
 * O texto do pedido. Não leva o nome do funcionário (minimização: a imagem já o
 * traz, e o nome informado na tela prevalece sobre o lido — revisão do escudo, S17-F).
 */
export function promptFolha(ano: number, mes: number): string {
  return `Você é um transcritor de folhas de ponto manuscritas brasileiras.
A imagem é uma "FOLHA DE PONTO INDIVIDUAL DE TRABALHO" referente a ${String(mes).padStart(2, '0')}/${ano}.

Cada linha é um dia do mês. As colunas de horário, na ordem, são:
1. ENTRADA MANHÃ (entradaManha)
2. ALMOÇO - SAÍDA (saidaAlmoco)
3. ALMOÇO - RETORNO (retornoAlmoco)
4. SAÍDA TARDE (saidaTarde)

Regras de transcrição:
- Transcreva EXATAMENTE o que está escrito, no formato "HH:MM" (24h). Ex.: "08:00", "13:01", "17:59".
- Se a célula estiver em branco, use null.
- Se a linha indicar SÁBADO, DOMINGO, FERIADO, ATESTADO, FALTA, FOLGA ou FÉRIAS (texto escrito no lugar dos horários), coloque isso em "marcador" (em maiúsculas) e deixe os horários null. Marcadores válidos: ${MARCADORES.join(', ')}. Anotações como "B"/"H"/"BH" significam "BANCO DE HORAS".
- ATENÇÃO: se a linha tiver AO MESMO TEMPO horários escritos E um marcador (ex.: "07:00 11:58" seguido de "B"/"H"), preencha os horários normalmente E também o marcador. Nunca descarte horários que estão escritos.
- Para cada dígito ou horário que você tiver dificuldade real de ler, liste o nome do campo em "incerto" (ex.: ["saidaTarde"]). Só marque quando houver dúvida genuína.
- Não invente horários. Não preencha dias que não existem no mês.
- Retorne também o nome do funcionário se estiver legível no cabeçalho.

Responda SOMENTE com o JSON no schema fornecido.`;
}

export async function extrairFolha(opts: {
  imagemBase64: string;
  mimeType: string;
  ano: number;
  mes: number;
  empresa?: string;
  funcionario?: string;
  /** Escritório que pede (teto diário por escritório da IA — Sprint 18 · A). */
  escritorioId?: string | null;
  /** Para teste: variáveis de ambiente e fetch simulados. */
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
}): Promise<ResultadoOCR> {
  // A foto vai em pé (orientação do EXIF aplicada) e sem metadados (localização,
  // aparelho). JPG/PNG/WEBP que não dá para limpar é RECUSADO (não sai com o EXIF);
  // HEIC, que a biblioteca não abre, vai como veio só ao Gemini (a Cloudflare
  // recusa HEIC com mensagem — lib/ia).
  const original = Buffer.from(opts.imagemBase64, 'base64');
  const pronta = await fotoParaIa(new Uint8Array(original), opts.mimeType);
  if (!pronta && ['image/jpeg', 'image/png', 'image/webp'].includes(opts.mimeType)) {
    throw new ErroIa('arquivo', 'folha: foto não pôde ser limpa',
      'Não foi possível preparar esta foto para a leitura. Tire outra foto (JPG) e envie de novo.');
  }
  const bytes = pronta ?? new Uint8Array(original);
  const { texto } = await lerComIa({
    finalidade: 'ponto',
    prompt: promptFolha(opts.ano, opts.mes),
    esquema: ESQUEMA_FOLHA,
    arquivo: { bytes, mime: opts.mimeType },
    escritorioId: opts.escritorioId,
    env: opts.env,
    fetch: opts.fetch,
  });
  const r = interpretarFolha(texto, opts);
  if (!r) throw new ErroIa('resposta', 'folha: JSON inválido');
  return r;
}

/** Valida a resposta da IA (JSON) como sempre: horário limpo, marcador da lista. `null` = JSON torto. */
export function interpretarFolha(
  texto: string,
  opts: { ano: number; mes: number; empresa?: string; funcionario?: string },
): ResultadoOCR | null {
  interface DiaBruto {
    dia?: unknown; incerto?: unknown; marcador?: unknown;
    entradaManha?: unknown; saidaAlmoco?: unknown; retornoAlmoco?: unknown; saidaTarde?: unknown;
  }
  let parsed: { dias?: DiaBruto[]; funcionario?: string };
  try {
    parsed = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const incertos: CampoIncerto[] = [];
  const lista = Array.isArray(parsed.dias) ? parsed.dias.filter((d) => d && typeof d === 'object') : [];
  const dias: DiaFreq[] = lista.map((d: DiaBruto) => {
    if (Array.isArray(d.incerto)) {
      for (const campo of d.incerto) incertos.push({ dia: Number(d.dia), campo });
    }
    const marcador = normalizarMarcador(d.marcador);
    return {
      dia: Number(d.dia),
      entradaManha: limparHora(d.entradaManha),
      saidaAlmoco: limparHora(d.saidaAlmoco),
      retornoAlmoco: limparHora(d.retornoAlmoco),
      saidaTarde: limparHora(d.saidaTarde),
      marcador,
    };
  });

  const frequencia: Frequencia = {
    empresa: opts.empresa ?? '',
    funcionario: opts.funcionario ?? parsed.funcionario ?? '',
    ano: opts.ano,
    mes: opts.mes,
    dias: dias.sort((a, b) => a.dia - b.dia),
  };

  return { frequencia, incertos };
}

function limparHora(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function normalizarMarcador(v: unknown): Marcador | null {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  if (['B', 'H', 'BH', 'B/H', 'BANCO'].includes(s)) return 'BANCO DE HORAS';
  return (MARCADORES as string[]).includes(s) ? (s as Marcador) : null;
}
