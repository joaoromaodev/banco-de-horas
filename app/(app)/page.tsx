'use client';

import { useEffect, useMemo, useState } from 'react';
import { DiaFreq, Frequencia, Funcionario, MARCADORES } from '@/lib/tipos';
import { MESES, DIAS_SEMANA, diasNoMes, diaSemana, tipoDoDia } from '@/lib/calendario';
import { validar, Alerta } from '@/lib/validacao';
import { dataBR } from '@/lib/data';
import LupaImagem from './LupaImagem';

type Campo = 'entradaManha' | 'saidaAlmoco' | 'retornoAlmoco' | 'saidaTarde';
const CAMPOS: Campo[] = ['entradaManha', 'saidaAlmoco', 'retornoAlmoco', 'saidaTarde'];
const CAMPO_LABEL: Record<Campo, string> = {
  entradaManha: 'Entrada',
  saidaAlmoco: 'Saída almoço',
  retornoAlmoco: 'Retorno',
  saidaTarde: 'Saída',
};

function gridVazio(ano: number, mes: number): DiaFreq[] {
  const N = diasNoMes(ano, mes);
  return Array.from({ length: N }, (_, i) => ({
    dia: i + 1,
    entradaManha: null,
    saidaAlmoco: null,
    retornoAlmoco: null,
    saidaTarde: null,
    marcador: null,
  }));
}

/** Mescla dias extraídos sobre um grid completo 1..N. */
function mesclar(ano: number, mes: number, dias: DiaFreq[]): DiaFreq[] {
  const base = gridVazio(ano, mes);
  const porDia = new Map(dias.map((d) => [d.dia, d]));
  return base.map((d) => ({ ...d, ...(porDia.get(d.dia) ?? {}) }));
}

export default function Home() {
  const [funcionario, setFuncionario] = useState('');
  const [ano, setAno] = useState(2026);
  const [mes, setMes] = useState(6);
  const [feriadosTxt, setFeriadosTxt] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [dias, setDias] = useState<DiaFreq[] | null>(null);
  const [incertos, setIncertos] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [funcList, setFuncList] = useState<Funcionario[]>([]);
  const [feriadosCad, setFeriadosCad] = useState<string[]>([]);

  // Carrega cadastros (funciona mesmo se a planilha não estiver configurada).
  useEffect(() => {
    fetch('/api/funcionarios').then((r) => r.json()).then((d) => {
      if (Array.isArray(d.funcionarios)) setFuncList(d.funcionarios);
    }).catch(() => {});
    fetch('/api/feriados').then((r) => r.json()).then((d) => {
      if (Array.isArray(d.feriados)) setFeriadosCad(d.feriados.map((f: { data: string }) => f.data));
    }).catch(() => {});
  }, []);

  const feriados = useMemo(
    () => new Set([
      ...feriadosCad,
      ...feriadosTxt.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean),
    ]),
    [feriadosTxt, feriadosCad],
  );

  const alertas: Alerta[] = useMemo(() => {
    if (!dias) return [];
    const freq: Frequencia = { funcionario, ano, mes, dias };
    return validar(freq, feriados);
  }, [dias, funcionario, ano, mes, feriados]);

  const alertaPorCampo = useMemo(() => {
    const m = new Map<string, Alerta>();
    for (const a of alertas) {
      const k = `${a.dia}:${a.campo}`;
      if (!m.has(k) || a.nivel === 'erro') m.set(k, a);
    }
    return m;
  }, [alertas]);

  function escolherArquivo(f: File | null) {
    setArquivo(f);
    setImgUrl(f ? URL.createObjectURL(f) : null);
  }

  async function lerFolha() {
    setErro(null);
    if (!arquivo) {
      setErro('Escolha a foto da folha primeiro.');
      return;
    }
    setCarregando(true);
    try {
      const fd = new FormData();
      fd.append('file', arquivo);
      fd.append('ano', String(ano));
      fd.append('mes', String(mes));
      if (funcionario) fd.append('funcionario', funcionario);
      const res = await fetch('/api/extrair', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro ?? 'Falha na leitura.');
      if (data.frequencia?.funcionario && !funcionario) setFuncionario(data.frequencia.funcionario);
      setDias(mesclar(ano, mes, data.frequencia.dias ?? []));
      setIncertos(new Set((data.incertos ?? []).map((c: { dia: number; campo: string }) => `${c.dia}:${c.campo}`)));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }

  function preencherManual() {
    setErro(null);
    setDias(gridVazio(ano, mes));
    setIncertos(new Set());
  }

  function editar(dia: number, campo: Campo | 'marcador', valor: string) {
    setDias((prev) =>
      (prev ?? []).map((d) =>
        d.dia === dia ? { ...d, [campo]: valor === '' ? null : valor } : d,
      ),
    );
    setIncertos((prev) => {
      const n = new Set(prev);
      n.delete(`${dia}:${campo}`);
      return n;
    });
  }

  async function baixar() {
    setErro(null);
    if (!funcionario) {
      setErro('Informe o nome do funcionário.');
      return;
    }
    setCarregando(true);
    try {
      const freq: Frequencia = { funcionario, ano, mes, dias: dias ?? [] };
      const res = await fetch('/api/gerar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frequencia: freq, feriados: [...feriados] }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.erro ?? 'Falha ao gerar.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${funcionario}_${MESES[mes]}_${ano}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }

  async function salvarSheets() {
    setErro(null);
    setAviso(null);
    if (!funcionario) {
      setErro('Informe o nome do funcionário.');
      return;
    }
    setCarregando(true);
    try {
      const freq: Frequencia = { funcionario, ano, mes, dias: dias ?? [] };
      const res = await fetch('/api/salvar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frequencia: freq }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro ?? 'Falha ao salvar.');
      setAviso(`Salvo no Google Sheets: ${data.dias} dia(s) de ${funcionario} (${MESES[mes]}/${ano}).`);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }

  async function gerarLote() {
    setErro(null);
    setAviso(null);
    setCarregando(true);
    try {
      const res = await fetch(`/api/gerar-lote?ano=${ano}&mes=${mes}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.erro ?? 'Falha ao gerar lote.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `planilhas_${MESES[mes]}_${ano}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }

  const nErros = alertas.filter((a) => a.nivel === 'erro').length;
  const nAlertas = alertas.filter((a) => a.nivel === 'alerta').length;

  return (
    <div className="text-sm">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Timesheet</h1>
          <p className="text-xs text-slate-500">Suba a folha, revise e gere a planilha</p>
        </div>
        <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-600">{dataBR()}</span>
      </header>
      <div className="space-y-6 p-6">

      <section className="mt-6 grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-4">
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="font-medium">Funcionário</span>
          <input className="rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500" value={funcionario} list="lista-funcs"
            onChange={(e) => setFuncionario(e.target.value)} placeholder="Nome completo (ou selecione)" />
          <datalist id="lista-funcs">
            {funcList.map((f) => <option key={f.nome} value={f.nome} />)}
          </datalist>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Mês</span>
          <select className="rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500" value={mes}
            onChange={(e) => setMes(Number(e.target.value))}>
            {MESES.slice(1).map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Ano</span>
          <input type="number" className="rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500" value={ano}
            onChange={(e) => setAno(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="font-medium">Foto da folha</span>
          <input type="file" accept="image/*" className="rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500"
            onChange={(e) => escolherArquivo(e.target.files?.[0] ?? null)} />
        </label>
        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="font-medium">Feriados extras (opcional)</span>
          <input className="rounded-lg border border-slate-300 px-3 py-2 outline-none focus:border-indigo-500" value={feriadosTxt}
            onChange={(e) => setFeriadosTxt(e.target.value)}
            placeholder={feriadosCad.length ? `${feriadosCad.length} do cadastro + extras aqui` : 'AAAA-MM-DD, ex.: 2026-06-19'} />
        </label>
        <div className="flex items-end gap-2 md:col-span-4">
          <button onClick={lerFolha} disabled={carregando}
            className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50">
            {carregando ? 'Lendo…' : 'Ler folha (OCR)'}
          </button>
          <button onClick={preencherManual}
            className="rounded-lg border border-slate-300 px-4 py-2 font-medium">
            Preencher manualmente
          </button>
        </div>
      </section>

      <section className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white p-4">
        <span className="font-medium">Gerar em lote:</span>
        <span className="text-slate-500">todas as planilhas de {MESES[mes]}/{ano} salvas no banco →</span>
        <button onClick={gerarLote} disabled={carregando}
          className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50">
          Baixar todas (.zip)
        </button>
      </section>

      {erro && <p className="mt-4 rounded bg-red-50 p-3 text-red-700">{erro}</p>}

      {dias && (
        <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="lg:sticky lg:top-4 lg:self-start">
            <h2 className="mb-2 font-semibold">Folha original</h2>
            {imgUrl
              ? <LupaImagem src={imgUrl} />
              : <p className="text-slate-400">Sem imagem (preenchimento manual).</p>}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">Revisão — {MESES[mes]}/{ano}</h2>
              <span className="text-xs">
                {nErros > 0 && <b className="text-red-600">{nErros} erro(s) </b>}
                {nAlertas > 0 && <b className="text-amber-600">{nAlertas} alerta(s)</b>}
                {nErros + nAlertas === 0 && <b className="text-green-600">tudo certo</b>}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="border px-1 py-1">Dia</th>
                    {CAMPOS.map((c) => <th key={c} className="border px-1 py-1">{CAMPO_LABEL[c]}</th>)}
                    <th className="border px-1 py-1">Marcador</th>
                  </tr>
                </thead>
                <tbody>
                  {dias.map((d) => {
                    const wd = diaSemana(ano, mes, d.dia);
                    const tipo = tipoDoDia(ano, mes, d.dia, feriados);
                    const fds = wd === 0 || wd === 6 || tipo === 'feriado';
                    const geral = alertaPorCampo.get(`${d.dia}:geral`);
                    return (
                      <tr key={d.dia} className={fds ? 'bg-slate-50' : ''}>
                        <td className="border px-1 py-0.5 text-center" title={DIAS_SEMANA[wd]}>
                          <b>{d.dia}</b>
                          <span className="ml-1 text-[10px] text-slate-400">{DIAS_SEMANA[wd].slice(0, 3)}</span>
                        </td>
                        {CAMPOS.map((campo) => {
                          const k = `${d.dia}:${campo}`;
                          const a = alertaPorCampo.get(k);
                          const inc = incertos.has(k);
                          const cls = a?.nivel === 'erro'
                            ? 'border-red-500 bg-red-50'
                            : inc || a?.nivel === 'alerta'
                              ? 'border-amber-400 bg-amber-50'
                              : 'border-slate-300';
                          return (
                            <td key={campo} className="border px-0.5 py-0.5">
                              <input
                                value={(d[campo] as string) ?? ''}
                                onChange={(e) => editar(d.dia, campo, e.target.value)}
                                placeholder="--:--"
                                title={a?.msg ?? (inc ? 'Leitura incerta — confira' : '')}
                                className={`w-16 rounded border px-1 py-0.5 text-center ${cls}`}
                              />
                            </td>
                          );
                        })}
                        <td className="border px-0.5 py-0.5">
                          <select value={d.marcador ?? ''}
                            onChange={(e) => editar(d.dia, 'marcador', e.target.value)}
                            className="w-28 rounded border border-slate-300 px-1 py-0.5">
                            <option value="">—</option>
                            {MARCADORES.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                          {geral && <div className="mt-0.5 text-[10px] text-amber-600">{geral.msg}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button onClick={baixar} disabled={carregando || nErros > 0}
                className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50"
                title={nErros > 0 ? 'Corrija os erros antes de baixar' : ''}>
                Baixar planilha (.xlsx)
              </button>
              <button onClick={salvarSheets} disabled={carregando || nErros > 0}
                className="rounded border border-indigo-600 px-4 py-2 font-medium text-indigo-700 disabled:opacity-50"
                title={nErros > 0 ? 'Corrija os erros antes de salvar' : ''}>
                Salvar no banco (Sheets)
              </button>
            </div>
            {aviso && <p className="mt-2 rounded bg-green-50 p-2 text-indigo-700">{aviso}</p>}
          </div>
        </section>
      )}
      </div>
    </div>
  );
}
