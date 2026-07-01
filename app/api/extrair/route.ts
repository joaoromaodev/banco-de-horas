// POST /api/extrair — recebe a foto da folha (multipart) e devolve a
// frequência estruturada + campos incertos, via Gemini.
import { NextRequest } from 'next/server';
import { extrairFolha } from '@/lib/ocr';
import { getGeminiApiKey, getGeminiModelo } from '@/lib/config';
import { getGeminiKeyDaConfig } from '@/lib/sheets';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  // Chave da contadora (aba Config) tem precedência; env é fallback.
  const apiKey = (await getGeminiKeyDaConfig()) ?? getGeminiApiKey();
  if (!apiKey) {
    return Response.json(
      { erro: 'Chave do Gemini não configurada. Defina em Configurações (ou na variável GEMINI_API_KEY).' },
      { status: 400 },
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ erro: 'Envio inválido (esperado multipart/form-data).' }, { status: 400 });
  }

  const file = form.get('file');
  const ano = Number(form.get('ano'));
  const mes = Number(form.get('mes'));
  const funcionario = (form.get('funcionario') as string) || undefined;

  if (!(file instanceof File)) {
    return Response.json({ erro: 'Arquivo de imagem não enviado.' }, { status: 400 });
  }
  if (!ano || !mes || mes < 1 || mes > 12) {
    return Response.json({ erro: 'Mês/ano inválidos.' }, { status: 400 });
  }

  const mimeType = file.type || 'image/jpeg';
  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64');

  try {
    const resultado = await extrairFolha({
      apiKey,
      imagemBase64: base64,
      mimeType,
      ano,
      mes,
      funcionario,
      modelo: getGeminiModelo(),
    });
    return Response.json(resultado);
  } catch (e: any) {
    return Response.json({ erro: e?.message ?? 'Falha na extração.' }, { status: 502 });
  }
}
