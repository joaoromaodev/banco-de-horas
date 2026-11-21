'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { IconeExcluir, IconeMenu, IconePainel } from './icones';
import { BRAND } from '@/lib/brand';
import { BotaoTema } from '@/components/tema';
import { avisoTeste, SituacaoEscritorio } from '@/lib/visibilidade';

type Modulo = 'ponto' | 'caixa';
interface EscritorioMe { id: string; nome: string; plano: string; situacao: SituacaoEscritorio; testeAte: string | null; }
interface Me {
  nome: string; email: string; role: 'master' | 'usuario' | 'cliente'; empresa: string | null; modulos: Modulo[];
  adminEscritorio?: boolean; escritorio?: EscritorioMe | null;
}
interface Item { href: string; label: string; icon: string; ativoEm?: string[]; }
interface Grupo { titulo?: string; itens: Item[]; }

const ROTULO_PAPEL: Record<Me['role'], string> = {
  master: 'Administrador',
  usuario: 'Contabilidade',
  cliente: 'Empresa cliente',
};

function Icon({ name }: { name: string }) {
  const props = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'timesheet') return <svg {...props}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>;
  if (name === 'folha') return <svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></svg>;
  if (name === 'caixa') return <svg {...props}><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 10h20M12 14h5" /></svg>;
  if (name === 'contrato') return <svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 18c1.5-2 2.5-2 3.5 0s2 2 3.5 0" /></svg>;
  if (name === 'agenda') return <svg {...props}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M8.5 15l2.5 2.5 4.5-4.5" /></svg>;
  if (name === 'equipe') return <svg {...props}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>;
  if (name === 'cadastros') return <svg {...props}><path d="M16 21v-2a4 4 0 0 0-8 0v2" /><circle cx="12" cy="7" r="4" /></svg>;
  if (name === 'config') return <svg {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
  if (name === 'logout') return <svg {...props}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>;
  return null;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [recolhido, setRecolhido] = useState(false);
  // Gaveta do menu no celular (no desktop a barra é fixa e isto não tem efeito).
  const [menuAberto, setMenuAberto] = useState(false);

  useEffect(() => {
    fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then((d) => d?.autenticado && setMe(d)).catch(() => {});
    setRecolhido(localStorage.getItem('sidebar-recolhida') === '1');
  }, []);

  useEffect(() => {
    if (!menuAberto) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuAberto(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [menuAberto]);

  function alternarBarra() {
    setRecolhido((v) => {
      const novo = !v;
      localStorage.setItem('sidebar-recolhida', novo ? '1' : '0');
      return novo;
    });
  }

  // O menu segue papel e módulos. O cliente só enxerga o Livro Caixa. Para o
  // gestor, Folha de Ponto (Timesheet + Folhas em branco) e Livro Caixa aparecem
  // só se o módulo estiver habilitado — um contador só-caixa não vê a folha.
  const temModulo = (m: Modulo) => me?.role === 'master' || (me?.modulos ?? []).includes(m);
  const grupos: Grupo[] = me?.role === 'cliente'
    ? [{ itens: [{ href: '/caixa', label: 'Livro Caixa', icon: 'caixa' }] }]
    : [
        // Folha de Ponto é um módulo só: um item na barra, e Timesheet / Folhas em
        // branco viram abas dentro dele (ver AbasPonto), como o Livro Caixa faz.
        ...(temModulo('ponto')
          ? [{ itens: [
              { href: '/', label: 'Folha de Ponto', icon: 'timesheet', ativoEm: ['/', '/folhas'] },
              // Departamento pessoal da mesma contadora: anda junto com o ponto.
              { href: '/contratos', label: 'Contrato de Experiência', icon: 'contrato' },
            ] } as Grupo]
          : []),
        ...(temModulo('caixa')
          ? [{ itens: [{ href: '/caixa', label: 'Livro Caixa', icon: 'caixa' }] } as Grupo]
          : []),
        { itens: [
          // Agenda de obrigações: da contabilidade, independe de módulo (ver docs/agenda.md).
          { href: '/agenda', label: 'Agenda', icon: 'agenda' },
          { href: '/cadastros', label: 'Cadastro', icon: 'cadastros' },
          // O administrador do escritório convida os outros contadores.
          ...(me?.role === 'usuario' && me.adminEscritorio ? [{ href: '/equipe', label: 'Equipe', icon: 'equipe' }] : []),
          ...(me?.role === 'master' ? [{ href: '/configuracoes', label: 'Configurações', icon: 'config' }] : []),
        ] },
      ];

  async function sair() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  // Fim do teste grátis: aviso discreto, sem bloquear nada (o bloqueio vem com a
  // cobrança, na Sprint 2). Só o escritório em `teste` recebe — o cliente final
  // da contabilidade não precisa saber do plano do escritório.
  const teste = me?.role === 'usuario' ? avisoTeste(me.escritorio) : null;

  const iniciais = (me?.nome ?? '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();

  // Rótulos somem só na barra recolhida do desktop; na gaveta do celular ficam.
  const soExpandido = recolhido ? 'lg:hidden' : '';
  const botaoEscuro = 'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-petroleo-100 transition-colors hover:bg-white/10 hover:text-white';

  return (
    <div className="min-h-screen lg:flex">
      <a href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[90] focus:rounded-lg focus:bg-superficie focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primaria focus:shadow-flutuante">
        Pular para o conteúdo
      </a>

      {/* Barra de topo — só no celular/tablet, onde o menu vira gaveta. */}
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-3 bg-petroleo-900 px-3 text-white [--color-foco:var(--color-petroleo-300)] lg:hidden">
        <button onClick={() => setMenuAberto(true)} aria-label="Abrir menu" aria-expanded={menuAberto} aria-controls="menu-lateral"
          className={botaoEscuro}>
          <IconeMenu />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mark.svg" alt="" className="h-7 w-7 shrink-0" />
        <span className="truncate text-sm font-semibold tracking-tight">{BRAND.nome}</span>
      </div>

      {menuAberto && (
        <div className="fixed inset-0 z-30 bg-petroleo-950/50 backdrop-blur-[2px] lg:hidden" aria-hidden="true"
          onClick={() => setMenuAberto(false)} />
      )}

      <aside id="menu-lateral" aria-label="Menu principal"
        className={`rolagem-escura fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col overflow-y-auto bg-petroleo-900 text-white transition-[transform,width] duration-200 [--color-foco:var(--color-petroleo-300)] lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          menuAberto ? 'translate-x-0 shadow-flutuante' : '-translate-x-full max-lg:invisible'
        } ${recolhido ? 'lg:w-16' : 'lg:w-60'}`}>
        <div className={`flex items-center justify-between gap-2 px-4 py-5 ${recolhido ? 'lg:justify-center lg:px-2' : ''}`}>
          <div className={`flex min-w-0 items-center gap-2.5 ${soExpandido}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.svg" alt="" className="h-8 w-8 shrink-0" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold tracking-tight">{BRAND.nome}</span>
              <span className="block truncate text-xs text-petroleo-200">{BRAND.subtitulo}</span>
            </span>
          </div>
          <button onClick={alternarBarra} data-dica={recolhido ? 'Expandir menu' : 'Recolher menu'}
            aria-label={recolhido ? 'Expandir menu' : 'Recolher menu'}
            className={`${botaoEscuro} max-lg:hidden`}>
            <IconePainel recolhido={recolhido} />
          </button>
          <button onClick={() => setMenuAberto(false)} aria-label="Fechar menu" className={`${botaoEscuro} lg:hidden`}>
            <IconeExcluir size={18} />
          </button>
        </div>

        <nav aria-label="Módulos" className="flex-1 px-3">
          {grupos.map((grupo, gi) => (
            <div key={gi} className={`space-y-1 py-2 ${gi > 0 ? 'border-t border-white/10' : ''}`}>
              {grupo.titulo && (
                <div className={`px-3 pt-1 text-[10px] font-semibold uppercase tracking-wider text-petroleo-300 ${soExpandido}`}>
                  {grupo.titulo}
                </div>
              )}
              {grupo.itens.map((item) => {
                const casa = (p: string) => (p === '/' ? pathname === '/' : pathname.startsWith(p));
                const ativo = item.ativoEm ? item.ativoEm.some(casa) : casa(item.href);
                return (
                  <a key={item.href} href={item.href} aria-current={ativo ? 'page' : undefined}
                    aria-label={item.label} data-dica={recolhido ? item.label : undefined}
                    className={`relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${recolhido ? 'lg:justify-center lg:px-0' : ''} ${
                      ativo
                        ? 'bg-white/10 font-medium text-white before:absolute before:left-0 before:top-1/2 before:h-5 before:w-[3px] before:-translate-y-1/2 before:rounded-full before:bg-verde-500'
                        : 'text-petroleo-100 hover:bg-white/5 hover:text-white'
                    }`}>
                    <span className="shrink-0"><Icon name={item.icon} /></span>
                    <span className={`truncate ${soExpandido}`}>{item.label}</span>
                  </a>
                );
              })}
            </div>
          ))}
        </nav>

        <div className={`m-3 rounded-xl bg-white/5 p-3 ring-1 ring-inset ring-white/10 ${recolhido ? 'lg:m-2 lg:p-2' : ''}`}>
          <div className={`flex items-center gap-3 ${recolhido ? 'lg:flex-col lg:gap-2' : ''}`}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-verde-700 text-sm font-semibold" aria-hidden="true">
              {iniciais}
            </div>
            <div className={`min-w-0 flex-1 ${soExpandido}`}>
              <div className="truncate text-sm font-medium">{me?.nome ?? '—'}</div>
              <div className="truncate text-xs text-petroleo-200">{me ? (me.escritorio?.nome ?? ROTULO_PAPEL[me.role]) : '—'}</div>
            </div>
            <BotaoTema className={botaoEscuro} />
            <button onClick={sair} data-dica="Sair" aria-label="Sair" className={botaoEscuro}>
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>

      <main id="conteudo" className="min-w-0 flex-1 pt-14 lg:pt-0">
        {teste && (
          <div role="status" className="border-b border-aviso-borda bg-aviso-suave px-4 py-2 text-[13px] text-aviso sm:px-6">
            {teste.acabou
              ? 'O período de teste grátis do seu escritório terminou. Por enquanto tudo continua liberado — em breve você poderá assinar um plano.'
              : `Faltam ${teste.dias} ${teste.dias === 1 ? 'dia' : 'dias'} do teste grátis do seu escritório.`}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
