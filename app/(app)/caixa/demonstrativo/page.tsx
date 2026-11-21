'use client';

// Demonstrativo de caixa do mês (nunca "DRE"): entradas, saídas e saldo de um mês
// CONFIRMADO, comparado com o mês anterior e a média dos 12 anteriores, as maiores
// saídas, documentos pedidos e obrigações que vencem.
//
// Duas visões da mesma página: a contadora vê a PRÉVIA (por empresa e mês) e envia ao
// cliente; o cliente vê o da própria empresa. Quem corta o que aparece é a rota
// (/api/caixa/demonstrativo) — a tela só mostra. Ver docs/resumo-cliente.md.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AbasCaixa } from '../AbasCaixa';
import { dinheiro, MESES_LONGOS } from '../formato';
import Grafico from './Grafico';
import { DialogoConfirmacao } from '../../Dialogo';
import { Aviso, Botao, CabecalhoPagina, Carregando, Conteudo, EstadoVazio, Indicador, Secao, Selo, tb } from '@/components/ui';
import { Selecao } from '@/components/selecao';
import { Toast, Toasts } from '@/components/retorno';
import { lerMe } from '@/lib/meCliente';
import { Comparacao, Demonstrativo, liberadoAte, TITULO, textoVariacao } from '@/lib/demonstrativo';
import { br, rotuloCompetencia } from '@/lib/agenda';

interface Me { role: 'master' | 'usuario' | 'cliente'; empresa: string | null }
interface Empresa { id: string; nome: string }
interface Envio { situacao: 'enviando' | 'enviado' | 'registrado' | 'falhou'; destinatarios: number; enviadoPor: string; enviadoEm: string; reenvios: number; erro: string | null }
type Resposta =
  | { situacao: 'ok'; demonstrativo: Demonstrativo; indisponiveis: string[]; envio?: Envio | null; envioIndisponivel?: boolean; destinatarios?: number }
  | { situacao: 'nao_liberado'; liberadoAte: number; confirmado: boolean; envio?: Envio | null; destinatarios?: number };

const PRIMEIRO_EXERCICIO = 2026;

function Comparativo({ rotulo, c, base }: { rotulo: string; c: (Comparacao & { meses?: number }) | null; base: string }) {
  return (
    <div className="rounded-xl border border-borda bg-superficie px-4 py-3.5 shadow-cartao">
      <div className="text-xs font-medium text-tinta-suave">{rotulo}</div>
      {c ? (
        <>
          <div className="mt-1 text-[13px] text-tinta-suave">{base}</div>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm tabular-nums">
            <dt className="text-tinta-suave">Entradas</dt>
            <dd className="text-right"><span className="text-sucesso">{dinheiro(c.entradas)}</span> <span className="text-tinta-fraca">· hoje {textoVariacao(c.variacaoEntradas)}</span></dd>
            <dt className="text-tinta-suave">Saídas</dt>
            <dd className="text-right"><span className="text-perigo">{dinheiro(c.saidas)}</span> <span className="text-tinta-fraca">· hoje {textoVariacao(c.variacaoSaidas)}</span></dd>
          </dl>
        </>
      ) : (
        <p className="mt-2 text-[13px] text-tinta-fraca">Ainda não há meses confirmados suficientes para comparar.</p>
      )}
    </div>
  );
}

export default function DemonstrativoPagina() {
  const [me, setMe] = useState<Me | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaSel, setEmpresaSel] = useState('');
  const [ano, setAno] = useState(() => Math.max(new Date().getFullYear(), PRIMEIRO_EXERCICIO));
  const [mes, setMes] = useState(0);
  const [ate, setAte] = useState<number | null>(null); // meses confirmados em sequência no ano
  const [resp, setResp] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const ehGestor = me?.role === 'master' || me?.role === 'usuario';
  const anos = useMemo(() => {
    const ultimo = Math.max(new Date().getFullYear(), PRIMEIRO_EXERCICIO);
    return Array.from({ length: ultimo - PRIMEIRO_EXERCICIO + 1 }, (_, i) => PRIMEIRO_EXERCICIO + i);
  }, []);

  // Link do e-mail (?ano=&mes=) e o filtro do caixa (mesmas chaves das outras telas).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const a = Number(q.get('ano')) || Number(localStorage.getItem('caixa.ano'));
    if (a >= PRIMEIRO_EXERCICIO) setAno(a);
    const m = Number(q.get('mes'));
    if (m >= 1 && m <= 12) setMes(m);
  }, []);

  useEffect(() => {
    lerMe().then((d) => {
      if (!d?.autenticado) return;
      setMe(d);
      if (d.role === 'cliente') { if (d.empresa) setEmpresaSel(d.empresa); }
      else { const e = localStorage.getItem('caixa.empresa'); if (e) setEmpresaSel((x) => x || e); }
    }).catch(() => {});
    fetch('/api/empresas').then((r) => (r.ok ? r.json() : null)).then((d) => {
      const lista: Empresa[] = d?.empresas ?? [];
      setEmpresas(lista);
      setEmpresaSel((x) => x || lista[0]?.id || '');
    }).catch(() => {});
  }, []);

  // Descobre até onde o ano está confirmado em sequência e escolhe o mês (o último liberado).
  useEffect(() => {
    if (!empresaSel) return;
    let ativo = true;
    setAte(null); setResp(null);
    fetch(`/api/caixa/resumo?empresa=${encodeURIComponent(empresaSel)}&ano=${ano}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!ativo || !d) return;
      const confirmados: number[] = (d.meses as { mes: number; confirmado: boolean }[]).filter((m) => m.confirmado).map((m) => m.mes);
      const n = liberadoAte(confirmados);
      setAte(n);
      setMes((atual) => (atual >= 1 && atual <= 12 ? atual : Math.max(n, 1)));
    }).catch(() => { if (ativo) setAte(0); });
    return () => { ativo = false; };
  }, [empresaSel, ano]);

  const carregar = useCallback(async () => {
    if (!empresaSel || mes < 1) return;
    setCarregando(true); setErro('');
    try {
      const r = await fetch(`/api/caixa/demonstrativo?empresa=${encodeURIComponent(empresaSel)}&ano=${ano}&mes=${mes}`, { cache: 'no-store' });
      const x = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(x.erro || 'Não foi possível carregar o demonstrativo.');
      setResp(x as Resposta);
    } catch (e) {
      setResp(null);
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o demonstrativo.');
    } finally { setCarregando(false); }
  }, [empresaSel, ano, mes]);

  useEffect(() => { carregar(); }, [carregar]);

  async function enviar(reenviar: boolean) {
    setConfirmando(false); setEnviando(true); setErro('');
    try {
      const r = await fetch('/api/caixa/demonstrativo/enviar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa: empresaSel, ano, mes, reenviar }),
      });
      const x = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(x.erro || 'Não foi possível enviar.');
      setMsg(x.situacao === 'registrado'
        ? 'O envio de e-mail ainda não está configurado neste ambiente: ficou só registrado no log, nada saiu.'
        : `Demonstrativo enviado para ${x.destinatarios} ${x.destinatarios === 1 ? 'login' : 'logins'} do cliente.`);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar.');
    } finally { setEnviando(false); }
  }

  const d = resp?.situacao === 'ok' ? resp.demonstrativo : null;
  const envio = resp?.envio ?? null;
  const jaEnviado = envio?.situacao === 'enviado' || envio?.situacao === 'enviando';
  const nomeEmpresa = empresas.find((e) => e.id === empresaSel)?.nome ?? 'sua empresa';
  const opcoesMes = MESES_LONGOS.map((rotulo, i) => ({ valor: String(i + 1), rotulo, i: i + 1 }))
    .filter((o) => ehGestor || (ate != null && o.i <= ate))
    .map((o) => ({ valor: o.valor, rotulo: ate != null && o.i > ate ? `${o.rotulo} · em aberto` : o.rotulo }));
  const enviarAcao = ehGestor && d ? (
    <Botao variante="primaria" onClick={() => (jaEnviado ? setConfirmando(true) : void enviar(false))} carregando={enviando}
      disabled={!resp || (resp.destinatarios ?? 0) === 0}>
      {jaEnviado ? 'Reenviar ao cliente' : 'Enviar ao cliente'}
    </Botao>
  ) : null;

  return (
    <div className="text-sm">
      <CabecalhoPagina titulo={TITULO} subtitulo={ehGestor ? 'Prévia do que o cliente recebe, mês a mês' : `O resumo do mês — ${nomeEmpresa}`}
        abas={<AbasCaixa ativa="demonstrativo" ehGestor={!!ehGestor} />}
        acoes={<>
          {ehGestor && (
            <Selecao aria-label="Empresa" largura="w-56 max-w-full" valor={empresaSel} onChange={setEmpresaSel}
              placeholder="— nenhuma empresa —" opcoes={empresas.map((e) => ({ valor: e.id, rotulo: e.nome }))} />
          )}
          <Selecao aria-label="Exercício" largura="w-24" busca={false} valor={String(ano)} onChange={(v) => { setAno(Number(v)); setMes(0); }}
            opcoes={anos.map((a) => ({ valor: String(a), rotulo: String(a) }))} />
          <Selecao aria-label="Mês" largura="w-44" busca={false} valor={mes ? String(mes) : ''} onChange={(v) => setMes(Number(v))}
            placeholder="— mês —" opcoes={opcoesMes} />
          {enviarAcao}
        </>} />

      <Toasts>
        {erro && <Toast tom="perigo" onFechar={() => setErro('')}>{erro}</Toast>}
        {msg && <Toast onFechar={() => setMsg('')}>{msg}</Toast>}
      </Toasts>

      <Conteudo largura="media">
        {carregando && !resp && <Carregando>Montando o demonstrativo…</Carregando>}

        {ate === 0 && !ehGestor && (
          <EstadoVazio titulo="O demonstrativo aparece quando a contabilidade confirmar o mês"
            descricao="Assim que o mês for conferido e confirmado, o resumo fica disponível aqui. Seus lançamentos continuam em Lançamentos." />
        )}

        {resp?.situacao === 'nao_liberado' && (ate !== 0 || ehGestor) && (
          <Aviso tom="info" titulo={ehGestor ? 'Este mês ainda não pode ser enviado' : 'Mês ainda não confirmado'}>
            {ehGestor
              ? `O demonstrativo só existe para meses confirmados em sequência desde janeiro (hoje: ${resp.liberadoAte === 0 ? 'nenhum' : `até ${MESES_LONGOS[resp.liberadoAte - 1].toLowerCase()}`}). Confirme este mês e os anteriores em Lançamentos.`
              : 'A contabilidade ainda não confirmou este mês. Quando confirmar, o resumo aparece aqui.'}
          </Aviso>
        )}

        {ehGestor && resp && (
          <div className="space-y-2">
            {resp.envio && (
              <Aviso tom={resp.envio.situacao === 'enviado' ? 'sucesso' : 'aviso'}>
                {resp.envio.situacao === 'enviado' && `Enviado em ${br(resp.envio.enviadoEm.slice(0, 10))} por ${resp.envio.enviadoPor} para ${resp.envio.destinatarios} ${resp.envio.destinatarios === 1 ? 'login' : 'logins'}${resp.envio.reenvios ? ` (reenviado ${resp.envio.reenvios}×)` : ''}.`}
                {resp.envio.situacao === 'enviando' && 'Um envio está em andamento.'}
                {resp.envio.situacao === 'registrado' && 'A última tentativa não mandou e-mail (envio não configurado neste ambiente). Dá para tentar de novo.'}
                {resp.envio.situacao === 'falhou' && `A última tentativa falhou${resp.envio.erro ? `: ${resp.envio.erro}` : ''}. Dá para tentar de novo.`}
              </Aviso>
            )}
            {'envioIndisponivel' in resp && resp.envioIndisponivel && (
              <Aviso tom="info" titulo="Envio ainda não instalado">A prévia funciona, mas o envio ao cliente precisa da migração 0023 do banco.</Aviso>
            )}
            {(resp.destinatarios ?? 0) === 0 && resp.situacao === 'ok' && (
              <Aviso tom="aviso" titulo="Sem destinatário">Esta empresa não tem login de cliente com e-mail. Cadastre em Equipe antes de enviar.</Aviso>
            )}
          </div>
        )}

        {d && (
          <>
            <p className="text-base font-medium text-tinta">
              {nomeEmpresa} · {MESES_LONGOS[d.mes - 1]} de {d.ano}
            </p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Indicador rotulo="Entradas" valor={dinheiro(d.entradas)} tom="sucesso" />
              <Indicador rotulo="Saídas" valor={dinheiro(d.saidas)} tom="perigo" />
              <Indicador rotulo="Entradas − saídas" valor={dinheiro(d.resultado)} tom={d.resultado < 0 ? 'perigo' : 'neutro'} />
              <Indicador rotulo="Saldo no fim do mês" valor={dinheiro(d.saldoFinal)} destaque tom={d.saldoFinal < 0 ? 'perigo' : 'neutro'} />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Comparativo rotulo="Contra o mês anterior" c={d.anterior}
                base={d.anterior ? `${MESES_LONGOS[d.anterior.mes - 1]} de ${d.anterior.ano}` : ''} />
              <Comparativo rotulo="Contra a média dos meses anteriores" c={d.media}
                base={d.media ? `Média dos ${d.media.meses} ${d.media.meses === 1 ? 'mês confirmado' : 'meses confirmados'} antes deste (até 12)` : ''} />
            </div>

            <Secao titulo="Entradas e saídas por mês" descricao="Os últimos meses confirmados, até este.">
              <Grafico serie={d.serie} destaque={{ ano: d.ano, mes: d.mes }} />
            </Secao>

            <Secao titulo="Maiores saídas do mês" descricao="Por conta do plano de contas.">
              {d.maioresSaidas.length === 0 ? (
                <p className="text-sm text-tinta-suave">Nenhuma saída classificada neste mês.</p>
              ) : (
                <div className={tb.moldura}>
                  <table className={`${tb.tabela} text-[13px]`}>
                    <caption className="sr-only">Maiores saídas de {MESES_LONGOS[d.mes - 1]} de {d.ano}, por conta</caption>
                    <thead className={tb.cabeca}><tr><th className={tb.th}>Conta</th><th className={`${tb.th} text-right`}>Valor</th><th className={`${tb.th} text-right`}>% das saídas</th></tr></thead>
                    <tbody className="[&>tr]:border-b [&>tr]:border-borda/70">
                      {d.maioresSaidas.map((s) => (
                        <tr key={s.conta} className={tb.linha}>
                          <td className={tb.td}>{s.conta}</td>
                          <td className={`${tb.td} ${tb.num} text-perigo`}>{dinheiro(s.valor)}</td>
                          <td className={`${tb.td} ${tb.num} text-tinta-suave`}>{d.saidas > 0 ? `${Math.round((s.valor / d.saidas) * 100)}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {d.movimentacaoBancaria > 0 && (
                <p className="mt-2 text-[13px] text-tinta-suave">
                  Há também {dinheiro(d.movimentacaoBancaria)} em movimentação bancária (depósitos e transferências), que não é gasto e ficou fora do ranking.
                </p>
              )}
            </Secao>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Secao titulo="Documentos que ainda faltam" acoes={<Selo tom={d.pendencias.length ? 'aviso' : 'neutro'}>{d.pendencias.length}</Selo>}>
                {resp?.situacao === 'ok' && resp.indisponiveis.includes('pendencias') ? (
                  <p className="text-sm text-tinta-suave">Esta parte ainda não está disponível.</p>
                ) : d.pendencias.length === 0 ? (
                  <p className="text-sm text-tinta-suave">Nenhum documento pedido em aberto.</p>
                ) : (
                  <ul className="divide-y divide-borda">
                    {d.pendencias.map((p, i) => (
                      <li key={`${p.titulo}-${i}`} className="flex items-center justify-between gap-3 py-2">
                        <span className="min-w-0 truncate text-sm text-tinta">{p.titulo}</span>
                        <span className="shrink-0 text-xs tabular-nums text-tinta-fraca">{p.prazo ? `até ${br(p.prazo)}` : 'sem prazo'}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Secao>

              <Secao titulo="Obrigações que vencem" descricao="Atrasadas e as dos próximos 30 dias."
                acoes={<Selo tom={d.obrigacoes.some((o) => o.atrasada) ? 'perigo' : d.obrigacoes.length ? 'aviso' : 'neutro'}>{d.obrigacoes.length}</Selo>}>
                {resp?.situacao === 'ok' && resp.indisponiveis.includes('obrigacoes') ? (
                  <p className="text-sm text-tinta-suave">Esta parte ainda não está disponível.</p>
                ) : d.obrigacoes.length === 0 ? (
                  <p className="text-sm text-tinta-suave">Nada vencendo nem atrasado.</p>
                ) : (
                  <ul className="divide-y divide-borda">
                    {d.obrigacoes.map((o, i) => (
                      <li key={`${o.nome}-${o.competencia}-${i}`} className="flex items-center justify-between gap-3 py-2">
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-tinta">{o.nome}</span>
                          <span className="block text-xs text-tinta-fraca">competência {rotuloCompetencia(o.competencia)}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-xs tabular-nums text-tinta-fraca">{br(o.vencimento)}</span>
                          {o.atrasada && <Selo tom="perigo">atrasada</Selo>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Secao>
            </div>

            <p className="text-[13px] text-tinta-suave">
              Valores conforme o livro caixa de {nomeEmpresa}. Este demonstrativo mostra o que entrou, o que saiu e o saldo; não é balanço nem apuração de resultado.
            </p>
          </>
        )}
      </Conteudo>

      {confirmando && (
        <DialogoConfirmacao titulo="Reenviar o demonstrativo?" textoConfirmar="Reenviar" perigo={false}
          mensagem={`Este mês já foi enviado${envio ? ` em ${br(envio.enviadoEm.slice(0, 10))}` : ''}. O cliente vai receber o e-mail de novo.`}
          onConfirmar={() => void enviar(true)} onCancelar={() => setConfirmando(false)} />
      )}
    </div>
  );
}
