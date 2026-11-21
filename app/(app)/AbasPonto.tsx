// Sub-navegação do módulo Folha de Ponto. Timesheet (ler folha + gerar planilha),
// Folhas em branco e Cadastros são telas do mesmo módulo — aqui viram abas no
// cabeçalho da página, no mesmo padrão do Livro Caixa (ver caixa/AbasCaixa).
import { Abas } from '@/components/ui';

export function AbasPonto({ ativa }: { ativa: 'timesheet' | 'folhas' | 'cadastros' }) {
  return (
    <Abas rotulo="Folha de Ponto" itens={[
      { rotulo: 'Timesheet', href: '/ponto', ativa: ativa === 'timesheet' },
      { rotulo: 'Folhas em branco', href: '/folhas', ativa: ativa === 'folhas' },
      { rotulo: 'Cadastros', href: '/ponto-cadastros', ativa: ativa === 'cadastros' },
    ]} />
  );
}
