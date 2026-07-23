'use client';

// Escolha da conta do plano de contas, com busca.
//
// A lista é **aberta**, e é aqui que isso aparece: a busca varre o catálogo
// inteiro (118 contas), não só as que a empresa já usa. As já usadas ficam no
// topo — é a "lista dela" na prática —, mas qualquer outra está a uma busca de
// distância, porque há conta que aparece uma vez no mês. Escolher uma conta
// nova a vincula à empresa (quem faz isso é a rota de lançamentos).
//
// Criar conta que **não existe no catálogo** é outra história: só a contadora.
import { useMemo, useState } from 'react';

export interface Conta {
  id: string;
  codigo: string;
  nome: string;
  grupo: string;
  natureza: 'receita' | 'despesa';
  daEmpresa: boolean;
}

interface Props {
  contas: Conta[];
  valor: string | null;
  onEscolher: (contaId: string | null) => void;
  /** Só a contabilidade cria conta nova no catálogo. */
  podeCriar?: boolean;
  onCriar?: (nome: string, grupo: string) => Promise<Conta | null>;
  compacto?: boolean;
}

/** Ignora acento e caixa: quem digita "energia eletrica" acha "Energia Elétrica". */
const chave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function rotuloConta(contas: Conta[], id: string | null): string {
  if (!id) return 'Movimentação bancária';
  const c = contas.find((x) => x.id === id);
  return c ? `${c.codigo} · ${c.nome}` : '— conta removida —';
}

export default function SeletorConta({ contas, valor, onEscolher, podeCriar, onCriar, compacto }: Props) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [criando, setCriando] = useState(false);
  const [nomeNovo, setNomeNovo] = useState('');
  const [grupoNovo, setGrupoNovo] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  function abrir() {
    setBusca(''); setCriando(false); setErro(null);
    setAberto(true);
  }

  const grupos = useMemo(() => [...new Set(contas.map((c) => c.grupo))], [contas]);

  const { minhas, resto } = useMemo(() => {
    const t = chave(busca.trim());
    const casa = (c: Conta) => !t || chave(`${c.codigo} ${c.nome} ${c.grupo}`).includes(t);
    const achadas = contas.filter(casa);
    return {
      minhas: achadas.filter((c) => c.daEmpresa),
      resto: achadas.filter((c) => !c.daEmpresa),
    };
  }, [contas, busca]);

  function escolher(id: string | null) {
    onEscolher(id);
    setAberto(false);
  }

  async function criar() {
    setErro(null);
    if (!onCriar) return;
    if (!nomeNovo.trim()) { setErro('Informe o nome da conta.'); return; }
    if (!grupoNovo) { setErro('Escolha o grupo.'); return; }
    try {
      const nova = await onCriar(nomeNovo.trim(), grupoNovo);
      if (nova) { setNomeNovo(''); escolher(nova.id); }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  const semConta = !valor;

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        title={rotuloConta(contas, valor)}
        className={`w-full truncate rounded border px-1.5 text-left ${compacto ? 'py-0.5' : 'py-1'} ${
          semConta ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-slate-300 bg-white text-slate-700'
        } hover:border-indigo-400`}
      >
        {valor ? rotuloConta(contas, valor) : 'Escolher conta…'}
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
                    if (primeira) escolher(primeira.id);
                  }
                }}
                placeholder="Buscar por código, nome ou grupo…"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              />
            </div>

            <div className="max-h-[50vh] overflow-y-auto text-sm">
              {minhas.length > 0 && (
                <Secao titulo="Contas desta empresa">
                  {minhas.map((c) => <Item key={c.id} conta={c} sel={c.id === valor} onClick={() => escolher(c.id)} />)}
                </Secao>
              )}
              {resto.length > 0 && (
                <Secao titulo={minhas.length ? 'Catálogo completo' : 'Catálogo'}>
                  {resto.map((c) => <Item key={c.id} conta={c} sel={c.id === valor} onClick={() => escolher(c.id)} />)}
                </Secao>
              )}
              {minhas.length === 0 && resto.length === 0 && (
                <p className="px-4 py-6 text-center text-slate-400">Nenhuma conta encontrada.</p>
              )}
            </div>

            <div className="space-y-2 border-t border-slate-200 bg-slate-50 p-3">
              <button type="button" onClick={() => escolher(null)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-left text-xs text-slate-600 hover:border-amber-400">
                <span className="font-medium">Sem conta — movimentação bancária</span>
                <span className="block text-slate-400">Depósito ou retirada da conta corrente não é receita nem despesa.</span>
              </button>

              {podeCriar && onCriar && (criando ? (
                <div className="space-y-2 rounded-lg border border-slate-300 bg-white p-2">
                  <input value={nomeNovo} onChange={(e) => setNomeNovo(e.target.value)}
                    placeholder="Nome da conta nova" className="w-full rounded border border-slate-300 px-2 py-1 text-xs" />
                  <select value={grupoNovo} onChange={(e) => setGrupoNovo(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1 text-xs">
                    <option value="">— grupo do plano de contas —</option>
                    {grupos.map((gr) => <option key={gr} value={gr}>{gr}</option>)}
                  </select>
                  {erro && <p className="text-xs text-red-600">{erro}</p>}
                  <div className="flex gap-2">
                    <button type="button" onClick={criar} className="rounded bg-indigo-600 px-3 py-1 text-xs text-white">Criar e usar</button>
                    <button type="button" onClick={() => setCriando(false)} className="rounded border border-slate-300 px-3 py-1 text-xs">Cancelar</button>
                  </div>
                  <p className="text-xs text-slate-400">O código sai do grupo escolhido.</p>
                </div>
              ) : (
                <button type="button" onClick={() => setCriando(true)}
                  className="text-xs text-indigo-600 hover:underline">+ Criar conta no catálogo</button>
              ))}
            </div>
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

function Item({ conta, sel, onClick }: { conta: Conta; sel: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex w-full items-baseline gap-2 px-4 py-1.5 text-left hover:bg-indigo-50 ${sel ? 'bg-indigo-50' : ''}`}>
      <span className="w-16 shrink-0 font-mono text-xs text-slate-500">{conta.codigo}</span>
      <span className="flex-1 truncate">{conta.nome}</span>
      <span className={`shrink-0 text-xs ${conta.natureza === 'receita' ? 'text-emerald-600' : 'text-slate-400'}`}>
        {conta.natureza === 'receita' ? 'receita' : 'despesa'}
      </span>
    </button>
  );
}
