// Rota de mentira para provar que a varredura de guarda (tests/guardaRotas.test.ts)
// acusa o que deve. Não é `route.ts`: o Next não a expõe e a varredura real não a lê.
import { NextRequest } from 'next/server';
import { exigirGestor } from '@/lib/acesso';

async function interno(req: NextRequest) {
  return exigirGestor(req);
}

/** Guardado por um helper local: passa. */
export async function GET(req: NextRequest) {
  const g = await interno(req);
  if (!g.ok) return g.resposta;
  return Response.json({ ok: true });
}

/** Só cita a guarda em comentário: exigirGestor(req) — não passa. */
export async function POST() {
  return Response.json({ ok: true });
}

// Homônimo local da guarda: não é a de lib/acesso.ts, não passa.
function exigirSessao() {
  return { ok: true };
}

export async function DELETE() {
  exigirSessao();
  return Response.json({ ok: true });
}
