'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Empresa } from '@/lib/tipos';

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

/**
 * Aba "Cadastros" do módulo Livro Caixa. Só os dados fiscais da empresa, que
 * alimentam o Termo de Abertura. Trabalho da contabilidade — o `cliente` é
 * redirecionado para os Lançamentos.
 */
export default function CaixaCadastros() {
  const router = useRouter();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaSel, setEmpresaSel] = useState('');
  const [fiscal, setFiscal] = useState<Fiscal>(FISCAL_VAZIO);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d && d.role === 'cliente') { router.replace('/caixa'); return; }
      carregarEmpresas();
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  async function carregarFiscal(empresa: string) {
    if (!empresa) { setFiscal(FISCAL_VAZIO); return; }
    try {
      const r = await fetch(`/api/caixa/fiscal?empresa=${encodeURIComponent(empresa)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
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

  useEffect(() => { carregarFiscal(empresaSel); }, [empresaSel]);

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

  const setFi = (campo: keyof Fiscal, v: string) => setFiscal((p) => ({ ...p, [campo]: v }));
  const fInput = 'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-petroleo-600 focus:ring-2 focus:ring-petroleo-100';

  return (
    <div className="text-sm">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-900">Livro Caixa · Cadastros</h1>
        <p className="text-xs text-slate-500">Dados fiscais da empresa para o Termo de Abertura</p>
      </header>
      <div className="mx-auto max-w-4xl space-y-4 p-6">
        <nav className="flex gap-1 text-xs">
          <a href="/caixa" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:border-petroleo-500">Lançamentos</a>
          <a href="/caixa/resumo" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:border-petroleo-500">Resumo</a>
          <span className="rounded-lg border border-petroleo-700 bg-petroleo-900 px-3 py-1.5 text-white">Cadastros</span>
        </nav>

        {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{erro}</p>}
        {msg && <p className="rounded-lg bg-green-50 px-3 py-2 text-green-700">{msg}</p>}

        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Dados fiscais</h2>
            <label className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">Empresa:</span>
              <select value={empresaSel} onChange={(e) => setEmpresaSel(e.target.value)}
                className="rounded-lg border border-slate-300 px-2 py-1">
                {empresas.length === 0 && <option value="">— cadastre uma empresa —</option>}
                {empresas.map((e) => <option key={e.id || e.nome} value={e.id}>{e.nome}</option>)}
              </select>
            </label>
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
                <button onClick={salvarFiscal} className="rounded-lg bg-petroleo-900 px-3 py-1 text-white">Salvar dados fiscais</button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
