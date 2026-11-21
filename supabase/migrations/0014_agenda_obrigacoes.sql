-- Sprint 3 / Frente A — Agenda de obrigações por empresa-cliente + aviso por e-mail.
--
-- POR QUÊ: o escritório controla vencimentos (DAS, DCTFWeb, FGTS, certificado,
-- alvará…) de cada cliente em planilha ou de cabeça. Aqui ele cadastra a REGRA
-- de cada obrigação por empresa; as ocorrências (uma por competência) são
-- geradas em código (lib/agenda.ts) e NÃO são gravadas. Só vai ao banco quem
-- marcou cada competência como feita, e quando. Ver docs/agenda.md.
--
-- Inquilino: toda linha tem `escritorio_id` (o da empresa, conferido na rota).
-- `empresa_id` é o id interno de `empresas` (text). Apagar a empresa apaga a
-- agenda dela (cascata): a regra não faz sentido sem a empresa.
--
-- ORDEM: depende só da 0010 (escritorios) e da 0004 (empresas). Independente da
-- 0011–0013 e da 0015. Idempotente: pode rodar de novo.

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------ obrigações
create table if not exists agenda_obrigacoes (
  id             uuid primary key default gen_random_uuid(),
  escritorio_id  uuid not null references escritorios (id) on delete restrict,
  empresa_id     text not null references empresas (id) on delete cascade,
  -- código do catálogo (lib/agenda.ts → CATALOGO). Sem CHECK de propósito: o
  -- catálogo cresce sem migração; a rota valida.
  tipo           text not null,
  nome           text not null check (length(nome) between 1 and 120),
  recorrencia    text not null check (recorrencia in ('mensal', 'trimestral', 'anual', 'unica')),
  -- como o dia é contado: dia fixo do mês, n-ésimo dia útil, último dia útil
  modo_dia       text not null default 'dia_fixo'
                 check (modo_dia in ('dia_fixo', 'n_dia_util', 'ultimo_dia_util')),
  dia            int  not null default 0 check (dia between 0 and 31),
  -- anual: mês do vencimento
  mes            int  check (mes between 1 and 12),
  -- meses (mensal/trimestral) ou anos (anual) entre a competência e o vencimento
  defasagem      int  not null default 1 check (defasagem between 0 and 12),
  -- dia fixo em dia não útil: antecipa, prorroga ou mantém
  ajuste         text not null default 'nenhum' check (ajuste in ('antecipa', 'prorroga', 'nenhum')),
  data_unica     date,
  aviso_dias     int  not null default 0 check (aviso_dias between 0 and 120),
  -- "acompanhar a partir de": nada que vença antes aparece como atrasado
  inicio         date not null default current_date,
  responsavel    text,          -- e-mail de um usuário do escritório (informativo)
  observacao     text,
  ativa          boolean not null default true,

  criado_por     text not null,
  criado_em      timestamptz not null default now(),
  atualizado_por text,
  atualizado_em  timestamptz,
  -- exclusão lógica: permite o "desfazer" da tela
  excluido_em    timestamptz,

  constraint anual_tem_mes   check (recorrencia <> 'anual' or mes is not null),
  constraint unica_tem_data  check (recorrencia <> 'unica' or data_unica is not null)
);

create index if not exists agenda_obrigacoes_escritorio
  on agenda_obrigacoes (escritorio_id, empresa_id) where excluido_em is null;

-- ------------------------------------------------------------ conclusões
-- Uma linha = "esta competência desta obrigação foi feita". Pendente é a
-- ausência da linha; desfazer é apagá-la. Competência: 'AAAA-MM' (mensal),
-- 'AAAA-Tn' (trimestral), 'AAAA' (anual) ou 'unica'.
create table if not exists agenda_conclusoes (
  obrigacao_id   uuid not null references agenda_obrigacoes (id) on delete cascade,
  escritorio_id  uuid not null references escritorios (id) on delete restrict,
  competencia    text not null check (competencia ~ '^(\d{4}(-(0[1-9]|1[0-2]|T[1-4]))?|unica)$'),
  feita_por      text not null,
  feita_em       timestamptz not null default now(),
  primary key (obrigacao_id, competencia)
);

create index if not exists agenda_conclusoes_escritorio on agenda_conclusoes (escritorio_id, competencia);

-- ------------------------------------------------------------ aviso por e-mail
-- Preferência do escritório. Sem linha = semanal, para os administradores.
create table if not exists agenda_avisos (
  escritorio_id  uuid primary key references escritorios (id) on delete cascade,
  frequencia     text not null default 'semanal' check (frequencia in ('diario', 'semanal', 'desligado')),
  -- vazio = administradores do escritório
  destinatarios  text[] not null default '{}',
  atualizado_por text,
  atualizado_em  timestamptz not null default now()
);

-- Registro de envios. A chave (escritório, dia) é a trava de idempotência: a
-- Vercel pode chamar o cron duas vezes; quem não consegue inserir não envia.
create table if not exists agenda_envios (
  escritorio_id  uuid not null references escritorios (id) on delete cascade,
  dia            date not null,
  frequencia     text not null,
  destinatarios  text[] not null default '{}',
  itens          int  not null default 0,
  -- 'enviando' → 'enviado' | 'registrado' (sem provedor de e-mail) | 'falhou'
  situacao       text not null default 'enviando',
  erro           text,
  criado_em      timestamptz not null default now(),
  primary key (escritorio_id, dia)
);

-- Mesma regra do resto do backend: RLS ligada SEM policies. Só a secret key
-- (rotas de API) alcança as tabelas.
alter table agenda_obrigacoes enable row level security;
alter table agenda_conclusoes enable row level security;
alter table agenda_avisos     enable row level security;
alter table agenda_envios     enable row level security;

notify pgrst, 'reload schema';
