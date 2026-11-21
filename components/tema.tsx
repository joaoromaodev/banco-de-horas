'use client';
// Tema claro / escuro / automático. A preferência fica em localStorage
// ('cc-tema': 'claro' | 'escuro'; ausente = automático). O <html> recebe sempre o
// tema JÁ RESOLVIDO em `data-tema` — o script abaixo roda no <head> antes da
// primeira pintura, então não há piscada. As telas nunca consultam o tema: só
// usam os papéis de cor de app/globals.css.
import { useSyncExternalStore } from 'react';

export type PreferenciaTema = 'auto' | 'claro' | 'escuro';
const CHAVE = 'cc-tema';

/** Script inline do <head> (string): aplica o tema salvo e segue o sistema no automático. */
export const SCRIPT_TEMA = `(function(){try{var d=document.documentElement,m=matchMedia('(prefers-color-scheme: dark)');function a(){var p=null;try{p=localStorage.getItem('${CHAVE}')}catch(e){}d.dataset.tema=p==='claro'||p==='escuro'?p:(m.matches?'escuro':'claro')}a();m.addEventListener('change',a);addEventListener('storage',a)}catch(e){}})()`;

/** Preferência escolhida quando o localStorage não grava (navegação privada): vale só nesta carga. */
let semDisco: PreferenciaTema | null = null;

function ler(): PreferenciaTema {
  if (semDisco) return semDisco;
  try {
    const p = localStorage.getItem(CHAVE);
    return p === 'claro' || p === 'escuro' ? p : 'auto';
  } catch {
    return 'auto';
  }
}

// A preferência é um "armazenamento externo" (localStorage): o botão a lê com
// useSyncExternalStore — no servidor vale 'auto'; no navegador, o que está salvo,
// e outra aba que trocar o tema avisa pelo evento `storage`.
const ouvintes = new Set<() => void>();
function assinar(aoMudar: () => void) {
  ouvintes.add(aoMudar);
  addEventListener('storage', aoMudar);
  return () => { ouvintes.delete(aoMudar); removeEventListener('storage', aoMudar); };
}
const noServidor = (): PreferenciaTema => 'auto';

function aplicar(p: PreferenciaTema) {
  try {
    if (p === 'auto') localStorage.removeItem(CHAVE);
    else localStorage.setItem(CHAVE, p);
    semDisco = null;
  } catch { semDisco = p; /* navegação privada: vale só nesta carga */ }
  const escuro = p === 'escuro' || (p === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.tema = escuro ? 'escuro' : 'claro';
  ouvintes.forEach((f) => f());
}

const ORDEM: PreferenciaTema[] = ['auto', 'claro', 'escuro'];
const ROTULO: Record<PreferenciaTema, string> = { auto: 'Automático', claro: 'Claro', escuro: 'Escuro' };

function Sol() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
    </svg>
  );
}
function Lua() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
    </svg>
  );
}
function Auto() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" />
    </svg>
  );
}

/** Botão que alterna automático → claro → escuro. `className` veste o botão. */
export function BotaoTema({ className = '' }: { className?: string }) {
  const pref = useSyncExternalStore(assinar, ler, noServidor);

  const proxima = ORDEM[(ORDEM.indexOf(pref) + 1) % ORDEM.length];
  const rotulo = `Tema: ${ROTULO[pref]}. Trocar para ${ROTULO[proxima].toLowerCase()}`;
  return (
    <button type="button" aria-label={rotulo} data-dica={rotulo} className={className}
      onClick={() => aplicar(proxima)}>
      {pref === 'claro' ? <Sol /> : pref === 'escuro' ? <Lua /> : <Auto />}
    </button>
  );
}
