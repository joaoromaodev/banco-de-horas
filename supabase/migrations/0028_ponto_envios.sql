-- Sprint 10 / Frente A — Folha de ponto enviada pelo cliente.
--
-- POR QUÊ: hoje a contadora recebe a foto da folha por WhatsApp, baixa e sobe na
-- Timesheet. Aqui a própria empresa-cliente fotografa a folha de cada funcionário
-- no celular e manda; a IA lê em fila e deixa um RASCUNHO; a contadora confere na
-- Timesheet, ajusta e aplica à frequência (ou devolve com motivo). Ver a seção
-- "Folha enviada pelo cliente" em docs/folha-de-ponto.md.
--
-- SEGURANÇA:
-- - RLS ligada e SEM policies, como o resto: só a secret key (rotas de API,
--   depois de lib/acesso.ts + lib/pontoAcesso.ts) lê ou grava.
-- - Bucket `ponto` PRIVADO, sem policies em storage.objects. Envio por URL de
--   upload assinada para um caminho escolhido no servidor; a foto é aberta por URL
--   assinada de 60 s, gerada depois da guarda.
-- - Chave composta (empresa_id, escritorio_id) → empresas, como as tabelas do
--   ponto (0012): um envio não consegue dizer que é do escritório A apontando para
--   empresa do B. `escritorio_id` vem sempre do cadastro da empresa.
-- - Só imagens (JPG, PNG, WEBP, HEIC) até 8 MB, no bucket e na aplicação, que
--   ainda confere a assinatura dos bytes ao confirmar o envio.
-- - Dado pessoal: a foto tem nome e horários do funcionário. Ela é apagada do
--   Storage 90 dias depois de o envio terminar (aplicado, devolvido ou excluído);
--   envio recusado ou abandonado, em 1 dia; qualquer envio, 180 dias depois de
--   enviado, mesmo parado na fila (`foto_apagada_em` marca). Faxina no cron diário
--   (lib/envioPontoServidor.ts → expurgarFotos), que também limpa as cópias de
--   frequência do "desfazer" depois de 12 h.
--
-- ORDEM: depois da 0012 (tabelas do ponto) e da 0027 (numeração). Não depende de 0013–0027.
-- ADITIVA e idempotente: pode ser rodada de novo.

create extension if not exists "pgcrypto";

create table if not exists ponto_envios (
  id                   uuid primary key default gen_random_uuid(),
  escritorio_id        uuid not null references escritorios (id) on delete restrict,
  empresa_id           text not null,
  -- o ponto liga funcionário e frequência pelo NOME (0012); o id do DP é só apoio
  funcionario          text not null check (char_length(btrim(funcionario)) between 1 and 120),
  empregado_id         uuid,
  ano                  smallint not null check (ano between 2000 and 2100),
  mes                  smallint not null check (mes between 1 and 12),
  -- <escritorio_id>/<id>.<ext>, gerado no servidor; o nome do arquivo não entra
  caminho              text not null unique,
  tipo                 text not null check (tipo in ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  tamanho              bigint not null check (tamanho > 0 and tamanho <= 8388608),
  -- enviando → recebida → lendo → lida | falhou → aplicada | devolvida
  -- (rejeitada = os bytes não eram imagem; a linha fica para o limite por hora e a faxina)
  situacao             text not null default 'enviando' check (situacao in (
                         'enviando', 'recebida', 'lendo', 'lida', 'falhou', 'aplicada', 'devolvida', 'rejeitada')),
  -- por que uma recebida ainda não foi lida: cota, ritmo ou limite automático da empresa
  aguardando           text check (aguardando in ('cota', 'ritmo', 'limite_empresa', 'sem_ia')),
  -- leitura da IA: { dias: [...], incertos: [...], funcionarioLido }
  rascunho             jsonb,
  leitura_id           uuid,
  tentativas           smallint not null default 0,
  lendo_desde          timestamptz,
  lido_em              timestamptz,
  -- motivo da devolução (o cliente vê)
  motivo               text check (motivo is null or char_length(motivo) <= 500),
  devolvido_por        text,
  devolvido_em         timestamptz,
  aplicado_por         text,
  aplicado_em          timestamptz,
  -- os dias que havia na frequência antes de aplicar: o "desfazer" volta para eles
  frequencia_anterior  jsonb,
  -- os dias que foram aplicados: o "desfazer" só vale se a frequência ainda for esta
  -- (não apaga uma edição ou aplicação posterior). As duas somem depois de 12 h.
  frequencia_aplicada  jsonb,
  enviado_por         text not null,
  enviado_em           timestamptz not null default now(),
  excluido_em          timestamptz,
  excluido_por         text,
  excluido_por_gestor  boolean not null default false,
  foto_apagada_em      timestamptz,
  constraint ponto_envios_empresa_fk foreign key (empresa_id, escritorio_id)
    references empresas (id, escritorio_id) on update cascade on delete restrict
);

create index if not exists ponto_envios_empresa_idx
  on ponto_envios (escritorio_id, empresa_id, ano, mes)
  where excluido_em is null;
-- limite de envios por hora da empresa
create index if not exists ponto_envios_hora_idx on ponto_envios (empresa_id, enviado_em);
-- fila: recebidas e leituras presas
create index if not exists ponto_envios_fila_idx
  on ponto_envios (empresa_id, situacao)
  where situacao in ('recebida', 'lendo', 'falhou') and excluido_em is null;
-- faxina das fotos
create index if not exists ponto_envios_faxina_idx
  on ponto_envios (situacao, enviado_em)
  where foto_apagada_em is null;

alter table ponto_envios enable row level security;

-- ---------------------------------------------------------------- Storage
-- Bucket privado. Tamanho e tipos: os mesmos de lib/envioPonto.ts (TIPOS_FOTO,
-- LIMITE_FOTO_BYTES) e do CHECK acima — os três andam juntos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ponto', 'ponto', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Nenhuma policy em storage.objects para este bucket, de propósito.

notify pgrst, 'reload schema';
