-- Sprint 1 / Frente A — multi-escritório: o inquilino do SaaS é o ESCRITÓRIO CONTÁBIL.
--
-- POR QUÊ: até aqui o sistema era "a instalação da contadora". O dono de cada
-- empresa era a coluna `empresas.contador` (e-mail) e o isolamento valia só entre
-- empresas com dono — a regra transitória "empresa sem dono é visível a todo
-- contador" deixava um segundo cliente do SaaS enxergar as empresas da Edilce.
-- Agora toda empresa e todo usuário pertencem a um escritório, e o recorte é por
-- `escritorio_id` (ver lib/acesso.ts e docs/multi-escritorio.md).
--
-- ORDEM DE APLICAÇÃO: esta migração é compatível com o código ANTIGO (as colunas
-- novas são anuláveis e nada que ele grava passa a falhar). Aplique-a primeiro e
-- publique o código novo em seguida — o código novo depende dela (sem a coluna,
-- contador e cliente deixam de ver empresas). O NOT NULL de `empresas.escritorio_id`
-- fica para uma migração posterior, depois do deploy (ver o doc).
--
-- ANTES DE APLICAR, confira quem vai para o escritório da Edilce (o backfill pendura
-- TODOS os usuários não-master e TODAS as empresas existentes nele):
--   select email, nome, role, empresa, dono from usuarios order by role, email;
--   select id, nome, contador from empresas order by ordem;
-- Contas de teste de outros contadores, se houver, devem ser movidas ou removidas
-- depois (o master vê tudo).

create table if not exists escritorios (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  cnpj       text,
  -- plano contratado; 'teste' durante os 14 dias grátis, 'fundador' = gratuito vitalício
  plano      text not null default 'teste'
             check (plano in ('teste', 'essencial', 'escritorio', 'ilimitado', 'fundador')),
  teste_ate  timestamptz not null default (now() + interval '14 days'),
  -- teste → ativo (pagou) → suspenso (inadimplente). O bloqueio vem na Sprint 2.
  situacao   text not null default 'teste' check (situacao in ('teste', 'ativo', 'suspenso')),
  criado_em  timestamptz not null default now()
);

-- Mesma regra do resto do backend: RLS ligada SEM policies. Só a secret key
-- (rotas de API) alcança a tabela.
alter table escritorios enable row level security;

-- Vínculo. `on delete restrict`: apagar um escritório com gente/empresas dentro é
-- erro, nunca cascata silenciosa. Masters (administradores da plataforma) ficam
-- sem escritório.
alter table usuarios add column if not exists escritorio_id uuid references escritorios (id) on delete restrict;
alter table empresas add column if not exists escritorio_id uuid references escritorios (id) on delete restrict;
-- Administrador do escritório: convida/cadastra os contadores e os clientes dele.
alter table usuarios add column if not exists admin_escritorio boolean not null default false;

create index if not exists usuarios_escritorio_idx on usuarios (escritorio_id);
create index if not exists empresas_escritorio_idx on empresas (escritorio_id);

-- ---------------------------------------------------------------- Backfill
-- Escritório da Edilce, cliente fundadora. Id FIXO: o código o conhece
-- (`ESCRITORIO_FUNDADOR_ID` em lib/escritorios.ts) para o que ainda é global
-- (feriados da Folha de Ponto, no Google Sheets até a Sprint 2).
insert into escritorios (id, nome, plano, situacao)
values ('00000000-0000-4000-8000-000000000001', 'Edilce Góes Contabilidade', 'fundador', 'ativo')
on conflict (id) do nothing;

update empresas
   set escritorio_id = '00000000-0000-4000-8000-000000000001'
 where escritorio_id is null;

update usuarios
   set escritorio_id = '00000000-0000-4000-8000-000000000001'
 where escritorio_id is null
   and role <> 'master';

-- Os contadores que já existiam viram administradores do escritório: antes cada
-- um geria os próprios clientes; agora gerem também a equipe. Na prática é a
-- própria Edilce. A coluna `contador` (empresas) e `dono` (usuarios) ficam como
-- estão — viram informação de "responsável", não mais de visibilidade.
update usuarios
   set admin_escritorio = true
 where escritorio_id = '00000000-0000-4000-8000-000000000001'
   and role = 'usuario';

notify pgrst, 'reload schema';
