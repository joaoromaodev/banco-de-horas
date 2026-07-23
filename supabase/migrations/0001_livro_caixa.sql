-- Livro Caixa — schema inicial.
--
-- A folha de ponto continua no Google Sheets; só o livro caixa vive aqui,
-- porque tem escrita concorrente (várias empresas lançando ao mesmo tempo) e
-- volume que a planilha não sustenta.
--
-- `empresa_id` é o id interno da aba `Empresas` do Sheets — não há FK possível
-- entre os dois bancos, então o vínculo é por texto e validado na aplicação.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- plano de contas
-- Catálogo padronizado pela contadora. Códigos no formato N.GG.CC
-- (1 = receita, 2 = despesa / grupo / conta).
create table plano_contas (
  id            uuid primary key default gen_random_uuid(),
  codigo        text not null unique,
  nome          text not null,
  grupo         text not null,
  natureza      text not null check (natureza in ('receita', 'despesa')),
  -- linha correspondente no Balanço Financeiro (de-para da conciliação anual)
  linha_balanco text,
  ordem         int  not null,
  ativa         boolean not null default true
);

-- Cada empresa usa um subconjunto do catálogo: é essa lista curta que aparece
-- para quem lança, em vez das ~120 contas inteiras.
create table empresa_contas (
  empresa_id text not null,
  conta_id   uuid not null references plano_contas(id) on delete cascade,
  primary key (empresa_id, conta_id)
);

-- Históricos padronizados ("Pago conta de luz", "Recebido cheque pré…").
-- `conta_id` sugere a classificação quando o histórico é escolhido.
create table historicos_padrao (
  id       uuid primary key default gen_random_uuid(),
  texto    text not null,
  natureza text not null check (natureza in ('receita', 'despesa')),
  conta_id uuid references plano_contas(id) on delete set null,
  ordem    int not null default 0
);

-- ---------------------------------------------------------------- exercício
-- Um livro por empresa por ano, com os dados dos termos de abertura/encerramento.
create table exercicios (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    text not null,
  ano           int  not null check (ano between 2000 and 2100),
  -- Saldo que abre janeiro. Normalmente vem do encerramento do ano anterior
  -- (ver funcao saldo_final_exercicio); no primeiro ano é digitado.
  saldo_inicial numeric(14, 2) not null default 0,

  -- termos (Lei 8.541/92, art. 18, I)
  numero_livro         int,
  numero_ordem         int,
  qtd_folhas           int,
  razao_social         text,
  endereco             text,
  numero_endereco      text,
  municipio            text,
  estado               text,
  registro_em          text,
  sob_numero           text,
  cnpj                 text,
  inscricao_estadual   text,
  inscricao_municipal  text,
  prefeitura           text,
  -- cidade/data que saem no rodapé do termo (Belém, Castanhal, …)
  cidade_termo         text,
  data_termo           date,
  contabilista         text,
  crc                  text,

  encerrado_em  timestamptz,
  criado_em     timestamptz not null default now(),
  unique (empresa_id, ano)
);

-- ---------------------------------------------------------------- lançamentos
create table lancamentos (
  id           uuid primary key default gen_random_uuid(),
  exercicio_id uuid not null references exercicios(id) on delete cascade,
  data         date not null,
  -- derivado da data: o livro é organizado por mês e os dois nunca podem divergir
  mes          int generated always as (extract(month from data)::int) stored,
  historico    text not null,
  complemento  text,
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

create index lancamentos_exercicio_mes_idx on lancamentos (exercicio_id, mes, data, criado_em);
create index lancamentos_criado_em_idx     on lancamentos (criado_em desc);

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

create trigger lancamentos_ano_confere
  before insert or update of data, exercicio_id on lancamentos
  for each row execute function checa_ano_do_lancamento();

-- ---------------------------------------------------------------- fechamento
-- A contadora confirma o mês. Não trava a edição (a contadora pediu que tudo
-- siga editável) — libera o balanço para o cliente ver.
create table meses_confirmados (
  exercicio_id  uuid not null references exercicios(id) on delete cascade,
  mes           int  not null check (mes between 1 and 12),
  confirmado_por text not null,
  confirmado_em  timestamptz not null default now(),
  primary key (exercicio_id, mes)
);

-- ---------------------------------------------------------------- saldos
-- Saldo final do exercício = saldo inicial + entradas - saídas do ano.
-- É o que abre o exercício seguinte.
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
-- Todo acesso passa pelas rotas de API do Next, que usam a secret key e aplicam
-- a autorização de lib/acesso.ts. RLS fica ligada SEM policies: assim a
-- publishable key (que vai para o navegador) não lê nada direto do banco.
alter table plano_contas      enable row level security;
alter table empresa_contas    enable row level security;
alter table historicos_padrao enable row level security;
alter table exercicios        enable row level security;
alter table lancamentos       enable row level security;
alter table meses_confirmados enable row level security;
