-- 0030 — Pedidos mensais abertos na primeira visita do mês (Sprint 14, frente A).
--
-- POR QUÊ: os pedidos mensais do fechamento (0018) só abriam pelo cron diário
-- (/api/cron/agenda). Sem `CRON_SECRET` na Vercel o cron responde 503 e os pedidos
-- de 1º do mês não saem — calado. Agora a primeira visita do mês da contadora ao
-- /painel e do cliente ao /inicio também abre os pedidos do escritório
-- (lib/pedidosNaVisita.ts). Para não refazer a consulta a cada visita, o escritório
-- guarda a última competência já aberta.
--
-- IDEMPOTÊNCIA: a trava contra pedido duplicado continua sendo o índice único
-- `pendencias_modelo_competencia_uniq (modelo_id, competencia)` da 0018 — o modelo
-- já é de UMA empresa, então ele equivale a (modelo, empresa, competência). Duas
-- visitas simultâneas (ou visita + cron) tentam inserir; a segunda recebe 23505 e
-- conta como "já existia". Esta migração NÃO cria índice novo.
--
-- ADITIVA: uma coluna nullable, nenhuma linha reescrita. O código funciona sem ela
-- (sem a marca, guarda a competência só na memória do processo e, no pior caso,
-- refaz a conferência — que é idempotente). Ordem publicar/aplicar indiferente.
-- Reversão: alter table escritorios drop column if exists pedidos_competencia_aberta;

alter table escritorios
  add column if not exists pedidos_competencia_aberta text
  check (pedidos_competencia_aberta is null or pedidos_competencia_aberta ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

comment on column escritorios.pedidos_competencia_aberta is
  'Última competência (AAAA-MM) cujos pedidos mensais já foram abertos para o escritório (visita ou cron).';

notify pgrst, 'reload schema';
