// POST /api/medicao — recebe do navegador a amostra de medição (Sprint 15, frente A).
//
// Qualquer sessão (master, contabilidade, cliente) envia; o papel vem da SESSÃO,
// não do corpo. Cada item é revalidado e a rota é normalizada e conferida contra a
// lista fechada (lib/medicaoRotas.ts) — nada de id, e-mail, query ou corpo.
// A gravação roda em `after`: responde 204 na hora e nunca derruba a tela.
import { NextRequest, after } from 'next/server';
import { exigirSessao } from '@/lib/acesso';
import { validarItem } from '@/lib/medicao';
import { gravarMedicoes, linhaDoItem } from '@/lib/medicaoServidor';
import { Limitador } from '@/lib/limite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ITENS = 50;
const MAX_BYTES = 32_000;
// O navegador junta e manda no máximo a cada 15 s (ou a cada 20 itens): acima disso é
// laço ou abuso. Por instância (lib/limite.ts) — suficiente para não inundar a tabela.
const limitador = new Limitador(10, 60_000);

/** Agenda depois da resposta; fora de um pedido (teste) só dispara sem esperar. */
function depois(fn: () => Promise<unknown>) {
  try { after(fn); } catch { void fn(); }
}

export async function POST(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;
  const vazio = () => new Response(null, { status: 204 });
  if (!limitador.tentar(`${g.sessao.role}:${g.sessao.email}`)) return vazio();
  let corpo: unknown;
  try {
    const texto = await req.text();
    if (texto.length > MAX_BYTES) return vazio();
    corpo = JSON.parse(texto);
  } catch {
    return vazio();
  }
  const brutos = corpo && typeof corpo === 'object' && Array.isArray((corpo as { itens?: unknown }).itens)
    ? (corpo as { itens: unknown[] }).itens.slice(0, MAX_ITENS) : [];
  const linhas = brutos.map(validarItem).filter((i) => i !== null).map((i) => linhaDoItem(i, g.sessao.role));
  if (linhas.length) depois(() => gravarMedicoes(linhas));
  return vazio();
}
