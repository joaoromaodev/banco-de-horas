// Ícones de ação compartilhados pelas telas (lápis, excluir, desfazer, conferir,
// confirmar mês). SVG inline, sem biblioteca — a cor vem do `currentColor`, então
// quem usa controla pelo `text-…` do Tailwind.

type Props = { size?: number; className?: string };

function base(size: number) {
  return {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8,
    strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  };
}

/** Lápis — editar. */
export function IconeLapis({ size = 16, className }: Props) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

/** X — excluir (pinte de vermelho no uso: `text-red-600`). */
export function IconeExcluir({ size = 16, className }: Props) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

/** Seta de voltar — desfazer. */
export function IconeDesfazer({ size = 16, className }: Props) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-1" />
    </svg>
  );
}

/** Check dentro de um selo — confirmar o mês. */
export function IconeConfirmar({ size = 18, className }: Props) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M9 12l2 2 4-4" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

/** Selo com seta — desfazer a confirmação do mês. */
export function IconeDesfazerConfirmacao({ size = 18, className }: Props) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M14.5 9.5 9.5 14.5M9.5 9.5l5 5" />
    </svg>
  );
}

/** Check simples — marcar conferido. */
export function IconeCheck({ size = 16, className }: Props) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** Recolher/expandir a barra lateral (setas duplas). */
export function IconePainel({ size = 18, className, recolhido }: Props & { recolhido?: boolean }) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true"
      style={recolhido ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="m11 17-5-5 5-5M18 17l-5-5 5-5" />
    </svg>
  );
}
