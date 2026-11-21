-- 0022 — "Conferido pela contadora" no Resumo do ponto para a folha (Sprint 8, Frente B).
--
-- UMA linha por empresa × mês: quem conferiu o resumo e quando. Só guarda o
-- carimbo — os números do resumo são sempre recalculados a partir das folhas.
-- `assinatura` é um hash dos totais conferidos: se a folha mudar depois, a tela avisa
-- que o carimbo ficou velho.
--
-- ADITIVA e opcional: sem esta tabela o resumo funciona normalmente e só o botão
-- "Marcar como conferido" avisa que falta aplicar a migração.
-- Chave composta (empresa, escritório) → empresas, como as demais tabelas do ponto.

create table if not exists ponto_resumo_conferido (
  escritorio_id  uuid     not null references escritorios (id) on delete restrict,
  empresa_id     text     not null,
  ano            smallint not null check (ano between 2000 and 2100),
  mes            smallint not null check (mes between 1 and 12),
  conferido_por  text     not null,
  conferido_em   timestamptz not null default now(),
  -- hash dos totais conferidos: se a folha mudar depois, a tela vê que não bate mais
  assinatura     text     not null,
  primary key (empresa_id, ano, mes),
  constraint ponto_resumo_conferido_empresa_fk foreign key (empresa_id, escritorio_id)
    references empresas (id, escritorio_id) on update cascade on delete restrict
);
create index if not exists ponto_resumo_conferido_escritorio_idx on ponto_resumo_conferido (escritorio_id);

alter table ponto_resumo_conferido enable row level security;

notify pgrst, 'reload schema';
