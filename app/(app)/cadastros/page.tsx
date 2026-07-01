'use client';

import { useEffect, useState } from 'react';
import { Funcionario } from '@/lib/tipos';

interface Feriado { data: string; descricao: string; }

export default function Cadastros() {
  const [funcs, setFuncs] = useState<Funcionario[]>([]);
  const [feriados, setFeriados] = useState<Feriado[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    setErro(null);
    try {
      const [rf, rh] = await Promise.all([fetch('/api/funcionarios'), fetch('/api/feriados')]);
      const df = await rf.json();
      const dh = await rh.json();
      if (!rf.ok) throw new Error(df.erro);
      if (!rh.ok) throw new Error(dh.erro);
      setFuncs(df.funcionarios ?? []);
      setFeriados(dh.feriados ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => { carregar(); }, []);

  async function salvarFuncs() {
    setMsg(null); setErro(null);
    try {
      const res = await fetch('/api/funcionarios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ funcionarios: funcs }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsg(`${d.total} funcionário(s) salvos.`);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  async function salvarFeriados() {
    setMsg(null); setErro(null);
    try {
      const res = await fetch('/api/feriados', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feriados }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsg(`${d.total} feriado(s) salvos.`);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  const setF = (i: number, campo: keyof Funcionario, v: string) =>
    setFuncs((p) => p.map((f, j) => j === i ? { ...f, [campo]: campo.startsWith('jornada') ? (v ? Number(v) : undefined) : v } : f));
  const setH = (i: number, campo: keyof Feriado, v: string) =>
    setFeriados((p) => p.map((f, j) => j === i ? { ...f, [campo]: v } : f));

  return (
    <div className="text-sm">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-900">Cadastros</h1>
        <p className="text-xs text-slate-500">Funcionários e feriados</p>
      </header>
      <div className="mx-auto max-w-4xl space-y-6 p-6">
      {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{erro}</p>}
      {msg && <p className="rounded-lg bg-green-50 px-3 py-2 text-green-700">{msg}</p>}

      {/* Funcionários */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-2 font-semibold">Funcionários</h2>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50">
              <th className="border px-1 py-1 text-left">Nome</th>
              <th className="border px-1 py-1 text-left">Cargo</th>
              <th className="border px-1 py-1">Jornada útil (min)</th>
              <th className="border px-1 py-1">Jornada sábado (min)</th>
              <th className="border px-1 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {funcs.map((f, i) => (
              <tr key={i}>
                <td className="border px-0.5"><input className="w-full px-1 py-0.5" value={f.nome}
                  onChange={(e) => setF(i, 'nome', e.target.value)} /></td>
                <td className="border px-0.5"><input className="w-full px-1 py-0.5" value={f.cargo ?? ''}
                  onChange={(e) => setF(i, 'cargo', e.target.value)} /></td>
                <td className="border px-0.5"><input className="w-full px-1 py-0.5 text-center" value={f.jornadaUtilMin ?? ''}
                  placeholder="480" onChange={(e) => setF(i, 'jornadaUtilMin', e.target.value)} /></td>
                <td className="border px-0.5"><input className="w-full px-1 py-0.5 text-center" value={f.jornadaSabadoMin ?? ''}
                  placeholder="240" onChange={(e) => setF(i, 'jornadaSabadoMin', e.target.value)} /></td>
                <td className="border px-1 text-center">
                  <button onClick={() => setFuncs((p) => p.filter((_, j) => j !== i))} className="text-xs text-red-600 hover:underline">Remover</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex gap-2">
          <button onClick={() => setFuncs((p) => [...p, { nome: '', cargo: '' }])} className="rounded-lg border border-slate-300 px-3 py-1">+ Linha</button>
          <button onClick={salvarFuncs} className="rounded-lg bg-indigo-600 px-3 py-1 text-white">Salvar funcionários</button>
        </div>
      </section>

      {/* Feriados */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-2 font-semibold">Feriados</h2>
        <p className="mb-2 text-xs text-slate-500">Data no formato AAAA-MM-DD. Usados na coluna “a cumprir” e na validação.</p>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50">
              <th className="border px-1 py-1">Data</th>
              <th className="border px-1 py-1 text-left">Descrição</th>
              <th className="border px-1 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {feriados.map((f, i) => (
              <tr key={i}>
                <td className="border px-0.5"><input type="date" className="w-full px-1 py-0.5" value={f.data}
                  onChange={(e) => setH(i, 'data', e.target.value)} /></td>
                <td className="border px-0.5"><input className="w-full px-1 py-0.5" value={f.descricao}
                  onChange={(e) => setH(i, 'descricao', e.target.value)} /></td>
                <td className="border px-1 text-center">
                  <button onClick={() => setFeriados((p) => p.filter((_, j) => j !== i))} className="text-xs text-red-600 hover:underline">Remover</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex gap-2">
          <button onClick={() => setFeriados((p) => [...p, { data: '', descricao: '' }])} className="rounded-lg border border-slate-300 px-3 py-1">+ Linha</button>
          <button onClick={salvarFeriados} className="rounded-lg bg-indigo-600 px-3 py-1 text-white">Salvar feriados</button>
        </div>
      </section>
      </div>
    </div>
  );
}
