-- Sprint 3 / Frente B — Portal do cliente: documentos enviados e pendências.
--
-- POR QUÊ: hoje o cliente manda nota, extrato e recibo por WhatsApp e alguém do
-- escritório baixa, renomeia e arquiva. Aqui o cliente envia direto para a
-- empresa dele, por competência e categoria, e o contador confere. O contador
-- também pede o que falta (pendência) e o cliente atende enviando o arquivo.
-- Ver docs/documentos.md.
--
-- SEGURANÇA:
-- - Tabelas com RLS ligada e SEM policies, como o resto: só a secret key (rotas
--   de API, depois de lib/acesso.ts) lê ou grava.
-- - Bucket `documentos` PRIVADO, também sem policies em storage.objects: nem a
--   publishable key nem um usuário anônimo alcançam os arquivos. Envio por URL
--   de upload assinada e download por URL assinada curta (60 s), ambas geradas
--   no servidor depois da guarda.
-- - `escritorio_id` é gravado pelo servidor a partir da empresa (nunca vem do
--   navegador) e serve de segunda trava no recorte: toda consulta de contador
--   filtra por empresa E escritório.
-- - Limite de tamanho e tipos aceitos valem no bucket (barreira do Storage) e em
--   lib/documentos.ts (barreira da aplicação, que ainda confere a assinatura dos
--   bytes ao confirmar o envio). As duas listas precisam andar juntas.
--
-- ORDEM: independente das migrações 0011–0014. Só exige a 0010 (escritorios).
-- Idempotente: pode ser rodada de novo.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- Pendências
-- O contador pede algo a uma empresa ("extrato de outubro do Banco do Brasil").
-- Criada antes de `documentos` porque o documento aponta para a pendência que
-- atende.
create table if not exists pendencias (
  id             uuid primary key default gen_random_uuid(),
  -- SEM FK para empresas, de propósito (mesmo padrão da 0009): com FK, o
  -- `salvarEmpresas` (lib/cadastro.ts) passaria a falhar no meio ao remover uma
  -- empresa com documentos. O vínculo é validado na aplicação.
  empresa_id     text not null,
  escritorio_id  uuid not null references escritorios (id) on delete restrict,
  titulo         text not null check (char_length(titulo) between 1 and 200),
  descricao      text check (descricao is null or char_length(descricao) <= 2000),
  -- sugestões para o envio (opcionais): o cliente já abre o formulário preenchido
  categoria      text check (categoria in ('nota', 'extrato', 'recibo', 'folha', 'outros')),
  competencia    text check (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  prazo          date,
  -- aberta → atendida (cliente enviou, ou o contador fechou à mão). Reabre se o
  -- contador achar que não serviu.
  status         text not null default 'aberta' check (status in ('aberta', 'atendida')),
  atendida_em    timestamptz,
  atendida_por   text,
  criado_por     text not null,
  criado_em      timestamptz not null default now(),
  -- exclusão lógica: permite o "desfazer" da tela
  excluido_em    timestamptz
);

create index if not exists pendencias_empresa_idx
  on pendencias (empresa_id, status, prazo)
  where excluido_em is null;
create index if not exists pendencias_escritorio_idx
  on pendencias (escritorio_id, status)
  where excluido_em is null;

alter table pendencias enable row level security;

-- ---------------------------------------------------------------- Documentos
create table if not exists documentos (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     text not null,  -- sem FK: ver o comentário em `pendencias`
  escritorio_id  uuid not null references escritorios (id) on delete restrict,
  -- mês de referência (AAAA-MM), não a data do envio
  competencia    text not null check (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  categoria      text not null check (categoria in ('nota', 'extrato', 'recibo', 'folha', 'outros')),
  -- caminho no bucket: <escritorio_id>/<id>.<ext>, gerado no servidor. O nome
  -- original do arquivo NUNCA entra no caminho (vai só em `nome_original`).
  caminho        text not null unique,
  nome_original  text not null check (char_length(nome_original) between 1 and 200),
  tamanho        bigint not null check (tamanho > 0 and tamanho <= 10485760),
  tipo           text not null check (tipo in (
                   'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
                   'application/xml', 'application/x-ofx', 'text/csv',
                   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  observacao     text check (observacao is null or char_length(observacao) <= 500),
  pendencia_id   uuid references pendencias (id) on delete set null,
  -- enviando: a linha existe e a URL de upload foi entregue, mas o arquivo ainda
  --           não foi confirmado (some das listas; linhas velhas são lixo).
  -- recebido: arquivo conferido pelo servidor (tamanho e assinatura dos bytes).
  -- conferido: o contador olhou e aceitou.
  -- rejeitado: os bytes não bateram com o tipo; o objeto é apagado, mas a linha
  --            FICA (conta no limite por hora e guia a faxina do bucket — o token
  --            de upload vale 2 h e permitiria subir de novo no mesmo caminho).
  status         text not null default 'enviando' check (status in ('enviando', 'recebido', 'conferido', 'rejeitado')),
  enviado_por    text not null,
  enviado_em     timestamptz not null default now(),
  conferido_por  text,
  conferido_em   timestamptz,
  excluido_em    timestamptz,
  -- quem excluiu: o cliente não desfaz a exclusão feita pela contabilidade
  excluido_por   text,
  excluido_por_gestor boolean not null default false
);

create index if not exists documentos_empresa_idx
  on documentos (empresa_id, competencia desc, enviado_em desc)
  where excluido_em is null;
create index if not exists documentos_escritorio_idx
  on documentos (escritorio_id, status)
  where excluido_em is null;
create index if not exists documentos_pendencia_idx
  on documentos (pendencia_id)
  where pendencia_id is not null;

alter table documentos enable row level security;

-- ---------------------------------------------------------------- Storage
-- Bucket privado. Tamanho e tipos: os mesmos de lib/documentos.ts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documentos', 'documentos', false, 10485760,
  array[
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/xml', 'application/x-ofx', 'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Nenhuma policy em storage.objects para este bucket, de propósito: só a secret
-- key (que ignora RLS) gera as URLs assinadas.

notify pgrst, 'reload schema';
