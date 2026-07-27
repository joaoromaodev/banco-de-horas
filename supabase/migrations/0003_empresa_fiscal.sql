-- Fase 5 (Parte C) — dados fiscais da empresa, 1:1, para o Termo de Abertura.
--
-- POR QUE UMA TABELA NOVA (e não reusar as colunas de `exercicios`):
-- os campos fiscais estáveis — endereço, inscrições, registro na Junta,
-- prefeitura, cidade do termo, contabilista/CRC — são propriedade da EMPRESA e
-- não mudam de um ano para o outro. Guardá-los por exercício obrigaria a
-- redigitar tudo a cada ano. Aqui ficam 1:1 com a empresa; o que é por LIVRO
-- (número do livro, número de ordem, qtd de folhas, data do termo) continua em
-- `exercicios`, porque muda a cada ano. A identidade (razão social, CNPJ) segue
-- no Google Sheets, compartilhada com o módulo de ponto.
--
-- `empresa_id` é o id da aba `Empresas` do Sheets — sem FK entre os dois bancos,
-- igual ao resto do módulo (ver 0001). O vínculo é validado na aplicação.

create table if not exists empresa_fiscal (
  empresa_id          text primary key,
  endereco            text,
  numero_endereco     text,
  municipio           text,
  estado              text,          -- UF
  inscricao_estadual  text,
  inscricao_municipal text,
  registro_junta      text,          -- órgão de registro (ex.: "JUCEPA")
  registro_numero     text,          -- sob qual número
  prefeitura          text,
  -- cidade que sai no rodapé do termo; a contadora atende Belém e Castanhal
  cidade_termo        text,
  -- contabilista responsável — default o da Edilse, mas editável (ver docs)
  contabilista        text not null default 'Edilse Goes da Costa',
  crc                 text not null default '01619/0-3',

  atualizado_por      text,
  atualizado_em       timestamptz not null default now()
);

-- Mesma regra do resto do módulo: RLS ligada SEM policies. Quem lê é a rota de
-- API com a secret key; a publishable key do navegador não alcança nada.
alter table empresa_fiscal enable row level security;

-- PostgREST guarda o schema em cache — sem isto a tabela nova só aparece na
-- próxima reinicialização e a API responde "Could not find the table".
notify pgrst, 'reload schema';
