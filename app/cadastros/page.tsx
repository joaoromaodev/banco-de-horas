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
    <main className="mx-auto max-w-4xl p-6 text-sm">
      <h1 className="text-2xl font-bold">Cadastros</h1>
      {erro && <p className="mt-3 rounded bg-red-50 p-2 text-red-700">{erro}</p>}
      {msg && <p className="mt-3 rounded bg-green-50 p-2 text-green-700">{msg}</p>}

      {/* Funcionários */}
      <section className="mt-6 rounded-lg border p-4">
        <h2 className="mb-2 font-semibold">Funcionários</h2>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-gray-100">
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
                  <button onClick={() => setFuncs((p) => p.filter((_, j) => j !== i))} className="text-red-600">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex gap-2">
          <button onClick={() => setFuncs((p) => [...p, { nome: '', cargo: '' }])} className="rounded border px-3 py-1">+ Linha</button>
          <button onClick={salvarFuncs} className="rounded bg-blue-600 px-3 py-1 text-white">Salvar funcionários</button>
        </div>
      </section>

      {/* Feriados */}
      <section className="mt-6 rounded-lg border p-4">
        <h2 className="mb-2 font-semibold">Feriados</h2>
        <p className="mb-2 text-xs text-gray-500">Data no formato AAAA-MM-DD. Usados na coluna “a cumprir” e na validação.</p>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-gray-100">
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
                  <button onClick={() => setFeriados((p) => p.filter((_, j) => j !== i))} className="text-red-600">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex gap-2">
          <button onClick={() => setFeriados((p) => [...p, { data: '', descricao: '' }])} className="rounded border px-3 py-1">+ Linha</button>
          <button onClick={salvarFeriados} className="rounded bg-blue-600 px-3 py-1 text-white">Salvar feriados</button>
        </div>
      </section>
    </main>
  );
}
