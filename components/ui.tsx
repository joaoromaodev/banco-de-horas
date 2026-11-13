'use client';

// Primitivas de interface do ClickContas — o vocabulário visual único do app.
//
// Tudo aqui é só Tailwind sobre os papéis semânticos de app/globals.css (fundo,
// superficie, borda, tinta, primaria, sucesso, aviso, perigo, foco). Nenhuma tela
// deve escrever `slate-*`, `red-*`, `emerald-*`… na mão: se faltar um tom, ele
// entra como papel no globals.css e como variante aqui.
//
// Guia de uso: docs/identidade-visual.md.
import { useId } from 'react';
import { IconeAlerta, IconeBaixar, IconeConfirmar, IconeErro, IconeInfo } from '@/app/(app)/icones';

type Cls = string | false | null | undefined;
/** Junta classes, ignorando as falsas. */
export const cx = (...c: Cls[]) => c.filter(Boolean).join(' ');

// =============================================================== carregando
function Giro({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** Indicador de carregamento em linha ("Carregando…"). */
export function Carregando({ children = 'Carregando…', className }: { children?: React.ReactNode; className?: string }) {
  return (
    <p role="status" className={cx('inline-flex items-center gap-2 text-[13px] text-tinta-suave', className)}>
      <Giro size={14} /> {children}
    </p>
  );
}

// =================================================================== botões
export type VarianteBotao = 'primaria' | 'secundaria' | 'tonal' | 'fantasma' | 'perigo' | 'sucesso';
export type TamanhoBotao = 'sm' | 'md' | 'lg';

const BOTAO_BASE =
  'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const BOTAO_VARIANTE: Record<VarianteBotao, string> = {
  /** A ação principal da tela (ou do cartão-formulário). Uma só. */
  primaria: 'bg-primaria text-white shadow-cartao hover:bg-primaria-hover',
  /** Ações de apoio: cancelar, adicionar linha, baixar. */
  secundaria: 'border border-borda-forte/50 bg-superficie text-tinta hover:border-borda-forte hover:bg-superficie-realce',
  /** Destaque suave: a segunda ação mais importante. */
  tonal: 'bg-primaria-suave text-primaria-texto ring-1 ring-inset ring-petroleo-200 hover:bg-petroleo-100',
  /** Ação discreta em linha (links de ação). */
  fantasma: 'text-primaria-texto hover:bg-superficie-realce',
  /** Confirmação de ação destrutiva. */
  perigo: 'bg-perigo-solido text-white shadow-cartao hover:bg-perigo',
  /** Ação positiva de fluxo (confirmar o mês). */
  sucesso: 'bg-sucesso-suave text-sucesso ring-1 ring-inset ring-sucesso-borda hover:bg-verde-100',
};

const BOTAO_TAMANHO: Record<TamanhoBotao, string> = {
  sm: 'h-8 gap-1.5 px-3 text-[13px]',
  md: 'h-9 gap-2 px-3.5 text-sm',
  lg: 'h-11 gap-2 px-5 text-[15px]',
};

/** Classes de botão — para vestir um `<a>` (download) como botão. */
export function botaoCls({ variante = 'secundaria', tamanho = 'md', className }: {
  variante?: VarianteBotao; tamanho?: TamanhoBotao; className?: string;
} = {}) {
  return cx(BOTAO_BASE, BOTAO_VARIANTE[variante], BOTAO_TAMANHO[tamanho], className);
}

interface PropsBotao extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBotao;
  tamanho?: TamanhoBotao;
  /** Mostra o giro e desabilita o botão enquanto a ação roda. */
  carregando?: boolean;
  /** Ícone à esquerda do texto. */
  icone?: React.ReactNode;
}

export function Botao({
  variante = 'secundaria', tamanho = 'md', carregando = false, icone, className, children,
  disabled, type = 'button', ...resto
}: PropsBotao) {
  return (
    <button type={type} disabled={disabled || carregando} aria-busy={carregando || undefined}
      className={botaoCls({ variante, tamanho, className })} {...resto}>
      {carregando ? <Giro /> : icone}
      {children}
    </button>
  );
}

type TomIcone = 'neutro' | 'apagado' | 'primaria' | 'perigo' | 'sucesso';
const ICONE_TOM: Record<TomIcone, string> = {
  neutro: 'text-tinta-suave hover:bg-superficie-realce hover:text-tinta',
  apagado: 'text-tinta-fraca hover:bg-superficie-realce hover:text-tinta',
  primaria: 'text-primaria-texto hover:bg-primaria-suave',
  perigo: 'text-perigo hover:bg-perigo-suave',
  sucesso: 'text-sucesso hover:bg-sucesso-suave',
};

interface PropsBotaoIcone extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  /** Obrigatório: vira `aria-label` e o balão de dica (`title` troca só o texto do balão). */
  rotulo: string;
  tom?: TomIcone;
  tamanho?: 'sm' | 'md';
}

/** Botão só com ícone (editar, excluir, conferir). Sempre com rótulo acessível. */
export function BotaoIcone({ rotulo, tom = 'neutro', tamanho = 'md', title, className, children, type = 'button', ...resto }: PropsBotaoIcone) {
  return (
    <button type={type} aria-label={rotulo} data-dica={title ?? rotulo}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        tamanho === 'sm' ? 'h-7 w-7' : 'h-8 w-8', ICONE_TOM[tom], className,
      )} {...resto}>
      {children}
    </button>
  );
}

// =================================================================== campos
export type TamanhoCampo = 'sm' | 'md' | 'lg';

const CONTROLE_BASE =
  'rounded-lg border bg-superficie text-tinta transition-colors placeholder:text-tinta-fraca focus:border-foco disabled:cursor-not-allowed disabled:border-borda disabled:bg-superficie-suave disabled:text-tinta-fraca';

// 16px no celular evita o zoom automático do iOS ao focar; a partir de `sm` volta à escala do app.
const CONTROLE_TAMANHO: Record<TamanhoCampo, string> = {
  sm: 'h-8 px-2 text-base sm:text-[13px]',
  md: 'h-9 px-3 text-base sm:text-sm',
  lg: 'h-11 px-3.5 text-base sm:text-[15px]',
};

/**
 * Classes de um controle de formulário (input/select). Use quando o elemento
 * precisa ser nativo e cru — o normal é usar <Entrada>/<Selecao>.
 * `largura` é separado do resto para não brigar com o `w-full` padrão.
 */
export function controleCls({ tamanho = 'md', largura = 'w-full', invalido = false, className }: {
  tamanho?: TamanhoCampo; largura?: string; invalido?: boolean; className?: string;
} = {}) {
  return cx(
    CONTROLE_BASE, CONTROLE_TAMANHO[tamanho], largura,
    invalido ? 'border-perigo' : 'border-borda-forte hover:border-tinta-suave',
    className,
  );
}

const ROTULO = 'mb-1.5 block text-[13px] font-medium text-tinta';
const DICA = 'mt-1.5 block text-xs leading-relaxed text-tinta-suave';
const ERRO = 'mt-1.5 block text-xs font-medium text-perigo';

interface PropsCampo {
  /** Rótulo visível acima do controle. */
  rotulo?: React.ReactNode;
  /** Texto de ajuda abaixo. */
  dica?: React.ReactNode;
  /** Mensagem de erro do campo (pinta a borda e é anunciada). */
  erro?: React.ReactNode;
  /** Classes do envelope (rótulo + controle + dica) — ex.: `md:col-span-2`. */
  classeCampo?: string;
  tamanho?: TamanhoCampo;
  /** Largura do controle; padrão `w-full`. */
  largura?: string;
}

function Envelope({ id, rotulo, dica, erro, classeCampo, children }: PropsCampo & { id: string; children: React.ReactNode }) {
  if (!rotulo && !dica && !erro && !classeCampo) return <>{children}</>;
  return (
    <div className={classeCampo}>
      {rotulo && <label htmlFor={id} className={ROTULO}>{rotulo}</label>}
      {children}
      {dica && <span id={`${id}-dica`} className={DICA}>{dica}</span>}
      {erro && <span id={`${id}-erro`} role="alert" className={ERRO}>{erro}</span>}
    </div>
  );
}

function descritoPor(id: string, dica: unknown, erro: unknown, externo?: string) {
  return cx(externo, !!dica && `${id}-dica`, !!erro && `${id}-erro`) || undefined;
}

type PropsEntrada = PropsCampo & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'>;

/** Campo de texto/número/data. Com `rotulo`, já sai com label, dica e erro ligados. */
export function Entrada({ rotulo, dica, erro, classeCampo, tamanho, largura, className, id, ref, 'aria-describedby': descExterno, ...resto }: PropsEntrada & { ref?: React.Ref<HTMLInputElement> }) {
  const auto = useId();
  const idFinal = id ?? auto;
  return (
    <Envelope id={idFinal} rotulo={rotulo} dica={dica} erro={erro} classeCampo={classeCampo}>
      <input ref={ref} id={idFinal} aria-invalid={erro ? true : undefined}
        aria-describedby={descritoPor(idFinal, dica, erro, descExterno)}
        className={controleCls({ tamanho, largura, invalido: !!erro, className })} {...resto} />
    </Envelope>
  );
}

type PropsAreaTexto = Omit<PropsCampo, 'tamanho'> & React.TextareaHTMLAttributes<HTMLTextAreaElement>;

/** Texto longo. */
export function AreaTexto({ rotulo, dica, erro, classeCampo, largura = 'w-full', className, id, 'aria-describedby': descExterno, ...resto }: PropsAreaTexto) {
  const auto = useId();
  const idFinal = id ?? auto;
  return (
    <Envelope id={idFinal} rotulo={rotulo} dica={dica} erro={erro} classeCampo={classeCampo}>
      <textarea id={idFinal} aria-invalid={erro ? true : undefined}
        aria-describedby={descritoPor(idFinal, dica, erro, descExterno)}
        className={cx(
          CONTROLE_BASE, 'min-h-24 px-3 py-2 text-base sm:text-sm', largura,
          erro ? 'border-perigo' : 'border-borda-forte hover:border-tinta-suave', className,
        )} {...resto} />
    </Envelope>
  );
}

/**
 * Envelope de rótulo para um controle que não é Entrada/Selecao (grupo de
 * campos, seletor próprio). O conteúdo fica dentro do <label>.
 */
export function Campo({ rotulo, dica, erro, className, children }: {
  rotulo: React.ReactNode; dica?: React.ReactNode; erro?: React.ReactNode; className?: string; children: React.ReactNode;
}) {
  return (
    <label className={cx('block', className)}>
      <span className={ROTULO}>{rotulo}</span>
      {children}
      {dica && <span className={DICA}>{dica}</span>}
      {erro && <span role="alert" className={ERRO}>{erro}</span>}
    </label>
  );
}

/** Checkbox ou radio com o texto ao lado. */
export function Marcacao({ children, className, ...resto }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cx('inline-flex items-center gap-2 text-sm text-tinta', className)}>
      <input {...resto} />
      <span>{children}</span>
    </label>
  );
}

/**
 * Liga/desliga. É um checkbox por baixo (mesmo `checked`/`onChange`), anunciado
 * como interruptor. Sem texto ao lado, passe `aria-label`.
 */
export function Alternador({ children, className, ...resto }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const controle = <input type="checkbox" role="switch" {...resto} className="alternador" />;
  if (!children) return controle;
  return (
    <label className={cx('inline-flex items-center gap-2.5 text-sm text-tinta', className)}>
      {controle}
      <span>{children}</span>
    </label>
  );
}

/**
 * Escolha de arquivo: área clicável (e que aceita soltar o arquivo em cima) no
 * lugar do "Escolher arquivo" do navegador. O <input type="file"> continua lá,
 * invisível, para teclado e leitor de tela.
 */
export function CampoArquivo({ rotulo, dica, accept, nome, onArquivo, texto = 'Escolher arquivo', classeCampo }: {
  rotulo?: React.ReactNode; dica?: React.ReactNode; accept?: string;
  /** Nome do arquivo escolhido (o estado mora na tela). */
  nome?: string | null;
  onArquivo: (arquivo: File | null) => void;
  /** Chamada quando nada foi escolhido. */
  texto?: string; classeCampo?: string;
}) {
  const id = useId();
  return (
    <div className={classeCampo}>
      {rotulo && <label htmlFor={id} className={ROTULO}>{rotulo}</label>}
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onArquivo(e.dataTransfer.files?.[0] ?? null); }}
        className="flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg border border-dashed border-borda-forte bg-superficie px-3 text-base text-tinta transition-colors hover:border-primaria hover:bg-superficie-realce has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-foco sm:text-sm">
        <input id={id} type="file" accept={accept} className="sr-only"
          aria-describedby={dica ? `${id}-dica` : undefined}
          onChange={(e) => onArquivo(e.target.files?.[0] ?? null)} />
        <IconeBaixar size={16} className="shrink-0 rotate-180 text-primaria-texto" />
        <span className={cx('min-w-0 flex-1 truncate', !nome && 'text-tinta-suave')}>{nome || texto}</span>
        {nome && <span className="shrink-0 text-xs font-medium text-primaria-texto">Trocar</span>}
      </label>
      {dica && <span id={`${id}-dica`} className={DICA}>{dica}</span>}
    </div>
  );
}

/** Bloco pulsante que ocupa o lugar do conteúdo enquanto ele carrega. */
export function Esqueleto({ className = 'h-4 w-full' }: { className?: string }) {
  return <span aria-hidden="true" className={cx('block animate-pulse rounded-md bg-petroleo-100', className)} />;
}

/** Paginação simples: anterior · "página X de Y" · próxima. */
export function Paginacao({ pagina, total, onMudar, className }: {
  pagina: number; total: number; onMudar: (pagina: number) => void; className?: string;
}) {
  return (
    <nav aria-label="Paginação" className={cx('flex items-center justify-between gap-3 text-[13px] text-tinta-suave', className)}>
      <Botao tamanho="sm" disabled={pagina <= 1} onClick={() => onMudar(pagina - 1)}>Anterior</Botao>
      <span aria-live="polite">Página <strong className="text-tinta">{pagina}</strong> de {total}</span>
      <Botao tamanho="sm" disabled={pagina >= total} onClick={() => onMudar(pagina + 1)}>Próxima</Botao>
    </nav>
  );
}

// ================================================================= estrutura
/** Cabeçalho padrão de toda tela: título, subtítulo, ações à direita e abas. */
export function CabecalhoPagina({ titulo, subtitulo, acoes, abas }: {
  titulo: React.ReactNode; subtitulo?: React.ReactNode;
  /** Filtros e botões da tela (direita no desktop, abaixo no celular). */
  acoes?: React.ReactNode;
  /** Sub-navegação do módulo — um <Abas />. */
  abas?: React.ReactNode;
}) {
  return (
    <header className="border-b border-borda bg-superficie">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 px-4 pb-4 pt-5 sm:px-6 lg:px-8">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-tinta">{titulo}</h1>
          {subtitulo && <p className="mt-0.5 text-sm text-tinta-suave">{subtitulo}</p>}
        </div>
        {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
      </div>
      {abas && <div className="px-4 sm:px-6 lg:px-8">{abas}</div>}
    </header>
  );
}

export interface ItemAba { rotulo: string; href: string; ativa?: boolean }

/** Abas de sub-navegação (links). A ativa leva `aria-current="page"`. */
export function Abas({ itens, rotulo }: { itens: ItemAba[]; rotulo: string }) {
  return (
    <nav aria-label={rotulo} className="-mb-px flex gap-1 overflow-x-auto">
      {itens.map((i) => (
        <a key={i.href} href={i.href} aria-current={i.ativa ? 'page' : undefined}
          className={cx(
            'whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:-outline-offset-2',
            i.ativa
              ? 'border-primaria text-primaria'
              : 'border-transparent text-tinta-suave hover:border-borda-forte/60 hover:text-tinta',
          )}>
          {i.rotulo}
        </a>
      ))}
    </nav>
  );
}

const LARGURA_CONTEUDO = {
  cheia: '',
  media: 'mx-auto max-w-5xl',
  estreita: 'mx-auto max-w-3xl',
};

/** Área de conteúdo da tela, com as margens e o ritmo vertical padrão. */
export function Conteudo({ largura = 'cheia', className, children }: {
  largura?: keyof typeof LARGURA_CONTEUDO; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={cx('w-full space-y-5 px-4 py-5 sm:px-6 sm:py-6 lg:px-8', LARGURA_CONTEUDO[largura], className)}>
      {children}
    </div>
  );
}

/** Superfície branca com borda — a unidade básica de agrupamento. */
export function Cartao({ className, children, ...resto }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-xl border border-borda bg-superficie shadow-cartao', className)} {...resto}>
      {children}
    </div>
  );
}

/** Cartão com título, descrição e ações — uma seção da tela. */
export function Secao({ titulo, descricao, acoes, className, children }: {
  titulo: React.ReactNode; descricao?: React.ReactNode; acoes?: React.ReactNode;
  className?: string; children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cx('rounded-xl border border-borda bg-superficie shadow-cartao', className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5 sm:pt-5">
        <div className="min-w-0">
          <h2 id={id} className="text-[15px] font-semibold text-tinta">{titulo}</h2>
          {descricao && <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-tinta-suave">{descricao}</p>}
        </div>
        {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

// ============================================================ selo e avisos
export type Tom = 'neutro' | 'primaria' | 'sucesso' | 'aviso' | 'perigo';

const SELO_TOM: Record<Tom, string> = {
  neutro: 'bg-superficie-realce text-tinta-suave ring-borda',
  primaria: 'bg-primaria-suave text-primaria-texto ring-petroleo-200',
  sucesso: 'bg-sucesso-suave text-sucesso ring-sucesso-borda',
  aviso: 'bg-aviso-suave text-aviso ring-aviso-borda',
  perigo: 'bg-perigo-suave text-perigo ring-perigo-borda',
};

/** Classes do selo — para vestir outro elemento (ex.: um <select> de situação). */
export const seloCls = (tom: Tom = 'neutro') =>
  cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', SELO_TOM[tom]);

/** Selo / pílula de situação. */
export function Selo({ tom = 'neutro', className, children }: { tom?: Tom; className?: string; children: React.ReactNode }) {
  return <span className={cx(seloCls(tom), className)}>{children}</span>;
}

type TomAviso = 'info' | 'sucesso' | 'aviso' | 'perigo' | 'neutro';
const AVISO_TOM: Record<TomAviso, { caixa: string; icone: string; Icone: typeof IconeInfo }> = {
  info: { caixa: 'border-petroleo-200 bg-primaria-suave', icone: 'text-primaria-texto', Icone: IconeInfo },
  sucesso: { caixa: 'border-sucesso-borda bg-sucesso-suave', icone: 'text-sucesso', Icone: IconeConfirmar },
  aviso: { caixa: 'border-aviso-borda bg-aviso-suave', icone: 'text-aviso', Icone: IconeAlerta },
  perigo: { caixa: 'border-perigo-borda bg-perigo-suave', icone: 'text-perigo', Icone: IconeErro },
  neutro: { caixa: 'border-borda bg-superficie', icone: 'text-tinta-suave', Icone: IconeInfo },
};

/**
 * Aviso em linha — o retorno de toda ação (erro, sucesso) e os alertas da tela.
 * `perigo` é anunciado na hora (role="alert"); `sucesso`, com educação
 * (role="status"). `acao` recebe um botão à direita (ex.: Desfazer).
 */
export function Aviso({ tom = 'info', titulo, acao, className, children }: {
  tom?: TomAviso; titulo?: React.ReactNode; acao?: React.ReactNode; className?: string; children?: React.ReactNode;
}) {
  const { caixa, icone, Icone } = AVISO_TOM[tom];
  return (
    <div role={tom === 'perigo' ? 'alert' : tom === 'sucesso' ? 'status' : undefined}
      className={cx('flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border px-3.5 py-3 text-sm text-tinta', caixa, className)}>
      <Icone size={18} className={cx('mt-px shrink-0', icone)} />
      <div className="min-w-0 flex-1 basis-48">
        {titulo && <p className="font-semibold">{titulo}</p>}
        {children && <div className={titulo ? 'mt-0.5' : undefined}>{children}</div>}
      </div>
      {acao && <div className="shrink-0">{acao}</div>}
    </div>
  );
}

/** O que mostrar quando não há nada: nunca deixe a área em branco. */
export function EstadoVazio({ titulo, descricao, acao, icone, moldura = true, className }: {
  titulo: React.ReactNode; descricao?: React.ReactNode; acao?: React.ReactNode; icone?: React.ReactNode;
  /** Sem moldura quando já está dentro de uma tabela ou cartão. */
  moldura?: boolean; className?: string;
}) {
  return (
    <div className={cx(
      'flex flex-col items-center justify-center px-4 py-8 text-center',
      moldura && 'rounded-xl border border-dashed border-borda-forte/50', className,
    )}>
      {icone && <span className="mb-2 text-tinta-fraca">{icone}</span>}
      <p className="text-sm font-medium text-tinta-suave">{titulo}</p>
      {descricao && <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-tinta-fraca">{descricao}</p>}
      {acao && <div className="mt-3">{acao}</div>}
    </div>
  );
}

const INDICADOR_TOM = { neutro: 'text-tinta', sucesso: 'text-sucesso', perigo: 'text-perigo' };

/** Número de destaque com rótulo (saldo, entradas, saídas). */
export function Indicador({ rotulo, valor, tom = 'neutro', destaque = false }: {
  rotulo: string; valor: React.ReactNode; tom?: keyof typeof INDICADOR_TOM;
  /** Realça o cartão — use em um só por grupo (o número que importa). */
  destaque?: boolean;
}) {
  return (
    <div className={cx(
      'rounded-xl border bg-superficie px-4 py-3.5 shadow-cartao',
      destaque ? 'border-petroleo-300 ring-1 ring-petroleo-100' : 'border-borda',
    )}>
      <div className="text-xs font-medium text-tinta-suave">{rotulo}</div>
      <div className={cx('mt-1 text-xl font-semibold tracking-tight tabular-nums', INDICADOR_TOM[tom])}>{valor}</div>
    </div>
  );
}

// ================================================================== tabelas
/**
 * Classes de tabela. Montagem:
 *
 *   <div className={tb.moldura}>
 *     <table className={tb.tabela}>
 *       <thead className={tb.cabeca}><tr><th className={tb.th}>…</th></tr></thead>
 *       <tbody className={tb.corpo}>
 *         <tr className={tb.linha}><td className={tb.td}>…</td></tr>
 *
 * Dinheiro e números: some `tb.num` (alinha à direita, sem quebrar).
 */
export const tb = {
  /** Envelope com rolagem horizontal — a tabela rola, a página não. */
  moldura: 'overflow-x-auto rounded-xl border border-borda bg-superficie shadow-cartao',
  tabela: 'w-full border-collapse text-sm',
  cabeca: 'bg-superficie-suave text-left text-[11px] uppercase tracking-wider text-tinta-suave',
  th: 'whitespace-nowrap border-b border-borda px-3 py-2.5 font-semibold',
  corpo: '[&>tr]:border-b [&>tr]:border-borda/70 [&>tr:last-child]:border-b-0',
  /** Linha com realce ao passar o mouse. */
  linha: 'transition-colors hover:bg-superficie-realce/60',
  td: 'px-3 py-2 align-middle',
  /** Célula que contém um campo editável (menos respiro). */
  tdCampo: 'px-1.5 py-1 align-middle',
  num: 'whitespace-nowrap text-right',
  vazio: 'px-3 py-10 text-center text-tinta-fraca',
  rodape: 'border-t border-borda bg-superficie-suave',
};

/** Campo editável dentro de célula de tabela: contorno leve, realça no foco. Some a largura (`w-full`, `w-40`…). */
export const celulaCls =
  'h-8 rounded-md border border-borda bg-transparent px-2.5 text-base text-tinta transition-colors placeholder:text-tinta-fraca hover:border-borda-forte focus:border-foco focus:bg-superficie sm:text-sm';
