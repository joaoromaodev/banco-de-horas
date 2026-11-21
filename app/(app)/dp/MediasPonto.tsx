'use client';

// Painel das médias do ponto na simulação de rescisão: mostra de onde veio cada média
// (meses, horas, DSR) e deixa a contadora ignorar um mês ou trocar as horas antes de
// calcular. O cálculo é de lib/mediasPonto.ts (chamado por lib/rescisao.ts); aqui só a tela.
import { useState } from 'react';
import { Aviso, Carregando, celulaCls, cx, Marcacao, Selo, tb } from '@/components/ui';
import { br } from '@/lib/dp';
import { rotuloMes, type AjusteMes, type MediaPeriodo, type MesConsiderado, type MesPonto } from '@/lib/mediasPonto';
import { reais, type MediasRescisao } from '@/lib/rescisao';

const horas = (min: number) => (min / 60).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const horasDec = (h: number) => h.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** "10,5" ou "10:30" → minutos; vazio → null (volta ao ponto); inválido → undefined. */
export function lerHoras(s: string): number | null | undefined {
  const t = s.trim();
  if (!t) return null;
  const hm = /^(\d{1,3}):([0-5]\d)$/.exec(t);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 744 ? Math.round(n * 60) : undefined;
}

type Campo = 'he50Min' | 'he100Min' | 'noturnoMin';

function CelulaHoras({ mes, campo, original, ajuste, onAjustar }: {
  mes: string; campo: Campo; original: number; ajuste: AjusteMes | undefined; onAjustar: (mes: string, a: AjusteMes) => void;
}) {
  const valor = ajuste?.[campo];
  const [texto, setTexto] = useState(valor != null ? horas(valor) : '');
  const [invalido, setInvalido] = useState(false);
  const rotulo = { he50Min: 'HE 50%', he100Min: 'HE 100%', noturnoMin: 'Noturno' }[campo];
  return (
    <td className={cx(tb.tdCampo, 'text-right')}>
      <input aria-label={`${rotulo} em ${rotuloMes(mes)} (horas)`} inputMode="decimal" value={texto} placeholder={horas(original)}
        className={cx(celulaCls, 'w-20 text-right tabular-nums', invalido && 'border-perigo', valor != null && 'font-semibold')}
        data-dica={`Do ponto: ${horas(original)} h. Digite outro número para ajustar; apague para voltar ao ponto.`}
        onChange={(x) => {
          setTexto(x.target.value);
          const m = lerHoras(x.target.value);
          setInvalido(m === undefined);
          if (m !== undefined) onAjustar(mes, { ...ajuste, [campo]: m });
        }} />
    </td>
  );
}

function ResumoMedia({ titulo, m, informadas }: { titulo: string; m: MediaPeriodo | null | undefined; informadas: number }) {
  if (!m) return null;
  return (
    <li className="text-[13px] text-tinta-suave">
      <span className="font-semibold text-tinta">{titulo}: {reais(m.valor)}</span>
      {informadas ? <> + {reais(informadas)} informadas</> : null} — {m.memoria}.
    </li>
  );
}

export function PainelMediasPonto({ ponto, carregando, erro, medias, ajustes, onAjustar, incluirMesDesligamento, onIncluirMes, usarPonto, onUsarPonto, desligamento }: {
  ponto: MesPonto[] | null;
  carregando: boolean;
  erro: string | null;
  medias: MediasRescisao | null;
  ajustes: Record<string, AjusteMes>;
  onAjustar: (mes: string, a: AjusteMes) => void;
  incluirMesDesligamento: boolean;
  onIncluirMes: (v: boolean) => void;
  usarPonto: boolean;
  onUsarPonto: (v: boolean) => void;
  desligamento: string;
}) {
  // Meses que entram em alguma das médias, do mais recente ao mais antigo.
  const porMes = new Map<string, MesConsiderado>();
  for (const m of [medias?.aviso, medias?.decimo, ...(medias?.ferias ?? []).map((f) => f.media)]) {
    for (const x of m?.meses ?? []) if (!porMes.has(x.mes)) porMes.set(x.mes, x);
  }
  const linhas = [...porMes.values()].sort((a, b) => b.mes.localeCompare(a.mes));
  const original = new Map((ponto ?? []).map((m) => [m.mes, m]));

  return (
    <fieldset className="mt-4 rounded-lg border border-borda p-3">
      <legend className="px-1 text-[13px] font-semibold text-tinta">Médias de horas extras e adicional noturno (Folha de Ponto)</legend>
      <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:gap-x-5">
        <Marcacao type="checkbox" checked={usarPonto} onChange={(x) => onUsarPonto(x.target.checked)}>Usar as horas do ponto</Marcacao>
        {usarPonto && (
          <Marcacao type="checkbox" checked={incluirMesDesligamento} onChange={(x) => onIncluirMes(x.target.checked)}>
            Incluir o mês do desligamento ({rotuloMes(desligamento.slice(0, 7))}) mesmo incompleto
          </Marcacao>
        )}
      </div>
      {!usarPonto ? (
        <p className="mt-2 text-xs text-tinta-suave">Médias só pelo campo “Outras médias por mês”.</p>
      ) : carregando ? (
        <Carregando className="mt-3">Lendo o ponto…</Carregando>
      ) : erro ? (
        <Aviso tom="aviso" className="mt-3">{erro}</Aviso>
      ) : (
        <>
          <p className="mt-2 text-xs text-tinta-suave">
            Horas a pagar de cada mês, pela mesma conta do Resumo para a folha (as que foram para o banco de horas não entram).
            A média divide pelos meses trabalhados — mês sem ponto entra com zero. Ajuste as horas ou desmarque o mês antes de baixar o PDF.
          </p>
          {linhas.length === 0 ? (
            <p className="mt-2 text-[13px] text-tinta-fraca">Nenhum mês trabalhado no período das médias.</p>
          ) : (
            <div className={cx(tb.moldura, 'mt-2 max-h-72 overflow-y-auto')}>
              <table className={tb.tabela}>
                <thead className={tb.cabeca}>
                  <tr>
                    <th className={tb.th}>Mês</th>
                    <th className={cx(tb.th, 'text-right')}>HE 50% (h)</th>
                    <th className={cx(tb.th, 'text-right')}>HE 100% (h)</th>
                    <th className={cx(tb.th, 'text-right')}>Noturno (h)</th>
                    <th className={cx(tb.th, 'text-right')}>DSR (h)</th>
                    <th className={tb.th}>Situação</th>
                    <th className={tb.th}>Considerar</th>
                  </tr>
                </thead>
                <tbody className={tb.corpo}>
                  {linhas.map((l) => {
                    const o = original.get(l.mes);
                    const aj = ajustes[l.mes];
                    const dsr = l.dsr50 + l.dsr100 + l.dsrNoturno;
                    return (
                      <tr key={l.mes} className={cx(tb.linha, !l.considerado && 'text-tinta-fraca')}>
                        <td className={cx(tb.td, 'whitespace-nowrap font-medium')}>{rotuloMes(l.mes)}</td>
                        <CelulaHoras mes={l.mes} campo="he50Min" original={o?.he50Min ?? 0} ajuste={aj} onAjustar={onAjustar} />
                        <CelulaHoras mes={l.mes} campo="he100Min" original={o?.he100Min ?? 0} ajuste={aj} onAjustar={onAjustar} />
                        <CelulaHoras mes={l.mes} campo="noturnoMin" original={o?.noturnoMin ?? 0} ajuste={aj} onAjustar={onAjustar} />
                        <td className={cx(tb.td, tb.num)} data-dica={o ? `${o.diasDsr} domingos e feriados ÷ ${o.diasUteis} dias úteis` : undefined}>{horasDec(dsr)}</td>
                        <td className={tb.td}>
                          {l.nota ? <span className="text-xs">{l.nota}</span>
                            : <Selo tom={l.ajustado ? 'aviso' : 'sucesso'}>{l.ajustado ? 'Ajustado' : 'Do ponto'}</Selo>}
                        </td>
                        <td className={tb.td}>
                          <Marcacao type="checkbox" aria-label={`Considerar ${rotuloMes(l.mes)}`} checked={!aj?.ignorar && !(l.nota ?? '').includes('menos de 15')}
                            disabled={(l.nota ?? '').includes('menos de 15')}
                            onChange={(x) => onAjustar(l.mes, { ...aj, ignorar: !x.target.checked })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {medias && (
            <ul className="mt-3 space-y-1">
              <ResumoMedia titulo="Aviso (últimos 12 meses)" m={medias.aviso} informadas={medias.informadas} />
              <ResumoMedia titulo={`13º (meses de ${desligamento.slice(0, 4)})`} m={medias.decimo} informadas={medias.informadas} />
              {medias.ferias.map((f) => (
                <ResumoMedia key={f.inicio} titulo={`Férias do aquisitivo desde ${br(f.inicio)}`} m={f.media} informadas={medias.informadas} />
              ))}
            </ul>
          )}
        </>
      )}
    </fieldset>
  );
}
