'use client';

// Ficha do empregado: dados, férias (períodos, programação, aviso e recibo) e 13º
// (avos do ano e prazos). Tudo calculado aqui com lib/ferias.ts e lib/decimoTerceiro.ts
// a partir do que /api/dp/empregado devolve.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DialogoConfirmacao } from '../Dialogo';
import { IconeBaixar, IconeExcluir } from '../icones';
import {
  Aviso, Botao, BotaoIcone, botaoCls, Carregando, cx, EstadoVazio, Secao, Selo, tb, type Tom,
} from '@/components/ui';
import { Toast, Toasts } from '@/components/retorno';
import {
  avisosEmpregado, br, cpfFormatado, DIAS_SEMANA_CURTO, ESCALAS, jornadaDoEmpregado, SITUACOES_EMPREGADO,
  TIPOS_AFASTAMENTO, type DadosEmpregado, type Empregado,
} from '@/lib/dp';
import {
  alertasFerias, conjuntoFeriados, FAIXAS_ART130, fimDoGozo, mesesDoPeriodo, retornoDoGozo, ROTULO_ESTADO,
  situacaoFerias, type EstadoPeriodo, type FeriasProgramada,
} from '@/lib/ferias';
import { avisoAfastamento13, avosDecimo, entraNoDecimo, faltasPorMesDoAno, MESES_CURTOS, prazosDecimo } from '@/lib/decimoTerceiro';
import { FormEmpregado } from './FormEmpregado';
import { ProgramarFerias, type PedidoTela } from './ProgramarFerias';
import { SimularRescisao } from './SimularRescisao';

interface EmpresaFicha { id: string; nome: string; cnpj?: string | null; jornadaUtilMin: number | null; jornadaSabadoMin: number | null; trabalhaSabado: boolean }
interface DadosFicha {
  empregado: Empregado; ferias: FeriasProgramada[]; faltas: string[]; mesesComPonto: string[];
  funcionario: { nome: string; jornadaUtilMin?: number; jornadaSabadoMin?: number } | null;
  feriados: string[]; empresa: EmpresaFicha;
}

export const TOM_ESTADO: Record<EstadoPeriodo, Tom> = {
  aquisitivo: 'neutro', aberto: 'primaria', vencendo: 'aviso', vencido: 'perigo', quitado: 'sucesso', perdido: 'neutro', suspenso: 'neutro',
};
export const TOM_SITUACAO: Record<Empregado['situacao'], Tom> = { ativo: 'sucesso', afastado: 'aviso', desligado: 'neutro' };

const hm = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;
const dinheiro = (v: number | null) => (v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:gap-4">
      <dt className="w-48 shrink-0 text-[13px] text-tinta-suave">{rotulo}</dt>
      <dd className="text-tinta">{children}</dd>
    </div>
  );
}

export function Ficha({ id, hoje, onVoltar, onMudou }: { id: string; hoje: string; onVoltar: () => void; onMudou: () => void }) {
  const [d, setD] = useState<DadosFicha | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [programando, setProgramando] = useState(false);
  const [simulando, setSimulando] = useState(false);
  const [excluindo, setExcluindo] = useState<FeriasProgramada | null>(null);
  const [desfazer, setDesfazer] = useState<{ id: string; texto: string; acao: 'excluir' | 'restaurar' } | null>(null);
  const [verCpf, setVerCpf] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch(`/api/dp/empregado?id=${encodeURIComponent(id)}`);
    const x = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(x.erro ?? 'Falha ao carregar a ficha.'); return; }
    setD(x);
  }, [id]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial (o setState acontece depois do fetch)
  useEffect(() => { carregar(); }, [carregar]);

  const ano = Number(hoje.slice(0, 4));
  const feriados = useMemo(() => conjuntoFeriados([ano - 1, ano, ano + 1, ano + 2], d?.feriados ?? []), [ano, d?.feriados]);
  const periodos = useMemo(() => (d ? situacaoFerias(d.empregado, d.faltas, d.ferias, hoje) : []), [d, hoje]);
  const alertas = useMemo(() => (d ? alertasFerias(d.empregado, periodos, hoje) : []), [d, periodos, hoje]);
  const avos = useMemo(() => (d ? avosDecimo(d.empregado, ano, faltasPorMesDoAno(d.faltas, ano), hoje) : null), [d, ano, hoje]);

  if (!d) {
    return (
      <>
        <Toasts>{erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}</Toasts>
        {erro ? <Aviso tom="perigo" acao={<Botao tamanho="sm" onClick={onVoltar}>Voltar à lista</Botao>}>{erro}</Aviso> : <Carregando />}
      </>
    );
  }

  const e = d.empregado;
  const jornada = jornadaDoEmpregado(e, d.funcionario, {
    jornadaUtilMin: d.empresa.jornadaUtilMin ?? undefined, jornadaSabadoMin: d.empresa.jornadaSabadoMin ?? undefined, trabalhaSabado: d.empresa.trabalhaSabado,
  });
  const prazos = prazosDecimo(ano);
  const avisosCad = avisosEmpregado(e);
  const aviso13 = avisoAfastamento13(e);
  const meses = new Set(d.mesesComPonto);

  async function salvar(dados: DadosEmpregado): Promise<string | null> {
    const r = await fetch('/api/dp', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.id, dados }) });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) return x.erro ?? 'Falha ao salvar.';
    setEditando(false); setMsg('Dados do empregado salvos.');
    await carregar(); onMudou();
    return null;
  }

  async function programar(p: PedidoTela): Promise<string | null> {
    const r = await fetch('/api/dp/ferias', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ empregadoId: e.id, ...p }) });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) return x.erro ?? 'Falha ao programar.';
    setProgramando(false);
    setDesfazer({ id: x.ferias.id, acao: 'excluir', texto: `Férias de ${br(p.inicio)} (${p.dias} dias) programadas.` });
    await carregar(); onMudou();
    return null;
  }

  async function excluir(f: FeriasProgramada) {
    setExcluindo(null);
    const r = await fetch(`/api/dp/ferias?id=${encodeURIComponent(f.id)}`, { method: 'DELETE' });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(x.erro ?? 'Falha ao excluir.'); return; }
    setDesfazer({ id: f.id, acao: 'restaurar', texto: `Férias de ${br(f.inicio)} excluídas.` });
    await carregar(); onMudou();
  }

  /** Desfaz a última ação: programar (exclui) ou excluir (restaura). */
  async function desfazerUltima() {
    if (!desfazer) return;
    const { id: fid, acao } = desfazer;
    setDesfazer(null);
    const r = acao === 'excluir'
      ? await fetch(`/api/dp/ferias?id=${encodeURIComponent(fid)}`, { method: 'DELETE' })
      : await fetch('/api/dp/ferias', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: fid, restaurar: true }) });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(x.erro ?? 'Não foi possível desfazer.'); return; }
    setMsg('Desfeito.');
    await carregar(); onMudou();
  }

  const urlDoc = (f: FeriasProgramada, doc: 'aviso' | 'recibo') => `/api/dp/documento?ferias=${encodeURIComponent(f.id)}&doc=${doc}`;
  const programadas = [...d.ferias].sort((a, b) => b.inicio.localeCompare(a.inicio));
  const podeProgramar = e.situacao === 'ativo' && periodos.some((p) => p.saldo > 0 && p.estado !== 'perdido');

  return (
    <div className="space-y-5">
      <Toasts>
        {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
        {msg && <Toast onFechar={() => setMsg(null)}>{msg}</Toast>}
        {desfazer && (
          <Toast tom="info" onFechar={() => setDesfazer(null)}
            acao={<Botao tamanho="sm" variante="tonal" onClick={desfazerUltima}>Desfazer</Botao>}>{desfazer.texto}</Toast>
        )}
      </Toasts>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Botao variante="fantasma" tamanho="sm" onClick={onVoltar}>← Voltar à lista</Botao>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-tinta">{e.nome}</h2>
          <p className="text-[13px] text-tinta-suave">{d.empresa.nome}{e.cargo ? ` · ${e.cargo}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Selo tom={TOM_SITUACAO[e.situacao]}>{SITUACOES_EMPREGADO.find((s) => s.valor === e.situacao)?.rotulo}</Selo>
          <Botao onClick={() => setEditando(true)}>Editar dados</Botao>
          <Botao onClick={() => setSimulando(true)} disabled={!e.admissao}
            data-dica={e.admissao ? 'Simulação: não grava nada e não muda a situação' : 'Cadastre a admissão para simular'}>
            Simular rescisão
          </Botao>
          <Botao variante="primaria" disabled={!podeProgramar} onClick={() => setProgramando(true)}
            data-dica={podeProgramar ? undefined : e.situacao !== 'ativo' ? 'Só para empregado ativo' : 'Sem saldo de férias para programar'}>
            Programar férias
          </Botao>
        </div>
      </div>

      {alertas.filter((a) => a.nivel !== 'info').map((a) => (
        <Aviso key={a.texto} tom={a.nivel === 'perigo' ? 'perigo' : 'aviso'} titulo={a.rotulo}>{a.texto}</Aviso>
      ))}
      {alertas.filter((a) => a.nivel === 'info').map((a) => <Aviso key={a.texto} tom="info" titulo={a.rotulo}>{a.texto}</Aviso>)}

      <Secao titulo="Dados do empregado">
        <dl className="divide-y divide-borda">
          <Linha rotulo="CPF">
            {e.cpf ? (
              <span className="inline-flex items-center gap-2">
                <span className="tabular-nums">{verCpf ? cpfFormatado(e.cpf) : `***.${e.cpf.slice(3, 6)}.***-**`}</span>
                <Botao tamanho="sm" variante="fantasma" onClick={() => setVerCpf((v) => !v)}>{verCpf ? 'Ocultar' : 'Mostrar'}</Botao>
              </span>
            ) : '—'}
          </Linha>
          <Linha rotulo="Admissão">{br(e.admissao) || <span className="text-aviso">Não cadastrada</span>}</Linha>
          <Linha rotulo="Salário base">{dinheiro(e.salarioBase)}</Linha>
          <Linha rotulo="Jornada contratual">
            {jornada.horasSemanais.toLocaleString('pt-BR')}h por semana{jornada.escala ? ` · escala ${ESCALAS.find((x) => x.valor === jornada.escala)?.rotulo}` : ''}
            <span className="block text-[13px] text-tinta-suave">
              {hm(jornada.utilMin)} nos dias úteis{jornada.trabalhaSabado ? ` · ${hm(jornada.sabadoMin)} aos sábados` : ' · sábado de folga'}
              {' '}({jornada.fonte === 'funcionario' ? 'do cadastro do ponto' : jornada.fonte === 'empresa' ? 'da empresa' : 'padrão'}) · repouso: {DIAS_SEMANA_CURTO[jornada.dsr].toLowerCase()}
            </span>
          </Linha>
          <Linha rotulo="Banco de horas">{e.bancoHoras ? `Com acordo${e.bancoHorasDesde ? ` desde ${br(e.bancoHorasDesde)}` : ''}` : 'Sem acordo'}</Linha>
          <Linha rotulo="Situação">
            {SITUACOES_EMPREGADO.find((s) => s.valor === e.situacao)?.rotulo}
            {e.situacaoDesde ? ` desde ${br(e.situacaoDesde)}` : ''}
            {e.afastamentoTipo ? ` · ${TIPOS_AFASTAMENTO.find((t) => t.valor === e.afastamentoTipo)?.rotulo}` : ''}
          </Linha>
          {e.aquisitivoBase && <Linha rotulo="Início do aquisitivo">{br(e.aquisitivoBase)} (editado)</Linha>}
          <Linha rotulo="Folha de ponto">{d.funcionario ? `Ligado a “${d.funcionario.nome}”` : <span className="text-tinta-suave">Sem cadastro no ponto com este nome</span>}</Linha>
        </dl>
        {avisosCad.length > 0 && <Aviso tom="aviso" className="mt-3"><ul className="list-disc pl-4">{avisosCad.map((a) => <li key={a}>{a}</li>)}</ul></Aviso>}
      </Secao>

      <Secao titulo="Férias" descricao="Períodos aquisitivos a partir da admissão. Os dias de direito seguem as faltas injustificadas (marcador FALTA) lançadas no ponto — CLT art. 130.">
        {periodos.length === 0 ? (
          <EstadoVazio moldura={false} titulo="Sem períodos para mostrar" descricao={e.admissao ? 'Nada a calcular ainda.' : 'Cadastre a data de admissão em “Editar dados”.'} />
        ) : (
          <div className={tb.moldura}>
            <table className={tb.tabela}>
              <thead className={tb.cabeca}>
                <tr>
                  <th className={tb.th}>Aquisitivo</th><th className={tb.th}>Concessivo até</th><th className={tb.th}>Faltas</th>
                  <th className={tb.th}>Direito</th><th className={tb.th}>Saldo</th><th className={tb.th}>Situação</th>
                </tr>
              </thead>
              <tbody className={tb.corpo}>
                {[...periodos].reverse().map((p) => {
                  const mesesP = mesesDoPeriodo(p.periodo);
                  const cobertos = mesesP.filter((m) => meses.has(m) && m <= hoje.slice(0, 7)).length;
                  const decorridos = mesesP.filter((m) => m <= hoje.slice(0, 7)).length;
                  return (
                    <tr key={p.periodo.inicio} className={tb.linha}>
                      <td className={cx(tb.td, 'whitespace-nowrap tabular-nums')}>{br(p.periodo.inicio)} a {br(p.periodo.fim)}</td>
                      <td className={cx(tb.td, 'tabular-nums')}>{br(p.periodo.concessivoFim)}</td>
                      <td className={tb.td}>
                        <span className="tabular-nums">{p.faltas}</span>
                        <span className="block text-xs text-tinta-suave" data-dica="Meses do período com algum dia lançado no ponto. Sem ponto, faltas não são vistas.">
                          ponto em {cobertos} de {decorridos} meses
                        </span>
                      </td>
                      <td className={cx(tb.td, 'tabular-nums')}>{p.direito} dias</td>
                      <td className={cx(tb.td, 'tabular-nums')}>{p.saldo} dias</td>
                      <td className={tb.td}><Selo tom={TOM_ESTADO[p.estado]}>{ROTULO_ESTADO[p.estado]}</Selo></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-tinta-suave">
          Art. 130: até {FAIXAS_ART130[0].ate} faltas → 30 dias · até 14 → 24 · até 23 → 18 · até 32 → 12 · mais de 32 → perde o período.
          Faltas justificadas (atestado, art. 473) não contam.
        </p>

        <h3 className="mt-5 text-[13px] font-semibold text-tinta">Férias programadas</h3>
        {programadas.length === 0 ? (
          <EstadoVazio moldura={false} titulo="Nenhuma férias programada" descricao={podeProgramar ? 'Use “Programar férias” no topo da ficha.' : undefined} />
        ) : (
          <div className={cx(tb.moldura, 'mt-2')}>
            <table className={tb.tabela}>
              <thead className={tb.cabeca}>
                <tr>
                  <th className={tb.th}>Gozo</th><th className={tb.th}>Dias</th><th className={tb.th}>Retorno</th>
                  <th className={tb.th}>Pagamento</th><th className={tb.th}>Período</th><th className={tb.th}><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className={tb.corpo}>
                {programadas.map((f) => (
                  <tr key={f.id} className={tb.linha}>
                    <td className={cx(tb.td, 'whitespace-nowrap tabular-nums')}>{br(f.inicio)} a {br(fimDoGozo(f))}</td>
                    <td className={cx(tb.td, 'tabular-nums')}>{f.dias}{f.abonoDias ? ` + ${f.abonoDias} abono` : ''}</td>
                    <td className={cx(tb.td, 'tabular-nums')}>{br(retornoDoGozo(f))}</td>
                    <td className={cx(tb.td, 'tabular-nums')}>{br(f.pagamentoEm) || '—'}</td>
                    <td className={cx(tb.td, 'tabular-nums text-tinta-suave')}>{br(f.aquisitivoInicio)}</td>
                    <td className={cx(tb.td, 'text-right')}>
                      <div className="flex justify-end gap-1">
                        <a href={urlDoc(f, 'aviso')} className={botaoCls({ variante: 'fantasma', tamanho: 'sm' })} data-dica="Aviso de férias (PDF)">
                          <IconeBaixar size={14} /> Aviso
                        </a>
                        <a href={urlDoc(f, 'recibo')} className={botaoCls({ variante: 'fantasma', tamanho: 'sm' })} data-dica="Recibo de férias (PDF, valores em branco)">
                          <IconeBaixar size={14} /> Recibo
                        </a>
                        <BotaoIcone rotulo="Excluir férias" tom="perigo" onClick={() => setExcluindo(f)}><IconeExcluir size={16} /></BotaoIcone>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>

      <Secao titulo={`13º salário de ${ano}`} descricao="Conferência de avos: 1/12 por mês com 15 dias ou mais de trabalho (Lei 4.090/62). Sem valores nesta etapa.">
        {!entraNoDecimo(e, ano) ? (
          <EstadoVazio moldura={false} titulo={e.situacao === 'desligado' ? 'Desligado: o 13º proporcional vai na rescisão' : 'Sem admissão cadastrada'} />
        ) : avos && (
          <>
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
              {avos.meses.map((m) => (
                <div key={m.mes} className={cx('rounded-md border px-1 py-1.5 text-center text-xs',
                  m.conta ? (m.projetado ? 'border-primaria-borda bg-primaria-suave text-primaria-texto' : 'border-sucesso-borda bg-sucesso-suave text-sucesso') : 'border-borda bg-superficie-suave text-tinta-fraca')}
                  data-dica={`${m.diasContrato} dia(s) de contrato${m.faltas ? `, ${m.faltas} falta(s)` : ''}${m.projetado ? ' — previsão' : ''}`}>
                  <span className="block font-medium uppercase">{MESES_CURTOS[m.mes - 1]}</span>
                  <span className="block">{m.conta ? '1/12' : '—'}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm text-tinta">
              <strong>{avos.avos}/12</strong> até agora · <strong>{avos.previstos}/12</strong> previstos até dezembro.
            </p>
            <p className="mt-1 text-[13px] text-tinta-suave">
              1ª parcela até <strong className="text-tinta">{br(prazos.primeira)}</strong> · 2ª parcela até <strong className="text-tinta">{br(prazos.segunda)}</strong> (antecipados para dia útil, Lei 4.749/65).
            </p>
            {aviso13 && <Aviso tom="aviso" className="mt-3">{aviso13}</Aviso>}
          </>
        )}
      </Secao>

      {editando && <FormEmpregado empregado={e} empresaNome={d.empresa.nome} onSalvar={salvar} onCancelar={() => setEditando(false)} />}
      {simulando && (
        <SimularRescisao empregado={e} empresa={{ nome: d.empresa.nome, cnpj: d.empresa.cnpj ?? null }} ferias={d.ferias} faltas={d.faltas}
          feriados={d.feriados} hoje={hoje} onBaixou={(m) => setMsg(m)} onFechar={() => setSimulando(false)} />
      )}
      {programando && (
        <ProgramarFerias empregado={e} periodos={periodos} todas={d.ferias} feriados={feriados} hoje={hoje}
          onProgramar={programar} onCancelar={() => setProgramando(false)} />
      )}
      {excluindo && (
        <DialogoConfirmacao titulo="Excluir estas férias?"
          mensagem={`As férias de ${br(excluindo.inicio)} a ${br(fimDoGozo(excluindo))} de ${e.nome} saem da programação e voltam para o saldo. Dá para desfazer em seguida.`}
          onConfirmar={() => excluir(excluindo)} onCancelar={() => setExcluindo(null)} />
      )}
    </div>
  );
}
