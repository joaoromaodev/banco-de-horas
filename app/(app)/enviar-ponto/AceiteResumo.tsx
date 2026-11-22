'use client';

// Aceite do resumo do ponto pela empresa-cliente (Sprint 17, frente C). Ver a seção
// "Mês fechado e aceite do cliente" em docs/folha-de-ponto.md.
//
// Quando a contabilidade fecha o mês de ponto, a empresa vê aqui as horas de cada
// funcionário (o que vai para a folha — sem valores em reais) e responde "Aceito" ou
// "Tenho uma dúvida". A resposta fica registrada com o login, a data, a hora e a
// versão da declaração aceita (DECLARACAO_ACEITE). Não é o espelho de ponto do
// empregado: é a confirmação da empresa ao escritório. Quem decide é a rota
// (/api/envio-ponto/aceite).
import { useCallback, useEffect, useState } from 'react';
import { hhmm } from '@/lib/resumoFolha';
import { DECLARACAO_ACEITE, type AceiteRegistro, type FotoResumo, type SituacaoAceite } from '@/lib/mesFechado';
import { DialogoTexto } from '../Dialogo';
import { Aviso, Botao, Carregando, Secao, Selo, tb } from '@/components/ui';

interface MesParaAceite {
  ano: number; mes: number; fechadoEm: string; assinatura: string; resumo: FotoResumo;
  situacao: SituacaoAceite; resposta: AceiteRegistro | null;
}

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = (ano: number, mes: number) => `${MESES[mes - 1].charAt(0).toUpperCase()}${MESES[mes - 1].slice(1)} de ${ano}`;
const quandoBR = (iso: string) => new Date(iso).toLocaleString('pt-BR', {
  timeZone: 'America/Belem', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const h = (min: number) => hhmm(min) || '—';
const n = (v: number) => (v ? String(v) : '—');

const SITUACAO: Record<SituacaoAceite, { rotulo: string; tom: 'sucesso' | 'aviso' | 'primaria' }> = {
  pendente: { rotulo: 'Aguardando o seu aceite', tom: 'primaria' },
  duvida: { rotulo: 'Dúvida enviada', tom: 'aviso' },
  aceito: { rotulo: 'Aceito', tom: 'sucesso' },
};

export function AceiteResumo() {
  const [meses, setMeses] = useState<MesParaAceite[] | null>(null);
  const [indisponivel, setIndisponivel] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [duvidaDe, setDuvidaDe] = useState<MesParaAceite | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch('/api/envio-ponto/aceite');
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (d.aguardandoBanco) { setIndisponivel(true); setMeses([]); return; }
        throw new Error(d.erro ?? 'Não foi possível carregar os resumos.');
      }
      setMeses(d.meses ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setMeses([]);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga da API; zerar erro/espera/dados antigos antes do fetch é intencional
  useEffect(() => { void carregar(); }, [carregar]);

  async function responder(m: MesParaAceite, resposta: 'aceito' | 'duvida', duvida?: string) {
    const chave = `${m.ano}-${m.mes}`;
    setDuvidaDe(null); setEnviando(chave); setErro(null); setMsg(null);
    try {
      const r = await fetch('/api/envio-ponto/aceite', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ano: m.ano, mes: m.mes, assinatura: m.assinatura, resposta, duvida }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.erro ?? 'Não foi possível enviar. Tente de novo.');
      setMsg(resposta === 'aceito'
        ? `Resumo de ${nomeMes(m.ano, m.mes)} aceito. A contabilidade já pode seguir com a folha.`
        : `Dúvida enviada. A contabilidade vai responder; depois você pode dar o aceite aqui.`);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setEnviando(null);
    }
  }

  // Nada fechado (o caso mais comum): a seção nem aparece.
  if (meses !== null && meses.length === 0 && !erro && !indisponivel) return null;
  if (indisponivel) return null;

  return (
    <div id="aceite" className="scroll-mt-4">
      <Secao titulo="Resumo do mês para o seu aceite"
        descricao="Quando a contabilidade fecha o ponto do mês, as horas de cada funcionário aparecem aqui. Confira e responda: o aceite fica registrado com o seu login, a data e a hora.">
        {erro && <Aviso tom="perigo" className="mb-3">{erro}</Aviso>}
        {msg && <Aviso tom="sucesso" className="mb-3">{msg}</Aviso>}
        {meses === null ? <Carregando className="p-4" /> : (
          <div className="space-y-6">
            {meses.map((m) => {
              const s = SITUACAO[m.situacao];
              const chave = `${m.ano}-${m.mes}`;
              const p = m.resumo.percentuais;
              return (
                <article key={chave} aria-labelledby={`aceite-${chave}`} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 id={`aceite-${chave}`} className="text-[15px] font-semibold text-tinta">{nomeMes(m.ano, m.mes)}</h3>
                    <Selo tom={s.tom}>{s.rotulo}</Selo>
                  </div>
                  <p className="text-[13px] text-tinta-suave">Fechado pela contabilidade em {quandoBR(m.fechadoEm)}.</p>

                  <div className={tb.moldura}>
                    <table className={`${tb.tabela} text-[13px]`}>
                      <caption className="sr-only">Horas de cada funcionário em {nomeMes(m.ano, m.mes)}</caption>
                      <thead className={tb.cabeca}>
                        <tr>
                          <th className={tb.th}>Funcionário</th>
                          <th className={`${tb.th} text-right`}>Dias</th>
                          <th className={`${tb.th} text-right`}>Normais</th>
                          <th className={`${tb.th} text-right`}>Extras {p.extraUtil}%</th>
                          <th className={`${tb.th} text-right`}>Banco de horas</th>
                          <th className={`${tb.th} text-right`}>Extras {p.extraDomFeriado}%</th>
                          <th className={`${tb.th} text-right`}>Noturno</th>
                          <th className={`${tb.th} text-right`}>Atrasos</th>
                          <th className={`${tb.th} text-right`}>Faltas</th>
                          <th className={`${tb.th} text-right`}>Atestado</th>
                          <th className={`${tb.th} text-right`}>Férias</th>
                        </tr>
                      </thead>
                      <tbody className={tb.corpo}>
                        {m.resumo.funcionarios.map((f) => (
                          <tr key={f.funcionario} className={tb.linha}>
                            <td className={`${tb.td} font-medium text-tinta`}>{f.funcionario}</td>
                            <td className={`${tb.td} ${tb.num}`}>{n(f.dias)}</td>
                            <td className={`${tb.td} ${tb.num}`}>{h(f.normaisMin)}</td>
                            <td className={`${tb.td} ${tb.num}`}>{h(f.extrasMin)}</td>
                            <td className={`${tb.td} ${tb.num}`}>{h(f.bancoMin)}</td>
                            <td className={`${tb.td} ${tb.num}`}>{h(f.extrasDomFeriadoMin)}</td>
                            <td className={`${tb.td} ${tb.num}`}>{h(f.noturnoMin)}</td>
                            <td className={`${tb.td} ${tb.num}`}>{h(f.atrasoMin)}</td>
                            <td className={`${tb.td} ${tb.num}`}>{n(f.faltas)}</td>
                            <td className={`${tb.td} ${tb.num}`}>{n(f.atestadoDias)}</td>
                            <td className={`${tb.td} ${tb.num}`}>{n(f.feriasDias)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-tinta-suave">
                    Horas em h:mm. Só horas e dias — os valores em reais são calculados na folha de pagamento.
                  </p>

                  {m.situacao === 'aceito' && m.resposta && (
                    <p className="text-[13px] text-sucesso">Aceito por {m.resposta.por} em {quandoBR(m.resposta.em)}.</p>
                  )}
                  {m.situacao === 'duvida' && m.resposta && (
                    <p className="text-[13px] text-tinta-suave">
                      Dúvida enviada por {m.resposta.por} em {quandoBR(m.resposta.em)}: <span className="text-tinta">“{m.resposta.duvida}”</span>.
                      Quando a contabilidade responder, dê o aceite aqui.
                    </p>
                  )}
                  {m.situacao !== 'aceito' && (
                    <p className="text-[13px] text-tinta">Ao clicar em “Aceito”: {DECLARACAO_ACEITE.texto(nomeMes(m.ano, m.mes).toLowerCase())}</p>
                  )}
                  {m.situacao !== 'aceito' && (
                    <div className="flex flex-wrap gap-2">
                      <Botao variante="sucesso" onClick={() => responder(m, 'aceito')} carregando={enviando === chave}
                        disabled={enviando !== null} aria-label={`Aceito o resumo de ${nomeMes(m.ano, m.mes)}`}>
                        Aceito
                      </Botao>
                      <Botao variante="secundaria" onClick={() => setDuvidaDe(m)} disabled={enviando !== null}
                        aria-label={`Tenho uma dúvida sobre o resumo de ${nomeMes(m.ano, m.mes)}`}>
                        Tenho uma dúvida
                      </Botao>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </Secao>

      {duvidaDe && (
        <DialogoTexto titulo={`Dúvida sobre ${nomeMes(duvidaDe.ano, duvidaDe.mes)}`} textoConfirmar="Enviar dúvida"
          descricao="Conte o que não confere. A contabilidade vê a sua mensagem junto do resumo."
          rotulo="Sua dúvida" minimo={3} maximo={1000} placeholder="Ex.: no dia 12 o funcionário estava de atestado, não faltou."
          erroCurto="Escreva a sua dúvida (pelo menos 3 letras)."
          onConfirmar={(t) => responder(duvidaDe, 'duvida', t)} onCancelar={() => setDuvidaDe(null)} />
      )}
    </div>
  );
}
