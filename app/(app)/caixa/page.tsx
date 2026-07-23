'use client';

// Livro Caixa — porta de entrada do módulo. Por ora só apresenta o estado do
// exercício; o lançamento entra na próxima fase (persistência em Postgres).
import { useEffect, useState } from 'react';

interface Me { nome: string; email: string; role: 'master' | 'usuario' | 'cliente'; empresa: string | null; }
interface Empresa { id: string; nome: string; }

export default function Caixa() {
  const [me, setMe] = useState<Me | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);

  useEffect(() => {
    fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then((d) => d?.autenticado && setMe(d)).catch(() => {});
    fetch('/api/empresas').then((r) => (r.ok ? r.json() : null)).then((d) => setEmpresas(d?.empresas ?? [])).catch(() => {});
  }, []);

  const ehCliente = me?.role === 'cliente';
  const minhaEmpresa = empresas.find((e) => e.id === me?.empresa)?.nome;

  return (
    <div className="text-sm">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-900">Livro Caixa</h1>
        <p className="text-xs text-slate-500">
          {ehCliente
            ? `Movimento do caixa — ${minhaEmpresa ?? 'sua empresa'}`
            : 'Movimento do caixa das empresas-clientes'}
        </p>
      </header>

      <div className="mx-auto max-w-3xl p-6">
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="font-semibold text-slate-900">Módulo em preparação</h2>
          <p className="mt-2 text-slate-600">
            {ehCliente
              ? 'Em breve você lança aqui, dia a dia, as entradas e saídas do caixa — sem precisar enviar documento para a contabilidade.'
              : 'Em breve as empresas lançam o movimento aqui e você acompanha, classifica e fecha o exercício.'}
          </p>
          <ul className="mt-4 space-y-1.5 text-slate-600">
            <li>• Lançamentos por mês, com saldo corrido e saldo transportado de um mês para o outro</li>
            <li>• Classificação pelo plano de contas</li>
            <li>• Balanço financeiro do exercício</li>
            <li>• Termos de abertura e encerramento em PDF</li>
          </ul>
        </section>
      </div>
    </div>
  );
}
