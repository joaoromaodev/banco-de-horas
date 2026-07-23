-- Fase 3 — lançamentos: recria o que faltou da 0001 e acrescenta a conferência.
--
-- POR QUE RECRIAR: no banco de produção a migração 0001 ficou pela metade.
-- `plano_contas`, `empresa_contas`, `historicos_padrao`, `exercicios` e
-- `meses_confirmados` estão lá, mas `lancamentos` e a view `resumo_mensal`
-- **não existem** — o Postgres responde `relation "lancamentos" does not exist`
-- até dentro de saldo_final_exercicio(). Sem essa tabela a tela da Fase 3 não
-- tem onde gravar.
--
-- Esta migração é idempotente: onde a tabela já existir, ela só acrescenta as
-- colunas da conferência. Pode ser rodada de novo sem estragar nada.

-- ---------------------------------------------------------------- lançamentos
create table if not exists lancamentos (
  id           uuid primary key default gen_random_uuid(),
  exercicio_id uuid not null references exercicios(id) on delete cascade,
  data         date not null,
  -- derivado da data: o livro é organizado por mês e os dois nunca podem divergir
  mes          int generated always as (extract(month from data)::int) stored,
  historico    text not null,
  complemento  text,
  -- nulo é legítimo: depósito e retirada de conta corrente são transferência,
  -- não receita nem despesa, e o catálogo dela não tem linha para eles.
  conta_id     uuid references plano_contas(id) on delete restrict,
  entrada      numeric(14, 2) not null default 0 check (entrada >= 0),
  saida        numeric(14, 2) not null default 0 check (saida  >= 0),

  criado_por    text not null,
  criado_em     timestamptz not null default now(),
  atualizado_por text,
  atualizado_em  timestamptz,

  -- todo lançamento é entrada OU saída, nunca os dois nem nenhum
  constraint entrada_xor_saida check ((entrada > 0) <> (saida > 0))
);

-- ---------------------------------------------------------------- conferência
-- A contadora marca lançamento a lançamento o que já conferiu. É separado de
-- `meses_confirmados`: conferir é o trabalho dela; confirmar o mês é o aviso ao
-- cliente de que o resumo está liberado. Nenhum dos dois trava a edição.
alter table lancamentos add column if not exists conferido_por text;
alter table lancamentos add column if not exists conferido_em  timestamptz;

create index if not exists lancamentos_exercicio_mes_idx
  on lancamentos (exercicio_id, mes, data, criado_em);
create index if not exists lancamentos_criado_em_idx
  on lancamentos (criado_em desc);
-- O aviso "a empresa lançou" é a lista do que ainda não foi conferido.
create index if not exists lancamentos_pendentes_idx
  on lancamentos (exercicio_id) where conferido_em is null;

-- ---------------------------------------------------------------- integridade
-- A data do lançamento tem que cair dentro do ano do exercício.
create or replace function checa_ano_do_lancamento() returns trigger
language plpgsql as $$
declare
  ano_exercicio int;
begin
  select ano into ano_exercicio from exercicios where id = new.exercicio_id;
  if extract(year from new.data)::int <> ano_exercicio then
    raise exception 'Lançamento de % fora do exercício de %', new.data, ano_exercicio;
  end if;
  return new;
end;
$$;

drop trigger if exists lancamentos_ano_confere on lancamentos;
create trigger lancamentos_ano_confere
  before insert or update of data, exercicio_id on lancamentos
  for each row execute function checa_ano_do_lancamento();

-- ---------------------------------------------------------------- saldos
create or replace function saldo_final_exercicio(p_exercicio uuid)
returns numeric language sql stable as $$
  select e.saldo_inicial
       + coalesce((select sum(l.entrada - l.saida) from lancamentos l
                    where l.exercicio_id = e.id), 0)
    from exercicios e where e.id = p_exercicio;
$$;

-- Totais por mês, com o saldo transportado acumulado — equivale às linhas
-- "Soma do mês" e "Saldo atual" de cada aba da planilha.
create or replace view resumo_mensal as
select e.id  as exercicio_id,
       e.empresa_id,
       e.ano,
       m.mes,
       coalesce(sum(l.entrada), 0) as entradas,
       coalesce(sum(l.saida),   0) as saidas,
       e.saldo_inicial
         + coalesce((select sum(l2.entrada - l2.saida)
                       from lancamentos l2
                      where l2.exercicio_id = e.id and l2.mes <= m.mes), 0) as saldo_final
  from exercicios e
 cross join generate_series(1, 12) as m(mes)
  left join lancamentos l on l.exercicio_id = e.id and l.mes = m.mes
 group by e.id, e.empresa_id, e.ano, m.mes, e.saldo_inicial;

-- ---------------------------------------------------------------- acesso
-- Mesma regra da 0001: RLS ligada SEM policies. Quem lê é a rota de API com a
-- secret key; a publishable key que vai para o navegador não alcança nada.
alter table lancamentos enable row level security;

-- PostgREST guarda o schema em cache — sem isto a tabela nova só aparece na
-- próxima reinicialização e a API responde "Could not find the table".
notify pgrst, 'reload schema';
