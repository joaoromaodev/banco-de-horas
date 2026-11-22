'use client';

// Modais na identidade visual do site: fundo esmaecido, cartão branco
// arredondado. Substituem os `confirm()`/`prompt()` nativos, que destoavam do
// resto. `Modal` é a moldura única — os seletores de conta também a usam.
import { useEffect, useId, useRef, useState } from 'react';
import { AreaTexto, Botao, Entrada } from '@/components/ui';

const FOCAVEIS =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Moldura de diálogo modal. Fecha no Esc e no clique fora, prende o Tab dentro
 * do cartão, trava a rolagem da página e devolve o foco a quem abriu.
 * O foco inicial vai para o elemento com `data-foco-inicial` (ou `autoFocus`).
 */
export function Modal({ onFechar, rotuladoPor, rotulo, largura = 'max-w-md', children }: {
  onFechar: () => void;
  /** id do título do diálogo (aria-labelledby)… */
  rotuladoPor?: string;
  /** …ou um nome direto (aria-label), quando não há título visível. */
  rotulo?: string;
  largura?: string;
  children: React.ReactNode;
}) {
  const caixaRef = useRef<HTMLDivElement>(null);
  const fecharRef = useRef(onFechar);
  useEffect(() => { fecharRef.current = onFechar; });

  useEffect(() => {
    const caixa = caixaRef.current;
    const anterior = document.activeElement as HTMLElement | null;
    const inicial = caixa?.querySelector<HTMLElement>('[data-foco-inicial]');
    if (inicial) inicial.focus();
    else if (caixa && !caixa.contains(document.activeElement)) caixa.focus();

    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { fecharRef.current(); return; }
      if (e.key !== 'Tab' || !caixa) return;
      const itens = Array.from(caixa.querySelectorAll<HTMLElement>(FOCAVEIS));
      if (itens.length === 0) { e.preventDefault(); return; }
      const primeiro = itens[0];
      const ultimo = itens[itens.length - 1];
      const atual = document.activeElement;
      if (e.shiftKey && (atual === primeiro || atual === caixa)) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && (atual === ultimo || !caixa.contains(atual))) { e.preventDefault(); primeiro.focus(); }
    };
    window.addEventListener('keydown', tecla);

    const rolagem = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', tecla);
      document.body.style.overflow = rolagem;
      if (anterior?.isConnected) anterior.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-petroleo-950/45 p-4 pt-[10vh] backdrop-blur-[2px]"
      onClick={onFechar}>
      <div ref={caixaRef} role="dialog" aria-modal="true" aria-labelledby={rotuladoPor} aria-label={rotulo} tabIndex={-1}
        className={`w-full ${largura} overflow-hidden rounded-xl bg-superficie shadow-flutuante outline-none`}
        onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

const RODAPE = 'flex flex-col-reverse gap-2 border-t border-borda bg-superficie-suave px-5 py-3 sm:flex-row sm:justify-end';

/** Confirmação de ação destrutiva. `perigo` pinta o botão de confirmar de vermelho. */
export function DialogoConfirmacao({
  titulo, mensagem, textoConfirmar = 'Excluir', perigo = true, onConfirmar, onCancelar,
}: {
  titulo: string; mensagem: React.ReactNode; textoConfirmar?: string; perigo?: boolean;
  onConfirmar: () => void; onCancelar: () => void;
}) {
  const id = useId();
  return (
    <Modal onFechar={onCancelar} rotuladoPor={id}>
      <div className="p-5">
        <h2 id={id} className="text-base font-semibold text-tinta">{titulo}</h2>
        <p className="mt-2 text-sm leading-relaxed text-tinta-suave">{mensagem}</p>
      </div>
      <div className={RODAPE}>
        {/* Em ação destrutiva o foco nasce no Cancelar: Enter sem querer não apaga nada. */}
        <Botao onClick={onCancelar} data-foco-inicial={perigo ? '' : undefined}>Cancelar</Botao>
        <Botao variante={perigo ? 'perigo' : 'primaria'} onClick={onConfirmar}
          data-foco-inicial={perigo ? undefined : ''}>
          {textoConfirmar}
        </Botao>
      </div>
    </Modal>
  );
}

/** Entrada de um valor (substitui o `prompt()`). Devolve o texto digitado. */
export function DialogoValor({
  titulo, descricao, valorInicial = '', rotulo, onConfirmar, onCancelar,
}: {
  titulo: string; descricao?: string; valorInicial?: string; rotulo?: string;
  onConfirmar: (v: string) => void; onCancelar: () => void;
}) {
  const id = useId();
  const [valor, setValor] = useState(valorInicial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  return (
    <Modal onFechar={onCancelar} rotuladoPor={id}>
      <form onSubmit={(e) => { e.preventDefault(); onConfirmar(valor); }}>
        <div className="p-5">
          <h2 id={id} className="text-base font-semibold text-tinta">{titulo}</h2>
          {descricao && <p className="mt-2 text-sm leading-relaxed text-tinta-suave">{descricao}</p>}
          <Entrada ref={ref} classeCampo="mt-4" rotulo={rotulo} aria-label={rotulo ? undefined : titulo}
            value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" />
        </div>
        <div className={RODAPE}>
          <Botao onClick={onCancelar}>Cancelar</Botao>
          <Botao type="submit" variante="primaria">Salvar</Botao>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Texto obrigatório antes de uma ação (o motivo de reabrir um mês fechado, a dúvida
 * do cliente). Valida o tamanho mínimo na hora e mostra o erro embaixo do campo.
 */
export function DialogoTexto({
  titulo, descricao, rotulo, textoConfirmar, perigo = false, minimo = 5, maximo = 500, placeholder, erroCurto,
  onConfirmar, onCancelar,
}: {
  titulo: string; descricao?: React.ReactNode; rotulo: string; textoConfirmar: string; perigo?: boolean;
  minimo?: number; maximo?: number; placeholder?: string; erroCurto: string;
  onConfirmar: (texto: string) => void; onCancelar: () => void;
}) {
  const id = useId();
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Modal onFechar={onCancelar} rotuladoPor={id}>
      <form onSubmit={(e) => {
        e.preventDefault();
        const t = texto.replace(/\s+/g, ' ').trim();
        if (t.length < minimo) { setErro(erroCurto); return; }
        onConfirmar(t);
      }}>
        <div className="p-5">
          <h2 id={id} className="text-base font-semibold text-tinta">{titulo}</h2>
          {descricao && <div className="mt-2 text-sm leading-relaxed text-tinta-suave">{descricao}</div>}
          <AreaTexto classeCampo="mt-4" rotulo={rotulo} rows={3} maxLength={maximo} value={texto} data-foco-inicial
            erro={erro ?? undefined} placeholder={placeholder}
            onChange={(e) => { setTexto(e.target.value); setErro(null); }} />
        </div>
        <div className={RODAPE}>
          <Botao onClick={onCancelar}>Cancelar</Botao>
          <Botao type="submit" variante={perigo ? 'perigo' : 'primaria'}>{textoConfirmar}</Botao>
        </div>
      </form>
    </Modal>
  );
}
