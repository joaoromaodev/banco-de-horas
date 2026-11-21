-- 0016 — Arquivar empresa em vez de excluir.
--
-- POR QUÊ: excluir uma empresa com dados devolvia erro cru do Postgres (ponto, FK
-- restrict) ou, pior, apagava em cascata (agenda) ou deixava órfãos (caixa,
-- contratos, documentos, pendências, sem FK). Contabilidade tem dever de guarda
-- (fiscal 5 anos; trabalhista, mais). A tela agora ARQUIVA: a empresa some das
-- listas, seletores, painel, agenda e cron; os dados ficam intactos; reativar
-- devolve tudo. Exclusão definitiva só por SQL do master, após o prazo de guarda.
--
-- ADITIVA: só colunas anuláveis. Nada é apagado nem reescrito. Aplicar antes de
-- publicar o código desta frente (sem a coluna, a leitura de empresas falha).

alter table empresas add column if not exists arquivada_em     timestamptz;
alter table empresas add column if not exists arquivada_por    text;
alter table empresas add column if not exists arquivada_motivo text;

create index if not exists empresas_ativas_idx
  on empresas (escritorio_id) where arquivada_em is null;
