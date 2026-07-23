'use client';

// Livro Caixa — resumo do exercício (Fase 4).
//
// Escopo reduzido por decisão dela: era para ser o Balanço Financeiro em débitos
// × créditos e ela dispensou — *é um livro caixa, ela só analisa o saldo final:
// o que entrou, o que saiu e o saldo de um mês para o outro*. É exatamente essa
// a tabela abaixo.
//
// Para o cliente, o resumo só aparece depois que a contabilidade confirma o mês.
// Quem aplica esse recorte é a rota; aqui a tela só mostra o que veio.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { dinheiro, MESES_LONGOS } from '../formato';
import { EntradasSaidas, EvolucaoSaldo, PontoMes } from './Graficos';

interface Me { nome: string; email: string; role: 'master' | 'usuario' | 'cliente'; empresa: string | null; }
interface Empresa { id: string; nome: string; }

interface MesResumo extends PontoMes {
  saldoTransportado: number | null;
  confirmado: boolean;
  liberado: boolean;
}
interface Resumo {
  ano: number;
  saldoInicial: number;
  meses: MesResumo[];
  liberadoAte: number;
  total: { entradas: number; saidas: number; saldoFinal: number };
}

const PRIMEIRO_EXERCICIO = 2026;

const faltaMigracao = (msg: string) => /could not find the table|does not exist|schema cache/i.test(msg);

export default function ResumoCaixa() {
  const [me, setMe] = useState<Me | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaSel, setEmpresaSel] = useState('');
  const [ano, setAno] = useState(() => Math.max(new Date().getFullYear(), PRIMEIRO_EXERCICIO));
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ehGestor = me?.role === 'master' || me?.role === 'usuario';
  const anos = useMemo(() => {
    const ultimo = Math.max(new Date().getFullYear() + 1, PRIMEIRO_EXERCICIO);
    return Array.from({ length: ultimo - PRIMEIRO_EXERCICIO + 1 }, (_, i) => PRIMEIRO_EXERCICIO + i);
  }, []);

  useEffect(() => {
    fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then((d) => d?.autenticado && setMe(d)).catch(() => {});
    fetch('/api/empresas').then((r) => (r.ok ? r.json() : null)).then((d) => {
      const lista: Empresa[] = d?.empresas ?? [];
      setEmpresas(lista);
      setEmpresaSel((atual) => atual || lista[0]?.id || '');
    }).catch(() => {});
  }, []);

  const carregar = useCallback(async () => {
    if (!empresaSel) return;
    setCarregando(true); setErro(null);
    try {
      const r = await fetch(`/api/caixa/resumo?empresa=${encodeURIComponent(empresaSel)}&ano=${ano}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      setResumo(d);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [empresaSel, ano]);

  useEffect(() => { carregar(); }, [carregar]);

  const meses = resumo?.meses ?? [];
  const nenhumLiberado = resumo != null && resumo.liberadoAte === 0;

  if (erro && faltaMigracao(erro)) {
    return (
      <Moldura ehGestor={ehGestor} empresas={empresas} empresaSel={empresaSel} setEmpresaSel={setEmpresaSel}
        ano={ano} setAno={setAno} anos={anos}>
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-900">
          <h2 className="font-semibold">Falta aplicar a migração do banco</h2>
          <p className="mt-2">
            Rode <code className="rounded bg-white px-1">supabase/migrations/0002_lancamentos_e_conferencia.sql</code>
            {' '}no SQL Editor do Supabase e recarregue.
          </p>
        </div>
      </Moldura>
    );
  }

  return (
    <Moldura ehGestor={ehGestor} empresas={empresas} empresaSel={empresaSel} setEmpresaSel={setEmpresaSel}
      ano={ano} setAno={setAno} anos={anos}>
      {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{erro}</p>}

      {nenhumLiberado && !ehGestor && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
          O resumo aparece aqui quando a contabilidade confirmar o mês. Seus lançamentos continuam
          disponíveis em <a href="/caixa" className="text-indigo-600 hover:underline">Lançamentos</a>.
        </p>
      )}

      {/* Números do exercício */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Cartao titulo="Saldo inicial do exercício" valor={resumo?.saldoInicial ?? 0} />
        <Cartao titulo="Entradas no ano" valor={resumo?.total.entradas ?? 0} cor="text-emerald-700" />
        <Cartao titulo="Saídas no ano" valor={resumo?.total.saidas ?? 0} cor="text-red-700" />
        <Cartao titulo="Saldo atual" valor={resumo?.total.saldoFinal ?? 0} destaque />
      </div>

      {resumo && resumo.liberadoAte < 12 && (
        <p className="text-xs text-slate-500">
          {ehGestor
            ? 'Os totais do ano somam todos os meses — o cliente só vê até o último mês confirmado.'
            : `Totais até ${MESES_LONGOS[Math.max(resumo.liberadoAte, 1) - 1].toLowerCase()}, o último mês confirmado pela contabilidade.`}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-1 font-semibold text-slate-900">Evolução do saldo</h2>
          <p className="mb-2 text-xs text-slate-500">Saldo do caixa no fim de cada mês.</p>
          <EvolucaoSaldo meses={meses} saldoInicial={resumo?.saldoInicial ?? 0} />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-1 font-semibold text-slate-900">Entradas e saídas por mês</h2>
          <p className="mb-2 text-xs text-slate-500">O movimento de cada mês, sem acumular.</p>
          <EntradasSaidas meses={meses} />
        </section>
      </div>

      {/* A tabela é a versão textual dos gráficos — e o que ela confere de fato */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-600">
              <th className="border-b px-3 py-2 text-left">Mês</th>
              <th className="border-b px-3 py-2 text-right">Saldo transportado</th>
              <th className="border-b px-3 py-2 text-right">Entradas</th>
              <th className="border-b px-3 py-2 text-right">Saídas</th>
              <th className="border-b px-3 py-2 text-right">Saldo do mês</th>
              <th className="border-b px-3 py-2 text-center">Situação</th>
            </tr>
          </thead>
          <tbody>
            {meses.map((m) => (
              <tr key={m.mes} className={m.liberado ? '' : 'text-slate-400'}>
                <td className="border-b px-3 py-1.5">{MESES_LONGOS[m.mes - 1]}</td>
                <td className="border-b px-3 py-1.5 text-right">{m.saldoTransportado == null ? '—' : dinheiro(m.saldoTransportado)}</td>
                <td className="border-b px-3 py-1.5 text-right text-emerald-700">{m.entradas ? dinheiro(m.entradas) : m.liberado ? '' : '—'}</td>
                <td className="border-b px-3 py-1.5 text-right text-red-700">{m.saidas ? dinheiro(m.saidas) : m.liberado ? '' : '—'}</td>
                <td className={`border-b px-3 py-1.5 text-right font-medium ${(m.saldoFinal ?? 0) < 0 ? 'text-red-600' : ''}`}>
                  {m.saldoFinal == null ? '—' : dinheiro(m.saldoFinal)}
                </td>
                <td className="border-b px-3 py-1.5 text-center">
                  {m.confirmado
                    ? <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700">confirmado</span>
                    : <span className="text-slate-400">em aberto</span>}
                </td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-medium">
              <td className="px-3 py-2">Total do exercício</td>
              <td className="px-3 py-2 text-right text-slate-500">{dinheiro(resumo?.saldoInicial ?? 0)}</td>
              <td className="px-3 py-2 text-right text-emerald-700">{dinheiro(resumo?.total.entradas ?? 0)}</td>
              <td className="px-3 py-2 text-right text-red-700">{dinheiro(resumo?.total.saidas ?? 0)}</td>
              <td className="px-3 py-2 text-right">{dinheiro(resumo?.total.saldoFinal ?? 0)}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>

      {carregando && <p className="text-xs text-slate-400">Carregando…</p>}
    </Moldura>
  );
}

/** Cabeçalho e seletores, iguais aos da tela de lançamentos. */
function Moldura({ ehGestor, empresas, empresaSel, setEmpresaSel, ano, setAno, anos, children }: {
  ehGestor: boolean; empresas: Empresa[]; empresaSel: string; setEmpresaSel: (v: string) => void;
  ano: number; setAno: (v: number) => void; anos: number[]; children: React.ReactNode;
}) {
  return (
    <div className="text-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Livro Caixa — resumo</h1>
          <p className="text-xs text-slate-500">Entradas, saídas e o saldo de um mês para o outro</p>
        </div>
        <div className="flex items-center gap-2">
          {ehGestor && (
            <select value={empresaSel} onChange={(e) => setEmpresaSel(e.target.value)}
              className="rounded-lg border border-slate-300 px-2 py-1">
              {empresas.length === 0 && <option value="">— nenhuma empresa —</option>}
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          )}
          <select value={ano} onChange={(e) => setAno(Number(e.target.value))}
            className="rounded-lg border border-slate-300 px-2 py-1">
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </header>

      <div className="space-y-4 p-6">
        <nav className="flex gap-1 text-xs">
          <a href="/caixa" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:border-indigo-400">Lançamentos</a>
          <span className="rounded-lg border border-indigo-600 bg-indigo-600 px-3 py-1.5 text-white">Resumo</span>
        </nav>
        {children}
      </div>
    </div>
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
