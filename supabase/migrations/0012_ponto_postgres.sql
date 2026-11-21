-- Sprint 2 / Frente B — Folha de Ponto sai do Google Sheets e vem para o Postgres,
-- recortada por ESCRITÓRIO (o inquilino, migração 0010). Ver docs/folha-de-ponto.md.
--
-- O que a planilha guardava e para onde vai:
--   aba Funcionarios (nome, cargo, jornadas, ordem, empresa)  → ponto_funcionarios
--   aba Frequencias  (um registro por dia lançado)             → ponto_frequencias
--   aba Feriados     (data, descrição; lista ÚNICA global)     → ponto_feriados (por escritório)
--   aba Config       (gemini_api_key, gemini_modelo)           → nada: a chave passa a ser
--                    da plataforma (GEMINI_API_KEY) e o modelo, GEMINI_MODELO
--   (novo) cota mensal de leituras por IA                      → ponto_leituras_ocr
-- As abas Empresas/Usuarios da planilha já tinham migrado na 0004 e não são lidas.
--
-- ADITIVA: só cria tabelas e uma constraint única em `empresas` que já é garantida
-- pela chave primária. Nada que o código antigo faz passa a falhar. Os dados entram
-- depois, pelo script `scripts/importar-ponto.mjs` (ver "Para o integrador" no doc).
--
-- ORDEM: depois da 0011 (cobrança) e antes da 0013. Não depende de nada da 0011.
--
-- Mesma regra do resto do backend: RLS ligada SEM policies. Só a secret key (rotas
-- de API, que aplicam lib/acesso.ts + lib/pontoAcesso.ts) alcança estas tabelas.

-- Chave composta para amarrar (empresa, escritório) nas tabelas do ponto: uma linha
-- de ponto não pode dizer que é do escritório A apontando para empresa do B. Como
-- `id` já é a chave primária, esta unicidade é trivialmente verdadeira.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'empresas_id_escritorio_uniq') then
    alter table empresas add constraint empresas_id_escritorio_uniq unique (id, escritorio_id);
  end if;
end $$;

-- ---------------------------------------------------------------- Funcionários
create table if not exists ponto_funcionarios (
  id                  uuid primary key default gen_random_uuid(),
  escritorio_id       uuid not null references escritorios (id) on delete restrict,
  empresa_id          text not null,
  nome                text not null check (btrim(nome) <> ''),
  cargo               text,
  -- jornada em minutos; nulo = usa a da empresa
  jornada_util_min    integer check (jornada_util_min is null or jornada_util_min between 0 and 1440),
  jornada_sabado_min  integer check (jornada_sabado_min is null or jornada_sabado_min between 0 and 1440),
  ordem               integer,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now(),
  -- `on update cascade`: mover a empresa de escritório (só por SQL, pelo master)
  -- leva junto o ponto dela. `on delete restrict`: apagar empresa com ponto
  -- lançado é erro — o histórico trabalhista não some por um clique no cadastro.
  constraint ponto_funcionarios_empresa_fk foreign key (empresa_id, escritorio_id)
    references empresas (id, escritorio_id) on update cascade on delete restrict,
  -- As frequências apontam para o funcionário pelo NOME (como na planilha).
  constraint ponto_funcionarios_nome_uniq unique (empresa_id, nome)
);
create index if not exists ponto_funcionarios_escritorio_idx on ponto_funcionarios (escritorio_id);

-- ---------------------------------------------------------------- Frequências
-- Um registro por funcionário × dia lançado (só dias com horário ou marcador).
-- Horários ficam como TEXTO "HH:MM", exatamente como foram revisados: a leitura por
-- IA pode devolver algo fora do padrão (há "12>54" na planilha) e o dado da folha
-- não deve ser reescrito em silêncio. A validação é da tela (lib/validacao.ts).
create table if not exists ponto_frequencias (
  id              uuid primary key default gen_random_uuid(),
  escritorio_id   uuid not null references escritorios (id) on delete restrict,
  empresa_id      text not null,
  funcionario     text not null check (btrim(funcionario) <> ''),
  ano             smallint not null check (ano between 2000 and 2100),
  mes             smallint not null check (mes between 1 and 12),
  dia             smallint not null check (dia between 1 and 31),
  entrada_manha   text,
  saida_almoco    text,
  retorno_almoco  text,
  saida_tarde     text,
  marcador        text check (marcador is null or marcador in
                    ('FERIADO', 'BANCO DE HORAS', 'ATESTADO', 'FOLGA', 'FALTA', 'FÉRIAS')),
  atualizado_em   timestamptz not null default now(),
  -- e-mail de quem salvou (auditoria); nulo nas linhas importadas da planilha
  atualizado_por  text,
  constraint ponto_frequencias_empresa_fk foreign key (empresa_id, escritorio_id)
    references empresas (id, escritorio_id) on update cascade on delete restrict,
  constraint ponto_frequencias_dia_uniq unique (empresa_id, funcionario, ano, mes, dia)
);
create index if not exists ponto_frequencias_mes_idx on ponto_frequencias (empresa_id, ano, mes);
create index if not exists ponto_frequencias_escritorio_idx on ponto_frequencias (escritorio_id);

-- ---------------------------------------------------------------- Feriados
-- Antes era uma lista só (a de Belém, da Edilse) para todo mundo. Agora cada
-- escritório tem a sua — um escritório de outra cidade não herda nem altera a dela.
create table if not exists ponto_feriados (
  id             uuid primary key default gen_random_uuid(),
  escritorio_id  uuid not null references escritorios (id) on delete restrict,
  data           date not null,
  descricao      text not null default '',
  constraint ponto_feriados_data_uniq unique (escritorio_id, data)
);

-- ---------------------------------------------------------------- Cota de leitura por IA
-- Uma linha por leitura. A rota RESERVA a linha antes de chamar o Gemini (situação
-- 'reservada') e conta as do mês já com ela; se passou do limite do plano, apaga a
-- reserva e recusa. Assim duas leituras simultâneas no limite não furam a cota.
-- Leitura que falha apaga a reserva (não conta); a bem-sucedida vira 'concluida'.
-- `competencia` = AAAA-MM no fuso de Belém, calculada no servidor.
create table if not exists ponto_leituras_ocr (
  id             uuid primary key default gen_random_uuid(),
  escritorio_id  uuid not null references escritorios (id) on delete restrict,
  competencia    text not null check (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  empresa_id     text,
  usuario        text,
  situacao       text not null default 'reservada' check (situacao in ('reservada', 'concluida')),
  criado_em      timestamptz not null default now()
);
create index if not exists ponto_leituras_ocr_mes_idx on ponto_leituras_ocr (escritorio_id, competencia);

alter table ponto_funcionarios enable row level security;
alter table ponto_frequencias  enable row level security;
alter table ponto_feriados     enable row level security;
alter table ponto_leituras_ocr enable row level security;

notify pgrst, 'reload schema';
