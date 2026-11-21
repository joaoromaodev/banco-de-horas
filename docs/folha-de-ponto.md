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
