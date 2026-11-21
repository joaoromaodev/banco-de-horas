// Leitura de JSON no navegador para o carregamento principal das telas.
//
// Diferente do `r.ok ? r.json() : null` espalhado pelas telas, aqui a falha NUNCA
// some: resposta não-ok ou sem rede vira `Error` com mensagem humana (a da API, que
// já é em português, ou uma genérica). A tela mostra com `FalhaCarregamento`
// (components/ui) e oferece "Tentar de novo". Só para componentes de cliente.

export const MENSAGEM_SEM_REDE = 'Sem conexão com o servidor. Confira a internet e tente de novo.';
export const MENSAGEM_GENERICA = 'Não foi possível carregar agora. Tente de novo em instantes.';

/** Mensagem humana para mostrar ao usuário a partir de qualquer erro de carga. */
export function mensagemDeCarga(e: unknown): string {
  if (e instanceof ErroCarga) return e.message;
  if (e instanceof TypeError) return MENSAGEM_SEM_REDE; // fetch rejeitado: rede
  return MENSAGEM_GENERICA;
}

export class ErroCarga extends Error {
  constructor(msg: string, readonly status: number) {
    super(msg);
  }
}

/** GET com JSON. Lança `ErroCarga` (mensagem pronta para a tela) se não der certo. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON da API; cada tela tipa o que usa
export async function lerJson<T = any>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, init);
  } catch {
    throw new ErroCarga(MENSAGEM_SEM_REDE, 0);
  }
  const d = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = d && typeof d.erro === 'string' && d.erro.trim() ? d.erro : MENSAGEM_GENERICA;
    throw new ErroCarga(msg, r.status);
  }
  if (d === null) throw new ErroCarga(MENSAGEM_GENERICA, r.status);
  return d as T;
}
