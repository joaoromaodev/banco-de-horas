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
