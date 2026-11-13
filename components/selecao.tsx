'use client';

// Lista suspensa e autocompletar da marca — substituem o <select> e o
// <datalist> nativos em todo o app.
//
// - <Selecao>: escolhe UM valor de uma lista fechada. Teclado completo (setas,
//   Home/End, Enter, Esc, digitar para saltar/filtrar), busca embutida quando a
//   lista é longa, papéis ARIA de combobox/listbox.
// - <EntradaSugestoes>: campo de texto LIVRE com sugestões (o antigo datalist).
//
// A lista abre num portal com posição fixa: não é cortada por tabela com
// rolagem nem por modal, e vira para cima quando falta espaço embaixo.
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { IconeBusca, IconeCheck } from '@/app/(app)/icones';
import { controleCls, cx, seloCls, TamanhoCampo, Tom } from './ui';

export interface Opcao {
  valor: string;
  rotulo: string;
  /** Texto de apoio à direita (ex.: "rápido, grátis"). */
  detalhe?: string;
}

/** Ignora acento e caixa na busca. */
const chave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function Seta({ aberto }: { aberto: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      className={cx('shrink-0 text-tinta-suave transition-transform', aberto && 'rotate-180')}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// ------------------------------------------------------------- flutuante
/** Posiciona o painel (fixo) junto à âncora; vira para cima se faltar espaço. */
function posicionar(a: HTMLElement | null, p: HTMLElement | null) {
  if (!a || !p) return;
  const r = a.getBoundingClientRect();
  const margem = 8;
  const abaixo = window.innerHeight - r.bottom - margem;
  const acima = r.top - margem;
  const paraCima = abaixo < 220 && acima > abaixo;
  const px = (n: number) => `${Math.round(n)}px`;
  p.style.minWidth = px(r.width);
  p.style.maxHeight = px(Math.max(140, Math.min(340, (paraCima ? acima : abaixo) - 4)));
  const largura = Math.max(p.offsetWidth, r.width);
  p.style.left = px(Math.max(margem, Math.min(r.left, window.innerWidth - margem - largura)));
  p.style.top = paraCima ? 'auto' : px(r.bottom + 4);
  p.style.bottom = paraCima ? px(window.innerHeight - r.top + 4) : 'auto';
  p.style.visibility = 'visible';
}

/** Painel flutuante ancorado a um elemento; fecha ao clicar fora. */
function Flutuante({ ancora, onFechar, children }: {
  ancora: React.RefObject<HTMLElement | null>; onFechar: () => void; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fecharRef = useRef(onFechar);
  useEffect(() => { fecharRef.current = onFechar; });

  // A cada render: o conteúdo (lista filtrada) muda a altura e a largura.
  useLayoutEffect(() => { posicionar(ancora.current, ref.current); });

  useEffect(() => {
    const reposicionar = () => posicionar(ancora.current, ref.current);
    const fora = (e: PointerEvent) => {
      const alvo = e.target as Node;
      if (ref.current?.contains(alvo) || ancora.current?.contains(alvo)) return;
      fecharRef.current();
    };
    // A rolagem de dentro da própria lista não reposiciona nada.
    const rolou = (e: Event) => { if (!ref.current?.contains(e.target as Node)) reposicionar(); };
    document.addEventListener('pointerdown', fora, true);
    window.addEventListener('scroll', rolou, true);
    window.addEventListener('resize', reposicionar);
    return () => {
      document.removeEventListener('pointerdown', fora, true);
      window.removeEventListener('scroll', rolou, true);
      window.removeEventListener('resize', reposicionar);
    };
  }, [ancora]);

  return createPortal(
    <div ref={ref}
      className="fixed left-0 top-0 z-[60] flex max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-lg border border-borda bg-superficie text-sm shadow-flutuante"
      style={{ visibility: 'hidden' }}>
      {children}
    </div>,
    document.body,
  );
}

const OPCAO = 'flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left sm:py-1.5';

// --------------------------------------------------------------- Selecao
interface PropsSelecao {
  valor: string;
  onChange: (valor: string) => void;
  opcoes: Opcao[];
  /** Texto quando nenhum valor está escolhido (ou a lista está vazia). */
  placeholder?: string;
  rotulo?: React.ReactNode;
  dica?: React.ReactNode;
  classeCampo?: string;
  tamanho?: TamanhoCampo;
  /** Largura do gatilho; padrão `w-full`. */
  largura?: string;
  disabled?: boolean;
  /** Nome acessível quando não há `rotulo` visível. */
  'aria-label'?: string;
  /** Liga/desliga a busca; por padrão aparece com mais de 8 opções. */
  busca?: boolean;
  /** `campo` (padrão), `celula` (dentro de tabela) ou `selo` (pílula colorida). */
  aparencia?: 'campo' | 'celula' | 'selo';
  /** Tom do selo, quando `aparencia="selo"`. */
  tom?: Tom;
  id?: string;
}

export function Selecao({
  valor, onChange, opcoes, placeholder = 'Selecione…', rotulo, dica, classeCampo, tamanho = 'md',
  largura = 'w-full', disabled, busca, aparencia = 'campo', tom = 'neutro', id, ...resto
}: PropsSelecao) {
  const auto = useId();
  const idBase = id ?? auto;
  const idLista = `${idBase}-lista`;
  const gatilho = useRef<HTMLButtonElement>(null);
  const campoBusca = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const [aberto, setAberto] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [ativo, setAtivo] = useState(0);
  const digitado = useRef({ texto: '', quando: 0 });

  const comBusca = busca ?? opcoes.length > 8;
  const escolhida = opcoes.find((o) => o.valor === valor);
  const visiveis = useMemo(() => {
    const t = chave(filtro.trim());
    return t ? opcoes.filter((o) => chave(`${o.rotulo} ${o.detalhe ?? ''}`).includes(t)) : opcoes;
  }, [opcoes, filtro]);

  function abrir() {
    if (disabled) return;
    setFiltro('');
    setAtivo(Math.max(0, opcoes.findIndex((o) => o.valor === valor)));
    setAberto(true);
  }
  function fechar(devolverFoco = true) {
    setAberto(false);
    if (devolverFoco) gatilho.current?.focus();
  }
  function escolher(o: Opcao | undefined) {
    if (!o) return;
    if (o.valor !== valor) onChange(o.valor);
    fechar();
  }

  // Ao abrir com busca, o foco vai para o campo de filtro.
  useEffect(() => { if (aberto && comBusca) campoBusca.current?.focus(); }, [aberto, comBusca]);
  // Mantém a opção ativa à vista.
  useEffect(() => {
    if (!aberto) return;
    lista.current?.querySelector<HTMLElement>(`[data-indice="${ativo}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [aberto, ativo, visiveis]);

  function tecla(e: React.KeyboardEvent) {
    if (!aberto) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); abrir(); }
      return;
    }
    const ultimo = visiveis.length - 1;
    switch (e.key) {
      case 'Escape':
        // Não deixa o Esc chegar ao modal que estiver por baixo.
        e.preventDefault(); e.stopPropagation(); fechar(); return;
      case 'ArrowDown': e.preventDefault(); setAtivo((a) => Math.min(ultimo, a + 1)); return;
      case 'ArrowUp': e.preventDefault(); setAtivo((a) => Math.max(0, a - 1)); return;
      case 'Home': if (!comBusca) { e.preventDefault(); setAtivo(0); } return;
      case 'End': if (!comBusca) { e.preventDefault(); setAtivo(ultimo); } return;
      case 'Enter': e.preventDefault(); escolher(visiveis[ativo]); return;
      case 'Tab': fechar(false); return;
      case ' ': if (!comBusca) { e.preventDefault(); escolher(visiveis[ativo]); } return;
    }
    // Sem campo de busca, digitar salta para a opção que começa com o texto.
    if (!comBusca && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const agora = Date.now();
      const d = digitado.current;
      d.texto = agora - d.quando > 700 ? e.key : d.texto + e.key;
      d.quando = agora;
      const alvo = chave(d.texto);
      const i = visiveis.findIndex((o) => chave(o.rotulo).startsWith(alvo));
      if (i >= 0) setAtivo(i);
    }
  }

  const idAtivo = aberto && visiveis[ativo] ? `${idBase}-op-${ativo}` : undefined;
  const classeGatilho =
    aparencia === 'selo'
      ? cx(seloCls(tom), 'cursor-pointer gap-1.5 pr-2 transition-shadow hover:ring-2 disabled:opacity-50')
      : aparencia === 'celula'
        ? cx('flex h-8 items-center justify-between gap-2 rounded-md border border-borda bg-transparent px-2.5 text-left text-base text-tinta transition-colors hover:border-borda-forte disabled:opacity-50 sm:text-sm', largura)
        : controleCls({ tamanho, largura, className: 'flex items-center justify-between gap-2 text-left' });

  const controle = (
    <>
      <button ref={gatilho} type="button" id={idBase} disabled={disabled}
        role="combobox" aria-haspopup="listbox" aria-expanded={aberto} aria-controls={aberto ? idLista : undefined}
        aria-activedescendant={comBusca ? undefined : idAtivo} aria-label={resto['aria-label']}
        aria-describedby={dica ? `${idBase}-dica` : undefined}
        onClick={() => (aberto ? fechar() : abrir())} onKeyDown={tecla}
        className={classeGatilho}>
        <span className={cx('min-w-0 truncate', !escolhida && aparencia !== 'selo' && 'text-tinta-fraca')}>
          {escolhida ? escolhida.rotulo : placeholder}
        </span>
        <Seta aberto={aberto} />
      </button>

      {aberto && (
        <Flutuante ancora={gatilho} onFechar={() => fechar(false)}>
          {comBusca && (
            <div className="relative border-b border-borda p-1.5">
              <IconeBusca size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-tinta-fraca" />
              <input ref={campoBusca} value={filtro} placeholder="Buscar…"
                role="combobox" aria-expanded="true" aria-controls={idLista} aria-autocomplete="list"
                aria-activedescendant={idAtivo} aria-label="Buscar na lista"
                onChange={(e) => { setFiltro(e.target.value); setAtivo(0); }} onKeyDown={tecla}
                className="h-9 w-full rounded-md bg-superficie-suave pl-8 pr-2 text-base text-tinta placeholder:text-tinta-fraca focus-visible:outline-none sm:h-8 sm:text-sm" />
            </div>
          )}
          <ul ref={lista} id={idLista} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1">
            {visiveis.map((o, i) => (
              <li key={o.valor} id={`${idBase}-op-${i}`} data-indice={i} role="option" aria-selected={o.valor === valor}
                onMouseDown={(e) => e.preventDefault()} onMouseMove={() => setAtivo(i)} onClick={() => escolher(o)}
                className={cx(OPCAO, i === ativo ? 'bg-superficie-realce text-tinta' : 'text-tinta', o.valor === valor && 'font-medium')}>
                <span className="min-w-0 flex-1 truncate">{o.rotulo}</span>
                {o.detalhe && <span className="shrink-0 text-xs text-tinta-suave">{o.detalhe}</span>}
                <IconeCheck size={15} className={cx('shrink-0 text-primaria-texto', o.valor !== valor && 'invisible')} />
              </li>
            ))}
            {visiveis.length === 0 && (
              <li role="presentation" className="px-2.5 py-3 text-center text-tinta-fraca">
                {opcoes.length === 0 ? 'Nenhuma opção.' : 'Nada encontrado.'}
              </li>
            )}
          </ul>
        </Flutuante>
      )}
    </>
  );

  if (!rotulo && !dica && !classeCampo) return controle;
  return (
    <div className={classeCampo}>
      {rotulo && <label htmlFor={idBase} className="mb-1.5 block text-[13px] font-medium text-tinta">{rotulo}</label>}
      {controle}
      {dica && <span id={`${idBase}-dica`} className="mt-1.5 block text-xs leading-relaxed text-tinta-suave">{dica}</span>}
    </div>
  );
}

// ------------------------------------------------------ EntradaSugestoes
interface PropsSugestoes extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'value' | 'onChange' | 'list'> {
  value: string;
  onChange: (valor: string) => void;
  /** Valores sugeridos; o usuário pode digitar qualquer outro. */
  sugestoes: string[];
  rotulo?: React.ReactNode;
  dica?: React.ReactNode;
  classeCampo?: string;
  tamanho?: TamanhoCampo;
  largura?: string;
}

/** Campo de texto livre com lista de sugestões (substitui input + datalist). */
export function EntradaSugestoes({
  value, onChange, sugestoes, rotulo, dica, classeCampo, tamanho, largura, className, id, onKeyDown, onFocus, ...resto
}: PropsSugestoes) {
  const auto = useId();
  const idBase = id ?? auto;
  const idLista = `${idBase}-lista`;
  const campo = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(-1);

  const visiveis = useMemo(() => {
    const t = chave(value.trim());
    const achadas = t ? sugestoes.filter((s) => chave(s).includes(t)) : sugestoes;
    // Se o que está digitado já é a única sugestão, não há o que sugerir.
    return achadas.length === 1 && chave(achadas[0]) === t ? [] : achadas.slice(0, 50);
  }, [sugestoes, value]);
  const mostra = aberto && visiveis.length > 0;

  useEffect(() => {
    if (!mostra || ativo < 0) return;
    lista.current?.querySelector<HTMLElement>(`[data-indice="${ativo}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [mostra, ativo]);

  function escolher(s: string) {
    onChange(s);
    setAberto(false);
    setAtivo(-1);
  }

  function tecla(e: React.KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(e);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!mostra) { setAberto(true); setAtivo(0); } else setAtivo((a) => Math.min(visiveis.length - 1, a + 1));
    } else if (e.key === 'ArrowUp' && mostra) {
      e.preventDefault(); setAtivo((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter' && mostra && ativo >= 0) {
      e.preventDefault(); escolher(visiveis[ativo]);
    } else if (e.key === 'Escape' && mostra) {
      e.preventDefault(); e.stopPropagation(); setAberto(false); setAtivo(-1);
    } else if (e.key === 'Tab') {
      setAberto(false);
    }
  }

  const controle = (
    <>
      <input ref={campo} id={idBase} value={value} autoComplete="off"
        role="combobox" aria-autocomplete="list" aria-expanded={mostra} aria-controls={mostra ? idLista : undefined}
        aria-activedescendant={mostra && ativo >= 0 ? `${idBase}-op-${ativo}` : undefined}
        aria-describedby={dica ? `${idBase}-dica` : undefined}
        onChange={(e) => { onChange(e.target.value); setAberto(true); setAtivo(-1); }}
        onFocus={(e) => { onFocus?.(e); setAberto(true); }}
        onKeyDown={tecla}
        className={controleCls({ tamanho, largura, className })} {...resto} />
      {mostra && (
        <Flutuante ancora={campo} onFechar={() => setAberto(false)}>
          <ul ref={lista} id={idLista} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1">
            {visiveis.map((s, i) => (
              <li key={s} id={`${idBase}-op-${i}`} data-indice={i} role="option" aria-selected={i === ativo}
                onMouseDown={(e) => e.preventDefault()} onMouseMove={() => setAtivo(i)} onClick={() => escolher(s)}
                className={cx(OPCAO, 'text-tinta', i === ativo && 'bg-superficie-realce')}>
                <span className="min-w-0 flex-1 truncate">{s}</span>
              </li>
            ))}
          </ul>
        </Flutuante>
      )}
    </>
  );

  if (!rotulo && !dica && !classeCampo) return controle;
  return (
    <div className={classeCampo}>
      {rotulo && <label htmlFor={idBase} className="mb-1.5 block text-[13px] font-medium text-tinta">{rotulo}</label>}
      {controle}
      {dica && <span id={`${idBase}-dica`} className="mt-1.5 block text-xs leading-relaxed text-tinta-suave">{dica}</span>}
    </div>
  );
}
