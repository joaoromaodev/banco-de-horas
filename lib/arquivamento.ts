// Regras puras do arquivamento de empresas (sem I/O; ver docs/multi-escritorio.md).
//
// Arquivar ≠ excluir: a empresa sai de circulação (listas, painel, agenda, cron,
// login do cliente) mas todos os dados dela ficam no banco. Reativar devolve tudo.
import { cabeNoPlano, ehExportacaoPost, limiteEmpresas, NOME_PLANO, PLANOS, planoMinimoPara, type Plano } from './cobranca';

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

// ---------------------------------------------------------------- Consulta de arquivadas
// A contadora abre a empresa arquivada em modo SOMENTE LEITURA (sem reativar):
// leitura e exportação passam; qualquer escrita é barrada, de forma central —
// no proxy (409, quando a requisição traz a empresa) e em `podeAcessarEmpresa`
// (rede de segurança para rotas que só descobrem a empresa pelo id do registro).

/** Rotas que cuidam do próprio arquivamento: não passam pela barreira. */
const FORA_DA_BARREIRA = ['/api/empresas', '/api/login', '/api/logout', '/api/criar-conta', '/api/cobranca'];

export const MENSAGEM_ARQUIVADA = 'Empresa arquivada — reative em Cadastros para alterar';

/** Este método/caminho grava dados? (exportação por POST não conta; arquivar/reativar tem regra própria.) */
export function ehEscritaDeDados(metodo: string, caminho: string): boolean {
  if (!caminho.startsWith('/api/')) return false;
  const m = metodo.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return false;
  if (FORA_DA_BARREIRA.some((p) => caminho === p || caminho.startsWith(p + '/'))) return false;
  return !ehExportacaoPost(caminho);
}

/** Ids de empresa citados numa requisição: `?empresa=`, `empresa`, `empresaId`, `empresas[]` (e `frequencia.empresa`). */
export function empresasCitadas(consulta: URLSearchParams, corpo: unknown): string[] {
  const ids = new Set<string>();
  const add = (v: unknown) => { const t = typeof v === 'string' ? v.trim() : ''; if (t) ids.add(t); };
  consulta.getAll('empresa').forEach(add);
  if (corpo && typeof corpo === 'object') {
    const c = corpo as Record<string, unknown>;
    add(c.empresa); add(c.empresaId);
    if (Array.isArray(c.empresas)) c.empresas.forEach(add);
    if (c.frequencia && typeof c.frequencia === 'object') add((c.frequencia as Record<string, unknown>).empresa);
  }
  return [...ids];
}

/** Algum dos ids é de empresa arquivada? */
export function citaArquivada(ids: string[], empresas: Array<ComArquivo & { id: string }>): boolean {
  const arq = new Set(empresas.filter(estaArquivada).map((e) => e.id));
  return ids.some((i) => arq.has(i));
}

/**
 * Regra de acesso a UMA empresa já carregada. Arquivada: só a contabilidade
 * (master/usuario do escritório) e só para ler; escrita e o papel `cliente` não.
 */
export function acessoAArquivada(papel: 'master' | 'usuario' | 'cliente', escrita: boolean): boolean {
  return papel !== 'cliente' && !escrita;
}

/** "Empresa arquivada em 21/11/2026 — somente consulta". */
export function faixaArquivada(arquivadaEm: string | null | undefined): string {
  const d = arquivadaEm ? new Date(arquivadaEm) : null;
  const data = d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : null;
  return `Empresa arquivada${data ? ` em ${data}` : ''} — somente consulta`;
}
