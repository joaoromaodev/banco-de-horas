'use client';

// Cadastro self-service do escritório contábil — 14 dias grátis, sem cartão.
// Pública (PUBLICO no proxy). Ao criar, a sessão já vem no cookie.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BRAND } from '@/lib/brand';
import { Aviso, Botao, Entrada } from '@/components/ui';
import { SENHA_MIN } from '@/lib/auth';
import { PainelMarca } from '../login/PainelMarca';

export default function CriarConta() {
  const router = useRouter();
  const [dados, setDados] = useState({ escritorio: '', nome: '', email: '', senha: '' });
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const campo = (k: keyof typeof dados) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDados((d) => ({ ...d, [k]: e.target.value }));

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    // Validação própria (o formulário é `noValidate`: nada de balão do navegador).
    const falta = !dados.escritorio.trim() ? 'Informe o nome do escritório.'
      : !dados.nome.trim() ? 'Informe o seu nome.'
      : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(dados.email.trim()) ? 'Informe um e-mail válido.'
      : dados.senha.length < SENHA_MIN ? `A senha precisa de ao menos ${SENHA_MIN} caracteres.`
      : null;
    if (falta) {
      setErro(falta);
      return;
    }
    setCarregando(true);
    try {
      const res = await fetch('/api/criar-conta', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.erro ?? 'Não foi possível criar a conta.');
      // Escritório novo nasce sem empresas: o primeiro passo é cadastrá-las.
      router.push('/cadastros');
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      setCarregando(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-superficie">
      <PainelMarca />

      <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <form onSubmit={criar} noValidate className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.svg" alt="" className="h-10 w-10" />
            <div className="leading-tight">
              <div className="text-base font-semibold tracking-tight text-primaria">{BRAND.nome}</div>
              <div className="text-xs text-tinta-suave">{BRAND.subtitulo}</div>
            </div>
          </div>

          <h1 className="text-2xl font-semibold tracking-tight text-tinta">Criar conta grátis</h1>
          <p className="mt-1.5 text-sm text-tinta-suave">14 dias para testar tudo, sem cartão de crédito.</p>

          <div className="mt-8 space-y-5">
            <Entrada rotulo="Nome do escritório" tamanho="lg" value={dados.escritorio} onChange={campo('escritorio')} required
              maxLength={120} autoComplete="organization" placeholder="Ex.: Silva Contabilidade" />
            <Entrada rotulo="Seu nome" tamanho="lg" value={dados.nome} onChange={campo('nome')} required
              maxLength={120} autoComplete="name" />
            <Entrada rotulo="E-mail" tamanho="lg" type="email" value={dados.email} onChange={campo('email')} required
              autoComplete="email" placeholder="voce@escritorio.com" />
            <Entrada rotulo="Senha" tamanho="lg" type="password" value={dados.senha} onChange={campo('senha')}
              autoComplete="new-password" dica={`Mínimo de ${SENHA_MIN} caracteres.`} />
          </div>

          {erro && <Aviso tom="perigo" className="mt-5">{erro}</Aviso>}

          <Botao type="submit" variante="primaria" tamanho="lg" carregando={carregando} className="mt-7 w-full">
            {carregando ? 'Criando sua conta…' : 'Criar conta e entrar'}
          </Botao>

          <p className="mt-6 text-center text-sm text-tinta-suave">
            Já tem conta?{' '}
            <a href="/login" className="font-medium text-primaria-texto underline-offset-4 hover:underline">Entrar</a>
          </p>
        </form>
      </main>
    </div>
  );
}
