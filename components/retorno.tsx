'use client';

// Retorno ao usuário na cara da marca: notificações (toasts) e balões de dica
// (tooltips). Nada de alert() nem de `title` cru do navegador.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconeAlerta, IconeConfirmar, IconeErro, IconeExcluir, IconeInfo } from '@/app/(app)/icones';
import { cx } from './ui';

// ================================================================== toasts
type TomToast = 'sucesso' | 'perigo' | 'aviso' | 'info';
const TOAST_TOM: Record<TomToast, { faixa: string; icone: string; Icone: typeof IconeInfo }> = {
  sucesso: { faixa: 'bg-sucesso', icone: 'text-sucesso', Icone: IconeConfirmar },
  perigo: { faixa: 'bg-perigo', icone: 'text-perigo', Icone: IconeErro },
  aviso: { faixa: 'bg-aviso', icone: 'text-aviso', Icone: IconeAlerta },
  info: { faixa: 'bg-primaria', icone: 'text-primaria-texto', Icone: IconeInfo },
};

/**
 * Pilha de notificações, fixa no canto superior direito (centralizada no
 * celular). Cada tela põe UMA pilha e, dentro dela, um <Toast> por estado:
 *
 *   <Toasts>
 *     {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
 *     {msg && <Toast onFechar={() => setMsg(null)}>{msg}</Toast>}
 *   </Toasts>
 */
export function Toasts({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-[70] flex flex-col items-center gap-2 px-4 sm:items-end lg:top-4">
      {children}
    </div>
  );
}

/**
 * Uma notificação. `sucesso` some sozinha (5 s); erro, aviso e as que têm
 * `acao` (ex.: Desfazer) ficam até o usuário fechar — ninguém perde um erro
 * nem a chance de desfazer por causa de um cronômetro.
 */
export function Toast({ tom = 'sucesso', acao, onFechar, duracao, children }: {
  tom?: TomToast; acao?: React.ReactNode; onFechar: () => void;
  /** Milissegundos até sumir; `null` = fica até fechar. */
  duracao?: number | null; children: React.ReactNode;
}) {
  const { faixa, icone, Icone } = TOAST_TOM[tom];
  const prazo = duracao === undefined ? (tom === 'sucesso' && !acao ? 5000 : null) : duracao;
  const fecharRef = useRef(onFechar);
  useEffect(() => { fecharRef.current = onFechar; });
  // O cronômetro recomeça quando o texto muda.
  const texto = typeof children === 'string' ? children : '';
  useEffect(() => {
    if (prazo == null) return;
    const t = setTimeout(() => fecharRef.current(), prazo);
    return () => clearTimeout(t);
  }, [prazo, texto]);

  return (
    <div role={tom === 'perigo' ? 'alert' : 'status'}
      className="pointer-events-auto relative flex w-full max-w-sm animate-entrada items-start gap-3 overflow-hidden rounded-xl border border-borda bg-superficie py-3 pl-5 pr-2.5 text-sm text-tinta shadow-flutuante">
      <span className={cx('absolute inset-y-0 left-0 w-1', faixa)} aria-hidden="true" />
      <Icone size={18} className={cx('mt-px shrink-0', icone)} />
      <div className="min-w-0 flex-1 break-words leading-snug">
        {children}
        {acao && <div className="mt-2">{acao}</div>}
      </div>
      <button type="button" onClick={onFechar} aria-label="Fechar notificação"
        className="-mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-tinta-fraca transition-colors hover:bg-superficie-realce hover:text-tinta">
        <IconeExcluir size={14} />
      </button>
    </div>
  );
}

// =================================================================== dicas
interface Balao { texto: string; x: number; y: number; abaixo: boolean }

/**
 * Balões de dica da marca. Montado uma vez no layout raiz: qualquer elemento
 * com `data-dica="texto"` ganha o balão ao passar o mouse ou focar pelo teclado
 * — sem `title` nativo. Um só ouvinte para o app inteiro; o balão fica num
 * portal, então não é cortado por tabela com rolagem.
 */
export function Dicas() {
  const [balao, setBalao] = useState<Balao | null>(null);

  useEffect(() => {
    let espera: ReturnType<typeof setTimeout> | undefined;
    let atual: Element | null = null;

    const esconder = () => { clearTimeout(espera); atual = null; setBalao(null); };
    const mostrar = (el: Element, atraso: number) => {
      const texto = el.getAttribute('data-dica');
      if (!texto || el === atual) return;
      clearTimeout(espera);
      atual = el;
      espera = setTimeout(() => {
        if (!el.isConnected) return;
        const r = el.getBoundingClientRect();
        const abaixo = r.top < 56;
        setBalao({
          texto,
          x: Math.max(12, Math.min(window.innerWidth - 12, r.left + r.width / 2)),
          y: abaixo ? r.bottom + 8 : r.top - 8,
          abaixo,
        });
      }, atraso);
    };
    const alvo = (e: Event) => (e.target instanceof Element ? e.target.closest('[data-dica]') : null);

    const entrou = (e: Event) => { const el = alvo(e); if (el) mostrar(el, 350); else if (atual) esconder(); };
    const focou = (e: Event) => {
      const el = alvo(e);
      // Só no foco de teclado — clicar num botão não deve deixar o balão preso.
      if (el && e.target instanceof Element && e.target.matches(':focus-visible')) mostrar(el, 0);
    };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') esconder(); };

    document.addEventListener('mouseover', entrou);
    document.addEventListener('focusin', focou);
    document.addEventListener('focusout', esconder);
    document.addEventListener('pointerdown', esconder, true);
    document.addEventListener('keydown', tecla);
    window.addEventListener('scroll', esconder, true);
    return () => {
      clearTimeout(espera);
      document.removeEventListener('mouseover', entrou);
      document.removeEventListener('focusin', focou);
      document.removeEventListener('focusout', esconder);
      document.removeEventListener('pointerdown', esconder, true);
      document.removeEventListener('keydown', tecla);
      window.removeEventListener('scroll', esconder, true);
    };
  }, []);

  if (!balao) return null;
  return createPortal(
    <div role="tooltip"
      className="pointer-events-none fixed z-[80] w-max max-w-[min(18rem,calc(100vw-1.5rem))] rounded-md bg-petroleo-950 px-2.5 py-1.5 text-xs font-medium leading-snug text-white shadow-flutuante"
      style={{
        left: balao.x, top: balao.y,
        transform: `translate(-50%, ${balao.abaixo ? '0' : '-100%'})`,
      }}>
      {balao.texto}
    </div>,
    document.body,
  );
}
