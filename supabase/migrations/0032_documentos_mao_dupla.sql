-- Sprint 17 / Frente A — Documentos de mão dupla.
--
-- POR QUÊ: o portal só ia do cliente para o escritório. Aqui:
--   1. ENTREGAS (escritório → cliente): a contadora publica guia, DAS, holerite,
--      declaração… para uma empresa, com competência e vencimento opcional. O
--      cliente vê, baixa e fica registrado "aberto em …" (a primeira abertura pelo
--      cliente) — a prova de entrega que a contadora não tinha.
--   2. SITUAÇÃO de cada documento enviado pelo cliente: recebido → aceito
--      (`conferido`, como já era) ou DEVOLVIDO com motivo (como a folha de ponto).
--   3. "NÃO TENHO ESTE MÊS" no pedido: o cliente responde que não houve o
--      documento, com observação opcional; o pedido sai de "aberto" (status
--      `atendida`, marcado como sem movimento) e o checklist de fechamento deixa de
--      mostrar atraso falso.
-- Ver docs/documentos.md (Sprint 17 · Frente A).
--
-- SEGURANÇA:
-- - `entregas` com RLS ligada e SEM policies, como `documentos`: só a secret key
--   (rotas de API, depois de lib/acesso.ts) lê ou grava.
-- - O arquivo vai para o MESMO bucket privado `documentos` (0015), no caminho
--   `<escritorio_id>/entregas/<id>.<ext>` — só uuids gerados no servidor, prefixo
--   próprio para a faxina distinguir do que o cliente enviou. Sem policy nova em
--   storage.objects: envio por URL de upload assinada e download por URL assinada
--   de 60 s, gerada depois da guarda.
-- - `escritorio_id` vem do cadastro da empresa (nunca do navegador) e é a segunda
--   trava do recorte (toda leitura de não-master filtra por empresa E escritório).
--   Sem FK para `empresas`, como `documentos`/`pendencias` (ver 0015).
-- - Tipos e tamanho: os mesmos de `documentos` (lista de permissão, 10 MB), e a
--   aplicação ainda confere a assinatura dos bytes ao confirmar a publicação.
--
-- ORDEM: depois da 0015 (documentos, pendencias, bucket) e da 0010 (escritorios).
-- ADITIVA e idempotente. O código funciona antes dela (lê sem as colunas novas;
-- entregas, devolver e "não tenho" respondem 503 "aplique a 0032").
-- Reversão:
--   drop table if exists entregas;
--   alter table pendencias drop column if exists sem_movimento_em,
--     drop column if exists sem_movimento_por, drop column if exists sem_movimento_obs;
--   update documentos set status = 'recebido' where status = 'devolvido';
--   alter table documentos drop constraint if exists documentos_status_check;
--   alter table documentos add constraint documentos_status_check
--     check (status in ('enviando', 'recebido', 'conferido', 'rejeitado'));
--   alter table documentos drop column if exists devolvido_em,
--     drop column if exists devolvido_por, drop column if exists motivo_devolucao;

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- 1. entregas
create table if not exists entregas (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     text not null,  -- sem FK: ver o comentário em `pendencias` (0015)
  escritorio_id  uuid not null references escritorios (id) on delete restrict,
  tipo           text not null check (tipo in ('guia', 'das', 'holerite', 'declaracao', 'outro')),
  -- escrito pela contadora PARA o cliente; aparece só nas telas, nunca no sino
  titulo         text check (titulo is null or char_length(titulo) <= 200),
  competencia    text not null check (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  vencimento     date,
  observacao     text check (observacao is null or char_length(observacao) <= 500),
  -- <escritorio_id>/entregas/<id>.<ext>, gerado no servidor
  caminho        text not null unique,
  nome_original  text not null check (char_length(nome_original) between 1 and 200),
  tamanho        bigint not null check (tamanho > 0 and tamanho <= 10485760),
  mime           text not null check (mime in (
                   'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
                   'application/xml', 'application/x-ofx', 'text/csv',
                   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  -- enviando: linha gravada e URL de upload entregue; o cliente ainda não vê.
  -- publicada: o servidor conferiu tamanho e assinatura dos bytes.
  -- rejeitada: os bytes não bateram; o objeto é apagado e a linha FICA (faxina).
  status         text not null default 'enviando' check (status in ('enviando', 'publicada', 'rejeitada')),
  publicado_por  text not null,
  publicado_em   timestamptz not null default now(),
  -- protocolo de leitura: a PRIMEIRA abertura pelo cliente (nunca a da contabilidade).
  -- Gravado com `where aberto_em is null`: abrir de novo não muda a data.
  aberto_em      timestamptz,
  aberto_por     text,
  -- exclusão lógica (o "desfazer" da tela); o arquivo fica no Storage
  excluido_em    timestamptz,
  excluido_por   text
);

create index if not exists entregas_empresa_idx
  on entregas (empresa_id, competencia desc, publicado_em desc)
  where excluido_em is null;
-- "quem ainda não abriu", por escritório, perto do vencimento
create index if not exists entregas_nao_abertas_idx
  on entregas (escritorio_id, vencimento)
  where excluido_em is null and aberto_em is null and status = 'publicada';

alter table entregas enable row level security;

-- ------------------------------------------- 2. situação do documento enviado
alter table documentos add column if not exists devolvido_em timestamptz;
alter table documentos add column if not exists devolvido_por text;
alter table documentos add column if not exists motivo_devolucao text
  check (motivo_devolucao is null or char_length(motivo_devolucao) <= 500);

-- `devolvido` entra na lista de situações. O CHECK da 0015 é de coluna, com o nome
-- padrão do Postgres (`documentos_status_check`).
alter table documentos drop constraint if exists documentos_status_check;
alter table documentos add constraint documentos_status_check
  check (status in ('enviando', 'recebido', 'conferido', 'devolvido', 'rejeitado'));

-- Trava: se em algum banco o CHECK antigo tiver outro nome, ele sobreviveria ao
-- `drop … if exists` acima e barraria `devolvido` para sempre (a tela diria só
-- "aplique a 0032"). Aqui a migração falha alto, com a causa.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'documentos'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
      and pg_get_constraintdef(oid) not ilike '%devolvido%'
  ) then
    raise exception '0032: ainda há um CHECK de status em documentos sem ''devolvido'' (nome diferente de documentos_status_check). Remova-o e rode de novo.';
  end if;
end $$;

-- ------------------------------------------------ 3. "não tenho este mês"
alter table pendencias add column if not exists sem_movimento_em timestamptz;
alter table pendencias add column if not exists sem_movimento_por text;
alter table pendencias add column if not exists sem_movimento_obs text
  check (sem_movimento_obs is null or char_length(sem_movimento_obs) <= 500);

notify pgrst, 'reload schema';
