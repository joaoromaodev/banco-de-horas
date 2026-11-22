# Livro Caixa — estado do módulo

> Documento de continuidade. Se você é um agente entrando agora no projeto, **leia
> este arquivo antes de mexer no módulo do caixa**: ele guarda as decisões, o que
> já está pronto e o que falta. Mantenha-o atualizado ao fim de cada etapa.

Última atualização: **21/11/2026** (Sprint 17, Frente B — nota e boleto sem IA:
XML de NF-e/NFS-e, linha digitável e PDF com texto lidos no servidor, migração 0033;
Frente C — mês fechado que trava, migração 0034; Frente D — extrato OFX/CSV no caixa,
migração 0035; ver "Sprint 17 · Frente C/D" em Etapas)

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
| Comprovantes | **Não** anexa e **não** tem OCR — o administrativo digita, o papel fica na empresa. *(21/11/2026: o dono decidiu construir a leitura de documento por IA, **desligada** por padrão e opcional por empresa — ver "Documento → lançamento sugerido por IA"; só vale para quem ligar, depois do aceite dela.)* |
| Nº do documento | **Não** quis o campo |
| Históricos | **Padronizados**, lista pronta para escolher |
| Edição | Editável e excluível, inclusive retroativo — **exceto em mês fechado** (Sprint 17 · C, ver abaixo) |
| Saldo negativo | Só **avisa**, não bloqueia |
| Saldo de janeiro | Vem do **encerramento do ano anterior** (2026 é o 1º ano: digitado) |
| Confirmar o mês | ~~Não trava a edição~~ → desde a Sprint 17 · C é **"Fechar o mês"**: libera o balanço ao cliente **e trava** o mês até reabrir com motivo |
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

### ✅ Ajuste — Juros/multa por lançamento e conta Tarifas Bancárias (migração 0005)

Pedido da contadora (via João). **Juros e multa são saídas ADICIONAIS**, não um
detalhamento da saída (opção aditiva, escolhida pelo João): a saída efetiva de
uma linha é `saida + juros + multa`, e o saldo corrido, o saldo transportado, os
totais do mês e a view `resumo_mensal`/`saldo_final_exercicio` somam os três. A
constraint `entrada_xor_saida` passou a ser `(entrada>0) <> ((saida+juros+multa)>0)`
— dá para ter linha só de penalidade (saida=0). No **cheque**, a retirada traz o
total (principal+juros+multa) e as penalidades ficam na perna do pagamento.
Colunas Juros/Multa na tabela e no formulário (`caixa/page.tsx`, componente
`Celulas`). Catálogo ganhou **2.10.05 Tarifas Bancárias** (grupo Despesas
Financeiras) + histórico "Pago tarifa bancária" — em `lib/planoContasPadrao.ts` e
já inseridos no banco.

### ✅ Pessoa física / autônomo (migração 0006)

Cliente **pessoa física/autônomo** (ex.: **NÉLIO DIAS DOS SANTOS**, da Edilse) não
tem CNPJ, inscrição estadual/municipal nem registro na Junta. Coluna
`tipo_pessoa` em `empresas` (`juridica` padrão | `fisica`), `Empresa.tipoPessoa`
em `lib/tipos`. No **Cadastro** há a coluna Tipo (Jurídica/Física) e o documento
vira **CPF** na física; no formulário **fiscal** (Livro Caixa · Cadastros) os
campos de inscrição estadual/municipal e registro na Junta **somem** quando a
empresa é pessoa física. O **Termo de Abertura** já ramifica por `tipoPessoa` na
Fase 6 (PF sem Junta/inscrições, com CPF) — falta só a Edilse validar a redação PF.

### ✅ Identificação do pagador/paciente nas entradas (migração 0007)

Pedido do João para a clínica do dentista **Nélio Dias dos Santos** (da Edilse):
lançar o **nome e o CPF de quem pagou**, que o IRPF do profissional de saúde exige
(**Carnê-Leão** e **DMED**, que alimenta a dedução de despesa médica do paciente).
A tensão que ele levantou: uma **loja** vende no balcão e não identifica cliente —
então o campo **não pode ser fixo** no livro de todos.

**Decisão de modelo:** a necessidade é da **atividade**, não do tipo de pessoa —
uma **clínica pessoa jurídica** também identifica o paciente. Por isso é uma **flag
por empresa** (`identifica_pagador`), ligada a dedo no cadastro, e **não derivada de
`tipo_pessoa`** (foi o contra-exemplo do João — clínica PJ — que fechou isso).

- Migração **0007**: `identifica_pagador boolean` em `empresas`; `pagador_nome` e
  `pagador_documento` (nulos) em `lancamentos`.
- Documento é **CPF ou CNPJ** (o pagador pode ser convênio/empresa) — guardado só
  com os **dígitos**, para exportar depois. **Não bloqueia**: dígito verificador
  inválido só **avisa** (âmbar), no espírito do resto do módulo. Validador
  client-safe em `caixa/formato.ts` (`documentoValido`/`formatarDocumento`).
- As colunas **Cliente/Paciente** e **CPF/CNPJ** só aparecem na tela do caixa
  quando a empresa tem a flag (depois de Complemento, antes de Conta). A contagem
  de colunas virou `nCols` (10 ou 12) para os `colSpan`.
- **Só nas entradas** na prática: as pernas do **cheque** (transferência +
  pagamento) e a saída comum não recebem pagador.
- Cadastro: checkbox **"Identifica pagador"** na tabela de Empresas-clientes
  (`/cadastros`). `lib/tipos` (`Empresa.identificaPagador`), `lib/cadastro` (mapa
  ida/volta), `lib/caixa` (tipos, validação, os dois selects e `montarLivro`), a
  rota `lancamentos` (POST/PATCH).
- **Pendente:** `npx supabase db push --linked` da 0007 (ainda não aplicada). E,
  quando quiser, decidir se o pagador entra no PDF/.xlsx do livro (o dado já viaja
  em `LinhaLivro`) e confirmar com a Edilse o rótulo da coluna.

### ✅ Fase 6 — Documentos (04/09/2026)

O **livro inteiro** — Termo de Abertura + os 12 meses + Termo de Encerramento —
em **PDF** e em **.xlsx**, para a contadora entregar. Nenhuma migração nova:
`exercicios` já tinha os campos por-livro do termo (0001).

- `lib/livroCaixa.ts` — o PDF (pdf-lib, padrão visual de `lib/folhaPonto.ts`).
  Páginas em **paisagem** (é como um razão se lê). Miolo no formato da planilha —
  DATA · HISTÓRICO · COMPLEMENTO · CONTA · ENTRADA · SAÍDA · SALDO —, saldo anterior
  na 1ª linha, **saldo corrido** por lançamento, totais + saldo a transportar no fim
  do mês. **Cada mês começa em página nova** (as 12 abas dela); mês grande **pagina
  sozinho** (sem o teto de 51 linhas do Excel), com "Saldo transportado" no topo da
  continuação. **Todas as folhas numeradas** no rodapé ("Folha N de T").
- `lib/planilhaCaixa.ts` — o .xlsx (exceljs, padrão de `lib/planilha.ts`): uma aba
  por mês com o **saldo corrido por fórmula** (`G = G_ant + E − F`), aba **Resumo**
  (os 12 meses + total) e as abas dos dois termos.
- `lib/formatoLivro.ts` — `MESES_LONGOS` server-side (a tela tem a sua própria cópia
  em `app/(app)/caixa/formato.ts`, que roda no navegador).
- `lib/caixa.ts` — `lerTermo`/`salvarTermo` (campos por-livro em `exercicios`) e
  **`montarLivro(empresa, ano)`**: a **fonte única** dos dois documentos, montada
  fora do banco (identidade + fiscal + termo + 12 meses com saldo corrido). Os
  geradores recebem `LivroCaixaDados` e **não tocam no Postgres**.
- `app/api/caixa/livro/route.ts` — **GET** `?empresa=&ano=&formato=pdf|xlsx` devolve
  o arquivo; **POST** grava os campos por-livro do termo. Só gestor, e só das
  empresas dele; o **cliente não baixa** o livro fechado (403). O GET do PDF grava a
  `qtd_folhas` (total de páginas) de volta em `exercicios` — é o número que o termo cita.
- `app/(app)/caixa/page.tsx` — aba **"Documentos"** (só gestor) com um painel para
  o nº do livro, nº de ordem e data do termo, e os botões de baixar PDF/.xlsx. O GET
  de `/api/caixa/exercicio` passou a devolver `termo` (só para gestor) para pré-preencher.

Como cada decisão virou código:

| Decisão / fonte | Onde |
|---|---|
| Identidade (nome, CNPJ/CPF, `tipoPessoa`) | tabela `empresas` via `lerEmpresa` (não mais Sheets) |
| Fiscal estável (endereço, inscrições, junta, cidade do termo, CRC) | `empresa_fiscal` via `lerFiscal` |
| Por-livro (nº do livro, nº de ordem, data, qtd de folhas) | `exercicios` via `lerTermo`/`salvarTermo` |
| Duas variantes do Termo | ramifica por `empresa.tipoPessoa`: PF sai **sem Junta/inscrições**, com **CPF** |
| Falta de dado cadastral | o termo sai com **placeholder** (`____`), não quebra |
| Juros/multa | a saída de cada linha é a **efetiva** (`saida+juros+multa`), via `saidaEfetiva` |

**Obs.:** `exercicios` ainda carrega colunas fiscais herdadas da 0001, redundantes
com `empresa_fiscal`. Os documentos **ignoram** essas colunas e usam `empresa_fiscal`
para o estável — as da 0001 seguem mortas (limpeza opcional numa migração futura).

**Pendências desta fase (não travam o código, travam a entrega real):**

1. **Texto legal dos termos.** A redação em `lib/livroCaixa.ts`/`lib/planilhaCaixa.ts`
   é o padrão do Livro Caixa — a **Edilse ainda precisa validar**, em especial a
   **variante de pessoa física** (redação nossa). O painel avisa isso na tela.
2. **Dados cadastrais reais** das 5 empresas (é a pendência 2 lá embaixo): sem o
   fiscal preenchido, os termos saem com placeholder.
3. **Campos por-livro** (nº do livro, nº de ordem, data) precisam ser preenchidos no
   painel "Documentos" antes de gerar o livro definitivo.

**Antes de push de migração** (segue valendo): `npx supabase db push --linked`
(CLI linkado ao `zxjeibkttmacpuukvyzo`). Se o Supabase estiver **pausado** (plano
grátis), `Restore` no dashboard primeiro.

### ✅ Conta Titular / Conta Analítica — histórico virou seletor por empresa (migração 0008)

Pedido do João (11/09/2026). Dois ajustes que andam juntos:

**1. Nomenclatura, para casar com o sistema que a contadora já usa.** O que o
livro chamava de **Conta** virou **Conta Titular** (a conta do plano, `N.GG.CC`),
e o que chamava de **Histórico** virou **Conta Analítica** — o subgrupo da
titular. A ordem das colunas também mudou: a Analítica passou a vir **logo depois**
da Titular (antes o "histórico" abria a linha). Só rótulo e ordem na **tela**;
o dado gravado (`lancamentos.historico`) segue sendo o texto da analítica.

**2. A analítica virou seletor rico, igual ao da titular.** Antes era um
`datalist` global (a mesma lista para toda empresa, sem criar item novo). Agora é
um modal com **"Analíticas desta empresa"** no topo, o **catálogo completo** e o
**+ criar** (só a contadora) — o gêmeo de `SeletorConta`.

A relação "analítica é subgrupo da titular" **já existia nos dados**: cada linha
de `historicos_padrao` aponta para a conta que sugere (`conta_id`). Passou a valer
de verdade na UI:

- Escolhida uma titular, a lista de analíticas mostra **só os subgrupos dela**
  (filtra por `conta_id`); sem titular ainda, mostra o catálogo todo.
- Escolher a analítica **preenche a titular** à qual ela pertence.
- Trocar a titular **limpa** a analítica se ela deixou de pertencer à nova.

Como cada decisão virou código:

| Decisão / fonte | Onde |
|---|---|
| Lista de analíticas **por empresa** | migração `0008`: `empresa_historicos` (empresa_id, historico_id), espelha `empresa_contas`. RLS ligada sem policies |
| "Usou, entrou na lista da empresa" | `vincularHistorico` na rota de lançamentos (POST/PATCH), como `vincularConta`. O form manda `historicoId` |
| Catálogo + criar nova (**só a contadora**) | `POST /api/caixa/historicos` (gestor) → `criarAnalitica`: cria sob a titular, natureza herdada dela, e já vincula |
| Cliente não navega o catálogo | `GET /api/caixa/contas` filtra as analíticas para as `daEmpresa` (igual às contas) |
| Rótulos e ordem na tela | `app/(app)/caixa/page.tsx` (cabeçalho, `Celulas`) + `app/(app)/caixa/SeletorAnalitica.tsx` (novo) |

**Transição (mesma armadilha das contas):** o cliente só enxerga as analíticas
`daEmpresa`. Empresa nova nasce sem vínculo em `empresa_historicos`, então quem
monta a lista dela é a **contabilidade** (usando/criando analíticas), exatamente
como já acontece com as contas. Não trava nada agora porque **ainda não há
lançamento**.

**Ainda como estava (follow-up, se a contadora quiser):** o **PDF/.xlsx** do livro
(Fase 6) ainda rotulam as colunas como "HISTÓRICO"/"CONTA" e não foram
reordenados — são a entrega oficial dela, então deixei para validar antes de mexer.

**Estado:** a **0008** foi aplicada no remoto em 11/09/2026 (a 0007 já constava
aplicada lá). Verificado no banco: `empresa_historicos` responde, catálogo com 25
analíticas (22 com titular). Falta só a validação visual da tela (login).

### ✅ Limpeza das analíticas e conta "Recebido Atendimento" (dados, 11/09/2026)

Pedido do João. **Não houve migração** — foi tudo operação de dados no remoto, via
script supabase-js (mesma secret key das rotas, padrão de `lib/db.ts`). Na ordem:

1. **Apagadas todas as analíticas do catálogo** (`historicos_padrao`, 25 linhas) para
   recriar do zero. O `empresa_historicos` caiu junto por `on delete cascade`. Os
   lançamentos **não** foram afetados: `lancamentos.historico` é texto solto, sem FK
   para o catálogo, então cada linha manteve o texto que já tinha.
2. **Renomeado o histórico dos lançamentos** `"Atendimento"` → `"Recebido Atendimento"`
   (8 linhas, correspondência exata na coluna `historico`).
3. **Criada a analítica "Recebido Atendimento"** no catálogo, sob a titular
   `1.02.05 Receita de Atendimento` (natureza `receita`, herdada da titular — o mesmo
   que `criarAnalitica` faz).
4. **Vinculada à empresa dos lançamentos** (`225646d6-47f2-4a35-b9d1-cedc779723ce`,
   exercício 2026) em `empresa_historicos`, para aparecer no topo do seletor.
5. **Excluídas duas analíticas duplicadas "Atendimento"** que ainda constavam no
   catálogo (mesma titular, natureza `receita`) — apareciam repetidas no seletor.

Estado final do catálogo: **uma** analítica, "Recebido Atendimento". Lançamentos
intactos, agora com o texto novo.

**Descoberta no caminho (o doc estava errado):** o banco tem **57 lançamentos** — não
"nenhum lançamento ainda", como esta doc afirmava. Ver "Estado do banco" abaixo,
corrigido.

### ✅ Padronização das analíticas do NÉLIO e faxina dos órfãos (dados, 11/09/2026)

Pedido do João: padronizar as categorias (conta titular × analítica) a partir dos
lançamentos reais do único cliente em uso, **NÉLIO DIAS DOS SANTOS** (clínica
odontológica, PF/Carnê-Leão, `225646d6-47f2-4a35-b9d1-cedc779723ce`). De novo, **só
dados**, sem migração.

**Órfãos.** Dos 57 lançamentos, só **46 eram do NÉLIO**; os outros **11** estavam num
exercício cujo `empresa_id` não existe mais em `empresas` (resíduo das empresas de
teste apagadas — eram deles os "Vendas/Mercadorias/Compras de mercadorias/PIS p/
salário" que pareciam categorias erradas). Excluídos os 11 lançamentos + 4 exercícios
órfãos + 3 `meses_confirmados`, com **backup** em
`scratchpad/backup-orfaos-2026-09-11.json` antes de apagar. Restaram os 46 do NÉLIO.

**Decisões da padronização (confirmadas pelo João, em tese calls da Edilse):**

| Conta Titular | Conta Analítica (texto padrão) | Qtd | Nota |
|---|---|---|---|
| 1.02.05 Receita de Atendimento | Recebido Atendimento | 8 | receita |
| 2.02.02 Energia Elétrica | Pago conta de luz | 7 | |
| 2.02.06 Material de Expediente | Pago material de expediente | 16 | ver Q1 |
| 2.03.15 Condomínio | Pago aluguel do escritório | 3 | mantido em Condomínio (não movido p/ 2.03.01 Aluguel) |
| 2.06.02 Serviços Prestados por PJ | Prótese | 9 | laboratório |
| 2.11.04 Material de Consumo | Pago material de consumo | 2 | era "Consumo"/"Fornecedor" |
| (sem titular) | Retirada de conta corrente | 1 | transferência; fora do catálogo |

- **Q1 (material de expediente × consumo).** Definição do João: *expediente = material
  administrativo* (mouse, teclado, papel, caneta); *consumo = insumo da atividade*.
  Como os 16 tinham o texto "Pago material de expediente", os 15 que estavam em
  `2.11.04 Material de Consumo` foram **re-apontados para `2.02.06 Material de
  Expediente`** (`conta_id`). ⚠️ Se algum desses (total R$ 7.333,31) for insumo
  clínico, é só reclassificar de volta.
- **Uma analítica por titular, sem colisão.** Antes o mesmo texto aparecia sob duas
  titulares. Agora cada titular tem um texto único.
- **Catálogo.** As 6 analíticas padrão foram criadas em `historicos_padrao` (a de
  Atendimento já existia) e **todas vinculadas a `empresa_historicos` do NÉLIO** —
  aparecem no topo do seletor "Analíticas desta empresa".

### ✅ Catálogo por escritório (0013) — 21/11/2026 (Sprint 2, Frente C)

Até aqui `plano_contas` e `historicos_padrao` eram globais: um contador de outro
escritório que criasse conta/analítica "nova" a punha no catálogo que a Edilse
também vê. Agora o catálogo tem **duas camadas**, pela coluna `escritorio_id`
(anulável) nas duas tabelas:

| `escritorio_id` | Significado | Quem vê |
|---|---|---|
| nulo | **catálogo base** da plataforma (as 119 contas de `lib/planoContasPadrao.ts`) | todos |
| preenchido | **extensão** daquele escritório | só ele (e o `master`) |

- **Regra pura:** `lib/visibilidadeCatalogo.ts` (`visaoDoCatalogo`, `itemVisivel`,
  `filtrarCatalogo`, `donoDaCriacao`, `proximoCodigo`), testada em
  `tests/visibilidadeCatalogo.test.ts`. Sem escritório na sessão = só o base (falha fechada).
- **Leitura:** `contasDaEmpresa`/`historicosDaEmpresa` (`lib/caixa.ts`) recebem a
  visão da sessão; o filtro vai na consulta e é reaplicado em JS. O `master` vê tudo.
  `montarLivro` (PDF/.xlsx) resolve código/nome sem recorte, só para lançamentos que já existem.
- **Criação** (só a contadora, como antes): `POST /api/caixa/contas` e `/historicos`
  gravam com o escritório da sessão; o `master` cria no **base**. Contador sem
  escritório recebe 403. O código `N.GG.CC` novo é o próximo livre entre o **base +
  as do próprio escritório** (para o master, entre todas).
- **Lançar** (`POST/PATCH /api/caixa/lancamentos`) agora **recusa** `contaId`/`historicoId`
  que não sejam do base nem do escritório de quem lança (`exigirCatalogoVisivel`) —
  antes um id de outro escritório entrava.
- **Unicidade do código:** deixou de ser global. É única **no base** e **dentro de cada
  escritório**; dois escritórios podem ter o mesmo código próprio. Um trigger impede que
  conta de escritório reuse código do base. (Se um dia o `seed` incluir no base um código
  que um escritório já usa, o escritório passa a ver dois — renomeie a dele antes.)
- **Seed (`POST /api/caixa/seed`)** só toca o base: insere/atualiza as contas padrão
  (sem `onConflict`, porque o índice único do código agora é parcial) e recria só os
  históricos de `escritorio_id` nulo. Analíticas e contas de escritório ficam intactas.
  ⚠️ Rodar o seed hoje **recria as 24 analíticas padrão no base** (o banco tem 0 delas
  desde a limpeza de 11/09) — todo escritório passaria a vê-las. Só rode se for isso que se quer.
- **Lançamentos não mudam:** a migração não faz `update` em `lancamentos`; eles seguem
  por `conta_id` (que não muda) e a analítica é texto solto.

**O que a migração move** (conferido em **21/11/2026**, só leitura, no banco de produção
`zxjeibkttmacpuukvyzo`: 123 contas = 119 padrão + 4 à mão; 6 analíticas, todas à mão) —
tudo para o escritório da Edilse `00000000-0000-4000-8000-000000000001`:

| Conta titular (criada à mão) | Lançamentos |
|---|---|
| 1.02.05 Receita de Atendimento | sim |
| 2.03.14 TELEFONE | não |
| 2.03.15 Condomínio | sim |
| 2.11.04 Material de Consumo | sim |

| Analítica (criada à mão) | Titular |
|---|---|
| Pago conta de luz | 2.02.02 |
| Recebido Atendimento | 1.02.05 |
| Prótese | 2.06.02 |
| Pago aluguel do escritório | 2.03.15 |
| Pago material de expediente | 2.02.06 |
| Pago material de consumo | 2.11.04 |

As outras 119 contas ficam no base. As analíticas de titular base (2.02.02, 2.06.02,
2.02.06) viram extensão da Edilse sob uma conta base — correto: a analítica é dela.
Os vínculos `empresa_contas`/`empresa_historicos` não mudam.

**Estado:** migração `0013` **escrita, não aplicada** (o dono aplica: `npx supabase
migration list` antes, depois `db push`). Ordem: aplicar a 0013 e então publicar o
código — o código novo filtra por `escritorio_id` e falha sem a coluna; o código antigo
roda bem com a coluna nova. Depois de aplicar, conferir que a Edilse continua vendo as
6 analíticas do NÉLIO e que um contador de outro escritório não as vê.
**Sem teste end-to-end** contra o banco (a migração não foi aplicada): typecheck, lint
(0 erros), 202 testes e build passam; o recorte de visibilidade está coberto pelos testes da regra pura.

### ✅ Caixa inteligente (0017) — 21/11/2026 (Sprint 5, Frente A)

Priorizada pelo consultor contador. Duas coisas, as duas **só sugerem/alertam** — nada
preenche sozinho, cria conta, marca conferido ou bloqueia lançamento.

#### 1. Sugestão de Conta Titular + Analítica ao lançar

Regra pura em `lib/sugestaoConta.ts` (testada em `tests/sugestaoConta.test.ts`), que
**roda no navegador**: a tela baixa uma vez os exemplos da empresa
(`GET /api/caixa/sugestao?empresa=`) e sugere a cada tecla, sem ida ao servidor
(≈0,1 ms por sugestão). Ordem das fontes — a primeira que resolve, vence:

| Fonte | Como | Motivo que a tela mostra |
|---|---|---|
| (a) analítica | o complemento cita o texto de uma analítica visível (tokens sem acento, sem os verbos "Pago/Recebido"; prefixo de 4+ letras casa plural), na natureza da direção | `o complemento cita "luz"` |
| (b) histórico | votação ponderada nos lançamentos da mesma empresa: complemento (Jaccard com peso idf; números viram forma — "NF 1590" ≈ "NF 1741", "REF 07/2026" ≈ "REF 08/2026"), valor (distância em ln, σ = 0,5) e pagador; só os da mesma direção. **Conferido pesa 1; corrigido pela contadora antes de conferir, 2; ainda não conferido, 0,3** (e não conferido com a natureza da conta trocada não entra) | `como em 9 lançamentos conferidos de "Prótese" com "nf"` — ou, se só há não conferidos por trás, `como você lançou antes (5 lançamentos, ainda não conferidos)`, com confiança no máximo 0,6 |
| (c) IA | **só com clique** ("Perguntar à IA", quando (a) e (b) não resolvem e há complemento) e **desligada por padrão** (ver "Isolamento e LGPD"). O Gemini escolhe **um índice** de uma lista com as analíticas **da empresa** (ou, sem analítica, as titulares da empresa); índice fora da lista = nada | selo "IA" + `sugestão da IA entre as contas desta empresa — confira` (confiança com teto 0,6) |

Na tela (`app/(app)/caixa/page.tsx`, `FaixaSugestao`): uma faixa abaixo do formulário
de novo lançamento (tabela e celular) com a titular › analítica sugeridas, o motivo e o
botão **Usar** (preenche as duas). Se o usuário já escolheu outra, a faixa continua
("O histórico sugere outra conta") — é um segundo olhar; some quando a escolha bate.

**Por que entram os não conferidos (decisão, ouvido o `contador`):** a tarefa pedia só
os conferidos, mas o NÉLIO tem 1 conferido em 46 — a votação simplesmente não
funcionaria. O risco dos não conferidos é a empresa repetir o próprio erro e a
sugestão dar a ele cara de regra; por isso o freio: peso 0,3, teto de confiança 0,6, o
rótulo "ainda não conferido" na tela, e os de natureza trocada ficam de fora. Para
voltar ao "só conferidos", basta `PESO_NAO_CONFERIDO = 0` em `lib/sugestaoConta.ts`.

**Aprende com a contadora:** o que ela confere passa a pesar 1, e o que ela **corrigiu**
antes de conferir (alterado por outra pessoa que não quem lançou) pesa 2. Ao marcar
conferido a tela recarrega os exemplos, então a próxima sugestão já usa. Para **medir**,
a 0017 registra em `caixa_sugestoes` cada sugestão que estava na tela ao lançar
(`origem`, `aceita`) e, na conferência, se a conta ficou (`confirmada`) ou foi trocada
(`corrigida`) — `avaliarNaConferencia` em `lib/caixaInteligente.ts`.

**Acurácia medida com os 46 lançamentos reais do NÉLIO** (21/11/2026, só leitura,
fingindo que todos estivessem conferidos):

| Validação | Oferece sugestão em | Acerta titular + analítica |
|---|---|---|
| deixa um de fora (cada um contra os outros 45) | 32 de 46 (69,6%) | **30 de 32 (93,8%)** |
| sequencial (cada um só contra os anteriores, como na vida real) | 32 de 46 (69,6%) | 28 de 32 (87,5%) |
| **hoje, de verdade** — 1 conferido + 45 não conferidos (peso 0,3), deixa um de fora | 25 de 46 | **25 de 25 (100%)** |
| idem, sequencial | 15 de 46 | 15 de 15 (100%) |

Os erros são todos "NF + número" de valor médio entre **Prótese** (laboratório,
R$ 900–12 mil), **Material de expediente** (R$ 34–1.288) e **Material de consumo** —
o complemento é igual e os valores se cruzam. Os pesos (`AJUSTE_PADRAO`: tokens 0,4 ·
valor 0,45 · pagador 0,15, nitidez 4, confiança mínima 0,45) saíram de uma busca em
grade nesses dados (todos tratados como conferidos), escolhendo o ponto estável e não o
extremo (46 lançamentos é pouco — recalibrar quando houver algumas centenas conferidos).
O `contador` sugeriu inverter (texto acima do valor); nos dados do NÉLIO o valor é o que
separa Prótese de Material — fica como está até haver mais empresas para medir. Com o
freio dos não conferidos a sugestão oferece menos (a confiança cai), mas acerta tudo o
que oferece; conferir o NÉLIO (45 pendentes, ~meia hora) é o que mais melhora a cobertura.

**Isolamento e LGPD (revisado pelo `escudo` em 21/11/2026 — sem vazamento entre
escritórios nem entre empresas).** Os exemplos vêm só dos exercícios **daquela
empresa**; o nome/CPF do pagador vira um **pseudônimo** (hash de 32 bits, reversível por
força bruta — serve só porque quem recebe já vê esses lançamentos; não reaproveitar fora
daqui) **no servidor** antes de ir para a tela; as palavras do complemento vão como estão.
A sugestão só sai se a conta estiver na lista que a sessão já vê (cliente: só as da
empresa; contador: base + escritório). `sugestao.id` de outra empresa no POST de
lançamentos não religa nada (o update filtra empresa e `lancamento_id` nulo), e uma
sugestão "ia" sem o id da chamada é ignorada (não conta na cota nem na medição).

**O que vai para a IA:** o complemento **mascarado** (sequências de 5+ dígitos viram
`[número]`, e-mail vira `[e-mail]`), a direção, o valor e a lista de contas da empresa —
**nunca** o nome nem o CPF do pagador. Mas o complemento pode trazer **nome de paciente e
procedimento** (dado de saúde, art. 11 da LGPD) — por isso a IA:
- fica **desligada por padrão**: só liga com a variável `CAIXA_IA_SUGESTAO=ligada`;
- **nunca** liga para empresa com `identifica_pagador` (clínica/saúde — o NÉLIO);
- (`iaPermitida` em `lib/caixaInteligente.ts`; a tela só mostra "Perguntar à IA" quando pode).

**Limites da IA:** `LIMITE_IA_DIA` = 200 chamadas por escritório por dia e, quando quem
pergunta é o cliente, `LIMITE_IA_EMPRESA_CLIENTE` = 30 por empresa (um cliente não esgota
o escritório) — contadas em `caixa_sugestoes`, origem `ia`; sem a 0017 a IA fica
desligada. Mais 20 por usuário a cada 10 min (em memória, por instância). A conferência
da cota e o registro não são atômicos: rajadas paralelas passam um pouco do teto (custo
baixo, aceito). Usa `GEMINI_API_KEY`/`GEMINI_MODELO` (os mesmos da folha de ponto).

#### 2. Revisão antes da conferência

Regras puras e explicáveis em `lib/revisaoCaixa.ts` (`tests/revisaoCaixa.test.ts`).
`GET /api/caixa/revisao?empresa=&ano=` (só gestor) revisa o exercício inteiro (mais o
ano anterior, só para o padrão de valor) com `revisarExercicio` (`lib/caixaInteligente.ts`).

| Alerta | Nível | Regra |
|---|---|---|
| Duplicado? | alto | mesma data + direção + valor + conta (+ pagador), complemento igual ou vazio |
| Parece repetido | médio | o mesmo com complementos diferentes; entrada de balcão igual no dia (sem pagador nem complemento); mesmo valor/conta/pagador a até 3 dias — **só saídas e entradas com pagador, nunca transferência**; o mesmo documento duas vezes na conta em até 60 dias (documento = número **depois de** NF, nota, recibo, boleto, RPS, cupom, pedido, fatura ou duplicata; "sala 1203" não conta) |
| Valor fora do padrão | médio | ≥ 3× ou ≤ ⅓ da mediana da conta **e** desvio robusto (MAD em ln) ≥ 3; só com 4+ outros lançamentos da conta |
| Receita como saída / Despesa como entrada | alto; **médio** se o complemento diz estorno/devolução/reembolso/ressarcimento | natureza da titular × direção; na devolução o motivo aponta "Recuperação de despesas" |
| Data futura | alto | data depois de hoje (erro de dia/mês/ano que o trigger do exercício deixa passar) |
| Mudou após confirmar | alto | lançado ou alterado depois de o mês ser confirmado — o resumo que o cliente viu mudou |
| Falta o pagador / CPF/CNPJ inválido | médio | empresa com `identifica_pagador`, entrada que não é transferência |
| Juros/multa de novo | baixo | juros ou multa em 3 dos últimos 6 meses (e um aviso do exercício) |
| Saldo negativo | médio | pelo saldo do **fim do dia** (pagar antes de receber no mesmo dia não conta); selo no último lançamento do dia |
| Sem conta titular | baixo | fora depósito/retirada/transferência |
| Mês sem lançamento | médio (do exercício) | mês encerrado há **mais de 10 dias** sem nada |

O pagador entra na chave da duplicidade de propósito: duas consultas de R$ 800 de
pacientes diferentes no mesmo dia são o normal de uma clínica. Os ajustes de ruído
(documento, fim do dia, transferências, balcão, estorno, carência) e os dois alertas
novos vieram da revisão do `contador` em 21/11/2026.

Na tela (só a contabilidade): um aviso "Revisão do exercício" com os alertas gerais;
por lançamento um **selo** com o alerta mais grave (+N) e todos os motivos no balão
(mouse e teclado); **"Só os que pedem atenção"** e a ordem **"Maior risco primeiro"**
(alto 5, médio 2, baixo 1 — empate mantém a ordem do livro; o saldo corrido continua o
da ordem do livro).

Nos dados reais do NÉLIO a revisão aponta: **2 CPFs com dígito inválido** (09/02 e
20/04 — este tem 10 dígitos), 2 recebimentos muito acima do habitual (R$ 3.000 e
R$ 11.000 contra mediana de R$ 800), **saldo negativo** a partir de 05/04 (o saldo
inicial de 2026 ainda é zero, pendência 1) e **setembro e outubro sem lançamento**.

#### Desempenho

- Exemplos: uma consulta paginada (o Supabase corta em 1000 linhas) dos conferidos mais
  recentes, até 3000, pelo índice parcial novo `lancamentos_conferidos_idx`; compactados
  (lançamentos iguais viram um exemplo com peso) — 3000 viram poucas centenas, alguns KB.
- Revisão: duas consultas (lançamentos do ano + anterior pelo índice de exercício, e o
  nome das contas citadas). Tudo agrupado por `Map`: 46 lançamentos em ~20 ms; 5 mil em
  ~80 ms; 20 mil no pior caso (todos duplicados) em ~1 s.

#### Para o integrador

- **Migração `0017_caixa_inteligente.sql`** (só o arquivo; **não aplicada**). Aditiva:
  tabela `caixa_sugestoes` (RLS sem policies) + índices. A ordem não quebra nada — sem
  ela a sugestão local e a revisão funcionam, só o registro e a IA ficam desligados (a
  rota da IA responde 503 "falta a migração 0017"). `supabase migration list` antes do push.
- **Variáveis:** `CAIXA_IA_SUGESTAO` (nova, opcional). **Deixe sem** até: (1) a
  política de privacidade (`app/(site)/privacidade/page.tsx`, hoje só cita IA na Folha
  de Ponto) citar a classificação de lançamentos do Livro Caixa por IA, o Google Gemini
  como suboperador e a transferência internacional — texto para o jurídico; (2) confirmar
  que a chave do Gemini está no **plano pago** (no gratuito o Google pode usar o que é
  enviado). Então `CAIXA_IA_SUGESTAO=ligada`. Mesmo ligada, empresa que identifica
  pagador (o NÉLIO) não usa IA. A IA usa `GEMINI_API_KEY` e `GEMINI_MODELO`.
- **A 0017 depende da `0012`** (a unique `empresas (id, escritorio_id)` da FK composta).
- **Contabilista/CRC padrão deixou de ser o da Edilse.** Antes `lib/caixa.ts`
  (`FISCAL_PADRAO`), `app/api/caixa/fiscal/route.ts`, a tela `caixa/cadastros` e o
  default da coluna (0003) punham "Edilse Goes da Costa / 01619/0-3" em qualquer empresa
  de qualquer escritório. Agora o padrão é o **responsável técnico do escritório**
  (`escritorios.contabilista_nome`/`contabilista_crc`, novas na 0017) ou **em branco**
  (o termo sai com o espaço para preencher). `padraoContabilista` em `lib/caixa.ts`;
  teste em `tests/contabilistaPadrao.test.ts` (escritório novo recebe em branco, e
  nenhum `.ts/.tsx` de `app/`/`lib/` traz o nome ou o CRC dela).
  - A 0017 preenche o responsável **só do escritório da Edilse** (id fixo da 0010), se
    vazio, e tira o default das colunas de `empresa_fiscal`. **Nenhuma linha de
    `empresa_fiscal` é alterada** — as empresas dela com o contabilista salvo seguem iguais.
  - Ordem: o código funciona antes da 0017 (sem a coluna, o padrão fica em branco;
    em branco grava `''`, compatível com o `not null` da 0003). Até aplicar a 0017, uma
    empresa da Edilse **sem** cadastro fiscal mostraria o contabilista em branco.
  - Ainda **não há tela** para o escritório editar o seu responsável técnico (hoje só por
    SQL do master). Próximo passo natural: campo nas Configurações do escritório.
  - Testar: empresa de um escritório de teste sem cadastro fiscal → "Dados fiscais" vem
    com contabilista e CRC em branco; uma empresa da Edilse continua com o nome dela.
- **Painel (fechamento mensal):** para mostrar "pedem atenção" por empresa, chame
  `revisarExercicio(empresaId, ano)` de `lib/caixaInteligente.ts` — `resumo` traz
  `{ alto, medio, baixo, lancamentos }` e `gerais` os alertas do exercício (mês sem
  lançamento etc.). Não toquei no painel.
- **O que testar em produção com uma conta de teste** (empresa de teste do escritório de
  teste, **nunca** nas empresas da Edilse):
  1. Lançar 3–4 saídas com complemento "REF 01/2026" na conta de luz e conferi-las; no
     novo lançamento, digitar "REF 02/2026" e um valor parecido → a faixa sugere a conta
     de luz com "como em N lançamentos conferidos"; **Usar** preenche titular + analítica.
  2. (Só com `CAIXA_IA_SUGESTAO=ligada` e numa empresa de teste **sem** "identifica
     pagador".) Digitar "conserto da cadeira" sem histórico → "Perguntar à IA" → sugestão
     com selo IA, só entre as contas da empresa; conferir uma linha nova em `caixa_sugestoes`.
     Numa empresa com "identifica pagador" o botão não aparece e o POST responde 403.
  3. Lançar com a sugestão e depois corrigir a conta e conferir → a linha em
     `caixa_sugestoes` fica `corrigida`.
  4. Lançar o mesmo valor/data/conta duas vezes → selo "Duplicado?" na conferência;
     ligar "Só os que pedem atenção" e "Maior risco primeiro". Confirmar um mês e editar
     um lançamento dele → selo "Mudou após confirmar".
  5. Entrar como **cliente** da empresa de teste: a faixa de sugestão aparece; a revisão
     não (a rota responde 403); `GET /api/caixa/sugestao` de outra empresa → 403.
- **Não verificado no navegador** nesta etapa (não há ambiente de teste local com banco;
  o único `.env.local` aponta para produção). typecheck, lint, testes e build verdes.

**Pendências / próximos passos:**
- **[Aberto — jurídico/fundador]** privacidade + plano pago do Gemini antes de ligar
  `CAIXA_IA_SUGESTAO` (acima). Para empresas de saúde, a IA continua fora até o jurídico
  validar o tratamento de dado de saúde pelo Gemini.
- **[Perguntas para a Edilse, do `contador`]** devolução de fornecedor vai para
  "Recuperação de despesas" ou abate a despesa? No Carnê-Leão ela precisa do CPF de quem
  pagou **e** do paciente atendido (campo "paciente, se diferente")? O alerta cita "DMED"
  ou "Receita Saúde"? Até que dia o cliente costuma lançar (a carência de 10 dias)?
- Recalibrar `AJUSTE_PADRAO` quando houver algumas centenas de conferidos (o script de
  medição é o "deixa um de fora" descrito acima; os números saem de `caixa_sugestoes`
  também: taxa de `aceita` e de `confirmada`).
- `montarLivro` (PDF/.xlsx) e `saldoTransportado` leem lançamentos sem paginação — acima
  de 1000 lançamentos num exercício o Supabase corta a resposta. Não é desta frente;
  `paginado()` em `lib/caixaInteligente.ts` resolve se for preciso.

### ✅ Caixa para o cliente (0023) — 21/11/2026 (Sprint 8, Frente C)

Alerta de limite de faturamento (MEI/Simples) e **Demonstrativo de caixa** mensal com envio ao
cliente: regras, decisões e **"Para o integrador"** em [`resumo-cliente.md`](resumo-cliente.md).

### ✅ Documento → lançamento sugerido por IA (0029) — 21/11/2026 (Sprint 12, Frente A)

Decisão do dono (`docs/empresa/decisoes.md`, 21/11): "o cliente lança, a IA lê, o contador
confere". Muda a decisão antiga "Comprovantes: não anexa" **só para quem ligar**: o
lançamento pode nascer de um documento e fica com ele anexado. Construído **desligado**,
atrás de duas travas.

**Como funciona.** No Livro Caixa, quem lança (cliente ou contabilidade) clica em **Ler
documento** (botão secundário no cabeçalho, só aparece quando pode). No diálogo escolhe
o documento — **enviar agora** (foto ou PDF; fica também em Documentos, na competência do
mês aberto, pelo mesmo fluxo do portal: URL assinada → Storage → servidor confere os
bytes) ou **um já enviado** em Documentos — e diz se é pagamento (saída, padrão),
recebimento (entrada) ou "não sei". A IA devolve uma **proposta**: data, valor,
entrada/saída, complemento e a conta, escolhida **só entre as da empresa** (mesma lista
da IA do caixa, `opcoesParaIa`; índice fora da lista ou de natureza trocada = sem conta).

A proposta **nunca grava**: vira **rascunho** no formulário de novo lançamento, com um
aviso "Rascunho lido pela IA — confira antes de lançar" (link para o documento, confiança
da leitura e o que a IA não leu — data fora do exercício, valor, conta) e um toast com
**Desfazer** (o formulário volta ao que estava). Quem lança confere e clica em **Lançar**
(continua a única ação primária). O POST de lançamentos recebe `documentoId` e grava
`lancamentos.documento_id`; na tabela, o complemento ganha o ícone do anexo, que abre
pelo `/api/documentos/arquivo` (guarda + URL assinada de 60 s — nenhuma URL fica na tela).
Desfazer a exclusão de um lançamento recria com o anexo (ou sem ele, avisando, se o
documento foi excluído nesse meio-tempo).

**Travas** (`situacaoIaDocumento` em `lib/documentoLancamento.ts`):

| Trava | Desligada → |
|---|---|
| 1. Plataforma: `CAIXA_IA_DOCUMENTO=ligada` + chave do Gemini | o botão não aparece; `POST` 503 "não está ligada nesta plataforma"; `PATCH` (ligar) 503 |
| 2. Empresa: `empresas.caixa_ia_documento` (0029), **padrão desligada**; só a contabilidade liga, em Livro Caixa › **Documentos** › "Leitura de documentos por IA" (`PATCH /api/caixa/documento-ia`, `exigirGestor`) | o botão não aparece; `POST` 403 "não está ligada para esta empresa" |
| Empresa que identifica pagador (saúde) — como a IA do caixa | nunca: `POST` e ligar respondem 403 |

**Rotas.** `app/api/caixa/documento-ia/route.ts` — `GET ?empresa=` (situação; o cliente só
vê `disponivel`), `PATCH { empresa, ligada }` (só gestor; desligar vale sempre), `POST
{ empresa, documento, ano, direcao? }` (a leitura). Sob `/api/caixa`: o cliente alcança
pelo `CLIENTE_PODE` que já existia e a contabilidade precisa do módulo caixa — **sem
mudança no `proxy.ts`**. Toda rota chama a guarda de `lib/acesso.ts` (`exigirEmpresa`,
`exigirGestor`, `motivoNegado`). O documento tem que ser **da mesma empresa** e passar em
`podeVerRegistro` (escritório gravado no documento = o da sessão), recebido ou conferido,
não excluído — senão 404.

**Isolamento e LGPD (revisado pelo `escudo` em 21/11/2026 — aprovado com ressalvas, sem
vazamento entre escritórios nem entre empresas).** Testado em
`tests/documentoLancamentoRotas.test.ts`: cliente de outra empresa e contador de outro
escritório → 403; documento de outra empresa ou gravado em outro escritório → 404;
`documentoId` de outra empresa no POST de lançamentos → 400 e nada gravado; cliente não
liga a opção (403). **Invariante:** `documento_id` tem FK simples para `documentos`; a regra
"o documento é da mesma empresa do lançamento" só existe em
`app/api/caixa/lancamentos/route.ts` — não grave `documento_id` por outro caminho.

**O que vai para o Gemini** (`lib/documentoLancamentoServidor.ts` + `montarPromptDocumento`):
- o arquivo, **minimizado**: do PDF, só as **2 primeiras páginas**, regravado pelo pdf-lib
  (sai sem os metadados do original — autor, título, programa); a foto (JPG, PNG, WEBP)
  **em pé** (a orientação do EXIF aplicada nos pixels, `lib/fotoParaIa.ts`, Sprint 13) e
  **sem EXIF/XMP/textos** (localização do celular, aparelho, horário), por
  `imagemSemMetadados`. O que não dá para minimizar é **recusado (415)**, nunca mandado
  inteiro: PDF com senha ou torto, imagem fora do formato e **HEIC** (sem biblioteca de
  imagem não dá para limpar; a foto tirada pelo navegador já é JPG);
- o texto: o exercício, a direção informada e a lista de contas da empresa;
- **não vão**: nome/CNPJ da empresa, e-mail de quem lança, nome do arquivo, observação do
  envio, lançamentos anteriores;
- só categorias **nota, recibo e outros** — **extrato e folha nunca** (dados bancários de
  terceiros, nome/CPF/salário de empregados), nem chamando a API direto (415).

O documento em si **pode trazer dado pessoal** de terceiros (nome, CPF, endereço de quem
emitiu ou recebeu) — não dá para mascarar uma foto antes de a IA lê-la; por isso as duas
travas e a saúde de fora. O prompt pede para não escrever CPF, endereço, telefone, e-mail,
nome de pessoa física nem dado de saúde no complemento, e a resposta passa por
`mascararTexto` (11+ dígitos, CPF, telefone e e-mail viram marcador).

**Cota e abuso.** Cada leitura conta na **cota mensal de IA do escritório** — a mesma da
folha de ponto (`lib/cotaOcr.ts`, por plano): a rota reserva em `ponto_leituras_ocr` com
`origem = 'documento'` antes de chamar o Gemini e reconta (corrida), confirma depois (conta
mesmo se a leitura não serviu) e marca `falhou` se o Gemini cair (não conta na cota, conta
no ritmo). Além disso: o ritmo do escritório (30 tentativas/10 min, compartilhado com a
folha), **15 leituras por usuário a cada 10 min** (memória, por instância) e, quando quem
lê é o **cliente**, **30 leituras de documento por empresa por mês**
(`LIMITE_DOCUMENTOS_EMPRESA_CLIENTE`, contadas no banco, **só as do cliente** — Sprint 13)
— um cliente não esgota a cota do escritório nem trava a folha de ponto. O arquivo é baixado e preparado **antes** de gastar
cota. Escritório suspenso ou cota esgotada → 429 com a mensagem "dá para lançar à mão".

**Arquivos.** `supabase/migrations/0029_documento_lancamento.sql`; `lib/documentoLancamento.ts`
(puro: travas, categorias, opções, prompt, leitura da resposta, máscara, metadados de
imagem — `tests/documentoLancamento.test.ts`); `lib/documentoLancamentoServidor.ts`
(preparar o arquivo e chamar o Gemini); `app/api/caixa/documento-ia/route.ts`;
`app/(app)/caixa/LerDocumento.tsx` (diálogo) e `app/(app)/caixa/page.tsx` (botão, rascunho,
anexo, alternador no painel Documentos). Mudanças mínimas em `lib/caixa.ts`
(`lancamentosDoMes` devolve `documentoId`; sem a 0029 relê sem a coluna), `lib/cadastro.ts`
(`definirIaDocumento`, fora do upsert do cadastro), `lib/documentosServidor.ts`
(`baixarArquivo`, que reconfere tamanho e assinatura), `lib/pontoDb.ts` (`origem` na
reserva, `contarLeiturasDocumentoDoCliente`), `lib/tipos.ts` e
`app/api/caixa/lancamentos/route.ts` (`documentoId`). Nos testes o Gemini é **simulado**
(`vi.mock('@google/genai')`): nenhum documento sai da máquina.

#### Para o integrador

- **Migração `0029_documento_lancamento.sql`** (só o arquivo; **não aplicada**). Aditiva:
  `empresas.caixa_ia_documento boolean not null default false`, `lancamentos.documento_id
  uuid references documentos on delete set null` (+ índice parcial) e
  `ponto_leituras_ocr.origem text not null default 'folha'` com check `folha|documento`.
  Depende de **0002, 0012 e 0015**. Ordem livre: sem ela o caixa funciona igual (o GET dos
  lançamentos relê sem a coluna; o POST só leva `documento_id` quando há documento), e a
  leitura/ligar respondem **503 "falta a migração 0029"**. Reversão no cabeçalho do arquivo.
  `supabase migration list` antes do push.
- **Variáveis:**
  - `CAIXA_IA_DOCUMENTO` (nova, opcional) — **deixe sem** até cumprir o que está abaixo.
    Ligada = `ligada`.
  - `GEMINI_API_KEY_CAIXA` (nova, opcional, **recomendada** pelo `escudo`) — chave do
    Gemini **do plano pago** só para esta função; sem ela usa a `GEMINI_API_KEY` da
    plataforma (a mesma da folha de ponto). `GEMINI_MODELO` vale para as duas.
- **Antes de ligar em produção** (decisão do dono + parecer do `escudo`):
  1. **Política de privacidade** (`app/(site)/privacidade/page.tsx`, hoje só cita IA na
     Folha de Ponto, linhas ~43-45) precisa dizer — texto para o **jurídico**: (a) no Livro
     Caixa, notas, recibos, boletos e comprovantes enviados podem ser lidos por IA para
     propor o lançamento, e esses documentos podem conter nome, CPF e endereço de terceiros;
     (b) quem lê é o **Google Gemini**, como suboperador, só para montar a proposta;
     (c) a leitura é **opcional por empresa**, ligada pelo escritório, e empresas de saúde
     ficam de fora; (d) a **transferência internacional** (seção ~57) e a lista de
     suboperadores (~52, ainda com "[endereço...]") passam a cobrir este uso. Retenção e
     uso para treino dependem do contrato da API paga — **o jurídico confirma**.
  2. **Gemini no plano pago** (no gratuito o Google pode usar o que é enviado). Nada de
     documento real no gratuito.
  3. **Aceite da Edilse** (ela tinha decidido "não anexa") e aviso ao escritório
     (controlador) de que os documentos dos clientes dele passam pelo Google.
  4. Então `CAIXA_IA_DOCUMENTO=ligada` (e, de preferência, `GEMINI_API_KEY_CAIXA`). Mesmo
     assim nada muda até a contabilidade ligar empresa por empresa.
- **O que testar em produção com conta de teste** (escritório criado em `/criar-conta`,
  empresa de teste **sem** "identifica pagador"; **nunca** nas empresas da Edilse nem com
  documento real de cliente):
  1. Sem a variável: o botão "Ler documento" não aparece; em Documentos (painel do caixa)
     não há a seção de IA; `POST /api/caixa/documento-ia` → 503.
  2. Com a variável: como contador, Livro Caixa › Documentos › ligar "A IA pode ler os
     documentos desta empresa". O botão aparece (para o contador e para o cliente da empresa).
  3. Como cliente: "Ler documento" → enviar a foto de um recibo de teste (categoria Recibo)
     → o formulário vem preenchido, com o aviso de rascunho e o toast **Desfazer** (volta
     ao que estava). Conferir e **Lançar** → o lançamento aparece com o ícone do anexo, que
     abre o arquivo. O documento também aparece em `/documentos`.
  4. "Já enviado em Documentos" lista só foto/PDF de nota, recibo ou outros (extrato e
     folha não aparecem).
  5. `select origem, situacao, empresa_id from ponto_leituras_ocr order by criado_em desc
     limit 5;` → a leitura com `origem = 'documento'` e `situacao = 'concluida'`; a cota do
     ponto (`GET /api/extrair?empresa=`) contou a leitura.
  6. Isolamento: logado em outro escritório, `POST /api/caixa/documento-ia` com a empresa
     de teste → 403; com uma empresa sua e o id do documento de teste → 404. Cliente: `PATCH
     /api/caixa/documento-ia` → 403. Empresa com "identifica pagador" → a seção diz "não
     disponível" e o POST responde 403.
  7. PDF com senha → "Salve o PDF sem senha" (415) e nada contado na cota.
- **Não verificado no navegador** nesta etapa (não há ambiente local com banco; o único
  `.env.local` aponta para produção). typecheck, lint, testes e build verdes.

**Pendências / próximos passos:**
- **[Aberto — jurídico/fundador]** política de privacidade, suboperador, Gemini pago e
  aceite da Edilse (acima) antes de ligar.
- Releitura do mesmo documento conta de novo na cota (sem aviso "já lido"). Se virar
  custo, guardar a última proposta por documento.
- ~~XML de NF-e não passa pela IA (fica fora da lista); um leitor determinístico do XML
  seria o próximo passo~~ → **feito na Sprint 17** ("Nota e boleto sem IA", abaixo).
- HEIC fora da IA (metadados). Se o iPhone mandar HEIC pelo seletor de arquivo, a tela
  avisa; converter no navegador seria a saída (o `sharp` pré-compilado não abre HEIC).
- O ritmo por usuário é em memória (por instância); o que segura de verdade são a cota
  do escritório e a subcota da empresa, no banco.
- ~~A subcota do cliente (30/mês) conta **todas** as leituras de documento daquela empresa,
  inclusive as que a contabilidade fez; e é conferida antes da reserva, não de novo depois~~
  → **resolvida na Sprint 13** (abaixo): conta só as do cliente e reconta depois da reserva.
- ~~Tirar o EXIF leva junto a orientação: foto tirada "deitada" chega girada à IA~~ →
  **resolvida na Sprint 13** (abaixo): a rotação é aplicada nos pixels antes.
- Reconferido pelo `escudo` depois das correções: **aprovado com ressalvas**, nada no código
  impede ligar; o que bloqueia é o jurídico (política e suboperadores) e o Gemini pago.

### ✅ Acabamentos de IA e tela — 21/11/2026 (Sprint 13, Frente B)

Fecha as duas ressalvas do `escudo` na leitura de documentos e o gráfico do Demonstrativo
no celular. **Sem migração** (nenhuma coluna nova — a 0031 reservada não foi usada).

**1. Foto girada.** O celular grava a foto deitada e marca no EXIF "gire 90°"; tirar o EXIF
(minimização) levava a marca junto e a foto chegava girada ao Gemini. Agora
`lib/fotoParaIa.ts` lê a orientação (`orientacaoExif`, puro, em
`lib/documentoLancamento.ts`: JPEG, PNG e WEBP) e, se não for 1, aplica a rotação **nos
pixels** com o `sharp` (os 8 casos, com espelho) e recodifica (JPEG/WEBP qualidade 90; a
saída do sharp não leva EXIF, XMP nem ICC) — só então `imagemSemMetadados` passa por cima.
Orientação 1 não recodifica (nada de perda). Se o sharp faltar ou falhar, a foto segue
como antes (pode chegar deitada) e loga `[foto-ia]` — a leitura nunca trava. Usado por
`prepararParaIa` (caixa) e por `extrairFolha` (`lib/ocr.ts` — Timesheet e envio do
cliente; ver [`folha-de-ponto.md`](folha-de-ponto.md)). HEIC continua de fora (o sharp
pré-compilado não abre). Teste com imagens geradas no próprio teste, orientações 1, 3, 6
e 8 (+ PNG e WEBP): `tests/fotoParaIa.test.ts`.

**2. Subcota do cliente só com as leituras do cliente.** Quem leu já ficava em
`ponto_leituras_ocr.usuario` (o e-mail); agora a leitura do **cliente** grava
`cliente-documento:<e-mail>` (`leitorDaLeitura`, prefixo `PREFIXO_LEITURA_CLIENTE`) e
`contarLeiturasDocumentoDoCliente` (era `contarLeiturasDocumentoEmpresa`) filtra por ele.
As leituras da contabilidade na empresa gastam só a cota do escritório. O prefixo **não**
começa por `cliente:` de propósito: esse é o das leituras automáticas da folha
(`lib/envioPontoServidor.ts`, teto por empresa e ritmo próprio), que não devem contar as
do caixa. **Corrida fechada** como na cota do escritório: confere antes, reserva e reconta
depois da reserva — passou de 30, desfaz a própria reserva e responde 429. Numa rajada
exatamente no limite os dois pedidos podem desistir (conservador; o cliente tenta de novo).
Leituras de cliente feitas **antes** desta versão ficaram com o e-mail puro e não contam
na subcota do mês em que ela entrar (a função está desligada em produção; impacto nulo).

**3. Gráfico do Demonstrativo no celular.** `app/(app)/caixa/demonstrativo/Grafico.tsx`
tinha `viewBox` fixo de 640 px (fonte 11 encolhia a ~6 px no celular). Agora reaproveita
`useLargura` (exportado de `resumo/Graficos.tsx`) e `geometria()` de `resumo/geometria.ts`,
que ganhou `meses` (a série tem até 12 meses, sem começar em janeiro) e `minFaixa` (40 px,
porque o rótulo pode levar o ano, "jan/26"). Eixo e meses em 12 px de verdade; faltando
espaço, os meses alternam **a partir do fim** (`mostraPosicao`) — o mês do demonstrativo
sempre tem rótulo — e, em tela muito estreita (~300 px com 12 meses), um a cada três. O
ano vai em janeiro e no primeiro rótulo visível. Teste em `tests/graficosResumo.test.ts`.

#### Para o integrador

- **Sem migração.** Nada a aplicar; a 0031 continua livre.
- **Dependência:** `sharp` (^0.34.5) passou a dependência **direta** em `package.json` —
  já vinha instalado como opcional do Next (mesma versão), então o lockfile mudou só a
  marca `optional`. Na Vercel (Linux x64) o binário pré-compilado entra com o `npm ci`; o
  Next já trata o `sharp` como pacote externo do servidor. `npm ci` depois do merge.
- **Conflitos prováveis:** `lib/pontoDb.ts` (renome da função de contagem),
  `app/api/caixa/documento-ia/route.ts`, `lib/ocr.ts` e `resumo/geometria.ts` (o tipo do
  passo virou `1 | 2 | 3`).
- **O que testar com conta de teste** (nunca documento real): (a) foto de recibo tirada
  com o celular **em pé** → a proposta vem certa e, no log, nada de `[foto-ia]`; (b) como
  cliente, 30 leituras no mês → a 31ª dá 429; como contador na mesma empresa, a leitura
  passa e não mexe na conta do cliente (`select usuario from ponto_leituras_ocr where
  origem = 'documento' order by criado_em desc limit 5;` → as do cliente com
  `cliente-documento:`); (c) `/caixa/demonstrativo` a 375 px nos dois temas — eixo e
  meses legíveis, meses alternados, o mês do demonstrativo em negrito.
- **Não verificado no navegador** (sem banco local). typecheck, lint, testes e build verdes.

### ✅ Nota e boleto sem IA (0033) — 21/11/2026 (Sprint 17, Frente B)

Decisão do dono (`docs/empresa/ia-gratuita.md`, item 2): **documentos primeiro sem IA** —
o que dá resultado exato é lido no servidor, custo zero, nada sai. É a ideia 4 de
`docs/empresa/concorrentes.md`. Mesmo fluxo de rascunho da Sprint 12: **nada grava
sozinho**, quem lança confere e clica em **Lançar**, há **Desfazer**, e o lançamento fica
ligado ao documento.

**Como funciona.** No Livro Caixa, botão **Ler nota ou boleto** (secundário, no cabeçalho;
aparece para o cliente e para a contabilidade sempre que dá para lançar — empresa não
arquivada; **sem as travas da IA**). O diálogo (`app/(app)/caixa/LerNota.tsx`) oferece:
**arquivo da nota** (XML ou PDF, enviado ao portal pelo mesmo fluxo da Sprint 12 —
`enviarAoPortal`, exportado de `LerDocumento.tsx`), **já enviado em Documentos** (XML/PDF
de nota, recibo ou outros) ou **código do boleto** (digitado/colado). E "pagamento,
recebimento ou descobrir pelo documento". A rota devolve a proposta no formato da IA
(`PropostaDocumento` + `fonte`, `titulo`, `chave`, `detalhes`, pagador); a tela aplica com
`aplicarProposta` (o mesmo rascunho) e um aviso próprio: "Rascunho de NF-e 1234 — confira
antes de lançar", com o que foi lido (chave, série, vencimento, banco, de onde veio a
conta) e o que pede atenção.

| Fonte | Arquivo | O que lê | Entrada × saída |
|---|---|---|---|
| NF-e 55 / NFC-e 65 (layout 4.00, com ou sem `nfeProc`) | `lib/notaFiscalXml.ts` | `dhEmi`, `vNF`, emitente/destinatário (CNPJ/CPF, nome), número, série, chave (Id ou `chNFe`, DV conferido), parcelas (`dup`), `tPag 90`, `finNFe 4` | **pelo CNPJ/CPF da empresa** (`papelDaEmpresa`): emitiu = venda = entrada; recebeu = compra = saída; `tpNF 0` inverte; mesma raiz de CNPJ = matriz/filial (com detalhe) |
| NFS-e padrão nacional (`NFSe/infNFSe` + `DPS`) | idem | `dhEmi` da DPS, `vLiq` (líquido; `vServ` vai no detalhe se houver retenção), prestador (`emit`), tomador (`toma`), `nNFSe`, chave de 50 | prestou = entrada; tomou = saída |
| NFS-e ABRASF 1.0/2.0x (`CompNfse/Nfse/InfNfse`) | idem | `Numero`, `DataEmissao` (ou `Competencia`), `ValorLiquidoNfse` (ou `ValorServicos`), `PrestadorServico`/`Prestador`, `Tomador(Servico)`; `NfseCancelamento` = aviso | idem |
| Boleto bancário (47 / 44) e arrecadação (48 / 44, começa por 8) | `lib/boleto.ts` | todos os DVs (campos em módulo 10, geral em módulo 11; arrecadação em 10 ou 11 conforme o 3º número), valor, **vencimento pelo fator com a regra de 2025** (9999 = 21/02/2025, reinicia em 1000 = 22/02/2025; ciclo de 9.000 dias, vale o mais perto de hoje), banco (tabela COMPE) ou segmento | saída (ou o que quem lança marcou) |
| PDF com texto (`unpdf`, 3 primeiras páginas) | `lib/leituraSemIa.ts` + `lib/leituraSemIaServidor.ts` | 1º linha digitável válida → boleto; 2º chave de acesso válida (DANFE) → nota (mesma chave do XML); senão data e valor por **rótulos** ("Data do pagamento" > "emissão" > "Data:" > "vencimento"; "Valor total da nota/pago/importância de" > "Total" > "Valor"); sem rótulo, só se houver **um** valor com R$ e **uma** data no exercício | DANFE pelo CNPJ da chave; recibo: o que quem lança marcou (senão aviso) |

Regras de "não inventar": um dígito errado no boleto → 422 "o código não confere (campo 2…)
— confira o que foi digitado"; valor em aberto, fator 0 ou arrecadação sem vencimento →
campo em branco com aviso; data fora do exercício → em branco com aviso; duas datas ou
vários valores sem rótulo → em branco ("achei 01/03 e 05/03 e não sei qual é a do
pagamento — preencha"); PDF sem texto (escaneado) → `proposta: null` e "não dá para ler sem
IA, preencha à mão"; PDF com senha ou torto → 415. Confiança: XML e boleto 1; PDF 0,7 (0,5
se faltou data ou valor).

**Conta (nunca IA).** `comContaSugerida` roda `sugerirConta` (lib/sugestaoConta.ts) **no
servidor** com os exemplos de `exemplosDaEmpresa` e as contas/analíticas do recorte da
sessão — as mesmas fontes (a) analítica citada e (b) histórico da empresa. O complemento é
montado para casar com o histórico ("NF 1234 — Fornecedor LTDA"); sem sugestão segura (ou
sem direção) a conta fica em branco com "Escolha a conta". A faixa de sugestão da tela
continua valendo depois.

**Privacidade no complemento.** O nome da outra parte só entra quando ela é **empresa
(CNPJ)**. Pessoa física (CPF — cliente, paciente) fica fora do complemento; em empresa que
**identifica pagador** e numa entrada, o nome e o CPF vão para os campos de **pagador**
(Carnê-Leão/DMED). O complemento ainda passa por `mascararTexto`.

**Duplicidade (apontada antes de gravar).** A proposta traz `chave`: `nfe:<44>`,
`nfse:<50>`, `nfse:<CNPJ prestador>:<número>` (ABRASF) ou `boleto:<44>`. O POST de
lançamentos recebe `chaveDocumento` (só no formato `FORMATO_CHAVE`; o resto é ignorado) e
grava em `lancamentos.chave_documento` (0033). A rota de leitura procura, **só nos
exercícios da mesma empresa**, lançamentos com a mesma chave **ou** o mesmo `documento_id`
(`lancamentosDoDocumento`) e devolve `duplicados` + `duplicidadeVerificada`. A tela mostra o
aviso em tom de atenção (com data, complemento e valor do que já está no livro) e, ao clicar
em Lançar, pede confirmação ("Lançar mesmo assim", foco no Cancelar). Só aponta, não
bloqueia. A mesma nota no XML e no DANFE em PDF tem a mesma chave.

**Isolamento.** `POST /api/caixa/documento-leitura` (única rota nova, sob `/api/caixa`, que o
cliente já alcança — **sem mudança no `proxy.ts`**): `exigirSessao` + `motivoNegado` (cliente
só a própria empresa; contador só do escritório; arquivada barrada), e o documento tem que
ser da **mesma empresa**, passar em `podeVerRegistro` (escritório gravado = o da sessão),
estar recebido/conferido e não excluído — senão 404. Extrato e folha → 415; foto → 415
("lance à mão ou pela IA, se ligada"). Ritmo de 40 leituras/10 min por usuário (memória).
**Não usa** cota de IA, `CAIXA_IA_DOCUMENTO`, a opção da empresa nem a regra de saúde —
nada sai do servidor (o teste de rota vigia `fetch` e falha se houver chamada de rede).

**Leitor de XML** próprio, sem dependência: recusa `<!DOCTYPE`/`<!ENTITY` (sem XXE nem
expansão de entidades), limite de 5 MB, 100 mil nós e 64 níveis; ignora prefixos de
namespace.

**Arquivos.** Novos: `lib/boleto.ts`, `lib/notaFiscalXml.ts`, `lib/leituraSemIa.ts` (puros),
`lib/leituraSemIaServidor.ts` (texto do PDF e duplicidade),
`app/api/caixa/documento-leitura/route.ts`, `app/(app)/caixa/LerNota.tsx`,
`supabase/migrations/0033_lancamento_chave_documento.sql`, `tests/leituraSemIa.test.ts`
(boleto com as contas à mão nos comentários; XMLs e PDFs gerados no teste) e
`tests/leituraSemIaRotas.test.ts`. Alterados: `app/api/caixa/lancamentos/route.ts`
(`chaveDocumento`), `app/(app)/caixa/page.tsx` (botão, rascunho de duas origens,
confirmação de duplicado, pagador no rascunho), `app/(app)/caixa/LerDocumento.tsx`
(`enviarAoPortal` e `lerJson` exportados, sem mudar o comportamento), `lib/medicaoRotas.ts`
(rota nova na lista fechada), `next.config.ts` (`serverExternalPackages: ["unpdf"]`) e
`package.json`.

#### Para o integrador

- **Migração `0033_lancamento_chave_documento.sql`** (só o arquivo; **não aplicada**).
  Aditiva: `lancamentos.chave_documento text` (check de formato) + índice parcial
  `(chave_documento, exercicio_id)`. Depende só da 0002. **Ordem livre:** sem ela o POST de
  lançamentos detecta a coluna ausente (42703) e grava de novo **sem a chave**; a leitura
  devolve `duplicidadeVerificada: false` quando não pôde procurar pela chave (o mesmo
  documento do portal continua sendo achado pela `documento_id` da 0029). Reversão no
  cabeçalho. `supabase migration list` antes do push.
- **Dependência nova:** `unpdf` **1.4.0** (MIT, fixada sem `^`: as 1.8+ pedem Node ≥ 22 e o
  CI roda Node 20). Embute o pdf.js, sem binário nativo; `serverExternalPackages` o deixa
  fora do bundle e o trace da Vercel o inclui (`route.js.nft.json`). `npm ci` depois do merge.
- **Sem variável nova**, sem mudança no `proxy.ts` e sem cota.
- **Conflitos prováveis:** `app/(app)/caixa/page.tsx` (cabeçalho, `Rascunho`, `lancar`,
  `aplicarProposta`), `app/api/caixa/lancamentos/route.ts` (bloco do documento e o insert),
  `lib/medicaoRotas.ts` (lista de rotas) e `package.json`/lock. Não toquei em
  `app/(app)/documentos/**`, `lib/documentos*`, `/inicio`, sino, `meses_confirmados` nem ponto.
- **O que testar com conta de teste** (empresa de teste com CNPJ no cadastro; **nunca**
  documento real de cliente):
  1. Como cliente: **Ler nota ou boleto** → enviar um XML de NF-e de teste em que a empresa
     é destinatária → rascunho de **saída** com data de emissão, valor total e "NF nº —
     Nome"; **Desfazer** volta o formulário. Lançar → ícone de anexo no lançamento.
  2. Ler o mesmo XML de novo → aviso "já foi lançado" com a data e, ao Lançar, a
     confirmação. `select chave_documento from lancamentos order by criado_em desc limit 1;`
     → `nfe:…`.
  3. Um XML em que a empresa é **emitente** → entrada. Um XML de outra empresa → aviso "o
     CNPJ/CPF da empresa não aparece nesta nota".
  4. Colar a linha digitável de um boleto de teste → valor, vencimento e banco; trocar um
     número → "o código não confere".
  5. PDF de recibo gerado num editor (com "Valor pago" e "Data do pagamento") → data e
     valor; PDF escaneado → "não dá para ler sem IA".
  6. Isolamento: logado em outro escritório, `POST /api/caixa/documento-leitura` com a
     empresa de teste → 403; com uma empresa sua e o id do documento de teste → 404.
- **Não verificado no navegador** (sem banco local; o único `.env.local` aponta para
  produção). typecheck, lint, testes e build verdes.

**Pendências / próximos passos:**
- NFS-e de prefeituras fora do ABRASF (layouts próprios) não são reconhecidas — o XML
  responde "não é de nota fiscal". Somar o layout quando aparecer um real.
- Nota com várias parcelas vira **um** rascunho com o total e um aviso; propor uma parcela
  por vez (com o vencimento) seria o passo seguinte, se a contadora quiser.
- O código de barras desenhado (imagem) no PDF não é lido — só a linha digitável em texto.
- Foto de nota/recibo continua precisando de IA (decisão do dono: Workers AI, a fazer).
### ✅ Sprint 17 · Frente C — Mês fechado que trava (migração 0034)

**Mudança de decisão.** "Confirmar o mês" deixou de ser só a liberação do resumo: virou
**Fechar o mês**, que libera o resumo/Demonstrativo ao cliente **e trava** o mês. É a
ideia 5 de [`empresa/concorrentes.md`](empresa/concorrentes.md) ("o número que foi para o
cliente não muda depois"). As linhas "Edição sempre liberada" e "Confirmar não trava" da
tabela de decisões acima ficam **substituídas** por esta seção.

| Regra | Onde |
|---|---|
| Mês fechado (linha em `meses_confirmados`): nenhum lançamento é criado, alterado ou excluído — **nem pelo cliente, nem pela contabilidade**. 409 com a mensagem "Março/2026 está fechado pela contabilidade… a contabilidade reabre o mês informando o motivo." | `lib/caixa.ts` → `exigirMesAberto`, chamado em POST/PATCH/DELETE de `app/api/caixa/lancamentos` (no PATCH, o mês de origem **e** o de destino) |
| **Mês anterior a um fechado também trava**: o saldo dele é o saldo transportado do fechado (pareceres do `contador` e do `escudo`). Mensagem: "Abril/2026 está fechado e o saldo dele vem de Março/2026…" | `exigirMesAberto` olha `mes >= M` |
| Os meses **fecham em ordem** (janeiro primeiro): "Feche antes Janeiro/2026…" | POST `/api/caixa/meses` |
| **Reabrir** só a contabilidade, com **motivo** (5 a 500 letras). Reabrir um mês **reabre os fechados depois dele**, com o mesmo motivo registrado em cada um | DELETE `/api/caixa/meses` `{ empresa, ano, mes, motivo }` |
| Histórico: quem fechou, quem reabriu, quando e por quê — na tela (contabilidade), recolhido em "Histórico de fechamento" | `caixa_meses_historico` (0034); GET `/api/caixa/meses?empresa=&ano=` |
| Conferir/desmarcar lançamento **continua livre** no mês fechado (não muda o livro) | PATCH `{ id, conferido }` |
| Saldo inicial não muda com qualquer mês do ano fechado (muda o saldo transportado de todos) | PATCH `/api/caixa/exercicio` |
| Defesa no banco: gatilho `lancamentos_trava_mes_fechado` com a mesma regra (só `conferido_*` pode mudar; `pg_trigger_depth() > 1` só para DELETE em cascata) | 0034 |
| Tela: selo/cadeado no mês, aviso "está fechado" (cliente: "fale com a contabilidade"; contabilidade: "Reabrir o mês"), sem formulário, editar, excluir nem "Ler documento"; "Fechar o mês" desabilitado com mês anterior aberto; diálogo de reabrir com o motivo (`DialogoTexto` em `app/(app)/Dialogo.tsx`) | `app/(app)/caixa/page.tsx` |

O cliente vê só "mês fechado" — **não** vê quem fechou nem o motivo (GET de `/api/caixa/meses`
é `exigirGestor`). Reabrir esconde de novo o resumo/Demonstrativo do cliente (o fechamento é a
liberação). Testes: `tests/mesFechadoRotas.test.ts` (guardas reais) e `tests/mesFechado.test.ts`.

#### Para o integrador (Sprint 17 · C, caixa)

- **Aplicar a 0034 ANTES (ou junto) do código.** A trava vale assim que o código sobe (lê
  `meses_confirmados`, que já existe); sem a 0034, **reabrir responde 503** (o motivo não pode
  se perder) — todo mês hoje confirmado ficaria travado sem como reabrir. Fechar funciona sem
  ela (o histórico só não registra). `npx supabase migration list` antes de `db push`.
- **Atenção ao estado atual:** os meses já confirmados em produção (havia 3 em 21/11) passam a
  travar, **e os anteriores a eles também**. Avise a Edilse: para corrigir, "Reabrir o mês".
- Testar (conta e empresa de teste): fechar fevereiro com janeiro aberto → recusa; fechar
  janeiro → cliente e contadora não lançam/editam/excluem em janeiro (409), conferir funciona;
  fechar fevereiro → reabrir janeiro pede motivo e reabre os dois, histórico mostra os
  registros; saldo inicial bloqueado com mês fechado.
- **Gatilhos sem teste automático** (o banco falso não roda plpgsql): numa base de homologação,
  conferir à mão INSERT/UPDATE/DELETE em mês fechado (erro), UPDATE só de `conferido_*` (passa).

### ✅ Sprint 17 · Frente D — Extrato no caixa (migração 0035)

Ideia 2 de [`empresa/concorrentes.md`](empresa/concorrentes.md): importar o extrato **OFX** (e
**CSV** dos bancos, com mapeamento de colunas) no Livro Caixa de uma empresa e conciliar —
**sem serviço externo nem IA** (o arquivo é lido no servidor; o teste de rota proíbe `fetch`).

**Como funciona.** Livro Caixa › aba **Extrato** (só a contabilidade). A contadora escolhe a
empresa e o extrato — **arquivo do computador** ou **o OFX/CSV que o cliente mandou em
Documentos** — e clica em **Ler extrato**. Nada é gravado aí. A tela mostra:

| Bloco | O que é |
|---|---|
| **No banco e não no caixa** | cada linha vira a sugestão do que entra no livro, com a **conta analítica sugerida** (a mesma `sugerirConta` da caixaInteligente: analítica citada no histórico do banco, depois o histórico da empresa — o que ela confere passa a pesar mais). Por linha: **Lançar** (padrão), **Agora não** ou **Ignorar sempre**. Linha sem sugestão pede a conta (erro no campo, foco nele). |
| **Já no caixa** | casadas: mesma direção, mesmo valor, data **± 2 dias**, um-para-um (dois PIX iguais no banco e um no caixa = um casado, um novo); e as **importadas antes** (mesma chave). |
| **No caixa e não no banco** | no período do extrato, separado em **transferências sem par** (retirada/depósito de conta corrente que o banco não mostra — essas pedem atenção) e **outros** (pago/recebido em dinheiro — normal). |
| **Fora do caixa** | só no modo "dentro do caixa": saque e depósito em dinheiro, que aí não mudam o saldo. |

**Confirmação em lote** ("Lançar N linhas", a única ação primária da conferência) → toast com
**Desfazer** (apaga os lançamentos do lote e as marcas). As casadas ficam registradas no mesmo
lote para a próxima importação reconhecer.

**A regra da conta bancária (decisão desta frente).** A contadora definiu: *depósito no banco
= saída do caixa, retirada = entrada, cheque = dois lançamentos* — ou seja, a conta bancária
fica **fora** do caixa. O padrão (`par`) aplica a mesma lógica do cheque a toda linha do banco:

| Linha do banco | Vira no caixa |
|---|---|
| pagamento (débito: PIX, boleto, tarifa…) | "Retirada de conta corrente" (entrada, sem conta) + o pagamento (saída, conta sugerida) |
| recebimento (crédito: PIX, TED, cartão…) | o recebimento (entrada, conta sugerida) + "Depósito em conta corrente" (saída, sem conta) |
| saque (débito com "saque", "caixa eletrônico", `TRNTYPE ATM`) | só a retirada (entrada) |
| depósito **em dinheiro** (crédito com "dinheiro"/"espécie"/"envelope") | só o depósito (saída) |
| cheque (débito com "cheque", `TRNTYPE CHECK`) | retirada + pagamento, complemento "Cheque nº — …" (o atalho de cheque de sempre) |

O par é neutro no saldo: o caixa só muda com dinheiro vivo, e as receitas e despesas ficam no
livro. "DEPOSITO" sozinho é tratado como recebimento (pode ser cliente pagando). Como há dúvida
de verdade (o NÉLIO hoje lança pagamentos pelo banco sem a retirada), ficou **configurável por
empresa**, com o padrão atual: "A conta bancária fica" **Fora do caixa (padrão)** ou **Dentro
do caixa** (`direto`: uma perna por linha; saque/depósito em dinheiro ficam de fora). A pergunta
está em [`empresa/reuniao-edilse.md`](empresa/reuniao-edilse.md) (**L7**). Se o caixa já tem
só o pagamento, a linha vem **parcial**: "falta a Retirada de conta corrente" (Agora não, por padrão).

**Quem pode: só a contabilidade** (`exigirGestor` nas duas rotas; aba escondida do cliente, que
é redirecionado da tela para Lançamentos). Por quê: conciliar é o trabalho dela no módulo ("a
empresa lança, a contadora concilia"); a regra do banco ainda está em aberto com a Edilse e um
cliente lançando PIX em par (ou sem par) bagunçaria o saldo; e o extrato traz dados de
terceiros. O cliente continua mandando o OFX/CSV pelo **portal** (Documentos) e a contadora
importa de lá. `CLIENTE_PODE` não mudou (`/api/caixa/extrato*` está sob `/api/caixa`, e a
varredura `proxyCliente` exige — e encontra — `exigirGestor` numa rota que nenhuma tela do
cliente usa).

**Travas.**
- **Mês fechado** (Sprint 17 · C): linha de mês fechado (ou anterior a um fechado) vem
  **travada** ("mês fechado", sem Lançar) com aviso; o POST do lote confere **antes de gravar** e
  responde **409** com a mensagem de `lib/mesFechado.ts`; desfazer um lote de mês fechado depois
  também dá 409. **Casar** e **Ignorar** passam (não mudam o livro). O gatilho da 0034 continua
  como defesa.
- **Empresa arquivada:** ler/confirmar/desfazer dão **409** para a contabilidade (o POST de
  leitura conta como escrita no `motivoNegado`: não se importa extrato em empresa arquivada); o
  cliente dela, 403.
- **Catálogo:** cada perna passa por `validarLancamento` e `exigirCatalogoVisivel` (conta de outro
  escritório → 400). Lançamento citado como "casado" tem que ser da empresa (400); desfazer só
  apaga lançamentos da empresa.
- **Não duplica:** (1) casamento por data ± 2 e valor com o que já está no livro; (2) a **chave**
  da linha — `ofx:` + hash de banco|conta|**FITID**|data|valor|lado (sem FITID, do histórico), ou
  `csv:` + hash de data|valor|lado|histórico|documento, com `#2`, `#3` quando a mesma linha se
  repete no arquivo — gravada em `caixa_extrato_linhas` com `unique (empresa_id, chave)`. As
  marcas são **reservadas antes** dos lançamentos (clique duplo/outra aba → 409, nada gravado);
  se o insert dos lançamentos falhar, as marcas saem.
- **Privacidade:** o histórico do banco vai para o complemento com CPF (inclusive o mascarado
  `***.456.789-**`), números de 11+ dígitos e e-mail trocados por marcador; a conta aparece só
  como "Banco 341 · conta final 7654". Nada sai do servidor.
- Limites: 2 MB e 5.000 linhas por arquivo, 500 linhas por lote, 30 leituras/10 min por usuário
  (memória).

**Leitores.** OFX 1.x (SGML, folhas sem fechar) e 2.x (XML), Windows-1252 declarado ou UTF-8,
valor com ponto ou vírgula, valor sem sinal com `TRNTYPE` de débito (avisa), `NAME`+`MEMO`,
`CHECKNUM`, período `DTSTART/DTEND`. CSV: separador detectado (`;` `,` tab `|`), aspas,
preâmbulo antes do cabeçalho (Itaú), cabeçalho reconhecido pelos nomes comuns (Data, Lançamento,
Histórico, Descrição, Valor, Crédito, Débito, D/C, Documento; "Saldo" nunca), valor assinado,
crédito/débito separados ou valor + D/C, "1.234,56", "R$ 100,00 D", "(50,00)", "100,00-", linhas
de saldo puladas. Cabeçalho desconhecido → 422 com as colunas e uma amostra, e a tela pede o
**mapeamento** (Data, Histórico, Valor/Tipo ou Crédito/Débito, Documento).

**Arquivos.** Novos: `lib/extratoBancario.ts` (puro: leitores, classificação, pernas,
conciliação, lote), `lib/extratoServidor.ts` (modo, marcas, período, meses fechados),
`app/api/caixa/extrato/route.ts` (GET/PATCH modo, POST leitura),
`app/api/caixa/extrato/lote/route.ts` (POST confirmar, DELETE desfazer),
`app/(app)/caixa/extrato/page.tsx`, `supabase/migrations/0035_extrato_caixa.sql`,
`tests/extratoBancario.test.ts`, `tests/extratoCaixaRotas.test.ts`. Alterados:
`app/(app)/caixa/AbasCaixa.tsx` (aba Extrato, só gestor), `lib/medicaoRotas.ts` (rotas e tela
novas), `tests/bancoFalso.ts` (`.or()` para o filtro do catálogo). **Não toquei** em
`lib/caixa.ts`, `lib/ia/**`, `lib/ocr.ts`, `lib/documentoLancamento*`, `lib/cadastro.ts`, `proxy.ts`
nem na rota de lançamentos.

#### Para o integrador (Sprint 17 · D)

- **Migração `0035_extrato_caixa.sql`** (só o arquivo; **não aplicada**). Aditiva:
  `caixa_extrato_linhas` (marcas por chave, `unique (empresa_id, chave)`, lote, ids dos
  lançamentos, data/valor/lado/histórico mascarado) e `caixa_extrato_config` (modo por empresa,
  padrão `par`), as duas com RLS sem policies e FK composta `(empresa_id, escritorio_id)`.
  Depende de 0002 e 0012. **Ordem livre:** sem ela a importação lê e lança (o casamento por
  data/valor já evita duplicar o que foi lançado), mas não lembra "Ignorar sempre", não marca as
  casadas, o modo fica no padrão (mudar → **503**) e o Desfazer usa os ids guardados na tela.
  Reversão no cabeçalho. `npx supabase migration list` antes do `db push`. Se outra frente tiver
  ocupado a 0035 na integração, renomeie para o próximo número livre (o conteúdo não depende dele).
- **Sem variável nova, sem dependência nova, sem mudança no `proxy.ts`.**
- **Conflitos prováveis:** `lib/medicaoRotas.ts` (listas), `app/(app)/caixa/AbasCaixa.tsx` e
  `tests/bancoFalso.ts` (método `or` novo, antes de `lt`).
- **O que testar com conta de teste** (empresa de teste; **nunca** extrato real de cliente):
  1. Livro Caixa › **Extrato** aparece só para a contabilidade; como cliente, `/caixa/extrato`
     volta para Lançamentos e `POST /api/caixa/extrato` dá 403.
  2. Importar um OFX de teste com um PIX recebido, um boleto pago, um saque e um "DEP DINHEIRO":
     o PIX vira recebimento + depósito; o boleto, retirada + pagamento (com a conta sugerida se o
     histórico citar uma analítica); o saque, só a retirada; o depósito em dinheiro, só o depósito.
  3. Lançar em lote → os lançamentos aparecem em Lançamentos; **Desfazer** apaga todos. Lançar
     de novo e reimportar o mesmo arquivo → tudo "importada antes"; `select chave, situacao from
     caixa_extrato_linhas order by criado_em desc limit 5;`.
  4. Um lançamento já digitado (mesmo valor, data a 1–2 dias) → casa; uma venda em dinheiro do
     período → "No caixa e não no banco".
  5. Fechar janeiro → as linhas de janeiro vêm "mês fechado" e o lote com elas dá 409.
  6. Trocar "A conta bancária fica" para **Dentro do caixa** → uma perna por linha, saque "fora do
     caixa". Voltar para o padrão.
  7. CSV de teste nos formatos Itaú/BB/Nubank → colunas reconhecidas; um CSV com cabeçalho
     estranho → a tela pede o mapeamento.
- **Não verificado no navegador** (sem banco local; o único `.env.local` aponta para produção).
  typecheck, lint, testes e build verdes.

**Pendências / próximos passos:**
- **[Aberto — Edilse, L7]** confirmar o modo `par` como padrão, ou restringir a saque/depósito, ou
  ligar "Dentro do caixa" por empresa.
- Empresa que **identifica pagador** (NÉLIO): o recebimento importado vem sem nome/CPF de quem
  pagou — a revisão já acusa "Falta o pagador". Puxar o nome do PIX do histórico seria possível,
  mas é dado de terceiro; fica para quando ela pedir.
- PDF de extrato não é lido (sem IA, só texto, e os layouts variam) — OFX/CSV cobrem os bancos.
- A conta sugerida aprende com o que ela confere: os lançamentos importados levam o histórico do
  banco no complemento, então a próxima importação casa melhor com os conferidos.

## Estado do banco

Migrações `0000`–`0006` aplicadas (04/09/2026): `0004` trouxe **empresas** e
**usuarios** do Sheets para cá (tabelas novas, `lib/cadastro.ts`); `0005` juros/multa
nos lançamentos; `0006` `tipo_pessoa` nas empresas; `0007` (flag
`identifica_pagador` + `pagador_nome`/`pagador_documento`). A **`0008`**
(`empresa_historicos` — a lista de analíticas por empresa) foi **aplicada em
11/09/2026** (`db push --linked`). Na ocasião o `migration list` do remoto mostrou
a **0007 já aplicada** (a doc antes dizia pendente — estava desatualizada); só a
0008 subiu. `supabase migration list` bate com a pasta até a 0008. O CLI está
**logado na conta certa e linkado** ao projeto `zxjeibkttmacpuukvyzo`, então daqui
para a frente `npx supabase db push` resolve — não precisa mais colar SQL no
dashboard. A `0003` criou `empresa_fiscal` (fiscal estável 1:1 por empresa).

Conteúdo (11/09/2026, após a padronização): 118 contas no catálogo e **6 analíticas**
em `historicos_padrao`, todas vinculadas ao NÉLIO (Recebido Atendimento, Pago conta de
luz, Pago material de expediente, Pago aluguel do escritório, Prótese, Pago material de
consumo). Os 24 históricos padrão originais do seed foram apagados na faxina anterior.
Há **46 lançamentos**, todos do NÉLIO (`225646d6-47f2-4a35-b9d1-cedc779723ce`),
exercício 2026 — os 11 órfãos de empresas de teste foram excluídos. (Versões anteriores
desta doc diziam "nenhum lançamento ainda"; estava desatualizado.)

Para repovoar o catálogo padrão: `POST /api/caixa/seed` (master) recarrega as 118
contas e recria os históricos de `lib/planoContasPadrao.ts` — mas atenção, ele
**apaga e recria** `historicos_padrao` inteiro, então levaria embora a
"Recebido Atendimento" criada à mão.

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

- **~~Empresa sem dono é visível a todo contador~~ — removida (multi-escritório).**
  Desde a migração `0010` a visibilidade é por **escritório**, não por `contador`:
  o contador vê as empresas do escritório dele; empresa sem escritório só o master
  vê. Ver [`multi-escritorio.md`](multi-escritorio.md). O catálogo do caixa
  (`plano_contas`, `historicos_padrao`) é base + extensão por escritório desde a
  migração `0013` (ver "Catálogo por escritório (0013)").

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
- ~~Modo escuro quebrado~~ — **resolvido (Sprint 2, frente D)**: papéis de cor
  redefinidos para o escuro em `app/globals.css`, seletor claro/escuro/automático no
  menu do usuário. Ver `docs/identidade-visual.md` ("Tema escuro").
