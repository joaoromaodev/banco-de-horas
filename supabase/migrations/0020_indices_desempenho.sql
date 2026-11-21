-- Sprint 6 / Frente B — Índices de desempenho.
--
-- POR QUÊ: com a leitura paginada (lib/db.ts) e as consultas por lote, sobraram
-- poucos filtros reais sem índice. Esta migração SÓ CRIA ÍNDICE (`if not exists`):
-- nada muda de comportamento, é compatível com o código antigo e pode rodar de novo.
--
-- ORDEM: depende da 0012 (ponto), 0015 (pendencias) e 0002 (lancamentos). Pode
-- ser aplicada a qualquer momento, antes ou depois da publicação do código.
--
-- SEM `concurrently`: `create index concurrently` não roda dentro de transação, e
-- o `supabase db push` aplica cada arquivo numa transação. Hoje as tabelas têm
-- centenas de linhas (183 dias de ponto, 46 lançamentos): o índice sai em
-- milissegundos e o bloqueio de escrita é imperceptível. Se um dia a tabela
-- crescer (dezenas de milhares de linhas), rode os três comandos à mão no SQL
-- Editor, UM POR VEZ, com `concurrently` e sem BEGIN.
--
-- Reversão:
--   drop index if exists pendencias_competencia_idx;
--   drop index if exists ponto_frequencias_ordem_idx;
--   drop index if exists lancamentos_conta_idx;

-- Fechamento mensal: "os pedidos da competência X" de um escritório
-- (lerDocumentosPedidos: competencia + escritorio_id [+ empresa_id in (...)]).
-- Os índices da 0015 começam por (empresa_id, status, prazo) ou (escritorio_id, status)
-- e não servem ao filtro por competência.
create index if not exists pendencias_competencia_idx
  on pendencias (escritorio_id, competencia)
  where excluido_em is null;

-- Ponto: a folha do mês lê (empresa, ano, mes) já ordenada por funcionário e dia
-- (lerFrequenciasDoMes). Com a ordem no índice o Postgres lê direto, sem
-- ordenar. O (empresa_id, ano, mes) da 0012 continua servindo aos demais filtros.
create index if not exists ponto_frequencias_ordem_idx
  on ponto_frequencias (empresa_id, ano, mes, funcionario, dia);

-- Livro caixa: lançamentos por conta. Sem este, apagar/trocar uma conta do
-- catálogo (FK `on delete restrict`) varre a tabela inteira de lançamentos para
-- conferir se alguma a usa. Parcial: lançamento de transferência (conta nula) fica de fora.
create index if not exists lancamentos_conta_idx
  on lancamentos (conta_id)
  where conta_id is not null;
