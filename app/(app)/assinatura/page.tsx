'use client';

// Assinatura do escritório — plano, pagamento (fatura do Asaas: Pix, boleto ou
// cartão), troca de plano, cancelamento e histórico. Todos os contadores veem;
// só o administrador do escritório age. Regras em lib/cobranca.ts;
// decisões em docs/cobranca.md.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Aviso, Botao, botaoCls, CabecalhoPagina, Carregando, Conteudo, Entrada, EstadoVazio, Indicador, Secao, Selo, tb,
} from '@/components/ui';
import { Toast, Toasts } from '@/components/retorno';
import { DialogoConfirmacao } from '../Dialogo';
import {
  brl, calcularTroca, dataBR, hojeEm, preco, PLANOS, PLANOS_PAGOS,
  type Ciclo, type PlanoPago, type Situacao, type StatusAssinatura, type StatusPagamento,
} from '@/lib/cobranca';

interface Pagamento {
  id: string; descricao: string | null; valor: number; vencimento: string | null; status: StatusPagamento;
  forma: string | null; linkFatura: string | null; pagoEm: string | null; daAssinatura: boolean;
}
interface Resumo {
  configurada: boolean; ambiente: 'sandbox' | 'producao' | null; podeGerenciar: boolean;
  escritorio: { nome: string; plano: string; testeAte: string | null };
  situacao: Situacao; plano: string; nomePlano: string; empresas: number; limite: number | null; carenciaDias: number;
  assinatura: null | {
    plano: PlanoPago; ciclo: Ciclo; valor: number; status: StatusAssinatura;
    proximoVencimento: string | null; pagoAte: string | null; inadimplenteDesde: string | null;
    planoAgendado: PlanoPago | null; cicloAgendado: Ciclo | null; agendadoAPartir: string | null; outroAmbiente: boolean;
  };
  pagamentos: Pagamento[];
}

const ROTULO_STATUS_PAG: Record<StatusPagamento, { rotulo: string; tom: 'neutro' | 'sucesso' | 'aviso' | 'perigo' }> = {
  pendente: { rotulo: 'Em aberto', tom: 'aviso' },
  pago: { rotulo: 'Pago', tom: 'sucesso' },
  vencido: { rotulo: 'Vencido', tom: 'perigo' },
  estornado: { rotulo: 'Estornado', tom: 'neutro' },
  removido: { rotulo: 'Cancelado', tom: 'neutro' },
};
const FORMA: Record<string, string> = { PIX: 'Pix', BOLETO: 'Boleto', CREDIT_CARD: 'Cartão', UNDEFINED: '—' };

function situacaoSelo(r: Resumo): { rotulo: string; tom: 'neutro' | 'sucesso' | 'aviso' | 'perigo' | 'primaria' } {
  const s = r.situacao;
  if (s.somenteLeitura) return { rotulo: 'Somente leitura', tom: 'perigo' };
  switch (s.motivo) {
    case 'fundador': return { rotulo: 'Gratuito', tom: 'sucesso' };
    case 'teste': return { rotulo: 'Em teste', tom: 'primaria' };
    case 'assinante': return { rotulo: 'Em dia', tom: 'sucesso' };
    case 'carencia': return { rotulo: 'Pagamento em atraso', tom: 'aviso' };
    case 'aguardando_pagamento': return { rotulo: 'Aguardando pagamento', tom: 'aviso' };
    case 'cancelada_vigente': return { rotulo: 'Cancelada', tom: 'aviso' };
    case 'cobranca_desligada': return { rotulo: 'Teste encerrado', tom: 'aviso' };
    default: return { rotulo: 'Liberado', tom: 'sucesso' };
  }
}

export default function Assinatura() {
  const [r, setR] = useState<Resumo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [ciclo, setCiclo] = useState<Ciclo>('mensal');
  const [plano, setPlano] = useState<PlanoPago | null>(null);
  const [documento, setDocumento] = useState('');
  const [confirmar, setConfirmar] = useState<'trocar' | 'cancelar' | null>(null);

  const carregar = useCallback(async () => {
    const res = await fetch('/api/cobranca');
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.erro || 'Não foi possível ler a assinatura.');
    setR(d);
    if (d.assinatura && d.assinatura.status !== 'cancelada') {
      setCiclo(d.assinatura.cicloAgendado ?? d.assinatura.ciclo);
      setPlano(d.assinatura.planoAgendado ?? d.assinatura.plano);
    }
  }, []);

  useEffect(() => {
    carregar().catch((e) => setErro(e instanceof Error ? e.message : String(e)));
  }, [carregar]);

  async function agir(corpo: Record<string, unknown>) {
    setErro(null); setMsg(null); setOcupado(true);
    try {
      const res = await fetch('/api/cobranca', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.erro || 'Não foi possível concluir.');
      setMsg(d.mensagem ?? 'Pronto.');
      if (corpo.acao === 'assinar') setDocumento('');
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  const a = r?.assinatura;
  const temAssinatura = Boolean(a && a.status !== 'cancelada' && !a.outroAmbiente);
  const fundador = r?.situacao.motivo === 'fundador';
  const emAberto = useMemo(
    () => (r?.pagamentos ?? []).filter((p) => (p.status === 'pendente' || p.status === 'vencido') && p.linkFatura)
      .sort((x, y) => String(x.vencimento).localeCompare(String(y.vencimento)))[0] ?? null,
    [r],
  );

  // Prévia da troca (a mesma regra que o servidor aplica).
  const previa = useMemo(() => {
    if (!a || !temAssinatura || !plano) return null;
    return calcularTroca({ planoAtual: a.plano, cicloAtual: a.ciclo, planoNovo: plano, cicloNovo: ciclo, pagoAte: a.pagoAte, hoje: hojeEm() });
  }, [a, temAssinatura, plano, ciclo]);
  const mudouEscolha = temAssinatura && a && plano && (plano !== (a.planoAgendado ?? a.plano) || ciclo !== (a.cicloAgendado ?? a.ciclo));

  if (!r) {
    return (
      <div className="text-sm">
        <CabecalhoPagina titulo="Assinatura" subtitulo="Plano, pagamento e histórico do escritório." />
        <Toasts>{erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}</Toasts>
        <Conteudo largura="media">{!erro && <Carregando />}</Conteudo>
      </div>
    );
  }

  const selo = situacaoSelo(r);
  const s = r.situacao;
  const podeAgir = r.podeGerenciar && r.configurada && !fundador;

  return (
    <div className="text-sm">
      <CabecalhoPagina titulo="Assinatura" subtitulo={`Plano, pagamento e histórico de ${r.escritorio.nome}.`}
        acoes={temAssinatura && r.podeGerenciar && r.configurada
          ? <Botao variante="fantasma" carregando={ocupado} onClick={() => agir({ acao: 'sincronizar' })}>Atualizar cobranças</Botao>
          : undefined} />

      <Toasts>
        {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
        {msg && <Toast onFechar={() => setMsg(null)}>{msg}</Toast>}
      </Toasts>

      <Conteudo largura="media" className="space-y-5">
        {!r.configurada && !fundador && (
          <Aviso tom="info" titulo="Cobrança ainda não configurada">
            O pagamento online ainda não está disponível. Enquanto isso, nada muda no seu acesso — fale com o suporte do ClickContas se precisar.
          </Aviso>
        )}
        {r.configurada && r.ambiente === 'sandbox' && !fundador && (
          <Aviso tom="neutro" titulo="Ambiente de testes">
            As cobranças desta instalação são de teste (sandbox do Asaas): nenhum valor é cobrado de verdade.
          </Aviso>
        )}
        {!r.podeGerenciar && !fundador && (
          <Aviso tom="neutro">Só o administrador do escritório escolhe o plano, paga e cancela. Aqui você acompanha a situação.</Aviso>
        )}

        {s.somenteLeitura && (
          <Aviso tom="perigo" titulo="Conta em modo somente leitura">
            Tudo continua visível e exportável, mas nada pode ser gravado até {s.motivo === 'inadimplente' ? 'a cobrança em aberto ser paga' : 'uma assinatura ser paga'}. Nenhum dado é apagado.
          </Aviso>
        )}
        {!s.somenteLeitura && s.motivo === 'carencia' && (
          <Aviso tom="aviso" titulo="Cobrança em atraso">
            Pague até {dataBR(s.ate)} para a conta não entrar em modo somente leitura (carência de {r.carenciaDias} dias depois do vencimento).
          </Aviso>
        )}

        <Secao titulo="Seu plano"
          acoes={emAberto && r.podeGerenciar
            ? <a href={emAberto.linkFatura!} target="_blank" rel="noopener noreferrer" className={botaoCls({ variante: 'primaria' })}>Pagar fatura em aberto</a>
            : undefined}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Indicador rotulo="Plano" valor={r.nomePlano} destaque />
            <div className="rounded-xl border border-borda bg-superficie px-4 py-3.5 shadow-cartao">
              <div className="text-xs font-medium text-tinta-suave">Situação</div>
              <div className="mt-2"><Selo tom={selo.tom}>{selo.rotulo}</Selo></div>
            </div>
            <Indicador rotulo="Empresas-clientes" valor={r.limite === null ? `${r.empresas}` : `${r.empresas} de ${r.limite}`}
              tom={r.limite !== null && r.empresas > r.limite ? 'perigo' : 'neutro'} />
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
            {fundador && <Linha rotulo="Cobrança">Plano Fundador — gratuito, sem cobrança.</Linha>}
            {!fundador && s.motivo === 'teste' && <Linha rotulo="Teste grátis">{s.dias === 1 ? 'Termina amanhã' : `Faltam ${s.dias} dias`} ({dataBR(r.escritorio.testeAte)})</Linha>}
            {a && !a.outroAmbiente && (
              <>
                <Linha rotulo="Valor">{brl(a.valor)} por {a.ciclo === 'anual' ? 'ano' : 'mês'}</Linha>
                {a.status !== 'cancelada' && <Linha rotulo="Próximo vencimento">{dataBR(a.proximoVencimento)}</Linha>}
                {a.pagoAte && <Linha rotulo="Pago até">{dataBR(a.pagoAte)}</Linha>}
                {a.agendadoAPartir && (
                  <Linha rotulo="Troca agendada">
                    A partir de {dataBR(a.agendadoAPartir)}: {PLANOS[a.planoAgendado ?? a.plano].nome}, {a.cicloAgendado ?? a.ciclo}
                  </Linha>
                )}
              </>
            )}
            {!fundador && s.motivo === 'cancelada_vigente' && <Linha rotulo="Acesso completo até">{dataBR(s.ate)}</Linha>}
          </dl>
          {temAssinatura && podeAgir && (
            <div className="mt-5 border-t border-borda pt-4">
              <Botao variante="fantasma" className="text-perigo" onClick={() => setConfirmar('cancelar')} disabled={ocupado}>
                Cancelar assinatura
              </Botao>
            </div>
          )}
        </Secao>

        {!fundador && (
          <Secao titulo={temAssinatura ? 'Trocar de plano' : 'Escolher plano'}
            descricao={temAssinatura
              ? 'Subir de plano vale na hora, com cobrança proporcional dos dias que faltam. Descer de plano ou trocar mensal/anual vale na próxima renovação.'
              : 'Todos os módulos em todos os planos. Sem fidelidade: cancele quando quiser. Você paga com Pix, boleto ou cartão na fatura do Asaas.'}>
            <div role="group" aria-label="Forma de cobrança" className="inline-flex rounded-lg border border-borda bg-superficie p-1">
              {(['mensal', 'anual'] as Ciclo[]).map((c) => (
                <button key={c} type="button" aria-pressed={ciclo === c} onClick={() => setCiclo(c)} disabled={!podeAgir}
                  className={`h-9 rounded-md px-4 text-sm font-medium transition-colors ${ciclo === c ? 'bg-primaria text-sobre-primaria' : 'text-tinta-suave hover:text-tinta'}`}>
                  {c === 'mensal' ? 'Mensal' : 'Anual (2 meses grátis)'}
                </button>
              ))}
            </div>

            <div role="radiogroup" aria-label="Plano" className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
              {PLANOS_PAGOS.map((p) => {
                const info = PLANOS[p];
                const naoCabe = info.limite !== null && r.empresas > info.limite;
                const escolhido = plano === p;
                return (
                  <button key={p} type="button" role="radio" aria-checked={escolhido} disabled={!podeAgir || naoCabe}
                    onClick={() => setPlano(p)}
                    className={`flex flex-col rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      escolhido ? 'border-primaria bg-primaria-suave ring-1 ring-primaria' : 'border-borda bg-superficie hover:bg-superficie-realce'
                    }`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[15px] font-semibold text-tinta">{info.nome}</span>
                      {a && a.status !== 'cancelada' && a.plano === p && <Selo tom="primaria">Atual</Selo>}
                    </span>
                    <span className="mt-2 text-xl font-semibold tabular-nums text-tinta">
                      {brl(preco(p, ciclo))}<span className="text-[13px] font-normal text-tinta-suave">{ciclo === 'anual' ? ' /ano' : ' /mês'}</span>
                    </span>
                    <span className="mt-1 text-[13px] text-tinta-suave">
                      {info.limite === null ? 'Empresas-clientes sem limite' : `Até ${info.limite} empresas-clientes`}
                    </span>
                    {naoCabe && <span className="mt-1 text-xs text-aviso">Seu escritório já tem {r.empresas} empresas.</span>}
                  </button>
                );
              })}
            </div>

            {podeAgir && !temAssinatura && (
              <div className="mt-5 grid grid-cols-1 items-start gap-4 sm:grid-cols-[1fr_auto]">
                <Entrada rotulo="CPF ou CNPJ de quem paga" value={documento} inputMode="numeric" autoComplete="off"
                  onChange={(e) => setDocumento(e.target.value)}
                  dica="Vai só para o Asaas emitir a cobrança e a nota; o ClickContas não guarda." />
                <Botao variante="primaria" className="sm:mt-6" carregando={ocupado} disabled={!plano || !documento.trim()}
                  onClick={() => agir({ acao: 'assinar', plano, ciclo, documento })}>
                  Assinar
                </Botao>
              </div>
            )}
            {podeAgir && !temAssinatura && r.situacao.motivo === 'teste' && (
              <p className="mt-3 text-[13px] text-tinta-suave">
                A primeira cobrança vence no fim do teste grátis ({dataBR(r.escritorio.testeAte)}): você não perde nenhum dia.
              </p>
            )}
            {podeAgir && temAssinatura && (
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Botao variante="tonal" carregando={ocupado} disabled={!mudouEscolha} onClick={() => setConfirmar('trocar')}>
                  Trocar de plano
                </Botao>
                {a?.agendadoAPartir && (
                  <Botao variante="fantasma" disabled={ocupado} onClick={() => agir({ acao: 'trocar', plano: a.plano, ciclo: a.ciclo })}>
                    Desfazer troca agendada
                  </Botao>
                )}
              </div>
            )}
          </Secao>
        )}

        {!fundador && (
          <Secao titulo="Histórico de cobranças">
            {r.pagamentos.length === 0 ? (
              <EstadoVazio moldura={false} titulo="Nenhuma cobrança ainda" descricao="As faturas aparecem aqui assim que a assinatura é criada." />
            ) : (
              <div className={tb.moldura}>
                <table className={tb.tabela}>
                  <thead className={tb.cabeca}>
                    <tr>
                      <th className={tb.th}>Vencimento</th>
                      <th className={tb.th}>Descrição</th>
                      <th className={`${tb.th} text-right`}>Valor</th>
                      <th className={tb.th}>Situação</th>
                      <th className={tb.th}>Forma</th>
                      <th className={tb.th}><span className="sr-only">Fatura</span></th>
                    </tr>
                  </thead>
                  <tbody className={tb.corpo}>
                    {r.pagamentos.map((p) => {
                      const st = ROTULO_STATUS_PAG[p.status];
                      return (
                        <tr key={p.id} className={tb.linha}>
                          <td className={tb.td}>{dataBR(p.vencimento)}</td>
                          <td className={tb.td}>{p.descricao ?? (p.daAssinatura ? 'Assinatura' : 'Ajuste')}</td>
                          <td className={`${tb.td} ${tb.num}`}>{brl(p.valor)}</td>
                          <td className={tb.td}>
                            <Selo tom={st.tom}>{st.rotulo}</Selo>
                            {p.pagoEm && <span className="ml-2 text-xs text-tinta-suave">em {dataBR(p.pagoEm)}</span>}
                          </td>
                          <td className={tb.td}>{FORMA[p.forma ?? ''] ?? '—'}</td>
                          <td className={`${tb.td} text-right`}>
                            {p.linkFatura && (
                              <a href={p.linkFatura} target="_blank" rel="noopener noreferrer" className="font-medium text-primaria-texto hover:underline">
                                {p.status === 'pago' ? 'Ver comprovante' : 'Abrir fatura'}
                              </a>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Secao>
        )}
      </Conteudo>

      {confirmar === 'cancelar' && a && (
        <DialogoConfirmacao titulo="Cancelar a assinatura?" textoConfirmar="Cancelar assinatura"
          mensagem={a.pagoAte && a.pagoAte >= hojeEm()
            ? `O escritório segue com acesso completo até ${dataBR(a.pagoAte)}. Depois, a conta fica em modo somente leitura — nada é apagado, e dá para assinar de novo quando quiser. Faturas em aberto são canceladas.`
            : 'A conta fica em modo somente leitura — nada é apagado, e dá para assinar de novo quando quiser. Faturas em aberto são canceladas.'}
          onCancelar={() => setConfirmar(null)}
          onConfirmar={() => { setConfirmar(null); agir({ acao: 'cancelar' }); }} />
      )}
      {confirmar === 'trocar' && a && plano && previa && previa.tipo !== 'nada' && (
        <DialogoConfirmacao titulo={`Trocar para o ${PLANOS[plano].nome} (${ciclo})?`} textoConfirmar="Trocar" perigo={false}
          mensagem={textoPrevia(previa, plano)}
          onCancelar={() => setConfirmar(null)}
          onConfirmar={() => { setConfirmar(null); agir({ acao: 'trocar', plano, ciclo }); }} />
      )}
    </div>
  );
}

function textoPrevia(p: ReturnType<typeof calcularTroca>, plano: PlanoPago): string {
  const nome = PLANOS[plano].nome;
  switch (p.tipo) {
    case 'imediata': return `O ${nome} vale na hora e as próximas cobranças passam a ${brl(p.valorNovo)}.`;
    case 'subida': return p.cobrarAgora > 0
      ? `O ${nome} vale na hora. Pelos ${p.diasRestantes} dias que faltam do período já pago, sai uma cobrança proporcional de ${brl(p.cobrarAgora)}. Depois, ${brl(p.valorNovo)} por ciclo.`
      : `O ${nome} vale na hora, sem cobrança extra agora. Depois, ${brl(p.valorNovo)} por ciclo.`;
    case 'agendada': return p.planoJa
      ? `O ${nome} vale na hora${p.cobrarAgora > 0 ? `, com cobrança proporcional de ${brl(p.cobrarAgora)}` : ''}; a nova forma de cobrança (${brl(p.valorNovo)}) começa em ${dataBR(p.aPartir)}.`
      : `A troca vale a partir de ${dataBR(p.aPartir)}, quando o período já pago termina. Até lá nada muda; depois, ${brl(p.valorNovo)} por ciclo.`;
    default: return '';
  }
}

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-tinta-suave">{rotulo}:</dt>
      <dd className="font-medium text-tinta">{children}</dd>
    </div>
  );
}
