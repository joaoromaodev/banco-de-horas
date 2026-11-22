# Portal do cliente — documentos e pendências (Sprint 3 · Frente B)

> O cliente envia nota, extrato e recibo direto para o escritório, por competência
> e categoria; o contador confere. O contador também **pede** o que falta
> (pendência) e o cliente atende enviando o arquivo. Tela única em `/documentos`.

## Decisões

| Tema | Decisão |
|---|---|
| Rota | `/documentos` para os dois lados. Cliente vê a própria empresa; contabilidade escolhe a empresa no topo (lembrada no navegador). |
| Módulo | Não entra em `ROTAS_PONTO` nem `ROTAS_CAIXA`: todo contador do escritório alcança. O cliente alcança porque `/documentos`, `/api/documentos` e `/api/pendencias` estão em `CLIENTE_PODE` (`proxy.ts`). |
| Tabelas | `documentos` e `pendencias` (migração `0015`), RLS ligada sem policies. Ambas com `empresa_id` e `escritorio_id` (FK `escritorios`), gravado pelo servidor a partir do cadastro da empresa — nunca do navegador. **Sem FK para `empresas`**, de propósito (como a 0009): com FK, `salvarEmpresas` falharia no meio ao remover uma empresa com documentos (o upsert já teria gravado). |
| Recorte | Duas travas. (1) `exigirEmpresa` de `lib/acesso.ts` na empresa do pedido; (2) sobre o registro carregado, `podeVerRegistro` (`lib/documentos.ts`) exige que o `escritorio_id` **gravado no registro** seja o da sessão e que a empresa seja visível. Leituras de lista filtram também por `escritorio_id` na própria consulta. Registro sem escritório: só o master (falha fechada). |
| Quem faz o quê | Cliente: envia, vê, exclui o que ainda **não** foi conferido (e desfaz a própria exclusão, **não** a feita pela contabilidade — `excluido_por_gestor`), atende pendência aberta. Os e-mails de quem enviou/conferiu/criou não vão no JSON do cliente. Contabilidade: tudo isso + conferir/desconferir, excluir qualquer documento, abrir/editar/fechar/reabrir/excluir pendência. Regras puras em `lib/documentos.ts`, testadas. |
| Envio | Dois passos para o arquivo **não passar pela função** (limite de corpo da Vercel ~4,5 MB): `POST /api/documentos` valida o que o navegador declara, grava a linha em `enviando` e devolve uma **URL de upload assinada** para um caminho escolhido no servidor (`<escritorio_id>/<documento_id>.<ext>`, só uuids). O navegador sobe direto ao Storage. `PATCH { acao: 'confirmar' }` faz o servidor **baixar o objeto e conferir tamanho e assinatura dos bytes**; se não bater, apaga o objeto e marca a linha como `rejeitado` (a linha **fica**: conta no limite por hora e aponta o caminho para a faxina — o token de upload vale 2 h e não dá para encurtar, então alguém poderia subir de novo naquele caminho). Só o que passa vira `recebido`. Sobrescrever um objeto já confirmado não é possível: o token é gerado sem `upsert`. |
| Download | `GET /api/documentos/arquivo?id=` → guarda → URL assinada de **60 s** com `download=<nome original>` (força anexo) → redirect 302 com `Cache-Control: no-store` e `Referrer-Policy: no-referrer`. A URL nunca fica na tela. |
| Tipos aceitos | Lista de permissão: PDF, JPG, PNG, WEBP, HEIC, XML (NF-e), OFX, CSV, XLSX. Fora: HTML, SVG, JS, executáveis, Office com macro, ZIP. XML com HTML/XHTML/SVG/script nos primeiros 4 KB é recusado (o `download=` da URL assinada pode ser removido por quem tem a URL, e o arquivo abriria no domínio do Storage). A mesma lista vive em três lugares que **precisam andar juntos**: `TIPOS_ACEITOS` (`lib/documentos.ts`), `allowed_mime_types` do bucket e o CHECK de `documentos.tipo` (0015). Um teste trava a lista. |
| Tamanho | 10 MB por arquivo (`LIMITE_BYTES` = `file_size_limit` do bucket = CHECK da coluna). |
| Abuso | No máximo 60 envios iniciados por empresa por hora (inclui os não concluídos). |
| Nome do arquivo | Original limpo (`nomeSeguro`) só para exibir e para o `download=`; nunca entra no caminho do Storage. |
| Pendência ↔ documento | O documento aponta para a pendência (`documentos.pendencia_id`) — uma pendência pode ser atendida por vários arquivos (ex.: 3 extratos). Ao confirmar um envio vinculado, a pendência aberta vira `atendida`. Se o cliente excluir o último envio vivo que a atendia, ela **reabre** (não dá para "atender" apagando). O contador fecha à mão ou reabre quando quiser. |
| Excluir | Lógico (`excluido_em`) com confirmação + **Desfazer** (`PATCH { acao: 'restaurar' }`), como no resto do sistema. O arquivo fica no Storage. |
| Competência | `AAAA-MM`, padrão = mês anterior (o que o cliente costuma mandar). |
| Erros | Mensagem do banco não vai para a tela (vai para o log com código e mensagem, sem `details`); a tela recebe texto genérico. Sem a migração (`42P01`/`PGRST205`), as rotas respondem 503 e a tela mostra aviso de "módulo não instalado". |
| Revisão | O agente `escudo` revisou (isolamento, URLs assinadas, tipos, LGPD) e não achou caminho entre escritórios/empresas. O que ele apontou e foi corrigido: FK para `empresas`, órfão por reenvio após recusa, cliente restaurando exclusão do contador, XML com XHTML, e-mails no JSON do cliente, erro de check virando "aplique a migração", id não-uuid virando 502, caracteres bidirecionais no nome. O que ficou está em "Pendências". |

## Arquivos

- `supabase/migrations/0015_documentos_pendencias.sql`
- `lib/documentos.ts` (regras puras) e `lib/documentosServidor.ts` (banco + Storage)
- `app/api/documentos/route.ts`, `app/api/documentos/arquivo/route.ts`, `app/api/documentos/comum.ts`, `app/api/pendencias/route.ts`
- `app/(app)/documentos/page.tsx`
- `tests/documentos.test.ts` (regras puras) e `tests/documentosRotas.test.ts` (rotas com banco simulado: outro escritório, outra empresa, cliente sem poder de gestão)
- Compartilhados (mudança mínima): `proxy.ts` (`CLIENTE_PODE`) e `app/(app)/layout.tsx` (item "Documentos" no menu do cliente e da contabilidade).

## Sprint 5 · Frente B — pedidos mensais (pendências recorrentes)

Migração **0018** (**não aplicada**): tabela `pendencias_recorrentes` e coluna `pendencias.modelo_id`.
Regras puras em `lib/fechamento.ts` (`tests/fechamento.test.ts`), banco em `lib/fechamentoServidor.ts`,
rota `app/api/pendencias-recorrentes/route.ts`, tela `app/(app)/fechamento/page.tsx` ("Pedidos mensais"
no menu, só contabilidade).

| Tema | Decisão |
|---|---|
| O que é | O escritório define, **por empresa**, o que pede todo mês: título, categoria e dia do prazo (1–28). O "modelo padrão" (Extrato bancário, Notas fiscais, Recibos, Informações da folha) é uma lista no código (`MODELO_PADRAO`): a tela marca os itens, escolhe várias empresas e aplica — só entra o que a empresa ainda não pede (título + categoria). Tudo ou nada: confere o acesso a todas as empresas antes de gravar. Aplicar devolve os ids e a tela oferece **Desfazer**. |
| Abertura | O cron diário (`/api/cron/agenda`, o mesmo — Vercel Hobby) chama `abrirPendenciasRecorrentes`: para cada modelo ativo de empresa ativa (não arquivada, escritório não suspenso) abre a pendência da **competência anterior** com prazo = dia escolhido do mês corrente. Roda **todo dia**, não só no 1º: a Vercel não refaz chamada que falhou, então quem perdeu o dia 1º abre no dia 2. Modelo criado neste mês espera o mês seguinte. |
| Idempotência | Índice único `(modelo_id, competencia)` em `pendencias`. Vale também para a pendência **excluída**: quem apagou um pedido do mês não o vê reaparecer. Cron chamado duas vezes não duplica (violação `23505` conta como "já existia"). |
| Fechar sozinho | Ao **confirmar** o envio de um documento sem pedido explícito, `fecharRecorrenteDoDocumento` procura pendência recorrente **aberta** da mesma empresa + categoria + competência, fecha (atendida) e liga o documento a ela (`documentos.pendencia_id`) — assim o "reabre se excluir o último envio" de sempre continua valendo. Havendo mais de uma, a de prazo mais próximo. **Só as nascidas de modelo** fecham sozinhas; pedido manual continua exigindo o vínculo explícito. Falha nessa etapa só vai para o log: o arquivo já chegou. |
| Um documento basta | Um extrato fecha o "Extrato bancário" mesmo que a empresa tenha duas contas; o contador reabre à mão se achar que não serviu (como já era). |
| Acesso | `/api/pendencias-recorrentes` só `exigirGestor` + `podeAcessarEmpresa`; fica **fora** do prefixo `/api/pendencias` (que está em `CLIENTE_PODE`) de propósito. `escritorio_id` vem da empresa, nunca da sessão nem do navegador. |
| Resposta do cron | O JSON ganhou `fechamento: { modelos, abertas, ja_existiam, falhas }` (ou `{ erro }`). |
| Limite conhecido | Editar um pedido mensal = pausar/excluir e criar de novo (a tela só liga/desliga e exclui). |

### Para o integrador (Frente B)

- **Aplicar a 0018** (mesmo arquivo da agenda — ver `docs/agenda.md`): depende da 0010 e da 0015.
  Reversão: `alter table pendencias drop column if exists modelo_id; drop table if exists pendencias_recorrentes, empresa_regime;`.
- Sem variável nova. Sem `vercel.json` novo: o cron existente cobre.
- Testar em produção com **conta de teste** (escritório criado em `/criar-conta`, nunca a Edilse):
  1. "Pedidos mensais": aplicar Extrato + Notas em duas empresas de teste → toast com Desfazer.
  2. O modelo só vale a partir do mês seguinte; para simular:
     `curl -H "Authorization: Bearer $CRON_SECRET" "https://<app>/api/cron/agenda?dia=<1º do mês que vem>"` →
     `fechamento.abertas` = 4; repetir a chamada → `abertas` = 0 e `ja_existiam` = 4.
  3. Em Documentos, as pendências aparecem com prazo e competência do mês anterior.
  4. Como cliente da empresa de teste: enviar PDF categoria Extrato na competência pedida → a pendência
     vira "atendida"; excluir o documento → reabre; Desfazer → atendida de novo.
  5. Documento de outra categoria ou competência → nada fecha.
  6. Isolamento: logado em outro escritório, `GET /api/pendencias-recorrentes?empresa=<id de teste>` → 403; cliente → 403.
  Atenção: a simulação com `?dia=` cria pendências de verdade; apague o escritório de teste no fim.

## Para o integrador

### Aplicar a 0015

1. `git fetch` e `npx supabase migration list --remote` — confirme que `0015` está
   livre e que a `0010` está aplicada (a 0015 depende só dela; é independente de
   0011–0014).
2. Aplique (`npx supabase db push` ou cole o arquivo no SQL Editor). É
   idempotente. Ela cria as duas tabelas, os índices e o **bucket privado
   `documentos`** (`insert into storage.buckets … on conflict do update`, que também
   força `public = false` se alguém tiver criado o bucket à mão).
3. Confira:
   ```sql
   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'documentos';
   -- public = false, 10485760, 9 tipos
   select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects';
   -- nenhuma policy deve dar acesso ao bucket 'documentos'
   ```
4. Sem variável nova: usa `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SECRET_KEY`.
5. Reversão: o código novo só é alcançado por `/documentos`; tirar o item do menu
   e as três rotas de `CLIENTE_PODE` desliga a frente. As tabelas podem ficar.

### Testar em produção (conta de teste, nunca empresa real)

1. Crie um escritório de teste em `/criar-conta`, uma empresa e um login `cliente`
   para ela.
2. Como **cliente**: `/documentos` aparece no menu; envie um PDF, uma foto pelo
   celular (botão "Tirar foto") e um OFX. Os três aparecem como "A conferir".
3. Renomeie um `.txt`/`.exe` para `.pdf` e envie → recusado ("conteúdo não
   corresponde"); no Storage o objeto não deve sobrar e a linha fica `rejeitado`.
4. Arquivo de 11 MB → recusado antes de subir.
5. Clique num documento → baixa com o nome original. Copie a URL do redirect e
   abra depois de 1 minuto → expirada.
6. Como **contador** do escritório de teste: abra uma pendência com prazo; como
   cliente, "Enviar agora" → a pendência vira atendida. Exclua o documento →
   a pendência reabre; Desfazer → volta a atendida.
7. Contador confere um documento → o cliente não consegue mais excluí-lo. Contador
   exclui outro → o cliente não consegue desfazer.
8. **Isolamento**: logado como a Edilse (ou outro escritório), chame
   `GET /api/documentos/arquivo?id=<id do teste>`, `PATCH /api/documentos`
   (`conferir`, `restaurar`) e `DELETE /api/pendencias?id=<id do teste>` → 404/403.
   Como cliente, `GET /api/documentos?empresa=<outra empresa>` → 403.
9. Apague o escritório de teste no fim (documentos e objetos no bucket também).

## Pedido mensal sem dia de prazo e documentos de arquivada (Sprint 7)

- `POST /api/pendencias-recorrentes`: `diaPrazo` deixou de ser obrigatório. Se não vier
  (`undefined`, `null`, `''`), vale o **prazo padrão do escritório**
  (`escritorios.prazo_pedidos_padrao`, via `prazoPadraoDoEscritorio`; master usa o da
  primeira empresa; sem o dado, 10). Se vier, continua validado (1–28 inteiro) → 400.
  `PATCH acao: 'editar'` sem `diaPrazo` mantém o dia atual do pedido.
  Regra pura: `resolverDiaPrazo` (`lib/fechamento.ts`), testada em `tests/arquivadasConsulta.test.ts`.
- Documentos de empresa **arquivada** podem ser consultados e baixados (somente leitura);
  enviar, excluir ou mexer em pendências dela dá 409/403. Ver `docs/multi-escritorio.md`.

### Para o integrador (pedido mensal / documentos)
- **Sem migração** (a 0019, do prazo padrão, já deve estar aplicada; sem ela o padrão é 10).
- Testar com escritório de teste: ajustar o prazo padrão em Escritório (ex.: 15);
  `POST /api/pendencias-recorrentes` com `{empresas:[id], itens:[{titulo, categoria}]}`
  (sem `diaPrazo`) → o modelo criado tem `diaPrazo 15`; com `diaPrazo: 40` → 400.

## Pendências e armadilhas

- **`/api/empresas` devolve `e.message` cru** (`app/api/empresas/route.ts`) — fora do escopo desta frente; trocar por mensagem genérica com log na integração.
- **Faxina e retenção (LGPD, importante)**: falta rotina agendada que apague objeto **e** linha de: `enviando` com mais de 1 dia; `rejeitado` (varrendo também o **bucket** contra a tabela, para pegar objeto sem linha); excluídos há mais de N dias (sugestão do Escudo: 30); tudo de escritório cancelado há 90 dias, como promete a política de privacidade. O prazo é decisão de produto/jurídico.
- **Política de privacidade** não cita o portal de documentos nem a região do Supabase (transferência internacional, art. 33 da LGPD) — revisar com o jurídico antes de cliente real usar.
- **Limite por hora não é atômico** (pedidos paralelos passam juntos) e **não há cota em bytes por escritório**. Para produção com volume: contador no Postgres.
- **CSV/XLSX podem levar fórmula** (`=HYPERLINK`, DDE) para o Excel do contador. Não bloqueamos; vale um aviso na tela ou no treinamento.
- **Empresa que troca de escritório**: os documentos antigos ficam com o `escritorio_id` antigo (o escritório antigo ainda os abre por id; o novo não os vê). Decidir se migram junto.
- **Acesso do master** a todos os documentos: entra na auditoria ou fica restrito — decisão em aberto.

- **Resumo na entrada do `/caixa`**: não entrou — exigiria mexer em
  `app/(app)/caixa/page.tsx`, que é da frente do catálogo. Para a integração:
  chamar `GET /api/pendencias` (devolve `resumo: { abertas, vencidas }`) e, se
  `abertas > 0`, mostrar um `<Aviso>` com link para `/documentos`.
- **Guarda legal**: documentos contábeis em geral têm guarda de 5 anos — a regra de retenção acima precisa conciliar isso com a LGPD.
- `lerEmpresa` usa o cache de empresas de `lib/cadastro.ts` (TTL curto): uma
  empresa movida de escritório pode levar alguns segundos para refletir aqui.

## Sprint 10 · Frente B — documentos no sino

Documento novo (`status = recebido`, últimos 14 dias) e pendência atendida pelo cliente viram
notificação no sino da contabilidade, derivadas das próprias tabelas — sem coluna nova. Detalhes
em [`notificacoes.md`](notificacoes.md).

### Para o integrador (Sprint 10 · Frente B)

- Nada em `documentos`/`pendencias` mudou. O sino só lê `documentos.enviado_em`,
  `pendencias.atendida_em` e `atendida_por`.

## Sprint 12 · Frente A — documento → lançamento por IA

Um documento do portal (foto ou PDF, categorias nota, recibo ou outros) pode ser lido por IA
para propor um lançamento do Livro Caixa, e o lançamento fica com ele anexado
(`lancamentos.documento_id`, migração **0029**). Desligado por padrão (variável da plataforma
+ opção por empresa). Enviar pelo Livro Caixa usa este mesmo fluxo (`POST` → Storage →
`PATCH confirmar`) e o documento aparece aqui, com a observação "Enviado pelo Livro Caixa".
Nada muda nas regras deste portal; só entrou `baixarArquivo` em `lib/documentosServidor.ts`
(reconfere tamanho e assinatura antes da leitura). Regras, LGPD e "Para o integrador" em
[`livro-caixa.md`](livro-caixa.md), seção "Documento → lançamento sugerido por IA".

## Sprint 14 · Frente A — pedidos mensais sem depender do cron

**Problema:** sem `CRON_SECRET` na Vercel, `/api/cron/agenda` responde 503 e os pedidos mensais
não abriam — calado. Agora a **primeira visita do mês** abre os pedidos do escritório:

| O quê | Como |
|---|---|
| Quem dispara | A contadora (`usuario` com escritório) no `GET /api/painel` e o cliente no `GET /api/inicio-cliente`. Sempre o escritório **da sessão**; o master não dispara. O cliente abre os pedidos do escritório inteiro (o mesmo que o cron faria) — nada disso volta na resposta dele. |
| Onde | `lib/pedidosNaVisita.ts` → `abrirPendenciasRecorrentes(hoje, ativas, { escritorioId })` (novo terceiro parâmetro opcional: só os modelos daquele escritório). Mesmo recorte do cron: empresa não arquivada, escritório não suspenso. |
| Barato | `escritorios.pedidos_competencia_aberta` (migração **0030**) guarda a última competência aberta; o processo também a guarda em memória. Visitas seguintes do mês: zero consultas (mesmo processo) ou uma (processo novo). O cron também grava a marca (só no dia real; `?dia=` é simulação), e a marca só avança. |
| Idempotente | A trava é o índice único **que já existia** `pendencias_modelo_competencia_uniq (modelo_id, competencia)` da 0018 — o modelo é de uma empresa só, então vale por (modelo, empresa, competência). Visitas simultâneas em processos diferentes (ou visita + cron): o segundo insert recebe 23505 e conta como "já existia". No mesmo processo, visitas simultâneas compartilham a mesma promessa. **A 0030 não cria índice.** |
| Falha | Nunca derruba a tela (`abrirPedidosNaVisita` não lança). Com qualquer falha de insert a marca **não** é gravada: a próxima visita tenta de novo. |
| Limite conhecido | Empresa reativada (desarquivada) ou modelo religado no meio do mês, depois da marca: a visita não reabre; o cron, quando ligado, abre no dia seguinte. |

Testes: `tests/pedidosNaVisita.test.ts` (abertura, memória, marca, concorrência no mesmo processo e
entre processos com o índice único simulado, sem a 0030, falha) e `tests/pedidosNaVisitaRotas.test.ts`
(quem dispara, ordem antes da leitura, master não dispara).

### Para o integrador (Sprint 14 · Frente A — pedidos na visita)

- **Migração 0030** (`supabase/migrations/0030_pedidos_na_visita.sql`): uma coluna nullable em
  `escritorios`, sem índice. Aditiva; o código funciona sem ela (só memória do processo; no pior caso
  refaz a conferência, que é idempotente). Ordem publicar/aplicar indiferente. **Não foi aplicada em
  banco nenhum.**
- Arquivos compartilhados tocados: `lib/fechamentoServidor.ts` (parâmetro opcional),
  `app/api/painel/route.ts`, `app/api/inicio-cliente/route.ts`, `app/api/cron/agenda/route.ts`.
- Testar em produção (conta de teste): com a 0030 aplicada, zerar a marca do escritório de teste
  (`update escritorios set pedidos_competencia_aberta = null where id = '<teste>'`), ter um pedido
  mensal criado antes do dia 1º e abrir o `/painel` → a pendência da competência anterior aparece em
  Documentos; abrir de novo → nenhuma duplicada; a marca vira `AAAA-MM`.

## Sprint 17 · Frente A — documentos de mão dupla

Até aqui o portal só ia do cliente para o escritório. Agora vai e volta (ideias 1 e 3 de
[`empresa/concorrentes.md`](empresa/concorrentes.md)). Migração **0032** (**não aplicada**).

### 1. Escritório → cliente, com registro de leitura ("entregas")

| Tema | Decisão |
|---|---|
| O que é | A contadora publica para uma empresa um documento — **guia, DAS, holerite, declaração ou outro** — com competência, vencimento opcional, título e observação opcionais. O cliente vê em `/documentos` ("Da contabilidade para você") e no `/inicio`, recebe aviso no sino e baixa. |
| Tabela | `entregas` (0032), RLS ligada **sem policies**, `escritorio_id` gravado pelo servidor a partir do cadastro da empresa, sem FK para `empresas` (mesmo motivo da 0015). Situação `enviando → publicada` (ou `rejeitada`). |
| Storage | O **mesmo bucket privado `documentos`**, no caminho `<escritorio_id>/entregas/<id>.<ext>` (só uuids; prefixo próprio para a faxina distinguir do que o cliente enviou). Mesmo envio em dois passos (URL de upload assinada + `PATCH confirmar`, que confere tamanho e assinatura dos bytes), mesmos tipos e 10 MB. Download por URL assinada de 60 s, anexo, `no-store`, `no-referrer`. |
| "Aberto em" | É o **primeiro download feito pelo cliente** pelo portal (`GET /api/entregas/arquivo`). Gravado com `where aberto_em is null` (abrir de novo, ou dois cliques juntos, não muda a data) e `aberto_por` = e-mail do login do cliente (só a contabilidade vê). O download da contabilidade **não conta**. Link vindo de outro site (`Sec-Fetch-Site: cross-site`/`same-site`) baixa mas não conta. Falha ao gravar não impede o download (no pior caso a contadora vê "não baixado" e lembra de novo). A tela diz **"Baixado pela empresa em …"**: prova que o navegador do cliente pediu o arquivo, não que ele leu. |
| Quem não abriu | Na lista da empresa: "Ainda não baixado" (neutro), "vence logo" (até 3 dias, aviso) ou "vencido" (perigo). No topo de `/documentos`, um aviso com as **não abertas perto do vencimento de todas as empresas** (`GET /api/entregas?visao=nao-abertas`, só gestor, recortado pelas empresas visíveis e pelo escritório da sessão); clicar troca a empresa. |
| Quem faz o quê | Publicar, excluir (lógico, com confirmação + desfazer) e restaurar: só a contabilidade do escritório (`exigirGestor` + `podeGerirEntrega`). Confirmar a publicação: só quem a iniciou. Cliente: lista e baixa as da **própria** empresa. `/api/entregas` entrou em `CLIENTE_PODE`. Limite de 60 publicações por empresa por hora. |
| Sino e `/inicio` | Aviso "A contabilidade enviou um documento para você" enquanto não foi baixado (some depois), com **tipo, competência e vencimento — sem título nem nome do arquivo** (a contadora pode escrever "Holerite da Maria"). Lembrete quando vence em até 3 dias. No `/inicio`, bloco com link de download direto por item, os mais urgentes primeiro. |
| Arquivada | A contabilidade lista e baixa (consulta); publicar/excluir dão 409; o cliente dela leva 403. Outro escritório: 403/404 sem saber que está arquivada. |

### 2. Situação de cada documento enviado pelo cliente

- `recebido` → **aceito** (`conferido`, o nome da coluna da 0015) ou **devolvido** com motivo
  (0032: `devolvido_em`, `devolvido_por`, `motivo_devolucao` ≤ 500; o CHECK de `status` ganhou
  `devolvido`). Regras puras em `lib/documentos.ts` (`proximaSituacao`, `podeMudarSituacao`,
  `motivoDevolucao`): aceito ↔ devolvido e "voltar para a conferir" (`desconferir`) a partir de
  qualquer um dos dois. A gravação exige a situação de partida (duas abas não se atropelam).
- Só a contabilidade muda a situação. Devolver pede motivo (erro no campo); o toast oferece
  **Desfazer** (volta para "a conferir").
- Pedido ligado ao documento: devolver **não atende** — se não sobrar outro envio vivo, o pedido
  reabre (como ao excluir); desfazer a devolução atende de novo.
- Cliente: vê a situação (Recebido / Aceito / Devolvido) e o motivo, e tem **"Enviar de novo"**
  (o formulário vem com categoria, competência e o pedido). Não exclui o devolvido (fica como
  histórico). O devolvido continua baixável pelos dois lados.
- Sino do cliente: "Documento devolvido pela contabilidade · Extrato bancário · out/2026 · Veja o
  motivo em Documentos." — **sem o motivo** (texto livre, pode citar pessoa; revisão do Escudo) e
  sem o nome do arquivo. Some quando chega outro envio vivo da mesma categoria e competência
  (`devolvidosSemReenvio`). No `/inicio`, bloco "N documentos voltaram para você" com o motivo.

### 3. "Não tenho este mês" e lembrete antes do prazo

- No pedido aberto, o cliente (ou a contadora, anotando o que ouviu) responde **"Não tenho este
  mês"** ("Não tenho", se o pedido não tem competência), com observação opcional
  (`PATCH /api/pendencias { acao: 'nao-tenho', observacao }`). O pedido vira `atendida` com
  `sem_movimento_em/por/obs` (0032) — por isso o **checklist de fechamento** (`lib/fechamento.ts`,
  que conta só `aberta` como falta) deixa de mostrar atraso falso **sem mudar nada lá**.
- Desfazer: o toast (e o botão na lista de atendidas) chama `desfazer-nao-tenho`, que só reabre
  pedido fechado **pelo "não tenho"**. Fechar à mão e reabrir (contabilidade) apagam a marca;
  devolver/excluir um arquivo antigo **não** reabre pedido respondido com "não tenho".
- Sino da contabilidade: "O cliente não tem este documento no mês" no lugar de "Pedido atendido".
- **Lembrete**: pedido aberto (e entrega não baixada) que vence de hoje a **3 dias**
  (`DIAS_LEMBRETE`, a mesma janela do "vence logo") vira aviso no sino do cliente, datado da
  meia-noite de Belém do 1º dia da janela (a chave leva o prazo: mudou o prazo, lembra de novo).
  No `/inicio` o item ganha "Vence em 2 dias (23/11)" em amarelo.

### Antes da 0032

O código funciona sem a migração: as leituras de `documentos`/`pendencias` tentam com as colunas
novas e, com `42703`, repetem sem elas (e lembram disso por 5 min); `/api/entregas` responde 503
"aplique a 0032"; devolver e "não tenho" também (coluna ausente ou `23514` do CHECK antigo);
aceitar, reabrir e o resto seguem. O sino e o `/inicio` do cliente tratam a falta de `entregas`
como "nada a mostrar" (não como fonte indisponível). Testado em `tests/documentosSem0032Rotas.test.ts`.

### Arquivos

- `supabase/migrations/0032_documentos_mao_dupla.sql`
- `lib/entregas.ts` (regras puras) e `lib/entregasServidor.ts` (banco + Storage)
- `lib/documentos.ts` (situação, "não tenho", `diasAte`/`DIAS_LEMBRETE`) e `lib/documentosServidor.ts`
  (`mudarSituacao` no lugar de `conferirDocumento`, `marcarSemMovimento`, `desfazerSemMovimento`,
  leitura com e sem a 0032)
- Rotas novas `app/api/entregas/route.ts` e `app/api/entregas/arquivo/route.ts`; alteradas
  `app/api/documentos/route.ts` (PATCH `devolver`), `app/api/documentos/arquivo/route.ts` (baixa o
  devolvido), `app/api/pendencias/route.ts` (`nao-tenho`, `desfazer-nao-tenho`),
  `app/api/inicio-cliente/route.ts`
- Sino e início: `lib/avisosCliente.ts`, `lib/avisosClienteServidor.ts`, `lib/notificacoes.ts`,
  `lib/notificacoesServidor.ts`, `lib/inicioCliente.ts`, `lib/inicioClienteServidor.ts`, `app/(app)/Sino.tsx`
- Telas: `app/(app)/documentos/page.tsx`, `app/(app)/documentos/Entregas.tsx` (novo), `app/(app)/inicio/page.tsx`
- `proxy.ts` (`/api/entregas` em `CLIENTE_PODE`) e `lib/medicaoRotas.ts` (rotas novas na lista fechada)
- Testes: `tests/documentosMaoDupla.test.ts` (regras), `tests/documentosMaoDuplaRotas.test.ts` (rotas
  com guardas reais: fluxo e isolamento), `tests/documentosSem0032Rotas.test.ts` (antes da migração);
  `tests/rotaTeste.ts` ganhou a sessão `contador2A` (outra pessoa do escritório A).

### Revisão do Escudo (21/11/2026)

Sem bloqueantes: não achou caminho entre escritórios ou empresas em nenhuma rota nova ou alterada.
Corrigido o que ele apontou: o "não tenho" podia ficar grudado num pedido atendido/reaberto por
documento (agora fechar/reabrir apagam a marca e devolver o arquivo não reabre o pedido respondido);
o motivo da devolução saiu do sino; o devolvido voltou a baixar; "aberto em" passou a ignorar link
de outro site e a tela diz "baixado"; a 0032 falha alto se sobrar CHECK antigo com outro nome; teste
do comportamento sem a 0032.

### Pendências e decisões em aberto

- **LGPD**: `aberto_por` guarda o e-mail do login do cliente (finalidade: prova de entrega; só a
  contabilidade do escritório vê). O jurídico confirma se o termo cobre e **por quanto tempo**
  guardar o registro e o arquivo (hoje ficam, inclusive os excluídos — a mesma pendência de
  retenção dos documentos, acima). A faxina de `entregas` `enviando`/`rejeitada` entra na mesma rotina.
- O sino da **folha de ponto devolvida** (Sprint 13) ainda mostra o motivo; o Escudo recomenda
  igualar ao do documento ("Veja o motivo em …"). Não mexi: é de outra frente e muda teste dela.
- E-mail ao cliente quando sai uma entrega: o gancho `avisarClientePorEmail` continua desligado.
- Editar uma entrega publicada = excluir e publicar de novo.

### Para o integrador (Sprint 17 · Frente A)

- **Aplicar a 0032** (`supabase/migrations/0032_documentos_mao_dupla.sql`) depois da 0015 e da 0010:
  cria `entregas` (RLS, sem policy), acrescenta colunas nullable em `documentos` e `pendencias` e
  **troca o CHECK** `documentos_status_check` (passa a aceitar `devolvido`; um bloco `DO` falha alto
  se sobrar CHECK antigo com outro nome). Aditiva e idempotente. **Não foi aplicada em banco
  nenhum.** Ordem com o código: tanto faz (ver "Antes da 0032"). Reversão no cabeçalho do arquivo.
- Conferir depois de aplicar:
  ```sql
  select pg_get_constraintdef(oid) from pg_constraint where conname = 'documentos_status_check'; -- com 'devolvido'
  select relrowsecurity from pg_class where relname = 'entregas';                                 -- true
  select count(*) from pg_policies where tablename = 'entregas';                                  -- 0
  ```
- Sem variável de ambiente nova. Arquivos compartilhados tocados: `proxy.ts` (uma linha em
  `CLIENTE_PODE`), `lib/medicaoRotas.ts`, `lib/notificacoes.ts`/`notificacoesServidor.ts`,
  `app/(app)/Sino.tsx`, `lib/inicioCliente*.ts`, `tests/rotaTeste.ts`. **Nada** em
  `app/(app)/caixa/**`, `lib/caixa*`, `lib/documentoLancamento*` nem em `lib/fechamento*.ts`.
- `conferirDocumento` (lib/documentosServidor.ts) foi substituída por
  `mudarSituacao(d, acao, autor, motivo)`; só a rota de documentos a usava.
- Testar em produção com **conta de teste** (escritório criado em `/criar-conta`, nunca a Edilse):
  1. Contadora: em Documentos, empresa de teste → "Publicar documento" (DAS, competência, vencimento
     daqui a 2 dias, PDF) → aparece "Não baixado · vence logo" e o aviso no topo da tela.
  2. Cliente da empresa: o sino marca "A contabilidade enviou um documento" e "vence em 2 dias" (sem
     o título); `/inicio` mostra o bloco com "Baixar …". Baixar → a contadora vê "Baixado pela
     empresa em …"; baixar de novo não muda a hora; o aviso some do sino.
  3. Renomear um `.txt` para `.pdf` e publicar → recusado; o cliente não vê nada.
  4. Contadora devolve um documento do cliente com motivo → o cliente vê "Devolvido" + motivo em
     Documentos e no `/inicio`, e o aviso no sino **sem** o motivo; "Enviar de novo" → o aviso some.
     Desfazer a devolução → volta para "a conferir".
  5. Pedido mensal aberto → cliente "Não tenho este mês" com observação → o checklist do painel deixa
     de contar o pedido como falta; o sino da contadora diz "não tem este documento no mês";
     Desfazer → pedido aberto de novo.
  6. Isolamento: logado em outro escritório, `GET /api/entregas?empresa=<teste>` → 403,
     `GET /api/entregas/arquivo?id=<teste>` → 404, `DELETE /api/entregas?id=<teste>` → 404; cliente
     de outra empresa → 403/404; empresa de teste arquivada: contadora lista e baixa, publicar → 409,
     cliente → 403.
  7. Apagar o escritório de teste no fim (linhas e objetos em `documentos/<escritorio>/entregas/`).
