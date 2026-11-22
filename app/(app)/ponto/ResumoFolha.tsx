'use client';

// "Resumo para a folha" na Timesheet (lib/resumoFolha.ts): por funcionário, as horas
// e os dias que a contadora digita no programa de folha. Só horas e dias — nunca R$.
// Os achados que impedem fechar o mês (marcação faltando, horário ilegível…) ficam
// em destaque; "Conferido pela contadora" só vale com o mês sem pendência.
// "Fechar o mês" (Sprint 17, frente C) guarda a foto do resumo, trava as frequências
// do mês e manda o resumo ao cliente para aceite; reabrir exige motivo.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ResumoFolhaFuncionario, ResumoFolhaMes } from '@/lib/resumoFolha';
import { hhmm } from '@/lib/resumoFolha';
import { MESES } from '@/lib/calendario';
import { Aviso, Botao, botaoCls, Carregando, Entrada, EstadoVazio, Marcacao, Secao, Selo, tb } from '@/components/ui';
import { IconeBaixar, IconeCadeado } from '../icones';
import { DialogoConfirmacao, DialogoTexto } from '../Dialogo';
import { fotoDoResumo, mesmaFoto, type AceiteRegistro, type EventoMes, type FotoResumo, type SituacaoAceite } from '@/lib/mesFechado';

interface Conferido { por: string; em: string; atual: boolean }
interface Retorno { resumo: ResumoFolhaMes; conferido: Conferido | null; conferidoIndisponivel: boolean }
interface Fechamento {
  fechamento: { por: string; em: string; assinatura: string; resumo: FotoResumo } | null;
  historico: EventoMes[];
  aceite: { situacao: SituacaoAceite; ultimo: AceiteRegistro | null } | null;
  respostas: AceiteRegistro[];
}
const quandoBR = (iso: string) => new Date(iso).toLocaleString('pt-BR', {
  timeZone: 'America/Belem', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

const dd = (n: number) => String(n).padStart(2, '0');
const dataBR = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Belem' });
/** Zero vira traço: a tabela fica fácil de varrer. */
const h = (min: number) => hhmm(min) || '—';
const n = (v: number) => (v ? String(v) : '—');

function Linha({ f, aberto, onAbrir, onBanco }: {
  f: ResumoFolhaFuncionario; aberto: boolean; onAbrir: (nome: string) => void; onBanco: (nome: string, v: boolean) => void;
}) {
  const outros = [f.feriasDias && `${f.feriasDias} férias`, f.folgaDias && `${f.folgaDias} folga`, f.feriadoDias && `${f.feriadoDias} feriado`, f.bancoMarcadorDias && `${f.bancoMarcadorDias} banco`]
    .filter(Boolean).join(' · ');
  return (
    <tr className={`${tb.linha} ${f.impedimentos.length ? 'bg-perigo-suave/40' : ''}`}>
      <td className={tb.td}>
        <div className="font-medium text-tinta">{f.funcionario}</div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {f.impedimentos.length > 0 && <Selo tom="perigo">{f.impedimentos.length} a corrigir</Selo>}
          {f.conferir.length > 0 && <Selo tom="aviso">{f.conferir.length} a conferir</Selo>}
        </div>
      </td>
      <td className={`${tb.td} ${tb.num}`}>{n(f.diasTrabalhados)}</td>
      <td className={`${tb.td} ${tb.num}`}>{h(f.normaisMin)}</td>
      <td className={`${tb.td} ${tb.num}`}>{h(f.extrasUtilPagarMin)}</td>
      <td className={`${tb.td} ${tb.num}`}>{h(f.extrasUtilBancoMin)}</td>
      <td className={`${tb.td} ${tb.num}`}>{h(f.extrasDomFeriadoMin)}</td>
      <td className={`${tb.td} ${tb.num}`} data-dica={f.noturnoRealMin ? `${hhmm(f.noturnoRealMin)} reais na faixa de 22h às 5h` : undefined}>{h(f.noturnoComputadoMin)}</td>
      <td className={`${tb.td} ${tb.num}`}>{h(f.atrasoMin)}</td>
      <td className={`${tb.td} ${tb.num}`}>{n(f.faltas)}</td>
      <td className={`${tb.td} ${tb.num}`} data-dica={f.dsrDoProximoMes ? `${f.dsrDoProximoMes} DSR perdido(s) entra(m) na folha do mês seguinte` : undefined}>
        {n(f.dsrPerdidos)}{f.dsrDoProximoMes > 0 ? ` (+${f.dsrDoProximoMes})` : ''}
      </td>
      <td className={`${tb.td} ${tb.num}`}>{n(f.atestadoDias)}</td>
      <td className={`${tb.td} text-[13px] text-tinta-suave`}>{outros || '—'}</td>
      <td className={tb.td}>
        <Marcacao type="checkbox" checked={f.temBanco} onChange={(e) => onBanco(f.funcionario, e.target.checked)}
          aria-label={`${f.funcionario} tem banco de horas`} className="text-[13px]">banco</Marcacao>
      </td>
      <td className={tb.td}>
        <Botao tamanho="sm" variante={aberto ? 'tonal' : 'fantasma'} onClick={() => onAbrir(f.funcionario)}>Abrir folha</Botao>
      </td>
    </tr>
  );
}

function Notas({ f, mes }: { f: ResumoFolhaFuncionario; mes: number }) {
  if (!f.impedimentos.length && !f.conferir.length) return null;
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <p className="font-medium text-tinta">{f.funcionario}</p>
      <ul className="mt-1.5 space-y-1">
        {f.impedimentos.map((a, i) => (
          <li key={`i${i}`} className="flex items-start gap-2 text-[13px] text-tinta-suave">
            <span className="w-11 shrink-0 font-medium tabular-nums text-tinta">{a.dia ? `${dd(a.dia)}/${dd(mes)}` : 'mês'}</span>
            <Selo tom="perigo" className="shrink-0">{a.rotulo}</Selo>
            <span>{a.motivo}</span>
          </li>
        ))}
        {f.conferir.map((c, i) => (
          <li key={`c${i}`} className="flex items-start gap-2 text-[13px] text-tinta-suave">
            <span className="w-11 shrink-0 font-medium tabular-nums text-tinta">{c.dia ? `${dd(c.dia)}/${dd(mes)}` : 'mês'}</span>
            <Selo tom="aviso" className="shrink-0">conferir</Selo>
            <span>{c.texto}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function ResumoFolha({ empresa, empresaNome, ano, mes, funcionarioAberto, onAbrir, recarregar }: {
  empresa: string; empresaNome: string; ano: number; mes: number; funcionarioAberto: string;
  onAbrir: (funcionario: string) => void;
  /** Muda quando a Timesheet salvou uma folha: o resumo se recalcula. */
  recarregar: number;
}) {
  const [dados, setDados] = useState<Retorno | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [banco, setBanco] = useState<Set<string>>(new Set());
  const [pExtra, setPExtra] = useState('50');
  const [pDom, setPDom] = useState('100');
  const [pNoturno, setPNoturno] = useState('20');
  const [salvando, setSalvando] = useState(false);
  const ultima = useRef('');
  const [fech, setFech] = useState<Fechamento | null>(null);
  const [fechSemBanco, setFechSemBanco] = useState(false);
  const [pedindoFechar, setPedindoFechar] = useState(false);
  const [pedindoReabrir, setPedindoReabrir] = useState(false);
  const [msgFech, setMsgFech] = useState<string | null>(null);

  const carregarFechamento = useCallback(async () => {
    if (!empresa) { setFech(null); return; }
    try {
      const r = await fetch(`/api/resumo-folha/fechamento?empresa=${encodeURIComponent(empresa)}&ano=${ano}&mes=${mes}`);
      const d = await r.json().catch(() => ({}));
      setFechSemBanco(Boolean(d.aguardandoBanco));
      setFech(r.ok ? d : null);
    } catch {
      setFech(null);
    }
  }, [empresa, ano, mes]);

  useEffect(() => {
    const t = setTimeout(carregarFechamento, 300);
    return () => clearTimeout(t);
  }, [carregarFechamento, recarregar]);

  async function acaoFechamento(corpo: Record<string, unknown>, ok: string) {
    setPedindoFechar(false); setPedindoReabrir(false);
    setSalvando(true); setErro(null); setMsgFech(null);
    try {
      const r = await fetch('/api/resumo-folha/fechamento', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa, ano, mes, ...corpo }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.erro ?? 'Não foi possível concluir.');
      setMsgFech(ok);
      await carregarFechamento();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  const consulta = useMemo(() => {
    const p = new URLSearchParams({ empresa, ano: String(ano), mes: String(mes) });
    for (const b of banco) p.append('banco', b);
    if (pExtra.trim()) p.set('extra', pExtra);
    if (pDom.trim()) p.set('dom', pDom);
    if (pNoturno.trim()) p.set('noturno', pNoturno);
    return p.toString();
  }, [empresa, ano, mes, banco, pExtra, pDom, pNoturno]);

  const carregar = useCallback(async () => {
    if (!empresa) { setDados(null); return; }
    ultima.current = consulta;
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/resumo-folha?${consulta}`);
      const d = await r.json();
      if (ultima.current !== consulta) return; // resposta atrasada
      if (!r.ok) throw new Error(d.erro ?? 'Falha ao montar o resumo.');
      setDados(d);
    } catch (e) {
      if (ultima.current === consulta) { setDados(null); setErro(e instanceof Error ? e.message : String(e)); }
    } finally {
      if (ultima.current === consulta) setCarregando(false);
    }
  }, [empresa, consulta]);

  useEffect(() => {
    const t = setTimeout(carregar, 300); // o ano e os percentuais são digitados
    return () => clearTimeout(t);
  }, [carregar, recarregar]);


  async function conferir(valor: boolean) {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch('/api/resumo-folha', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa, ano, mes, conferido: valor, banco: [...banco] }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.aguardandoBanco ? 'O carimbo de conferência ainda depende de uma atualização do banco (migração 0022).' : d.erro ?? 'Falha ao registrar.');
      setDados((a) => (a ? { ...a, conferido: d.conferido } : a));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  const resumo = dados?.resumo;
  const funcs = resumo?.funcionarios ?? [];
  const p = resumo?.percentuais;
  const comPendencia = resumo?.comImpedimento ?? 0;
  const conf = dados?.conferido;
  const href = (formato: 'xlsx' | 'csv') => `/api/resumo-folha?${consulta}&formato=${formato}`;

  return (
    <Secao titulo="Resumo para a folha"
      descricao={`Horas e dias de ${MESES[mes]}/${ano} para digitar no programa de folha — sem valores em reais. Calculado das folhas salvas; para corrigir, abra a folha e edite o dia.`}
      acoes={funcs.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <a href={href('xlsx')} download className={botaoCls({ tamanho: 'sm' })}><IconeBaixar /> Excel (.xlsx)</a>
          <a href={href('csv')} download className={botaoCls({ tamanho: 'sm' })}><IconeBaixar /> CSV</a>
        </div>
      ) : undefined}>
      {erro && <Aviso tom="perigo" className="mb-4">{erro}</Aviso>}
      {carregando && !dados && <Carregando />}
      {dados && funcs.length === 0 && (
        <EstadoVazio moldura={false} titulo="Nenhuma folha salva neste mês"
          descricao={`Quando houver folhas de ${MESES[mes]}/${ano} de ${empresaNome || 'esta empresa'} salvas no banco, o resumo aparece aqui.`} />
      )}
      {resumo && funcs.length > 0 && (
        <div className="space-y-4">
          {resumo.avisos.map((a) => <Aviso key={a} tom="neutro">{a}</Aviso>)}
          {comPendencia > 0 && (
            <Aviso tom="perigo" titulo="Ainda não dá para fechar o mês">
              {comPendencia} de {funcs.length} funcionário(s) com marcação faltando, horário ilegível ou marcador em conflito. Esses dias ficam fora da conta até serem corrigidos.
            </Aviso>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Entrada rotulo="Extra de dia útil (%)" type="number" inputMode="decimal" min={0} max={300} value={pExtra} onChange={(e) => setPExtra(e.target.value)} dica="Mínimo legal: 50" />
            <Entrada rotulo="Domingo e feriado (%)" type="number" inputMode="decimal" min={0} max={300} value={pDom} onChange={(e) => setPDom(e.target.value)} dica="Mínimo legal: 100" />
            <Entrada rotulo="Adicional noturno (%)" type="number" inputMode="decimal" min={0} max={300} value={pNoturno} onChange={(e) => setPNoturno(e.target.value)} dica="Mínimo legal: 20" />
          </div>

          <div className={tb.moldura}>
            <table className={`${tb.tabela} text-[13px]`}>
              <thead className={tb.cabeca}>
                <tr>
                  <th className={tb.th}>Funcionário</th>
                  <th className={`${tb.th} text-right`}>Dias</th>
                  <th className={`${tb.th} text-right`}>Normais</th>
                  <th className={`${tb.th} text-right`}>Extras {p?.extraUtil}%</th>
                  <th className={`${tb.th} text-right`}>→ Banco</th>
                  <th className={`${tb.th} text-right`}>Extras {p?.extraDomFeriado}%</th>
                  <th className={`${tb.th} text-right`}>Noturno</th>
                  <th className={`${tb.th} text-right`}>Atrasos</th>
                  <th className={`${tb.th} text-right`}>Faltas</th>
                  <th className={`${tb.th} text-right`}>DSR perdido</th>
                  <th className={`${tb.th} text-right`}>Atestado</th>
                  <th className={tb.th}>Outros dias</th>
                  <th className={tb.th}>Banco</th>
                  <th className={tb.th}><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className={tb.corpo}>
                {funcs.map((f) => (
                  <Linha key={f.funcionario} f={f} aberto={f.funcionario === funcionarioAberto} onAbrir={onAbrir}
                    onBanco={(nome, v) => setBanco((a) => { const novo = new Set(a); if (v) novo.add(nome); else novo.delete(nome); return novo; })} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[13px] text-tinta-suave">
            Horas em h:mm. <strong className="font-medium text-tinta">Noturno</strong> é a hora computada (52min30s, adicional de {p?.adicionalNoturno}%);
            passe o mouse para ver os minutos reais. <strong className="font-medium text-tinta">Atrasos</strong> é o que passa de 10 min no dia.
            Com <strong className="font-medium text-tinta">banco</strong> marcado, as extras de dia útil vão para o banco e os atrasos abatem o saldo;
            domingo e feriado seguem a pagar. Enquanto o cadastro do empregado não traz o acordo, marque o banco aqui.
          </p>

          {funcs.some((f) => f.impedimentos.length || f.conferir.length) && (
            <div>
              <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wider text-tinta-suave">Para corrigir e conferir</h3>
              <ul className="divide-y divide-borda">
                {funcs.map((f) => <Notas key={f.funcionario} f={f} mes={mes} />)}
              </ul>
            </div>
          )}

          <FechamentoDoMes fech={fech} semBanco={fechSemBanco} mes={mes} ano={ano} comPendencia={comPendencia}
            salvando={salvando} msg={msgFech}
            divergente={!!fech?.fechamento && !mesmaFoto(fotoDoResumo(resumo), fech.fechamento.resumo)}
            onFechar={() => setPedindoFechar(true)} onReabrir={() => setPedindoReabrir(true)} />

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-borda pt-4">
            <p className="text-[13px] text-tinta-suave" role="status">
              {conf?.atual
                ? <><Selo tom="sucesso">conferido</Selo> por {conf.por} em {dataBR(conf.em)}.</>
                : conf
                  ? <><Selo tom="aviso">conferência desatualizada</Selo> as folhas mudaram desde que {conf.por} conferiu em {dataBR(conf.em)}.</>
                  : dados?.conferidoIndisponivel
                    ? 'O carimbo "conferido" depende de uma atualização do banco que ainda não chegou.'
                    : 'Ainda não conferido pela contadora.'}
            </p>
            <span className="flex flex-wrap gap-2">
              {conf && <Botao tamanho="sm" variante="fantasma" onClick={() => conferir(false)} disabled={salvando}>Desfazer conferência</Botao>}
              {!conf?.atual && (
                <span data-dica={comPendencia > 0 ? 'Corrija as pendências antes de marcar como conferido' : undefined}>
                  <Botao tamanho="sm" variante="tonal" onClick={() => conferir(true)} carregando={salvando}
                    disabled={salvando || comPendencia > 0 || dados?.conferidoIndisponivel}>
                    Marcar como conferido
                  </Botao>
                </span>
              )}
            </span>
          </div>
        </div>
      )}
      {pedindoFechar && (
        <DialogoConfirmacao perigo={false} titulo={`Fechar o ponto de ${MESES[mes]}/${ano}?`} textoConfirmar="Fechar o mês"
          mensagem={<>O resumo como está agora (com os percentuais e o banco marcados nesta tela) fica guardado e vai à
            empresa para o <strong>aceite</strong>. As frequências de {MESES[mes]}/{ano} <strong>ficam travadas</strong>: nenhuma
            folha do mês é salva, aplicada ou desfeita até o mês ser reaberto com motivo.</>}
          onConfirmar={() => acaoFechamento({
            acao: 'fechar', banco: [...banco], extra: pExtra, dom: pDom, noturno: pNoturno,
          }, 'Mês fechado. A empresa recebe o resumo para o aceite.')}
          onCancelar={() => setPedindoFechar(false)} />
      )}
      {pedindoReabrir && (
        <DialogoTexto titulo={`Reabrir o ponto de ${MESES[mes]}/${ano}?`} textoConfirmar="Reabrir o mês" perigo
          descricao="As frequências voltam a poder ser alteradas. Se os números mudarem, a empresa terá de dar o aceite de novo quando o mês for fechado outra vez. O motivo fica registrado no histórico, com o seu nome e a hora."
          rotulo="Motivo da reabertura" placeholder="Ex.: a empresa apontou falta no dia 12 que era atestado."
          erroCurto="Escreva o motivo (pelo menos 5 letras)."
          onConfirmar={(motivo) => acaoFechamento({ acao: 'reabrir', motivo }, 'Mês reaberto. O motivo ficou no histórico.')}
          onCancelar={() => setPedindoReabrir(false)} />
      )}
    </Secao>
  );
}

const TEXTO_ACEITE: Record<SituacaoAceite, { rotulo: string; tom: 'sucesso' | 'aviso' | 'neutro' }> = {
  aceito: { rotulo: 'aceito pela empresa', tom: 'sucesso' },
  duvida: { rotulo: 'empresa com dúvida', tom: 'aviso' },
  pendente: { rotulo: 'aguardando o aceite', tom: 'neutro' },
};

/** Fechamento do mês: situação, aceite da empresa, histórico e o botão de fechar/reabrir. */
function FechamentoDoMes({ fech, semBanco, mes, ano, comPendencia, salvando, msg, divergente, onFechar, onReabrir }: {
  fech: Fechamento | null; semBanco: boolean; mes: number; ano: number; comPendencia: number; salvando: boolean;
  msg: string | null; divergente: boolean; onFechar: () => void; onReabrir: () => void;
}) {
  if (semBanco) {
    return <p className="text-[13px] text-tinta-suave">Fechar o mês e o aceite da empresa dependem de uma atualização do banco (migração 0034).</p>;
  }
  if (!fech) return null;
  const f = fech.fechamento;
  const aceite = fech.aceite;
  const t = aceite ? TEXTO_ACEITE[aceite.situacao] : null;
  const itens = [
    ...fech.historico.map((h) => ({ em: h.em, chave: `h${h.em}`, conteudo: <>
      <Selo tom={h.acao === 'fechou' ? 'sucesso' : 'aviso'}>{h.acao === 'fechou' ? 'fechou' : 'reabriu'}</Selo>{' '}
      {h.por} em {quandoBR(h.em)}{h.motivo ? <> — <span className="text-tinta">“{h.motivo}”</span></> : null}
    </> })),
    ...fech.respostas.map((a) => ({ em: a.em, chave: `a${a.em}`, conteudo: <>
      <Selo tom={a.resposta === 'aceito' ? 'sucesso' : 'aviso'}>{a.resposta === 'aceito' ? 'empresa aceitou' : 'empresa com dúvida'}</Selo>{' '}
      {a.por} em {quandoBR(a.em)}{a.duvida ? <> — <span className="text-tinta">“{a.duvida}”</span></> : null}
    </> })),
  ].sort((x, y) => (x.em < y.em ? 1 : -1));
  return (
    <div className="space-y-3 rounded-xl border border-borda bg-superficie-suave p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[13px] text-tinta-suave" role="status">
          {f ? (
            <>
              <Selo tom="sucesso"><IconeCadeado size={12} /> mês fechado</Selo>{' '}
              por {f.por} em {quandoBR(f.em)}. As frequências de {MESES[mes]}/{ano} não mudam sem reabrir.
              {t && (
                <span className="mt-1.5 block">
                  <Selo tom={t.tom}>{t.rotulo}</Selo>{' '}
                  {aceite?.ultimo && <>por {aceite.ultimo.por} em {quandoBR(aceite.ultimo.em)}</>}
                  {aceite?.situacao === 'duvida' && aceite.ultimo?.duvida && <> — <span className="text-tinta">“{aceite.ultimo.duvida}”</span></>}
                </span>
              )}
            </>
          ) : 'Mês aberto: as folhas ainda podem ser corrigidas. Feche quando o resumo estiver pronto para a folha.'}
          {msg && <span className="mt-1.5 block text-sucesso">{msg}</span>}
        </div>
        {f ? (
          <Botao tamanho="sm" variante="secundaria" onClick={onReabrir} disabled={salvando}>Reabrir o mês</Botao>
        ) : (
          <span data-dica={comPendencia > 0 ? 'Corrija as pendências antes de fechar o mês' : undefined}>
            <Botao tamanho="sm" variante="sucesso" icone={<IconeCadeado size={14} />} onClick={onFechar}
              carregando={salvando} disabled={salvando || comPendencia > 0}>
              Fechar o mês
            </Botao>
          </span>
        )}
      </div>
      {divergente && (
        <Aviso tom="aviso">
          O cálculo desta tela difere do que foi fechado (feriado, jornada, percentual ou banco mudou depois). A folha e o aceite
          da empresa usam os números guardados no fechamento; para trocá-los, reabra o mês com o motivo e feche de novo.
        </Aviso>
      )}
      {itens.length > 0 && (
        <details className="text-[13px]">
          <summary className="cursor-pointer font-medium text-tinta">Histórico do mês ({itens.length})</summary>
          <ul className="mt-2 space-y-1.5 text-tinta-suave">
            {itens.map((i) => <li key={i.chave}>{i.conteudo}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
