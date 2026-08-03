'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BRAND } from '@/lib/brand';

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setCarregando(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, senha }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro ?? 'Falha no login.');
      const next = new URLSearchParams(window.location.search).get('next') || '/';
      router.push(next);
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* Painel lateral */}
      <div className="relative hidden w-1/2 flex-col justify-between p-12 text-white lg:flex hero">
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.svg" alt={BRAND.nome} className="h-9 w-9 rounded-lg" />
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">{BRAND.nome}</div>
            <div className="text-xs text-petroleo-100">{BRAND.subtitulo}</div>
          </div>
        </div>
        <div>
          <h1 className="whitespace-pre-line text-3xl font-semibold leading-tight">{BRAND.chamada}</h1>
          <p className="mt-4 max-w-sm text-sm text-petroleo-100">{BRAND.descricao}</p>
        </div>
        <div className="text-xs text-petroleo-100">© {new Date().getFullYear()} · {BRAND.nome}</div>
      </div>

      {/* Formulário */}
      <div className="flex flex-1 items-center justify-center p-6">
        <form onSubmit={entrar} className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.svg" alt={BRAND.nome} className="h-9 w-9 rounded-lg" />
            <span className="text-sm font-semibold text-petroleo-900">{BRAND.nome}</span>
          </div>
          <h2 className="text-2xl font-semibold text-petroleo-900">Entrar no painel</h2>
          <p className="mt-1 text-sm text-slate-500">Acesse com seu e-mail e senha.</p>

          <div className="mt-8 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">E-mail</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                autoComplete="username"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-petroleo-600 focus:ring-2 focus:ring-petroleo-100"
                placeholder="voce@empresa.com" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Senha</label>
              <input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required
                autoComplete="current-password"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-petroleo-600 focus:ring-2 focus:ring-petroleo-100"
                placeholder="••••••••" />
            </div>
          </div>

          {erro && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>}

          <button type="submit" disabled={carregando}
            className="mt-6 w-full rounded-lg bg-petroleo-900 py-2.5 text-sm font-medium text-white transition hover:bg-petroleo-800 disabled:opacity-50">
            {carregando ? 'Entrando…' : 'Entrar no painel'}
          </button>
        </form>
      </div>
    </div>
  );
}
