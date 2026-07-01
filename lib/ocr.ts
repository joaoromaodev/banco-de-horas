// Extração da folha de ponto manuscrita via Gemini (saída estruturada em JSON).
import { GoogleGenAI, Type } from '@google/genai';
import { Frequencia, DiaFreq, Marcador, MARCADORES } from './tipos';

export interface CampoIncerto {
  dia: number;
  campo: string;
}

export interface ResultadoOCR {
  frequencia: Frequencia;
  incertos: CampoIncerto[];
}

const schema = {
  type: Type.OBJECT,
  properties: {
    funcionario: { type: Type.STRING, nullable: true },
    dias: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          dia: { type: Type.INTEGER },
          entradaManha: { type: Type.STRING, nullable: true },
          saidaAlmoco: { type: Type.STRING, nullable: true },
          retornoAlmoco: { type: Type.STRING, nullable: true },
          saidaTarde: { type: Type.STRING, nullable: true },
          marcador: { type: Type.STRING, nullable: true },
          incerto: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            nullable: true,
          },
        },
        required: ['dia'],
      },
    },
  },
  required: ['dias'],
};

function prompt(ano: number, mes: number, funcionario?: string): string {
  return `Você é um transcritor de folhas de ponto manuscritas brasileiras.
A imagem é uma "FOLHA DE PONTO INDIVIDUAL DE TRABALHO" referente a ${String(mes).padStart(2, '0')}/${ano}${funcionario ? ` do funcionário ${funcionario}` : ''}.

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
  apiKey: string;
  imagemBase64: string;
  mimeType: string;
  ano: number;
  mes: number;
  funcionario?: string;
  modelo?: string;
}): Promise<ResultadoOCR> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const res = await ai.models.generateContent({
    model: opts.modelo ?? 'gemini-2.5-flash',
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: opts.mimeType, data: opts.imagemBase64 } },
          { text: prompt(opts.ano, opts.mes, opts.funcionario) },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      temperature: 0,
    },
  });

  const texto = res.text;
  if (!texto) throw new Error('Gemini não retornou conteúdo.');

  let parsed: any;
  try {
    parsed = JSON.parse(texto);
  } catch {
    throw new Error('Resposta do Gemini não é um JSON válido.');
  }

  const incertos: CampoIncerto[] = [];
  const dias: DiaFreq[] = (parsed.dias ?? []).map((d: any) => {
    if (Array.isArray(d.incerto)) {
      for (const campo of d.incerto) incertos.push({ dia: d.dia, campo });
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
    funcionario: opts.funcionario ?? parsed.funcionario ?? '',
    ano: opts.ano,
    mes: opts.mes,
    dias: dias.sort((a, b) => a.dia - b.dia),
  };

  return { frequencia, incertos };
}

function limparHora(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function normalizarMarcador(v: any): Marcador | null {
  if (!v) return null;
  const s = String(v).trim().toUpperCase();
  if (['B', 'H', 'BH', 'B/H', 'BANCO'].includes(s)) return 'BANCO DE HORAS';
  return (MARCADORES as string[]).includes(s) ? (s as Marcador) : null;
}
