'use client';

// Agenda de obrigações — visão geral: o que está atrasado e vence esta semana
// (com "marcar feita" e desfazer) e o calendário do mês. As ocorrências são
// geradas aqui mesmo, com lib/agenda.ts, a partir das regras cadastradas.
// Ver docs/agenda.md.
import { useMemo, useState } from 'react';
import {
  br, Calendario, chaveConclusao, hojeBelem, JANELA_PADRAO, Obrigacao, Ocorrencia, ocorrenciasDe,
  rotuloCompetencia, situacao, Situacao, somarDias,
} from '@/lib/agenda';
import { chaveData, diasNoMes, diaSemana, MESES } from '@/lib/calendario';
import {
  Aviso, Botao, BotaoIcone, botaoCls, CabecalhoPagina, Carregando, Conteudo, cx, EstadoVazio, Indicador, Secao, Selo, tb, Tom,
} from '@/components/ui';
import { Selecao } from '@/components/selecao';
import { Toast, Toasts } from '@/components/retorno';
import { rotuloDias } from '@/lib/painel';
import { IconeCheck } from '../icones';
import { AbasAgenda, AVISO_MIGRACAO, useAgenda } from './comum';

const ROTULO: Record<Situacao, string> = {
  feita: 'Feita', atrasada: 'Atrasada', hoje: 'Vence hoje', proxima: 'Em breve', futura: 'No prazo',
};
const TOM: Record<Situacao, Tom> = { feita: 'sucesso', atrasada: 'perigo', hoje: 'aviso', proxima: 'primaria', futura: 'neutro' };
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const ATRASO_MAX_DIAS = 365;

interface Linha extends Ocorrencia { obrigacao: Obrigacao; situacao: Situacao; feitaPor?: string }

function Seta({ dir }: { dir: 'esq' | 'dir' }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={dir === 'esq' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
    </svg>
  );
}

export default function AgendaPage() {
  const ag = useAgenda();
  const hoje = hojeBelem();
  const [empresa, setEmpresa] = useState('');
  const [[ano, mes], setMes] = useState<[number, number]>(() => [Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))]);
  const [msg, setMsg] = useState<string | null>(null);
  const [desfazer, setDesfazer] = useState<{ obrigacaoId: string; competencia: string; feita: boolean; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cal = useMemo(() => new Calendario(), []);
  const obrigacoes = useMemo(
    () => ag.obrigacoes.filter((o) => !empresa || o.empresaId === empresa),
    [ag.obrigacoes, empresa],
  );
  const porId = useMemo(() => new Map(ag.obrigacoes.map((o) => [o.id, o])), [ag.obrigacoes]);

  const enriquecer = (oc: Ocorrencia): Linha => {
    const o = porId.get(oc.obrigacaoId)!;
    const c = ag.feitas.get(chaveConclusao(oc.obrigacaoId, oc.competencia));
    return { ...oc, obrigacao: o, situacao: situacao(oc, hoje, Boolean(c), o.avisoDias), feitaPor: c?.feitaPor };
  };

  // Atrasadas + vence hoje + próximos dias (cada obrigação com a sua antecedência).
  const atencao = useMemo(() => {
    const maior = Math.max(JANELA_PADRAO, ...obrigacoes.map((o) => o.avisoDias));
    return ocorrenciasDe(obrigacoes, somarDias(hoje, -ATRASO_MAX_DIAS), somarDias(hoje, maior), cal)
      .map(enriquecer)
      .filter((l) => l.situacao === 'atrasada' || l.situacao === 'hoje' || l.situacao === 'proxima');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `enriquecer` depende só do que já está aqui
  }, [obrigacoes, ag.feitas, hoje, cal, porId]);

  const doMes = useMemo(() => {
    const de = chaveData(ano, mes, 1);
    const ate = chaveData(ano, mes, diasNoMes(ano, mes));
    const porDia = new Map<string, Linha[]>();
    for (const oc of ocorrenciasDe(obrigacoes, de, ate, cal)) {
      const l = enriquecer(oc);
      porDia.set(l.vencimento, [...(porDia.get(l.vencimento) ?? []), l]);
    }
    return porDia;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idem
  }, [obrigacoes, ag.feitas, ano, mes, hoje, cal, porId]);

  const contratosVisiveis = useMemo(() => ag.contratos.filter((c) => !empresa || c.empresaId === empresa), [ag.contratos, empresa]);
  const dpVisiveis = useMemo(() => ag.dp.filter((c) => !empresa || c.empresaId === empresa), [ag.dp, empresa]);
  const conta = (s: Situacao) => atencao.filter((l) => l.situacao === s).length;
  const nomeEmp = (id: string) => ag.nomeEmpresa.get(id) ?? 'Empresa';
  const rotuloLinha = (l: Linha) => `${l.obrigacao.nome} ${rotuloCompetencia(l.competencia)} · ${nomeEmp(l.empresaId)}`;

  async function alternar(l: Linha, feita: boolean) {
    const chave = chaveConclusao(l.obrigacaoId, l.competencia);
    setOcupado(chave); ag.setErro(null); setMsg(null);
    const erro = await ag.alternarFeita(l.obrigacaoId, l.competencia, feita);
    setOcupado(null);
    if (erro) { ag.setErro(erro); return; }
    setDesfazer({ obrigacaoId: l.obrigacaoId, competencia: l.competencia, feita, texto: `${rotuloLinha(l)} ${feita ? 'marcada como feita' : 'voltou para pendente'}.` });
  }

  async function desfazerUltima() {
    if (!desfazer) return;
    const { obrigacaoId, competencia, feita } = desfazer;
    setDesfazer(null);
    const erro = await ag.alternarFeita(obrigacaoId, competencia, !feita);
    if (erro) ag.setErro(erro); else setMsg('Desfeito.');
  }

  function mudarMes(delta: number) {
    setMes(([a, m]) => {
      const t = a * 12 + (m - 1) + delta;
      return [Math.floor(t / 12), (t % 12) + 1];
    });
  }

  const opcoesEmpresa = [{ valor: '', rotulo: 'Todas as empresas' }, ...ag.empresas.map((e) => ({ valor: e.id, rotulo: e.nome }))];
  const semNada = !ag.carregando && !ag.semTabela && ag.obrigacoes.length === 0;
  const primeiroDia = diaSemana(ano, mes, 1);
  const totalDias = diasNoMes(ano, mes);
  const diasComItens = [...doMes.keys()].sort();

  return (
    <div className="text-sm">
      <CabecalhoPagina
        titulo="Agenda de obrigações"
        subtitulo="O que vence para cada empresa-cliente — e o que já foi feito."
        acoes={<>
          <Selecao aria-label="Empresa" largura="w-64" valor={empresa} onChange={setEmpresa} opcoes={opcoesEmpresa} />
          <a href="/agenda/obrigacoes" className={botaoCls({ variante: 'primaria' })}>Cadastrar obrigações</a>
        </>}
        abas={<AbasAgenda ativa="visao" />}
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

      <Conteudo>
        {ag.semTabela && <Aviso tom="aviso" titulo="Agenda aguardando o banco">{AVISO_MIGRACAO}</Aviso>}
        {ag.carregando && <Carregando />}

        {semNada && (
          <EstadoVazio
            titulo="Nenhuma obrigação cadastrada ainda"
            descricao="Escolha uma empresa e aplique o modelo do regime dela (MEI, Simples, Presumido…) — leva um clique. Depois ajuste o que for diferente."
            acao={<a href="/agenda/obrigacoes" className={botaoCls({ variante: 'tonal' })}>Ir para Obrigações por empresa</a>}
          />
        )}

        {!ag.carregando && contratosVisiveis.length > 0 && (
          <Secao titulo="Contratos de experiência"
            descricao="Fim do 1º período e da prorrogação, tirados dos contratos salvos em Contratos — nada para cadastrar aqui. Vencido sem providência vira prazo indeterminado: marque efetivado ou encerrado lá.">
            <div className={tb.moldura}>
              <table className={tb.tabela}>
                <thead className={tb.cabeca}>
                  <tr><th className={tb.th}>Vencimento</th><th className={tb.th}>Empresa</th><th className={tb.th}>Contrato</th><th className={tb.th}>Situação</th></tr>
                </thead>
                <tbody className={tb.corpo}>
                  {contratosVisiveis.map((c) => (
                    <tr key={c.id} className={tb.linha}>
                      <td className={cx(tb.td, 'whitespace-nowrap tabular-nums')}>{br(c.vencimento)}</td>
                      <td className={tb.td}>{nomeEmp(c.empresaId)}</td>
                      <td className={tb.td}>{c.obrigacao}</td>
                      <td className={tb.td}><Selo tom={c.dias < 0 ? 'perigo' : c.dias === 0 ? 'aviso' : 'primaria'}>{rotuloDias(c.dias)}</Selo></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3"><a href="/contratos" className={botaoCls({ variante: 'secundaria', tamanho: 'sm' })}>Abrir contratos</a></p>
          </Secao>
        )}

        {!ag.carregando && dpVisiveis.length > 0 && (
          <Secao titulo="Departamento pessoal"
            descricao="Férias vencidas e vencendo, marcos das férias programadas e os prazos do 13º, tirados do cadastro dos empregados — nada para cadastrar aqui.">
            <div className={tb.moldura}>
              <table className={tb.tabela}>
                <thead className={tb.cabeca}>
                  <tr><th className={tb.th}>Prazo</th><th className={tb.th}>Empresa</th><th className={tb.th}>O que fazer</th><th className={tb.th}>Situação</th></tr>
                </thead>
                <tbody className={tb.corpo}>
                  {dpVisiveis.map((c) => (
                    <tr key={c.id} className={tb.linha}>
                      <td className={cx(tb.td, 'whitespace-nowrap tabular-nums')}>{br(c.vencimento)}</td>
                      <td className={tb.td}>{nomeEmp(c.empresaId)}</td>
                      <td className={tb.td}>{c.obrigacao}</td>
                      <td className={tb.td}><Selo tom={c.tipo === 'ferias_vencida' || c.dias < 0 ? 'perigo' : c.dias <= 7 ? 'aviso' : 'primaria'}>{c.tipo === 'ferias_vencida' ? 'Vencidas' : rotuloDias(c.dias)}</Selo></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3"><a href={empresa ? `/dp?empresa=${encodeURIComponent(empresa)}` : '/dp'} className={botaoCls({ variante: 'secundaria', tamanho: 'sm' })}>Abrir Departamento Pessoal</a></p>
          </Secao>
        )}

        {!ag.carregando && ag.obrigacoes.length > 0 && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Indicador rotulo="Atrasadas" valor={conta('atrasada')} tom={conta('atrasada') ? 'perigo' : 'neutro'} destaque={conta('atrasada') > 0} />
              <Indicador rotulo="Vencem hoje" valor={conta('hoje')} />
              <Indicador rotulo="Em breve" valor={conta('proxima')} />
            </div>

            <Secao titulo="Precisa de atenção" descricao={`Atrasadas, vencendo hoje e nos próximos ${JANELA_PADRAO} dias (ou na antecedência própria, como certificado digital).`}>
              {atencao.length === 0 ? (
                <EstadoVazio moldura={false} titulo="Tudo em dia" descricao="Nada atrasado nem vencendo nos próximos dias." />
              ) : (
                <div className={tb.moldura}>
                  <table className={tb.tabela}>
                    <thead className={tb.cabeca}>
                      <tr>
                        <th className={tb.th}>Vencimento</th><th className={tb.th}>Empresa</th><th className={tb.th}>Obrigação</th>
                        <th className={tb.th}>Responsável</th><th className={tb.th}>Situação</th><th className={tb.th}><span className="sr-only">Ação</span></th>
                      </tr>
                    </thead>
                    <tbody className={tb.corpo}>
                      {atencao.map((l) => {
                        const chave = chaveConclusao(l.obrigacaoId, l.competencia);
                        return (
                          <tr key={chave} className={tb.linha}>
                            <td className={cx(tb.td, 'whitespace-nowrap tabular-nums')}>{br(l.vencimento)}</td>
                            <td className={tb.td}>{nomeEmp(l.empresaId)}</td>
                            <td className={tb.td}>
                              <span className="font-medium text-tinta">{l.obrigacao.nome}</span>
                              <span className="ml-1.5 text-tinta-suave">{rotuloCompetencia(l.competencia)}</span>
                            </td>
                            <td className={cx(tb.td, 'text-tinta-suave')}>{l.obrigacao.responsavel ? (ag.nomeMembro.get(l.obrigacao.responsavel) ?? l.obrigacao.responsavel) : '—'}</td>
                            <td className={tb.td}><Selo tom={TOM[l.situacao]}>{ROTULO[l.situacao]}</Selo></td>
                            <td className={cx(tb.td, 'text-right')}>
                              <Botao tamanho="sm" variante="sucesso" icone={<IconeCheck size={14} />}
                                carregando={ocupado === chave} disabled={!!ocupado} onClick={() => alternar(l, true)}>
                                Marcar feita
                              </Botao>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Secao>

            <Secao titulo={`${MESES[mes].charAt(0)}${MESES[mes].slice(1).toLowerCase()} de ${ano}`}
              descricao="Vencimentos do mês já ajustados a dia útil (feriados nacionais, Carnaval e Corpus Christi). Clique num item para marcar ou desmarcar."
              acoes={<div className="flex items-center gap-1">
                <BotaoIcone rotulo="Mês anterior" onClick={() => mudarMes(-1)}><Seta dir="esq" /></BotaoIcone>
                <Botao tamanho="sm" variante="fantasma" onClick={() => setMes([Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))])}>Hoje</Botao>
                <BotaoIcone rotulo="Próximo mês" onClick={() => mudarMes(1)}><Seta dir="dir" /></BotaoIcone>
              </div>}>

              {/* Desktop: grade do mês */}
              <div className="hidden md:block">
                <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-borda bg-borda">
                  {SEMANA.map((d) => (
                    <div key={d} className="bg-superficie-suave px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-tinta-suave">{d}</div>
                  ))}
                  {Array.from({ length: primeiroDia }, (_, i) => <div key={`v${i}`} className="bg-superficie-suave/60" />)}
                  {Array.from({ length: totalDias }, (_, i) => {
                    const iso = chaveData(ano, mes, i + 1);
                    const itens = doMes.get(iso) ?? [];
                    const util = cal.util(iso);
                    return (
                      <div key={iso} className={cx('min-h-24 p-1.5', util ? 'bg-superficie' : 'bg-superficie-suave')}>
                        <div className={cx('mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums',
                          iso === hoje ? 'bg-primaria font-semibold text-sobre-primaria' : util ? 'text-tinta-suave' : 'text-tinta-fraca')}>
                          {i + 1}
                        </div>
                        <ul className="space-y-1">
                          {itens.map((l) => <ItemDia key={chaveConclusao(l.obrigacaoId, l.competencia)} l={l} empresa={nomeEmp(l.empresaId)}
                            ocupado={ocupado === chaveConclusao(l.obrigacaoId, l.competencia)} onAlternar={() => alternar(l, l.situacao !== 'feita')} />)}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Celular: lista por dia */}
              <div className="md:hidden">
                {diasComItens.length === 0 ? (
                  <EstadoVazio moldura={false} titulo="Nada vence neste mês" />
                ) : (
                  <ol className="space-y-4">
                    {diasComItens.map((iso) => (
                      <li key={iso}>
                        <h3 className={cx('mb-1.5 text-[13px] font-semibold', iso === hoje ? 'text-primaria-texto' : 'text-tinta')}>
                          {br(iso)} · {SEMANA[diaSemana(ano, mes, Number(iso.slice(8)))]}
                        </h3>
                        <ul className="space-y-1.5">
                          {doMes.get(iso)!.map((l) => <ItemDia key={chaveConclusao(l.obrigacaoId, l.competencia)} l={l} empresa={nomeEmp(l.empresaId)}
                            ocupado={ocupado === chaveConclusao(l.obrigacaoId, l.competencia)} onAlternar={() => alternar(l, l.situacao !== 'feita')} />)}
                        </ul>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </Secao>
          </>
        )}
      </Conteudo>
    </div>
  );
}

const ITEM_TOM: Record<Situacao, string> = {
  feita: 'bg-sucesso-suave text-sucesso ring-sucesso-borda',
  atrasada: 'bg-perigo-suave text-perigo ring-perigo-borda',
  hoje: 'bg-aviso-suave text-aviso ring-aviso-borda',
  proxima: 'bg-primaria-suave text-primaria-texto ring-primaria-borda',
  futura: 'bg-superficie-realce text-tinta-suave ring-borda',
};

function ItemDia({ l, empresa, ocupado, onAlternar }: { l: Linha; empresa: string; ocupado: boolean; onAlternar: () => void }) {
  const feita = l.situacao === 'feita';
  return (
    <li>
      <button type="button" onClick={onAlternar} disabled={ocupado} aria-pressed={feita}
        aria-label={`${l.obrigacao.nome} ${rotuloCompetencia(l.competencia)}, ${empresa}: ${ROTULO[l.situacao]}. ${feita ? 'Desmarcar' : 'Marcar como feita'}.`}
        data-dica={feita ? `Feita${l.feitaPor ? ` por ${l.feitaPor}` : ''} — clique para desmarcar` : 'Marcar como feita'}
        className={cx('flex w-full items-start gap-1 rounded-md px-1.5 py-1 text-left text-xs leading-tight ring-1 ring-inset transition-opacity hover:opacity-80 disabled:opacity-50', ITEM_TOM[l.situacao])}>
        {feita && <IconeCheck size={12} className="mt-px shrink-0" />}
        <span className="min-w-0">
          <span className={cx('block truncate font-medium', feita && 'line-through')}>{l.obrigacao.nome}</span>
          <span className="block truncate opacity-80">{empresa}</span>
        </span>
      </button>
    </li>
  );
}
