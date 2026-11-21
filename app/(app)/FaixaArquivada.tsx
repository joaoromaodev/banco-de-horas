'use client';

// Consulta de empresa arquivada (somente leitura). A contadora chega aqui pelo
// "Consultar" da seção "Empresas arquivadas" em Cadastro: `?empresa=<id>`. A lista
// normal (`/api/empresas`) não traz arquivadas; `comArquivadaDaUrl` acrescenta a
// empresa pedida na URL e a página a seleciona. A faixa avisa e oferece Reativar.
// Regras e mensagens em lib/arquivamento.ts; a barreira de escrita é do servidor.
import { useState } from 'react';
import { Aviso, Botao } from '@/components/ui';
import { faixaArquivada } from '@/lib/arquivamento';
import type { Empresa } from '@/lib/tipos';

/** Empresa pedida em `?empresa=` (vazio se não houver). */
export function empresaDaUrl(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('empresa')?.trim() ?? '';
}

/**
 * Devolve a lista com a empresa arquivada da URL (se houver e não estiver na lista)
 * e o id a selecionar (`''` quando a URL não pede uma arquivada).
 */
export async function comArquivadaDaUrl<T extends Pick<Empresa, 'id'>>(lista: T[]): Promise<{ lista: T[]; consulta: string }> {
  const id = empresaDaUrl();
  if (!id || lista.some((e) => e.id === id)) return { lista, consulta: '' };
  try {
    const r = await fetch('/api/empresas?arquivadas=1');
    const d = r.ok ? await r.json() : null;
    const achada = (d?.empresas as T[] | undefined)?.find((e) => e.id === id);
    if (achada) return { lista: [...lista, achada], consulta: id };
  } catch { /* sem a consulta, a página abre normal */ }
  return { lista, consulta: '' };
}

/** Faixa "Empresa arquivada em DD/MM/AAAA — somente consulta" + Reativar. */
export function FaixaArquivada({ empresa }: { empresa?: Pick<Empresa, 'id' | 'nome' | 'arquivadaEm'> | null }) {
  const [reativando, setReativando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  if (!empresa?.arquivadaEm) return null;

  async function reativar() {
    if (!empresa) return;
    setReativando(true); setErro(null);
    try {
      const r = await fetch('/api/empresas', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: empresa.id, acao: 'reativar' }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.erro || 'Não foi possível reativar.');
      window.location.assign(`${window.location.pathname}?empresa=${encodeURIComponent(empresa.id)}`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível reativar.');
      setReativando(false);
    }
  }

  return (
    <Aviso tom="aviso" className="mb-4"
      titulo={`${empresa.nome}: ${faixaArquivada(empresa.arquivadaEm)}`}
      acao={<Botao tamanho="sm" onClick={reativar} disabled={reativando}>{reativando ? 'Reativando…' : 'Reativar'}</Botao>}>
      Dá para consultar e exportar, mas não lançar nem alterar. Reative a empresa para voltar a trabalhar nela.
      {erro && <span role="alert" className="mt-1 block font-medium text-perigo">{erro}</span>}
    </Aviso>
  );
}
