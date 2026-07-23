-- Remove o sistema de pedidos/vendas que ocupava este projeto do Supabase.
--
-- Projeto antigo e descartável do João, confirmado em 23/07/2026. Os dados
-- foram exportados antes para backup-supabase-pedidos-2026-07-23.json (92
-- registros). Esta migração existe para que o passo fique registrado no
-- histórico — o banco não nasceu vazio.
--
-- A tabela `lancamentos` do sistema antigo tem o mesmo nome da do livro caixa,
-- com estrutura diferente; é por isso que a limpeza precisa vir antes.

drop table if exists
  itens_pedido,
  produto_precos,
  produto_variacoes,
  pedidos,
  compras,
  lancamentos,
  clientes,
  produtos,
  configuracoes
cascade;

drop function if exists get_campos_extras cascade;
drop function if exists atualizar_pedido_extra cascade;
