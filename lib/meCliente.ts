// Leitura de `/api/me` no navegador, sem repetir a ida ao servidor.
//
// O layout e a página abertos juntos pediam `/api/me` duas vezes (e cada tela
// nova, de novo). Aqui as chamadas simultâneas — e as que vêm até `TTL_MS`
// depois — compartilham a mesma resposta. `esquecerMe()` limpa no login/logout,
// para outra pessoa no mesmo navegador nunca herdar a sessão anterior.
// Só para componentes de cliente (usa `fetch` do navegador).

const TTL_MS = 5_000;

let guardada: { em: number; promessa: Promise<unknown> } | null = null;

/** O JSON de `/api/me` quando autenticado (`r.ok`); `null` caso contrário. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON da sessão; cada tela tipa o que usa
export function lerMe<T = any>(): Promise<T | null> {
  if (guardada && Date.now() - guardada.em < TTL_MS) return guardada.promessa as Promise<T | null>;
  const promessa = fetch('/api/me')
    .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
    .catch(() => null);
  const atual = { em: Date.now(), promessa };
  guardada = atual;
  // Resposta que falhou não fica guardada: a próxima tela tenta de novo.
  void promessa.then((v) => { if (v === null && guardada === atual) guardada = null; });
  return promessa;
}

export function esquecerMe(): void {
  guardada = null;
}
