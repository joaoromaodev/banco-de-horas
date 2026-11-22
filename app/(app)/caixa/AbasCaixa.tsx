// Sub-navegação do módulo Livro Caixa, igual nas telas. "Extrato" e "Cadastros"
// são trabalho da contabilidade: o `cliente` não vê as abas (e a tela o redireciona).
import { Abas } from '@/components/ui';

export function AbasCaixa({ ativa, ehGestor }: { ativa: 'lancamentos' | 'resumo' | 'demonstrativo' | 'extrato' | 'cadastros'; ehGestor: boolean }) {
  return (
    <Abas rotulo="Livro Caixa" itens={[
      { rotulo: 'Lançamentos', href: '/caixa', ativa: ativa === 'lancamentos' },
      { rotulo: 'Resumo', href: '/caixa/resumo', ativa: ativa === 'resumo' },
      { rotulo: 'Demonstrativo', href: '/caixa/demonstrativo', ativa: ativa === 'demonstrativo' },
      ...(ehGestor ? [{ rotulo: 'Extrato', href: '/caixa/extrato', ativa: ativa === 'extrato' }] : []),
      ...(ehGestor ? [{ rotulo: 'Cadastros', href: '/caixa/cadastros', ativa: ativa === 'cadastros' }] : []),
    ]} />
  );
}
