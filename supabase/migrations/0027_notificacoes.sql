-- Sprint 10 / Frente B — Notificações dentro do app (o sino do topo).
--
-- POR QUÊ: não há aviso dentro do app: a contadora só descobre documento novo,
-- pendência atendida, lançamento do cliente ou alerta da conferência abrindo cada
-- tela. O sino lista o que aconteceu desde a última visita. Quase tudo é DERIVADO do
-- que já existe (documentos, pendências, lançamentos); esta migração guarda só o que
-- não dá para derivar:
--   1. `notificacoes` — eventos que outras frentes publicam (registrarNotificacao em
--      lib/notificacoesServidor.ts) e "primeira vez que a conferência entre módulos
--      viu um alerta" (para só o alerta NOVO avisar).
--   2. `notificacoes_leitura` — por usuário: lidas até quando e quais itens foram
--      marcados como lidos um a um.
-- Ver docs/notificacoes.md.
--
-- SEGURANÇA: RLS ligada e SEM policies, como o resto: só a secret key (rotas de API,
-- depois de lib/acesso.ts) lê ou grava. `escritorio_id` vem da sessão, nunca do
-- navegador. Nenhum dado pessoal (CPF, salário) entra em título ou texto.
--
-- ORDEM: depende só da 0010 (escritorios). Idempotente. Sem a 0027 o sino continua
-- funcionando só com o que é derivado (sem "lidas" persistentes nem eventos).

create table if not exists notificacoes (
  id             uuid primary key default gen_random_uuid(),
  escritorio_id  uuid not null references escritorios (id) on delete cascade,
  -- sem FK para empresas, de propósito (como a 0009 e a 0015)
  empresa_id     text,
  tipo           text not null check (char_length(tipo) between 1 and 40),
  titulo         text not null check (char_length(titulo) between 1 and 200),
  texto          text check (texto is null or char_length(texto) <= 500),
  -- só caminho interno do app ("/ponto?empresa=…"), nunca URL externa
  href           text check (href is null or (href like '/%' and href not like '//%' and char_length(href) <= 300)),
  -- idempotência: o mesmo evento publicado duas vezes vira uma notificação só
  chave          text check (chave is null or char_length(chave) <= 200),
  criado_em      timestamptz not null default now()
);

create unique index if not exists notificacoes_chave_uq
  on notificacoes (escritorio_id, chave) where chave is not null;
create index if not exists notificacoes_escritorio_idx
  on notificacoes (escritorio_id, criado_em desc);

alter table notificacoes enable row level security;

create table if not exists notificacoes_leitura (
  escritorio_id  uuid not null references escritorios (id) on delete cascade,
  usuario        text not null,
  -- tudo que aconteceu até aqui já foi visto
  lidas_ate      timestamptz not null default now(),
  -- itens marcados como lidos depois de `lidas_ate` (guarda no máximo os 200 últimos)
  lidas          text[] not null default '{}',
  atualizado_em  timestamptz not null default now(),
  primary key (escritorio_id, usuario)
);

alter table notificacoes_leitura enable row level security;
