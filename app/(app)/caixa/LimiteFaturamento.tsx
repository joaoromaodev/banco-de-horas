'use client';

// Limite de faturamento da empresa (MEI/Simples) na tela do caixa. É uma ESTIMATIVA
// pelo caixa e a tela diz isso sempre ("confirme"); nunca conclui nada sozinha.
// Regras em lib/limiteFaturamento.ts; ver docs/resumo-cliente.md.
import { useCallback, useEffect, useState } from 'react';
import { AlertaLimite, MedidaLimite, NivelLimite, ROTULO_NIVEL } from '@/lib/limiteFaturamento';
import { Aviso, Botao, cx, Entrada, Secao, Selo, Tom } from '@/components/ui';

interface Resposta { alerta: AlertaLimite | null; abertura: string | null; podeEditar: boolean }

export const TOM_NIVEL: Record<NivelLimite, Tom> = { ok: 'sucesso', atencao: 'aviso', excedido: 'perigo', retroativo: 'perigo' };
const COR_BARRA: Record<NivelLimite, string> = { ok: 'bg-primaria', atencao: 'bg-aviso', excedido: 'bg-perigo-solido', retroativo: 'bg-perigo-solido' };

/** Barra de progresso com marcas em 80% e 100% (o resto do número está escrito ao lado). */
export function BarraLimite({ m }: { m: MedidaLimite }) {
  const cheia = Math.min(m.percentual, 1.2) / 1.2; // a barra vai até 120%
  return (
    <div className="relative mt-1.5 h-2 w-full overflow-hidden rounded-full bg-superficie-realce" role="img"
      aria-label={`${Math.round(m.percentual * 100)}% do limite`}>
      <div className={cx('h-full rounded-full', COR_BARRA[m.nivel])} style={{ width: `${cheia * 100}%` }} />
      <span className="absolute inset-y-0 border-l border-borda-forte" style={{ left: `${(0.8 / 1.2) * 100}%` }} aria-hidden="true" />
      <span className="absolute inset-y-0 border-l border-borda-forte" style={{ left: `${(1 / 1.2) * 100}%` }} aria-hidden="true" />
    </div>
  );
}

export function MedidaLinha({ m }: { m: MedidaLimite }) {
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium text-tinta">{m.rotulo}</span>
        {m.chave !== 'simples_faixa' && <Selo tom={TOM_NIVEL[m.nivel]}>{ROTULO_NIVEL[m.nivel]}</Selo>}
      </div>
      {m.chave !== 'simples_faixa' && <BarraLimite m={m} />}
      <p className="mt-1.5 text-[13px] text-tinta-suave">{m.mensagem}</p>
    </li>
  );
}

export default function LimiteFaturamento({ empresaId }: { empresaId: string }) {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [data, setData] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    if (!empresaId) { setDados(null); return; }
    try {
      const r = await fetch(`/api/caixa/limite?empresa=${encodeURIComponent(empresaId)}`, { cache: 'no-store' });
      const x = await r.json().catch(() => ({}));
      if (!r.ok) { setDados(null); return; } // o alerta é um extra: se falhar, a tela do caixa segue sem ele
      setDados(x as Resposta);
      setData((x as Resposta).abertura ?? '');
    } catch { setDados(null); }
  }, [empresaId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga da API; zerar erro/espera/dados antigos antes do fetch é intencional
  useEffect(() => { carregar(); }, [carregar]);

  async function salvarAbertura() {
    setSalvando(true); setErro('');
    try {
      const r = await fetch('/api/caixa/limite', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa: empresaId, abertura: data || null }),
      });
      const x = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(x.erro || 'Não foi possível salvar.');
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally { setSalvando(false); }
  }

  const a = dados?.alerta;
  if (!a) return null; // sem regime MEI/Simples registrado: nada a acompanhar aqui

  return (
    <Secao titulo="Limite de faturamento"
      descricao={a.regime === 'mei' ? 'MEI — receita do ano' : 'Simples Nacional — receita dos últimos 12 meses'}
      acoes={<Selo tom={TOM_NIVEL[a.nivel]}>{ROTULO_NIVEL[a.nivel]}</Selo>}>
      {a.nivel !== 'ok' && (
        <Aviso tom={a.nivel === 'atencao' ? 'aviso' : 'perigo'} titulo="Vale conversar com a contabilidade">
          {a.aviso}
        </Aviso>
      )}
      <ul className={cx('divide-y divide-borda', a.nivel !== 'ok' && 'mt-3')}>
        {a.medidas.map((m) => <MedidaLinha key={m.chave} m={m} />)}
      </ul>
      {a.nivel === 'ok' && <p className="mt-1 text-[13px] text-tinta-suave">{a.aviso}</p>}
      {dados?.podeEditar && (
        <div className="mt-4 border-t border-borda pt-3">
          {a.observacoes.length > 0 && (
            <ul className="mb-3 list-disc space-y-1 pl-5 text-[13px] text-tinta-suave">
              {a.observacoes.map((o) => <li key={o}>{o}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <Entrada rotulo="Data de abertura da empresa" type="date" value={data} largura="w-44"
              dica="Só para o limite proporcional do 1º ano." onChange={(e) => setData(e.target.value)} />
            <Botao variante="secundaria" onClick={salvarAbertura} carregando={salvando} disabled={(data || '') === (dados.abertura ?? '')}>
              Salvar
            </Botao>
          </div>
          {erro && <p role="alert" className="mt-2 text-[13px] text-perigo">{erro}</p>}
        </div>
      )}
    </Secao>
  );
}
