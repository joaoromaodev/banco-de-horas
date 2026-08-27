-- Fase 6 — cadastro (empresas + usuários) migrado do Google Sheets para o Postgres.
--
-- POR QUÊ: a conta de serviço do Google perdeu a permissão de escrita na planilha
-- e, mesmo fora disso, manter a identidade das empresas e o login em uma planilha
-- é frágil (escrita concorrente, sem tipos, permissão externa). O Livro Caixa já
-- vive aqui e referencia `empresa_id`; trazer as empresas para o mesmo banco fecha
-- esse vínculo. Funcionários, feriados e config (módulo Folha de Ponto) seguem no
-- Sheets por ora — só leitura é usada por eles no dia a dia.
--
-- `id` da empresa é o MESMO id interno já usado em todo o sistema (o das abas do
-- Sheets e o `empresa_id` das tabelas do caixa) — por isso é `text`, preservado
-- na migração de dados, não um uuid novo.

create table if not exists empresas (
  id                 text primary key,
  nome               text not null,
  cnpj               text,
  trabalha_sabado    boolean not null default false,
  jornada_util_min   int,
  jornada_sabado_min int,
  ordem              int,
  -- e-mail do contador (papel `usuario`) dono desta empresa; vazio = sem dono
  contador           text,
  criado_em          timestamptz not null default now()
);

create table if not exists usuarios (
  email     text primary key,
  nome      text not null,
  role      text not null check (role in ('master', 'usuario', 'cliente')),
  -- PBKDF2 (mesmo esquema de lib/auth.ts): salt + hash em hex
  salt      text not null,
  hash      text not null,
  -- id da empresa vinculada (só papel `cliente`)
  empresa   text,
  -- módulos liberados ao contador; cliente/master resolvem em runtime
  modulos   text[] not null default '{}',
  -- e-mail do contador que criou este cliente (escopo de gestão); nulo p/ os demais
  dono      text,
  criado_em timestamptz not null default now()
);

create index if not exists usuarios_dono_idx on usuarios (dono);
create index if not exists empresas_contador_idx on empresas (contador);

-- Mesma regra do resto do backend: RLS ligada SEM policies. Quem lê/escreve é a
-- rota de API com a secret key (que ignora RLS); a publishable key do navegador
-- não alcança nada.
alter table empresas enable row level security;
alter table usuarios enable row level security;

-- PostgREST guarda o schema em cache — sem isto as tabelas novas só aparecem na
-- próxima reinicialização e a API responde "Could not find the table".
notify pgrst, 'reload schema';
