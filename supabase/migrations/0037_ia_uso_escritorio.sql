-- 0037 — Teto diário da IA por escritório (Sprint 18, frente A).
--
-- POR QUÊ: a cota gratuita da Cloudflare Workers AI (10.000 neurônios/dia) é UMA só
-- para a plataforma inteira (0036). Sem repartir, um escritório com muitas folhas
-- esgota o dia de todos. Com o escritório gravado em cada chamada, o app confere,
-- antes de chamar a IA, quanto aquele escritório já gastou hoje e recusa acima de
-- `IA_COTA_ESCRITORIO_PCT`% do dia (padrão 40%) com mensagem humana. Ver
-- lib/ia/cota.ts (`usoHojeEscritorio`) e lib/ia/index.ts.
--
-- DADO: só o id do escritório (o inquilino, não é dado pessoal). Continua sem
-- usuário, e-mail, empresa, arquivo ou conteúdo. Linhas antigas ficam com NULL
-- (contam só no dia da plataforma).
--
-- ACESSO: a tabela já tem RLS ligada e sem policies (0036); nada muda.
--
-- ADITIVA E IDEMPOTENTE: uma coluna nullable e um índice. O código funciona sem ela
-- (grava sem o escritório e o teto por escritório fica desligado; só o limite do dia
-- vale). Ordem publicar/aplicar indiferente. Depende da 0010 (escritorios) e da 0036.
-- Reversão:
--   drop index if exists ia_uso_escritorio_dia_idx;
--   alter table ia_uso drop column if exists escritorio_id;

alter table ia_uso
  add column if not exists escritorio_id uuid references escritorios (id) on delete set null;

create index if not exists ia_uso_escritorio_dia_idx on ia_uso (escritorio_id, dia, provedor)
  where escritorio_id is not null;

comment on column ia_uso.escritorio_id is
  'Escritório que pediu a leitura (teto diário por escritório, Sprint 18). NULL = chamada antiga ou sem escritório.';

notify pgrst, 'reload schema';
