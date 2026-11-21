// Regras puras de visibilidade do catálogo do Livro Caixa (migração 0013).
// Sem I/O e sem imports de runtime — por isso dá para testar isoladamente.
//
// O catálogo (`plano_contas` e `historicos_padrao`) tem duas camadas:
//   - BASE da plataforma: `escritorio_id` nulo — as contas padrão, de todos;
//   - EXTENSÃO de um escritório: `escritorio_id` preenchido — só aquele escritório vê.
// O `master` administra a plataforma e vê tudo.
import type { Papel } from './auth';

/** O mínimo da sessão de que as regras precisam. */
export interface QuemCatalogo {
  role: Papel;
  escritorioId?: string | null;
}

/** Item de catálogo: só o dono importa aqui. `null`/ausente = base. */
export interface ItemCatalogo { escritorioId?: string | null }

/** O recorte de leitura: tudo (master) ou base + um escritório (ou só a base). */
export type VisaoCatalogo =
  | { todos: true }
  | { todos: false; escritorioId: string | null };

/**
 * A visão do catálogo para uma sessão. Falha fechada: quem não é master e não
 * tem escritório (sessão antiga que não conseguiu se completar) enxerga só o base.
 */
export function visaoDoCatalogo(q: QuemCatalogo): VisaoCatalogo {
  if (q.role === 'master') return { todos: true };
  return { todos: false, escritorioId: q.escritorioId || null };
}

/** O item é visível nesta visão? Base vale para todos; extensão, só para o dono. */
export function itemVisivel(v: VisaoCatalogo, item: ItemCatalogo): boolean {
  if (v.todos) return true;
  if (!item.escritorioId) return true;
  return item.escritorioId === v.escritorioId;
}

/** Filtra uma lista pela visão. */
export function filtrarCatalogo<T extends ItemCatalogo>(v: VisaoCatalogo, itens: T[]): T[] {
  return itens.filter((i) => itemVisivel(v, i));
}

/**
 * Onde uma criação nova grava. `null` = catálogo base (só o master);
 * string = escritório da sessão; `undefined` = não pode criar (contador sem
 * escritório, ou papel que não cria catálogo).
 */
export function donoDaCriacao(q: QuemCatalogo): string | null | undefined {
  if (q.role === 'master') return null;
  if (q.role !== 'usuario') return undefined;
  return q.escritorioId || undefined;
}

/**
 * Próximo código `N.GG.CC` de um grupo. Recebe os códigos que a criação não pode
 * repetir: para um escritório, os do base + os dele; para o master (que cria no
 * base), todos os existentes — assim o novo código base não esbarra em nenhuma
 * extensão. O prefixo `N.GG` vem do primeiro código.
 */
export function proximoCodigo(codigosDoGrupo: string[]): string | null {
  if (codigosDoGrupo.length === 0) return null;
  const prefixo = codigosDoGrupo[0].slice(0, 4);
  const maior = Math.max(...codigosDoGrupo.map((c) => Number(c.slice(5)) || 0));
  return `${prefixo}.${String(maior + 1).padStart(2, '0')}`;
}
