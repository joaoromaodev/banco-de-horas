-- 0029 — Documento → lançamento sugerido por IA (Sprint 12, Frente A).
--
-- O QUE TRAZ
-- 1. `empresas.caixa_ia_documento` — a opção POR EMPRESA (segunda trava da IA que
--    lê documentos). Desligada por padrão; só a contabilidade liga, pela rota
--    `/api/caixa/documento-ia` (PATCH). A primeira trava é da plataforma: a
--    variável `CAIXA_IA_DOCUMENTO=ligada`. Ver docs/livro-caixa.md.
-- 2. `lancamentos.documento_id` — o lançamento mostra o anexo de onde veio
--    (documento do portal, migração 0015). Se o documento sumir de vez, o
--    lançamento fica e só perde o vínculo.
-- 3. `ponto_leituras_ocr.origem` — a cota mensal de leituras por IA do escritório
--    (0012) passa a contar também os documentos lidos para o caixa. Uma cota só,
--    por plano; a origem separa folha de documento para medir e auditar.
--
-- ADITIVA: só colunas e índices novos, com default; nenhuma linha muda de sentido
-- (as leituras de folha que já existem recebem origem 'folha', que é o que são).
-- O código funciona sem ela: a IA de documentos responde 503 ("falta a migração
-- 0029") e o lançamento grava sem o vínculo. Aplique antes de ligar a variável.
--
-- Depende de 0002 (lancamentos), 0012 (ponto_leituras_ocr) e 0015 (documentos).
-- RLS: nenhuma tabela nova; as três já estão com RLS ligada sem policies.
--
-- Reversão (o código volta a funcionar sem a IA de documentos):
--   alter table lancamentos drop column if exists documento_id;
--   alter table empresas drop column if exists caixa_ia_documento;
--   alter table ponto_leituras_ocr drop column if exists origem;

alter table empresas
  add column if not exists caixa_ia_documento boolean not null default false;

alter table lancamentos
  add column if not exists documento_id uuid references documentos (id) on delete set null;

-- Achar os lançamentos de um documento (desvincular, auditar).
create index if not exists lancamentos_documento_idx
  on lancamentos (documento_id) where documento_id is not null;

alter table ponto_leituras_ocr
  add column if not exists origem text not null default 'folha';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ponto_leituras_ocr_origem_check'
  ) then
    alter table ponto_leituras_ocr
      add constraint ponto_leituras_ocr_origem_check check (origem in ('folha', 'documento'));
  end if;
end $$;

notify pgrst, 'reload schema';
