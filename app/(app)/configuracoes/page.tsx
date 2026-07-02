'use client';

import { useEffect, useState } from 'react';

interface Usuario { email: string; nome: string; role: 'master' | 'usuario'; }

export default function Configuracoes() {
  // --- Gemini ---
  const [temChave, setTemChave] = useState(false);
  const [chave, setChave] = useState('');
  const [modelo, setModelo] = useState('gemini-2.5-flash');
  const [trabalhaSabado, setTrabalhaSabado] = useState(false);
  const [savingCfg, setSavingCfg] = useState(false);
  const [msgCfg, setMsgCfg] = useState<string | null>(null);

  // --- Usuários ---
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [novo, setNovo] = useState({ nome: '', email: '', senha: '', role: 'usuario' as 'usuario' | 'master' });
  const [savingUser, setSavingUser] = useState(false);
  const [msgUser, setMsgUser] = useState<string | null>(null);

  const [erro, setErro] = useState<string | null>(null);

  async function carregarCfg() {
    const res = await fetch('/api/config');
    const d = await res.json();
    if (res.ok) { setTemChave(d.temChave); setModelo(d.gemini_modelo || 'gemini-2.5-flash'); setTrabalhaSabado(Boolean(d.trabalha_sabado)); }
  }
  async function carregarUsuarios() {
    const res = await fetch('/api/usuarios');
    const d = await res.json();
    if (res.ok) setUsuarios(d.usuarios ?? []);
  }
  useEffect(() => { carregarCfg(); carregarUsuarios(); }, []);

  async function salvarCfg() {
    setErro(null); setMsgCfg(null); setSavingCfg(true);
    try {
      const body: Record<string, string | boolean> = { gemini_modelo: modelo, trabalha_sabado: trabalhaSabado };
      if (chave.trim()) body.gemini_api_key = chave.trim();
      const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsgCfg('Configurações salvas.'); setChave(''); carregarCfg();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setSavingCfg(false); }
  }

  async function addUsuario() {
    setErro(null); setMsgUser(null); setSavingUser(true);
    try {
      const res = await fetch('/api/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(novo) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsgUser('Usuário salvo.');
      setNovo({ nome: '', email: '', senha: '', role: 'usuario' });
      carregarUsuarios();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setSavingUser(false); }
  }

  async function removerUsuario(email: string) {
    setErro(null); setMsgUser(null);
    try {
      const res = await fetch(`/api/usuarios?email=${encodeURIComponent(email)}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      carregarUsuarios();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  const input = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100';

  return (
    <div className="text-sm">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-900">Configurações</h1>
        <p className="text-xs text-slate-500">Área restrita ao administrador</p>
      </header>

      <div className="mx-auto max-w-3xl space-y-6 p-6">
        {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{erro}</p>}

        {/* Gemini */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Leitura das folhas (Gemini)</h2>
          <p className="mt-1 text-xs text-slate-500">A chave fica guardada na planilha do Google e é usada só para ler as folhas de ponto.</p>

          <div className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block font-medium text-slate-700">Chave da API</label>
              <p className="mb-1 text-xs text-slate-500">
                {temChave ? 'Já existe uma chave salva. Preencha apenas para trocar.' : 'Nenhuma chave salva. Crie em aistudio.google.com/apikey.'}
              </p>
              <input type="password" value={chave} onChange={(e) => setChave(e.target.value)}
                placeholder={temChave ? 'manter atual' : 'AIza... ou AQ...'} className={input} />
            </div>
            <div>
              <label className="mb-1 block font-medium text-slate-700">Modelo</label>
              <select value={modelo} onChange={(e) => setModelo(e.target.value)} className={input}>
                <option value="gemini-2.5-flash">gemini-2.5-flash (rápido, grátis)</option>
                <option value="gemini-2.5-pro">gemini-2.5-pro (mais preciso)</option>
              </select>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={salvarCfg} disabled={savingCfg}
                className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50">
                {savingCfg ? 'Salvando…' : 'Salvar'}
              </button>
              {msgCfg && <span className="text-green-700">{msgCfg}</span>}
            </div>
          </div>
        </section>

        {/* Jornada */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Jornada da empresa</h2>
          <p className="mt-1 text-xs text-slate-500">Define como o sábado é tratado no cálculo e nos alertas.</p>

          <label className="mt-4 flex items-start gap-3">
            <input type="checkbox" checked={trabalhaSabado} onChange={(e) => setTrabalhaSabado(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300" />
            <span>
              <span className="font-medium text-slate-700">A empresa trabalha aos sábados</span>
              <span className="block text-xs text-slate-500">
                Desmarcado (padrão): sábado vira folga — 0h a cumprir e sem alerta de dia vazio.
                Marcado: sábado conta como dia de trabalho (4h).
              </span>
            </span>
          </label>

          <div className="mt-4 flex items-center gap-3">
            <button onClick={salvarCfg} disabled={savingCfg}
              className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50">
              {savingCfg ? 'Salvando…' : 'Salvar'}
            </button>
            {msgCfg && <span className="text-green-700">{msgCfg}</span>}
          </div>
        </section>

        {/* Usuários */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Usuários</h2>
          <p className="mt-1 text-xs text-slate-500">Cadastre quem pode acessar o sistema (ex.: a contadora).</p>

          <div className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {usuarios.length === 0 && <p className="px-3 py-3 text-slate-400">Nenhum usuário cadastrado.</p>}
            {usuarios.map((u) => (
              <div key={u.email} className="flex items-center justify-between px-3 py-2.5">
                <div>
                  <div className="font-medium text-slate-800">{u.nome}</div>
                  <div className="text-xs text-slate-500">{u.email}</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">
                    {u.role === 'master' ? 'Administrador' : 'Usuário'}
                  </span>
                  <button onClick={() => removerUsuario(u.email)} className="text-red-600 hover:underline">Remover</button>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="Nome" className={input} />
            <input value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} placeholder="E-mail" className={input} />
            <input type="password" value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} placeholder="Senha (mín. 4)" className={input} />
            <select value={novo.role} onChange={(e) => setNovo({ ...novo, role: e.target.value as 'usuario' | 'master' })} className={input}>
              <option value="usuario">Usuário</option>
              <option value="master">Administrador</option>
            </select>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={addUsuario} disabled={savingUser}
              className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white disabled:opacity-50">
              {savingUser ? 'Salvando…' : 'Adicionar usuário'}
            </button>
            {msgUser && <span className="text-green-700">{msgUser}</span>}
          </div>
        </section>
      </div>
    </div>
  );
}
