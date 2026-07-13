'use client';

import { useEffect, useMemo, useState } from 'react';
import { Empresa, Funcionario } from '@/lib/tipos';
import { MESES } from '@/lib/calendario';

export default function Folhas() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresa, setEmpresa] = useState('');
  const [funcList, setFuncList] = useState<Funcionario[]>([]);
  const [funcionario, setFuncionario] = useState('');
  const [ano, setAno] = useState(2026);
  const [mes, setMes] = useState(6);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/empresas').then((r) => r.json()).then((d) => {
      if (Array.isArray(d.empresas)) {
        setEmpresas(d.empresas);
        if (d.empresas.length) setEmpresa((prev) => prev || d.empresas[0].id);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!empresa) { setFuncList([]); return; }
    fetch(`/api/funcionarios?empresa=${encodeURIComponent(empresa)}`).then((r) => r.json()).then((d) => {
      if (Array.isArray(d.funcionarios)) setFuncList(d.funcionarios);
    }).catch(() => {});
  }, [empresa]);

  const empresaSel = useMemo(() => empresas.find((e) => e.id === empresa), [empresas, empresa]);

  async function baixar(url: string, nomeArquivo: string) {
    setErro(null);
    if (!empresa) { setErro('Selecione a empresa.'); return; }
    setCarregando(true);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.erro ?? 'Falha ao gerar.');
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href; a.download = nomeArquivo; a.click();
      URL.revokeObjectURL(href);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }

  function baixarFuncionario() {
    if (!funcionario) { setErro('Selecione o funcionário.'); return; }
    const url = `/api/folha?empresa=${encodeURIComponent(empresa)}&funcionario=${encodeURIComponent(funcionario)}&ano=${ano}&mes=${mes}`;
    baixar(url, `folha_${funcionario}_${MESES[mes]}_${ano}.pdf`);
  }

  function baixarLote() {
    const url = `/api/folha-lote?empresa=${encodeURIComponent(empresa)}&ano=${ano}&mes=${mes}`;
    baixar(url, `folhas_${empresaSel?.nome ?? 'empresa'}_${MESES[mes]}_${ano}.zip`);
  }

  const input = 'rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500';

  return (
    <div className="text-sm">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-900">Folhas de ponto em branco</h1>
        <p className="text-xs text-slate-500">Gere as folhas para os funcionários preencherem à mão</p>
      </header>

      <div className="space-y-6 p-6">
        {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{erro}</p>}

        <section className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-4">
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="font-medium">Empresa</span>
            <select className={input} value={empresa} onChange={(e) => { setEmpresa(e.target.value); setFuncionario(''); }}>
              {empresas.length === 0 && <option value="">— cadastre uma empresa —</option>}
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Mês</span>
            <select className={input} value={mes} onChange={(e) => setMes(Number(e.target.value))}>
              {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Ano</span>
            <input type="number" className={input} value={ano} onChange={(e) => setAno(Number(e.target.value))} />
          </label>
        </section>

        {/* Uma folha */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-2 font-semibold">Folha de um funcionário</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-medium">Funcionário</span>
              <input className={`${input} w-72`} value={funcionario} list="lista-funcs"
                onChange={(e) => setFuncionario(e.target.value)}
                placeholder={empresa ? 'Nome (ou selecione)' : 'Selecione a empresa primeiro'} />
              <datalist id="lista-funcs">
                {funcList.map((f) => <option key={f.nome} value={f.nome} />)}
              </datalist>
            </label>
            <button onClick={baixarFuncionario} disabled={carregando}
              className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50">
              {carregando ? 'Gerando…' : 'Baixar folha (PDF)'}
            </button>
          </div>
        </section>

        {/* Em lote */}
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white p-4">
          <span className="font-medium">Em lote:</span>
          <span className="text-slate-500">folhas de todos os funcionários de {empresaSel?.nome || 'empresa'} em {MESES[mes]}/{ano} →</span>
          <button onClick={baixarLote} disabled={carregando}
            className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50">
            Baixar todas (.zip)
          </button>
        </section>
      </div>
    </div>
  );
}
