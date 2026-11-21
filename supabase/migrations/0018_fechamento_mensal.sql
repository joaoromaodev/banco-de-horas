-- Sprint 5 / Frente B — Fechamento mensal automático.
--
-- POR QUÊ: todo mês a contadora pede às empresas os mesmos documentos (extrato,
-- notas) e hoje abre cada pendência à mão. Aqui o escritório define, por empresa,
-- o que pede todo mês; no dia 1º o cron diário da agenda abre as pendências da
-- competência anterior, e o envio do documento fecha a pendência sozinho.
-- Além disso, guarda o REGIME que a contadora decidiu para cada empresa — o
-- sistema só sugere o modelo da agenda a partir dele (nunca deduz por CNAE).
-- Ver docs/documentos.md, docs/agenda.md e docs/painel.md.
--
-- ORDEM: depende da 0010 (escritorios) e da 0015 (pendencias). Só CRIA tabela e
-- coluna nova (nullable): compatível com o código antigo. Idempotente.
-- Reversão:
--   alter table pendencias drop column if exists modelo_id;
--   drop table if exists pendencias_recorrentes, empresa_regime;

-- ------------------------------------------- pendências recorrentes (modelo)
create table if not exists pendencias_recorrentes (
  id             uuid primary key default gen_random_uuid(),
  -- Sem FK para empresas, como em pendencias/documentos (ver 0015).
  empresa_id     text not null,
  escritorio_id  uuid not null references escritorios (id) on delete restrict,
  titulo         text not null check (char_length(titulo) between 1 and 200),
  descricao      text check (descricao is null or char_length(descricao) <= 2000),
  categoria      text not null check (categoria in ('nota', 'extrato', 'recibo', 'folha', 'outros')),
  -- dia do mês (1–28) em que vence o pedido; o pedido abre no dia 1º e vale para
  -- a competência anterior. Até 28 para existir em todo mês.
  dia_prazo      int  not null default 10 check (dia_prazo between 1 and 28),
  ativa          boolean not null default true,
  criado_por     text not null,
  criado_em      timestamptz not null default now(),
  -- exclusão lógica: permite o "desfazer" da tela
  excluido_em    timestamptz
);

create index if not exists pendencias_recorrentes_empresa_idx
  on pendencias_recorrentes (empresa_id) where excluido_em is null;
create index if not exists pendencias_recorrentes_escritorio_idx
  on pendencias_recorrentes (escritorio_id) where excluido_em is null;

alter table pendencias_recorrentes enable row level security;

-- A pendência aberta por um modelo aponta para ele. O índice único é a trava de
-- idempotência do cron: a Vercel pode chamar duas vezes e o mesmo mês nunca abre
-- duas vezes. Vale também para a pendência excluída — quem apagou não quer de novo.
alter table pendencias add column if not exists modelo_id uuid references pendencias_recorrentes (id) on delete set null;
create unique index if not exists pendencias_modelo_competencia_uniq
  on pendencias (modelo_id, competencia) where modelo_id is not null;

-- ------------------------------------------------------- regime da empresa
-- Decisão da contadora (não se deduz por CNAE nem faturamento). Serve só para o
-- sistema SUGERIR o modelo de obrigações da agenda.
create table if not exists empresa_regime (
  empresa_id     text primary key,
  escritorio_id  uuid not null references escritorios (id) on delete restrict,
  regime         text not null check (regime in ('mei', 'simples', 'presumido', 'pessoa_fisica')),
  definido_por   text not null,
  definido_em    timestamptz not null default now()
);

alter table empresa_regime enable row level security;

notify pgrst, 'reload schema';
