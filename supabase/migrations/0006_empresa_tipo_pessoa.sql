-- Tipo de pessoa da empresa-cliente: jurídica (padrão) ou física (autônomo).
--
-- Cliente pessoa física/autônomo (ex.: Nélio Dias dos Santos, da Edilse) não tem
-- CNPJ, inscrição estadual/municipal nem registro na Junta. O tipo governa o
-- cadastro (CPF no lugar de CNPJ) e o formulário fiscal (esconde os campos que
-- não se aplicam), e vai reger o Termo de Abertura (Fase 6).

alter table empresas
  add column if not exists tipo_pessoa text not null default 'juridica'
    check (tipo_pessoa in ('juridica', 'fisica'));

notify pgrst, 'reload schema';
