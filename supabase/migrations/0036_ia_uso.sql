-- 0036 — Contador de uso da IA (Sprint 17, frente F).
--
-- POR QUÊ: a leitura da folha de ponto, dos documentos do caixa e a sugestão de
-- conta passaram para a Cloudflare Workers AI, que é gratuita até 10.000
-- "neurônios" por dia (renova 00:00 UTC). Cada chamada grava aqui quanto gastou
-- (o número que a própria API devolve; sem ele, estimativa marcada em `estimado`)
-- para o app avisar o master e a tela ao passar de 80% e responder "limite diário
-- da IA atingido" ao estourar, em vez de falhar calado. Ver lib/ia/cota.ts.
--
-- SEM DADO PESSOAL, por desenho: não há coluna de usuário, e-mail, escritório,
-- empresa, arquivo nem conteúdo — só dia, provedor, modelo, finalidade e custo.
--
-- ACESSO: RLS ligada e SEM policies, como as outras tabelas — a publishable key não
-- lê nada; o servidor usa a secret key (lib/db.ts). A view é `security_invoker`
-- (respeita a RLS de quem consulta).
--
-- RETENÇÃO: o app apaga, de vez em quando (≈1 a cada 50 gravações), o que tem mais
-- de 90 dias. Sem cron.
--
-- ADITIVA: tabela e view novas, nada reescrito. O código funciona sem elas (a
-- leitura segue sem contador; o painel do master avisa que falta a migração).
-- Ordem publicar/aplicar indiferente. Reversão:
--   drop view if exists ia_uso_diario; drop table if exists ia_uso;

create table if not exists ia_uso (
  id          bigint generated always as identity primary key,
  em          timestamptz not null default now(),
  -- o dia da cota da Cloudflare é o dia UTC
  dia         date not null default ((now() at time zone 'utc')::date),
  provedor    text not null check (provedor in ('cloudflare', 'gemini')),
  modelo      text not null check (char_length(modelo) between 1 and 80),
  finalidade  text not null check (finalidade in ('ponto', 'documento', 'sugestao')),
  neuronios   numeric(10, 2) check (neuronios is null or neuronios >= 0),
  -- true = a API não informou e o app estimou pelos tokens/tamanho
  estimado    boolean not null default false,
  -- false = a chamada falhou (resposta inútil ou cota estourada); ainda conta o gasto
  ok          boolean not null default true
);

create index if not exists ia_uso_dia_idx on ia_uso (dia, provedor);
create index if not exists ia_uso_em_idx on ia_uso (em);

alter table ia_uso enable row level security;

create or replace view ia_uso_diario with (security_invoker = true) as
  select dia, provedor, sum(coalesce(neuronios, 0))::numeric(12, 2) as neuronios, count(*)::int as chamadas
  from ia_uso
  group by dia, provedor;

comment on table ia_uso is
  'Uso da IA por chamada (neurônios da Cloudflare Workers AI). Sem dado pessoal; retenção de 90 dias feita pelo app.';

notify pgrst, 'reload schema';
