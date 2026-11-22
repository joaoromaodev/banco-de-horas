-- 0035 — Extrato bancário no Livro Caixa (Sprint 17, frente D).
--
-- POR QUÊ: a contabilidade importa o extrato (OFX ou CSV) de uma empresa e cada
-- linha vira SUGESTÃO de lançamento; nada grava sozinho. Duas coisas precisam de
-- banco:
--   1. `caixa_extrato_linhas` — a marca de cada linha do extrato já tratada
--      (lançada, casada com um lançamento que já existia, ou ignorada), pela CHAVE
--      da linha (hash do FITID do OFX, ou da linha do CSV). É o que impede a mesma
--      linha de virar lançamento duas vezes e o que o "Desfazer" do lote apaga.
--      Sem dado bancário cru: a chave é um hash; data, valor e o histórico do banco
--      (já com CPF e números longos mascarados) ficam para a tela mostrar.
--   2. `caixa_extrato_config` — o modo por empresa: 'par' (padrão: a conta bancária
--      fica FORA do caixa, como a contadora definiu — pagamento pelo banco gera a
--      retirada + o pagamento, igual ao cheque) ou 'direto' (banco dentro do caixa).
--      Ver docs/livro-caixa.md, "Extrato no caixa", e a pergunta em
--      docs/empresa/reuniao-edilse.md.
--
-- SEGURANÇA: RLS ligada e SEM policies, como o resto (só a secret key, pelas rotas,
-- depois de lib/acesso.ts — exigirGestor + motivoNegado). Chave composta
-- (empresa_id, escritorio_id) → empresas, como a 0017/0028.
--
-- ORDEM: depende da 0002 (lancamentos) e da 0012 (unique empresas (id, escritorio_id)).
-- Ordem de publicação livre: sem ela a importação funciona (o casamento por data e
-- valor já evita duplicar o que foi lançado), mas não lembra linhas ignoradas, não
-- desfaz pelo lote e o modo fica no padrão; mudar o modo responde 503.
-- ADITIVA e idempotente.
--
-- REVERSÃO: drop table if exists caixa_extrato_linhas; drop table if exists caixa_extrato_config;

create extension if not exists "pgcrypto";

create table if not exists caixa_extrato_linhas (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      text not null,
  escritorio_id   uuid references escritorios (id) on delete cascade,
  chave           text not null check (chave ~ '^(ofx|csv):[0-9a-f]{26}(#[0-9]{1,4})?$'),
  lote            uuid not null,
  situacao        text not null check (situacao in ('lancada', 'casada', 'ignorada')),
  -- os lançamentos que a linha criou (ou com que casou); sem FK (array), a rota confere
  lancamento_ids  uuid[] not null default '{}',
  data            date not null,
  valor           numeric(14, 2) not null check (valor > 0),
  sentido         text not null check (sentido in ('credito', 'debito')),
  historico_banco text check (historico_banco is null or char_length(historico_banco) <= 160),
  criado_por      text not null,
  criado_em       timestamptz not null default now(),
  constraint caixa_extrato_linhas_chave_unica unique (empresa_id, chave),
  constraint caixa_extrato_linhas_empresa_escritorio_fk
    foreign key (empresa_id, escritorio_id) references empresas (id, escritorio_id) on delete cascade
);
create index if not exists caixa_extrato_linhas_lote_idx on caixa_extrato_linhas (empresa_id, lote);
alter table caixa_extrato_linhas enable row level security;

create table if not exists caixa_extrato_config (
  empresa_id      text primary key,
  escritorio_id   uuid references escritorios (id) on delete cascade,
  modo            text not null default 'par' check (modo in ('par', 'direto')),
  atualizado_por  text not null,
  atualizado_em   timestamptz not null default now(),
  constraint caixa_extrato_config_empresa_escritorio_fk
    foreign key (empresa_id, escritorio_id) references empresas (id, escritorio_id) on delete cascade
);
alter table caixa_extrato_config enable row level security;
