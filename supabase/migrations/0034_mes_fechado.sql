-- 0034 — Mês fechado que trava, com aceite do cliente (Sprint 17, frente C).
--
-- POR QUÊ: o número que foi para a folha (ponto) e o balanço que o cliente viu
-- (caixa) não podem mudar depois em silêncio. Fechado, o mês só muda depois que
-- alguém da contabilidade REABRE informando o motivo — e fica registrado quem
-- fechou, quem reabriu, quando e por quê. No ponto, a empresa-cliente dá o aceite
-- do resumo do mês (login, data, hora e a versão da declaração aceita). Não é o
-- espelho de ponto assinado pelo EMPREGADO: é a confirmação da empresa ao escritório.
-- Ver docs/livro-caixa.md e docs/folha-de-ponto.md, seções "Mês fechado".
--
-- CAIXA: o "mês fechado" é a linha que já existe em `meses_confirmados` (0001). Esta
-- migração só acrescenta o HISTÓRICO (`caixa_meses_historico`) e a trava no banco
-- (gatilho em `lancamentos`), como defesa em profundidade: as rotas já recusam com 409.
-- O saldo transportado faz parte do mês fechado: mês ANTERIOR a um fechado também trava.
-- ATENÇÃO: os meses que já estão confirmados passam a estar TRAVADOS (e os anteriores a eles).
-- PUBLICAÇÃO: aplicar esta migração ANTES (ou junto) do código — sem ela a trava já vale,
-- mas reabrir responde 503 (o motivo não pode se perder).
--
-- PONTO: três tabelas novas — o fechamento (com a FOTO do resumo, só horas e dias,
-- nunca R$), o histórico de fechar/reabrir e os aceites do cliente (só acrescenta;
-- o aceite vale para a assinatura dos números que ele viu). Gatilho em
-- `ponto_frequencias` com a mesma trava.
--
-- SEGURANÇA: RLS ligada e SEM policies, como o resto (só a secret key, pelas rotas,
-- depois de lib/acesso.ts). Tabelas do ponto com chave composta
-- (empresa_id, escritorio_id) → empresas, como a 0012/0022/0028.
-- Dado pessoal: a foto do resumo tem o NOME do funcionário e as horas/dias do mês
-- (o que a empresa já tem na folha dela). O aceite guarda o e-mail do login que
-- aceitou e, se houver, o texto da dúvida. Nada de CPF, salário ou valor.
--
-- ORDEM: depois da 0001/0002 (caixa) e da 0012/0022 (ponto). Não depende de 0029–0033.
-- ADITIVA e idempotente: pode ser rodada de novo.

create extension if not exists "pgcrypto";

-- ============================================================ CAIXA

create table if not exists caixa_meses_historico (
  id            uuid primary key default gen_random_uuid(),
  exercicio_id  uuid not null references exercicios (id) on delete cascade,
  mes           smallint not null check (mes between 1 and 12),
  acao          text not null check (acao in ('fechou', 'reabriu')),
  por           text not null,
  em            timestamptz not null default now(),
  motivo        text check (motivo is null or char_length(motivo) <= 500),
  -- reabrir exige o motivo
  constraint caixa_meses_historico_motivo check (acao <> 'reabriu' or char_length(btrim(coalesce(motivo, ''))) >= 5)
);
create index if not exists caixa_meses_historico_idx on caixa_meses_historico (exercicio_id, mes, em desc);
alter table caixa_meses_historico enable row level security;

-- Trava no banco: lançamento de mês confirmado — ou de mês ANTERIOR a um confirmado,
-- porque o saldo dele é o saldo transportado do fechado — não entra, não muda e não sai.
-- Só a conferência (conferido_por/conferido_em) pode mudar: não altera o livro.
-- `pg_trigger_depth() > 1` só vale para DELETE (exclusão em cascata do exercício).
create or replace function caixa_trava_mes_fechado() returns trigger
language plpgsql as $$
declare
  ignorar constant text[] := array['conferido_por', 'conferido_em', 'mes'];
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - ignorar) = (to_jsonb(old) - ignorar) then
    return new;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and exists (
    select 1 from meses_confirmados m
     where m.exercicio_id = old.exercicio_id and m.mes >= extract(month from old.data)::int
  ) then
    raise exception 'Mês fechado: o lançamento de % está em mês fechado (ou anterior a um fechado). Reabra o mês para alterar.', to_char(old.data, 'MM/YYYY');
  end if;
  if tg_op in ('INSERT', 'UPDATE') and exists (
    select 1 from meses_confirmados m
     where m.exercicio_id = new.exercicio_id and m.mes >= extract(month from new.data)::int
  ) then
    raise exception 'Mês fechado: o lançamento de % está em mês fechado (ou anterior a um fechado). Reabra o mês para alterar.', to_char(new.data, 'MM/YYYY');
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists lancamentos_trava_mes_fechado on lancamentos;
create trigger lancamentos_trava_mes_fechado
  before insert or update or delete on lancamentos
  for each row execute function caixa_trava_mes_fechado();

-- ============================================================ PONTO

create table if not exists ponto_meses_fechados (
  escritorio_id  uuid     not null references escritorios (id) on delete restrict,
  empresa_id     text     not null,
  ano            smallint not null check (ano between 2000 and 2100),
  mes            smallint not null check (mes between 1 and 12),
  fechado_por    text     not null,
  fechado_em     timestamptz not null default now(),
  -- hash dos números fechados (mesma função do "conferido", 0022)
  assinatura     text     not null,
  -- foto do resumo: { percentuais, funcionarios: [{ funcionario, dias, horas em minutos… }] }
  resumo         jsonb    not null,
  primary key (empresa_id, ano, mes),
  constraint ponto_meses_fechados_empresa_fk foreign key (empresa_id, escritorio_id)
    references empresas (id, escritorio_id) on update cascade on delete restrict
);
create index if not exists ponto_meses_fechados_escritorio_idx on ponto_meses_fechados (escritorio_id);
alter table ponto_meses_fechados enable row level security;

create table if not exists ponto_meses_historico (
  id             uuid primary key default gen_random_uuid(),
  escritorio_id  uuid     not null references escritorios (id) on delete restrict,
  empresa_id     text     not null,
  ano            smallint not null check (ano between 2000 and 2100),
  mes            smallint not null check (mes between 1 and 12),
  acao           text     not null check (acao in ('fechou', 'reabriu')),
  por            text     not null,
  em             timestamptz not null default now(),
  motivo         text check (motivo is null or char_length(motivo) <= 500),
  assinatura     text,
  constraint ponto_meses_historico_motivo check (acao <> 'reabriu' or char_length(btrim(coalesce(motivo, ''))) >= 5),
  constraint ponto_meses_historico_empresa_fk foreign key (empresa_id, escritorio_id)
    references empresas (id, escritorio_id) on update cascade on delete restrict
);
create index if not exists ponto_meses_historico_idx on ponto_meses_historico (empresa_id, ano, mes, em desc);
alter table ponto_meses_historico enable row level security;

-- Aceite do cliente: só acrescenta (nunca editado). Vale para a assinatura dos
-- números que ele viu; se o mês for reaberto e os números mudarem, pede de novo.
create table if not exists ponto_aceites (
  id             uuid primary key default gen_random_uuid(),
  escritorio_id  uuid     not null references escritorios (id) on delete restrict,
  empresa_id     text     not null,
  ano            smallint not null check (ano between 2000 and 2100),
  mes            smallint not null check (mes between 1 and 12),
  assinatura     text     not null,
  resposta       text     not null check (resposta in ('aceito', 'duvida')),
  -- versão do texto declarado no "Aceito" (lib/mesFechado.ts → DECLARACAO_ACEITE)
  declaracao     text     check (declaracao is null or char_length(declaracao) <= 20),
  duvida         text check (duvida is null or char_length(duvida) <= 1000),
  por            text     not null,
  em             timestamptz not null default now(),
  constraint ponto_aceites_duvida check (resposta <> 'duvida' or char_length(btrim(coalesce(duvida, ''))) >= 3),
  constraint ponto_aceites_empresa_fk foreign key (empresa_id, escritorio_id)
    references empresas (id, escritorio_id) on update cascade on delete restrict
);
create index if not exists ponto_aceites_idx on ponto_aceites (empresa_id, ano, mes, em desc);
alter table ponto_aceites enable row level security;

-- Trava no banco: frequência de mês fechado não entra, não muda e não sai.
-- UPDATE que só mexe na identidade (empregado_id do DP — 0021 —, ou empresa/escritório
-- movidos em cascata) passa: os horários não mudam. `pg_trigger_depth() > 1` só para DELETE.
create or replace function ponto_trava_mes_fechado() returns trigger
language plpgsql as $$
declare
  ignorar constant text[] := array['empregado_id', 'empresa_id', 'escritorio_id'];
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) - ignorar) = (to_jsonb(old) - ignorar) then
    return new;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and exists (
    select 1 from ponto_meses_fechados f
     where f.empresa_id = old.empresa_id and f.ano = old.ano and f.mes = old.mes
  ) then
    raise exception 'Mês fechado: o ponto de %/% está fechado pela contabilidade. Reabra o mês para alterar.', lpad(old.mes::text, 2, '0'), old.ano;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and exists (
    select 1 from ponto_meses_fechados f
     where f.empresa_id = new.empresa_id and f.ano = new.ano and f.mes = new.mes
  ) then
    raise exception 'Mês fechado: o ponto de %/% está fechado pela contabilidade. Reabra o mês para alterar.', lpad(new.mes::text, 2, '0'), new.ano;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists ponto_frequencias_trava_mes_fechado on ponto_frequencias;
create trigger ponto_frequencias_trava_mes_fechado
  before insert or update or delete on ponto_frequencias
  for each row execute function ponto_trava_mes_fechado();

notify pgrst, 'reload schema';
