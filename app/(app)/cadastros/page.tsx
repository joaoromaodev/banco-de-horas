'use client';

import { useEffect, useState } from 'react';
import { Empresa, Funcionario } from '@/lib/tipos';
import { IconeExcluir } from '../icones';

interface Feriado { data: string; descricao: string; }
type Modulo = 'ponto' | 'caixa';

/** Espelha DadosFiscais de lib/caixa (camelCase). */
interface Fiscal {
  endereco: string | null; numeroEndereco: string | null;
  municipio: string | null; estado: string | null;
  inscricaoEstadual: string | null; inscricaoMunicipal: string | null;
  registroJunta: string | null; registroNumero: string | null;
  prefeitura: string | null; cidadeTermo: string | null;
  contabilista: string; crc: string;
}

const FISCAL_VAZIO: Fiscal = {
  endereco: '', numeroEndereco: '', municipio: '', estado: '',
  inscricaoEstadual: '', inscricaoMunicipal: '', registroJunta: '', registroNumero: '',
  prefeitura: '', cidadeTermo: '', contabilista: 'Edilse Goes da Costa', crc: '01619/0-3',
};

export default function Cadastros() {
  const [ehMaster, setEhMaster] = useState(false);
  const [modulos, setModulos] = useState<Modulo[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaSel, setEmpresaSel] = useState('');
  const [funcs, setFuncs] = useState<Funcionario[]>([]);
  const [feriados, setFeriados] = useState<Feriado[]>([]);
  const [fiscal, setFiscal] = useState<Fiscal>(FISCAL_VAZIO);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const temPonto = ehMaster || modulos.includes('ponto');
  const temCaixa = ehMaster || modulos.includes('caixa');

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
    if (!empresa || !temPonto) { setFuncs([]); return; }
    try {
      const r = await fetch(`/api/funcionarios?empresa=${encodeURIComponent(empresa)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      setFuncs(d.funcionarios ?? []);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  async function carregarFiscal(empresa: string) {
    if (!empresa || !temCaixa) { setFiscal(FISCAL_VAZIO); return; }
    try {
      const r = await fetch(`/api/caixa/fiscal?empresa=${encodeURIComponent(empresa)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      // normaliza nulls para '' (inputs controlados)
      const f = d.fiscal as Fiscal;
      setFiscal({
        endereco: f.endereco ?? '', numeroEndereco: f.numeroEndereco ?? '',
        municipio: f.municipio ?? '', estado: f.estado ?? '',
        inscricaoEstadual: f.inscricaoEstadual ?? '', inscricaoMunicipal: f.inscricaoMunicipal ?? '',
        registroJunta: f.registroJunta ?? '', registroNumero: f.registroNumero ?? '',
        prefeitura: f.prefeitura ?? '', cidadeTermo: f.cidadeTermo ?? '',
        contabilista: f.contabilista || FISCAL_VAZIO.contabilista, crc: f.crc || FISCAL_VAZIO.crc,
      });
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  async function carregarFeriados() {
    if (!temPonto) return;
    try {
      const r = await fetch('/api/feriados');
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      setFeriados(d.feriados ?? []);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  useEffect(() => {
    fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setEhMaster(d.role === 'master');
      setModulos(d.modulos ?? []);
    }).catch(() => {});
    carregarEmpresas();
  }, []);
  // feriados dependem de saber os módulos (só de ponto)
  useEffect(() => { carregarFeriados(); }, [temPonto]);
  useEffect(() => { carregarFuncs(empresaSel); carregarFiscal(empresaSel); }, [empresaSel, temPonto, temCaixa]);

  async function salvarEmpresas() {
    setMsg(null); setErro(null);
    try {
      const res = await fetch('/api/empresas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresas }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsg(`${d.total} empresa(s) salvas.`);
      carregarEmpresas();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  async function salvarFiscal() {
    setMsg(null); setErro(null);
    if (!empresaSel) { setErro('Selecione uma empresa primeiro.'); return; }
    try {
      const res = await fetch('/api/caixa/fiscal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa: empresaSel, fiscal }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsg('Dados fiscais salvos.');
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
  const setFi = (campo: keyof Fiscal, v: string) => setFiscal((p) => ({ ...p, [campo]: v }));

  // nº de colunas da tabela de empresas (ponto acrescenta 3; master, +1)
  const colsEmpresa = 3 + (temPonto ? 3 : 0) + (ehMaster ? 1 : 0);
  const fInput = 'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';

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
        <h1 className="text-lg font-semibold text-slate-900">Cadastros</h1>
        <p className="text-xs text-slate-500">
          Empresas-clientes{temCaixa && ', seus dados fiscais'}{temPonto && ', funcionários e feriados'}
        </p>
      </header>
      <div className="mx-auto max-w-4xl space-y-6 p-6">
      {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{erro}</p>}
      {msg && <p className="rounded-lg bg-green-50 px-3 py-2 text-green-700">{msg}</p>}

      {/* Identidade das empresas (compartilhada pelos dois módulos) */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-1 font-semibold">Empresas-clientes</h2>
        <p className="mb-2 text-xs text-slate-500">
          O nome (razão social) aparece no cabeçalho da planilha e no Termo.
          {temPonto && ' Marque se a empresa trabalha aos sábados.'}
          {ehMaster
            ? ' Como administrador, você vê as empresas de todos os contadores e define o responsável de cada uma.'
            : ' Você vê e edita apenas as suas empresas.'}
        </p>
        <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-50">
              <th className="border px-1 py-1 text-left">Razão social</th>
              <th className="border px-1 py-1 text-left">CNPJ</th>
              {temPonto && <th className="border px-1 py-1">Trabalha sáb.?</th>}
              {temPonto && <th className="border px-1 py-1">Jornada útil (min)</th>}
              {temPonto && <th className="border px-1 py-1">Jornada sáb. (min)</th>}
              {ehMaster && <th className="border px-1 py-1 text-left">Contador responsável</th>}
              <th className="border px-1 py-1"></th>
            </tr>
          </thead>
          <tbody>
            {empresas.map((e, i) => (
              <tr key={i}>
                <td className="border px-0.5"><input className="w-full px-1 py-0.5" value={e.nome}
                  onChange={(ev) => setE(i, 'nome', ev.target.value)} /></td>
                <td className="border px-0.5"><input className="w-full px-1 py-0.5" value={e.cnpj ?? ''}
                  onChange={(ev) => setE(i, 'cnpj', ev.target.value)} /></td>
                {temPonto && (
                  <td className="border px-1 text-center"><input type="checkbox" checked={e.trabalhaSabado}
                    onChange={(ev) => setE(i, 'trabalhaSabado', ev.target.checked)} /></td>
                )}
                {temPonto && (
                  <td className="border px-0.5"><input className="w-full px-1 py-0.5 text-center" value={e.jornadaUtilMin ?? ''}
                    placeholder="480" onChange={(ev) => setE(i, 'jornadaUtilMin', ev.target.value)} /></td>
                )}
                {temPonto && (
                  <td className="border px-0.5"><input className="w-full px-1 py-0.5 text-center" value={e.jornadaSabadoMin ?? ''}
                    placeholder="240" onChange={(ev) => setE(i, 'jornadaSabadoMin', ev.target.value)} /></td>
                )}
                {ehMaster && (
                  <td className="border px-0.5"><input className="w-full px-1 py-0.5" value={e.contador ?? ''}
                    placeholder="e-mail do contador" onChange={(ev) => setE(i, 'contador', ev.target.value)} /></td>
                )}
                <td className="border px-1 text-center">
                  <button onClick={() => setEmpresas((p) => p.filter((_, j) => j !== i))}
                    title="Remover" aria-label="Remover empresa" className="text-red-600 hover:text-red-700">
                    <IconeExcluir size={15} className="inline" />
                  </button>
                </td>
              </tr>
            ))}
            {empresas.length === 0 && (
              <tr><td colSpan={colsEmpresa} className="border px-2 py-3 text-center text-slate-400">Nenhuma empresa cadastrada.</td></tr>
            )}
          </tbody>
        </table>
        </div>
        <div className="mt-2 flex gap-2">
          <button onClick={() => setEmpresas((p) => [...p, { id: '', nome: '', cnpj: '', trabalhaSabado: false }])} className="rounded-lg border border-slate-300 px-3 py-1">+ Empresa</button>
          <button onClick={salvarEmpresas} className="rounded-lg bg-indigo-600 px-3 py-1 text-white">Salvar empresas</button>
        </div>
        <p className="mt-2 text-xs text-slate-400">Dica: evite renomear uma empresa depois de cadastrar funcionários — o vínculo é pelo nome.</p>
      </section>

      {/* Dados fiscais (Livro Caixa) — por empresa, alimentam o Termo de Abertura */}
      {temCaixa && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Dados fiscais <span className="font-normal text-slate-400">· Livro Caixa</span></h2>
            {seletorEmpresa}
          </div>
          <p className="mb-3 text-xs text-slate-500">
            Usados no Termo de Abertura do livro. Preencha uma vez por empresa — valem para todos os anos.
            O número do livro, o número de ordem e a data do termo são por exercício e ficam na tela do caixa.
          </p>
          {!empresaSel ? (
            <p className="text-slate-400">Cadastre e selecione uma empresa para preencher o fiscal.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2 grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="mb-1 block text-xs font-medium text-slate-600">Endereço</label>
                    <input className={fInput} value={fiscal.endereco ?? ''} onChange={(e) => setFi('endereco', e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">Número</label>
                    <input className={fInput} value={fiscal.numeroEndereco ?? ''} onChange={(e) => setFi('numeroEndereco', e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="mb-1 block text-xs font-medium text-slate-600">Município</label>
                    <input className={fInput} value={fiscal.municipio ?? ''} onChange={(e) => setFi('municipio', e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-600">UF</label>
                    <input className={fInput} maxLength={2} value={fiscal.estado ?? ''} onChange={(e) => setFi('estado', e.target.value.toUpperCase())} />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Inscrição estadual</label>
                  <input className={fInput} value={fiscal.inscricaoEstadual ?? ''} onChange={(e) => setFi('inscricaoEstadual', e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Inscrição municipal</label>
                  <input className={fInput} value={fiscal.inscricaoMunicipal ?? ''} onChange={(e) => setFi('inscricaoMunicipal', e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Registro na Junta (órgão)</label>
                  <input className={fInput} placeholder="ex.: JUCEPA" value={fiscal.registroJunta ?? ''} onChange={(e) => setFi('registroJunta', e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Sob o número</label>
                  <input className={fInput} value={fiscal.registroNumero ?? ''} onChange={(e) => setFi('registroNumero', e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Prefeitura</label>
                  <input className={fInput} value={fiscal.prefeitura ?? ''} onChange={(e) => setFi('prefeitura', e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Cidade do termo</label>
                  <input className={fInput} list="cidades-termo" placeholder="Belém ou Castanhal" value={fiscal.cidadeTermo ?? ''} onChange={(e) => setFi('cidadeTermo', e.target.value)} />
                  <datalist id="cidades-termo"><option value="Belém" /><option value="Castanhal" /></datalist>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Contabilista</label>
                  <input className={fInput} value={fiscal.contabilista} onChange={(e) => setFi('contabilista', e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">CRC</label>
                  <input className={fInput} value={fiscal.crc} onChange={(e) => setFi('crc', e.target.value)} />
                </div>
              </div>
              <div className="mt-3">
                <button onClick={salvarFiscal} className="rounded-lg bg-indigo-600 px-3 py-1 text-white">Salvar dados fiscais</button>
              </div>
            </>
          )}
        </section>
      )}

      {/* Funcionários — só do módulo Folha de Ponto */}
      {temPonto && (
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Funcionários <span className="font-normal text-slate-400">· Folha de Ponto</span></h2>
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
          <button onClick={salvarFuncs} disabled={!empresaSel} className="rounded-lg bg-indigo-600 px-3 py-1 text-white disabled:opacity-50">Salvar funcionários</button>
        </div>
      </section>
      )}

      {/* Feriados — só do módulo Folha de Ponto */}
      {temPonto && (
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-2 font-semibold">Feriados <span className="font-normal text-slate-400">· Folha de Ponto</span></h2>
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
          <button onClick={salvarFeriados} className="rounded-lg bg-indigo-600 px-3 py-1 text-white">Salvar feriados</button>
        </div>
      </section>
      )}
      </div>
    </div>
  );
}
