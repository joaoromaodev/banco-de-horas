# Folha de Ponto no Postgres (Sprint 2 · Frente B)

> A Folha de Ponto saiu do Google Sheets e foi para o Postgres, recortada por
> **escritório**. A chave do Gemini passou a ser da plataforma e cada escritório
> tem uma cota mensal de leituras por IA, conforme o plano.
> Branch: `claude/ponto-postgres-notebook-3cd4c9`. Migração: **0012** (não aplicada).

## O que a planilha guardava e para onde foi

| Aba do Sheets | Colunas | Agora | Observação |
|---|---|---|---|
| `Funcionarios` | nome, cargo, jornadaUtilMin, jornadaSabadoMin, ordem, empresa | `ponto_funcionarios` | único por (empresa, nome) |
| `Frequencias` | funcionario, ano, mes, dia, 4 horários, marcador, atualizadoEm, empresa | `ponto_frequencias` | 1 linha por funcionário × dia lançado; único por (empresa, funcionário, ano, mês, dia) |
| `Feriados` | data, descricao | `ponto_feriados` | **por escritório** (antes era uma lista global, a de Belém) |
| `Config` | gemini_api_key, gemini_modelo | — | chave e modelo vêm de `GEMINI_API_KEY` / `GEMINI_MODELO` |
| (novo) | — | `ponto_leituras_ocr` | uma linha por leitura por IA, para a cota |
| `Empresas`, `Usuarios`, `Página1` | — | — | já migradas na 0004 / vazia; não são lidas |

Todas as tabelas têm `escritorio_id` (FK `escritorios`, `on delete restrict`). As de
funcionário e frequência têm também `empresa_id` com **chave composta**
`(empresa_id, escritorio_id) → empresas (id, escritorio_id)` (`on update cascade`,
`on delete restrict`): uma linha não consegue dizer que é do escritório A apontando
para empresa do B, e mover a empresa de escritório (só por SQL) leva o ponto junto.
Para isso a 0012 cria `empresas_id_escritorio_uniq unique (id, escritorio_id)`, que
a chave primária já garante. RLS ligada sem policies, como o resto.

## Decisões

| Tema | Decisão |
|---|---|
| Camada | `lib/pontoDb.ts` substitui `lib/sheets.ts` (**removido**). Toda função recebe o escritório e filtra por ele junto com a empresa (defesa em profundidade). |
| Recorte | `lib/pontoAcesso.ts` → `exigirEmpresaPonto(req, empresaId)`: exige gestor (master/contador), `podeAcessarEmpresa` e resolve o escritório **pelo cadastro da empresa**, nunca pelo corpo da requisição. Para contador, confere de novo que é o escritório da sessão; empresa sem escritório → 403 (falha fechada). `lib/acesso.ts` e `proxy.ts` **não foram tocados**. |
| Funcionário ↔ frequência | Ligados pelo **nome**, como na planilha (a tela aceita nome livre). Excluir/renomear funcionário não apaga frequências já lançadas. |
| Horários | Guardados como texto `HH:MM`, exatamente como revisados. A IA pode devolver algo fora do padrão (há `12>54` na planilha) e o dado da folha não é reescrito em silêncio; a validação é da tela. |
| Salvar o mês | Upsert dos dias com dado + remoção dos que sumiram (mesma empresa, funcionário, mês). Se cair no meio, sobra no máximo um dia velho, nunca se perde o mês. |
| Feriados | Por escritório. `GET/POST /api/feriados?empresa=<id>` usa o escritório da empresa; sem empresa, o do contador. Qualquer contador do escritório altera a lista dele (antes só o master e o fundador). |
| Excluir empresa com ponto | Bloqueado pelo banco (`on delete restrict`): o histórico trabalhista não some por um clique no Cadastro. Ver pendências. |
| Chave do Gemini | Só `GEMINI_API_KEY` (e `GEMINI_MODELO`, padrão `gemini-2.5-flash`). Não há chave na planilha, no banco nem na tela; `/api/config` só diz se existe (master) e o `POST` responde 410. A seção de Configurações virou informativa. |
| Erros | Rotas do ponto não devolvem mais a mensagem crua do banco/Gemini: texto genérico na resposta, detalhe no log do servidor (`[ponto]`). |
| Sem a 0012 | `ErroBancoPendente` → 503 `{ aguardandoBanco: true }`; Timesheet e Cadastros mostram "Aguardando o banco de dados". A leitura por IA **não** roda sem a tabela da cota (falha fechada). Atenção: num `HEAD` o PostgREST responde 204 sem erro para tabela inexistente — por isso `count === null` é tratado como banco pendente. |
| `Sheets` | Não é mais usado pelo app. `googleapis` fica só para o script de importação. Depois da importação, `GOOGLE_SHEETS_ID` e `GOOGLE_SERVICE_ACCOUNT_*` podem sair da Vercel. |

### Cota de leituras por IA (`lib/cotaOcr.ts`)

| Plano | Folhas/mês |
|---|---|
| `teste` (14 dias) | 50 |
| `essencial` | 150 |
| `escritorio` | 600 |
| `ilimitado` | 2.000 (uso justo) |
| `fundador` | 10.000 (sem limite prático; o teto só segura uma sessão vazada) |
| desconhecido | 150 (menor pago — a cobrança pode criar planos novos) |

- Conta por **escritório e competência** (`AAAA-MM` no fuso de Belém), no servidor.
- A partir de 80% a tela avisa "Restam X de Y"; no limite, 429 com mensagem educada,
  lembrando que dá para preencher à mão e convidando para o próximo plano.
- Escritório `suspenso` não lê (o preenchimento manual continua).
- Fluxo em `/api/extrair`: avalia → **reserva** (linha `reservada`) → reconta; se a
  corrida com outra leitura passou do limite, desfaz e recusa → chama o Gemini →
  sucesso vira `concluida`; falha vira `falhou` (não conta na cota, fica registrada).
- **Limite de ritmo**, à parte da cota: no máximo 30 tentativas (falhas incluídas)
  por escritório em 10 minutos → 429 "Muitas leituras em pouco tempo". Segura abuso
  de custo com imagem quebrada em sequência.
- Reserva órfã (função morta no meio da leitura) deixa de contar depois de 5 minutos.
- Foto acima de 4 MB é recusada com mensagem (a Vercel corta o corpo em ~4,5 MB).
- `GET /api/extrair?empresa=` devolve a situação da cota para a tela.
- O plano vem de `escritorios.plano` (0010). Não depende de colunas da 0011.
- Testes: `tests/cotaOcr.test.ts`; isolamento entre escritórios nas guardas em
  `tests/pontoAcesso.test.ts`.

## Importação do Sheets (`scripts/importar-ponto.mjs`)

```powershell
node scripts/importar-ponto.mjs --simular   # padrão: só lê, conta e mostra
node scripts/importar-ponto.mjs --gravar    # grava (só depois da 0012)
```

Opções: `--escritorio=<uuid>` (padrão: o fundador, `00000000-0000-4000-8000-000000000001`)
e `--env=<arquivo>` (padrão `.env.local` da pasta atual). Lê a planilha com escopo
**somente leitura**. Idempotente: grava com upsert `ignoreDuplicates` nas chaves
únicas — rodar de novo não duplica nem sobrescreve o que foi editado no app. Em
`--gravar`, salva antes uma cópia JSON do que leu na pasta temporária do sistema e
a apaga ao fim de uma gravação sem erro (`--manter-copia` para guardá-la — dado
pessoal: apague depois de conferir). A regra de mapeamento é pura e testada
(`lib/pontoImportacao.ts`, `tests/pontoImportacao.test.ts`).

Regras: funcionário só entra se a coluna `empresa` aponta para uma empresa **atual**
do escritório; frequências do vínculo legado (`empresa-vaz-e-vouzela`, nome antigo
ou vazio) são **recuperadas** para a Vaz & Vouzela, perdendo para um lançamento
atual do mesmo dia; marcador desconhecido vira nulo (com aviso); horário fora do
padrão entra como está (com aviso).

### Simulação com os dados reais (21/11/2026, só leitura)

Planilha: Funcionarios 21 linhas, Frequencias 183, Feriados 0; Config com
`gemini_api_key` e `gemini_modelo` (não importadas).

| Vai entrar | Quantidade |
|---|---|
| Funcionários (todos da Vaz & Vouzela) | **9** |
| Frequências (dias), todas da Vaz & Vouzela | **183** — 06/2026: 1 funcionário · 07/2026: 1 · 08/2026: 1 · 10/2026: 6 |
| … das quais recuperadas do vínculo legado | 22 (junho/2026, Edilene — hoje invisíveis no app) |
| Feriados | 0 |

| Fica de fora | Quantidade |
|---|---|
| Funcionários com vínculo legado (cópias antigas, 2 com erro de digitação no nome) | 5 |
| Funcionários de empresas que não existem mais (2 de teste, 5 de um id antigo da Vaz & Vouzela) | 7 |

Aviso: `12>54` no retorno do almoço de ORIEL SOUZA LALOR em 15/10/2026 — entra como
está; conferir na tela. Nenhuma frequência de L A T Hage ou NÉLIO na planilha.

## Para o integrador

Ordem: **0011 (cobrança) → 0012 (esta) → 0013 → 0014 → 0015**. A 0012 é aditiva e
compatível com o código antigo (que continua no Sheets); o código **novo** depende
dela — sem a 0012 o ponto mostra "aguardando o banco" e a leitura por IA não roda.

1. `git fetch` e `npx supabase migration list --remote`: confirme 0011 aplicada e
   0012 livre.
2. **Backup:** a planilha é a fonte e não é alterada; mesmo assim, no Google Sheets,
   *Arquivo → Fazer uma cópia* (ou anote a versão no histórico). As tabelas `ponto_*`
   nascem vazias, não há o que salvar do banco.
3. Aplique a 0012 (`npx supabase db push`, ou cole o arquivo no SQL Editor).
4. Na pasta do repositório com o `.env.local` de produção (e `service-account.json`):
   `node scripts/importar-ponto.mjs --simular` — deve repetir os números acima
   (9 funcionários, 183 dias, 0 feriados; banco "antes" com zeros).
5. `node scripts/importar-ponto.mjs --gravar` — confira o "Banco depois":
   `ponto_funcionarios 9`, `ponto_frequencias 183`, `ponto_feriados 0`. Rodar de novo deve manter os mesmos números.
6. Vercel: confirme `GEMINI_API_KEY` (e, se quiser, `GEMINI_MODELO`). Publique o
   código **logo depois** da importação: entre a importação e o deploy, o que a
   Edilse salvar no app antigo vai só para a planilha (rode o `--gravar` de novo
   depois do deploy — ele só acrescenta o que falta; edições de dias já importados
   não são trazidas).
7. Depois de uns dias estável: remova `GOOGLE_SHEETS_ID` e
   `GOOGLE_SERVICE_ACCOUNT_JSON` da Vercel. A planilha fica como arquivo morto.

### O que testar em produção (com a sessão da Edilse, sem alterar dado de empresa)

- Timesheet → Vaz & Vouzela → outubro/2026: "Baixar todas (.zip)" traz 6 planilhas;
  junho/2026 traz a da Edilene (recuperada).
- Cadastros: aparecem os 9 funcionários da Vaz & Vouzela; feriados vazio.
- Linha "Leituras por IA neste mês: 0 de 10.000" aparece na Timesheet.
- Folhas em branco (PDF e .zip) da Vaz & Vouzela.
- Uma conta de teste de outro escritório: não vê funcionários nem feriados da Edilse
  e leva 403 em `/api/funcionarios?empresa=<id da Vaz>`, `/api/feriados?empresa=…`,
  `/api/gerar-lote`, `/api/extrair` (GET e POST). Apague a conta depois.
- Se for testar a leitura por IA, use uma folha de teste e confirme que a contagem
  sobe 1; uma leitura que falha não conta.

## Rota da Timesheet: `/ponto` (Sprint 4)

A Timesheet saiu de `/` e vive em **`/ponto`** (`app/(app)/ponto/page.tsx`). `/` virou
só um redirecionamento por papel (contador/master → `/painel`, cliente → `/caixa`;
ver `docs/painel.md`). No `proxy.ts`, `ROTAS_PONTO` troca `'/'` por `'/ponto'` — o
gate de módulo vale igual: contador só-caixa vai ao `/caixa`, sem módulo algum ao
`/painel`. Menu e aba "Timesheet" apontam para `/ponto`.

### Para o integrador (rota)
- Sem migração. Testar: contador com ponto abre `/ponto`; `/` cai em `/painel`;
  só-caixa em `/ponto` cai em `/caixa`; cliente em `/ponto` cai em `/caixa`.
- Qualquer link externo/manual para a Timesheet deve usar `/ponto`.

## Como foi testado

- `npm run typecheck`, `npm run lint` (0 erros), `npm test` (233 testes, 34 novos) e
  `npm run build` verdes.
- Revisão do **Escudo** (segurança/LGPD): sem caminho para um escritório ler, gravar
  ou gastar a cota de outro, nem para o `cliente` chegar ao ponto. Corrigidos depois
  dela: falha de leitura passa a ser registrada + limite de ritmo; reserva órfã
  expira; cópia da importação apagada; limite de 4 MB; testes de isolamento.
- Simulação da importação contra a planilha e o banco reais, só leitura.
- **Sem teste:** as rotas contra a 0012 aplicada (o banco local não foi montado
  nesta sessão) e a leitura por IA com a cota de ponta a ponta.

## Pendências e armadilhas

- **Excluir empresa com ponto** dá erro do banco (FK restrict) e a mensagem atual do
  `/api/empresas` é a crua do Postgres. Tratar lá (fora desta frente) com um texto
  claro, ou decidir arquivar em vez de excluir.
- **LGPD (decisão do dono/jurídico):** a foto da folha e os nomes vão ao Gemini.
  Confirmar que o projeto da `GEMINI_API_KEY` está no **nível pago** (no gratuito o
  Google pode usar o conteúdo) e citar o Google como suboperador nos termos.
- **Retenção** não definida: prazo de guarda do ponto (trabalhista — jurídico) e de
  `ponto_leituras_ocr` (sugestão do Escudo: 13 meses), que guarda o e-mail de quem
  leu; `ponto_frequencias.atualizado_por` também.
- Limite de ritmo é por escritório, não por usuário; se um escritório grande
  esbarrar em 30/10 min, ajustar `RITMO` em `lib/cotaOcr.ts`.
- De antes desta frente: `getMaster` cai em senha padrão sem `MASTER_PASSWORD`
  (confirmar a variável na Vercel; já listado em `docs/testes.md`).
- Funcionário ligado à frequência pelo nome: renomear no cadastro "solta" o
  histórico. Mesmo comportamento da planilha.
- O painel do contador (`/painel`, Sprint 3) pode ler o ponto daqui (`lib/pontoDb.ts`).

## Revisão inteligente (Sprint 7 · Frente A)

> Antes de fechar o mês, a Timesheet aponta o que pede atenção na folha: dia por
> dia, por funcionário, do maior risco para o menor. **Só alerta**: nada é
> bloqueado nem alterado — corrigir continua sendo abrir a folha e editar o dia.
> Branch: `claude/revisao-ponto-853f4d`. **Sem migração.**

Regras puras e explicáveis em `lib/revisaoPonto.ts` (`tests/revisaoPonto.test.ts`),
no mesmo padrão da revisão do Livro Caixa (`lib/revisaoCaixa.ts`): cada achado tem
nível, rótulo curto (o selo), motivo de uma frase **com a regra legal** e o dia. Os
critérios foram definidos com o subagente `contador` em 21/11/2026; o maior cuidado
foi não virar ruído.

| Achado (selo) | Nível | Critério | Base |
|---|---|---|---|
| Horário ilegível | alto | texto que não é `HH:MM` (`12>54`), hora > 23 ou minuto > 59 | — (não dá para calcular) |
| Fora de ordem | alto | uma marcação antes da anterior; o motivo pergunta se virou a meia-noite | — |
| Falta marcação | alto | 1 ou 3 marcações, ou pares trocados (só saída do almoço + retorno etc.) | CLT art. 74 §2º |
| Acima de 2h extras | alto | trabalhado > **menor entre (jornada contratual do dia + 2h) e 10h**, + 10 min de tolerância. 8h → 10h; 8h48 → 10h; sábado de 4h → 6h | art. 59 e §2º; art. 58 §1º / Súm. 366 |
| Sem intervalo | alto | 4 marcações, saída e retorno do almoço iguais, jornada > 6h10 | art. 71 |
| Intervalo curto | médio | jornada > 6h10 com intervalo < 55 min; ou entre 4h e 6h10 com < 15 min | art. 71 e §1º |
| Pouco descanso | médio | < 11h entre a última marcação de ontem e a primeira de hoje (o dia 1 usa o último dia do mês anterior, se salvo) | art. 66 |
| 7º dia seguido | alto | 7º dia consecutivo com horário (conta a última semana do mês anterior); qualquer dia sem horário zera | art. 67; OJ 410 SDI-1 |
| Feriado trabalhado | médio | feriado cadastrado **ou** marcador FERIADO com horário | Lei 605/49 art. 9º |
| Horário na folga | baixo | domingo / sábado sem expediente com horário e sem marcador | — |
| Marcador × horário | alto (FÉRIAS, ATESTADO, FALTA) · médio (FOLGA) | marcador de "não trabalhou" com horário; BANCO DE HORAS com meio dia passa | — |
| Dia em branco | médio | dia útil sem horário nem marcador **entre o primeiro e o último dia lançados** (admissão ou desligamento no meio do mês não acusam) | Lei 605/49 (DSR) |
| Falta | baixo | marcador FALTA: perde o DSR da semana; conta no resumo | Lei 605/49 art. 6º |
| Atestado > 15 dias | alto | 16º dia corrido de atestado (fim de semana sem dado não quebra a sequência) | Lei 8.213 art. 60 |
| Leitura incerta | baixo · médio se o dia já tem outro achado | campo que a IA marcou como dúvida (só existe logo após a leitura; não é gravado) | — |
| Intervalo > 2h | baixo, **1 por mês** | lista os dias | art. 71 |
| Intervalo não marcado | baixo, **1 por mês** | só entrada e saída (pode ser pré-assinalado) — não desconta 1h por conta própria | art. 74 §2º |
| Trabalho noturno | médio, **1 por mês** | marcação depois das 22h ou antes das 5h | art. 73 |
| Horário britânico | médio, **1 por mês** | ≥ 10 dias trabalhados e **entrada e saída** idênticas em ≥ 80% (o almoço fixo não conta: pode ser pré-assinalado) | Súmula 338 III TST |
| Sem feriados | baixo, do escritório | nenhum feriado cadastrado no ano: o feriado só é visto pelo marcador | — |

**Fora de propósito** (decisão do `contador`): "semana acima de 44h" **não** é
alerta — hora extra dentro do limite diário é legal e é paga; o que importa já está
em "Acima de 2h extras" e "7º dia seguido". Virou informação no resumo do
funcionário: *"Além da jornada: 14h10 em 14 dia(s) · 1 falta(s)"* (base: a jornada
contratual, nunca 8h fixas). Também não se procura folga compensatória do feriado
(a lei não fixa prazo; a contadora confere).

Risco (ordena a fila): alto 5, médio 2, baixo 1 — igual ao caixa.

### Na tela (`/ponto`)

- **Revisão do mês** (seção nova, com a empresa e o mês escolhidos): resumo
  ("2 de 6 funcionário(s) com 5 dia(s) pedindo atenção em OUTUBRO/2026"), alternador
  **"Só os que pedem atenção"** (ligado por padrão), um item por funcionário do
  maior risco para o menor, com contagem por nível, horas além da jornada, faltas e
  os achados (dia + selo + motivo; 4 visíveis, "Ver todos"). **Abrir folha** carrega
  os dias salvos no editor (com confirmação se a folha aberta tem alteração não
  salva) e já liga o filtro de dias.
- **Na folha em edição**: coluna **Revisão** com o selo do achado mais grave do dia
  (+N), todos os motivos no balão (mouse e teclado); no topo, "N dia(s) pede(m)
  atenção" e os achados do mês; alternador **"Só os dias que pedem atenção"**. A
  revisão roda ao vivo no navegador enquanto se edita (e usa a leitura incerta da IA
  logo após o OCR). Salvar recarrega a revisão do mês.
- A validação antiga (`lib/validacao.ts`) continua pintando as células; só os
  **erros** dela (ordem cronológica) seguram o download, como antes. A frase "geral"
  que ela escrevia sob o marcador saiu: a revisão cobre o mesmo (dia vazio,
  incompleto, folga com horário) com menos ruído.

### Desempenho

`GET /api/revisao-ponto?empresa=&ano=&mes=` (gestor + escritório da empresa, via
`exigirEmpresaPonto`; o cliente não chega — `proxy.ts`, `ROTAS_PONTO`). **Uma**
consulta de frequências (`lerFrequenciasParaRevisao` em `lib/pontoDb.ts`: o mês +
os dias ≥ 22 do anterior, num `or`, paginada por `lerTudo`) em paralelo com
feriados, funcionários e jornada (as mesmas leituras do `gerar-lote`). Cálculo em
memória: 100 funcionários × 30 dias em poucos ms (teste < 200 ms). Contra o banco de
produção, de fora da Vercel: ~200 ms com a rede.

Nada é guardado. Um "visto pela contadora" para silenciar um alerta **não** foi
feito: com 4% dos dias acusando nos dados reais, não pagou uma migração agora
(a 0021 continua livre). Se a contadora pedir, é uma tabela aditiva
`ponto_revisao_vistos (escritorio_id, empresa_id, funcionario, ano, mes, dia, codigo, visto_por, visto_em)`.

### Calibração com os dados reais (21/11/2026, só leitura)

Vaz & Vouzela, 183 dias de 6 funcionários (06, 07, 08 e 10/2026), sem feriados
cadastrados, jornada padrão 8h, sem sábado:

| Achado | Quantos | Onde |
|---|---|---|
| Sem intervalo | 3 | EDILENE 04, 05 e 08/06 (saída e retorno do almoço no mesmo minuto; 7h06–8h49 corridas) |
| Horário ilegível | 1 | ORIEL 15/10 — o `12>54` conhecido |
| Acima de 2h extras | 1 | ORIEL 22/10 — 06:02 às 17:35, 10h13 |
| Intervalo curto | 1 | ORIEL 09/10 — 30 min |
| Falta | 2 | ORIEL 07/10, HELBERT 26/10 |
| Sem feriados (do escritório) | 1 por mês | nenhum feriado cadastrado; 12/10 está como marcador FERIADO |
| todos os outros | 0 | interjornada, 7º dia, britânico, noturno, marcador × horário, atestado, dia em branco |

**8 de 183 dias (4,4%) pedem atenção**; julho e agosto saem limpos. Nenhum tipo
dispara em quase todo dia. Sem os ajustes do `contador`, a régua de "semana > 44h" e
o "dia vazio" da validação antiga (que acusaria 17 dias do CAIO, admitido em 26/10)
seriam o ruído.

Informativo (não é alerta): além da jornada em outubro, ORIEL 14h10 em 14 dias e
LEONARDO 8h22 em 14 dias.

### Para o integrador

- **Sem migração** (a 0021 segue livre). Rota nova `GET /api/revisao-ponto`, já em
  `ROTAS_PONTO` do `proxy.ts`. `lib/pontoDb.ts` ganhou `lerFrequenciasParaRevisao`
  (só leitura).
- **O que testar em produção** (conta de teste, empresa de teste do escritório de
  teste — **nunca** salvar nas empresas da Edilse):
  1. Salvar uma folha com: um dia `08:00 13:00 13:00 17:00` (Sem intervalo), um
     `06:00 12:00 13:00 17:30` (Acima de 2h extras), um `12>54` (Horário ilegível), um
     dia útil em branco no meio do mês (Dia em branco) e uma FALTA. A seção **Revisão
     do mês** mostra o funcionário no topo com esses selos; "Abrir folha" carrega os
     dias e liga "Só os dias que pedem atenção".
  2. Corrigir um dia no editor → o selo some na hora; Salvar → a lista do mês se
     atualiza.
  3. Editar sem salvar e clicar "Abrir folha" de outro funcionário → aparece a
     confirmação.
  4. Só leitura na Edilse: Vaz & Vouzela → outubro/2026 deve mostrar ORIEL e HELBERT
     (2 de 6), com o `12>54` no dia 15; junho/2026, EDILENE com 3 "Sem intervalo".
  5. Conta de outro escritório: `GET /api/revisao-ponto?empresa=<id da Vaz>&ano=2026&mes=10`
     → 403; como **cliente** → bloqueado pelo `proxy.ts`.
- **Não verificado no navegador** nesta etapa (não há ambiente local com banco além
  do de produção). A consulta nova foi conferida contra o banco real, só leitura.
  typecheck, lint, testes e build verdes.

### Pendências

- **Convenção coletiva** (alerta do `contador`): intervalo reduzido a 30 min
  (art. 611-A III), 12x36 (art. 59-A) e turno noturno mudam as regras de jornada,
  intervalo e "fora de ordem". Hoje não há ajuste por empresa — se algum cliente
  tiver, prever "intervalo mínimo" e "escala 12x36" no cadastro da empresa.
- Perguntas para a contadora: os clientes usam intervalo pré-assinalado (só 2
  marcações)? Alguma empresa com 12x36 ou noturno?
- Cadastrar os feriados do escritório da Edilse (hoje 0): sem eles o "Feriado
  trabalhado" só vê o marcador.
- A leitura incerta da IA não é gravada: some ao salvar. Gravar exigiria coluna nova.
- O painel do contador (`/painel`) pode mostrar "pedem atenção" por empresa chamando
  `revisarMes` com as mesmas leituras da rota. Não toquei no painel.

## Resumo para a folha (Sprint 8 · Frente B)

> Por funcionário e mês, as **horas e os dias** que a contadora digitava na mão no
> programa de folha: horas normais, extras a 50% e a 100%, adicional noturno, faltas
> com perda do DSR, atestados, atrasos e dias com marcador. **Só horas e dias —
> nunca valores em reais.** Exporta **xlsx genérico** (formato de programa específico
> fica para depois) e CSV. Branch: `claude/resumo-folha-b496c0`. Migração **0022**
> (só o carimbo "conferido"; **não aplicada**).

Código: `lib/resumoFolha.ts` (puro, `tests/resumoFolha.test.ts`), exportação
`gerarPlanilhaResumo` em `lib/planilha.ts`, carimbo em `lib/resumoFolhaDb.ts`, rota
`/api/resumo-folha`, tela `app/(app)/ponto/ResumoFolha.tsx` (seção na Timesheet, logo
abaixo da "Revisão do mês"). Regras definidas com o subagente `contador` em 21/11/2026.

### Regras (mínimo legal como padrão)

| Tema | Regra | Base |
|---|---|---|
| Apuração | **Por dia**, com a jornada contratual do dia (padrão 8h, sábado de folga). Sem compensação de um dia com outro, salvo banco. | CLT art. 59 |
| Tolerância | Diferença de até **10 min no dia** (para mais ou para menos) é desprezada; passou de 10, **conta tudo**. A tolerância de 5 min *por marcação* não é aplicável (não há horário de entrada no cadastro). | art. 58 §1º; Súm. 366 |
| Extras 50% | Excedente em dia útil e **hora trabalhada em sábado de folga** (alerta "conferir": algumas convenções fixam 100%). | CF art. 7º XVI |
| Extras 100% | **Toda** hora trabalhada em domingo e feriado (cadastrado ou marcador FERIADO), sem presumir folga compensatória. | Lei 605/49 art. 9º; Súm. 146 |
| Percentuais | Editáveis na tela (50 / 100 / 20 por padrão): só mudam os **rótulos** das colunas — o resumo é em horas. | — |
| Noturno | Minutos reais entre 22h e 5h, convertidos em **hora reduzida de 52min30s** (× 8/7). O adicional (20%) incide sobre as horas computadas. A jornada é comparada **em hora computada** (22h–6h = 9h08, gera 1h08 de extra), e as extras em dia noturno saem separadas (Súm. 264). | CLT art. 73 |
| Prorrogação | Quem começou **antes da meia-noite** e ainda trabalhava às 5h segue com adicional e hora reduzida até sair (22h–6h: 8h reais noturnas = 9h08). Entrada de madrugada (já depois de 00h) só tem a faixa. Divergência (23h–7h): adotada a prorrogação, com "conferir". | art. 73 §5º; Súm. 60 II |
| Virada da meia-noite | Saída menor que a entrada, com a anterior ≥ 18h e a seguinte ≤ 12h, é tratada como o dia seguinte (o dia vale pela data de início) e avisa "conferir". Qualquer outra inversão continua "fora de ordem". | — |
| Falta | Marcador FALTA em **dia de trabalho** = falta injustificada; perde o **DSR da semana** (segunda a domingo). Duas faltas na mesma semana = **um** DSR. Falta em sábado de folga, domingo ou feriado não conta. | Lei 605/49 art. 6º |
| DSR entre meses | O DSR perdido pertence ao **mês do domingo**: falta em 29/09 (terça) aparece em outubro (olha os 7 últimos dias do mês anterior); falta em 26/10 mostra "(+1)" e avisa que o DSR vai para a folha de novembro. A contabilidade externa pode preferir o mês da falta — confirmar. | contador |
| Atestado | Dia contado, **sem débito e sem perda de DSR**. Mais de 15 dias → alerta "INSS". Férias, folga e feriado sem trabalho: contados, neutros. | Lei 8.213 art. 60 |
| Atraso | **Aproximado**: jornada do dia − trabalhado, acima de 10 min. Sem horário de entrada no cadastro, não separa atraso de saída antecipada. Não faz perder o DSR (só falta do dia inteiro). Alerta "conferir" quando existir. | art. 58 §1º |
| Banco de horas | Com acordo: extras de **dia útil** vão para "→ Banco"; atrasos e dias BANCO DE HORAS abatem o saldo (variação do mês no xlsx). **Domingo e feriado continuam a pagar a 100%** (padrão seguro: a compensação exige folga integral). Sem acordo, marcador BANCO DE HORAS pede "conferir". | art. 59 §§2º, 5º, 6º |
| Impedem fechar | Achados da revisão: **marcação faltando/desencontrada**, **horário ilegível**, **fora de ordem**, **marcador × horário** e **dia útil em branco** entre o primeiro e o último dia lançados. O dia com problema **fica fora da conta**, o funcionário ganha selo "N a corrigir" e o "Marcar como conferido" fica bloqueado. | — |

Fora do resumo (pendências): escala 12x36, tempo parcial, convenção coletiva (sábado a
100%, DSR por atraso), horistas (assume-se mensalista), atestado parcial de um dia,
interjornada < 11h como extra (Súm. 110) e intervalo suprimido pago a 50% (art. 71 §4º)
— a revisão do ponto já alerta, mas o resumo não paga. "Dessas X h extras, Y noturnas"
por minuto também ficou de fora: o resumo diz só `extrasEmDiaNoturnoMin`.

### Na tela e na exportação

- **Tabela**: funcionário (selos "N a corrigir" / "N a conferir"), dias, normais, extras
  50%, → banco, extras 100%, noturno (passe o mouse: minutos reais), atrasos, faltas,
  DSR perdido, atestado, outros dias, caixa **banco** (enquanto o cadastro não traz o
  acordo) e "Abrir folha". Percentuais e o marcador de banco recalculam na hora.
- **"Para corrigir e conferir"**: por funcionário, cada pendência com dia, selo e motivo
  (as impeditivas em vermelho).
- **"Conferido pela contadora"**: carimbo (quem e quando) guardado na 0022 com um hash
  dos totais. Se uma folha mudar depois, aparece **"conferência desatualizada"** e é
  preciso conferir de novo; "Desfazer conferência" remove. Sem a 0022 o resumo
  funciona e o botão explica que falta a atualização.
- **xlsx** (aba "Resumo": uma linha por funcionário, colunas claras, linha de
  conferência e bloco "Para conferir"; aba "Detalhe por dia": uma linha por funcionário
  × dia com situação e horas) e **CSV** (`;`, BOM, h:mm). Horas são **texto h:mm** (não
  somam como fração do dia); dias são números.

### Conferência com os dados reais (21/11/2026, só leitura)

Vaz & Vouzela, outubro/2026, 115 dias lançados de 6 funcionários, jornada padrão 8h,
sábado de folga, **sem feriados cadastrados** (12/10 vem pelo marcador FERIADO):

| Funcionário | Dias | Trabalhado | Extras 50% | Atrasos | Faltas | DSR | Atest. | Feriado | Pendência |
|---|---|---|---|---|---|---|---|---|---|
| CAIO (admitido em 26/10) | 5 | 40:14 | 1:56 | 1:47 | — | — | — | — | — |
| EDILENE | 21 | 146:31 | 3:26 | 24:45 | — | — | — | 1 | — |
| ELIELTON | 21 | 141:03 | 1:15 | 27:45 | — | — | — | 1 | — |
| HELBERT | 19 | 130:18 | 2:12 | 23:43 | 1 (26/10) | 0 (+1 em nov.) | 1 | 1 | — |
| LEONARDO | 21 | 174:50 | 8:22 | 1:17 | — | — | — | 1 | — |
| ORIEL | 19 | 162:25 | 14:10 | 3:43 | 1 (07/10) | 1 | — | 1 | dia 15 (`12>54`, fora da conta) |

Sem extras a 100%, sem noturno, sem banco. Conferidos à mão contra a marcação bruta:

- **ORIEL** — extras 14:10: são 14 dias acima de 8h10 (15+15+67+97+126+25+11+40+79+133+
  60+50+61+71 min = 850 min). Dia 09: 08:01–12:30 + 13:00–18:37 = 4:29 + 5:37 = 10:06 →
  2:06; dia 22: 06:02–14:30 + 15:50–17:35 = 8:28 + 1:45 = 10:13 → 2:13; dia 16: 8:11 →
  11 min (passou de 10, conta tudo). Falta em 07/10 (quarta) → DSR do domingo 11/10 = 1.
  O dia 15 não entra (horário ilegível), como na revisão.
- **LEONARDO** — extras 8:22 em 14 dias e atrasos 1:17: dia 16: 3:57 + 3:06 = 7:03 →
  57 min; dia 22: 3:55 + 3:45 = 7:40 → 20 min; 57 + 20 = 77 min. Bate com o "além da
  jornada: 14h10 / 8h22" que a revisão da Sprint 7 já mostrava, calculado por outro caminho.

**Atenção ao ler os atrasos:** EDILENE, ELIELTON e HELBERT fecham a maioria dos dias
com 5h–7h marcadas e acumulam 24h–28h de "atraso" no mês. Ou a jornada real deles é
menor que 8h (o cadastro não traz a jornada contratual — hoje vale o padrão da
empresa), ou há horas faltando na folha. É exatamente o que o cadastro do empregado
(`jornadaDoEmpregado`) vai resolver; **até lá, não use o "Atrasos" desses
funcionários sem conferir a jornada**.

### Para o integrador

- **Migração 0022** (aditiva, opcional): `ponto_resumo_conferido`. Sem ela o resumo
  funciona e só o botão "Marcar como conferido" avisa. A 0021 segue livre para a outra
  frente. Aplicar com `npx supabase db push` depois de conferir `migration list --remote`.
- **Rota nova** `/api/resumo-folha` (GET resumo/xlsx/csv, POST carimbo) já em
  `ROTAS_PONTO` do `proxy.ts`. `lib/pontoDb.ts` **não foi alterado** (a rota reusa
  `lerFrequenciasParaRevisao`).
- **Ligar o cadastro do empregado quando o DP chegar:** o único ponto é
  `regrasDoEmpregado()` em `lib/resumoFolha.ts` (hoje: jornada do cadastro do ponto ou
  da empresa, **sem banco**, com o marcador "banco" da tela). Trocar o corpo por
  `jornada: jornadaDoEmpregado(...)` e `temBanco: temBancoDeHoras(...)`; o resto
  (`resumirMes`, tela, exportação) não muda. Na tela, esconder a caixa "banco" quando
  o acordo vier do cadastro (hoje ela só alimenta a consulta `?banco=`).
  A revisão do ponto (`app/api/revisao-ponto/route.ts`) e o `gerar-lote` montam a
  jornada por conta própria — alinhar também, para revisão e resumo não discordarem.
- **O que testar** (conta de teste, empresa de teste — nunca salvar nas da Edilse):
  1. Folha com 10h no dia útil → extras 50% = 2h; com 7h30 → atraso 0:30; 08:00–12:00
     num domingo → 4h a 100%; marcador FALTA numa quarta → falta 1 e DSR 1; duas faltas
     na mesma semana → DSR 1.
  2. Dia com 3 marcações → selo "N a corrigir", dia fora da conta, "Marcar como
     conferido" desabilitado; corrigir e salvar → o resumo se recalcula sozinho.
  3. Marcar como conferido → carimbo; salvar outra folha → "conferência desatualizada".
  4. Baixar xlsx (duas abas) e CSV (abre com acento no Excel); mudar o percentual
     extra para 60 → o título da coluna muda, as horas não.
  5. Marcar "banco" num funcionário com extras → somem de "Extras 50%" e vão para
     "→ Banco".
  6. Só leitura na Edilse: Vaz & Vouzela → outubro/2026 deve repetir a tabela acima.
  7. Conta de outro escritório: `GET /api/resumo-folha?empresa=<id da Vaz>&ano=2026&mes=10`
     → 403; como **cliente** → bloqueado pelo `proxy.ts`.
- **Não verificado no navegador** (sem ambiente local com banco): a tela passou por
  typecheck, lint e build; o cálculo foi conferido contra o banco real (só leitura).

### Perguntas para a contabilidade externa

O DSR perdido entra na folha do mês da falta ou do mês do domingo (adotado: do
domingo)? A convenção da categoria prevê sábado a 100% ou perda de DSR por atraso? Há
banco de horas por acordo? Há horistas? Há trabalho noturno hoje (se não, a
prorrogação pode esperar)?
