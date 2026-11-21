-- Sprint 2 / Frente A — cobrança: assinatura recorrente no gateway (Asaas),
-- registro idempotente do webhook e base para o modo somente leitura.
--
-- POR QUÊ: até aqui o fim do teste só mostrava uma faixa. Agora o escritório
-- assina um plano no gateway; o webhook avisa pagamento, atraso e cancelamento;
-- e o código (lib/cobranca.ts) decide se o escritório está liberado ou em
-- SOMENTE LEITURA (teste vencido sem assinatura, ou inadimplente além da carência).
-- Ver docs/cobranca.md.
--
-- SÓ SCHEMA. Nenhum dado existente é alterado. O escritório `fundador`
-- (00000000-0000-4000-8000-000000000001) é isento por regra de código: plano
-- 'fundador' nunca cai em somente leitura, com ou sem linha nestas tabelas.
--
-- ORDEM DE APLICAÇÃO: compatível com o código antigo (só cria tabelas novas).
-- Aplique antes de publicar o código da cobrança. Sem esta migração o código
-- novo trata o escritório como "sem assinatura" (teste vencido → somente leitura),
-- por isso a ordem importa.

-- ---------------------------------------------------------------- Assinatura
-- Uma linha por escritório (a assinatura vigente ou a última). Histórico de
-- pagamentos fica em `cobranca_pagamentos`; o log bruto do gateway em `cobranca_eventos`.
create table if not exists assinaturas (
  escritorio_id          uuid primary key references escritorios (id) on delete cascade,
  gateway                text not null default 'asaas' check (gateway in ('asaas')),
  ambiente               text not null default 'sandbox' check (ambiente in ('sandbox', 'producao')),
  -- ids no gateway (cus_..., sub_...). Únicos: o webhook acha o escritório por eles.
  cliente_gateway_id     text unique,
  assinatura_gateway_id  text unique,
  plano                  text not null check (plano in ('essencial', 'escritorio', 'ilimitado')),
  ciclo                  text not null check (ciclo in ('mensal', 'anual')),
  valor                  numeric(10, 2) not null check (valor >= 0),
  -- pendente: criada, primeira cobrança ainda não paga
  -- ativa: em dia · inadimplente: cobrança vencida sem pagamento · cancelada
  status                 text not null default 'pendente'
                         check (status in ('pendente', 'ativa', 'inadimplente', 'cancelada')),
  proximo_vencimento     date,
  -- Último dia já pago (inclusive). Cancelar mantém o acesso até aqui.
  pago_ate               date,
  -- Primeiro vencimento em aberto; a carência conta a partir dele.
  inadimplente_desde     date,
  -- Troca agendada para a renovação (descida de plano, troca de ciclo): passa a
  -- valer em `agendado_a_partir` (o código aplica na leitura; ver lib/cobranca.ts).
  plano_agendado         text check (plano_agendado in ('essencial', 'escritorio', 'ilimitado')),
  ciclo_agendado         text check (ciclo_agendado in ('mensal', 'anual')),
  agendado_a_partir      date,
  cancelada_em           timestamptz,
  criado_em              timestamptz not null default now(),
  atualizado_em          timestamptz not null default now()
);

-- ---------------------------------------------------------------- Pagamentos
-- Espelho das cobranças do gateway (assinatura e avulsas de ajuste proporcional),
-- para o histórico da tela sem chamar a API a cada abertura.
create table if not exists cobranca_pagamentos (
  id                     text primary key,            -- pay_... do gateway
  escritorio_id          uuid references escritorios (id) on delete cascade,
  -- Pagamento de sandbox nunca libera acesso em produção (e vice-versa).
  ambiente               text not null default 'sandbox' check (ambiente in ('sandbox', 'producao')),
  assinatura_gateway_id  text,
  -- Último dia que esta cobrança paga cobre (só as da assinatura). Congelado
  -- quando ela é paga, com o ciclo daquele momento — trocar de ciclo depois não
  -- estica o período já pago.
  periodo_ate            date,
  descricao              text,
  valor                  numeric(10, 2) not null default 0,
  vencimento             date,
  status                 text not null,               -- status do gateway (PENDING, RECEIVED, OVERDUE...)
  forma                  text,                        -- PIX, BOLETO, CREDIT_CARD, UNDEFINED
  link_fatura            text,                        -- invoiceUrl (página de pagamento do gateway)
  pago_em                date,
  atualizado_em          timestamptz not null default now()
);
create index if not exists cobranca_pagamentos_escritorio_idx
  on cobranca_pagamentos (escritorio_id, vencimento desc);

-- ---------------------------------------------------------------- Webhook
-- Idempotência: o id do evento é a chave. O gateway reenvia e não garante
-- ordem; um evento repetido bate no PK e é ignorado.
create table if not exists cobranca_eventos (
  id               text primary key,                  -- evt_... do gateway
  evento           text not null,                     -- PAYMENT_RECEIVED etc.
  escritorio_id    uuid references escritorios (id) on delete set null,
  pagamento_id     text,
  assinatura_id    text,
  -- Corpo recebido, sem dados de cartão (o gateway não manda o número) e sem
  -- o objeto do cliente; serve para auditoria e reprocessamento.
  payload          jsonb not null,
  recebido_em      timestamptz not null default now(),
  processado_em    timestamptz,
  erro             text
);
create index if not exists cobranca_eventos_escritorio_idx on cobranca_eventos (escritorio_id, recebido_em desc);

-- ---------------------------------------------------------------- Trava
-- Uma operação de assinatura por escritório de cada vez (vale entre instâncias
-- serverless): clique duplo não cria duas assinaturas no gateway.
create table if not exists cobranca_travas (
  escritorio_id  uuid primary key references escritorios (id) on delete cascade,
  em             timestamptz not null default now()
);

-- Mesma regra do resto do backend: RLS ligada SEM policies. Só a secret key
-- (rotas de API) alcança estas tabelas.
alter table assinaturas         enable row level security;
alter table cobranca_pagamentos enable row level security;
alter table cobranca_eventos    enable row level security;
alter table cobranca_travas     enable row level security;

notify pgrst, 'reload schema';
