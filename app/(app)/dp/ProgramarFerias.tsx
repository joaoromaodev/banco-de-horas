'use client';

// Programar férias: escolhe o período aquisitivo, o início e os dias; a validação
// (lib/ferias.ts) roda ao vivo — erros seguram o botão, avisos só informam. O
// servidor valida de novo ao gravar. Depois de programar, a ficha oferece Desfazer.
import { useId, useMemo, useState } from 'react';
import { Modal } from '../Dialogo';
import { Aviso, Botao, Entrada } from '@/components/ui';
import { Selecao } from '@/components/selecao';
import { br, type Empregado } from '@/lib/dp';
import {
  proximoInicioPermitido, ROTULO_ESTADO, somarDias, validarProgramacao,
  type FeriasProgramada, type SituacaoPeriodo,
} from '@/lib/ferias';

export interface PedidoTela {
  aquisitivoInicio: string; inicio: string; dias: number; abonoDias: number; avisoEm: string | null; pagamentoEm: string | null;
}

export function ProgramarFerias({ empregado, periodos, todas, feriados, hoje, onProgramar, onCancelar }: {
  empregado: Empregado;
  periodos: SituacaoPeriodo[];
  todas: FeriasProgramada[];
  feriados: Set<string>;
  hoje: string;
  onProgramar: (p: PedidoTela) => Promise<string | null>;
  onCancelar: () => void;
}) {
  const id = useId();
  const comSaldo = periodos.filter((p) => p.saldo > 0 && p.estado !== 'perdido');
  const [aquisitivo, setAquisitivo] = useState(comSaldo[0]?.periodo.inicio ?? '');
  const sp = periodos.find((p) => p.periodo.inicio === aquisitivo) ?? null;
  const sugestaoInicio = useMemo(() => proximoInicioPermitido(somarDias(hoje, 31), empregado.dsr, feriados), [hoje, empregado.dsr, feriados]);
  const [inicio, setInicio] = useState(sugestaoInicio);
  const [dias, setDias] = useState(String(Math.min(30, sp?.saldo ?? 30)));
  const [abono, setAbono] = useState('0');
  const [avisoEm, setAvisoEm] = useState('');
  const [pagamentoEm, setPagamentoEm] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const pedido = { aquisitivoInicio: aquisitivo, inicio, dias: Number(dias), abonoDias: Number(abono || 0), avisoEm: avisoEm || null };
  const v = validarProgramacao(pedido, { empregado, periodo: sp, todas, feriados, hoje });

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    if (v.erros.length) return;
    setEnviando(true); setErro(null);
    const e = await onProgramar({ ...pedido, pagamentoEm: pagamentoEm || v.pagamentoAte });
    setEnviando(false);
    if (e) setErro(e);
  }

  return (
    <Modal onFechar={onCancelar} rotuladoPor={id} largura="max-w-xl">
      <form onSubmit={enviar} noValidate>
        <div className="max-h-[70vh] overflow-y-auto p-5">
          <h2 id={id} className="text-base font-semibold text-tinta">Programar férias — {empregado.nome}</h2>
          {comSaldo.length === 0 ? (
            <Aviso tom="info" className="mt-4">Nenhum período com saldo de férias para programar.</Aviso>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Selecao rotulo="Período aquisitivo" valor={aquisitivo} onChange={(x) => { setAquisitivo(x); const s = periodos.find((p) => p.periodo.inicio === x); if (s) setDias(String(Math.min(30, s.saldo))); }}
                  classeCampo="sm:col-span-2" busca={false}
                  opcoes={comSaldo.map((p) => ({
                    valor: p.periodo.inicio,
                    rotulo: `${br(p.periodo.inicio)} a ${br(p.periodo.fim)}`,
                    detalhe: `${ROTULO_ESTADO[p.estado]} · saldo ${p.saldo} de ${p.direito} dias · concessivo até ${br(p.periodo.concessivoFim)}`,
                  }))} />
                <Entrada rotulo="Início do gozo" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} data-foco-inicial="" />
                <Entrada rotulo="Dias de gozo" type="number" min={5} max={30} value={dias} onChange={(e) => setDias(e.target.value)} />
                <Entrada rotulo="Dias de abono (venda)" type="number" min={0} max={10} value={abono} onChange={(e) => setAbono(e.target.value)}
                  dica="Até 1/3 do direito (art. 143)." />
                <Entrada rotulo="Aviso dado em (opcional)" type="date" value={avisoEm} onChange={(e) => setAvisoEm(e.target.value)}
                  dica={v.avisoAte ? `Prazo: até ${br(v.avisoAte)} (art. 135).` : undefined} />
                <Entrada rotulo="Pagamento em" type="date" value={pagamentoEm || v.pagamentoAte || ''} onChange={(e) => setPagamentoEm(e.target.value)}
                  dica="Até 2 dias antes do início (art. 145)." />
              </div>

              {v.fim && !v.erros.length && (
                <p className="mt-4 text-[13px] text-tinta-suave">
                  Gozo de <strong className="text-tinta">{br(inicio)}</strong> a <strong className="text-tinta">{br(v.fim)}</strong>, retorno em <strong className="text-tinta">{br(v.retorno)}</strong>.
                  {sp && ` Depois disto, sobram ${Math.max(0, sp.saldo - Number(dias) - Number(abono || 0))} dia(s) neste período.`}
                </p>
              )}
              {v.erros.length > 0 && (
                <Aviso tom="perigo" titulo="Não dá para programar assim" className="mt-4">
                  <ul className="list-disc pl-4">{v.erros.map((x) => <li key={x}>{x}</li>)}</ul>
                </Aviso>
              )}
              {v.avisos.length > 0 && (
                <Aviso tom="aviso" titulo="Atenção" className="mt-4">
                  <ul className="list-disc pl-4">{v.avisos.map((x) => <li key={x}>{x}</li>)}</ul>
                </Aviso>
              )}
            </>
          )}
          {erro && <Aviso tom="perigo" className="mt-4">{erro}</Aviso>}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-borda bg-superficie-suave px-5 py-3 sm:flex-row sm:justify-end">
          <Botao onClick={onCancelar}>Cancelar</Botao>
          <Botao type="submit" variante="primaria" carregando={enviando} disabled={comSaldo.length === 0 || v.erros.length > 0}>Programar férias</Botao>
        </div>
      </form>
    </Modal>
  );
}
