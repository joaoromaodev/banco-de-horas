'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BRAND } from '@/lib/brand';
import { Aviso, Botao, Entrada } from '@/components/ui';

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
    <div className="flex min-h-screen bg-superficie">
      {/* Painel da marca */}
      <div className="hero relative hidden w-[46%] max-w-2xl flex-col justify-between overflow-hidden p-12 lg:flex xl:p-16">
        {/* A marca ampliada, como marca-d'água */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mark.svg" alt="" aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -right-24 h-[26rem] w-[26rem] opacity-[0.07] brightness-0 invert" />

        <div className="relative flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.svg" alt="" className="h-10 w-10" />
          <div className="leading-tight">
            <div className="text-base font-semibold tracking-tight">{BRAND.nome}</div>
            <div className="text-xs text-petroleo-200">{BRAND.subtitulo}</div>
          </div>
        </div>

        <div className="relative">
          <span className="mb-6 block h-1 w-10 rounded-full bg-verde-500" aria-hidden="true" />
          <p className="whitespace-pre-line text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">{BRAND.chamada}</p>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-petroleo-100">{BRAND.descricao}</p>
        </div>

        <div className="relative text-xs text-petroleo-200">© {new Date().getFullYear()} · {BRAND.nome}</div>
      </div>

      {/* Formulário */}
      <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <form onSubmit={entrar} className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.svg" alt="" className="h-10 w-10" />
            <div className="leading-tight">
              <div className="text-base font-semibold tracking-tight text-primaria">{BRAND.nome}</div>
              <div className="text-xs text-tinta-suave">{BRAND.subtitulo}</div>
            </div>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-tinta">Entrar no painel</h1>
          <p className="mt-1.5 text-sm text-tinta-suave">Acesse com seu e-mail e senha.</p>

          <div className="mt-8 space-y-5">
            <Entrada rotulo="E-mail" tamanho="lg" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
              autoComplete="username" placeholder="voce@empresa.com" />
            <Entrada rotulo="Senha" tamanho="lg" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} required
              autoComplete="current-password" placeholder="••••••••" />
          </div>

          {erro && <Aviso tom="perigo" className="mt-5">{erro}</Aviso>}

          <Botao type="submit" variante="primaria" tamanho="lg" carregando={carregando} className="mt-7 w-full">
            {carregando ? 'Entrando…' : 'Entrar no painel'}
          </Botao>
        </form>
      </main>
    </div>
  );
}
