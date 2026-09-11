-- Contas analíticas por empresa — o subconjunto de históricos que cada empresa
-- usa, espelhando `empresa_contas` (Fase 3). Antes, o campo "Histórico" era um
-- datalist global igual para todas; agora ele virou a **Conta Analítica**, um
-- seletor com "as desta empresa" no topo, o catálogo completo e o "criar nova"
-- (só a contadora) — exatamente como a Conta Titular.
--
-- A relação analítica → titular já existia: cada linha de `historicos_padrao`
-- aponta para a conta que ela sugere (`conta_id`). É essa coluna que faz a
-- analítica ser "subgrupo" da titular, e é por ela que a lista de analíticas é
-- filtrada quando a titular é escolhida.
create table empresa_historicos (
  empresa_id   text not null,
  historico_id uuid not null references historicos_padrao(id) on delete cascade,
  primary key (empresa_id, historico_id)
);

-- Mesmo regime do resto do módulo: RLS ligada SEM policies. Todo acesso passa
-- pelas rotas de API (secret key), que aplicam a autorização de lib/acesso.
alter table empresa_historicos enable row level security;
