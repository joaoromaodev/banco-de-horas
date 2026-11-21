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

## Sprint 9 · Frente A — jornada única

Revisão do ponto (`/api/revisao-ponto`), resumo da folha (`regrasDoEmpregado`) e planilha em
lote (`/api/gerar-lote`) montavam a jornada cada um do seu jeito. Agora os três chamam
`jornadaDaFolha` (`lib/dp.ts`), que usa `jornadaDoEmpregado`: funcionário → empresa → padrão,
sábado conforme a empresa. O resultado numérico é o mesmo de antes (a jornada diária nunca
veio do DP; só horas semanais/escala/DSR); o ganho é que não podem mais divergir.
Testes em `tests/conferenciaModulos.test.ts` (bloco `jornadaDaFolha`).

### Para o integrador (Frente A, Sprint 9)

- Tocados: `lib/dp.ts` (+ `jornadaDaFolha`), `lib/resumoFolha.ts`, `app/api/revisao-ponto/route.ts`,
  `app/api/gerar-lote/route.ts` (leem também `lerEmpregadosParaFolha`, tolerando DP ausente).
- A planilha avulsa (`/api/gerar`) não monta jornada por conta própria; não foi mexida.
- Conferir em produção: abrir revisão e resumo do mesmo mês de uma empresa real — os dias a
  cumprir e as horas devem bater com a planilha do lote (nada deve mudar em relação a antes).

## Folha enviada pelo cliente (Sprint 10 · Frente A)

> A empresa-cliente fotografa a folha manuscrita de cada funcionário no celular e
> envia; a IA lê em fila e deixa um **rascunho**; a contadora confere na Timesheet,
> ao lado da foto, e **aplica** à frequência (com desfazer) ou **devolve** com motivo.
> Nada é gravado na frequência sem a contadora. Branch: `claude/ponto-cliente-c3e04b`.
> Migração **0028** (**não aplicada**).

### O fluxo

| Passo | Quem | O que acontece |
|---|---|---|
| 1. Enviar | cliente, em **`/enviar-ponto`** (menu "Folha de ponto") | Escolhe o mês e o funcionário (lista do cadastro do ponto + DP da empresa, só nomes) e manda uma ou várias fotos: **Tirar foto** (abre a câmera traseira) ou **Escolher arquivo**. Foto grande vira JPEG de até 2.400 px no navegador antes de subir. |
| 2. Subir | navegador → Storage | Igual aos documentos: `POST /api/envio-ponto` valida o que o navegador declara, grava a linha em `enviando` e devolve URL de upload assinada para `<escritorio>/<envio>.<ext>` (bucket privado **`ponto`**); `PATCH confirmar` baixa a foto e confere tamanho e **assinatura dos bytes**. Não é imagem → `rejeitada` (foto apagada). |
| 3. Ler | IA, em fila | Logo depois da confirmação (`after()` do Next) a foto é lida pelo Gemini com a **mesma leitura da Timesheet** (`extrairFolha`), consumindo a cota do escritório. Sucesso → `lida`, com o rascunho (dias, campos incertos e o nome que a IA leu no cabeçalho). Falha → `falhou`, **não conta na cota** (fica em `ponto_leituras_ocr` como `falhou`, para o ritmo). |
| 4. Conferir | contadora, na Timesheet (`/ponto`) | Seção **"Folhas enviadas pelos clientes"** (empresa escolhida, todos os meses pendentes; as conferidas do mês num alternador). **Abrir** carrega a foto ao lado do rascunho no editor de sempre — a **revisão CLT roda ao vivo** sobre o rascunho, com os campos incertos marcados. **Aplicar à frequência** (confirmação dizendo quantos dias entram, quantos já salvos são substituídos e quantos ainda pedem atenção) → toast com **Desfazer**. **Devolver** pede o motivo (o cliente vê) → toast com Desfazer. **Ler / Tentar ler de novo** força a leitura de uma foto que esperou ou falhou. |
| 5. Acompanhar | cliente | Cada envio com selo: **Recebida** (inclui fila e leitura que falhou — o cliente não precisa saber), **Em conferência** (lida), **Conferida** (aplicada), **Devolvida** + motivo e botão "Enviar de novo". Pode excluir (confirmação + desfazer) o que ainda não foi lido ou voltou para ele (recebida, devolvida, recusada) — a folha já lida está na conferência da contadora. A lista se atualiza sozinha enquanto há folha na fila. |

Situações (`ponto_envios.situacao`): `enviando → recebida → lendo → lida | falhou → aplicada | devolvida`, e
`rejeitada`. `aguardando` diz por que uma `recebida` ainda não foi lida: `cota`, `ritmo`, `limite_empresa`, `sem_ia`.

### Decisões

| Tema | Decisão |
|---|---|
| Fila sem worker | A Vercel só roda código dentro de requisição. A leitura começa no `after()` da confirmação e é **retomada** sempre que alguém da empresa ou da contabilidade abre a lista (`GET` → `processarFila`, até 2 por vez, também em `after()`). Foto "lendo" há mais de 5 min (função morta) volta para a fila. Reivindicação atômica (`update … where situacao in (…)`): duas requisições nunca leem a mesma foto. |
| Cota | Mesma cota mensal do escritório (`lib/cotaOcr.ts`), mesmo fluxo de reserva/reconta de `/api/extrair`, mesmo ritmo (30 tentativas/10 min). Cota esgotada ou ritmo → a foto **espera** (`recebida` + `aguardando`), não falha. |
| Cota burlável pelo cliente | O cliente não dispara leitura diretamente — só enviando foto. Três freios: **40 envios por empresa por hora** (inclui recusados e abandonados); **teto de leituras automáticas por empresa e mês** = 3 × funcionários do cadastro (mín. 10, máx. 300) e **nunca acima de 25% da cota do escritório** (teste: 12; essencial: 37), recontado depois da reserva (corrida), contado em `ponto_leituras_ocr` pelo prefixo `cliente:` no `usuario`; **2 tentativas automáticas** por foto; e um **ritmo próprio** das leituras automáticas (15 em 10 min por escritório, abaixo do geral de 30), para sobrar leitura para a contadora no fechamento. Escritório em somente leitura (cobrança) não lê automaticamente. Passou do teto → "Aguardando você": a contadora decide ler (gasta leitura normal). Um cliente não esgota a cota das outras empresas do escritório. |
| Funcionário | Só da lista da empresa (ponto + DP não desligado, comparação sem caixa/espaços). A frequência liga pelo **nome**: nome livre criaria um "funcionário" novo. O `empregado_id` do DP é guardado quando há. A contadora pode trocar o nome no editor antes de aplicar (a aplicação usa o nome do editor e grava no envio). Se o nome lido no cabeçalho for outro, a fila avisa. |
| Mês | O cliente só envia mês que já começou e até 13 meses atrás. O envio fica preso ao seu mês: "Aplicar" desabilita se a contadora trocar o mês na tela. |
| Aplicar | Reivindica o envio (`aplicada`) guardando os dias que havia (`frequencia_anterior`) e só então grava (`salvarFrequencia` — substitui o mês daquele funcionário, como o "Salvar"). Se gravar falhar, o envio volta. Não aplica duas vezes. Erros da validação (ordem cronológica) seguram o botão, como seguram o "Salvar". |
| Desfazer | Volta a frequência aos dias de antes e o envio para a conferência. Vale por **12 h** (depois: abra a folha salva e corrija) e **só se a frequência ainda for exatamente a aplicada** (`frequencia_aplicada`): se a folha foi editada ou outra foto foi aplicada por cima, recusa com 409 em vez de apagar o que veio depois. Se a gravação falhar no meio, o servidor tenta voltar aos dias de antes. |
| Devolver | Motivo obrigatório (3–500 caracteres), o cliente vê. Desfazer volta à situação anterior. Devolvida não se aplica: o cliente reenvia (envio novo). |
| HEIC | Aceito (iPhone). O Gemini lê; o Chrome não mostra HEIC na tela — aviso no editor. Na prática o Safari do iPhone já converte para JPEG no envio, e o navegador reduz para JPEG quando consegue abrir. |
| Notificação | `lib/envioPontoEventos.ts` → `notificarEnvioPonto({ tipo, envioId, escritorioId, empresaId, ano, mes })`, chamado em `recebida`, `lida`, `falhou`, `aplicada`, `devolvida`. Hoje só registra no log (só ids). **A frente do sino liga aqui** o aviso à contadora ("folha nova da empresa X") e ao cliente ("folha devolvida"); quem chama não muda. |

### Segurança e LGPD

- Rotas: `/api/envio-ponto` (GET/POST/PATCH/DELETE) e `/api/envio-ponto/foto`. Em `CLIENTE_PODE` (com
  `/enviar-ponto`) e em `ROTAS_PONTO` (contador precisa do módulo ponto). Cliente: `exigirEmpresa` (só a
  própria empresa) + escritório do cadastro = o da sessão; contabilidade: `escritorioDaEmpresa` de
  `lib/pontoAcesso.ts`. Por id: `podeVerEnvio` exige o `escritorio_id` **gravado no envio** = o da sessão.
  Só o cliente inicia envio; só a contabilidade lê, aplica e devolve; só quem iniciou confirma.
- Foto: bucket privado, sem policies; caminho só com uuids do servidor; token de upload sem `upsert`; leitura
  por URL assinada de **60 s** com `no-store` e `no-referrer` (a URL não fica na tela).
- Tipos: JPG, PNG, WEBP, HEIC até **8 MB** — em `TIPOS_FOTO`/`LIMITE_FOTO_BYTES` (`lib/envioPonto.ts`), no bucket e
  no CHECK da 0028 (andam juntos; um teste trava a lista). Assinatura dos bytes conferida no servidor.
- O cliente recebe só situação, motivo e datas: sem rascunho, sem e-mails da equipe, sem caminho.
- Logs sem conteúdo da folha (só ids e mensagem curta do erro). A foto e o nome vão ao Gemini — o mesmo da
  Timesheet (ver a pendência do nível pago da `GEMINI_API_KEY`).
- **Retenção:** a foto é apagada do Storage **90 dias** depois de o envio terminar (aplicado, devolvido ou
  excluído), em **1 dia** se foi recusada ou abandonada (a recusa não marca a foto como apagada: o token de upload
  ainda vale ~2 h e a faxina apaga o que tiver sido subido de novo) e, em qualquer caso, **180 dias** depois do envio,
  mesmo parada na fila (`expurgarFotos`, no cron diário; o JSON do cron ganhou `fotosPonto`). As cópias da
  frequência do desfazer (`frequencia_anterior`/`frequencia_aplicada`) são limpas depois de 12 h. Upload com
  `cacheControl: 0`. A linha fica (histórico, rascunho), com `foto_apagada_em`. O prazo de guarda da frequência
  em si continua sendo decisão do jurídico.

### Arquivos

- `supabase/migrations/0028_ponto_envios.sql`
- `lib/envioPonto.ts` (regras puras), `lib/envioPontoServidor.ts` (banco, Storage, leitura, faxina),
  `lib/envioPontoEventos.ts` (gancho de notificação)
- `app/api/envio-ponto/route.ts`, `app/api/envio-ponto/foto/route.ts`
- `app/(app)/enviar-ponto/page.tsx` (cliente), `app/(app)/ponto/FolhasEnviadas.tsx` (fila) e trechos de
  `app/(app)/ponto/page.tsx` (abrir envio, aplicar, devolver, desfazer)
- Compartilhados, mudança mínima: `proxy.ts` (listas), `app/(app)/layout.tsx` (item do menu do cliente),
  `app/(app)/icones.tsx` (`IconeCamera`), `app/api/cron/agenda/route.ts` (faxina das fotos)
- `tests/envioPonto.test.ts`, `tests/envioPontoRotas.test.ts`

### Para o integrador

- **Migração 0028** (aditiva, idempotente): tabela `ponto_envios` + bucket privado `ponto`. Depende só da 0012
  (e da 0010). Conferir antes `npx supabase migration list --remote` (0024–0027 são de outras frentes e vêm antes:
  o Supabase não aplica número menor depois de maior). Aplicar com `npx supabase db push` ou colar no SQL Editor. Confira em
  *Storage* que o bucket `ponto` está **privado**, 8 MB, só imagens.
  Reversão: `drop table if exists ponto_envios;` e apagar o bucket `ponto` no painel (vazio).
- Sem a 0028: a tela do cliente mostra "ainda não disponível", a fila da Timesheet não aparece, o resto do
  ponto segue igual.
- Sem variável nova (usa `GEMINI_API_KEY`). Sem cron novo (o diário existente faz a faxina).
- `maxDuration` da rota = 60 s (a leitura roda no `after()` dentro desse tempo).
- **O que testar** — conta de teste, escritório criado em `/criar-conta`, empresa e usuário cliente de teste.
  **Nunca** nas empresas da Edilse (NÉLIO, Vaz & Vouzela, L A T Hage):
  1. Contadora: cadastrar 2 funcionários na empresa de teste (Cadastros do ponto). Criar usuário `cliente`.
  2. Cliente, no celular: menu "Folha de ponto" → mês anterior → funcionário → **Tirar foto** de uma folha de
     teste → Enviar. Selo "Recebida"; em ~20 s, "Em conferência". A linha "Leituras por IA" da Timesheet sobe 1.
  3. Mandar um PDF ou um `.txt` renomeado para `.jpg` → recusado; mandar 2 fotos de uma vez → 2 envios.
  4. Contadora, Timesheet → empresa de teste: "Folhas enviadas pelos clientes" mostra a folha "Lida pela IA".
     **Abrir** → foto ao lado, mês e funcionário trocados sozinhos, campos incertos em amarelo, revisão no topo.
     Corrigir um dia → **Aplicar** → confirmação → toast "aplicada" com Desfazer; a Revisão do mês e o Resumo
     se atualizam. **Desfazer** → a frequência volta ao que era e a folha volta para a fila.
  5. **Devolver** com motivo → o cliente vê "Devolvida" + motivo e "Enviar de novo".
  6. Cliente exclui um envio não conferido → Desfazer traz de volta.
  7. Isolamento: cliente de outra empresa do mesmo escritório → `GET /api/envio-ponto?empresa=<id>` 403 e
     `/api/envio-ponto/foto?id=<id>` 404; contador de outro escritório → 403/404; cliente →
     `PATCH { acao: 'aplicar' }` 403.
  8. A URL da foto (aba Rede) expira em 60 s.
  9. Cron: `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/agenda` → JSON com `fotosPonto`.
  Apague o escritório de teste no fim (as fotos somem pela faxina; ou remova a pasta `<escritorio>/` no bucket).
- **Não verificado no navegador** (sem banco local; a 0028 não existe em lugar nenhum ainda): typecheck, lint,
  testes (regras e rotas com banco simulado) e build verdes.

### Pendências

- A página `/enviar-ponto` aparece para todo cliente, mesmo de escritório que não usa a folha de ponto (o
  módulo é por usuário da contabilidade, não por escritório). Se incomodar: esconder o item quando a empresa
  não tem funcionário no cadastro do ponto.
- Ligar `notificarEnvioPonto` ao sino (frente de notificações).
- Revisão do **escudo** (21/11/2026): nenhum furo de isolamento (PATCH/DELETE/foto por id de outro escritório
  ou empresa → 404; cliente não aplica, não devolve, não força leitura). Corrigidos: desfazer sobrescrevendo
  edição posterior, ritmo das leituras automáticas saturando o do escritório, corrida no teto por empresa e no
  limite por hora, foto pendente sem prazo de guarda, órfão de reenvio após recusa, teto acima da cota de
  planos pequenos, nome do funcionário com grafia diferente ao aplicar, cache da foto, cliente excluindo folha
  em conferência, aplicação pela metade, leitura em escritório somente leitura. **Ficou em aberto:** registro
  de quem abriu a foto (auditoria, inclusive do master); confirmar o **nível pago** da `GEMINI_API_KEY` e
  citar na política de privacidade os prazos (90/180 dias) e o Google como suboperador (jurídico).
- Painel do contador (`/painel`) pode mostrar "N folhas enviadas para conferir" por empresa (contar
  `ponto_envios` com `situacao in (recebida, lida, falhou)`).
- Foto com mais de uma página (frente e verso): hoje cada foto é um envio e um rascunho; a contadora aplica a
  principal e devolve/exclui a outra. Juntar duas fotos numa leitura fica para depois.
