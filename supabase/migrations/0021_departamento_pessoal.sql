-- Sprint 8 / Frente A — Departamento Pessoal: cadastro único do empregado, férias e 13º.
-- Ver docs/departamento-pessoal.md.
--
-- O que muda:
--   dp_empregados (nova)  → o cadastro único do empregado: admissão, cargo, salário base,
--                           jornada contratual, acordo de banco de horas e situação.
--   dp_ferias (nova)      → programação de férias (períodos de gozo + abono), com
--                           exclusão lógica para o "desfazer" da tela.
--   ponto_funcionarios    → + empregado_id (o cadastro do ponto aponta para o empregado)
--   ponto_frequencias     → + empregado_id (a frequência passa a se ligar por ID; o nome
--                           continua gravado e é a chave do Timesheet, como antes)
--   contratos_experiencia → + empregado_id (o contrato cria/liga o empregado)
--
-- ADITIVA e compatível com o código antigo: só cria tabelas, colunas anuláveis e
-- gatilhos. O código atual do ponto continua gravando por nome; os gatilhos preenchem
-- o empregado_id sozinhos (e criam o empregado quando nasce um funcionário no ponto),
-- então a ordem "migração antes/depois do deploy" não quebra nada.
--
-- BACKFILL: um empregado por linha de ponto_funcionarios (os 9 da Vaz & Vouzela),
-- frequências ligadas pelo (empresa, nome) — nada é apagado nem renomeado. Contratos de
-- experiência com o mesmo nome (sem diferenciar maiúsculas/espaços) são ligados e
-- preenchem a admissão do empregado quando ela está vazia.
--
-- Idempotente: pode rodar de novo. Depende da 0010 (escritorios), 0012 (ponto e a
-- unique empresas (id, escritorio_id)) e 0009 (contratos).
--
-- Mesma regra do resto: RLS ligada SEM policies; só a secret key (rotas de API, que
-- aplicam lib/acesso.ts) alcança estas tabelas.

-- ---------------------------------------------------------------- Empregados
create table if not exists dp_empregados (
  id                  uuid primary key default gen_random_uuid(),
  escritorio_id       uuid not null references escritorios (id) on delete restrict,
  empresa_id          text not null,
  nome                text not null check (btrim(nome) <> ''),
  -- só dígitos; dado pessoal (LGPD) — nunca vai para e-mail, log ou IA
  cpf                 text check (cpf is null or cpf ~ '^[0-9]{11}$'),
  cargo               text,
  admissao            date,
  -- salário base mensal, em reais (dado pessoal sensível ao negócio: só a contabilidade vê)
  salario_base        numeric(12, 2) check (salario_base is null or salario_base >= 0),
  -- jornada contratual: horas por semana (ex.: 44) e escala. A jornada DIÁRIA continua
  -- no cadastro do ponto (ponto_funcionarios) e da empresa — é ela que o Timesheet usa.
  horas_semanais      numeric(4, 1) check (horas_semanais is null or horas_semanais between 0 and 70),
  escala              text check (escala is null or escala in ('5x2', '6x1', '12x36', 'outra')),
  -- dia do repouso semanal remunerado (0 = domingo … 6 = sábado). Férias não começam
  -- nos 2 dias antes dele (CLT art. 134 §3).
  dsr                 smallint not null default 0 check (dsr between 0 and 6),
  -- acordo de banco de horas (CLT art. 59 §§2º e 5º)
  banco_horas         boolean not null default false,
  banco_horas_desde   date,
  situacao            text not null default 'ativo' check (situacao in ('ativo', 'afastado', 'desligado')),
  situacao_desde      date,
  -- tipo do afastamento (muda férias e 13º: doença > 6 meses perde o aquisitivo, art. 133 IV;
  -- acidente não reduz o 13º, Súmula 46 TST; maternidade conta normalmente, art. 131 II)
  afastamento_tipo    text check (afastamento_tipo is null or afastamento_tipo in ('doenca', 'acidente', 'maternidade', 'outro')),
  -- início do 1º período aquisitivo a considerar; nulo = a admissão. A contadora edita
  -- quando o art. 133 zerou o período (novo aquisitivo começa no retorno, §2º) ou na readmissão.
  aquisitivo_base     date,
  -- de onde veio: ponto (backfill/gatilho), contrato de experiência ou cadastro manual
  origem              text not null default 'manual' check (origem in ('ponto', 'contrato', 'manual')),
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  atualizado_por      text,
  constraint dp_empregados_empresa_fk foreign key (empresa_id, escritorio_id)
    references empresas (id, escritorio_id) on update cascade on delete restrict,
  -- mesmo vínculo do ponto: um nome por empresa (o Timesheet identifica pelo nome)
  constraint dp_empregados_nome_uniq unique (empresa_id, nome),
  -- alvo da chave composta de dp_ferias (férias e empregado sempre da mesma empresa/escritório)
  constraint dp_empregados_id_empresa_uniq unique (id, empresa_id, escritorio_id)
);
create index if not exists dp_empregados_escritorio_idx on dp_empregados (escritorio_id);
-- RLS já na criação: se o arquivo for colado fora de transação, a tabela não fica aberta no meio.
alter table dp_empregados enable row level security;

-- ---------------------------------------------------------------- Férias programadas
-- Cada linha é um período de gozo de um período aquisitivo (identificado pela data de
-- início do aquisitivo). Fracionamento: até 3 linhas por aquisitivo (regra na aplicação,
-- lib/ferias.ts). `abono_dias` = dias vendidos (art. 143), lançados junto de um período.
create table if not exists dp_ferias (
  id                 uuid primary key default gen_random_uuid(),
  escritorio_id      uuid not null references escritorios (id) on delete restrict,
  empresa_id         text not null,
  empregado_id       uuid not null,
  aquisitivo_inicio  date not null,
  inicio             date not null,
  dias               smallint not null check (dias between 1 and 30),
  abono_dias         smallint not null default 0 check (abono_dias between 0 and 10),
  aviso_em           date,
  pagamento_em       date,
  observacao         text,
  criado_por         text not null,
  criado_em          timestamptz not null default now(),
  atualizado_por     text,
  atualizado_em      timestamptz,
  -- exclusão lógica: o "desfazer" da tela
  excluido_em        timestamptz,
  constraint dp_ferias_empresa_fk foreign key (empresa_id, escritorio_id)
    references empresas (id, escritorio_id) on update cascade on delete restrict,
  constraint dp_ferias_empregado_fk foreign key (empregado_id, empresa_id, escritorio_id)
    references dp_empregados (id, empresa_id, escritorio_id) on update cascade on delete restrict
);
alter table dp_ferias enable row level security;
create index if not exists dp_ferias_empregado_idx on dp_ferias (empregado_id) where excluido_em is null;
create index if not exists dp_ferias_escritorio_idx on dp_ferias (escritorio_id) where excluido_em is null;

-- ---------------------------------------------------------------- Vínculos por id
alter table ponto_funcionarios    add column if not exists empregado_id uuid references dp_empregados (id) on delete set null;
alter table ponto_frequencias     add column if not exists empregado_id uuid references dp_empregados (id) on delete set null;
alter table contratos_experiencia add column if not exists empregado_id uuid references dp_empregados (id) on delete set null;
create index if not exists ponto_funcionarios_empregado_idx on ponto_funcionarios (empregado_id);
create index if not exists ponto_frequencias_empregado_idx on ponto_frequencias (empregado_id, ano, mes);
create index if not exists contratos_experiencia_empregado_idx on contratos_experiencia (empregado_id);

-- ---------------------------------------------------------------- Gatilhos
-- O código do ponto grava por nome (e é dono de outra frente). Em vez de mudá-lo, o
-- banco preenche o empregado_id: funcionário novo no ponto → acha (ou cria) o empregado
-- de mesmo nome; frequência nova → herda o empregado do funcionário de mesmo nome.

-- Funcionário do ponto: liga ao empregado de mesmo (empresa, nome), criando se não houver.
create or replace function dp_vincular_funcionario() returns trigger
language plpgsql set search_path = public as $$
declare
  v_id uuid;
begin
  if new.empregado_id is null then
    select id into v_id from dp_empregados where empresa_id = new.empresa_id and nome = new.nome;
    -- Só cria no INSERT: num UPDATE o gatilho de dp_empregados tentaria alterar a
    -- própria linha que está sendo atualizada.
    if v_id is null and tg_op = 'INSERT' then
      insert into dp_empregados (escritorio_id, empresa_id, nome, cargo, origem)
      values (new.escritorio_id, new.empresa_id, new.nome, new.cargo, 'ponto')
      on conflict (empresa_id, nome) do nothing
      returning id into v_id;
      if v_id is null then
        select id into v_id from dp_empregados where empresa_id = new.empresa_id and nome = new.nome;
      end if;
    end if;
    new.empregado_id := v_id;
  end if;
  return new;
end $$;

drop trigger if exists dp_vincular_funcionario on ponto_funcionarios;
create trigger dp_vincular_funcionario before insert or update on ponto_funcionarios
  for each row execute function dp_vincular_funcionario();

-- Frequência: herda o empregado do funcionário de mesmo nome; senão, do empregado de mesmo nome.
-- Não cria empregado (o Timesheet aceita nome livre; um erro de digitação não vira empregado).
create or replace function dp_vincular_frequencia() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.empregado_id is null then
    select f.empregado_id into new.empregado_id from ponto_funcionarios f
      where f.empresa_id = new.empresa_id and f.nome = new.funcionario;
    if new.empregado_id is null then
      select e.id into new.empregado_id from dp_empregados e
        where e.empresa_id = new.empresa_id and e.nome = new.funcionario;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists dp_vincular_frequencia on ponto_frequencias;
create trigger dp_vincular_frequencia before insert or update on ponto_frequencias
  for each row execute function dp_vincular_frequencia();

-- Empregado novo (cadastro manual ou contrato): liga o que já existia com o mesmo nome
-- e ainda estava solto (frequências lançadas antes do cadastro).
create or replace function dp_ligar_soltos() returns trigger
language plpgsql set search_path = public as $$
begin
  update ponto_funcionarios set empregado_id = new.id
    where empresa_id = new.empresa_id and nome = new.nome and empregado_id is null;
  update ponto_frequencias set empregado_id = new.id
    where empresa_id = new.empresa_id and funcionario = new.nome and empregado_id is null;
  return null;
end $$;

drop trigger if exists dp_ligar_soltos on dp_empregados;
create trigger dp_ligar_soltos after insert on dp_empregados
  for each row execute function dp_ligar_soltos();

-- ---------------------------------------------------------------- Backfill
-- 1. Um empregado por funcionário do ponto (não sobrescreve quem já existe).
insert into dp_empregados (escritorio_id, empresa_id, nome, cargo, origem)
select f.escritorio_id, f.empresa_id, f.nome, f.cargo, 'ponto'
from ponto_funcionarios f
on conflict (empresa_id, nome) do nothing;

-- 2. Funcionário → empregado.
update ponto_funcionarios f set empregado_id = e.id
from dp_empregados e
where f.empregado_id is null and e.empresa_id = f.empresa_id and e.nome = f.nome;

-- 3. Frequência → empregado, pelo (empresa, nome) — o nome continua gravado.
update ponto_frequencias q set empregado_id = coalesce(
    (select f.empregado_id from ponto_funcionarios f where f.empresa_id = q.empresa_id and f.nome = q.funcionario),
    (select e.id from dp_empregados e where e.empresa_id = q.empresa_id and e.nome = q.funcionario))
where q.empregado_id is null;

-- 4. Contrato de experiência → empregado de mesmo nome (sem diferenciar caixa/espaços).
--    Se houver dois empregados com o mesmo nome normalizado, não liga (fica para a tela).
update contratos_experiencia c set empregado_id = e.id
from dp_empregados e
where c.empregado_id is null and c.excluido_em is null
  and e.empresa_id = c.empresa_id
  and upper(btrim(e.nome)) = upper(btrim(c.nome))
  and (select count(*) from dp_empregados e2
       where e2.empresa_id = c.empresa_id and upper(btrim(e2.nome)) = upper(btrim(c.nome))) = 1;

-- 5. Admissão vazia ← a do contrato de experiência mais recente ligado (o contrato de
--    experiência começa na admissão). Função vazia ← função do contrato.
update dp_empregados e set
  admissao = coalesce(e.admissao, c.admissao),
  cargo = coalesce(nullif(btrim(e.cargo), ''), nullif(btrim(c.dados ->> 'funcao'), '')),
  atualizado_em = now()
from (
  select distinct on (empregado_id) empregado_id, admissao, dados
  from contratos_experiencia
  where empregado_id is not null and excluido_em is null
  order by empregado_id, admissao desc
) c
where c.empregado_id = e.id and (e.admissao is null or nullif(btrim(e.cargo), '') is null);

notify pgrst, 'reload schema';
