'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BRAND, VENDAS_ABERTAS } from '@/lib/brand';
import { Aviso, Botao, Entrada } from '@/components/ui';
import { PainelMarca } from './PainelMarca';

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
      <PainelMarca />

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

          {VENDAS_ABERTAS && (
            <p className="mt-6 text-center text-sm text-tinta-suave">
              Ainda não usa o {BRAND.nome}?{' '}
              <a href="/criar-conta" className="font-medium text-primaria-texto underline-offset-4 hover:underline">Criar conta grátis</a>
            </p>
          )}
        </form>
      </main>
    </div>
  );
}
