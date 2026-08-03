'use client';

import { useEffect, useState } from 'react';
import { Empresa } from '@/lib/tipos';
import { IconeExcluir } from '../icones';
import { DialogoConfirmacao } from '../Dialogo';

interface Administrador { email: string; nome: string; role: string; empresa: string | null; }

/**
 * Módulo Cadastro (lado da contabilidade). Guarda o que é transversal aos dois
 * módulos: a identidade das empresas-clientes e os administradores (papel
 * `cliente`) de cada uma. Os dados específicos de cada módulo — jornada,
 * funcionários e feriados (Folha de Ponto) e o fiscal (Livro Caixa) — vivem
 * dentro do próprio módulo, na aba "Cadastros".
 */
export default function Cadastro() {
  const [ehMaster, setEhMaster] = useState(false);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [admins, setAdmins] = useState<Administrador[]>([]);
  const [novo, setNovo] = useState({ nome: '', email: '', senha: '', empresa: '' });
  const [salvandoAdmin, setSalvandoAdmin] = useState(false);
  const [aExcluir, setAExcluir] = useState<Administrador | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function carregarEmpresas() {
    setErro(null);
    try {
      const r = await fetch('/api/empresas');
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      setEmpresas(d.empresas ?? []);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  async function carregarAdmins() {
    try {
      const r = await fetch('/api/usuarios');
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      // A rota já escopa para o contador; para o master, filtramos só os clientes.
      setAdmins((d.usuarios ?? []).filter((u: Administrador) => u.role === 'cliente'));
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  useEffect(() => {
    fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d) setEhMaster(d.role === 'master');
    }).catch(() => {});
    carregarEmpresas();
    carregarAdmins();
  }, []);

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

  async function addAdmin() {
    setMsg(null); setErro(null); setSalvandoAdmin(true);
    try {
      const res = await fetch('/api/usuarios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...novo, role: 'cliente' }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsg('Administrador salvo.');
      setNovo({ nome: '', email: '', senha: '', empresa: '' });
      carregarAdmins();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setSalvandoAdmin(false); }
  }

  async function removerAdmin(email: string) {
    setMsg(null); setErro(null); setAExcluir(null);
    try {
      const res = await fetch(`/api/usuarios?email=${encodeURIComponent(email)}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      carregarAdmins();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  const setE = (i: number, campo: keyof Empresa, v: string) =>
    setEmpresas((p) => p.map((e, j) => j === i ? { ...e, [campo]: v } : e));

  const nomeEmpresa = (id: string | null) => empresas.find((e) => e.id === id)?.nome ?? 'empresa removida';
  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-petroleo-600 focus:ring-2 focus:ring-petroleo-100';
  const colsEmpresa = 2 + (ehMaster ? 1 : 0) + 1;

  return (
    <div className="text-sm">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-900">Cadastro</h1>
        <p className="text-xs text-slate-500">
          Empresas-clientes e seus administradores. Os dados de cada módulo (jornada,
          funcionários, feriados, fiscal) ficam dentro da Folha de Ponto e do Livro Caixa.
        </p>
      </header>
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{erro}</p>}
        {msg && <p className="rounded-lg bg-green-50 px-3 py-2 text-green-700">{msg}</p>}

        {/* Identidade das empresas (compartilhada pelos dois módulos) */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-1 font-semibold">Empresas-clientes</h2>
          <p className="mb-2 text-xs text-slate-500">
            A razão social aparece no cabeçalho da planilha e no Termo.
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
            <button onClick={salvarEmpresas} className="rounded-lg bg-petroleo-900 px-3 py-1 text-white">Salvar empresas</button>
          </div>
          <p className="mt-2 text-xs text-slate-400">Dica: evite renomear uma empresa depois de cadastrar funcionários — o vínculo é pelo id interno.</p>
        </section>

        {/* Administradores da empresa (papel cliente) */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold">Administradores da empresa</h2>
          <p className="mt-1 text-xs text-slate-500">
            Você cadastra quem administra o <strong>Livro Caixa</strong> de cada empresa-cliente.
            O administrador acessa só o caixa da empresa vinculada.
          </p>

          <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {admins.length === 0 && <p className="px-3 py-3 text-slate-400">Nenhum administrador cadastrado.</p>}
            {admins.map((u) => (
              <div key={u.email} className="flex items-center justify-between px-3 py-2.5">
                <div>
                  <div className="font-medium text-slate-800">{u.nome}</div>
                  <div className="text-xs text-slate-500">{u.email}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">{nomeEmpresa(u.empresa)}</span>
                  <button onClick={() => setAExcluir(u)} title="Remover" aria-label={`Remover ${u.nome}`}
                    className="text-red-600 hover:text-red-700">
                    <IconeExcluir size={16} className="inline" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="Nome" className={input} />
            <input value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} placeholder="E-mail" className={input} />
            <input type="password" value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} placeholder="Senha (mín. 4)" className={input} />
            <select value={novo.empresa} onChange={(e) => setNovo({ ...novo, empresa: e.target.value })} className={input}>
              <option value="">Escolha a empresa…</option>
              {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={addAdmin} disabled={salvandoAdmin || !novo.empresa}
              className="rounded-lg bg-petroleo-900 px-4 py-2 font-medium text-white disabled:opacity-50">
              {salvandoAdmin ? 'Salvando…' : 'Adicionar administrador'}
            </button>
          </div>
        </section>
      </div>

      {aExcluir && (
        <DialogoConfirmacao
          titulo="Remover administrador"
          mensagem={<>Deseja realmente remover <strong>{aExcluir.nome}</strong> ({aExcluir.email})? Ele perde o acesso ao sistema.</>}
          textoConfirmar="Remover"
          onConfirmar={() => removerAdmin(aExcluir.email)}
          onCancelar={() => setAExcluir(null)}
        />
      )}
    </div>
  );
}
