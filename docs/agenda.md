# Agenda de obrigações (Sprint 3 · Frente A)

> O escritório cadastra, para cada empresa-cliente, a **regra** de cada obrigação
> (DAS dia 20 do mês seguinte, prorroga se não for útil…). A agenda calcula os
> vencimentos já em dia útil, mostra o que está atrasado e o que vence, deixa
> marcar cada competência como feita (com desfazer) e manda um resumo por e-mail.

Branch: `claude/agenda-obrigacoes-e01a60`. Migração: `0014_agenda_obrigacoes.sql`
(**não aplicada**).

## Onde está

| Peça | Arquivo |
|---|---|
| Regras puras (recorrência, dia útil, feriados, catálogo, modelos, resumo do e-mail) | `lib/agenda.ts` — 28 testes em `tests/agenda.test.ts` |
| Banco (obrigações, conclusões, aviso, envios) | `lib/agendaServidor.ts` |
| Envio de e-mail (provedor abstrato) | `lib/email.ts` |
| Rotas | `app/api/agenda/route.ts` (CRUD + desfazer), `modelo/`, `conclusoes/`, `avisos/`; peças comuns em `app/api/agenda/comum.ts` |
| Cron | `app/api/cron/agenda/route.ts` + `vercel.json` |
| Telas | `app/(app)/agenda/page.tsx` (visão geral), `agenda/obrigacoes/page.tsx` (cadastro, modelo, aviso), `agenda/comum.tsx` |
| Menu | item **Agenda** em `app/(app)/layout.tsx` (grupo do Cadastro, para master e contador) |

## Decisões

| Tema | Decisão |
|---|---|
| Regra × ocorrência | Só a **regra** é gravada (`agenda_obrigacoes`). As ocorrências (uma por competência) saem de `lib/agenda.ts` a cada consulta, no navegador e no cron. Nada de job para "gerar o mês"; mudar a regra corrige o futuro na hora. |
| Status por competência | Linha em `agenda_conclusoes` (obrigação + competência, quem, quando) = **feita**. Sem linha = pendente. Desfazer apaga a linha. Marcar de novo mantém quem marcou primeiro. Competência: `AAAA-MM` (mensal), `AAAA-Tn` (trimestral), `AAAA` (anual), `unica`. |
| Recorrência | `mensal`, `trimestral` (IRPJ/CSLL), `anual`, `unica` (certificado, contrato de experiência). `defasagem` = distância entre a competência e o mês do vencimento (DAS de 10/2026 vence em 11/2026 → 1). |
| Como contar o dia | `dia_fixo` (com ajuste), `n_dia_util` (salários: 5º dia útil) e `ultimo_dia_util` (DCTFWeb, Carnê-Leão, IRPF). Dia 31 vira o último dia do mês curto e o ajuste vale em seguida. |
| Ajuste de dia útil | `antecipa`, `prorroga` ou `nenhum`, por obrigação. Padrões do catálogo: DAS/DAS-MEI/ISS **prorrogam**; FGTS, DARF previdenciário, IRRF, PIS/COFINS, eSocial, EFD-Reinf **antecipam**. |
| Feriados | Calculados em código (sem tabela): fixos nacionais (inclui **20/11**, Lei 14.759/2023), Sexta-feira Santa, **Carnaval (seg e ter)** e **Corpus Christi** — não são feriado em lei, mas não têm expediente bancário, e a Receita e o mercado os tratam como não úteis. Quarta de Cinzas é útil. `Calendario` aceita feriados extras (estaduais/municipais), ainda **não ligados** (ver pendências). Não usei os feriados do Sheets: são da Folha de Ponto, estão migrando (0012) e são de Belém, não nacionais. |
| "Acompanhar a partir de" | Cada obrigação tem `inicio` (padrão: hoje). O que venceu antes não aparece como atrasado — cadastrar uma empresa nova não despeja um ano de "atrasadas". Atrasadas olham no máximo 365 dias para trás. |
| Antecedência | `aviso_dias` por obrigação: certificado digital e IRPF avisam 30 dias antes, DEFIS/DASN 15. A janela padrão é 7 dias. |
| Catálogo | Lista fechada em `CATALOGO` (+ "Outra"), definida com o consultor contábil. **DCTFWeb no último dia útil do mês seguinte** (IN RFB 2.248/2025). **DIRF fora** (extinta desde o ano-calendário 2025, IN RFB 2.181/2024). O banco não tem CHECK no `tipo`: o catálogo cresce sem migração; a rota valida. |
| Modelos por regime | MEI · Simples sem funcionário · Simples com folha · Lucro Presumido · Pessoa física. Aplicar cria só os tipos que a empresa ainda não tem e devolve os ids (o toast oferece **Desfazer**). Certificado digital fica fora do modelo (precisa da data de validade). EFD-Reinf fica fora do Simples (só com retenção/serviço tomado) e ICMS fora de todos (depende da atividade) — o contador adiciona. |
| Inquilino | Toda linha tem `escritorio_id`, herdado da **empresa** (não da sessão), conferido em `app/api/agenda/comum.ts`. Leitura recortada pelo escritório da sessão; master vê a plataforma. Rota por id carrega a obrigação e confere `podeAcessarEmpresa` pela empresa dela. |
| Acesso | Só contabilidade (`exigirGestor`); **não** entra em `CLIENTE_PODE`. Independe dos módulos ponto/caixa (o proxy não a recorta por módulo). |
| Excluir | Exclusão lógica (`excluido_em`) com confirmação + **Desfazer**. Apagar a empresa apaga a agenda dela (FK em cascata). |
| Responsável | E-mail de um contador do escritório, informativo (aparece na lista e no e-mail). |
| Aviso por e-mail | Um resumo **por escritório** (não por responsável): atrasadas + vencem hoje + próximos dias (7 no semanal, 3 no diário, ou a antecedência própria). Preferência em `agenda_avisos`: **semanal** (segunda) por padrão, diário (dias úteis) ou desligado. Destinatários: os marcados (precisam ser da equipe do escritório — o sistema não manda e-mail para fora); sem marcação, os administradores do escritório; sem admin, a equipe toda. Só o administrador do escritório altera. Escritório `suspenso` não recebe. Resumo vazio não é enviado. |
| Cron | Vercel Hobby: **cron só diário** (expressão mais frequente falha o deploy), dispara em qualquer minuto da hora marcada, **não refaz** chamada que falhou e às vezes chama duas vezes (docs da Vercel, conferidas em 21/11/2026). Por isso: um cron só, `0 10 * * *` (10h UTC = 7h em Belém, chega entre 7h e 7h59), e a decisão diário/semanal é feita na rota. Idempotência: `agenda_envios` com chave (escritório, dia) — quem não consegue inserir não envia. |
| Segurança do cron | `/api/cron` entra em `PUBLICO` no `proxy.ts` (a Vercel não tem cookie); a rota exige `Authorization: Bearer <CRON_SECRET>` (comparação em tempo constante). **Sem `CRON_SECRET`, responde 503 e não faz nada** (falha fechada). |
| Provedor de e-mail | `lib/email.ts`: com `RESEND_API_KEY`, Resend por `fetch` (sem dependência nova); sem a chave, só registra no log (assunto e nº de destinatários, sem o corpo) e o envio fica `registrado`. Trocar de provedor = outro ramo em `enviarEmail`. |

## Para o integrador

### Arquivos compartilhados que esta frente tocou (conflito provável, trivial)

- `proxy.ts`: uma linha — `'/api/cron'` no fim de `PUBLICO`.
- `app/(app)/layout.tsx`: o ícone `agenda` no `Icon` e o item `{ href: '/agenda', … }` no grupo do Cadastro.

### Variáveis novas (Vercel → Settings → Environment Variables, produção)

| Variável | Obrigatória | O que é |
|---|---|---|
| `CRON_SECRET` | **sim**, para o aviso funcionar | Texto aleatório ≥ 16 caracteres (`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`). A Vercel o manda sozinha no cron. **Só vale depois de um novo deploy.** |
| `RESEND_API_KEY` | não (sem ela, só registra) | Chave da conta no Resend. |
| `EMAIL_REMETENTE` | com o Resend, sim | Ex.: `ClickContas <avisos@clickcontas.com.br>`. O domínio precisa estar verificado no Resend; sem isto usa o remetente de teste, que só entrega para o dono da conta. |
| `APP_URL` | não | URL pública para o link do e-mail (ex.: `https://clickcontas.com.br`). Sem ela usa a origem da chamada do cron. |

O build não precisa de nenhuma delas (`npm run build` passou sem `.env.local`).

### Como aplicar a 0014

1. `git fetch` e `npx supabase migration list --remote` — confira que a 0014
   está livre. Ordem combinada: 0011 → 0012 → 0013 → **0014** → 0015. A 0014 só
   depende da 0004 (`empresas`) e da 0010 (`escritorios`).
2. Aplique (`npx supabase db push` ou o arquivo no SQL Editor). Ela só **cria**
   tabelas novas (`agenda_obrigacoes`, `agenda_conclusoes`, `agenda_avisos`,
   `agenda_envios`), com RLS ligada sem policies; não altera nada existente, então
   não precisa de backup e é compatível com o código antigo. Idempotente.
3. Reversão: `drop table agenda_envios, agenda_avisos, agenda_conclusoes, agenda_obrigacoes;`
   (perde só dados da agenda).
4. Antes de aplicar, a tela mostra o aviso "Agenda aguardando o banco" e o cron
   responde erro 500 (tabela inexistente) — nada quebra fora da agenda.

### O que testar em produção

1. Com o login da Edilse: **Agenda → Obrigações por empresa**, escolher o NÉLIO
   (pessoa física) e aplicar "Pessoa física / autônomo"; escolher outra empresa e
   aplicar "Simples Nacional sem funcionário". Conferir na prévia do formulário que
   o DAS de 10/2026 aparece em **23/11/2026** (20/11 é feriado e sexta → prorroga).
2. Desfazer a aplicação do modelo pelo toast e aplicar de novo.
3. **Visão geral**: marcar uma obrigação como feita, desfazer; no calendário,
   clicar num item para marcar e desmarcar. Alternar o tema e ver em 375 px.
4. Com a Adriana (cliente): `/agenda` redireciona para `/caixa` e `/api/agenda`
   responde 403.
5. Com uma conta de outro escritório: não vê as obrigações da Edilse;
   `PATCH /api/agenda` com o id de uma delas → 403.
6. Cron: `curl -H "Authorization: Bearer $CRON_SECRET" "https://<app>/api/cron/agenda?dia=2026-11-23"`
   (uma segunda) → JSON com o resultado por escritório; sem o header → 401.
   Chamar de novo o mesmo `dia` → "já processado hoje". Para reenviar um dia,
   apague a linha em `agenda_envios`. Os envios ficam em
   `select * from agenda_envios order by criado_em desc;`.
7. Nos logs da Vercel (Cron Jobs), conferir a execução das 10h UTC do dia seguinte.

## Sprint 5 · Frente B — agenda proposta pelo cadastro e contratos na agenda

Migração **0018** (`empresa_regime`; **não aplicada**). Regras puras em `lib/agendaDerivada.ts`
(`tests/agendaDerivada.test.ts`), rota `app/api/agenda/proposta/route.ts`, tela
`app/(app)/agenda/PropostaAgenda.tsx` (dentro de **Obrigações por empresa**).

| Tema | Decisão |
|---|---|
| Regime | **Não se deduz** por CNAE nem faturamento. A contadora registra o regime da empresa (MEI · Simples · Lucro Presumido · Pessoa física) numa tela da agenda; fica em `empresa_regime`. O cadastro fiscal (`empresa_fiscal`, do Caixa) não tem regime e não foi tocado. |
| Proposta | A partir do regime registrado + sinais: Simples **com** funcionário no ponto ou contrato de experiência ativo → modelo "Simples com folha"; sem regime, **pessoa física** ou "identifica pagador" → modelo PF; sem regime e sem sinal → só pergunta o regime. Compara com o que a empresa já tem e propõe **só o que falta** (por isso reaparece quando o regime ou a situação de funcionários muda, sem guardar histórico). Mostra também o que sobrou de outro modelo (informativo, nunca apaga). |
| Aplicar | Um clique em "Aplicar modelo (N)", pelo mesmo `POST /api/agenda/modelo` de sempre, com o toast **Desfazer**. Nunca aplica sozinho. "Agora não" dispensa a sugestão naquele navegador (localStorage, por empresa e modelo). |
| Sinal que falha | Sem o módulo ponto ou com erro, funcionários e contratos viram "desconhecido" (`null`): a tela avisa para conferir, não afirma. |
| Contratos | Fim do 1º período e da prorrogação aparecem em **Visão geral** (seção "Contratos de experiência", janela de 30 dias, vencidos sempre) e no **resumo por e-mail**. Derivados dos contratos salvos (`alertaDe` de `lib/contratos.ts`): não há obrigação duplicada nem "feita" — some quando a contadora marca efetivado/encerrado em `/contratos`. Só para quem tem o módulo ponto. |
| Limite do e-mail | O resumo só sai para escritório que tem alguma obrigação na agenda (`escritoriosComAgenda`); escritório só com contratos ainda não recebe. |

### Para o integrador (Frente B)

- **Migração 0018** (`supabase/migrations/0018_fechamento_mensal.sql`): cria `empresa_regime` (esta parte),
  `pendencias_recorrentes` e a coluna `pendencias.modelo_id` (ver `docs/documentos.md`). Idempotente; só
  cria; compatível com o código antigo. Antes dela a tela avisa e só deixa de gravar o regime (a sugestão
  por pessoa física continua).
- Conferir `supabase migration list --remote`: o número 0017 pode estar com outra frente.
- Testar em produção (conta de teste, nunca as empresas da Edilse): Agenda → Obrigações por empresa →
  empresa sem obrigações → "Regime e sugestão" → escolher Simples → "Aplicar modelo" → Desfazer →
  cadastrar um funcionário no ponto e voltar: a sugestão passa a ser "com folha" e propõe só folha, FGTS e
  IRRF. Criar um contrato de experiência com 1º período a vencer em até 30 dias: aparece em Visão geral e
  no resumo (cron com `?dia=` de uma segunda).

## Pendências

- **Feriados estaduais/municipais** não entram no cálculo (afetam ISS, ICMS e
  alvará). `Calendario` já aceita `extras`; falta a fonte — o cadastro de feriados
  por escritório da Folha de Ponto (0012), quando estiver no Postgres. O consultor
  recomendou: só nas obrigações municipais/estaduais por padrão.
- **Prazos que mudam por norma anual** (IRPF, DEFIS, DASN-SIMEI) e duas
  confirmações pedidas pelo consultor: se a DMED continua em 2027 e se a EFD-Reinf
  ainda vence no dia 15. O dia de cada obrigação é editável; o catálogo deve ser
  revisto todo ano. Dia do **ISS de Belém** (padrão 10) a confirmar na SEFIN.
- **Contrato de experiência** está no catálogo como obrigação única, mas não é
  criado sozinho a partir de `/contratos` (Frente C cuida dos alertas de lá).
  Ligar os dois depois que ambas as frentes estiverem em `main`.
- **ECD/ECF** (Lucro Presumido) ficaram fora do catálogo — sugestão do consultor
  para depois.
- Empresa movida de escritório por SQL leva a agenda junto? **Não**: as obrigações
  mantêm o `escritorio_id` antigo. Ao mover, rode também
  `update agenda_obrigacoes set escritorio_id = … where empresa_id = …` (e o mesmo em
  `agenda_conclusoes` pelas obrigações).
- O resumo é um por escritório; resumo por responsável fica para quando houver pedido.
- Sem teste de rota/tela (como o resto do projeto); a regra está coberta em `lib/agenda.ts`.
  Não foi possível rodar contra o banco nesta máquina (sem `.env.local`).
