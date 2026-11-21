// Limite de tentativas por chave (IP) em memória — janela deslizante simples.
//
// Suficiente para frear robô no cadastro público. Em serverless cada instância
// tem o seu mapa, então o limite é "por instância": aceitável para o volume de
// hoje; se virar alvo, trocar por um contador no Postgres ou no provedor.

export class Limitador {
  private batidas = new Map<string, number[]>();
  private maximo: number;
  private janelaMs: number;
  constructor(maximo: number, janelaMs: number) {
    this.maximo = maximo;
    this.janelaMs = janelaMs;
  }

  /** Registra uma tentativa; `false` quando a chave já estourou a janela. */
  tentar(chave: string, agora: number = Date.now()): boolean {
    const desde = agora - this.janelaMs;
    const recentes = (this.batidas.get(chave) ?? []).filter((t) => t > desde);
    if (recentes.length >= this.maximo) {
      this.batidas.set(chave, recentes);
      return false;
    }
    recentes.push(agora);
    this.batidas.set(chave, recentes);
    // Faxina ocasional para o mapa não crescer sem fim.
    if (this.batidas.size > 5_000) {
      for (const [k, v] of this.batidas) if (!v.some((t) => t > desde)) this.batidas.delete(k);
    }
    return true;
  }
}

/** IP do cliente atrás do proxy da Vercel (primeiro de `x-forwarded-for`). */
export function ipDe(headers: Headers): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || 'desconhecido';
}
