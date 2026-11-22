-- 0033 — Nota e boleto sem IA (Sprint 17, Frente B).
--
-- O QUE TRAZ
-- `lancamentos.chave_documento` — a identidade do documento de onde o lançamento
-- veio, quando ele foi lido sem IA (`/api/caixa/documento-leitura`):
--   nfe:<chave de acesso, 44>          NF-e e NFC-e (XML ou DANFE em PDF)
--   nfse:<chave nacional, 50>          NFS-e padrão nacional
--   nfse:<CNPJ/CPF prestador>:<número> NFS-e ABRASF (prefeitura)
--   boleto:<código de barras, 44>      boleto
-- É por ela que a leitura seguinte da MESMA nota (ou boleto) na mesma empresa
-- aponta "já lançada em …" antes de gravar. Só aponta: não bloqueia (duas
-- parcelas do mesmo boleto não existem, mas a contadora decide).
--
-- ADITIVA: uma coluna nula e um índice parcial; nenhuma linha muda. O código
-- funciona sem ela: o POST de lançamentos tenta de novo sem a coluna, e a
-- duplicidade passa a ser conferida só pelo documento do portal (0029).
--
-- Depende de 0002 (lancamentos). RLS: nenhuma tabela nova.
--
-- Reversão:
--   drop index if exists lancamentos_chave_documento_idx;
--   alter table lancamentos drop column if exists chave_documento;

alter table lancamentos
  add column if not exists chave_documento text
    check (chave_documento is null or chave_documento ~ '^(nfe|nfse|boleto):[0-9A-Za-z:]{8,80}$');

-- Procurar o mesmo documento nos exercícios da empresa.
create index if not exists lancamentos_chave_documento_idx
  on lancamentos (chave_documento, exercicio_id) where chave_documento is not null;
