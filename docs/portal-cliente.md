# Portal do cliente — página inicial (Sprint 11 · Frente A)

O papel `cliente` (a empresa) agora cai em **`/inicio`** (`HOME_CLIENTE` em `lib/inicio.ts`), uma
tela que diz o que ele precisa fazer. `/` e o pós-login levam para lá (via `proxy.ts`).
Contabilidade e master que abrem `/inicio` voltam ao `/painel`.

| Peça | Onde |
|---|---|
| Regras de montagem (puras, testadas) | `lib/inicioCliente.ts` — `tests/inicioCliente.test.ts` |
| Leituras do banco (somente leitura) | `lib/inicioClienteServidor.ts` |
| Rota | `app/api/inicio-cliente/route.ts` — `tests/inicioClienteRota.test.ts` |
| Tela | `app/(app)/inicio/page.tsx`; item **Início** no topo do menu do cliente (`app/(app)/layout.tsx`) |

## Blocos (só aparece o que pede ação)

1. **Lance o movimento de <mês>** — mês anterior e corrente **sem nenhum lançamento** e não
   confirmados. Mês com lançamentos, ainda que não confirmado, não aparece: conferir e confirmar é da
   contabilidade. Leva a `/caixa`.
2. **A contabilidade pediu N documentos** — pendências `aberta` da empresa, atrasadas primeiro, até 5
   (o resto vira "e mais N"). Leva a `/documentos`.
3. **Folhas de ponto devolvidas** — envios `devolvida` com o motivo, exceto os já reenviados para o
   mesmo funcionário e mês. Leva a `/enviar-ponto`.
4. **Demonstrativo de caixa pronto** (informativo) — último mês liberado (confirmado em sequência
   desde janeiro; no ano corrente e, se não houver, no anterior). Leva a
   `/caixa/demonstrativo?ano&mes`. Não tira o estado "tudo em dia".
5. **Documentos que voltaram para você** (Sprint 17, 0032) — documentos devolvidos pela
   contabilidade e ainda não reenviados, com o motivo. Leva a `/documentos`.
6. **A contabilidade enviou N documentos para você** (Sprint 17, 0032) — entregas ainda não
   baixadas, as mais urgentes primeiro; cada item é um link "Baixar …" (o download registra o
   "aberto em"). Leva a `/documentos`.

Pedidos que vencem em até 3 dias ganham "Vence em N dias (dd/mm)" em amarelo (lembrete antes do
prazo). Os blocos 5 e 6 são opcionais na regra (`entregas`/`devolvidos` em `EntradaInicio`); sem a
0032 simplesmente não aparecem. Ver [`documentos.md`](documentos.md), "Sprint 17 · Frente A".

Sem nada pendente (e nenhuma fonte falhando): "Tudo em dia. Obrigado!". Cada fonte falha sozinha:
vira `indisponiveis` na resposta e uma linha neutra na tela, e os outros blocos seguem. Tela de
uma coluna (`Conteudo largura="estreita"`), botões largos no celular.

## Segurança

A rota ignora `?empresa=`: usa **só** `sessao.empresa`, exige papel `cliente` com escritório e passa por
`exigirEmpresa` (arquivada, escritório). `/inicio` e `/api/inicio-cliente` entram em `CLIENTE_PODE`.
Nada é gravado; não cria exercício. Erros do banco vão ao log, nunca à resposta.

## Para o integrador

- **Sem migração** e sem variável de ambiente nova.
- Testes de redirecionamento que esperavam `/caixa` para o cliente foram atualizados
  (`tests/proxyInicio.test.ts`, `tests/dpAcesso.test.ts`). Outros `router.replace('/caixa')` de telas
  de gestor (ex.: `caixa/cadastros`) foram mantidos de propósito.
- Testar em produção sem gravar: entrar como cliente da empresa de teste → cai em `/inicio`; empresa
  sem lançamentos no mês → bloco do movimento; criar pendência (contabilidade) → aparece com prazo;
  devolver folha com motivo → aparece com o motivo; como contador, abrir `/inicio` → volta ao painel.
