// Peças comuns das rotas do escritório (não é rota: só `route.ts` vira endpoint).
import { ErroEscritorio } from '@/lib/escritorioServidor';

export function falha(e: unknown) {
  if (e instanceof ErroEscritorio) return Response.json({ erro: e.message }, { status: e.status });
  console.error('[escritorio]', e);
  return Response.json({ erro: 'Falha ao processar as configurações do escritório.' }, { status: 502 });
}
