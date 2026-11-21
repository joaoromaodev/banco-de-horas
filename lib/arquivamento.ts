// Regras puras do arquivamento de empresas (sem I/O; ver docs/multi-escritorio.md).
//
// Arquivar ≠ excluir: a empresa sai de circulação (listas, painel, agenda, cron,
// login do cliente) mas todos os dados dela ficam no banco. Reativar devolve tudo.
import { cabeNoPlano, limiteEmpresas, NOME_PLANO, PLANOS, planoMinimoPara, type Plano } from './cobranca';

export interface ComArquivo { arquivadaEm?: string | null }

export const estaArquivada = (e: ComArquivo): boolean => Boolean(e.arquivadaEm);
export const soAtivas = <T extends ComArquivo>(l: T[]): T[] => l.filter((e) => !estaArquivada(e));
export const soArquivadas = <T extends ComArquivo>(l: T[]): T[] => l.filter(estaArquivada);

/** Motivos sugeridos na tela (o campo é opcional e livre). */
export const MOTIVO_MAX = 200;
export const limparMotivo = (m: unknown): string | null => {
  const t = String(m ?? '').trim().slice(0, MOTIVO_MAX);
  return t || null;
};

/**
 * Reativar volta a contar no limite do plano — senão arquivar → cadastrar outra →
 * reativar viraria brecha. Plano nulo (escritório sem plano lido) não barra.
 */
export function podeReativar(plano: Plano | null, ativasAgora: number):
  { ok: true } | { ok: false; erro: string; limite: number } {
  if (!plano || cabeNoPlano(plano, ativasAgora, ativasAgora + 1)) return { ok: true };
  const limite = limiteEmpresas(plano) ?? 0;
  const sugerido = PLANOS[planoMinimoPara(ativasAgora + 1)].nome;
  return {
    ok: false, limite,
    erro: `O plano ${NOME_PLANO[plano]} comporta até ${limite} empresas-clientes ativas. Para reativar esta, arquive outra ou suba para o ${sugerido} em Assinatura.`,
  };
}
