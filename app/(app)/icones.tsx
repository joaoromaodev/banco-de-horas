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

/** X — excluir (pinte de vermelho no uso: `text-perigo`, ou <BotaoIcone tom="perigo">). */
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

/** Sino — alerta/notificação (ex.: lançamentos a conferir). */
export function IconeSino({ size = 14, className }: Props) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
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

/** Três barras — abrir o menu no celular. */
export function IconeMenu({ size = 20, className }: Props) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

/** Seta para a bandeja — baixar arquivo. */
export function IconeBaixar({ size = 16, className }: Props) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19h14" />
    </svg>
  );
}

/** Mais — adicionar. */
export function IconeMais({ size = 16, className }: Props) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Lupa — busca. */
export function IconeBusca({ size = 16, className }: Props) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

/** Folha com linhas — documentos. */
export function IconeDocumento({ size = 16, className }: Props) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  );
}

/** "i" no círculo — informação. */
export function IconeInfo({ size = 18, className }: Props) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5v.5" />
    </svg>
  );
}

/** Triângulo com exclamação — atenção. */
export function IconeAlerta({ size = 18, className }: Props) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M10.3 4.3 2.7 17.5a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.5v4.5M12 17v.5" />
    </svg>
  );
}

/** Círculo com exclamação — erro. */
export function IconeErro({ size = 18, className }: Props) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16v.5" />
    </svg>
  );
}

/** Faísca — sugestão (de conta, no Livro Caixa). */
export function IconeSugestao({ size = 16, className }: Props) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M12 3.5 13.8 9a1.5 1.5 0 0 0 1 1l5.7 1.9-5.7 1.9a1.5 1.5 0 0 0-1 1L12 20.5 10.2 14.8a1.5 1.5 0 0 0-1-1L3.5 11.9 9.2 10a1.5 1.5 0 0 0 1-1Z" />
    </svg>
  );
}

/** Câmera — tirar foto (folha de ponto pelo celular). */
export function IconeCamera({ size = 16, className }: Props) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.4-2h5.8l1.4 2h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z" />
      <circle cx="12" cy="12.75" r="3.25" />
    </svg>
  );
}
