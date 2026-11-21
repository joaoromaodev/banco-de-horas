# Painel do contador — "o que precisa de atenção hoje" (Sprint 3 · Frente D)

> Uma tela só (`/painel`) que junta o que está atrasado ou esperando a contadora
> nas outras telas: obrigações da agenda, documentos dos clientes, pendências
> com prazo, contratos de experiência e lançamentos do caixa a conferir. Cada
> bloco mostra a contagem, os itens mais urgentes e leva à tela de origem.

## Onde está

| Peça | Arquivo |
|---|---|
| Regras puras (priorização, agrupamento, resumo, isolamento de falha) | `lib/painel.ts` — testes em `tests/painel.test.ts` |
| Consultas ao Postgres (documentos, pendências, caixa) | `lib/painelServidor.ts` |
| Rota | `app/api/painel/route.ts` (`GET`, só `exigirGestor`) |
| Tela | `app/(app)/painel/page.tsx` |
| Menu | item **Painel** no topo, em `app/(app)/layout.tsx` (só contabilidade) |

Agenda e contratos reaproveitam o que já existe (`listarObrigacoes`/`listarConclusoes`
+ `lib/agenda.ts`; `listarEmExperiencia` + `alertasConsolidados`). Nada de tabela nem
migração nova: o painel só **lê**.

## Decisões

| Tema | Decisão |
|---|---|
| Acesso | `exigirGestor`. Recorte pelas empresas de `empresasVisiveis(sessao)`; as consultas de documentos e pendências filtram também por `escritorio_id` (master = plataforma). Contador sem escritório não vê nada (falha fechada). Não entra em `CLIENTE_PODE`. |
| Módulos | Bloco **contratos** só para quem tem o módulo `ponto` (a rota `/contratos` é dele); bloco **caixa** só com o módulo `caixa`. Os demais aparecem para todo gestor. |
| Falha isolada | Cada bloco roda em paralelo dentro de `isolar()`. Tabela inexistente (`42P01`, `PGRST205`, ou `status` 503 das outras frentes) → bloco "Ainda não instalado"; qualquer outro erro → "Não foi possível carregar este bloco" (a causa vai para o log, nunca para a tela). O painel só devolve erro se nem a lista de empresas carregar. |
| "Tudo em dia" | Só é dito quando **nenhum** bloco falhou e tudo é zero. Com bloco indisponível a tela avisa que o resumo pode estar incompleto. |
| Resumo do topo | Três números: **atrasadas** (obrigações atrasadas + pendências vencidas + contratos vencidos), **para esta semana** (obrigações que vencem hoje/7 dias ou antecedência própria, pendências que vencem em até 3 dias, contratos que vencem) e **para conferir** (documentos recebidos + lançamentos do caixa sem `conferido_em`). Conferência não tem prazo, por isso é um número à parte e não "atrasado". |
| Agenda | Mesmas regras da agenda e do e-mail: respeita `inicio`, `ativa`, `aviso_dias`, olha no máximo 365 dias para trás, desconta o que tem conclusão. |
| Pendências | `aberta` com prazo vencido ou "vence logo" (≤ 3 dias — `situacaoPrazo` de `lib/documentos.ts`). Sem prazo não entra: não é urgência. |
| Documentos | `status = recebido` (não conferido, não excluído), agrupados por empresa; a que espera há mais tempo vem primeiro. |
| Caixa | "A conferir" = lançamento sem `conferido_em` (a fila de `/api/caixa/atividade`, [docs/livro-caixa.md](livro-caixa.md)). Ano corrente e anterior. Por empresa, maior fila primeiro. |
| Teto | Documentos, pendências e caixa leem no máximo 2000 linhas; passando disso o selo mostra "N+" ("e mais N ou mais"). |
| Ordem dos blocos | Quem tem atrasado vem primeiro, depois quem tem algo a ver, depois os vazios e por fim os indisponíveis. |
| Links | Cada item leva à tela de origem (`/agenda`, `/documentos`, `/contratos`, `/caixa`). Ainda não abre já na empresa certa: `/documentos` guarda a empresa no navegador e as outras telas não aceitam filtro por URL — ver pendências. |
| Visual | Só tokens do design system; claro/escuro; grade de 1 coluna no celular (375 px) e 2 no desktop; sem `<select>`/`alert`. Único botão é "Atualizar" (secundário): a tela é de leitura, a ação é clicar no item. |
| Rota `/` | **Não foi trocada** (é do ponto). O painel vive em `/painel`. |

## Para o integrador

### Arquivos compartilhados que esta frente tocou

- `app/(app)/layout.tsx`: o ícone `painel` no `Icon` e o item `Painel` no começo dos grupos da contabilidade (antes do módulo de ponto; o cliente não vê). Conflito provável com agenda/documentos/ponto: trivial.
- Nada em `proxy.ts`: `/painel` e `/api/painel` não estão em `CLIENTE_PODE`, então o cliente já é redirecionado/barrado. `/painel` **não** pertence a `ROTAS_PONTO` nem `ROTAS_CAIXA`: todo contador alcança.

### Decisão que fica com você: o painel vira a página inicial do contador?

Hoje `/` é a folha de ponto. Quando o ponto for integrado, decida se o contador
cai em `/painel` ao entrar (ex.: no redirecionamento pós-login do `proxy.ts`/`login`
mandar `usuario` e `master` para `/painel`, mantendo `/` acessível pelo menu). Não
fiz isso para não mexer em `/` nem no fluxo de login de outras frentes.

### Banco

Sem migração. Depende de tabelas das outras frentes — o que faltar vira bloco
"Ainda não instalado": agenda (0014), documentos/pendências (0015), contratos
(0009), caixa (Postgres base). Tudo é leitura.

### O que testar em produção (só leitura; nunca altere dados das empresas reais)

1. Login da contabilidade → **Painel** no topo do menu. Antes da 0014/0015, esses
   dois blocos aparecem "Ainda não instalado" e o resto carrega.
2. Depois da 0014: cadastre uma obrigação de teste atrasada → aparece em "Obrigações
   da agenda" com "N dias de atraso"; marque como feita na agenda → some do painel.
3. Depois da 0015, em conta de teste: cliente envia documento → o bloco de
   documentos conta; contador confere → some. Pendência com prazo amanhã → aparece.
4. Contador sem módulo `caixa` não vê o bloco do caixa; sem `ponto`, não vê contratos.
5. Cliente: `/painel` redireciona e `GET /api/painel` responde 403/redireciona.
6. Contador de outro escritório não vê empresas, documentos nem obrigações da Edilse.
7. Tema escuro e 375 px.

## Pendências

- **Link já na empresa**: levar o clique direto à empresa do item (`/documentos?empresa=`,
  `/caixa?empresa=`) exige que essas telas leiam o parâmetro; hoje não leem.
- **Sem teste de rota/tela** (como o resto do projeto); a regra está coberta em
  `lib/painel.ts`. Não foi rodado contra o banco de produção.
- **Feriados municipais** na agenda continuam fora (herdado de `docs/agenda.md`).
- Possível evolução: "marcar como feita"/"conferir" direto no painel; hoje a ação é
  na tela de origem.
