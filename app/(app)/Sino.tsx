'use client';

// O sino de notificações do app: contabilidade (o que o cliente fez) e cliente (avisos da
// própria empresa: folha devolvida, pedido de documento, Demonstrativo pronto). O estado mora no layout
// (`useSino`) para o botão da barra do celular e o da barra lateral mostrarem a mesma
// contagem; o painel abre uma vez só. Regras em lib/notificacoes.ts, rota em
// app/api/notificacoes. Ver docs/notificacoes.md.
import { useCallback, useEffect, useRef, useState } from 'react';
import { quandoRelativo, rotuloSino, type Notificacao } from '@/lib/notificacoes';
import { Botao, BotaoIcone, cx } from '@/components/ui';
import { IconeExcluir, IconeSino } from './icones';

const REVERIFICAR_MS = 5 * 60_000;

interface Estado { itens: Notificacao[]; persistido: boolean; indisponiveis: string[]; carregou: boolean }

const ler = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const gravar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem armazenamento: segue sem lembrar */ } };

/** Estado do sino: busca ao montar, ao voltar para a aba e de tempos em tempos. */
export function useSino(ativo: boolean, escopo: 'contabilidade' | 'cliente' = 'contabilidade') {
  // Sem a 0027 o navegador lembra o "lido"; cliente e contabilidade no mesmo navegador não se misturam.
  const sufixo = escopo === 'cliente' ? '.cliente' : '';
  const CHAVE_VISTO = `sino.visto${sufixo}`;
  const CHAVE_LIDAS = `sino.lidas${sufixo}`;
  const [estado, setEstado] = useState<Estado>({ itens: [], persistido: true, indisponiveis: [], carregou: false });
  const [locais, setLocais] = useState<Set<string>>(new Set());
  const ultima = useRef(0);

  const carregar = useCallback(async (forcar = false) => {
    if (!ativo || (!forcar && Date.now() - ultima.current < 60_000)) return;
    ultima.current = Date.now();
    try {
      const visto = ler(CHAVE_VISTO);
      const r = await fetch(`/api/notificacoes${visto ? `?desde=${encodeURIComponent(visto)}` : ''}`, { cache: 'no-store' });
      if (!r.ok) return;
      const x = await r.json();
      if (!x.disponivel) return;
      if (!x.persistido && !visto) gravar(CHAVE_VISTO, new Date().toISOString()); // primeira vez sem a 0027: começa limpo
      setEstado({ itens: x.itens, persistido: x.persistido, indisponiveis: x.indisponiveis ?? [], carregou: true });
    } catch { /* sem rede: mantém o que tinha */ }
  }, [ativo, CHAVE_VISTO]);

  useEffect(() => {
    if (!ativo) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lê localStorage/URL só no navegador, após hidratar (no useState inicial divergiria do HTML do servidor)
    try { setLocais(new Set(JSON.parse(ler(CHAVE_LIDAS) ?? '[]'))); } catch { /* lista local corrompida: ignora */ }
    carregar(true);
    const t = setInterval(() => { if (document.visibilityState === 'visible') carregar(true); }, REVERIFICAR_MS);
    const foco = () => { if (document.visibilityState === 'visible') carregar(); };
    document.addEventListener('visibilitychange', foco);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', foco); };
  }, [ativo, carregar, CHAVE_LIDAS]);

  const lida = (n: Notificacao) => n.lida || (!estado.persistido && locais.has(n.chave));
  const naoLidas = estado.itens.filter((n) => !lida(n)).length;

  async function marcar(chave?: string) {
    // Otimista: some na hora; o servidor confirma (e, sem a 0027, o navegador lembra).
    setEstado((e) => ({ ...e, itens: e.itens.map((n) => (!chave || n.chave === chave ? { ...n, lida: true } : n)) }));
    try {
      const r = await fetch('/api/notificacoes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chave ? { acao: 'lida', chave } : { acao: 'todas' }),
      });
      const x = await r.json().catch(() => ({}));
      if (r.ok && x.persistido) return;
    } catch { /* cai no armazenamento do navegador */ }
    if (chave) {
      const novo = new Set(locais).add(chave);
      setLocais(novo);
      gravar(CHAVE_LIDAS, JSON.stringify([...novo].slice(-200)));
    } else {
      gravar(CHAVE_VISTO, new Date().toISOString());
      gravar(CHAVE_LIDAS, '[]');
      setLocais(new Set());
    }
  }

  return { ...estado, lida, naoLidas, recarregar: () => carregar(true), marcar };
}

export type SinoEstado = ReturnType<typeof useSino>;

export function SinoBotao({ sino, aberto, onAlternar, className }: {
  sino: SinoEstado; aberto: boolean; onAlternar: () => void; className?: string;
}) {
  return (
    <button type="button" onClick={onAlternar} aria-haspopup="dialog" aria-expanded={aberto}
      aria-label={rotuloSino(sino.naoLidas)} data-dica="Notificações" className={cx('relative', className)}>
      <IconeSino size={18} />
      {sino.naoLidas > 0 && (
        <span aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-perigo-solido px-1 text-[10px] font-semibold leading-none text-white">
          {sino.naoLidas > 9 ? '9+' : sino.naoLidas}
        </span>
      )}
    </button>
  );
}

const ROTULO_TIPO: Record<Notificacao['tipo'], string> = {
  documento: 'Documento', pendencia: 'Pedido', caixa: 'Livro Caixa', conferencia: 'Conferência', evento: 'Aviso',
  folha_devolvida: 'Folha de ponto', pedido: 'Documentos', demonstrativo: 'Livro Caixa', aceite_ponto: 'Folha de ponto',
  entrega: 'Da contabilidade', documento_devolvido: 'Documentos', lembrete: 'Prazo',
};

/** Painel de notificações; `recolhido` ajusta a posição ao lado da barra lateral (desktop). */
export function SinoPainel({ sino, aberto, onFechar, recolhido }: {
  sino: SinoEstado; aberto: boolean; onFechar: () => void; recolhido: boolean;
}) {
  const painel = useRef<HTMLDivElement>(null);
  // `onFechar` e `recarregar` mudam de identidade a cada render do layout: em refs, o
  // efeito abaixo roda só ao abrir/fechar (antes, cada resposta da API re-renderizava,
  // refazia o efeito e pedia de novo — e o foco voltava ao painel a cada vez).
  const fecharRef = useRef(onFechar);
  const recarregarRef = useRef(sino.recarregar);
  useEffect(() => { fecharRef.current = onFechar; recarregarRef.current = sino.recarregar; });
  useEffect(() => {
    if (!aberto) return;
    // Quem abriu (o sino da barra do celular ou o da barra lateral) recebe o foco de volta ao fechar.
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const caixa = painel.current;
    recarregarRef.current();
    caixa?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') fecharRef.current(); };
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('keydown', esc);
      const foco = document.activeElement;
      const perdido = !foco || foco === document.body || !foco.isConnected || !!caixa?.contains(foco);
      if (perdido && anterior?.isConnected) anterior.focus();
    };
  }, [aberto]);
  if (!aberto) return null;

  return (
    <>
      <div className="fixed inset-0 z-[55]" aria-hidden="true" onClick={onFechar} />
      <div ref={painel} role="dialog" aria-label="Notificações" tabIndex={-1}
        className={cx(
          'fixed z-[60] flex max-h-[75vh] flex-col overflow-hidden rounded-xl border border-borda bg-superficie text-tinta shadow-flutuante outline-none',
          'inset-x-3 top-16 sm:left-auto sm:right-4 sm:w-96',
          'lg:inset-x-auto lg:bottom-4 lg:top-auto lg:w-96', recolhido ? 'lg:left-20' : 'lg:left-64',
        )}>
        <div className="flex items-center justify-between gap-2 border-b border-borda px-4 py-3">
          <h2 className="text-sm font-semibold">Notificações</h2>
          <div className="flex items-center gap-1">
            <Botao tamanho="sm" variante="fantasma" disabled={sino.naoLidas === 0} onClick={() => sino.marcar()}>Marcar todas como lidas</Botao>
            {/* No celular não há Esc nem "clicar fora" óbvio: o fechar fica à vista. */}
            <BotaoIcone rotulo="Fechar notificações" tom="apagado" onClick={onFechar}><IconeExcluir size={16} /></BotaoIcone>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {sino.itens.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-tinta-suave">
              {sino.carregou ? 'Nada novo nos últimos 14 dias.' : 'Carregando…'}
            </p>
          ) : (
            <ul className="divide-y divide-borda">
              {sino.itens.map((n) => {
                const lida = sino.lida(n);
                return (
                  <li key={n.chave}>
                    <a href={n.href} onClick={() => { if (!lida) sino.marcar(n.chave); onFechar(); }}
                      className={cx('flex gap-3 px-4 py-3 transition-colors hover:bg-superficie-realce', !lida && 'bg-primaria-suave/50')}>
                      <span aria-hidden="true" className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', lida ? 'bg-transparent' : 'bg-primaria')} />
                      <span className="min-w-0 flex-1">
                        <span className={cx('block text-sm text-tinta', !lida && 'font-semibold')}>
                          {!lida && <span className="sr-only">Não lida: </span>}{n.titulo}
                        </span>
                        {n.texto && <span className="mt-0.5 block line-clamp-2 text-[13px] text-tinta-suave">{n.texto}</span>}
                        <span className="mt-1 block text-xs text-tinta-fraca">
                          {ROTULO_TIPO[n.tipo]}{n.empresa ? ` · ${n.empresa}` : ''} · {quandoRelativo(n.quando)}
                        </span>
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {sino.indisponiveis.length > 0 && (
          <p className="border-t border-borda bg-aviso-suave px-4 py-2 text-xs text-aviso">
            Não deu para ler agora: {sino.indisponiveis.join(', ')}. A lista pode estar incompleta.
          </p>
        )}
      </div>
    </>
  );
}
