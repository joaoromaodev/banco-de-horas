-- Sprint 8 / Frente C — Caixa para o cliente: demonstrativo mensal e alerta de limite.
--
-- 1) demonstrativos_enviados: registro do envio do "Demonstrativo de caixa" ao cliente.
--    A chave (empresa, ano, mês) é a trava contra envio duplicado: clicar duas vezes,
--    ou duas contadoras ao mesmo tempo, manda um e-mail só. Reenviar é decisão
--    explícita da contadora (a rota exige `reenviar: true`).
-- 2) empresa_regime.abertura: data de abertura da empresa, informada pela contadora.
--    Só serve para o limite PROPORCIONAL do 1º ano (MEI: R$ 6.750 por mês; Simples:
--    R$ 400 mil por mês). Nula = não informada (o alerta avisa a ressalva).
--
-- ORDEM: depende da 0010 (escritorios) e da 0018 (empresa_regime). Só CRIA tabela e
-- coluna nullable: compatível com o código antigo. O código novo funciona antes da
-- 0023 (sem a coluna, o limite usa o ano cheio; sem a tabela, o envio responde 503).
-- Idempotente. Reversão:
--   alter table empresa_regime drop column if exists abertura;
--   drop table if exists demonstrativos_enviados;

create table if not exists demonstrativos_enviados (
  -- Sem FK para empresas, como em pendencias/documentos (ver 0015).
  empresa_id     text not null,
  escritorio_id  uuid not null references escritorios (id) on delete restrict,
  ano            int  not null check (ano between 2000 and 2100),
  mes            int  not null check (mes between 1 and 12),
  -- enviando: reservado, e-mail ainda não saiu · enviado: o provedor aceitou ·
  -- registrado: sem provedor configurado (só log) · falhou: o provedor recusou.
  -- Só 'enviado' e 'enviando' travam novo envio sem `reenviar`.
  situacao       text not null default 'enviando' check (situacao in ('enviando', 'enviado', 'registrado', 'falhou')),
  destinatarios  int  not null default 0,
  erro           text,
  enviado_por    text not null,
  enviado_em     timestamptz not null default now(),
  -- quantas vezes a contadora reenviou de propósito
  reenvios       int  not null default 0,
  primary key (empresa_id, ano, mes)
);

create index if not exists demonstrativos_enviados_escritorio_idx
  on demonstrativos_enviados (escritorio_id, ano, mes);

alter table demonstrativos_enviados enable row level security;

alter table empresa_regime add column if not exists abertura date;
