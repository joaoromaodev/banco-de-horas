// Sub-navegação do módulo Folha de Ponto. Timesheet (ler folha + gerar planilha)
// e Folhas em branco são as duas telas do mesmo módulo — aqui viram abas, no
// mesmo padrão de "Lançamentos | Resumo" do Livro Caixa.
const base = 'rounded-lg border px-3 py-1.5';
const ativoCls = 'border-indigo-600 bg-indigo-600 text-white';
const inativoCls = 'border-slate-300 bg-white hover:border-indigo-400';

export function AbasPonto({ ativa }: { ativa: 'timesheet' | 'folhas' }) {
  return (
    <nav className="flex gap-1 text-xs">
      {ativa === 'timesheet'
        ? <span className={`${base} ${ativoCls}`}>Timesheet</span>
        : <a href="/" className={`${base} ${inativoCls}`}>Timesheet</a>}
      {ativa === 'folhas'
        ? <span className={`${base} ${ativoCls}`}>Folhas em branco</span>
        : <a href="/folhas" className={`${base} ${inativoCls}`}>Folhas em branco</a>}
    </nav>
  );
}
