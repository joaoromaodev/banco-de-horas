// Sub-navegação do módulo Livro Caixa, igual nas três telas. "Cadastros" é
// trabalho da contabilidade: o `cliente` não vê a aba (e a rota o redireciona).
import { Abas } from '@/components/ui';

export function AbasCaixa({ ativa, ehGestor }: { ativa: 'lancamentos' | 'resumo' | 'cadastros'; ehGestor: boolean }) {
  return (
    <Abas rotulo="Livro Caixa" itens={[
      { rotulo: 'Lançamentos', href: '/caixa', ativa: ativa === 'lancamentos' },
      { rotulo: 'Resumo', href: '/caixa/resumo', ativa: ativa === 'resumo' },
      ...(ehGestor ? [{ rotulo: 'Cadastros', href: '/caixa/cadastros', ativa: ativa === 'cadastros' }] : []),
    ]} />
  );
}
