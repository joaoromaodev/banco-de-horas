'use client';

// Bloco do painel: limite de faturamento (MEI/Simples) das empresas do escritório.
// Carrega sozinho — se falhar, só este bloco avisa. É estimativa pelo caixa e diz
// "confirme" (lib/limiteFaturamento.ts). Ver docs/resumo-cliente.md.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { AlertaLimite, ORDEM_NIVEL, ROTULO_NIVEL } from '@/lib/limiteFaturamento';
import { Aviso, Botao, botaoCls, Carregando, Secao, Selo } from '@/components/ui';
import { IconeCheck } from '../icones';
import { BarraLimite, TOM_NIVEL } from '../caixa/LimiteFaturamento';

interface Item { empresaId: string; nome: string; alerta: AlertaLimite }
interface Dados { aplica: boolean; itens?: Item[] }

const LIMITE_LISTA = 8;

export default function LimiteFaturamento() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const r = await fetch('/api/painel/limite', { cache: 'no-store' });
      const x = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(x.erro || 'Não foi possível carregar este bloco.');
      setDados(x as Dados);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar este bloco.');
    } finally { setCarregando(false); }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga da API; zerar erro/espera/dados antigos antes do fetch é intencional
  useEffect(() => { carregar(); }, [carregar]);

  if (dados && !dados.aplica) return null; // sem módulo do caixa
  if (dados && !dados.itens?.length) return null; // nenhuma empresa MEI/Simples com regime registrado

  const itens = dados?.itens ?? [];
  const atencao = itens.filter((i) => ORDEM_NIVEL[i.alerta.nivel] > 0);
  const mostrados = (atencao.length ? atencao : itens).slice(0, LIMITE_LISTA);

  return (
    <Secao titulo="Limite de faturamento"
      descricao="MEI e Simples Nacional — estimativa pelo caixa; confirme antes de decidir."
      acoes={dados ? <Selo tom={atencao.length ? 'aviso' : 'neutro'}>{atencao.length} {atencao.length === 1 ? 'empresa pede atenção' : 'empresas pedem atenção'}</Selo> : undefined}>
      {carregando && !dados && <Carregando>Somando o caixa das empresas…</Carregando>}
      {erro && <Aviso tom="aviso" titulo="Não foi possível carregar este bloco">Tente atualizar em instantes. O resto do painel não foi afetado.</Aviso>}
      {dados && !atencao.length && (
        <p className="mb-3 flex items-center gap-2 text-sm text-tinta-suave">
          <IconeCheck size={16} className="shrink-0 text-sucesso" />Nenhuma empresa perto do limite, pelo que está no caixa.
        </p>
      )}
      {dados && (
        <ul className="divide-y divide-borda">
          {mostrados.map((i) => {
            const pior = i.alerta.medidas.reduce((p, m) => (ORDEM_NIVEL[m.nivel] > ORDEM_NIVEL[p.nivel] || (m.nivel === p.nivel && m.percentual > p.percentual) ? m : p), i.alerta.medidas[0]);
            return (
              <li key={i.empresaId} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="min-w-0 flex-1 basis-44">
                    <span className="block truncate text-sm font-medium text-tinta">{i.nome}</span>
                    <span className="block text-[13px] text-tinta-suave">
                      {i.alerta.regime === 'mei' ? 'MEI' : 'Simples'} · {pior.rotulo}
                    </span>
                  </span>
                  <Selo tom={TOM_NIVEL[i.alerta.nivel]}>{ROTULO_NIVEL[i.alerta.nivel]} · {Math.round(pior.percentual * 100)}%</Selo>
                </div>
                <BarraLimite m={pior} />
                <p className="mt-1.5 text-[13px] text-tinta-suave">{pior.mensagem}</p>
                {i.alerta.incompleto && (
                  <p className="mt-1 text-[13px] text-aviso">O caixa não cobre todo o período: a soma pode estar abaixo do real.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13px] text-tinta-suave">
          {itens.length > mostrados.length ? `e mais ${itens.length - mostrados.length} ${itens.length - mostrados.length === 1 ? 'empresa' : 'empresas'}` : ''}
        </span>
        <span className="flex gap-2">
          <Botao variante="secundaria" tamanho="sm" onClick={carregar} disabled={carregando}>Atualizar</Botao>
          <Link href="/caixa" className={botaoCls({ variante: 'secundaria', tamanho: 'sm' })}>Abrir o caixa</Link>
        </span>
      </div>
    </Secao>
  );
}
