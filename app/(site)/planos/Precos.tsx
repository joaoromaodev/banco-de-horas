'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Selo } from '@/components/ui';
import { linkCls, ROTAS, TESTE } from '../_partes';

const PLANOS = [
  { id: 'essencial', nome: 'Essencial', para: 'Para quem está começando a digitalizar o escritório.', limite: 'até 10 empresas-clientes', mensal: 89, anual: 890 },
  { id: 'escritorio', nome: 'Escritório', para: 'Para o escritório com carteira em crescimento.', limite: 'até 40 empresas-clientes', mensal: 189, anual: 1890, destaque: true },
  { id: 'ilimitado', nome: 'Ilimitado', para: 'Para quem não quer pensar em limite.', limite: 'empresas-clientes sem limite', mensal: 349, anual: 3490 },
];

const brl = (v: number, casas = 0) =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

export function Precos() {
  const [anual, setAnual] = useState(false);

  return (
    <div>
      <div role="group" aria-label="Periodicidade da cobrança" className="inline-flex rounded-lg border border-borda bg-superficie p-1">
        {[[false, 'Mensal'], [true, 'Anual']].map(([val, rot]) => (
          <button key={String(rot)} type="button" aria-pressed={anual === val} onClick={() => setAnual(val as boolean)}
            className={`h-9 rounded-md px-4 text-sm font-medium transition-colors ${anual === val ? 'bg-primaria text-sobre-primaria' : 'text-tinta-suave hover:text-tinta'}`}>
            {rot as string}
          </button>
        ))}
      </div>
      <span className="ml-3 inline-block align-middle"><Selo tom="sucesso">Anual: 2 meses grátis</Selo></span>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {PLANOS.map((p) => (
          <div key={p.id} className={`flex flex-col rounded-xl border bg-superficie p-6 shadow-cartao ${p.destaque ? 'border-primaria ring-1 ring-primaria' : 'border-borda'}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-lg font-semibold text-tinta">{p.nome}</h3>
              {p.destaque && <Selo tom="primaria">Mais escolhido</Selo>}
            </div>
            <p className="mt-1 text-[13px] text-tinta-suave">{p.para}</p>
            <p className="mt-5 flex items-baseline gap-1.5">
              <span className="text-4xl font-semibold tracking-tight tabular-nums text-tinta">R$ {brl(anual ? p.anual : p.mensal)}</span>
              <span className="text-sm text-tinta-suave">{anual ? '/ano' : '/mês'}</span>
            </p>
            <p className="mt-1 min-h-5 text-[13px] text-tinta-suave">
              {anual ? `equivale a R$ ${brl(p.anual / 12, 2)}/mês` : 'cobrança mensal, sem fidelidade'}
            </p>
            <p className="mt-5 text-sm font-medium text-tinta">{p.limite}</p>
            <ul className="mt-2 space-y-1.5 text-[13px] text-tinta-suave">
              <li>Livro Caixa, Folha de Ponto e Contratos</li>
              <li>Cliente com acesso ao próprio caixa</li>
              <li>Leitura por IA com cota mensal</li>
            </ul>
            <Link href={ROTAS.criarConta} className={linkCls(p.destaque ? 'primaria' : 'secundaria', 'lg', 'mt-6 w-full')}>{TESTE}</Link>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[13px] text-tinta-suave">14 dias grátis em qualquer plano, sem cartão de crédito.</p>
    </div>
  );
}
