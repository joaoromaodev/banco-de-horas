'use client';

// Agenda — cadastro das obrigações de cada empresa (a regra de vencimento),
// modelo padrão por regime e preferência do aviso por e-mail. Ver docs/agenda.md.
import { useEffect, useId, useMemo, useState } from 'react';
import {
  AjusteDia, br, Calendario, CATALOGO, descreverRegra, Frequencia, hojeBelem, ModoDia, MODELOS, NovaObrigacao,
  Obrigacao, obrigacaoDoTipo, ocorrencias, Recorrencia, Regime, rotuloCompetencia, somarDias, TIPO_POR_CODIGO,
  validarObrigacao,
} from '@/lib/agenda';
import { MESES } from '@/lib/calendario';
import {
  Alternador, AreaTexto, Aviso, Botao, BotaoIcone, CabecalhoPagina, Carregando, Conteudo, cx, Entrada, EstadoVazio,
  Marcacao, Secao, Selo, tb,
} from '@/components/ui';
import { Selecao } from '@/components/selecao';
import { Toast, Toasts } from '@/components/retorno';
import { DialogoConfirmacao, Modal } from '../../Dialogo';
import { IconeExcluir, IconeLapis, IconeMais } from '../../icones';
import { AbasAgenda, AVISO_MIGRACAO, Membro, useAgenda } from '../comum';
import PropostaAgenda from '../PropostaAgenda';

const RECORRENCIA: { valor: Recorrencia; rotulo: string }[] = [
  { valor: 'mensal', rotulo: 'Mensal' }, { valor: 'trimestral', rotulo: 'Trimestral' },
  { valor: 'anual', rotulo: 'Anual' }, { valor: 'unica', rotulo: 'Uma vez (data marcada)' },
];
const MODO: { valor: ModoDia; rotulo: string }[] = [
  { valor: 'dia_fixo', rotulo: 'Dia fixo do mês' }, { valor: 'n_dia_util', rotulo: 'N-ésimo dia útil' },
  { valor: 'ultimo_dia_util', rotulo: 'Último dia útil' },
];
const AJUSTE: { valor: AjusteDia; rotulo: string }[] = [
  { valor: 'antecipa', rotulo: 'Antecipa para o dia útil anterior' },
  { valor: 'prorroga', rotulo: 'Prorroga para o próximo dia útil' },
  { valor: 'nenhum', rotulo: 'Mantém a data' },
];
const FREQ: { valor: Frequencia; rotulo: string; detalhe: string }[] = [
  { valor: 'semanal', rotulo: 'Semanal', detalhe: 'toda segunda' },
  { valor: 'diario', rotulo: 'Diário', detalhe: 'dias úteis' },
  { valor: 'desligado', rotulo: 'Desligado', detalhe: '' },
];
const nomeMes = (m: number) => MESES[m].charAt(0) + MESES[m].slice(1).toLowerCase();

interface ConfigAviso { frequencia: Frequencia; destinatarios: string[] }

export default function ObrigacoesPage() {
  const ag = useAgenda();
  const hoje = hojeBelem();
  const [empresa, setEmpresa] = useState('');
  const [regime, setRegime] = useState<Regime>('simples');
  const [msg, setMsg] = useState<string | null>(null);
  const [desfazer, setDesfazer] = useState<{ ids: string[]; texto: string; acao: 'restaurar' | 'excluir' } | null>(null);
  const [excluindo, setExcluindo] = useState<Obrigacao | null>(null);
  const [editando, setEditando] = useState<{ id: string | null; dados: NovaObrigacao } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  // Empresa escolhida: a última usada (se ainda existir) ou a primeira.
  useEffect(() => {
    if (empresa || !ag.empresas.length) return;
    let salva = '';
    try { salva = localStorage.getItem('agenda.empresa') ?? ''; } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- escolha inicial depois da carga
    setEmpresa(ag.empresas.some((e) => e.id === salva) ? salva : ag.empresas[0].id);
  }, [ag.empresas, empresa]);

  function trocarEmpresa(id: string) {
    setEmpresa(id);
    try { localStorage.setItem('agenda.empresa', id); } catch {}
  }

  const cal = useMemo(() => new Calendario(), []);
  const daEmpresa = useMemo(() => ag.obrigacoes.filter((o) => o.empresaId === empresa), [ag.obrigacoes, empresa]);
  const proximo = (o: Obrigacao) => ocorrencias(o, hoje, somarDias(hoje, 800), cal)[0];
  const nomeEmpresa = ag.nomeEmpresa.get(empresa) ?? '';
  const modelo = MODELOS.find((m) => m.regime === regime)!;
  const tiposJa = new Set(daEmpresa.map((o) => o.tipo));
  const novasDoModelo = modelo.tipos.filter((t) => !tiposJa.has(t) && TIPO_POR_CODIGO.get(t)?.padrao.recorrencia !== 'unica');

  async function aplicarModelo(regimeAplicado: Regime = regime) {
    setOcupado('modelo'); ag.setErro(null); setMsg(null);
    const modeloAplicado = MODELOS.find((m) => m.regime === regimeAplicado)!;
    try {
      const r = await fetch('/api/agenda/modelo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ empresa, regime: regimeAplicado }),
      });
      const x = await r.json();
      if (!r.ok) throw new Error(x.erro);
      const criadas: Obrigacao[] = x.obrigacoes ?? [];
      ag.setObrigacoes((l) => [...l, ...criadas]);
      if (criadas.length) {
        setDesfazer({ ids: criadas.map((o) => o.id), acao: 'excluir', texto: `${criadas.length} obrigaç${criadas.length > 1 ? 'ões criadas' : 'ão criada'} pelo modelo ${modeloAplicado.nome}.` });
      } else {
        setMsg('A empresa já tem todas as obrigações deste modelo.');
      }
    } catch (e) { ag.setErro(e instanceof Error ? e.message : 'Falha ao aplicar o modelo.'); }
    finally { setOcupado(null); }
  }

  async function excluir(ids: string[]) {
    const r = await fetch(`/api/agenda?${ids.map((id) => `id=${encodeURIComponent(id)}`).join('&')}`, { method: 'DELETE' });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(x.erro ?? 'Falha ao excluir.');
    ag.setObrigacoes((l) => l.filter((o) => !ids.includes(o.id)));
  }

  async function confirmarExclusao() {
    const o = excluindo!;
    setExcluindo(null); ag.setErro(null); setMsg(null);
    try {
      await excluir([o.id]);
      setDesfazer({ ids: [o.id], acao: 'restaurar', texto: `“${o.nome}” saiu da agenda.` });
    } catch (e) { ag.setErro(e instanceof Error ? e.message : 'Falha ao excluir.'); }
  }

  async function desfazerUltima() {
    if (!desfazer) return;
    const d = desfazer;
    setDesfazer(null);
    try {
      if (d.acao === 'excluir') {
        await excluir(d.ids);
      } else {
        const r = await fetch('/api/agenda', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: d.ids, restaurar: true }),
        });
        const x = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(x.erro ?? 'Falha ao desfazer.');
        await ag.recarregar();
      }
      setMsg('Desfeito.');
    } catch (e) { ag.setErro(e instanceof Error ? e.message : 'Falha ao desfazer.'); }
  }

  function nova() {
    setEditando({ id: null, dados: obrigacaoDoTipo('das', empresa, hoje)! });
  }

  function aoSalvar(o: Obrigacao, nova: boolean) {
    ag.setObrigacoes((l) => (nova ? [...l, o] : l.map((x) => (x.id === o.id ? o : x))));
    setEditando(null);
    setMsg(nova ? `“${o.nome}” entrou na agenda.` : 'Alterações salvas.');
  }

  return (
    <div className="text-sm">
      <CabecalhoPagina
        titulo="Obrigações por empresa"
        subtitulo="A regra de vencimento de cada obrigação. A agenda calcula as datas sozinha, já em dia útil."
        acoes={<>
          <Selecao aria-label="Empresa" largura="w-64" valor={empresa} onChange={trocarEmpresa} placeholder="Escolha a empresa"
            opcoes={ag.empresas.map((e) => ({ valor: e.id, rotulo: e.nome }))} />
          <Botao variante="primaria" icone={<IconeMais />} onClick={nova} disabled={!empresa || ag.semTabela}>Nova obrigação</Botao>
        </>}
        abas={<AbasAgenda ativa="obrigacoes" />}
      />
      <Toasts>
        {ag.erro && <Toast tom="perigo" onFechar={() => ag.setErro(null)}>{ag.erro}</Toast>}
        {msg && <Toast onFechar={() => setMsg(null)}>{msg}</Toast>}
        {desfazer && (
          <Toast tom="info" onFechar={() => setDesfazer(null)}
            acao={<Botao tamanho="sm" variante="tonal" onClick={desfazerUltima}>Desfazer</Botao>}>
            {desfazer.texto}
          </Toast>
        )}
      </Toasts>

      <Conteudo largura="media">
        {ag.semTabela && <Aviso tom="aviso" titulo="Agenda aguardando o banco">{AVISO_MIGRACAO}</Aviso>}
        {ag.carregando && <Carregando />}
        {!ag.carregando && !ag.empresas.length && (
          <EstadoVazio titulo="Nenhuma empresa cadastrada" descricao="Cadastre as empresas-clientes na tela Cadastro para montar a agenda delas." />
        )}

        {!ag.carregando && empresa && (
          <>
            {!ag.semTabela && (
              <PropostaAgenda empresa={empresa} nomeEmpresa={nomeEmpresa} versao={ag.obrigacoes.length}
                ocupado={ocupado === 'modelo'} desabilitado={!!ocupado} onAplicar={(m) => aplicarModelo(m)} />
            )}
            <Secao titulo="Modelo padrão por regime"
              descricao="Cria de uma vez as obrigações típicas do regime, com os prazos de 2026. Só entra o que a empresa ainda não tem; depois é só ajustar.">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <Selecao rotulo="Regime da empresa" classeCampo="sm:w-80" valor={regime} onChange={(v) => setRegime(v as Regime)}
                  opcoes={MODELOS.map((m) => ({ valor: m.regime, rotulo: m.nome }))} />
                <Botao variante="tonal" onClick={() => aplicarModelo()} carregando={ocupado === 'modelo'}
                  disabled={!!ocupado || ag.semTabela || novasDoModelo.length === 0}>
                  {novasDoModelo.length ? `Aplicar em ${nomeEmpresa || 'esta empresa'} (${novasDoModelo.length})` : 'Já aplicado'}
                </Botao>
              </div>
              <p className="mt-2 text-[13px] text-tinta-suave">{modelo.descricao} Certificado digital fica de fora: cadastre com a data de validade.</p>
            </Secao>

            <Secao titulo={`Obrigações de ${nomeEmpresa}`} descricao={daEmpresa.length ? undefined : 'Nenhuma obrigação ainda. Aplique um modelo ou cadastre uma a uma.'}>
              {daEmpresa.length > 0 && (
                <div className={tb.moldura}>
                  <table className={tb.tabela}>
                    <thead className={tb.cabeca}>
                      <tr>
                        <th className={tb.th}>Obrigação</th><th className={tb.th}>Vencimento</th><th className={tb.th}>Próximo</th>
                        <th className={tb.th}>Responsável</th><th className={tb.th}><span className="sr-only">Ações</span></th>
                      </tr>
                    </thead>
                    <tbody className={tb.corpo}>
                      {daEmpresa.map((o) => {
                        const p = proximo(o);
                        return (
                          <tr key={o.id} className={tb.linha}>
                            <td className={tb.td}>
                              <span className="font-medium text-tinta">{o.nome}</span>
                              {!o.ativa && <Selo className="ml-2">pausada</Selo>}
                            </td>
                            <td className={cx(tb.td, 'text-tinta-suave')}>{descreverRegra(o)}</td>
                            <td className={cx(tb.td, 'whitespace-nowrap tabular-nums')}>
                              {p ? <>{br(p.vencimento)} <span className="text-tinta-fraca">· {rotuloCompetencia(p.competencia)}</span></> : <span className="text-tinta-fraca">—</span>}
                            </td>
                            <td className={cx(tb.td, 'text-tinta-suave')}>{o.responsavel ? (ag.nomeMembro.get(o.responsavel) ?? o.responsavel) : '—'}</td>
                            <td className={cx(tb.td, 'whitespace-nowrap text-right')}>
                              <BotaoIcone rotulo={`Editar ${o.nome}`} onClick={() => setEditando({ id: o.id, dados: o })}><IconeLapis /></BotaoIcone>
                              <BotaoIcone rotulo={`Excluir ${o.nome}`} tom="perigo" onClick={() => setExcluindo(o)}><IconeExcluir /></BotaoIcone>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Secao>
          </>
        )}

        {!ag.carregando && !ag.semTabela && <SecaoAviso equipe={ag.equipe} onErro={ag.setErro} onMsg={setMsg} />}
      </Conteudo>

      {editando && (
        <FormObrigacao inicial={editando.dados} id={editando.id} equipe={ag.equipe} empresa={nomeEmpresa}
          onCancelar={() => setEditando(null)} onSalvo={aoSalvar} />
      )}
      {excluindo && (
        <DialogoConfirmacao
          titulo="Excluir obrigação?"
          mensagem={<><strong>{excluindo.nome}</strong> sai da agenda de {nomeEmpresa}, com o histórico de feitas. Dá para desfazer logo em seguida.</>}
          onConfirmar={confirmarExclusao}
          onCancelar={() => setExcluindo(null)}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ formulário
function FormObrigacao({ inicial, id, equipe, empresa, onCancelar, onSalvo }: {
  inicial: NovaObrigacao; id: string | null; equipe: Membro[]; empresa: string;
  onCancelar: () => void; onSalvo: (o: Obrigacao, nova: boolean) => void;
}) {
  const titulo = useId();
  const [d, setD] = useState<NovaObrigacao>(inicial);
  const [erros, setErros] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const mudar = <K extends keyof NovaObrigacao>(k: K, v: NovaObrigacao[K]) => setD((a) => ({ ...a, [k]: v }));

  function trocarTipo(codigo: string) {
    const base = obrigacaoDoTipo(codigo, d.empresaId, d.inicio)!;
    setD((a) => ({ ...base, responsavel: a.responsavel, observacao: a.observacao, dataUnica: a.dataUnica }));
  }

  const tipo = TIPO_POR_CODIGO.get(d.tipo);
  const previa = useMemo(() => {
    const r = validarObrigacao(d);
    if (!r.ok) return [];
    return ocorrencias({ ...r.obrigacao, id: 'previa', ativa: true }, d.inicio, somarDias(d.inicio, 800), new Calendario()).slice(0, 4);
  }, [d]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const r = validarObrigacao(d);
    if (!r.ok) { setErros(r.erros); return; }
    setErros([]); setSalvando(true);
    try {
      const resp = await fetch('/api/agenda', {
        method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id ? { id, obrigacao: r.obrigacao } : { obrigacao: r.obrigacao }),
      });
      const x = await resp.json();
      if (!resp.ok) throw new Error(x.erro);
      onSalvo(x.obrigacao, !id);
    } catch (err) {
      setErros([err instanceof Error ? err.message : 'Falha ao salvar.']);
      setSalvando(false);
    }
  }

  const unica = d.recorrencia === 'unica';
  const defasagens = d.recorrencia === 'anual'
    ? [{ valor: '0', rotulo: 'No mesmo ano da competência' }, { valor: '1', rotulo: 'No ano seguinte' }]
    : d.recorrencia === 'trimestral'
      ? [{ valor: '0', rotulo: 'No último mês do trimestre' }, { valor: '1', rotulo: 'No mês seguinte ao trimestre' }, { valor: '2', rotulo: '2 meses depois do trimestre' }]
      : [{ valor: '0', rotulo: 'No próprio mês' }, { valor: '1', rotulo: 'No mês seguinte' }, { valor: '2', rotulo: '2 meses depois' }, { valor: '3', rotulo: '3 meses depois' }];

  return (
    <Modal onFechar={onCancelar} rotuladoPor={titulo} largura="max-w-2xl">
      <form onSubmit={salvar}>
        <div className="max-h-[70vh] overflow-y-auto p-5">
          <h2 id={titulo} className="text-base font-semibold text-tinta">{id ? 'Editar obrigação' : 'Nova obrigação'}</h2>
          <p className="mt-1 text-[13px] text-tinta-suave">{empresa}</p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Selecao rotulo="Tipo" valor={d.tipo} onChange={trocarTipo} dica={tipo?.dica}
              opcoes={CATALOGO.map((t) => ({ valor: t.codigo, rotulo: t.nome }))} />
            <Entrada rotulo="Nome na agenda" value={d.nome} maxLength={120} onChange={(e) => mudar('nome', e.target.value)} />
            <Selecao rotulo="Recorrência" valor={d.recorrencia} onChange={(v) => mudar('recorrencia', v as Recorrencia)} opcoes={RECORRENCIA} />

            {unica ? (
              <Entrada rotulo="Data do vencimento" type="date" value={d.dataUnica ?? ''} onChange={(e) => mudar('dataUnica', e.target.value)} />
            ) : (
              <Selecao rotulo="Como contar o dia" valor={d.modoDia} onChange={(v) => mudar('modoDia', v as ModoDia)} opcoes={MODO} />
            )}

            {!unica && d.modoDia !== 'ultimo_dia_util' && (
              <Entrada rotulo={d.modoDia === 'n_dia_util' ? 'Qual dia útil' : 'Dia do mês'} type="number" min={1} max={d.modoDia === 'n_dia_util' ? 23 : 31}
                value={d.dia || ''} onChange={(e) => mudar('dia', Number(e.target.value))}
                dica={d.modoDia === 'dia_fixo' ? 'Dia 31 vira o último dia em meses mais curtos.' : undefined} />
            )}
            {d.recorrencia === 'anual' && (
              <Selecao rotulo="Mês do vencimento" valor={String(d.mes ?? '')} onChange={(v) => mudar('mes', Number(v))}
                opcoes={Array.from({ length: 12 }, (_, i) => ({ valor: String(i + 1), rotulo: nomeMes(i + 1) }))} />
            )}
            {!unica && (
              <Selecao rotulo="Vence" valor={String(d.defasagem)} onChange={(v) => mudar('defasagem', Number(v))} opcoes={defasagens} />
            )}
            {(unica || d.modoDia === 'dia_fixo') && (
              <Selecao rotulo="Se cair em dia não útil" valor={d.ajuste} onChange={(v) => mudar('ajuste', v as AjusteDia)} opcoes={AJUSTE} />
            )}

            <Entrada rotulo="Avisar com antecedência (dias)" type="number" min={0} max={120} value={d.avisoDias}
              onChange={(e) => mudar('avisoDias', Number(e.target.value))} dica="0 = a janela padrão de 7 dias." />
            <Selecao rotulo="Responsável" valor={d.responsavel ?? ''} onChange={(v) => mudar('responsavel', v || null)}
              opcoes={[{ valor: '', rotulo: 'Ninguém em especial' }, ...equipe.map((m) => ({ valor: m.email, rotulo: m.nome, detalhe: m.email }))]} />
            <Entrada rotulo="Acompanhar a partir de" type="date" value={d.inicio} onChange={(e) => mudar('inicio', e.target.value)}
              dica="O que venceu antes desta data não aparece como atrasado." />
            <div className="flex items-end pb-2">
              <Alternador checked={d.ativa} onChange={(e) => mudar('ativa', e.target.checked)}>Ativa (gera vencimentos)</Alternador>
            </div>
            <AreaTexto rotulo="Observação" classeCampo="sm:col-span-2" rows={2} maxLength={500}
              value={d.observacao ?? ''} onChange={(e) => mudar('observacao', e.target.value)} />
          </div>

          <div className="mt-4 rounded-lg bg-superficie-suave px-3.5 py-3 text-[13px] ring-1 ring-inset ring-borda">
            <p className="font-medium text-tinta">Próximos vencimentos</p>
            {previa.length ? (
              <ul className="mt-1 space-y-0.5 text-tinta-suave">
                {previa.map((p) => <li key={p.competencia} className="tabular-nums">{br(p.vencimento)} <span className="text-tinta-fraca">· competência {rotuloCompetencia(p.competencia)}</span></li>)}
              </ul>
            ) : <p className="mt-1 text-tinta-fraca">Complete os campos para ver as datas.</p>}
          </div>

          {erros.length > 0 && <Aviso tom="perigo" className="mt-4">{erros.join(' ')}</Aviso>}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-borda bg-superficie-suave px-5 py-3 sm:flex-row sm:justify-end">
          <Botao onClick={onCancelar}>Cancelar</Botao>
          <Botao type="submit" variante="primaria" carregando={salvando}>{id ? 'Salvar alterações' : 'Adicionar à agenda'}</Botao>
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ aviso por e-mail
function SecaoAviso({ equipe, onErro, onMsg }: { equipe: Membro[]; onErro: (m: string | null) => void; onMsg: (m: string) => void }) {
  const [aviso, setAviso] = useState<ConfigAviso | null>(null);
  const [efetivos, setEfetivos] = useState<string[]>([]);
  const [podeEditar, setPodeEditar] = useState(false);
  const [provedor, setProvedor] = useState<'resend' | 'nenhum'>('nenhum');
  const [indisponivel, setIndisponivel] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    fetch('/api/agenda/avisos').then(async (r) => {
      const x = await r.json().catch(() => ({}));
      if (!r.ok) { setIndisponivel(true); return; }
      setAviso(x.aviso); setEfetivos(x.efetivos ?? []); setPodeEditar(Boolean(x.podeEditar)); setProvedor(x.provedor);
    }).catch(() => setIndisponivel(true));
  }, []);

  if (indisponivel || !aviso) return null;

  async function salvar() {
    setSalvando(true); onErro(null);
    try {
      const r = await fetch('/api/agenda/avisos', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(aviso) });
      const x = await r.json();
      if (!r.ok) throw new Error(x.erro);
      setAviso(x.aviso); setEfetivos(x.efetivos ?? []);
      onMsg('Aviso por e-mail atualizado.');
    } catch (e) { onErro(e instanceof Error ? e.message : 'Falha ao salvar.'); }
    finally { setSalvando(false); }
  }

  const nome = (email: string) => equipe.find((m) => m.email === email)?.nome ?? email;
  const alternar = (email: string, sim: boolean) =>
    setAviso((a) => a && ({ ...a, destinatarios: sim ? [...a.destinatarios, email] : a.destinatarios.filter((d) => d !== email) }));

  return (
    <Secao titulo="Avisos por e-mail"
      descricao="Um resumo do que está atrasado e do que vence, de todas as empresas do escritório. Sai de manhã cedo (por volta das 7h).">
      {provedor === 'nenhum' && (
        <Aviso tom="info" className="mb-4">O envio de e-mail ainda não foi ligado no servidor. Por enquanto os resumos ficam só registrados.</Aviso>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Selecao rotulo="Frequência" valor={aviso.frequencia} disabled={!podeEditar}
          onChange={(v) => setAviso({ ...aviso, frequencia: v as Frequencia })} opcoes={FREQ} />
        <fieldset disabled={!podeEditar}>
          <legend className="mb-1.5 text-[13px] font-medium text-tinta">Quem recebe</legend>
          <div className="space-y-1.5">
            {equipe.map((m) => (
              <Marcacao key={m.email} type="checkbox" checked={aviso.destinatarios.includes(m.email)}
                onChange={(e) => alternar(m.email, e.target.checked)}>
                {m.nome} <span className="text-tinta-fraca">{m.email}</span>
              </Marcacao>
            ))}
          </div>
          {!aviso.destinatarios.length && (
            <p className="mt-1.5 text-xs text-tinta-suave">Ninguém marcado: vai para {efetivos.length ? efetivos.map(nome).join(', ') : 'os administradores do escritório'}.</p>
          )}
        </fieldset>
      </div>
      {podeEditar ? (
        <div className="mt-5"><Botao variante="tonal" onClick={salvar} carregando={salvando}>Salvar aviso</Botao></div>
      ) : (
        <p className="mt-4 text-xs text-tinta-suave">Só o administrador do escritório altera o aviso.</p>
      )}
    </Secao>
  );
}
