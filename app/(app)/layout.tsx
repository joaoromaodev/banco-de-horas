'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

interface Me { nome: string; email: string; role: 'master' | 'usuario' | 'cliente'; empresa: string | null; }

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
  if (name === 'cadastros') return <svg {...props}><path d="M16 21v-2a4 4 0 0 0-8 0v2" /><circle cx="12" cy="7" r="4" /></svg>;
  if (name === 'config') return <svg {...props}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>;
  if (name === 'logout') return <svg {...props}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>;
  return null;
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then((d) => d?.autenticado && setMe(d)).catch(() => {});
  }, []);

  // O cliente só enxerga o livro caixa; o resto é da contabilidade.
  const nav = me?.role === 'cliente'
    ? [{ href: '/caixa', label: 'Livro Caixa', icon: 'caixa' }]
    : [
        { href: '/', label: 'Timesheet', icon: 'timesheet' },
        { href: '/folhas', label: 'Folhas em branco', icon: 'folha' },
        { href: '/caixa', label: 'Livro Caixa', icon: 'caixa' },
        { href: '/cadastros', label: 'Cadastros', icon: 'cadastros' },
        ...(me?.role === 'master' ? [{ href: '/configuracoes', label: 'Configurações', icon: 'config' }] : []),
      ];

  async function sair() {
    await fetch('/api/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const iniciais = (me?.nome ?? '?').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col bg-[#1b2559] text-white">
        <div className="px-6 py-6">
          <div className="text-lg font-semibold tracking-tight">Banco de Horas</div>
          <div className="text-xs text-indigo-300">Folha de ponto</div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {nav.map((item) => {
            const ativo = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <a key={item.href} href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                  ativo ? 'bg-white/10 font-medium text-white' : 'text-indigo-200 hover:bg-white/5 hover:text-white'
                }`}>
                <Icon name={item.icon} />
                {item.label}
              </a>
            );
          })}
        </nav>

        <div className="m-3 rounded-lg bg-white/5 p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500 text-sm font-semibold">
              {iniciais}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{me?.nome ?? '—'}</div>
              <div className="truncate text-xs text-indigo-300">{me ? ROTULO_PAPEL[me.role] : '—'}</div>
            </div>
            <button onClick={sair} title="Sair" className="text-indigo-200 hover:text-white">
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
