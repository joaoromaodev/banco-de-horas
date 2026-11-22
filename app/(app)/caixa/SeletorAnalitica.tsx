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
import { Modal } from '../Dialogo';
import { IconeBusca, IconeMais } from '../icones';
import { Botao, controleCls, Entrada, EstadoVazio } from '@/components/ui';

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
  /** id do gatilho (para um <label for> da tela). */
  id?: string;
  /** Campo com erro: contorno de perigo (a mensagem chega por `descritoPor`; botão não aceita `aria-invalid`). */
  invalido?: boolean;
  /** id da mensagem de erro/dica que descreve o campo (`aria-describedby`). */
  descritoPor?: string;
}

/** Ignora acento e caixa: quem digita "atendimento" acha "Atendimento". */
const chave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function SeletorAnalitica({ historicos, valor, titularId, onEscolher, podeCriar, onCriar, compacto, id, invalido, descritoPor }: Props) {
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
        id={id}
        onClick={abrir}
        // O nome diz o que é o campo e o que está escolhido (na tabela não há rótulo visível ao lado).
        aria-label={`Conta analítica: ${valor || 'nenhuma escolhida'}`}
        aria-describedby={descritoPor}
        data-dica={valor ?? 'Escolher conta analítica…'}
        aria-haspopup="dialog"
        className={`w-full truncate rounded-md border px-2 text-left text-base transition-colors sm:text-[13px] ${compacto ? 'h-8' : 'h-11 sm:h-9'} ${invalido ? 'ring-1 ring-perigo' : ''} ${
          valor
            ? 'border-borda-forte bg-superficie text-tinta hover:border-tinta-suave'
            : 'border-aviso-borda bg-aviso-suave text-aviso hover:border-aviso'
        }`}
      >
        {valor || 'Escolher conta analítica…'}
      </button>

      {aberto && (
        <Modal onFechar={() => setAberto(false)} rotulo="Escolher conta analítica" largura="max-w-xl">
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
                  if (primeira) escolher(primeira);
                }
              }}
              aria-label="Buscar conta analítica"
              placeholder="Buscar conta analítica…"
              className={controleCls({ tamanho: 'lg', className: 'pl-10' })}
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
              <EstadoVazio moldura={false}
                titulo={titularId ? 'Nenhuma analítica para esta titular.' : 'Nenhuma analítica encontrada.'} />
            )}
          </div>

          {podeCriar && onCriar && (
            <div className="space-y-2.5 border-t border-borda bg-superficie-suave p-3">
              {criando ? (
                <div className="space-y-3 rounded-lg border border-borda bg-superficie p-3">
                  <Entrada rotulo="Texto da analítica" tamanho="sm" value={textoNovo} onChange={(e) => setTextoNovo(e.target.value)}
                    placeholder="ex.: Atendimento" dica="Entra como subgrupo da conta titular escolhida." />
                  {erro && <p role="alert" className="text-xs font-medium text-perigo">{erro}</p>}
                  <div className="flex gap-2">
                    <Botao variante="primaria" tamanho="sm" onClick={criar}>Criar e usar</Botao>
                    <Botao tamanho="sm" onClick={() => setCriando(false)}>Cancelar</Botao>
                  </div>
                </div>
              ) : titularId ? (
                <Botao variante="fantasma" tamanho="sm" icone={<IconeMais size={14} />} onClick={() => setCriando(true)}>
                  Criar conta analítica no catálogo
                </Botao>
              ) : (
                <p className="text-xs text-tinta-suave">Escolha a conta titular para poder criar uma analítica nova.</p>
              )}
            </div>
          )}
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

function Item({ h, sel, onClick }: { h: Historico; sel: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-current={sel ? 'true' : undefined}
      className={`flex min-h-11 w-full items-baseline gap-3 px-4 py-3 text-left sm:min-h-0 sm:py-2 transition-colors hover:bg-superficie-realce focus-visible:-outline-offset-2 ${sel ? 'bg-superficie-realce font-medium' : ''}`}>
      <span className="min-w-0 flex-1 truncate text-tinta">{h.texto}</span>
      <span className={`shrink-0 text-xs ${h.natureza === 'receita' ? 'text-sucesso' : 'text-tinta-suave'}`}>
        {h.natureza === 'receita' ? 'receita' : 'despesa'}
      </span>
    </button>
  );
}
