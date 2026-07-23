# Livro Caixa — estado do módulo

> Documento de continuidade. Se você é um agente entrando agora no projeto, **leia
> este arquivo antes de mexer no módulo do caixa**: ele guarda as decisões, o que
> já está pronto e o que falta. Mantenha-o atualizado ao fim de cada etapa.

Última atualização: **23/07/2026**

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
| `usuario` (contabilidade) | todas as empresas | folha de ponto e conciliação do caixa |
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

### ✅ Fase 4 — Resumo do exercício

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

### ⬜ Fase 5 — Documentos (próxima)

- PDF do **livro inteiro** com folhas numeradas (reusa o padrão de `lib/folhaPonto.ts`)
- Termos de abertura e encerramento
- `.xlsx` no formato da planilha dela (reusa o padrão de `lib/planilha.ts`)

## Pendências com a contadora

1. **Saldo inicial de janeiro/2026 das 5 empresas** — um número por empresa. Não
   trava nada: o exercício nasce com zero e a contabilidade edita o saldo pelo
   link "editar" ao lado de "Saldo inicial do exercício", na própria tela do
   caixa.
2. **Dados cadastrais das 5 empresas** para o Termo de Abertura — trava a Fase 5.
   Razão social, endereço e número, município/UF, registro na Junta e sob qual
   número, CNPJ, inscrição estadual, inscrição municipal, prefeitura, cidade do
   termo (Belém ou Castanhal), número do livro e número de ordem.

### ✅ Resolvida: o de-para

Ela **validou** o mapeamento como estava e **dispensou** as 5 linhas novas que
seriam acrescentadas ao Balanço Financeiro. Motivo dela: *é um livro caixa, ela
só analisa o saldo final — o que entrou, o que saiu e o saldo de um mês para o
outro*. As 54 contas sem linha ficam sem linha mesmo.

Consequência prática: a Fase 4 encolheu e nada mais depende desta pendência.
A planilha de revisão (`GET /api/caixa/de-para`) segue disponível caso ela mude
de ideia.

## Armadilhas conhecidas

- **A migração `0001` ficou pela metade no banco — e a `0002` ainda não foi
  aplicada.** Descoberto em 23/07/2026, ao começar a Fase 3: `plano_contas`
  (118 linhas), `empresa_contas`, `historicos_padrao`, `exercicios` e
  `meses_confirmados` existem, mas **`lancamentos` e a view `resumo_mensal`
  não** — o Postgres responde `relation "lancamentos" does not exist` até dentro
  de `saldo_final_exercicio()`. Sem a tabela, a tela do caixa não grava nada.
  **Rode `supabase/migrations/0002_lancamentos_e_conferencia.sql` no SQL Editor
  do Supabase.** Ela é idempotente e recria o que falta, além de acrescentar as
  colunas de conferência. Enquanto não for aplicada, `/caixa` mostra um aviso
  explicando isso em vez de estourar erro cru.
  Não dá para aplicar daqui: o `supabase` CLI da máquina está logado em **outra
  conta** (o projeto `zxjeibkttmacpuukvyzo` não aparece em `supabase projects
  list`) e o `.env.local` só tem as chaves da API, não a senha do banco — e
  PostgREST não roda DDL.
- **Duas cópias do projeto.** A pasta obsoleta `Desktop\sistema contadora` foi
  apagada em 23/07/2026. Se aparecer de novo, não trabalhe nela. Se um teste der
  resultado estranho (rota nova em 404, mudança que "não pegou"), confirme qual
  pasta o servidor de dev está servindo antes de investigar o código:
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Select ProcessId, CommandLine`
- **`SESSION_SECRET` é obrigatório.** Sem ele o cookie de sessão é assinado com um
  padrão embutido no código e qualquer um forja uma sessão de master. Já definido
  no `.env.local` e na Vercel.
- **`APP_USER`/`APP_PASSWORD` não são lidos por nada** — `lib/config.ts` lê
  `MASTER_EMAIL`/`MASTER_PASSWORD`. Podem ser removidos do `.env.local`.
- **Cota do Google Sheets.** Cada rota chama `garantirAbaHeader`, que faz
  `spreadsheets.get` + `values.update` **antes de qualquer leitura** — ~3 chamadas
  por request, uma delas de escrita. Um teste com ~85 requisições estourou a cota
  de 60/min e devolveu 502. Vale enxugar se o módulo de ponto crescer.
- **Modo escuro quebrado.** `app/globals.css` define fundo preto via
  `prefers-color-scheme`, mas todos os componentes assumem tema claro. Afeta o app
  inteiro, é anterior a este módulo.
