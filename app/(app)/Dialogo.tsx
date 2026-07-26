'use client';

// Modais na identidade visual do site (mesma moldura do seletor de conta): fundo
// esmaecido, cartão branco arredondado. Substituem os `confirm()`/`prompt()`
// nativos, que destoavam do resto.
import { useEffect, useRef, useState } from 'react';

function Moldura({ onFechar, children }: { onFechar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onFechar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onFechar]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-4 pt-24" onClick={onFechar}>
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/** Confirmação de ação destrutiva. `perigo` pinta o botão de confirmar de vermelho. */
export function DialogoConfirmacao({
  titulo, mensagem, textoConfirmar = 'Excluir', perigo = true, onConfirmar, onCancelar,
}: {
  titulo: string; mensagem: React.ReactNode; textoConfirmar?: string; perigo?: boolean;
  onConfirmar: () => void; onCancelar: () => void;
}) {
  return (
    <Moldura onFechar={onCancelar}>
      <div className="p-5">
        <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>
        <p className="mt-2 text-sm text-slate-600">{mensagem}</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
        <button onClick={onCancelar}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
          Cancelar
        </button>
        <button onClick={onConfirmar}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white ${perigo ? 'bg-red-600 hover:bg-red-700' : 'bg-indigo-600 hover:bg-indigo-700'}`}>
          {textoConfirmar}
        </button>
      </div>
    </Moldura>
  );
}

/** Entrada de um valor (substitui o `prompt()`). Devolve o texto digitado. */
export function DialogoValor({
  titulo, descricao, valorInicial = '', rotulo, onConfirmar, onCancelar,
}: {
  titulo: string; descricao?: string; valorInicial?: string; rotulo?: string;
  onConfirmar: (v: string) => void; onCancelar: () => void;
}) {
  const [valor, setValor] = useState(valorInicial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);

  return (
    <Moldura onFechar={onCancelar}>
      <form onSubmit={(e) => { e.preventDefault(); onConfirmar(valor); }}>
        <div className="p-5">
          <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>
          {descricao && <p className="mt-2 text-sm text-slate-600">{descricao}</p>}
          {rotulo && <label className="mt-3 mb-1 block text-xs font-medium text-slate-600">{rotulo}</label>}
          <input ref={ref} value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100" />
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
          <button type="button" onClick={onCancelar}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
            Cancelar
          </button>
          <button type="submit" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
            Salvar
          </button>
        </div>
      </form>
    </Moldura>
  );
}
