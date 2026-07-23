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
| Lista de contas | Só as contas **daquela empresa**, com **barra de pesquisa** |
| Catálogo | Ela **padroniza um só**; cada empresa usa um subconjunto. Só ela cria conta nova |
| Comprovantes | **Não** anexa e **não** tem OCR — o administrativo digita, o papel fica na empresa |
| Nº do documento | **Não** quis o campo |
| Históricos | **Padronizados**, lista pronta para escolher |
| Edição | **Sempre** editável e excluível, inclusive retroativo |
| Saldo negativo | Só **avisa**, não bloqueia |
| Saldo de janeiro | Vem do **encerramento do ano anterior** (2026 é o 1º ano: digitado) |
| Confirmar o mês | **Não trava a edição** — libera o balanço para o cliente ver |
| Balanço | **Mês a mês** e anual |
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

### ⬜ Fase 3 — Tela de lançamentos (próxima)

Onde o administrativo lança e a contadora acompanha.

- Tela por mês, no formato da planilha: DATA · HISTÓRICO · COMPLEMENTO · CONTA · ENTRADA · SAÍDA · SALDO
- **Busca no plano de contas** (decisão dela); sem o teto de 51 linhas do Excel
- Saldo corrido ao vivo e saldo transportado entre os meses
- Aviso (não bloqueio) quando o saldo fica negativo
- Atalho para o lançamento duplo de cheque
- Visão da contadora: acompanhar, marcar conferido, confirmar o mês
- Aviso para ela quando uma empresa lança

**Decisão tomada por falta da lista por empresa:** a busca varre o catálogo
inteiro (118) por padrão e as contas já usadas pela empresa sobem para o topo.
Quando ela quiser enxugar, faz-se a tela de seleção. Isso evita uma etapa de
configuração de 5 empresas × dezenas de contas antes do primeiro lançamento.

### ⬜ Fase 4 — Balanço e conciliação

Depende do **de-para** (ver pendências).

- Balanço financeiro mensal e anual, montado a partir de `plano_contas.linha_balanco`
- Só visível ao cliente depois do mês confirmado
- Gráfico

### ⬜ Fase 5 — Documentos

- PDF do **livro inteiro** com folhas numeradas (reusa o padrão de `lib/folhaPonto.ts`)
- Termos de abertura e encerramento
- `.xlsx` no formato da planilha dela (reusa o padrão de `lib/planilha.ts`)

## Pendências com a contadora

1. **De-para plano de contas × Balanço Financeiro** — trava a Fase 4.
   O modelo de balanço dela tem ~34 linhas para 118 contas: **64 encaixaram, 54
   não**. Faltam linhas para Aluguel, IRPJ, CSLL, COFINS, PIS, ISSQN, IPTU,
   combustível, viagens, publicidade e contribuições sindicais.
   Planilha de revisão gerada em `GET /api/caixa/de-para`.
   **A pergunta certa não é "classifique as 54"** e sim *"posso acrescentar 5
   linhas ao seu balanço — Aluguel, Tributos Federais, Tributos Municipais,
   Despesas com Pessoal e Despesas Gerais?"*
2. **Saldo inicial de janeiro/2026 das 5 empresas** — um número por empresa. Sem
   isso começa em zero (campo editável).
3. **Dados cadastrais das 5 empresas** para o Termo de Abertura — trava a Fase 5.
   Razão social, endereço e número, município/UF, registro na Junta e sob qual
   número, CNPJ, inscrição estadual, inscrição municipal, prefeitura, cidade do
   termo (Belém ou Castanhal), número do livro e número de ordem.

## Armadilhas conhecidas

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
