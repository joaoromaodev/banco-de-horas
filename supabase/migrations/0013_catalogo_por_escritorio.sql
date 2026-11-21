-- Sprint 2 / Frente C — o catálogo do Livro Caixa passa a ser por escritório.
--
-- POR QUÊ: `plano_contas` (contas titulares) e `historicos_padrao` (contas
-- analíticas) eram globais: um contador de outro escritório que criasse uma
-- conta ou analítica "nova" a colocava no catálogo que a Edilse também vê.
-- Agora há duas camadas (regra em lib/visibilidadeCatalogo.ts):
--   escritorio_id NULO        = catálogo BASE da plataforma (as 119 contas padrão
--                               de lib/planoContasPadrao.ts) — visível a todos;
--   escritorio_id PREENCHIDO  = extensão daquele escritório — só ele a vê.
-- O `master` vê tudo e cria no base.
--
-- ORDEM DE APLICAÇÃO: depende da 0010 (tabela `escritorios`). É compatível com o
-- código ANTIGO (colunas anuláveis; o código antigo grava sem escritório, ou seja,
-- no base). Aplique antes de publicar o código novo — ele filtra por
-- `escritorio_id` e falha sem a coluna.
--
-- LANÇAMENTOS NÃO SÃO TOCADOS: nenhum `update` em `lancamentos`. Eles apontam para
-- a conta por `conta_id` (que não muda) e guardam a analítica como texto solto.
--
-- Conferido no banco de produção em 21/11/2026 (só leitura): 123 contas = 119
-- padrão + 4 criadas à mão; 6 analíticas, todas criadas à mão (ver
-- docs/livro-caixa.md, "Catálogo por escritório (0013)").

-- ---------------------------------------------------------------- colunas
-- `on delete restrict`: apagar um escritório que tem catálogo próprio é erro,
-- nunca cascata silenciosa (as contas podem estar em lançamentos).
alter table plano_contas      add column if not exists escritorio_id uuid references escritorios (id) on delete restrict;
alter table historicos_padrao add column if not exists escritorio_id uuid references escritorios (id) on delete restrict;

create index if not exists plano_contas_escritorio_idx      on plano_contas (escritorio_id);
create index if not exists historicos_padrao_escritorio_idx on historicos_padrao (escritorio_id);

-- ---------------------------------------------------------------- unicidade
-- Antes: `codigo` único no mundo. Agora: único no base e, separadamente, único
-- dentro de cada escritório. Dois escritórios podem ter o mesmo código próprio
-- (cada um só enxerga o seu).
alter table plano_contas drop constraint if exists plano_contas_codigo_key;

create unique index if not exists plano_contas_base_codigo_uq
  on plano_contas (codigo) where escritorio_id is null;
create unique index if not exists plano_contas_escritorio_codigo_uq
  on plano_contas (escritorio_id, codigo) where escritorio_id is not null;

-- "O base vale para todos": uma conta de escritório não pode reusar um código do
-- base (o escritório veria dois códigos iguais, o do base e o dele).
create or replace function plano_contas_codigo_fora_do_base() returns trigger
language plpgsql as $$
begin
  if new.escritorio_id is not null
     and exists (select 1 from plano_contas b
                 where b.escritorio_id is null and b.codigo = new.codigo
                   -- a própria linha (o backfill move uma conta do base para o escritório)
                   and b.id <> new.id) then
    raise exception 'O código % já existe no catálogo base.', new.codigo
      using errcode = '23505';
  end if;
  return new;
end $$;

drop trigger if exists plano_contas_codigo_fora_do_base on plano_contas;
create trigger plano_contas_codigo_fora_do_base
  before insert or update of codigo, escritorio_id on plano_contas
  for each row execute function plano_contas_codigo_fora_do_base();

-- ---------------------------------------------------------------- backfill
-- Escritório da Edilse (id fixo, criado na 0010). Move para ele o que foi criado à
-- mão. Cada linha é nomeada de propósito (confere código E nome / id): num banco
-- onde elas não existam — ou existam como padrão — o update não encosta em nada.

-- Contas titulares fora de lib/planoContasPadrao.ts (as 4 criadas à mão).
update plano_contas
   set escritorio_id = '00000000-0000-4000-8000-000000000001'
 where escritorio_id is null
   and (codigo, nome) in (
     ('1.02.05', 'Receita de Atendimento'),
     ('2.03.14', 'TELEFONE'),
     ('2.03.15', 'Condomínio'),
     ('2.11.04', 'Material de Consumo')
   );

-- As 6 analíticas padronizadas do NÉLIO (11/09/2026), por id — o texto de algumas
-- ("Pago conta de luz") também existe no seed, então só o id as distingue.
update historicos_padrao
   set escritorio_id = '00000000-0000-4000-8000-000000000001'
 where escritorio_id is null
   and id in (
     '4559f618-81a0-42d6-be2f-072bc49edf98', -- Pago conta de luz           (2.02.02)
     '87eee376-fdec-4fd5-820a-74e4899c785f', -- Recebido Atendimento         (1.02.05)
     'f25d8e8d-bfa4-401f-abf0-102d573eebcb', -- Prótese                      (2.06.02)
     '42f80b53-53f5-466d-9d33-049d2ec02beb', -- Pago aluguel do escritório   (2.03.15)
     'd8a1724b-d46b-4ac6-89a5-f880495504ef', -- Pago material de expediente  (2.02.06)
     '17e950bd-2120-4ffc-8fc5-7a8c1406c561'  -- Pago material de consumo     (2.11.04)
   );

notify pgrst, 'reload schema';
