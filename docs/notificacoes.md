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
- **Quem vê**: só a contabilidade de um escritório (`role = usuario`); master não tem
  escritório e `cliente` não alcança. Recorte pelas empresas visíveis. A leitura é por
  pessoa (e-mail); o escritório vem da sessão.
- **Atualização**: ao montar o layout, ao voltar para a aba (no máximo 1×/min) e a cada 5 min
  com a aba visível; abrir o painel recarrega. A conferência entre módulos (lê 3 meses de
  ponto) fica em cache de 10 min por escritório no servidor.
- **Sem a 0027**: o sino funciona só com o derivado; "lidas" ficam no navegador
  (`localStorage`: `sino.visto`, `sino.lidas`) e a conferência não notifica (não há como
  saber o que é novo). `POST /api/notificacoes` é uma das rotas liberadas em somente
  leitura (`ESCRITA_LIVRE` em `lib/cobranca.ts`): é estado da pessoa, não do escritório.
- Cada fonte falha sozinha: o painel avisa "não deu para ler agora: …" e segue.
- **Sem e-mail** nesta etapa.

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
