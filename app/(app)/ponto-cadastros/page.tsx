'use client';

import { useEffect, useState } from 'react';
import { Empresa, Funcionario } from '@/lib/tipos';
import { IconeExcluir } from '../icones';
import { AbasPonto } from '../AbasPonto';

interface Feriado { data: string; descricao: string; }

/**
 * Aba "Cadastros" do módulo Folha de Ponto. Concentra o que só serve à folha:
 * a jornada de cada empresa (e se trabalha aos sábados), os funcionários e os
 * feriados. A identidade da empresa (razão social/CNPJ) e os administradores
 * ficam no módulo Cadastro; o fiscal, no Livro Caixa.
 */
export default function PontoCadastros() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaSel, setEmpresaSel] = useState('');
  const [funcs, setFuncs] = useState<Funcionario[]>([]);
  const [feriados, setFeriados] = useState<Feriado[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function carregarEmpresas() {
    setErro(null);
    try {
      const r = await fetch('/api/empresas');
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      const lista: Empresa[] = d.empresas ?? [];
      setEmpresas(lista);
      if (!empresaSel && lista.length) setEmpresaSel(lista[0].id);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  async function carregarFuncs(empresa: string) {
    if (!empresa) { setFuncs([]); return; }
    try {
      const r = await fetch(`/api/funcionarios?empresa=${encodeURIComponent(empresa)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      setFuncs(d.funcionarios ?? []);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  async function carregarFeriados() {
    try {
      const r = await fetch('/api/feriados');
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      setFeriados(d.feriados ?? []);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  useEffect(() => { carregarEmpresas(); carregarFeriados(); }, []);
  useEffect(() => { carregarFuncs(empresaSel); }, [empresaSel]);

  async function salvarEmpresas() {
    setMsg(null); setErro(null);
    try {
      const res = await fetch('/api/empresas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresas }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsg(`Jornadas salvas em ${d.total} empresa(s).`);
      carregarEmpresas();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  async function salvarFuncs() {
    setMsg(null); setErro(null);
    if (!empresaSel) { setErro('Selecione uma empresa primeiro.'); return; }
    try {
      const res = await fetch('/api/funcionarios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa: empresaSel, funcionarios: funcs }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsg(`${d.total} funcionário(s) salvos em ${empresaSel}.`);
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

  const setE = (i: number, campo: keyof Empresa, v: string | boolean) =>
    setEmpresas((p) => p.map((e, j) => j === i
      ? { ...e, [campo]: campo.startsWith('jornada') ? (v ? Number(v) : undefined) : v }
      : e));
  const setF = (i: number, campo: keyof Funcionario, v: string) =>
    setFuncs((p) => p.map((f, j) => j === i ? { ...f, [campo]: campo.startsWith('jornada') ? (v ? Number(v) : undefined) : v } : f));
  const setH = (i: number, campo: keyof Feriado, v: string) =>
    setFeriados((p) => p.map((f, j) => j === i ? { ...f, [campo]: v } : f));

  const seletorEmpresa = (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-slate-500">Empresa:</span>
      <select value={empresaSel} onChange={(e) => setEmpresaSel(e.target.value)}
        className="rounded-lg border border-slate-300 px-2 py-1">
        {empresas.length === 0 && <option value="">— cadastre uma empresa —</option>}
        {empresas.map((e) => <option key={e.id || e.nome} value={e.id}>{e.nome}</option>)}
      </select>
    </label>
  );

  return (
    <div className="text-sm">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-900">Folha de Ponto · Cadastros</h1>
        <p className="text-xs text-slate-500">Jornada das empresas, funcionários e feriados</p>
      </header>
      <div className="space-y-6 p-6">
        <AbasPonto ativa="cadastros" />
        {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{erro}</p>}
        {msg && <p className="rounded-lg bg-green-50 px-3 py-2 text-green-700">{msg}</p>}

        {/* Jornada por empresa */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-1 font-semibold">Jornada das empresas</h2>
          <p className="mb-2 text-xs text-slate-500">
            Marque se a empresa trabalha aos sábados e defina a jornada padrão (em minutos).
            O funcionário pode sobrescrever a jornada individualmente abaixo.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50">
                  <th className="border px-1 py-1 text-left">Razão social</th>
                  <th className="border px-1 py-1">Trabalha sáb.?</th>
                  <th className="border px-1 py-1">Jornada útil (min)</th>
                  <th className="border px-1 py-1">Jornada sáb. (min)</th>
                </tr>
              </thead>
              <tbody>
                {empresas.map((e, i) => (
                  <tr key={i}>
                    <td className="border px-1 py-0.5 text-slate-700">{e.nome || <span className="text-slate-400">(sem nome)</span>}</td>
                    <td className="border px-1 text-center"><input type="checkbox" checked={e.trabalhaSabado}
                      onChange={(ev) => setE(i, 'trabalhaSabado', ev.target.checked)} /></td>
                    <td className="border px-0.5"><input className="w-full px-1 py-0.5 text-center" value={e.jornadaUtilMin ?? ''}
                      placeholder="480" onChange={(ev) => setE(i, 'jornadaUtilMin', ev.target.value)} /></td>
                    <td className="border px-0.5"><input className="w-full px-1 py-0.5 text-center" value={e.jornadaSabadoMin ?? ''}
                      placeholder="240" onChange={(ev) => setE(i, 'jornadaSabadoMin', ev.target.value)} /></td>
                  </tr>
                ))}
                {empresas.length === 0 && (
                  <tr><td colSpan={4} className="border px-2 py-3 text-center text-slate-400">Cadastre empresas no módulo Cadastro.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex gap-2">
            <button onClick={salvarEmpresas} disabled={empresas.length === 0}
              className="rounded-lg bg-petroleo-900 px-3 py-1 text-white disabled:opacity-50">Salvar jornadas</button>
          </div>
        </section>

        {/* Funcionários — por empresa */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Funcionários</h2>
            {seletorEmpresa}
          </div>
          <div className="overflow-x-auto">
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
                      <button onClick={() => setFuncs((p) => p.filter((_, j) => j !== i))}
                        title="Remover" aria-label="Remover funcionário" className="text-red-600 hover:text-red-700">
                        <IconeExcluir size={15} className="inline" />
                      </button>
                    </td>
                  </tr>
                ))}
                {empresaSel && funcs.length === 0 && (
                  <tr><td colSpan={5} className="border px-2 py-3 text-center text-slate-400">Nenhum funcionário nesta empresa.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex gap-2">
            <button onClick={() => setFuncs((p) => [...p, { empresa: empresaSel, nome: '', cargo: '' }])}
              disabled={!empresaSel} className="rounded-lg border border-slate-300 px-3 py-1 disabled:opacity-50">+ Linha</button>
            <button onClick={salvarFuncs} disabled={!empresaSel} className="rounded-lg bg-petroleo-900 px-3 py-1 text-white disabled:opacity-50">Salvar funcionários</button>
          </div>
        </section>

        {/* Feriados — globais */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-2 font-semibold">Feriados</h2>
          <p className="mb-2 text-xs text-slate-500">Data no formato AAAA-MM-DD. Valem para todas as empresas (usados na coluna “a cumprir” e na validação).</p>
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
                    <button onClick={() => setFeriados((p) => p.filter((_, j) => j !== i))}
                      title="Remover" aria-label="Remover feriado" className="text-red-600 hover:text-red-700">
                      <IconeExcluir size={15} className="inline" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex gap-2">
            <button onClick={() => setFeriados((p) => [...p, { data: '', descricao: '' }])} className="rounded-lg border border-slate-300 px-3 py-1">+ Linha</button>
            <button onClick={salvarFeriados} className="rounded-lg bg-petroleo-900 px-3 py-1 text-white">Salvar feriados</button>
          </div>
        </section>
      </div>
    </div>
  );
}
