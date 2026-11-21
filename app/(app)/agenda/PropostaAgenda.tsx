'use client';

// Agenda proposta pelo cadastro: o sistema SUGERE o modelo de obrigações a partir
// do regime que o escritório registrou e de sinais (funcionários, contrato ativo,
// pessoa física). Nunca aplica sozinho: o clique é de quem decide, e o toast da
// tela oferece Desfazer. Regras em lib/agendaDerivada.ts; ver docs/agenda.md.
import { useCallback, useEffect, useState } from 'react';
import { Regime, TIPO_POR_CODIGO } from '@/lib/agenda';
import { PropostaAgenda as Proposta, RegimeCadastro, REGIMES_CADASTRO } from '@/lib/agendaDerivada';
import { Aviso, Botao, Secao } from '@/components/ui';
import { Selecao } from '@/components/selecao';

interface Retorno { regime: RegimeCadastro | null; semTabelaRegime: boolean; semObrigacoes: boolean; proposta: Proposta }

const chaveDispensa = (empresa: string, modelo: string) => `agenda.proposta.dispensada.${empresa}.${modelo}`;
const lerDispensa = (k: string) => { try { return localStorage.getItem(k) === '1'; } catch { return false; } };

export default function PropostaAgenda({ empresa, nomeEmpresa, versao, ocupado, desabilitado, onAplicar }: {
  empresa: string; nomeEmpresa: string;
  /** Muda quando a lista de obrigações muda (aplicar/desfazer): refaz a proposta. */
  versao: number;
  ocupado: boolean; desabilitado: boolean;
  onAplicar: (modelo: Regime) => void;
}) {
  const [dados, setDados] = useState<Retorno | null>(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [dispensada, setDispensada] = useState(false);

  const carregar = useCallback(async () => {
    if (!empresa) return;
    try {
      const r = await fetch(`/api/agenda/proposta?empresa=${encodeURIComponent(empresa)}`, { cache: 'no-store' });
      const x = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(x.erro || 'Não foi possível montar a sugestão.');
      setDados(x as Retorno);
      setErro('');
      setDispensada(x.proposta?.modelo ? lerDispensa(chaveDispensa(empresa, x.proposta.modelo)) : false);
    } catch (e) {
      setDados(null);
      setErro(e instanceof Error ? e.message : 'Não foi possível montar a sugestão.');
    }
  }, [empresa]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga depois do fetch; refaz ao trocar de empresa ou de obrigações
  useEffect(() => { carregar(); }, [carregar, versao]);

  async function guardarRegime(valor: string) {
    setSalvando(true); setErro('');
    try {
      const r = await fetch('/api/agenda/proposta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa, regime: valor || null }),
      });
      const x = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(x.erro || 'Não foi possível guardar o regime.');
      await carregar();
    } catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível guardar o regime.'); }
    finally { setSalvando(false); }
  }

  function dispensar(modelo: string) {
    try { localStorage.setItem(chaveDispensa(empresa, modelo), '1'); } catch {}
    setDispensada(true);
  }

  if (erro) return <Aviso tom="aviso" titulo="Sugestão indisponível">{erro} A agenda continua funcionando: aplique o modelo abaixo à mão.</Aviso>;
  if (!dados) return null;
  const p = dados.proposta;
  const nomeTipos = (tipos: string[]) => tipos.map((t) => TIPO_POR_CODIGO.get(t)?.nome ?? t).join(', ');

  return (
    <Secao titulo="Regime e sugestão de agenda"
      descricao="O regime é decisão do escritório — o sistema não o deduz por CNAE nem por faturamento. Com ele registrado, a agenda sugere o modelo certo e avisa quando algo muda.">
      <Selecao rotulo={`Regime de ${nomeEmpresa}`} classeCampo="sm:w-80" valor={dados.regime ?? ''} onChange={guardarRegime}
        disabled={salvando || dados.semTabelaRegime}
        opcoes={[{ valor: '', rotulo: 'Não definido' }, ...REGIMES_CADASTRO.map((r) => ({ valor: r.valor, rotulo: r.rotulo }))]} />
      {dados.semTabelaRegime && <p className="mt-2 text-[13px] text-tinta-suave">O registro do regime passa a funcionar assim que a migração 0018 for aplicada.</p>}

      <div className="mt-4 space-y-3">
        {p.situacao === 'perguntar' && dados.semObrigacoes && (
          <Aviso tom="info" titulo="Esta empresa ainda não tem obrigações">
            Escolha o regime acima para ver a sugestão — ou aplique um modelo à mão logo abaixo.
          </Aviso>
        )}

        {p.situacao === 'propor' && !dispensada && (
          <Aviso tom="info"
            titulo={dados.semObrigacoes ? `Sugestão para ${nomeEmpresa}: modelo ${p.nomeModelo}` : `A agenda de ${nomeEmpresa} ficou incompleta para o modelo ${p.nomeModelo}`}
            acao={(
              <div className="flex flex-wrap gap-2">
                <Botao variante="tonal" tamanho="sm" carregando={ocupado} disabled={desabilitado || ocupado} onClick={() => onAplicar(p.modelo)}>
                  Aplicar modelo ({p.faltam.length})
                </Botao>
                <Botao variante="fantasma" tamanho="sm" onClick={() => dispensar(p.modelo)}>Agora não</Botao>
              </div>
            )}>
            <ul className="list-disc space-y-0.5 pl-5">{p.motivos.map((m) => <li key={m}>{m}</li>)}</ul>
            <p className="mt-1.5">Entram: {nomeTipos(p.faltam)}. Dá para desfazer logo depois de aplicar.</p>
            {p.sobram.length > 0 && <p className="mt-1.5 text-tinta-suave">Já existem e não fazem parte deste modelo (revise se ainda valem): {nomeTipos(p.sobram)}.</p>}
          </Aviso>
        )}

        {p.situacao === 'em_dia' && (
          <p className="text-[13px] text-tinta-suave">
            A agenda já tem todas as obrigações do modelo {p.nomeModelo}.
            {p.sobram.length > 0 && <> Existem outras que não fazem parte dele (revise se ainda valem): {nomeTipos(p.sobram)}.</>}
          </p>
        )}
      </div>
    </Secao>
  );
}
