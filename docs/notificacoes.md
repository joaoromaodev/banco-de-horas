# Notificações no app — o sino (Sprint 10 · Frente B)

> Não havia aviso dentro do app: a contadora só descobria documento novo, pedido
> atendido ou lançamento do cliente abrindo cada tela. O **sino** no topo mostra a
> contagem e a lista do que aconteceu desde a última visita, por escritório. Quase tudo é
> **derivado** do que já existe; só o que não dá para derivar fica na migração **0027**
> (**não aplicada**).

## Onde está

| Peça | Arquivo |
|---|---|
| Regras puras (montagem, janela, lidas, rótulos) | `lib/notificacoes.ts` — `tests/notificacoes.test.ts` |
| Leituras, `registrarNotificacao`, lidas por pessoa | `lib/notificacoesServidor.ts` |
| Rota | `app/api/notificacoes/route.ts` (`GET`; `POST` `lida` / `todas`) |
| Sino (botão + painel + `useSino`) | `app/(app)/Sino.tsx`; ligado em `app/(app)/layout.tsx` |
| Banco | `supabase/migrations/0027_notificacoes.sql` (`notificacoes`, `notificacoes_leitura`) |

## O que aparece

| Tipo | Origem | Quando entra | Chave (para "lida") |
|---|---|---|---|
| Documento | `documentos` `status = recebido`, não excluído, enviados nos últimos 14 dias | por empresa; "N documentos novos enviados pelo cliente" | `doc\|empresa\|<envio mais recente>` — chegou outro, volta a ser não lida |
| Pedido atendido | `pendencias` `status = atendida`, `atendida_em` na janela | um item por pendência; **não** avisa o que o próprio usuário fechou à mão (`atendida_por`) | `pend\|id\|<atendida_em>` |
| Livro Caixa | `lancamentos` sem `conferido_em`, `criado_em` na janela (só com o módulo `caixa`) | por empresa; ignora o que o próprio usuário lançou | `cx\|empresa\|<mais recente>` |
| Conferência | alertas ativos de `conferirEmpresas` (só com o módulo `ponto`) | só o alerta **novo**: a 0027 guarda a "primeira vez vista"; no primeiro uso do escritório o que já existia é gravado como velho (`1970`) e **não avisa**. Alerta resolvido some; se voltar a ocorrer, continua o mesmo (mesma chave) | `conf\|<chave do achado>` |
| Evento | linhas de `notificacoes` publicadas por outras frentes | na hora da publicação | `ev\|<chave>\|empresa` |

- **Janela**: 14 dias (`JANELA_DIAS`), no máximo 30 itens. A contagem do selo são os **não lidos**.
- **Lida** = aconteceu até a "última visita" (`lidas_ate`) **ou** foi marcada individualmente.
  "Marcar todas como lidas" move `lidas_ate` para agora. Clicar no item marca e leva à tela.
  Primeira visita de uma pessoa: o sino começa limpo.
- **Quem vê**: a contabilidade de um escritório (`role = usuario`) — e, desde a Sprint 13,
  o `cliente`, com **outros** avisos (ver "Avisos ao cliente" abaixo); master não tem
  escritório. Recorte pelas empresas visíveis. A leitura é por
  pessoa (e-mail); o escritório vem da sessão.
- **Atualização**: ao montar o layout, ao voltar para a aba (no máximo 1×/min) e a cada 5 min
  com a aba visível; abrir o painel recarrega. A conferência entre módulos (lê 3 meses de
  ponto) fica em cache de 10 min por escritório no servidor.
- **Sem a 0027**: o sino funciona só com o derivado; "lidas" ficam no navegador
  (`localStorage`: `sino.visto`, `sino.lidas`) e a conferência não notifica (não há como
  saber o que é novo). `POST /api/notificacoes` é uma das rotas liberadas em somente
  leitura (`ESCRITA_LIVRE` em `lib/cobranca.ts`): é estado da pessoa, não do escritório.
- Cada fonte falha sozinha: o painel avisa "não deu para ler agora: …" e segue.
- **Sem e-mail** nesta etapa (o cliente tem um gancho desligado; ver abaixo).

## Avisos ao cliente (Sprint 13 · Frente A)

O papel `cliente` também tem o sino (mesmo botão e painel; `useSino(…, 'cliente')`), com
avisos **só da empresa da sessão**. Tudo é **derivado** — nada é gravado em `notificacoes`,
então a contabilidade **não** passa a ver estes avisos e nenhum aviso do escritório vaza
para o cliente. **Sem migração nova** (a 0030 ficou livre).

| Aviso | Origem | Texto | Leva a | Chave |
|---|---|---|---|---|
| Folha de ponto devolvida | `ponto_envios` `devolvida` (0028), ainda não reenviada para o mesmo funcionário e mês, nos últimos 13 meses (o corte da tela); `quando` = `devolvido_em` | "Outubro/2026 · Motivo: …" (motivo cortado em 160) — **sem nome do funcionário** | `/enviar-ponto` | `cli\|folha\|<id>\|<devolvido_em>` (desfazer e devolver de novo → não lida de novo) |
| Pedido de documento | `pendencias` `aberta`; `quando` = `criado_em` | "<título> · Prazo: dd/mm/aaaa" (ou "Sem prazo") | `/documentos` | `cli\|pedido\|<id>` |
| Resumo do ponto para aceitar (Sprint 17 · C) | `ponto_meses_fechados` (0034) dos últimos 13 meses, sem resposta do cliente para a assinatura atual; `quando` = `fechado_em` | "Outubro/2026 · confira as horas do mês e responda à contabilidade." — **sem nome nem número** | `/enviar-ponto#aceite` | `cli\|aceite\|<ano>\|<mes>\|<fechado_em>` (reabrir e fechar de novo → não lida de novo) |
| Demonstrativo pronto | `meses_confirmados` do ano (e do anterior, se a janela alcança); mês M liberado quando o último de 1..M é confirmado (`liberadoAte`) | "Abril/2026 · confirmado pela contabilidade." | `/caixa/demonstrativo?ano=&mes=` | `cli\|demo\|<ano>\|<mes>\|<quando>` |
| Documento da contabilidade (Sprint 17, 0032) | `entregas` `publicada`, ainda não baixada pelo cliente; `quando` = `publicado_em` | "Holerite · out/2026 · Vence em dd/mm/aaaa" — **sem título nem nome do arquivo** | `/documentos` | `cli\|entrega\|<id>` |
| Documento devolvido (Sprint 17, 0032) | `documentos` `devolvido`, sem envio vivo depois (mesma categoria e competência); `quando` = `devolvido_em` | "Extrato bancário · out/2026 · Veja o motivo em Documentos." — **sem motivo nem nome do arquivo** | `/documentos` | `cli\|docdev\|<id>\|<devolvido_em>` |
| Lembrete do prazo (Sprint 17) | pedido `aberta` ou entrega não baixada que vence de hoje a 3 dias; `quando` = meia-noite de Belém do 1º dia da janela | "<título do pedido> · Prazo: dd/mm/aaaa" / "<tipo> · … · Ainda não aberto" | `/documentos` | `cli\|lembrete\|<id>\|<prazo>`, `cli\|entrega-vence\|<id>\|<vencimento>` |

Sprint 17: o sino da contabilidade diz "O cliente não tem este documento no mês" quando o pedido
foi fechado pelo "Não tenho este mês" (lê `sem_movimento_em`, com recuo sem a 0032). Detalhes em
[`documentos.md`](documentos.md), seção "Sprint 17 · Frente A".

- Meses liberados no mesmo instante (confirmar janeiro depois de fevereiro e março) viram
  **um** aviso, do mês mais alto. Pedido atendido ou folha reenviada somem do sino.
- Mesma janela (14 dias), mesmo limite e mesmas regras de "lida" do sino da contabilidade —
  inclusive "primeira visita começa limpa". A leitura vai para `notificacoes_leitura` com
  `usuario = cliente|<empresa>|<e-mail>` (não se mistura com a da contabilidade e não
  atravessa se o login for religado a outra empresa). Sem a 0027, o navegador lembra em
  `sino.visto.cliente` / `sino.lidas.cliente`.
- Regras puras: `lib/avisosCliente.ts` (`tests/avisosCliente.test.ts`); leituras:
  `lib/avisosClienteServidor.ts`; rota: a mesma `app/api/notificacoes/route.ts`, que
  decide pelo papel da sessão — cliente passa por `exigirClienteDaEmpresa` (nova, em
  `lib/acesso.ts`: papel `cliente` com escritório e empresa, e `motivoNegado` da empresa
  DA SESSÃO — outro escritório e empresa arquivada → 403). `?empresa=` e corpo são
  ignorados. Isolamento em `tests/avisosClienteRota.test.ts`.
- `/api/notificacoes` entrou em `CLIENTE_PODE` (`proxy.ts`); continua em `ESCRITA_LIVRE`
  (marcar como lida funciona em somente leitura).

### Gancho do e-mail ao cliente

`lib/avisosClienteEmail.ts` → `avisarClientePorEmail(escritorioId, empresaId, quantos)`.
**Não está chamado em nenhuma rota** de propósito: devolver folha e confirmar mês têm
"desfazer", e o e-mail não volta atrás; o Demonstrativo já tem o envio próprio da contadora.
Três travas; sem qualquer uma não envia nem chama o provedor ou o banco:
`RESEND_API_KEY`, `AVISOS_CLIENTE_EMAIL=ligado` (a chave já existe em produção por causa do
Demonstrativo) e `APP_URL` (o link nunca usa o `Host` da requisição).

- O corpo é um **resumo neutro** ("Você tem N avisos no ClickContas" + link para `/inicio`):
  o motivo da devolução e o título do pedido são texto livre da contadora e podem trazer
  nome de funcionário — não saem do app.
- Destinatários: logins `cliente` da empresa **no escritório dela** (filtra `escritorio_id`).
- Para ligar: um resumo diário no cron com `naoLidas` de `lerAvisosCliente` por empresa
  (decisão do dono: frequência). Antes, o jurídico confirma se o termo cobre o e-mail ao cliente.
- Revisão do Escudo (21/11/2026): isolamento pela empresa da sessão conferido; sem
  bloqueantes. Os menores (resumo neutro, `APP_URL` obrigatória, filtro por escritório,
  corte de 13 meses da folha, testes de regressão) foram corrigidos.

## Para o integrador

### Publicar um evento (outras frentes)

```ts
import { registrarNotificacao } from '@/lib/notificacoesServidor';

await registrarNotificacao({
  escritorioId,                       // do cadastro da empresa, nunca do navegador
  empresaId,                          // opcional; sem ele o aviso é do escritório todo
  tipo: 'folha_ponto_cliente',        // rótulo livre
  titulo: 'Folha de ponto enviada pelo cliente',
  texto: 'Outubro/2026',              // opcional, ≤ 500; NADA de CPF, salário ou dado pessoal
  href: linkPonto(empresaId, 2026, 10), // de lib/pontoUrl.ts; só caminho interno ("/…")
  chave: `folha|${folhaId}`,          // idempotência: publicar de novo não duplica
});
```

Nunca lança e devolve `false` sem a 0027 — notificar não derruba quem notifica. É
fire-and-forget: pode `await` ou não. **Frente A (folha de ponto enviada pelo cliente)**:
chame na confirmação do envio, logo depois de gravar a folha.

### Avisos ao cliente (Sprint 13)

- **Sem migração** e sem variável obrigatória (`AVISOS_CLIENTE_EMAIL` só para o gancho do
  e-mail, desligado). Funciona com ou sem a 0027 (sem ela, "lida" fica no navegador).
- Arquivos: `lib/avisosCliente.ts`, `lib/avisosClienteServidor.ts`, `lib/avisosClienteEmail.ts`,
  `lib/acesso.ts` (`exigirClienteDaEmpresa`), `app/api/notificacoes/route.ts`, `proxy.ts`
  (`CLIENTE_PODE`), `app/(app)/Sino.tsx` e `app/(app)/layout.tsx`. `lerLeitura` de
  `lib/notificacoesServidor.ts` passou a ser exportada.
- Testar em produção (conta de teste; nunca a Edilse): como contador, devolver uma folha
  da empresa de teste com motivo, criar um pedido com prazo e confirmar um mês do caixa;
  como cliente dessa empresa, o selo marca 3 (abrir o painel recarrega) e cada item leva
  a `/enviar-ponto`, `/documentos` e `/caixa/demonstrativo?ano&mes`; o texto não tem nome
  de funcionário. Cliente de **outra** empresa não vê nada; o sino da contadora não ganha
  estes itens.

### Aplicar a 0027

1. `npx supabase migration list --remote`: confirme que **0027 está livre** (0024–0026 são de
   outras frentes) e a 0010 aplicada (a 0027 só depende dela).
2. Aplique (`db push` ou SQL Editor). Idempotente. Só **acrescenta** duas tabelas, RLS ligada
   sem policies. Sem backup especial: não toca em tabela existente.
3. Ordem com o código: tanto faz (ver "Sem a 0027").
4. Reversão: `drop table if exists notificacoes_leitura, notificacoes;`

### O que testar em produção (conta de teste; nunca alterar dados da Edilse)

1. Contador de teste: o sino aparece (barra lateral no desktop; barra de topo no celular),
   sem selo na primeira visita.
2. Como cliente da empresa de teste, enviar um documento → em até 5 min (ou ao abrir o
   painel) o selo marca 1 e o item "Documento novo…" leva a `/documentos`.
3. Atender uma pendência como cliente → "Pedido atendido pelo cliente".
4. Lançar no caixa como cliente → "Lançamento novo do cliente".
5. Gerar uma divergência de teste (empregado ativo sem admissão) → "Alerta da conferência".
6. Clicar no item marca como lido; "Marcar todas como lidas" zera; recarregar mantém.
7. Outra conta/escritório não vê nada disso; o cliente recebe 403 em `/api/notificacoes`.
8. Em somente leitura (teste vencido), marcar como lida continua funcionando.

## Pendências

- Sem e-mail/push; a verificação é por polling.
- Linhas `conf|…` de `notificacoes` nunca são apagadas (poucas, só uma por alerta distinto);
  uma faxina por idade seria o próximo passo.
- Se um contador novo passa a ver empresas que não via, os alertas delas aparecem como novos
  (o "semeado" é por escritório, não por pessoa).
- `/documentos` e `/caixa` ainda não leem `?empresa=`: o item leva à tela, não à empresa.
- Não foi aberto no navegador contra um banco real (não há banco local); typecheck, lint,
  testes e build verdes.
