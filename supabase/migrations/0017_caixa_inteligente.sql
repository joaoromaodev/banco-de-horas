-- 0017 — Caixa inteligente (Sprint 5, Frente A): sugestão de conta que aprende
-- e revisão antes da conferência.
--
-- O QUE TRAZ
-- 1. `caixa_sugestoes` — cada sugestão de conta que a tela mostrou ao lançar:
--    de onde veio (analítica, histórico de conferidos ou IA), se quem lançou
--    aceitou e, quando a contadora confere, se a conta ficou (`confirmada`) ou foi
--    trocada (`corrigida`). As linhas da IA também são o contador da cota diária
--    de chamadas por escritório (lancamento_id nulo até o lançamento existir).
-- 2. Índice dos lançamentos por exercício e data — é de onde a sugestão aprende
--    (lê os mais recentes primeiro).
--
-- ADITIVA: só tabela e índices novos; nada é apagado nem reescrito. O código
-- funciona sem ela (registro e IA ficam desligados, a sugestão local e a revisão
-- seguem), então a ordem publicar/aplicar não quebra nada — mas aplique antes
-- para ligar a IA e a medição.
--
-- RLS ligada sem policies, como o resto do caixa: só as rotas (secret key) leem.

create table if not exists caixa_sugestoes (
  id             uuid primary key default gen_random_uuid(),
  escritorio_id  uuid references escritorios(id) on delete cascade,
  empresa_id     text not null references empresas(id) on delete cascade,
  -- nulo enquanto a sugestão (da IA) ainda não virou lançamento; se o lançamento
  -- for excluído, a linha fica (é a contagem da cota) e perde o vínculo
  lancamento_id  uuid references lancamentos(id) on delete set null,
  origem         text not null check (origem in ('analitica', 'historico', 'ia')),
  conta_id       uuid references plano_contas(id) on delete set null,
  historico      text,
  confianca      numeric(4, 3),
  -- quem lançou ficou com a sugestão?
  aceita         boolean,
  -- na conferência: a conta sugerida ficou ou foi trocada pela contadora?
  resultado      text check (resultado in ('confirmada', 'corrigida')),
  criado_por     text not null,
  criado_em      timestamptz not null default now(),
  avaliado_em    timestamptz,
  -- o escritório gravado é o da empresa (empresas tem unique (id, escritorio_id), 0012)
  constraint caixa_sugestoes_empresa_escritorio_fk
    foreign key (empresa_id, escritorio_id) references empresas (id, escritorio_id) on delete cascade
);

alter table caixa_sugestoes enable row level security;

-- Cota da IA: quantas chamadas o escritório fez desde o início do dia.
create index if not exists caixa_sugestoes_ia_idx
  on caixa_sugestoes (escritorio_id, criado_em) where origem = 'ia';
-- Conferência: achar a sugestão do lançamento conferido.
create index if not exists caixa_sugestoes_lancamento_idx
  on caixa_sugestoes (lancamento_id) where lancamento_id is not null;
-- Medição por empresa (taxa de acerto ao longo do tempo).
create index if not exists caixa_sugestoes_empresa_idx
  on caixa_sugestoes (empresa_id, criado_em desc);

-- De onde a sugestão aprende: os lançamentos de cada exercício, mais novos primeiro
-- (o índice antigo começa por `mes` e não serve à ordem por data entre meses).
create index if not exists lancamentos_exercicio_data_idx
  on lancamentos (exercicio_id, data desc);
