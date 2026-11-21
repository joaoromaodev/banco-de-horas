-- 0031 — Medição própria (Sprint 15, frente A).
--
-- POR QUÊ: o tempo das rotas e das telas e os erros só eram vistos no painel da
-- Vercel. Agora o próprio app grava uma AMOSTRA (25% das cargas de página; os
-- erros sempre) e o master vê o resumo em /configuracoes.
--
-- SEM DADO PESSOAL, por desenho: a tabela não tem coluna para id de usuário,
-- e-mail, escritório, empresa, query string, corpo nem mensagem de erro. A rota é
-- normalizada no navegador e conferida no servidor contra a lista fechada de rotas
-- do app (lib/medicaoRotas.ts); os CHECKs abaixo são a última trava — rota só com
-- minúsculas, dígitos, `/`, `-`, `[` e `]`, e erro só como código curto.
--
-- ACESSO: RLS ligada e SEM policies, como as outras tabelas — a publishable key não
-- lê nada; o servidor usa a secret key (lib/db.ts).
--
-- RETENÇÃO: o app apaga, de vez em quando (≈1 a cada 50 gravações), o que tem mais
-- de 30 dias (`delete ... where em < now() - 30 dias`, pelo índice em `em`). Sem cron.
--
-- ADITIVA: tabela nova, nada reescrito. O código funciona sem ela (não grava, não
-- quebra; a seção do master avisa que falta a migração). Ordem publicar/aplicar
-- indiferente. Reversão: drop table if exists medicoes;

create table if not exists medicoes (
  id        bigint generated always as identity primary key,
  -- arredondado ao minuto: sem horário exato, não dá para seguir a navegação de alguém
  em        timestamptz not null default date_trunc('minute', now()),
  -- api = chamada a /api vista do navegador; pagina = web vital/visita; erro = exceção no servidor
  tipo      text not null check (tipo in ('api', 'pagina', 'erro')),
  rota      text not null check (char_length(rota) <= 120 and rota ~ '^/[][a-z0-9/-]*$'),
  metodo    text check (metodo is null or metodo in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  status    smallint check (status is null or status between 0 and 599),
  ms        integer check (ms is null or ms between 0 and 120000),
  metrica   text check (metrica is null or metrica in ('LCP', 'TTFB', 'INP', 'VISITA')),
  erro      text check (erro is null or erro ~ '^[A-Za-z][A-Za-z0-9_]{0,39}(:[A-Za-z0-9_]{1,12})?$'),
  papel     text check (papel is null or papel in ('master', 'usuario', 'cliente')),
  -- fração amostrada (volume estimado = soma de 1/taxa); 1 para o que entra sempre
  taxa      real not null default 1 check (taxa > 0 and taxa <= 1),
  -- false = entrou só por ser erro (fora da amostra): não conta para os tempos
  amostra   boolean not null default true
);

create index if not exists medicoes_em_idx on medicoes (em);

alter table medicoes enable row level security;

comment on table medicoes is
  'Amostra de medição do app (tempo de API e de tela, erros). Sem dado pessoal; retenção de 30 dias feita pelo app.';

notify pgrst, 'reload schema';
