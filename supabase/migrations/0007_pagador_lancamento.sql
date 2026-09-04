-- Identificação do pagador/paciente nos lançamentos (IRPF: Carnê-Leão e DMED).
--
-- Profissional de saúde (o dentista Nélio Dias dos Santos, da Edilse) e clínicas
-- precisam identificar QUEM pagou cada receita — nome e CPF/CNPJ — para o
-- Carnê-Leão e a DMED (que alimenta a dedução de despesa médica do paciente no
-- IR dele). Loja de balcão não identifica cliente.
--
-- A necessidade é da ATIVIDADE, não do tipo de pessoa: uma clínica pessoa
-- jurídica também precisa. Por isso é uma flag por empresa, ligada a dedo pela
-- contabilidade no cadastro, e NÃO derivada de `tipo_pessoa`.
alter table empresas
  add column if not exists identifica_pagador boolean not null default false;

-- Nome e documento (CPF ou CNPJ) de quem pagou. Nulos: só as entradas de quem
-- tem a flag preenchem; saídas, transferências e as pernas do cheque ficam sem.
-- Não há trava de formato — o sistema só avisa, no espírito do resto do módulo.
alter table lancamentos add column if not exists pagador_nome text;
alter table lancamentos add column if not exists pagador_documento text;

-- PostgREST guarda o schema em cache — sem isto as colunas novas só aparecem na
-- próxima reinicialização e a API responde "Could not find the column".
notify pgrst, 'reload schema';
