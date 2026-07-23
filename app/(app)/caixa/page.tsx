'use client';

// Livro Caixa — tela de lançamentos (Fase 3).
//
// Mês a mês, no formato da planilha que a contadora usa hoje:
// DATA · HISTÓRICO · COMPLEMENTO · CONTA · ENTRADA · SAÍDA · SALDO.
//
// Quem lança é o administrativo da empresa (papel `cliente`); a contabilidade vê
// todas as empresas, confere lançamento a lançamento e confirma o mês. Nada
// disso trava a edição: lançamento é sempre editável e excluível, inclusive
// retroativo — decisão dela.
import { useCallback, useEffect, useMemo, useState } from 'react';
import SeletorConta, { Conta, rotuloConta } from './SeletorConta';

interface Me { nome: string; email: string; role: 'master' | 'usuario' | 'cliente'; empresa: string | null; }
interface Empresa { id: string; nome: string; }
interface Historico { texto: string; natureza: 'receita' | 'despesa'; contaId: string | null; }

interface Lancamento {
  id: string; data: string; historico: string; complemento: string | null; contaId: string | null;
  entrada: number; saida: number; criadoPor: string; criadoEm: string; atualizadoPor: string | null;
  conferidoPor: string | null; conferidoEm: string | null;
}
interface RespostaMes {
  mes: number; lancamentos: Lancamento[];
  saldoTransportado: number; entradas: number; saidas: number; saldoFinal: number;
  confirmado: boolean;
}
interface ResumoMes { mes: number; entradas: number; saidas: number; saldoFinal: number; }
interface Pendencia { empresaId: string; pendentes: number; meses: number[]; ultimo: { historico: string; criadoEm: string; criadoPor: string; mes: number }; }

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const PRIMEIRO_EXERCICIO = 2026; // a contadora começa o sistema em janeiro/2026

const dinheiro = (n: number) =>
  n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** O banco ainda não tem a tabela? A mensagem crua não ajuda ninguém. */
const faltaMigracao = (msg: string) =>
  /could not find the table|does not exist|schema cache/i.test(msg);

interface Campos { data: string; historico: string; complemento: string; contaId: string | null; entrada: string; saida: string; }

const vazio = (data: string): Campos =>
  ({ data, historico: '', complemento: '', contaId: null, entrada: '', saida: '' });

/** Data que o formulário sugere: hoje, se hoje cair no mês aberto; senão o dia 1º. */
function dataPadrao(ano: number, mes: number): string {
  const h = new Date();
  const dia = h.getFullYear() === ano && h.getMonth() + 1 === mes ? h.getDate() : 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export default function Caixa() {
  const [me, setMe] = useState<Me | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaSel, setEmpresaSel] = useState('');
  // Abre no mês corrente. Antes de 2026 não existe exercício, então cai em jan/2026.
  const [ano, setAno] = useState(() => Math.max(new Date().getFullYear(), PRIMEIRO_EXERCICIO));
  const [mes, setMes] = useState(() =>
    new Date().getFullYear() >= PRIMEIRO_EXERCICIO ? new Date().getMonth() + 1 : 1);

  const [contas, setContas] = useState<Conta[]>([]);
  const [historicos, setHistoricos] = useState<Historico[]>([]);
  const [resumo, setResumo] = useState<ResumoMes[]>([]);
  const [confirmados, setConfirmados] = useState<number[]>([]);
  const [saldoInicial, setSaldoInicial] = useState(0);
  const [dados, setDados] = useState<RespostaMes | null>(null);
  const [pendencias, setPendencias] = useState<Pendencia[]>([]);

  const [novo, setNovo] = useState<Campos>(() => vazio(dataPadrao(ano, mes)));
  const [cheque, setCheque] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [edicao, setEdicao] = useState<Campos>(() => vazio(''));

  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const ehGestor = me?.role === 'master' || me?.role === 'usuario';
  const anos = useMemo(() => {
    const ultimo = Math.max(new Date().getFullYear() + 1, PRIMEIRO_EXERCICIO);
    return Array.from({ length: ultimo - PRIMEIRO_EXERCICIO + 1 }, (_, i) => PRIMEIRO_EXERCICIO + i);
  }, []);

  /** Troca o mês/ano abertos e devolve o formulário ao estado inicial. */
  function irPara(novoAno: number, novoMes: number) {
    setAno(novoAno);
    setMes(novoMes);
    setNovo(vazio(dataPadrao(novoAno, novoMes)));
    setCheque(false);
    setEditandoId(null);
  }

  // ------------------------------------------------------------------ carga
  useEffect(() => {
    fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then((d) => d?.autenticado && setMe(d)).catch(() => {});
    fetch('/api/empresas').then((r) => (r.ok ? r.json() : null)).then((d) => {
      const lista: Empresa[] = d?.empresas ?? [];
      setEmpresas(lista);
      setEmpresaSel((atual) => atual || lista[0]?.id || '');
    }).catch(() => {});
  }, []);

  const carregarExercicio = useCallback(async () => {
    if (!empresaSel) return;
    const r = await fetch(`/api/caixa/exercicio?empresa=${encodeURIComponent(empresaSel)}&ano=${ano}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.erro);
    setResumo(d.resumo ?? []);
    setConfirmados(d.confirmados ?? []);
    setSaldoInicial(d.exercicio?.saldoInicial ?? 0);
  }, [empresaSel, ano]);

  const carregarMes = useCallback(async () => {
    if (!empresaSel) return;
    const r = await fetch(`/api/caixa/lancamentos?empresa=${encodeURIComponent(empresaSel)}&ano=${ano}&mes=${mes}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.erro);
    setDados(d);
  }, [empresaSel, ano, mes]);

  const recarregar = useCallback(async () => {
    if (!empresaSel) return;
    setCarregando(true); setErro(null);
    try {
      await Promise.all([carregarExercicio(), carregarMes()]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [empresaSel, carregarExercicio, carregarMes]);

  useEffect(() => { recarregar(); }, [recarregar]);

  useEffect(() => {
    if (!empresaSel) return;
    fetch(`/api/caixa/contas?empresa=${encodeURIComponent(empresaSel)}`)
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.erro)))))
      .then((d) => { setContas(d.contas ?? []); setHistoricos(d.historicos ?? []); })
      .catch((e) => setErro(e instanceof Error ? e.message : String(e)));
  }, [empresaSel]);

  // Fila de conferência: é o aviso "a empresa lançou" que a contadora pediu.
  const carregarPendencias = useCallback(() => {
    if (!ehGestor) return;
    fetch(`/api/caixa/atividade?ano=${ano}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPendencias(d?.empresas ?? []))
      .catch(() => {});
  }, [ehGestor, ano]);
  useEffect(() => { carregarPendencias(); }, [carregarPendencias, dados]);

  // ------------------------------------------------------------------ ações
  async function chamar(url: string, init: RequestInit) {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.erro || 'Falha na operação.');
    return d;
  }

  async function lancar() {
    setSalvando(true); setErro(null); setMsg(null);
    try {
      const d = await chamar('/api/caixa/lancamentos', {
        method: 'POST',
        body: JSON.stringify({ empresa: empresaSel, ano, ...novo, cheque }),
      });
      setMsg(d.criados > 1 ? 'Cheque lançado: retirada do banco + pagamento.' : 'Lançado.');
      setNovo(vazio(novo.data)); // mantém a data: quem digita o mês inteiro agradece
      setCheque(false);
      await recarregar();
      await recarregarContas();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  async function salvarEdicao() {
    if (!editandoId) return;
    setSalvando(true); setErro(null); setMsg(null);
    try {
      await chamar('/api/caixa/lancamentos', { method: 'PATCH', body: JSON.stringify({ id: editandoId, ...edicao }) });
      setEditandoId(null);
      setMsg('Lançamento alterado.');
      await recarregar();
      await recarregarContas();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(l: Lancamento) {
    const valor = l.entrada > 0 ? `entrada de ${dinheiro(l.entrada)}` : `saída de ${dinheiro(l.saida)}`;
    if (!confirm(`Excluir o lançamento de ${diaMes(l.data)} — ${l.historico} (${valor})?`)) return;
    setErro(null); setMsg(null);
    try {
      await chamar(`/api/caixa/lancamentos?id=${encodeURIComponent(l.id)}`, { method: 'DELETE' });
      setMsg('Lançamento excluído.');
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  async function conferir(l: Lancamento, marcar: boolean) {
    try {
      await chamar('/api/caixa/lancamentos', { method: 'PATCH', body: JSON.stringify({ id: l.id, conferido: marcar }) });
      await carregarMes();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  async function alternarConfirmacao() {
    const confirmado = dados?.confirmado;
    setErro(null); setMsg(null);
    try {
      await chamar('/api/caixa/meses', {
        method: confirmado ? 'DELETE' : 'POST',
        body: JSON.stringify({ empresa: empresaSel, ano, mes }),
      });
      setMsg(confirmado ? 'Confirmação do mês desfeita.' : 'Mês confirmado — o resumo fica visível ao cliente.');
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  async function editarSaldoInicial() {
    const atual = dinheiro(saldoInicial);
    const v = prompt(`Saldo que abre o exercício de ${ano} (vem do encerramento do ano anterior):`, atual);
    if (v == null) return;
    setErro(null); setMsg(null);
    try {
      await chamar('/api/caixa/exercicio', { method: 'PATCH', body: JSON.stringify({ empresa: empresaSel, ano, saldoInicial: v }) });
      setMsg('Saldo inicial atualizado.');
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  async function recarregarContas() {
    const r = await fetch(`/api/caixa/contas?empresa=${encodeURIComponent(empresaSel)}`);
    if (r.ok) { const d = await r.json(); setContas(d.contas ?? []); }
  }

  async function criarConta(nome: string, grupo: string): Promise<Conta | null> {
    const d = await chamar('/api/caixa/contas', { method: 'POST', body: JSON.stringify({ empresa: empresaSel, nome, grupo }) });
    await recarregarContas();
    return d.conta ?? null;
  }

  // ---------------------------------------------------------------- derivados
  /** Saldo corrido linha a linha, partindo do que veio do mês anterior. */
  const linhas = useMemo(() => {
    let saldo = dados?.saldoTransportado ?? 0;
    return (dados?.lancamentos ?? []).map((l) => {
      saldo += l.entrada - l.saida;
      return { l, saldo };
    });
  }, [dados]);

  // Saldo negativo só avisa, não bloqueia — decisão dela.
  const negativo = linhas.find((x) => x.saldo < 0);
  const semConta = linhas.filter((x) => !x.l.contaId).length;
  const aConferir = linhas.filter((x) => !x.l.conferidoEm).length;
  const minhaEmpresa = empresas.find((e) => e.id === (me?.role === 'cliente' ? me.empresa : empresaSel))?.nome;
  const nomeEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nome ?? id;

  if (erro && faltaMigracao(erro)) return <BancoIncompleto erro={erro} />;

  return (
    <div className="text-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Livro Caixa</h1>
          <p className="text-xs text-slate-500">
            {ehGestor ? 'Movimento do caixa das empresas-clientes' : `Movimento do caixa — ${minhaEmpresa ?? 'sua empresa'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {ehGestor && (
            <select value={empresaSel} onChange={(e) => setEmpresaSel(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1">
              {empresas.length === 0 && <option value="">— nenhuma empresa —</option>}
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          )}
          <select value={ano} onChange={(e) => irPara(Number(e.target.value), mes)}
            className="rounded-lg border border-slate-300 px-2 py-1">
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </header>

      <div className="space-y-4 p-6">
        {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{erro}</p>}
        {msg && <p className="rounded-lg bg-green-50 px-3 py-2 text-green-700">{msg}</p>}

        {ehGestor && pendencias.length > 0 && (
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-indigo-900">
            <span className="font-medium">Lançamentos novos para conferir:</span>{' '}
            {pendencias.map((p) => (
              <button key={p.empresaId} onClick={() => { setEmpresaSel(p.empresaId); irPara(ano, p.ultimo.mes); }}
                className="mr-2 rounded bg-white/70 px-2 py-0.5 underline-offset-2 hover:underline">
                {nomeEmpresa(p.empresaId)} ({p.pendentes})
              </button>
            ))}
          </div>
        )}

        {/* Meses do exercício */}
        <div className="flex flex-wrap gap-1">
          {MESES.map((rotulo, i) => {
            const m = i + 1;
            const r = resumo.find((x) => x.mes === m);
            const temMovimento = r && (r.entradas > 0 || r.saidas > 0);
            return (
              <button key={m} onClick={() => irPara(ano, m)}
                className={`rounded-lg border px-3 py-1.5 uppercase ${
                  m === mes ? 'border-indigo-600 bg-indigo-600 text-white'
                    : temMovimento ? 'border-slate-300 bg-white text-slate-700 hover:border-indigo-400'
                    : 'border-slate-200 bg-slate-50 text-slate-400 hover:border-indigo-300'
                }`}>
                {rotulo}
                {confirmados.includes(m) && <span className={m === mes ? 'ml-1' : 'ml-1 text-emerald-600'}>✓</span>}
              </button>
            );
          })}
        </div>

        {/* Resumo do mês */}
        <div className="grid gap-3 sm:grid-cols-4">
          <Cartao titulo="Saldo transportado" valor={dados?.saldoTransportado ?? 0} />
          <Cartao titulo="Entradas do mês" valor={dados?.entradas ?? 0} cor="text-emerald-700" />
          <Cartao titulo="Saídas do mês" valor={dados?.saidas ?? 0} cor="text-red-700" />
          <Cartao titulo="Saldo do mês" valor={dados?.saldoFinal ?? 0} destaque />
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>
            Saldo inicial do exercício: <strong className="text-slate-700">{dinheiro(saldoInicial)}</strong>
            {ehGestor && <button onClick={editarSaldoInicial} className="ml-1 text-indigo-600 hover:underline">editar</button>}
          </span>
          {dados?.confirmado && <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700">Mês confirmado</span>}
          {ehGestor && (
            <button onClick={alternarConfirmacao} className="text-indigo-600 hover:underline">
              {dados?.confirmado ? 'desfazer confirmação do mês' : 'confirmar o mês'}
            </button>
          )}
          {ehGestor && aConferir > 0 && <span className="text-indigo-700">{aConferir} lançamento(s) a conferir neste mês</span>}
        </div>

        {negativo && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800">
            O saldo do caixa fica negativo em {diaMes(negativo.l.data)} ({dinheiro(negativo.saldo)}). Confira os
            lançamentos — o sistema não bloqueia, só avisa.
          </p>
        )}
        {semConta > 0 && (
          <p className="text-xs text-amber-700">
            {semConta} lançamento(s) sem conta. Só faz sentido em depósito ou retirada da conta corrente.
          </p>
        )}

        {/* Livro do mês */}
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-600">
                <th className="border-b px-2 py-2 text-left">Data</th>
                <th className="border-b px-2 py-2 text-left">Histórico</th>
                <th className="border-b px-2 py-2 text-left">Complemento</th>
                <th className="border-b px-2 py-2 text-left">Conta</th>
                <th className="border-b px-2 py-2 text-right">Entrada</th>
                <th className="border-b px-2 py-2 text-right">Saída</th>
                <th className="border-b px-2 py-2 text-right">Saldo</th>
                <th className="border-b px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              <tr className="text-slate-500">
                <td className="border-b px-2 py-1.5" colSpan={6}>Saldo transportado do mês anterior</td>
                <td className="border-b px-2 py-1.5 text-right font-medium">{dinheiro(dados?.saldoTransportado ?? 0)}</td>
                <td className="border-b"></td>
              </tr>

              {linhas.map(({ l, saldo }) => editandoId === l.id ? (
                <tr key={l.id} className="bg-indigo-50/40">
                  <Celulas campos={edicao} setCampos={setEdicao} contas={contas} historicos={historicos}
                    podeCriar={ehGestor} onCriar={criarConta} />
                  <td className="border-b px-2 py-1 text-right text-slate-400">—</td>
                  <td className="whitespace-nowrap border-b px-2 py-1 text-center">
                    <button onClick={salvarEdicao} disabled={salvando} className="text-indigo-600 hover:underline disabled:opacity-50">Salvar</button>
                    <button onClick={() => setEditandoId(null)} className="ml-2 text-slate-500 hover:underline">Cancelar</button>
                  </td>
                </tr>
              ) : (
                <tr key={l.id} className={l.conferidoEm ? '' : 'bg-amber-50/30'}>
                  <td className="whitespace-nowrap border-b px-2 py-1.5">{diaMes(l.data)}</td>
                  <td className="border-b px-2 py-1.5">{l.historico}</td>
                  <td className="border-b px-2 py-1.5 text-slate-500">{l.complemento}</td>
                  <td className={`border-b px-2 py-1.5 ${l.contaId ? 'text-slate-600' : 'text-amber-700'}`}>
                    {rotuloConta(contas, l.contaId)}
                  </td>
                  <td className="border-b px-2 py-1.5 text-right text-emerald-700">{l.entrada > 0 ? dinheiro(l.entrada) : ''}</td>
                  <td className="border-b px-2 py-1.5 text-right text-red-700">{l.saida > 0 ? dinheiro(l.saida) : ''}</td>
                  <td className={`border-b px-2 py-1.5 text-right font-medium ${saldo < 0 ? 'text-red-600' : 'text-slate-700'}`}>{dinheiro(saldo)}</td>
                  <td className="whitespace-nowrap border-b px-2 py-1.5 text-right">
                    {ehGestor && (
                      <label title={l.conferidoEm ? `Conferido por ${l.conferidoPor}` : 'Marcar como conferido'}
                        className="mr-2 inline-flex items-center gap-1 text-slate-500">
                        <input type="checkbox" checked={Boolean(l.conferidoEm)} onChange={(e) => conferir(l, e.target.checked)} />
                        conf.
                      </label>
                    )}
                    <button onClick={() => {
                      setEditandoId(l.id);
                      setEdicao({
                        data: l.data, historico: l.historico, complemento: l.complemento ?? '',
                        contaId: l.contaId, entrada: l.entrada > 0 ? String(l.entrada) : '',
                        saida: l.saida > 0 ? String(l.saida) : '',
                      });
                    }} className="text-indigo-600 hover:underline">Editar</button>
                    <button onClick={() => excluir(l)} className="ml-2 text-red-600 hover:underline">Excluir</button>
                  </td>
                </tr>
              ))}

              {!carregando && linhas.length === 0 && (
                <tr><td colSpan={8} className="px-2 py-6 text-center text-slate-400">
                  Nenhum lançamento em {MESES[mes - 1]}/{ano}. Comece pela linha abaixo.
                </td></tr>
              )}
            </tbody>

            <tfoot>
              <tr className="bg-slate-50">
                <Celulas campos={novo} setCampos={setNovo} contas={contas} historicos={historicos}
                  podeCriar={ehGestor} onCriar={criarConta} />
                <td className="px-2 py-1 text-right font-medium text-slate-700">{dinheiro(dados?.saldoFinal ?? 0)}</td>
                <td className="px-2 py-1 text-center">
                  <button onClick={lancar} disabled={salvando || !empresaSel}
                    className="rounded-lg bg-indigo-600 px-3 py-1 text-white disabled:opacity-50">
                    {salvando ? '…' : 'Lançar'}
                  </button>
                </td>
              </tr>
              <tr className="bg-slate-50">
                <td colSpan={8} className="px-2 pb-2 text-xs text-slate-500">
                  <label className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={cheque} onChange={(e) => setCheque(e.target.checked)} />
                    Pagamento em cheque — gera também a retirada da conta corrente (dois lançamentos)
                  </label>
                  <span className="ml-4 text-slate-400">
                    Depósito em banco é <strong>saída</strong> do caixa; retirada é <strong>entrada</strong>.
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {carregando && <p className="text-xs text-slate-400">Carregando…</p>}
      </div>
    </div>
  );
}

/** As células editáveis, iguais na linha nova e na linha em edição. */
function Celulas({ campos, setCampos, contas, historicos, podeCriar, onCriar }: {
  campos: Campos; setCampos: (c: Campos) => void; contas: Conta[]; historicos: Historico[];
  podeCriar: boolean; onCriar: (nome: string, grupo: string) => Promise<Conta | null>;
}) {
  /** Escolher um histórico padrão já traz a conta que ele sugere. */
  function mudarHistorico(texto: string) {
    const sugestao = historicos.find((h) => h.texto === texto);
    setCampos({ ...campos, historico: texto, contaId: sugestao && !campos.contaId ? sugestao.contaId : campos.contaId });
  }

  return (
    <>
      <td className="border-b px-1 py-1">
        <input type="date" value={campos.data} onChange={(e) => setCampos({ ...campos, data: e.target.value })}
          className="w-full rounded border border-slate-300 px-1 py-0.5" />
      </td>
      <td className="border-b px-1 py-1">
        <input list="historicos-caixa" value={campos.historico} onChange={(e) => mudarHistorico(e.target.value)}
          placeholder="Histórico" className="w-full min-w-40 rounded border border-slate-300 px-1 py-0.5" />
        <datalist id="historicos-caixa">
          {historicos.map((h) => <option key={h.texto} value={h.texto} />)}
        </datalist>
      </td>
      <td className="border-b px-1 py-1">
        <input value={campos.complemento} onChange={(e) => setCampos({ ...campos, complemento: e.target.value })}
          placeholder="Complemento" className="w-full min-w-32 rounded border border-slate-300 px-1 py-0.5" />
      </td>
      <td className="border-b px-1 py-1 min-w-48">
        <SeletorConta contas={contas} valor={campos.contaId} compacto
          onEscolher={(id) => setCampos({ ...campos, contaId: id })}
          podeCriar={podeCriar} onCriar={onCriar} />
      </td>
      <td className="border-b px-1 py-1">
        {/* entrada e saída se excluem: digitar numa apaga a outra */}
        <input inputMode="decimal" value={campos.entrada} placeholder="0,00"
          onChange={(e) => setCampos({ ...campos, entrada: e.target.value, saida: e.target.value ? '' : campos.saida })}
          className="w-24 rounded border border-slate-300 px-1 py-0.5 text-right" />
      </td>
      <td className="border-b px-1 py-1">
        <input inputMode="decimal" value={campos.saida} placeholder="0,00"
          onChange={(e) => setCampos({ ...campos, saida: e.target.value, entrada: e.target.value ? '' : campos.entrada })}
          className="w-24 rounded border border-slate-300 px-1 py-0.5 text-right" />
      </td>
    </>
  );
}

function Cartao({ titulo, valor, cor, destaque }: { titulo: string; valor: number; cor?: string; destaque?: boolean }) {
  return (
    <div className={`rounded-xl border bg-white p-3 ${destaque ? 'border-indigo-300' : 'border-slate-200'}`}>
      <div className="text-xs text-slate-500">{titulo}</div>
      <div className={`text-lg font-semibold ${valor < 0 ? 'text-red-600' : cor ?? 'text-slate-900'}`}>{dinheiro(valor)}</div>
    </div>
  );
}

/** A migração 0002 ainda não foi aplicada — sem `lancamentos` não há tela. */
function BancoIncompleto({ erro }: { erro: string }) {
  return (
    <div className="text-sm">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-900">Livro Caixa</h1>
        <p className="text-xs text-slate-500">O banco ainda não está pronto</p>
      </header>
      <div className="mx-auto max-w-2xl p-6">
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-900">
          <h2 className="font-semibold">Falta aplicar a migração do banco</h2>
          <p className="mt-2">
            A tabela de lançamentos não existe no Postgres. Rode
            <code className="mx-1 rounded bg-white px-1">supabase/migrations/0002_lancamentos_e_conferencia.sql</code>
            no SQL Editor do Supabase e recarregue esta página.
          </p>
          <p className="mt-2 text-xs opacity-80">Resposta do banco: {erro}</p>
        </div>
      </div>
    </div>
  );
}
