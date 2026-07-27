# Livro Caixa — estado do módulo

> Documento de continuidade. Se você é um agente entrando agora no projeto, **leia
> este arquivo antes de mexer no módulo do caixa**: ele guarda as decisões, o que
> já está pronto e o que falta. Mantenha-o atualizado ao fim de cada etapa.

Última atualização: **26/07/2026** (Fase 5 concluída — plataforma modular)

## Por que este módulo existe

A contadora (**Edilse Goes da Costa, CRC 01619/0-3**) mantém o Livro Caixa de ~5
empresas-clientes numa planilha Excel. Hoje as empresas mandam documento físico e
ela digita tudo. O pedido, gravado em áudio em 23/07/2026, é inverter isso: **o
administrativo de cada empresa lança direto no sistema e ela só acompanha,
concilia e fecha o exercício** — a mesma inversão que o módulo de folha de ponto
já fez.

O arquivo de referência que ela usa hoje é um "Livro Caixa v6.0" de Excel com 18
abas: `Ajuda`, `Plano de Contas`, `EXEMPLO`, `Termo de abertura`, os 12 meses,
`Termo de encerramento` e `Balanço Financeiro`.

## Decisões dela (não deduzir de novo)

| Assunto | Decisão |
|---|---|
| Classificação | Por **código** do plano de contas, obrigatória |
| Lista de contas | As contas **daquela empresa**, com **barra de pesquisa** — mas a lista é **aberta**: tem que dar para incluir uma conta na hora, porque há contas que aparecem uma vez no mês e não são frequentes |
| Catálogo | Ela **padroniza um só**; cada empresa usa um subconjunto. Só ela cria conta nova |
| Comprovantes | **Não** anexa e **não** tem OCR — o administrativo digita, o papel fica na empresa |
| Nº do documento | **Não** quis o campo |
| Históricos | **Padronizados**, lista pronta para escolher |
| Edição | **Sempre** editável e excluível, inclusive retroativo |
| Saldo negativo | Só **avisa**, não bloqueia |
| Saldo de janeiro | Vem do **encerramento do ano anterior** (2026 é o 1º ano: digitado) |
| Confirmar o mês | **Não trava a edição** — libera o balanço para o cliente ver |
| Balanço | **Mês a mês** e anual, mas **simples**: entradas, saídas e saldo transportado. Ela **dispensou** o balanço detalhado em débitos × créditos (ver "O de-para" abaixo) |
| Despesa fixa/variável | **Não** vira campo — é só linguagem dela ao explicar pro cliente |
| Login do cliente | **Um por empresa, compartilhado** por várias pessoas do administrativo |
| Entrega em PDF | **Livro inteiro** (termo de abertura + 12 meses + encerramento) |
| Fonte da verdade | O **sistema**; ela para de usar o Excel |
| Cidade do termo | **Selecionável** — clientes em Belém e Castanhal |
| Contabilista/CRC | Edilse / 01619/0-3, mas **editáveis** |
| Escala | ~5 empresas × ~40 lançamentos/mês |
| Início | Exercício de **janeiro/2026**, começando limpo (sem importar histórico) |
| Aviso | Ela quer **ser avisada quando a empresa lançar** |

Regras do livro que ela confirmou: **depósito em banco = saída do caixa**,
**retirada = entrada**, e **pagamento com cheque gera dois lançamentos**.

## Etapas

### ✅ Fase 1 — Papéis e autorização (commit `760493d`)

Três papéis, com o `cliente` negado por padrão:

| Papel | Enxerga | Faz |
|---|---|---|
| `master` | tudo | administra e cadastra usuários |
| `usuario` (contabilidade) | **as empresas que cadastra** (ver Rodada de QA) | folha de ponto e conciliação do caixa |
| `cliente` | só a empresa vinculada | lança o movimento do caixa |

- `lib/auth.ts` — tipo `Papel`, `empresa` na sessão
- `lib/acesso.ts` — `exigirSessao` / `exigirGestor` / `exigirMaster` / `exigirEmpresa`
- `proxy.ts` — `CLIENTE_PODE` é **lista de permissão**: o que não está lá, o cliente não alcança
- Aba `Usuarios` ganhou a coluna `empresa` (no fim, para não quebrar linhas antigas)
- As 12 rotas de API têm guarda explícita

**Timesheet e Folhas em branco são exclusivos da contabilidade** — verificado: o
cliente recebe 403 em todas as APIs do ponto e é redirecionado para `/caixa`.

### ✅ Fase 2 — Banco e catálogo (commit `acd39e3`)

Postgres no Supabase (`zxjeibkttmacpuukvyzo`). A folha de ponto **continua no
Google Sheets** — só o caixa foi para o banco, por causa da escrita concorrente e
do volume.

```
plano_contas       118 contas, código N.GG.CC (1=receita, 2=despesa · grupo · conta)
empresa_contas     subconjunto do catálogo que cada empresa usa
historicos_padrao  24 históricos, 21 com conta sugerida
exercicios         um por empresa/ano + todos os campos dos termos
lancamentos        mes é GERADO da data; trigger recusa data fora do exercício
                   (+ conferido_por/conferido_em, migração 0002)
meses_confirmados  confirmação do mês (não trava edição)
resumo_mensal      view: entradas, saídas e saldo transportado por mês
saldo_final_exercicio()  o que abre o ano seguinte
```

Integridade fica **no banco**, não só na aplicação: `entrada_xor_saida`, trigger
de ano, `unique (empresa_id, ano)`. RLS ligada **sem policies** — a publishable
key não lê nada; o acesso é pelas rotas de API com a secret key.

O projeto do Supabase hospedava um sistema de pedidos antigo do João, removido
pela migração `0000` (dados exportados para
`C:\Users\SEDUC\Documents\backup-supabase-pedidos-2026-07-23.json`).

Rotas: `POST /api/caixa/seed` (carga do catálogo, idempotente, master) e
`GET /api/caixa/de-para` (planilha de revisão para a contadora).

### ✅ Fase 3 — Tela de lançamentos (commit `18a4afd`)

Onde o administrativo lança e a contadora acompanha. `/caixa` deixou de ser
placeholder.

A tela é o mês do livro no formato da planilha — DATA · HISTÓRICO ·
COMPLEMENTO · CONTA · ENTRADA · SAÍDA · SALDO — com as 12 abas de mês em cima,
o saldo transportado na primeira linha e o saldo corrido recalculado a cada
lançamento. Sem o teto de 51 linhas do Excel.

- `app/(app)/caixa/page.tsx` — a tela
- `app/(app)/caixa/SeletorConta.tsx` — busca no plano de contas
- `lib/caixa.ts` — regras compartilhadas pelas rotas
- `app/api/caixa/{exercicio,contas,lancamentos,meses,atividade}` — as rotas

Como cada decisão dela virou código:

| Decisão | Onde |
|---|---|
| Lista de contas **aberta** | busca varre as 118 contas; as da empresa sobem ao topo |
| Só ela cria conta **nova no catálogo** | `POST /api/caixa/contas` exige gestor |
| Históricos padronizados | `datalist` no campo; escolher um já traz a conta sugerida |
| Saldo negativo **avisa**, não bloqueia | faixa âmbar com o dia em que o saldo vira |
| Cheque gera **dois lançamentos** | caixa de seleção no formulário; grava a retirada + o pagamento numa transação só |
| Edição **sempre** liberada | nenhuma rota checa mês confirmado |
| Confirmar o mês **não trava** | `meses_confirmados`, sem efeito sobre os lançamentos |
| Avisar quando a empresa lançar | `GET /api/caixa/atividade` |
| Sem nº de documento, sem anexo | não existem no formulário |

**A lista de contas é aberta, não um cadastro fechado.** Ela foi explícita: há
contas que aparecem uma vez no mês e não são frequentes, então tem que dar para
incluir na hora do lançamento. Como ficou:

- a busca varre o **catálogo inteiro** (118); as contas já usadas por aquela
  empresa sobem para o topo e viram a lista "dela" na prática
- escolher uma conta nova a inclui automaticamente em `empresa_contas` — sem
  etapa de configuração antes do primeiro lançamento
- criar conta que **não existe no catálogo** continua sendo só da contadora

Duas coisas que a Fase 2 não tinha previsto e apareceram aqui:

- **Conferência por lançamento.** Ela pediu para "marcar conferido" e para ser
  avisada quando a empresa lança. As duas coisas são a mesma: lançamento sem
  `conferido_em` é o que ela ainda não olhou. Virou coluna em `lancamentos`
  (migração `0002`) e a fila alimenta o aviso no topo da tela — sem tabela de
  notificação, some sozinho quando ela confere. Editar um lançamento **derruba a
  conferência**: o que ela conferiu mudou.
- **Lançamento sem conta.** Depósito e retirada de conta corrente são
  transferência, não receita nem despesa — o catálogo dela não tem linha para
  isso (os dois históricos padrão já vinham sem conta sugerida). `conta_id` é
  nulo nesses casos, e a tela marca a linha em âmbar para ela não confundir com
  esquecimento. É também o que a perna bancária do cheque usa.

O **exercício é criado sob demanda**: abrir a tela de uma empresa num ano que
ainda não existe já abre o livro com saldo inicial zero, editável pela
contabilidade. Não há etapa de configuração antes do primeiro lançamento.

### ✅ Fase 4 — Resumo do exercício (commit `e360fcf`)

**Escopo reduzido em 23/07/2026.** Era para ser o Balanço Financeiro completo em
débitos × créditos; a contadora dispensou. O que ela analisa é **entradas, saídas
e o saldo de um mês para o outro** — é um livro caixa, não um balanço patrimonial.

Ficou em `/caixa/resumo`, ao lado da tela de lançamentos:

- `app/(app)/caixa/resumo/page.tsx` — tabela dos 12 meses (saldo transportado ·
  entradas · saídas · saldo do mês · situação) e a linha de total do exercício
- `app/(app)/caixa/resumo/Graficos.tsx` — os dois gráficos, em SVG puro
- `app/api/caixa/resumo/route.ts` — a rota, que aplica o recorte do cliente
- `app/(app)/caixa/formato.ts` — formatação que as duas telas usam

**O recorte do cliente é um prefixo, não um mês solto.** A regra dela é "só
visível depois do mês confirmado", mas o livro é sequencial: o saldo de um mês
abre o seguinte, então liberar abril sozinho entregaria o saldo de janeiro a
março junto. O cliente enxerga de janeiro até o último mês confirmado **sem
buraco** — confirmar 1, 2 e 4 libera até fevereiro. A contabilidade vê o ano
inteiro. Quem corta é a rota, não a tela.

Vale registrar o que esse recorte **não** é: na tela de lançamentos o cliente
continua vendo o saldo corrido do mês em que digita — ele precisa disso para
trabalhar, e são os números que ele mesmo lançou. O que a confirmação libera é o
resumo fechado, que é o que ela entrega.

**Dois gráficos, não um.** Saldo acumulado e fluxo do mês têm ordens de grandeza
diferentes; juntá-los num só exigiria dois eixos Y, que é justamente a leitura
enganosa a evitar. Então: uma figura para a evolução do saldo (linha) e outra
para entradas × saídas (barras agrupadas), um eixo cada. Verde para entrada e
vermelho para saída, a convenção contábil e a mesma cor da tabela de
lançamentos — o par passa na checagem de daltonismo (ΔE 8,6 em deuteranopia), e
mesmo assim a identidade nunca depende só da cor: há legenda, posição fixa e a
tabela logo abaixo com os mesmos números. SVG escrito à mão, sem biblioteca:
são doze pontos.

`plano_contas.linha_balanco` continua no schema e mapeado para 64 contas. Não é
mais necessário para a entrega, mas fica: se um dia ela quiser o balanço
detalhado, o caminho está pronto e não custa nada mantê-lo.

### ✅ Rodada de QA — ajustes pré-MVP (26/07/2026)

Feedback do João testando o sistema antes de validar com a contadora. Doze itens;
os dois últimos mudaram o modelo, o resto é UX. Verificados de ponta a ponta.

**Multiempresa por contador (o maior).** Antes, `usuario` (contabilidade) via
**todas** as empresas — errado quando há mais de um contador. Agora cada empresa
tem um **dono** e o contador só vê as suas.

- Coluna `contador` (e-mail) na aba **Empresas** do Sheets (coluna H, no fim, para
  não quebrar linhas antigas). Tipo `Empresa.contador` em `lib/tipos.ts`.
- Decisão do João: **cada contador cadastra as suas** — ao salvar o cadastro, as
  empresas ganham o e-mail dele. O master vê todas e define o dono numa coluna
  extra da tela de Cadastros (só o master a enxerga).
- `lib/acesso.ts`: `empresaVisivelPara` (com o objeto empresa) e
  `podeAcessarEmpresa` (assíncrona, por id). `exigirEmpresa` e as rotas do caixa
  passaram a usá-la. `podeVerEmpresa`/`empresasPermitidas` saíram.
- `POST /api/empresas` grava por dono: o contador só mexe nas suas (as dos outros
  ficam intactas); o master grava tudo preservando o dono de cada linha.
- Vale nos **dois módulos** (empresas são compartilhadas): a folha de ponto também
  filtra por dono, via `lerEmpresas`.
- A fila de conferência (`/api/caixa/atividade`) também respeita o dono.
- Para não ler o Sheets a cada request de contador (a cota é apertada — ver
  armadilhas), `lerEmpresas` ganhou um **cache em memória de 8s**, invalidado em
  `salvarEmpresas`. O master não paga esse custo (decide sem I/O).

**Cliente não vê o catálogo inteiro.** `GET /api/caixa/contas`, quando a sessão é
`cliente`, devolve **só as contas da própria empresa** (as 118 do catálogo aberto
continuam só para a contabilidade). Históricos que sugerem conta fora do conjunto
dele vêm sem a sugestão. Verificado: cliente vê 8 contas, master vê 118.

**UX (o resto):**

- Barra lateral **recolhível** (`layout.tsx`), estado em `localStorage`.
- Ícones padrão: **lápis** para editar, **X vermelho** para excluir — no caixa,
  nos cadastros e na tela de usuários. `app/(app)/icones.tsx`.
- Pop-ups na identidade visual (`app/(app)/Dialogo.tsx`): os `confirm()`/`prompt()`
  nativos viraram modais. Texto "Deseja realmente excluir…". Cobre a exclusão de
  lançamento, a de usuário e a edição do saldo inicial.
- "Confirmar o mês" / "Desfazer confirmação" viraram **botão com ícone**.
- **Saldo inicial do exercício** só aparece na aba de **janeiro** (é ele que abre o
  ano e se propaga como saldo transportado nos demais meses).
- O `conf.` (checkbox críptico) virou um **check claro** "Conferir/Conferido". É a
  conferência por lançamento — a marca de que a contadora revisou aquela linha, e o
  que alimenta a fila "empresa lançou". Continua igual por dentro.
- **Desfazer exclusão**: excluir um lançamento mostra um aviso com ícone de voltar
  que **recria** a linha (novo id/carimbo, mesmos dados). Some ao trocar de mês.
- Gráfico **"Evolução do saldo"** não fica mais achatado: a escala Y deixou de ser
  ancorada em zero e passou a **enquadrar a faixa real** do saldo (com 10% de
  folga). Um caixa de ~270 mil que varia pouco agora mostra a variação, em vez de
  virar um traço reto no topo. As barras de entradas×saídas seguem ancoradas em
  zero, que é o certo para barras. `resumo/Graficos.tsx` (`enquadrar`).
- **Filtro de empresa/exercício persiste entre as abas** (Lançamentos ↔ Resumo),
  via `localStorage` (`caixa.empresa`, `caixa.ano`).

### ✅ Fase 5 — Plataforma: módulos por contador e cadastro por seções (26/07/2026)

Decidido e implementado em **26/07/2026** (João). O projeto passa a ser uma
**plataforma com dois módulos distintos** — Folha de Ponto e Livro Caixa —, com
**liberação por contador**. Entrou **antes dos documentos** (Fase 6): o Termo de
Abertura precisa dos campos fiscais da empresa, e é esta etapa que os organiza.

Motivação: só a Edilse usa a Folha de Ponto. Um contador que só tem o Livro Caixa
não precisa ver jornadas/funcionários/feriados. **A Folha de Ponto NÃO foi
"produtizada" para multiempresa** — a decisão foi *isolá-la* atrás do gating e
tratar a produtização como projeto futuro, iniciado por descoberta com um segundo
contador (a realidade de jornadas/convenção/feriados hoje só é conhecida pela
Edilse).

**Parte A — Módulos por contador (feature gating) ✅**
- Coluna `modulos` na aba **Usuarios** (coluna **G**, ex.: `caixa` ou
  `caixa,ponto`). No fim, como as anteriores, para não quebrar linhas antigas.
- `lib/auth.ts`: tipo `Modulo`, `resolverModulos(role, guardados)` e `temModulo`.
  A **sessão** (cookie assinado) carrega `modulos` → checagem sem I/O.
- **Regra do legado (importante):** `usuario` com `modulos` vazio = **tudo
  liberado** (mesmo espírito de "empresa sem dono"). Assim a Edilse e contas
  antigas **não perdem** a Folha de Ponto. Contador **novo** nasce só com `caixa`
  (padrão do formulário). `master` tem tudo; `cliente` é sempre só `caixa`.
- `proxy.ts` gateia as rotas de ponto (`/`, `/folhas`, `/api/salvar`,
  `/api/extrair`, `/api/gerar*`, `/api/folha*`, `/api/funcionarios`,
  `/api/feriados`) atrás de `ponto` e as do caixa atrás de `caixa`. `/cadastros` e
  `/api/empresas` ficam **fora** das listas de propósito (são compartilhados).
- Sidebar (`layout.tsx`) mostra só os módulos habilitados e **agrupa Timesheet +
  Folhas em branco sob o rótulo "Folha de Ponto"** (as duas telas do mesmo módulo).
- Configurações: checkboxes de módulo ao criar contador; a lista mostra os módulos
  efetivos de cada `usuario`.

**Parte B — Cadastro por seções ✅**
- `app/(app)/cadastros/page.tsx` reescrita. **Empresas-clientes** (identidade)
  sempre; as colunas de ponto (trabalha sábado, jornadas) só aparecem com o módulo
  `ponto`. **Dados fiscais · Livro Caixa** (por empresa) se tem `caixa`.
  **Funcionários** e **Feriados** só com `ponto`. Um contador só-caixa vê o
  cadastro enxuto (identidade + fiscal).

**Parte C — Dados fiscais no Postgres ✅**
- Migração **`0003_empresa_fiscal.sql`** (aplicada no remoto): tabela
  `empresa_fiscal`, **1:1 com a empresa** por `empresa_id` (texto, sem FID entre
  bancos, como o resto do módulo). Guarda o fiscal **estável**: endereço+nº,
  município/UF, inscrições estadual e municipal, registro na Junta+nº, prefeitura,
  cidade do termo (Belém/Castanhal), contabilista/CRC (default Edilse, editável).
- **Por que tabela nova e não as colunas de `exercicios`:** `exercicios` já tinha
  campos fiscais (0001), mas são **por ano**. O que é estável (não muda de um ano
  pro outro) vive em `empresa_fiscal` para não ser redigitado a cada exercício. O
  que é **por livro** — nº do livro, nº de ordem, qtd de folhas, data do termo —
  continua em `exercicios`. Identidade (razão social/CNPJ) segue no Sheets.
- `lib/caixa.ts`: `DadosFiscais`, `lerFiscal`, `salvarFiscal`. Rota
  `app/api/caixa/fiscal` (GET/POST), **só gestor** e só das empresas dele.

**Sequência:** A → B+C ✅ → **coletar os dados fiscais com a Edilse (reunião)** →
Fase 6.

### ⬜ Fase 6 — Documentos

- PDF do **livro inteiro** com folhas numeradas (reusa o padrão de `lib/folhaPonto.ts`)
- Termos de abertura e encerramento. Fontes: **`empresa_fiscal`** (endereço,
  inscrições, junta, prefeitura, cidade do termo, contabilista/CRC — Fase 5-C),
  **`exercicios`** (nº do livro, nº de ordem, qtd de folhas, data do termo — por
  ano) e a **identidade** no Sheets (razão social, CNPJ). Obs.: `exercicios` ainda
  carrega colunas fiscais herdadas da 0001 que agora são redundantes com
  `empresa_fiscal` — ao montar o Termo, use `empresa_fiscal` para o estável.
- `.xlsx` no formato da planilha dela (reusa o padrão de `lib/planilha.ts`)

## Estado do banco

Migrações `0000`, `0001`, `0002` e `0003` aplicadas; `supabase migration list`
bate com a pasta (checado antes do push da `0003`, sem desync). O CLI está
**logado na conta certa e linkado** ao projeto `zxjeibkttmacpuukvyzo`, então daqui
para a frente `npx supabase db push` resolve — não precisa mais colar SQL no
dashboard. A `0003` criou `empresa_fiscal` (fiscal estável 1:1 por empresa).

Conteúdo: 118 contas no catálogo, 24 históricos padrão, e **nenhum lançamento
ainda** — as Fases 3 e 4 foram testadas de ponta a ponta na empresa `TESTE` e os
dados de teste foram apagados depois. O exercício de janeiro/2026 nasce quando a
primeira empresa abrir a tela.

O que o teste cobriu, em 23/07/2026: lançar entrada e saída, o cheque gerando os
dois lançamentos na ordem certa (retirada antes do pagamento), as quatro recusas
de validação, saldo corrido e transportado entre meses, saldo negativo aceito
com aviso, edição derrubando a conferência, a fila de conferência, confirmar o
mês sem travar a edição, acentuação preservada no round-trip, e o cliente
recebendo 403 em tudo que é da contabilidade (outra empresa, confirmar, conferir,
criar conta, saldo inicial, fila) — além do recorte por prefixo do resumo.

## Pendências com a contadora

1. **Saldo inicial de janeiro/2026 das 5 empresas** — um número por empresa. Não
   trava nada: o exercício nasce com zero e a contabilidade edita o saldo pelo
   link "editar" ao lado de "Saldo inicial do exercício", na própria tela do
   caixa.
2. **Dados cadastrais das 5 empresas** para o Termo de Abertura — trava a **Fase 6**
   (documentos). A Fase 5 (Parte C) já entregou o **lugar** de guardar: a seção
   "Dados fiscais · Livro Caixa" em `/cadastros` grava em `empresa_fiscal`. Falta
   **preencher** com os dados reais (é o objetivo da reunião): endereço e número,
   município/UF, inscrição estadual, inscrição municipal, registro na Junta e sob
   qual número, prefeitura, cidade do termo (Belém ou Castanhal). Razão social e
   CNPJ ficam na identidade (aba Empresas do Sheets); número do livro e de ordem
   são por exercício (ficam em `exercicios`, preenchidos na tela do caixa).

### ✅ Resolvida: o de-para

Ela **validou** o mapeamento como estava e **dispensou** as 5 linhas novas que
seriam acrescentadas ao Balanço Financeiro. Motivo dela: *é um livro caixa, ela
só analisa o saldo final — o que entrou, o que saiu e o saldo de um mês para o
outro*. As 54 contas sem linha ficam sem linha mesmo.

Consequência prática: a Fase 4 encolheu e nada mais depende desta pendência.
A planilha de revisão (`GET /api/caixa/de-para`) segue disponível caso ela mude
de ideia.

## Armadilhas conhecidas

- **Empresa sem dono é visível a todo contador (transitório).** No modelo por dono,
  uma empresa com a coluna `contador` vazia é tratada como legado e aparece para
  **qualquer** `usuario` — é o que evita que VAZ E VOUZELA e TESTE sumissem para a
  Edilse quando o campo foi criado. O isolamento de verdade só vale entre empresas
  **com dono**: assim que um contador salva o cadastro, as dele são carimbadas e
  passam a ser invisíveis aos outros. Para migrar de vez, atribua o dono de cada
  empresa (o master faz isso na tela de Cadastros, ou cada contador salva a sua).
  Enquanto houver empresa sem dono, dois contadores ainda a enxergam.

- **As variáveis do Supabase só entraram na Vercel em 23/07/2026** —
  `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SECRET_KEY`, em Production e Preview.
  Até então o Livro Caixa rodava local e estourava `NEXT_PUBLIC_SUPABASE_URL não
  configurada` no deploy (o módulo de ponto não sentia, porque vive no Sheets).
  Variável nova na Vercel **só vale no deploy seguinte** — se o caixa quebrar em
  produção logo depois de mexer em env, é isso antes de ser bug.
- **O histórico de migração do Supabase já esteve dessincronizado — confira
  antes de dar push.** Em 23/07/2026 o banco tinha as tabelas da `0001` mas o
  remoto só registrava a `0000`; `lancamentos` e a view `resumo_mensal` nunca
  chegaram a ser criadas (`relation "lancamentos" does not exist`, até dentro de
  `saldo_final_exercicio()`). Resolvido com `migration repair --status applied
  0001` seguido de `db push` da `0002`, que é idempotente e recria o que faltava.
  A lição: **`supabase migration list` antes de `db push`** — se o remoto não
  registra uma migração cujas tabelas já existem, o push tenta recriá-las e
  quebra. As telas do caixa detectam a tabela ausente e mostram um aviso pedindo
  a migração em vez de estourar erro cru.
- **Duas cópias do projeto.** A pasta obsoleta `Desktop\sistema contadora` foi
  apagada em 23/07/2026. Se aparecer de novo, não trabalhe nela. Se um teste der
  resultado estranho (rota nova em 404, mudança que "não pegou"), confirme qual
  pasta o servidor de dev está servindo antes de investigar o código:
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select ProcessId, CommandLine`
- **`SESSION_SECRET` é obrigatório.** Sem ele o cookie de sessão é assinado com um
  padrão embutido no código e qualquer um forja uma sessão de master. Já definido
  no `.env.local` e na Vercel.
- **Variáveis mortas no `.env.local`.** `APP_USER`/`APP_PASSWORD` não são lidos
  por nada — `lib/config.ts` lê `MASTER_EMAIL`/`MASTER_PASSWORD`. E
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` também não: o único acesso ao Postgres é
  `lib/db.ts`, sempre com a secret key, porque as tabelas têm RLS ligada sem
  policies e a publishable key não leria nada mesmo. As três podem sair.
- **Cota do Google Sheets.** Cada rota chama `garantirAbaHeader`, que faz
  `spreadsheets.get` + `values.update` **antes de qualquer leitura** — ~3 chamadas
  por request, uma delas de escrita. Um teste com ~85 requisições estourou a cota
  de 60/min e devolveu 502. Vale enxugar se o módulo de ponto crescer.
- **Modo escuro quebrado.** `app/globals.css` define fundo preto via
  `prefers-color-scheme`, mas todos os componentes assumem tema claro. Afeta o app
  inteiro, é anterior a este módulo.
