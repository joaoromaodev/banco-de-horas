// Peças compartilhadas do site público (server components, sem estado).
// Mesmos papéis de cor e raios de components/ui.tsx — `botaoCls` de lá é de um
// módulo 'use client' e não pode ser chamado daqui, então o vestido de botão é
// repetido em `linkCls`.
import Link from 'next/link';
import type { Metadata } from 'next';
import { BRAND } from '@/lib/brand';

export const ROTAS = {
  conheca: '/conheca',
  planos: '/planos',
  termos: '/termos',
  privacidade: '/privacidade',
  entrar: '/login',
  criarConta: '/criar-conta',
} as const;

export const TESTE = 'Começar teste grátis de 14 dias';

type Variante = 'primaria' | 'secundaria' | 'claro' | 'vazado';
const VARIANTE: Record<Variante, string> = {
  primaria: 'bg-primaria text-sobre-primaria shadow-cartao hover:bg-primaria-hover',
  secundaria: 'border border-borda-forte/50 bg-superficie text-tinta hover:border-borda-forte hover:bg-superficie-realce',
  // sobre o painel petróleo
  claro: 'bg-white text-petroleo-900 shadow-cartao hover:bg-petroleo-50',
  vazado: 'border border-white/40 text-white hover:bg-white/10',
};
const TAMANHO = { md: 'h-9 gap-2 px-3.5 text-sm', lg: 'h-11 gap-2 px-5 text-[15px]' };

export function linkCls(variante: Variante = 'secundaria', tamanho: 'md' | 'lg' = 'md', extra = '') {
  return `inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors ${VARIANTE[variante]} ${TAMANHO[tamanho]} ${extra}`;
}

/** Metadados (title, description, Open Graph) de uma página pública. */
export function meta(titulo: string, descricao: string, caminho: string): Metadata {
  return {
    title: `${titulo} — ${BRAND.nome}`,
    description: descricao,
    alternates: { canonical: caminho },
    openGraph: {
      title: `${titulo} — ${BRAND.nome}`,
      description: descricao,
      url: caminho,
      siteName: BRAND.nome,
      locale: 'pt_BR',
      type: 'website',
    },
  };
}

export function Logo({ claro = false }: { claro?: boolean }) {
  return (
    <Link href={ROTAS.conheca} className="flex items-center gap-2.5 rounded-md">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-mark.svg" alt="" className="h-8 w-8" />
      <span className="leading-tight">
        <span className={`block text-[15px] font-semibold tracking-tight ${claro ? 'text-white' : 'text-primaria'}`}>{BRAND.nome}</span>
      </span>
    </Link>
  );
}

export function Cabecalho() {
  return (
    <header className="sticky top-0 z-20 border-b border-borda bg-superficie/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Logo />
        <nav aria-label="Principal" className="flex items-center gap-1 sm:gap-2">
          <Link href={ROTAS.conheca} className="hidden rounded-md px-3 py-2 text-sm text-tinta-suave hover:text-tinta sm:block">Conheça</Link>
          <Link href={ROTAS.planos} className="hidden rounded-md px-3 py-2 text-sm text-tinta-suave hover:text-tinta sm:block">Planos</Link>
          <Link href={ROTAS.entrar} className="rounded-md px-2.5 py-2 text-sm font-medium text-primaria-texto hover:text-tinta sm:px-3">Entrar</Link>
          <Link href={ROTAS.criarConta} className={linkCls('primaria', 'md', 'ml-1')}>
            <span className="sm:hidden">Testar grátis</span>
            <span className="hidden sm:inline">Teste grátis</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function Rodape() {
  return (
    <footer className="border-t border-borda bg-superficie">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-xs">
          <Logo />
          <p className="mt-3 text-[13px] leading-relaxed text-tinta-suave">
            O cliente lança, a IA lê, o contador confere. Feito com contadores de Belém, para escritórios pequenos.
          </p>
        </div>
        <nav aria-label="Rodapé" className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm">
          <Link href={ROTAS.conheca} className="text-tinta-suave hover:text-tinta">Conheça</Link>
          <Link href={ROTAS.termos} className="text-tinta-suave hover:text-tinta">Termos de uso</Link>
          <Link href={ROTAS.planos} className="text-tinta-suave hover:text-tinta">Planos</Link>
          <Link href={ROTAS.privacidade} className="text-tinta-suave hover:text-tinta">Privacidade</Link>
          <Link href={ROTAS.entrar} className="text-tinta-suave hover:text-tinta">Entrar</Link>
          <Link href={ROTAS.criarConta} className="text-tinta-suave hover:text-tinta">Criar conta</Link>
        </nav>
      </div>
      <div className="border-t border-borda py-4 text-center text-xs text-tinta-fraca">© 2026 {BRAND.nome} · Praticidade Contábil</div>
    </footer>
  );
}

export function Secao({ id, titulo, subtitulo, children, suave = false }: {
  id?: string; titulo: string; subtitulo?: string; children: React.ReactNode; suave?: boolean;
}) {
  return (
    <section id={id} className={suave ? 'border-y border-borda bg-superficie' : ''}>
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight text-tinta sm:text-3xl">{titulo}</h2>
          {subtitulo && <p className="mt-3 text-[15px] leading-relaxed text-tinta-suave">{subtitulo}</p>}
        </div>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}
