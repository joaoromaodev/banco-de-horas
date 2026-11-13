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
import { Modal } from '../Dialogo';
import { IconeBusca, IconeMais } from '../icones';
import { Botao, controleCls, Entrada, EstadoVazio } from '@/components/ui';
import { Selecao } from '@/components/selecao';

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
        data-dica={rotuloConta(contas, valor)}
        aria-haspopup="dialog"
        className={`w-full truncate rounded-md border px-2 text-left text-base transition-colors sm:text-[13px] ${compacto ? 'h-8' : 'h-9'} ${
          semConta
            ? 'border-aviso-borda bg-aviso-suave text-aviso hover:border-aviso'
            : 'border-borda-forte bg-superficie text-tinta hover:border-tinta-suave'
        }`}
      >
        {valor ? rotuloConta(contas, valor) : 'Escolher conta…'}
      </button>

      {aberto && (
        <Modal onFechar={() => setAberto(false)} rotulo="Escolher conta titular" largura="max-w-xl">
          <div className="relative border-b border-borda p-3">
            <IconeBusca size={16} className="pointer-events-none absolute left-6 top-1/2 -translate-y-1/2 text-tinta-fraca" />
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
              aria-label="Buscar conta por código, nome ou grupo"
              placeholder="Buscar por código, nome ou grupo…"
              className={controleCls({ tamanho: 'lg', className: 'pl-10' })}
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
              <EstadoVazio moldura={false} titulo="Nenhuma conta encontrada" descricao="Tente outro trecho do código, do nome ou do grupo." />
            )}
          </div>

          <div className="space-y-2.5 border-t border-borda bg-superficie-suave p-3">
            <button type="button" onClick={() => escolher(null)}
              className="w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-left text-[13px] transition-colors hover:border-aviso hover:bg-aviso-suave">
              <span className="font-medium text-tinta">Sem conta — movimentação bancária</span>
              <span className="block text-xs text-tinta-suave">Depósito ou retirada da conta corrente não é receita nem despesa.</span>
            </button>

            {podeCriar && onCriar && (criando ? (
              <div className="space-y-3 rounded-lg border border-borda bg-superficie p-3">
                <Entrada rotulo="Nome da conta nova" tamanho="sm" value={nomeNovo} onChange={(e) => setNomeNovo(e.target.value)} />
                <Selecao rotulo="Grupo do plano de contas" tamanho="sm" valor={grupoNovo} onChange={setGrupoNovo}
                  placeholder="— escolha o grupo —" dica="O código sai do grupo escolhido."
                  opcoes={grupos.map((gr) => ({ valor: gr, rotulo: gr }))} />
                {erro && <p role="alert" className="text-xs font-medium text-perigo">{erro}</p>}
                <div className="flex gap-2">
                  <Botao variante="primaria" tamanho="sm" onClick={criar}>Criar e usar</Botao>
                  <Botao tamanho="sm" onClick={() => setCriando(false)}>Cancelar</Botao>
                </div>
              </div>
            ) : (
              <Botao variante="fantasma" tamanho="sm" icone={<IconeMais size={14} />} onClick={() => setCriando(true)}>
                Criar conta no catálogo
              </Botao>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="sticky top-0 border-b border-borda bg-superficie-suave px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-tinta-suave">{titulo}</div>
      {children}
    </div>
  );
}

function Item({ conta, sel, onClick }: { conta: Conta; sel: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={sel ? 'true' : undefined}
      className={`flex w-full items-baseline gap-3 px-4 py-2 text-left transition-colors hover:bg-superficie-realce focus-visible:-outline-offset-2 ${sel ? 'bg-superficie-realce font-medium' : ''}`}>
      <span className="w-16 shrink-0 font-mono text-xs text-tinta-suave">{conta.codigo}</span>
      <span className="min-w-0 flex-1 truncate text-tinta">{conta.nome}</span>
      <span className={`shrink-0 text-xs ${conta.natureza === 'receita' ? 'text-sucesso' : 'text-tinta-suave'}`}>
        {conta.natureza === 'receita' ? 'receita' : 'despesa'}
      </span>
    </button>
  );
}
