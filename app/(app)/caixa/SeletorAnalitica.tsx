'use client';

// Escolha da Conta Analítica (o antigo "histórico"), com busca — o gêmeo do
// SeletorConta, para a analítica se comportar igual à titular.
//
// A analítica é **subgrupo da titular**: quando uma titular está escolhida, a
// lista mostra só as analíticas dela. Sem titular ainda, mostra o catálogo
// inteiro — assim dá para escolher a analítica primeiro, e ela preenche a
// titular (quem faz isso é a tela). As "desta empresa" ficam no topo.
//
// Criar analítica que **não existe no catálogo** é só da contadora, e sempre sob
// a titular corrente (a natureza sai dela).
import { useMemo, useState } from 'react';

export interface Historico {
  id: string;
  texto: string;
  natureza: 'receita' | 'despesa';
  contaId: string | null;
  daEmpresa: boolean;
}

interface Props {
  historicos: Historico[];
  valor: string | null; // o texto da analítica escolhida
  /** Titular selecionada: filtra a lista para os subgrupos dela. */
  titularId: string | null;
  onEscolher: (h: Historico) => void;
  /** Só a contabilidade cria analítica nova no catálogo. */
  podeCriar?: boolean;
  onCriar?: (texto: string) => Promise<Historico | null>;
  compacto?: boolean;
}

/** Ignora acento e caixa: quem digita "atendimento" acha "Atendimento". */
const chave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function SeletorAnalitica({ historicos, valor, titularId, onEscolher, podeCriar, onCriar, compacto }: Props) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [criando, setCriando] = useState(false);
  const [textoNovo, setTextoNovo] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  function abrir() {
    setBusca(''); setCriando(false); setErro(null);
    setAberto(true);
  }

  const { minhas, resto } = useMemo(() => {
    const t = chave(busca.trim());
    // Com titular escolhida, só as analíticas dela; sem titular, o catálogo todo.
    const noEscopo = titularId ? historicos.filter((h) => h.contaId === titularId) : historicos;
    const casa = (h: Historico) => !t || chave(h.texto).includes(t);
    const achadas = noEscopo.filter(casa);
    return {
      minhas: achadas.filter((h) => h.daEmpresa),
      resto: achadas.filter((h) => !h.daEmpresa),
    };
  }, [historicos, busca, titularId]);

  function escolher(h: Historico) {
    onEscolher(h);
    setAberto(false);
  }

  async function criar() {
    setErro(null);
    if (!onCriar) return;
    if (!titularId) { setErro('Escolha a conta titular antes de criar a analítica.'); return; }
    if (!textoNovo.trim()) { setErro('Informe o texto da analítica.'); return; }
    try {
      const nova = await onCriar(textoNovo.trim());
      if (nova) { setTextoNovo(''); escolher(nova); }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        title={valor ?? 'Escolher conta analítica…'}
        className={`w-full truncate rounded border px-1.5 text-left ${compacto ? 'py-0.5' : 'py-1'} ${
          valor ? 'border-slate-300 bg-white text-slate-700' : 'border-amber-300 bg-amber-50 text-amber-800'
        } hover:border-petroleo-500`}
      >
        {valor || 'Escolher conta analítica…'}
      </button>

      {aberto && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-4 pt-16"
          onClick={() => setAberto(false)}>
          <div className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-200 p-3">
              <input
                autoFocus
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setAberto(false);
                  if (e.key === 'Enter') {
                    const primeira = minhas[0] ?? resto[0];
                    if (primeira) escolher(primeira);
                  }
                }}
                placeholder="Buscar conta analítica…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-petroleo-600"
              />
            </div>

            <div className="max-h-[50vh] overflow-y-auto text-sm">
              {minhas.length > 0 && (
                <Secao titulo="Analíticas desta empresa">
                  {minhas.map((h) => <Item key={h.id} h={h} sel={h.texto === valor} onClick={() => escolher(h)} />)}
                </Secao>
              )}
              {resto.length > 0 && (
                <Secao titulo={minhas.length ? 'Catálogo completo' : 'Catálogo'}>
                  {resto.map((h) => <Item key={h.id} h={h} sel={h.texto === valor} onClick={() => escolher(h)} />)}
                </Secao>
              )}
              {minhas.length === 0 && resto.length === 0 && (
                <p className="px-4 py-6 text-center text-slate-400">
                  {titularId ? 'Nenhuma analítica para esta titular.' : 'Nenhuma analítica encontrada.'}
                </p>
              )}
            </div>

            {podeCriar && onCriar && (
              <div className="space-y-2 border-t border-slate-200 bg-slate-50 p-3">
                {criando ? (
                  <div className="space-y-2 rounded-lg border border-slate-300 bg-white p-2">
                    <input value={textoNovo} onChange={(e) => setTextoNovo(e.target.value)}
                      placeholder="Texto da analítica (ex.: Atendimento)"
                      className="w-full rounded border border-slate-300 px-2 py-1 text-xs" />
                    {erro && <p className="text-xs text-red-600">{erro}</p>}
                    <div className="flex gap-2">
                      <button type="button" onClick={criar} className="rounded bg-petroleo-900 px-3 py-1 text-xs text-white">Criar e usar</button>
                      <button type="button" onClick={() => setCriando(false)} className="rounded border border-slate-300 px-3 py-1 text-xs">Cancelar</button>
                    </div>
                    <p className="text-xs text-slate-400">Entra como subgrupo da conta titular escolhida.</p>
                  </div>
                ) : titularId ? (
                  <button type="button" onClick={() => setCriando(true)}
                    className="text-xs text-petroleo-700 hover:underline">+ Criar conta analítica no catálogo</button>
                ) : (
                  <p className="text-xs text-slate-400">Escolha a conta titular para poder criar uma analítica nova.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="sticky top-0 bg-slate-100 px-4 py-1 text-xs font-medium uppercase tracking-wide text-slate-500">{titulo}</div>
      {children}
    </div>
  );
}

function Item({ h, sel, onClick }: { h: Historico; sel: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex w-full items-baseline gap-2 px-4 py-1.5 text-left hover:bg-petroleo-50 ${sel ? 'bg-petroleo-50' : ''}`}>
      <span className="flex-1 truncate">{h.texto}</span>
      <span className={`shrink-0 text-xs ${h.natureza === 'receita' ? 'text-emerald-600' : 'text-slate-400'}`}>
        {h.natureza === 'receita' ? 'receita' : 'despesa'}
      </span>
    </button>
  );
}
