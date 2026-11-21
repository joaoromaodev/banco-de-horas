# Cobrança (Sprint 2 · Frente A)

> Assinatura recorrente por **escritório** no Asaas, webhook idempotente e **modo
> somente leitura** quando o teste vence sem assinatura ou a inadimplência passa
> da carência. Nada é apagado, nunca.

## Decisões

| Tema | Decisão |
|---|---|
| Gateway | **Asaas** (confirmado por consultor de cobrança em 21/11/2026; porquê em `docs/empresa/decisoes.md`). Assinatura com `billingType: UNDEFINED`: o escritório escolhe Pix, boleto ou cartão na própria fatura do Asaas. Nenhum dado de cartão passa pelo ClickContas. |
| Fonte da verdade | O banco guarda **fatos** (plano, `teste_ate`, assinatura, cobranças espelhadas do gateway). A situação de acesso é **derivada na hora** por `situacaoEfetiva` (`lib/cobranca.ts`). Nenhum cron "vira" conta para somente leitura: passou a data, a regra já responde diferente. |
| Fundador | Plano `fundador` (escritório da Edilse) **nunca** cai em somente leitura — nem `suspenso`, nem com assinatura. A rota recusa assinar para ele e o webhook nunca altera o plano dele (`.neq('plano','fundador')`). |
| Situação | Ordem: fundador → liberado; `suspenso` (manual do master) → bloqueado; com assinatura: ativa → liberado; inadimplente → liberado durante a **carência de 7 dias** a partir do vencimento em aberto mais antigo, depois bloqueado; pendente (assinou, não pagou) → liberado durante o teste e, para quem assinou **durante** o teste, até o 1º vencimento + 7 dias (boleto compensando); cancelada → liberado até `pago_ate`; sem assinatura: `ativo` manual → liberado; teste → até `teste_ate`; depois bloqueado. |
| Brecha fechada | Quem assina **depois** do teste não ganha a folga do "aguardando pagamento" (senão "assinar e cancelar" em loop daria uso grátis). Pix e cartão confirmam na hora; boleto espera a compensação. |
| Sem gateway | Sem `ASAAS_API_KEY`, o **teste vencido não trava** (motivo `cobranca_desligada`, faixa antiga "em breve você poderá assinar"): não haveria como pagar. Suspensão manual e inadimplência continuam valendo. |
| Somente leitura | Central no `proxy.ts`: toda escrita (`POST/PUT/PATCH/DELETE` e qualquer método que não seja `GET/HEAD/OPTIONS`) em `/api/*` passa por `barreiraSomenteLeitura` (`lib/acesso.ts`) e recebe **402** `{ erro, codigo: 'somente_leitura', motivo }`. **Falha fechada**: só ficam livres `/api/login`, `/api/logout`, `/api/criar-conta`, `/api/cobranca/**` e duas exportações por POST que não gravam (`/api/gerar`, `/api/contratos/documento`). Rota nova nasce barrada. Vale para o papel `cliente` (herda a situação do escritório da contabilidade). `master` nunca é barrado. |
| Cache | A situação é lida do banco **só nas escritas**, com cache de 30 s por escritório (`situacaoDoEscritorio`). O webhook invalida na instância que o recebe; nas demais, até 30 s. Banco fora sem cache → deixa passar (a rota vai falhar ao gravar de qualquer jeito). |
| Interface | Faixa no topo (`app/(app)/layout.tsx`): somente leitura para todos do escritório (o cliente lê "fale com a contabilidade"); prazo do teste (≤ 3 dias), carência e cancelamento (≤ 7 dias) só para a contabilidade. Botão "Assinar/Regularizar" só para o admin do escritório. As telas já mostram o `erro` das respostas em toast, então o 402 aparece com a mensagem certa sem mexer nelas. |
| Tela Assinatura | `/assinatura` (menu para todo contador; só o **admin do escritório** age — `exigirAdminEscritorio`). Plano, situação, empresas × limite, próximo vencimento, pago até, troca agendada; escolher plano/ciclo; CPF/CNPJ do pagador; pagar (link da fatura do Asaas); trocar; cancelar com confirmação; histórico com link da fatura/comprovante; "Atualizar cobranças" puxa do Asaas (útil sem webhook). |
| Primeiro vencimento | No **fim do teste** (assinar cedo não perde dias grátis) ou hoje, se o teste já acabou. Reassinar com período pago vigente: vence no dia seguinte ao `pago_ate`. |
| Troca de plano | **Subida**: vale na hora + cobrança avulsa de (novo − atual) × dias restantes ÷ dias do período, em centavos, vencendo em 3 dias; abaixo de R$ 5 não cobra. **Descida**: vale na renovação, sem crédito (o escritório usa o plano maior até o fim do que pagou). **Troca de ciclo** (mensal ↔ anual): vale na renovação; se vier com subida, a subida vale já (ajuste no ciclo atual). Nada pago ainda: troca imediata sem ajuste. Descer para plano que não comporta as empresas atuais é recusado. O consultor sugeriu mensal→anual imediato com crédito; ficamos com "na renovação" por simplicidade (ninguém paga por algo que não usa) — rever se pedirem. |
| Cancelamento | `DELETE` da assinatura no Asaas (ele apaga as cobranças em aberto; espelhamos como "Cancelado"). Acesso completo até `pago_ate`; depois somente leitura. Dá para reassinar. Sem fidelidade. |
| Limite de empresas | Essencial 10, Escritório 40, Ilimitado e Fundador sem limite; **teste sem limite** (experimenta à vontade). `POST /api/empresas` devolve 402 `codigo: 'limite_plano'` só quando a lista **cresce** além do limite — quem já passou (desceu de plano) continua editando as que tem. |
| LGPD | O CPF/CNPJ do pagador vai direto ao Asaas (que o exige) e **não é guardado** no ClickContas. Do webhook guardamos o corpo sem `payment.creditCard` e sem `customer`. Guardamos ids do gateway, plano, valores, datas, status e o link da fatura. |
| Webhook | `POST /api/cobranca/webhook`, público no proxy, autenticado pelo header `asaas-access-token` comparado em tempo constante com `ASAAS_WEBHOOK_TOKEN` (≥ 16 caracteres; sem ele, 503). Idempotente pelo `id` do evento (`cobranca_eventos`, PK). O escritório sai do que **nós** guardamos (id da assinatura, ou do cliente no gateway) — nunca de campo livre do corpo. O estado é **recalculado de todas as cobranças guardadas** (`recalcularAssinatura`), então ordem e repetição não importam. Respostas: 200 em sucesso e em erro permanente (evento de quem não conhecemos, registrado em `erro`); 500 em erro passageiro (o Asaas reenvia). Corpo > 200 kB → 413. |
| Link da fatura | Só aceitamos `https://*.asaas.com` (o link vira botão na tela). |

### Tabelas (migração `0011_cobranca.sql`)

- `assinaturas` — uma por escritório (PK `escritorio_id`, `on delete cascade`): ids no gateway, ambiente, plano, ciclo, valor, status (`pendente/ativa/inadimplente/cancelada`), `proximo_vencimento`, `pago_ate` (último dia pago, inclusive), `inadimplente_desde`, troca agendada (`plano_agendado`, `ciclo_agendado`, `agendado_a_partir`), `cancelada_em`.
- `cobranca_pagamentos` — espelho das cobranças (assinatura e avulsas), para o histórico.
- `cobranca_eventos` — log do webhook; PK = id do evento (idempotência).
- `cobranca_travas` — uma operação de assinatura por escritório de cada vez (entre instâncias).

`cobranca_pagamentos` guarda também `ambiente` (sandbox/produção) e `periodo_ate`
(até quando a cobrança paga cobre, **congelado** quando ela é paga).

RLS ligada sem policies, como o resto. A migração **só cria tabelas**; não toca em dado existente.

### Arquivos

| Arquivo | O quê |
|---|---|
| `lib/cobranca.ts` | Regras puras (preços, limites, situação, escrita barrada, troca proporcional, recálculo, CPF/CNPJ). Testes: `tests/cobranca.test.ts`. |
| `lib/gatewayAsaas.ts` | Cliente HTTP do Asaas, config por env, token do webhook, tradução de status/eventos. Testes: `tests/gatewayAsaas.test.ts`. |
| `lib/cobrancaServidor.ts` | I/O no Postgres e cache da situação. |
| `lib/acesso.ts` | `barreiraSomenteLeitura`, `exigirAdminEscritorio`; `completarEscritorio` agora exportada. |
| `proxy.ts` | Chama a barreira nas escritas; webhook em `PUBLICO`. Teste: `tests/proxySomenteLeitura.test.ts`. |
| `app/api/cobranca/route.ts`, `.../webhook/route.ts` | Rotas. |
| `app/api/empresas/route.ts` | Limite por plano. |
| `app/api/me/route.ts` | Devolve `cobranca` (situação) para a faixa. |
| `app/(app)/assinatura/page.tsx`, `app/(app)/layout.tsx` | Tela e faixa/menu. |

## Revisão de segurança (Escudo, 21/11/2026)

Nenhum caminho para um escritório ler ou alterar dado de outro. Achados e o que foi feito:

| # | Gravidade | Achado | Situação |
|---|---|---|---|
| 1 | Alta | `pago_ate` recalculado com o ciclo **atual**: pagar 1 mês e trocar para anual (ou cancelar e reassinar no anual) dava ~12 meses. | **Corrigido.** Cada cobrança paga grava `periodo_ate` com o ciclo do vencimento dela e ele fica congelado; o recálculo usa só isso (sem o campo, conta 1 mês). Testes em `cobranca.test.ts`. |
| 2 | Alta | Assinatura/pagamento de sandbox liberava acesso em produção; sem `ASAAS_AMBIENTE` o padrão era sandbox. | **Corrigido.** O ambiente é conferido contra o prefixo da chave (`$aact_prod_` × `$aact_hmlg_`; divergência = cobrança não configurada; valor estranho em `ASAAS_AMBIENTE` também). Assinatura de outro ambiente não conta na situação; pagamentos guardam o ambiente e o recálculo só usa os do ambiente da assinatura. |
| 3 | Média | Subir de plano, não pagar o ajuste e cancelar mantinha o plano maior até `pago_ate`. | **Corrigido.** O ajuste avulso não é apagado no cancelamento; vencido além da carência, ele põe a conta cancelada em somente leitura mesmo com período pago. |
| 4 | Média | Trava de "assinar" só por instância; assinatura órfã se a gravação falhasse. | **Corrigido.** Trava no banco (`cobranca_travas`, expira em 2 min); se gravar falhar depois de criar no Asaas, a assinatura é cancelada lá. |
| 5 | Média | "Trocar" regravava a assinatura lida no começo, desfazendo um webhook do meio. | **Corrigido.** A troca grava só os campos que muda e recalcula sobre o estado lido na hora. |
| 6 | Baixa | Webhook confiava no status do corpo; upsert podia mudar o escritório de uma cobrança. | **Corrigido.** O status vem de `GET /payments/{id}` na API do Asaas (remoção só vale se a API confirmar); cobrança já gravada nunca muda de escritório. |
| 7 | Baixa | Banco fora sem cache libera a escrita (inclusive rotas do Sheets). | **Risco aceito** (a rota de Postgres falha ao gravar; as do Sheets são do módulo de ponto, que migra para o Postgres na Frente B). |
| 8 | Baixa | Payload guardava campos além do necessário. | **Corrigido** com lista do que pode ficar. Retenção de `cobranca_eventos` a definir (sugestão: 12 meses). |
| 9 | Baixa | Papel de admin lido do cookie (12 h). | **Corrigido.** As ações de `POST /api/cobranca` conferem no banco. |
| 10 | Ruído | `GET /api/caixa/exercicio` e `/api/caixa/livro` gravam dado gerado pelo sistema. | Aceitável. |

Para o integrador/jurídico: a política de privacidade precisa citar o **Asaas** como suboperador.

## Variáveis de ambiente

| Variável | Obrigatória | O quê |
|---|---|---|
| `ASAAS_API_KEY` | para cobrar | Chave da API (sandbox começa com `$aact_hmlg_`). Sem ela: "cobrança ainda não configurada" e o teste vencido não trava. |
| `ASAAS_AMBIENTE` | recomendada | `producao` ou `sandbox`. Conferida contra o prefixo da chave (`$aact_prod_` / `$aact_hmlg_`): se divergirem, ou se o valor for outro, a cobrança fica **não configurada**. Sem ela, vale o prefixo; prefixo desconhecido = sandbox. URLs: `https://api-sandbox.asaas.com/v3` e `https://api.asaas.com/v3`. |
| `ASAAS_WEBHOOK_TOKEN` | para o webhook | Token aleatório (≥ 16 caracteres) que você cadastra no webhook do Asaas. Diferente da API key. |

**Armadilha:** a chave começa com `$aact_` e o Next **expande `$` em arquivos `.env`** — no `.env.local` escreva `ASAAS_API_KEY=\$aact_...` (com barra), senão ela vira vazia e a cobrança aparece como não configurada. No painel da Vercel não há expansão: cole a chave como está.

Todas só de servidor (nunca `NEXT_PUBLIC_`). Na Vercel: Production e Preview separados (Preview com chave de sandbox).

## Para o integrador

**Ordem:** a 0011 vem antes da 0012–0015 (ver roadmap).

1. **Aplicar a migração.** `git fetch` e `npx supabase migration list --remote` (deve mostrar até 0010). Backup não é necessário para dados (a 0011 só cria tabelas), mas registre o estado. `npx supabase db push` (ou cole `supabase/migrations/0011_cobranca.sql` no SQL Editor). Confira: `select count(*) from assinaturas;` → 0.
2. **Antes de publicar, decida sobre os testes vencidos.** Com a chave do Asaas configurada, **todo escritório não-fundador com `teste_ate` no passado e sem assinatura vira somente leitura no deploy**. Confira quem é:
   ```sql
   select id, nome, plano, situacao, teste_ate from escritorios
    where plano <> 'fundador' and situacao <> 'ativo' and teste_ate < now();
   ```
   Para liberar alguém à mão: `update escritorios set situacao = 'ativo' where id = '...';` (fica como "cortesia" até ter assinatura). Para dar mais dias: `update escritorios set teste_ate = now() + interval '14 days' where id = '...';`. Nunca mexa no escritório `00000000-0000-4000-8000-000000000001` (fundador).
3. **Variáveis na Vercel:** `ASAAS_API_KEY`, `ASAAS_AMBIENTE`, `ASAAS_WEBHOOK_TOKEN` (gere com `openssl rand -hex 24`). Comece com **sandbox** também em produção (veja o passo 5).
4. **Webhook no painel do Asaas** (Integrações → Webhooks; um para o sandbox e outro para a produção, cada um no seu painel):
   - URL: `https://<domínio>/api/cobranca/webhook`
   - Token de autenticação: o mesmo `ASAAS_WEBHOOK_TOKEN`
   - Tipo de envio: **sequencial**
   - Eventos: todos de **cobrança** (`PAYMENT_*`) e de **assinatura** (`SUBSCRIPTION_*`)
   - E-mail de aviso de fila pausada: o do dono
5. **Teste em sandbox, em produção** (com `ASAAS_AMBIENTE=sandbox`):
   1. Crie uma conta nova em `/criar-conta` (e-mail de teste seu). Ela nasce em teste, sem acesso a nada da Edilse.
   2. Em **Assinatura**, escolha Essencial mensal e informe um CPF de teste válido (ex.: `529.982.247-25`). Confira que aparece a fatura e "Aguardando pagamento".
   3. No painel do **sandbox** do Asaas, abra a cobrança e use "Confirmar pagamento" (ou pague o Pix de teste). Em segundos a tela mostra "Em dia" e "Pago até"; `select * from cobranca_eventos order by recebido_em desc limit 5;` mostra os eventos com `processado_em` preenchido.
   4. Reenvie um evento pelo painel do Asaas (ou repita o POST): a resposta traz `repetido: true` e nada muda.
   5. Somente leitura: `update escritorios set teste_ate = now() - interval '1 day' where id = '<conta de teste>';` e cancele a assinatura na tela. Depois do período pago (ou force com `update assinaturas set pago_ate = current_date - 1 where escritorio_id = '<conta de teste>';`), em até 30 s: lançar no caixa ou salvar empresa → toast com a mensagem de somente leitura (402); listar, abrir o livro e exportar continuam. Crie um login `cliente` para uma empresa da conta e confira o mesmo 402 para ele.
   6. Limite: com plano Essencial, tentar salvar a 11ª empresa → mensagem "suba para o Escritório".
   7. Troca: Essencial → Escritório no meio do período gera a cobrança proporcional; Escritório → Essencial aparece como "Troca agendada".
   8. **Apague a conta de teste** no fim (ordem por causa das FKs):
      ```sql
      -- conferir antes: select * from escritorios where id = '<conta de teste>';
      delete from cobranca_eventos where escritorio_id = '<conta de teste>';
      delete from usuarios where escritorio_id = '<conta de teste>';
      -- empresas, lançamentos e demais dados que você criou nela, se houver
      delete from escritorios where id = '<conta de teste>';  -- assinaturas e pagamentos caem em cascata
      ```
      E remova o cliente no painel do sandbox do Asaas.
6. **Virar para produção:** troque `ASAAS_API_KEY` pela chave de produção e `ASAAS_AMBIENTE=producao`, configure o webhook no painel de produção e faça um pagamento real pequeno (pode ser a própria conta do dono, cancelada e estornada depois). Assinaturas criadas no sandbox ficam marcadas como "outro ambiente" e o escritório assina de novo.

## Pendências e armadilhas

- **`value` no `PUT /subscriptions/{id}`:** o FAQ do Asaas diz que dá para mudar o valor, mas o campo não aparece no schema da referência. Conferir no sandbox (passo 5.7); se não aplicar, a troca precisa cancelar e recriar a assinatura.
- **Primeiro vencimento "hoje"** (assinatura depois do teste): conferir no sandbox que o Asaas aceita `nextDueDate` igual a hoje; o consultor sugeriu hoje + 3 dias.
- **Cache por instância** (30 s): pagou e a outra instância ainda barra por até 30 s. Aceitável.
- **Webhook depende da API**: cada evento de pagamento consulta `GET /payments/{id}`; se o Asaas estiver fora, respondemos 500 e ele reenvia.
- **Estorno / chargeback** tiram o período pago (`pago_ate` recua); sem cobrança vencida, a assinatura volta a "pendente". Caso raro; o master decide à mão.
- **NFS-e** automática por assinatura existe no Asaas (`/subscriptions/{id}/invoiceSettings`), não ligada ainda — depende do CNPJ e da inscrição municipal da ClickContas.
- **Termos de uso:** escrever a regra da troca proporcional (subida já, descida e troca de ciclo na renovação) e a carência de 7 dias.
- **Página `/planos`** (site) mantém a própria tabela de preços em `app/(site)/planos/Precos.tsx`; a fonte para a cobrança é `PLANOS` em `lib/cobranca.ts`. Unificar quando alguém mexer no site.
- **Cota de OCR por plano** é da Frente B (ponto); `planoEfetivo` em `lib/cobranca.ts` é a função para saber o plano vigente.
