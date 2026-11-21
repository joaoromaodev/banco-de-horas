# Caixa para o cliente — alerta de limite e Demonstrativo mensal (Sprint 8 · Frente C)

> Duas entregas sobre o Livro Caixa: (1) um **alerta de limite de faturamento**
> (MEI e Simples Nacional), na tela do caixa da empresa e no painel do contador;
> (2) o **Demonstrativo de caixa** do mês confirmado, com prévia para a contadora
> e envio por e-mail ao cliente. Leia antes [`livro-caixa.md`](livro-caixa.md)
> (regra do mês confirmado) e [`painel.md`](painel.md).

## Onde está

| Peça | Arquivo |
|---|---|
| Regras do limite (puras; valores legais e vigência num só lugar) | `lib/limiteFaturamento.ts` — testes em `tests/limiteFaturamento.test.ts` |
| Leitura do caixa para o limite (só leitura) | `lib/limiteFaturamentoServidor.ts` |
| Rotas do limite | `app/api/caixa/limite/route.ts` (GET empresa; PUT abertura, só gestor) · `app/api/painel/limite/route.ts` (gestor) |
| Cartão na tela do caixa (cliente e contadora) | `app/(app)/caixa/LimiteFaturamento.tsx` (montado em `caixa/page.tsx`) |
| Bloco do painel | `app/(app)/painel/LimiteFaturamento.tsx` (montado em `painel/page.tsx`, depois do fechamento) |
| Regras do demonstrativo (puras; comparações, ranking, e-mail) | `lib/demonstrativo.ts` — testes em `tests/demonstrativo.test.ts` |
| Leitura + registro de envio | `lib/demonstrativoServidor.ts` |
| Rotas do demonstrativo | `app/api/caixa/demonstrativo/route.ts` (GET) · `.../enviar/route.ts` (POST, só gestor) |
| Tela (prévia da contadora = visão do cliente) | `app/(app)/caixa/demonstrativo/page.tsx` + `Grafico.tsx`; aba **Demonstrativo** em `caixa/AbasCaixa.tsx` |
| Migração | `supabase/migrations/0023_demonstrativo_cliente.sql` (**não aplicada**) |

Sem cron novo (o plano Hobby da Vercel tem poucos): o envio é disparado pela contadora, da prévia.

## Alerta de limite de faturamento

### Regras (estimativa — nunca conclui sozinho)

| Tema | Regra |
|---|---|
| Quem entra | Só empresas com regime **MEI** ou **Simples** em `empresa_regime` (0018). Presumido, pessoa física e sem regime: sem alerta (o bloco nem aparece). |
| O que se soma | **Entradas** classificadas em conta de natureza `receita`. Ficam de fora entradas **sem conta** (retirada de conta corrente / perna do cheque — transferência não é faturamento) e as classificadas em conta de despesa (estorno). Inclui receitas financeiras, aluguéis e recuperações (lado conservador). |
| MEI | Receita do **ano-calendário** contra **R$ 81.000**. No ano de abertura: **R$ 6.750 × meses** (mês de abertura conta inteiro, até dezembro) — precisa da data de abertura (abaixo). |
| Simples | **Limite de R$ 4,8 mi** e **sublimite de R$ 3,6 mi** (ICMS/ISS) contra a receita do **ano-calendário** (janeiro até o mês corrente). A **faixa atual** da tabela usa os **12 meses terminando no mês corrente** (aproxima a RBT12; inclui o mês em andamento) e avisa quando chega a 90% do teto. No ano de início: R$ 400 mil × meses (sublimite R$ 300 mil × meses). Empresa com menos de 12 meses: faixa por média × 12. |
| Níveis | < 80% **ok** · 80–100% **atenção** · acima de 100% **excedido** · acima de **120%** **retroativo**. Até 20% de excesso: MEI desenquadra e Simples exclui/tira ICMS-ISS do DAS **a partir de 1º de janeiro do ano seguinte**. Acima de 20%: **MEI** retroage a 1º de janeiro (ou à abertura); **Simples** (empresa que já tinha mais de um ano) vale **a partir do mês seguinte ao excesso** — só retroage ao início da atividade no **ano de início**. Exatamente 100% ainda é "atenção", não "excedido". |
| Texto | Sempre "Estimativa pelo caixa — confirme com a contabilidade". Fala de consequência ("em geral…", "se confirmado…"), nunca decreta. |
| Caixa que começou depois | Se o caixa só tem dados a partir de um mês dentro da janela, o alerta marca **incompleto** e diz desde quando ("a soma pode estar abaixo do real"). O limite e o sublimite olham o ano-calendário, então com o caixa desde janeiro de 2026 não ficam incompletos; só a faixa (12 meses) ganha uma ressalva até dez/2026. |
| LC 238/2026 | A revisão do contador informou que a LC 238/2026 (21/10/2026) sobe o teto do MEI para **R$ 110 mil em 2027** e **R$ 140 mil a partir de 2028** (proporcional = valor ÷ 12 por mês). Entraram como vigências futuras em `VIGENCIAS` (`fonte` diz "conferir"): **confirme o texto final da lei, sobretudo o valor e as condições de 2028**, antes de 2027. 2026 segue R$ 81 mil. |
| Vigência | `VIGENCIAS` em `lib/limiteFaturamento.ts`: valores + `desde` + fonte. Mudou a lei? **Acrescente uma vigência nova no fim da lista**; a mais recente com `desde` ≤ hoje vale. Nada de número solto no código. |

### Data de abertura

O limite proporcional do 1º ano precisa da data de abertura, que o sistema não tinha.
A contadora informa no próprio cartão ("Data de abertura da empresa" + Salvar, só ela vê);
grava em `empresa_regime.abertura` (0023). Sem a data, usa o ano cheio e o cartão avisa
a ressalva. Só dá para gravar se a empresa **já tem regime registrado** (Agenda).

### Acesso

`GET /api/caixa/limite` usa `exigirEmpresa`: o cliente vê **só a própria empresa**.
`PUT` e o painel são só de gestor. O bloco do painel exige o módulo `caixa`. `/caixa` e
`/api/caixa` já estão em `CLIENTE_PODE`: nada mudou em `proxy.ts`.

## Demonstrativo de caixa (nunca "DRE")

### Regras

| Tema | Regra |
|---|---|
| Quando existe | Só para mês **confirmado em sequência desde janeiro** — o mesmo recorte de `/api/caixa/resumo` (liberar abril solto entregaria o saldo de jan–mar). Vale também para a contadora: a prévia mostra **exatamente o que o cliente vai ver**. Outro mês: aviso "ainda não pode ser enviado", sem número. |
| Conteúdo | Entradas, saídas, entradas − saídas e **saldo no fim do mês**; comparação com o **mês anterior** e com a **média dos até 12 meses anteriores**; gráfico de barras entradas × saídas; **5 maiores saídas por conta** (+ "Outras contas"); documentos pedidos em aberto (`pendencias`); obrigações da agenda atrasadas ou que vencem em 30 dias (só leitura). |
| Comparação honesta | Só entram meses **confirmados e visíveis** (inclusive dezembro do ano anterior, se o ano anterior estiver confirmado). Mês anterior ausente → "sem comparação"; média com menos de 2 meses → "sem meses suficientes"; base zero → "sem base para comparar" (nunca infinito). |
| Saída sem conta | Depósito e perna bancária do cheque **não são gasto**: ficam fora do ranking, com uma linha à parte ("movimentação bancária"). |
| Falha isolada | Pendências e agenda falham sozinhas (tabela de migração pendente): a seção diz "ainda não está disponível" e o resto carrega. |
| Só lê | Não cria exercício (`garantirExercicio` grava; aqui não). |
| Envio | Botão **Enviar ao cliente** (primário) → e-mail para os logins `cliente` da empresa (o login é o e-mail; só os que parecem e-mail), via `lib/email.ts`. Sem `RESEND_API_KEY` só registra no log — a tela avisa que **nada saiu**. |
| Não duplicar | `demonstrativos_enviados` (0023), chave `(empresa, ano, mês)`. Segundo envio do mesmo mês → 409 `ja_enviado`; o botão vira **Reenviar** com confirmação e a rota exige `reenviar: true` (conta `reenvios`). Envio que **falhou** ou só foi **registrado** (sem provedor) pode ser tentado de novo sem reenviar — nada chegou ao cliente. Duas contadoras clicando juntas: só uma ganha (atualização condicionada). |
| Visão do cliente | A mesma página (`/caixa/demonstrativo`, aba **Demonstrativo**), só da própria empresa, só meses liberados; o seletor de mês só oferece os confirmados. Sem mês confirmado: "aparece quando a contabilidade confirmar". O link do e-mail leva a `?ano=&mes=`. |
| Visual | Tokens do design system (`grafico-entrada/saida`), claro/escuro, 375 px, uma ação primária por tela. |

## Conferência com dados reais do NÉLIO (só leitura, 21/11/2026)

Empresa `225646d6…`, exercício 2026, saldo inicial R$ 14.158,00, 46 lançamentos, 12 meses
confirmados. Rodei as funções reais (`lerDemonstrativo`, `receitaDasEmpresas`) contra produção, **sem gravar nada**:

- **Receita (limite):** 9 entradas = R$ 18.900,00 em contas de receita (jan 2.300 · fev 3.000 · mar 1.300 · abr 11.000 · jun 800 · jul 500) + R$ 1.680,20 **sem conta** (fora, como previsto). O NÉLIO **não tem regime registrado**, então o alerta real não aparece. Simulando: se fosse MEI, 23% de R$ 81.000 (ok); se fosse Simples, 11% da faixa 1, **incompleto** (caixa começa em 01/2026).
- **Março/2026:** entradas R$ 1.300,00 · saídas R$ 15.341,82 · saldo R$ 1.015,42. Mês anterior (fev): R$ 3.000,00 / R$ 3.786,01. Média dos 2 meses anteriores: R$ 2.650,00 / R$ 2.200,38 — confere à mão (`(2.300+3.000)/2` e `(614,75+3.786,01)/2`). Maiores saídas: Serviços Prestados por Pessoa Jurídica R$ 12.463,00 · Condomínio R$ 2.230,53 · Energia Elétrica R$ 648,29.
- **Janeiro:** saldo R$ 14.158,00 + 2.300,00 − 614,75 = **R$ 15.843,25**, igual ao do sistema. Fevereiro fecha em R$ 15.057,24 também pela conta.
- Pendências e obrigações da agenda do NÉLIO: vazias (0 e 0), sem erro.

## Para o integrador

- **Migração `0023_demonstrativo_cliente.sql`** (só o arquivo; **não aplicada**). Aditiva e idempotente: tabela `demonstrativos_enviados` (RLS sem policies) + coluna `empresa_regime.abertura date` nullable. Depende da 0010 e da 0018. `supabase migration list` antes do push. O código funciona antes dela: sem a coluna, o limite usa o ano cheio (e o PUT da abertura responde 503); sem a tabela, a prévia carrega e só o **envio** responde 503 "falta a 0023". As migrações 0021 e 0022 são de outras frentes.
- **Variáveis:** nenhuma nova. Para o e-mail sair: `RESEND_API_KEY` e `EMAIL_REMETENTE` (de `lib/email.ts`); opcional `APP_URL` para o link do e-mail (senão usa a origem da requisição).
- **Arquivos compartilhados tocados** (mudanças pequenas, conflito trivial): `app/(app)/painel/page.tsx` (import + `<LimiteFaturamento />` depois de `<Fechamento />`), `app/(app)/caixa/page.tsx` (import + uma linha depois de `FaixaArquivada`), `app/(app)/caixa/AbasCaixa.tsx` (aba **Demonstrativo**). Nada em `proxy.ts`, `lib/agenda*`, `lib/planilha.ts` nem `/dp` (só **lê** a agenda).
- **O que testar com conta de teste** (empresa de teste do escritório de teste; **nunca** nas empresas reais — o envio manda e-mail de verdade):
  1. Registrar regime **MEI** na empresa de teste (Agenda), lançar entradas em conta de receita até 80%, 100% e 120% de R$ 81.000: o cartão em Livro Caixa e o bloco do painel mudam de nível; entrada sem conta (retirada de conta corrente) **não** soma.
  2. Informar abertura no ano corrente (ex.: jul) → limite vira R$ 6.750 × 6 = R$ 40.500. Cliente não vê o campo; `PUT /api/caixa/limite` como cliente → 403.
  3. Regime Presumido ou sem regime → o cartão e o bloco não aparecem.
  4. Confirmar jan e fev; `/caixa/demonstrativo` como contadora: prévia de fev com comparação com jan; mar → aviso "não pode ser enviado". Confirmar só abril (sem março) → abril continua bloqueado.
  5. Cadastrar um login `cliente` com e-mail real **seu** na empresa de teste → **Enviar ao cliente**: e-mail chega; segundo clique vira **Reenviar** (com confirmação). Sem login de cliente com e-mail: aviso "sem destinatário".
  6. Entrar como **cliente**: só vê a própria empresa e só meses confirmados; `GET /api/caixa/demonstrativo?empresa=<outra>` → 403; `POST .../enviar` → 403.
  7. Sem `RESEND_API_KEY` (preview): o envio responde "registrado" e a tela diz que nada saiu.
  8. Tema escuro e 375 px nas duas telas.
- **Não verificado no navegador** (sem ambiente local com banco: o único `.env.local` é de produção). Conferi as funções contra produção em leitura (seção acima); typecheck, lint, testes e build verdes.

## Pendências

- **Revisão do `contador` (21/11/2026), já aplicada:** retroatividade do Simples separada (mês seguinte × início da atividade), limite/sublimite pelo ano-calendário e vigências da LC 238/2026. **Ficou de fora:** um sinalizador "integra a receita bruta" por conta do plano — hoje toda conta de receita entra (financeiras, aluguéis e recuperações inclusive; devoluções não abatem), o que superestima: é o lado seguro para um alerta, e o cartão avisa. Também ficou como ressalva que a receita por **competência** (opção da empresa) pode diferir do caixa. Os números de artigo da LC 123 vieram de memória do revisor: conferir antes de citá-los na tela. O sublimite proporcional de R$ 300 mil × meses está na Res. CGSN 140, não na LC.
- Janela do Simples é aproximada (12 meses até o mês corrente, não a RBT12 do período de apuração) e ignora notas emitidas: por isso é só estimativa.
- Link do painel leva ao caixa, não à empresa (as telas ainda não leem `?empresa=` — igual às outras frentes do painel).
- Envio do demonstrativo em lote ("enviar para todas as empresas com mês confirmado") ficou de fora de propósito: sem cron e sem disparo em massa; cada envio é decisão da contadora.
- Sem teste de rota/tela (como o resto do projeto); a regra está coberta em `lib/limiteFaturamento.ts` e `lib/demonstrativo.ts`.
