// Sub-navegação do módulo Livro Caixa, igual nas três telas. "Cadastros" é
// trabalho da contabilidade: o `cliente` não vê a aba (e a rota o redireciona).
import { Abas } from '@/components/ui';

export function AbasCaixa({ ativa, ehGestor }: { ativa: 'lancamentos' | 'resumo' | 'demonstrativo' | 'cadastros'; ehGestor: boolean }) {
  return (
    <Abas rotulo="Livro Caixa" itens={[
      { rotulo: 'Lançamentos', href: '/caixa', ativa: ativa === 'lancamentos' },
      { rotulo: 'Resumo', href: '/caixa/resumo', ativa: ativa === 'resumo' },
      { rotulo: 'Demonstrativo', href: '/caixa/demonstrativo', ativa: ativa === 'demonstrativo' },
      ...(ehGestor ? [{ rotulo: 'Cadastros', href: '/caixa/cadastros', ativa: ativa === 'cadastros' }] : []),
    ]} />
  );
}
