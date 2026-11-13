-- Contratos de experiência (departamento pessoal).
--
-- Pedido da contadora em 12/11/2026: uma empresa-cliente admite muito por
-- contrato de experiência, e ela quer gerar o contrato, a declaração de
-- vale-transporte e o aviso de término a partir de um cadastro só — e ser
-- lembrada dos vencimentos (contrato vencido sem aviso vira prazo indeterminado).
--
-- Vive no Postgres e não no Sheets: guarda dado pessoal (CPF, endereço) e tem
-- escrita concorrente. `empresa_id` é o id interno da aba `Empresas` do Sheets,
-- validado na aplicação (mesmo vínculo do livro caixa).
--
-- Idempotente: pode ser rodada de novo.

create extension if not exists "pgcrypto";

create table if not exists contratos_experiencia (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       text not null,
  nome             text not null,
  cpf              text,
  admissao         date not null,
  -- 1º período e prorrogação, em dias. CLT art. 445: total até 90; art. 451:
  -- uma única prorrogação (dias_prorrogacao = 0 quando não há).
  dias_periodo     int  not null check (dias_periodo between 1 and 90),
  dias_prorrogacao int  not null default 0 check (dias_prorrogacao >= 0),
  -- 'experiencia' (correndo), 'efetivado' (passou a prazo indeterminado) ou
  -- 'encerrado' (aviso de término dado). Só 'experiencia' gera alerta.
  situacao         text not null default 'experiencia'
                   check (situacao in ('experiencia', 'efetivado', 'encerrado')),
  -- o resto do formulário (função, salário, horário, VT, endereços, aviso)
  dados            jsonb not null default '{}'::jsonb,

  criado_por      text not null,
  criado_em       timestamptz not null default now(),
  atualizado_por  text,
  atualizado_em   timestamptz,
  -- exclusão lógica: permite o "desfazer" da tela
  excluido_em     timestamptz,

  constraint total_ate_90 check (dias_periodo + dias_prorrogacao <= 90)
);

create index if not exists contratos_experiencia_empresa
  on contratos_experiencia (empresa_id, admissao desc)
  where excluido_em is null;

-- RLS ligada e sem policies: só a secret key (servidor) lê — igual ao caixa.
alter table contratos_experiencia enable row level security;

-- PostgREST guarda o schema em cache: sem isto a tabela nova só aparece na API
-- depois de um restart.
notify pgrst, 'reload schema';
