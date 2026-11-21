# Desempenho e robustez

Última atualização: **21/11/2026** (Sprint 15, Frente A — medição própria dentro do app).

## O problema que importava: o corte silencioso de 1.000 linhas

O PostgREST do Supabase responde no máximo 1.000 linhas (`max_rows`) e **não avisa**.
`.limit(2000)` volta 1.000 sem erro; um SELECT sem limite também. Com 46 lançamentos
nada aparecia, mas um escritório com dezenas de empresas perderia linhas do livro,
do saldo e das filas **sem nenhum erro**.

**Regra daqui em diante:** toda leitura que pode passar de 1.000 linhas usa os
utilitários de `lib/db.ts`:

| Função | Para quê |
|---|---|
| `lerTudo(consulta, {max, falhar})` | lê todas as páginas (`.range(de, ate)`) |
| `lerAteTeto(consulta, teto)` | lê até `teto` e diz se havia mais (`truncado` de verdade) |
| `emLotes(ids, fn)` | `.in('col', ids)` em lotes de 100 (a URL estoura com centenas de ids) |

A consulta precisa de **ordem total** (termine com `.order('id')` ou a chave
primária) — senão linhas empatadas repetem/somem entre páginas.

### O que foi corrigido

| Onde | Antes | Agora |
|---|---|---|
| `montarLivro` (PDF/xlsx do livro) | 1 SELECT, cortado em 1.000 | paginado |
| `lancamentosDoMes` (tela do caixa) | sem paginação | paginado |
| `saldoTransportado` | baixava todos os lançamentos dos meses anteriores e somava (cortado) | **1 linha** de `resumo_mensal.saldo_final` do mês anterior |
| catálogo (`contasDaEmpresa`, `historicosDaEmpresa`) e vínculos | sem paginação | paginado |
| painel (`painelServidor`) | `.limit(2000)` virava 1.000 e o `truncado` (`>= 2000`) **nunca acendia** | `lerAteTeto`, em lotes de empresas |
| `/api/caixa/atividade` | lia as 500 mais novas **da plataforma** e filtrava depois por escritório (o teto era comido por outros escritórios) | filtra pelas empresas visíveis **na própria consulta** |
| fechamento: modelos recorrentes (`limit(TETO*5)`), pedidos, regimes | cortados em 1.000 / URL gigante | paginado + lotes |
| agenda: obrigações, conclusões, `escritoriosComAgenda` | sem paginação (conclusões = obrigações × meses passa de 1.000 com poucas dezenas de empresas; escritório sem aviso no cron) | paginado |
| ponto: frequências do mês (funcionários × 31 dias → >1.000 com ~33 funcionários), funcionários, feriados | sem paginação | paginado (frequências só com as colunas usadas) |
| contratos (por empresa e "em experiência") | sem paginação | paginado + lotes |
| `lerEmpresas`/`lerUsuarios` | sem paginação (tabela é da plataforma toda) | paginado |

Fora de escopo de propósito (limites intencionais, bem abaixo de 1.000): documentos
(500), pendências por empresa (300), pagamentos (200).

## Consultas repetidas / N+1

- **Fechamento** (`lerCaixa`): eram **2 contagens por empresa** (N+1: 50 empresas =
  100 consultas). Agora são 2 consultas estreitas por lote (`id, exercicio_id,
  conferido_em` / `exercicio_id`), paginadas, contadas em memória.
- **`lerEmpresas`**: leituras simultâneas (a tela dispara várias rotas, cada uma
  checa a empresa em `podeAcessarEmpresa`/`empresasVisiveis`) compartilham **uma**
  ida ao banco (promessa em andamento) além do cache de 8 s; uma gravação invalida
  também a leitura em andamento (geração) para não repor cache velho.
- `exigirCatalogoVisivel` (conta + analítica) e `vincularConta`/`vincularHistorico`
  agora em paralelo; `montarLivro` lê termo e lançamentos juntos.
- Front (`/caixa`): trocar de mês **não refaz mais** o exercício nem a revisão
  (a mais pesada: lê 2 anos de lançamentos); a fila `/api/caixa/atividade` deixou de
  recarregar a cada mês (só ao mudar o ano ou depois de gravar/conferir).
  `/api/me` é lido uma vez por tela/layout (`lib/meCliente.ts`, cache de 5 s,
  limpo no login/logout) em vez de duas.
- Painel e ponto: as requisições já saíam em paralelo — nada a mudar.

## Índices — `0020_indices_desempenho.sql` (não aplicada)

Quase todos os filtros já tinham índice (0001/0002/0012/0014/0015/0017/0018). Faltavam:
`pendencias (escritorio_id, competencia)` (fechamento), `ponto_frequencias
(empresa_id, ano, mes, funcionario, dia)` (folha do mês, já ordenada) e
`lancamentos (conta_id)` parcial (FK `on delete restrict` varria a tabela).
**Sem `concurrently`**: o `supabase db push` roda cada arquivo em transação e
`create index concurrently` não roda em transação; com as tabelas de hoje o índice
sai em milissegundos. Se as tabelas crescerem muito, rodar à mão, um por vez.

## Medição (só leitura, produção)

`scripts/medir-desempenho.mjs` — sobe-se o app **local** com as variáveis de produção,
o script assina um cookie `master` com o `SESSION_SECRET` (nenhuma senha), faz **só
GET** numa lista fechada de rotas (livro em `.xlsx`, porque o `.pdf` grava
`qtd_folhas`; só exercícios que já existem, porque o GET de lançamentos abre
exercício novo se faltar) e imprime a tabela, com `--salvar`/`--comparar`.
Instruções no topo do arquivo.

Resultado em 21/11/2026 (3 empresas, 46 lançamentos; Windows → Supabase, mediana de
7–9 chamadas; ms). `antes` = commit `2497e7d`, `depois` = esta branch:

| Rota | antes | depois | Δ |
|---|---:|---:|---:|
| `/api/painel/fechamento` | 727 | 227 | **−69%** (N+1 do caixa) |
| `/api/caixa/livro` (.xlsx) | 399 | 285 | −29% (lê termo e lançamentos juntos) |
| `/api/caixa/lancamentos` (mês) | 250 | 256 | = |
| `/api/caixa/exercicio` / `resumo` | 225 / 235 | 236 / 232 | = |
| `/api/caixa/revisao` | 492 | 476 | = |
| `/api/painel` | 149 | 151 | = |
| `/api/caixa/atividade` | 128 | 120 | = |
| `/api/empresas`, `/api/me` | 16 / 17 | 14 / 16 | = |

**Leitura honesta:** com tão pouco dado, cada ida ao banco custa ~115 ms (latência de
rede) e é isso que se mede; só o N+1 e o paralelismo aparecem. O ganho real desta
frente é **correção em volume** (não perder linha) e **custo que não cresce com o
nº de empresas** (fechamento, saldo transportado, atividade filtrada no banco). O
teste `tests/paginacao.test.ts` prova isso com um banco falso que corta em 1.000
linhas (2.500 lançamentos no livro, mês de 1.500, 1.300 empresas…).

## Sprint 7: funções da Vercel em São Paulo (`gru1`)

Desde 21/11 o `vercel.json` fixa `"regions": ["gru1"]`, junto do banco (`sa-east-1`).

**O que o script mede e o que não mede.** `medir-desempenho.mjs` sobe o app **na
máquina de quem mede** e fala direto com o Supabase: a região da Vercel **não entra**
nesse número (e ele recusa URL remota de propósito, para nunca gravar em produção).
Então a tabela abaixo prova que **não houve regressão** nas rotas, mas não mostra o
ganho da região. Para isso há duas evidências em produção, só leitura, sem cookie e
sem gravar nada:

1. **Região confirmada:** `curl -sI https://banco-de-horas-henna.vercel.app/api/empresas`
   devolve `x-vercel-id: gru1::…` (a função roda em São Paulo). O domínio
   `clickcontas.com.br` ainda não resolve.
2. **Tempo até a resposta** (7 chamadas, ms, do notebook do fundador; `401` = só o
   proxy e a função, **sem tocar no banco**): `/api/empresas` 365–536 (mediana 403),
   `/login` 357–912 (mediana 367). Esse piso de ~365 ms é a ida e volta
   notebook ↔ Vercel; ele não carrega consulta ao banco. Rotas que consultam o banco
   precisam de sessão, e não há como medi-las em produção sem cookie e sem gravar —
   o ganho por consulta (a função agora a poucos ms do Postgres, em vez de ~115 ms
   dos EUA) deve ser visto no painel de logs da Vercel (duração das funções) depois
   de algumas horas de uso real.

**Tabela do script (app local, mediana de 7, ms; mesmo alvo: 3 empresas, 46 lançamentos):**

| Rota | Sprint 6 (depois) | Sprint 7 | Δ |
|---|---:|---:|---:|
| `/api/painel/fechamento` | 227 | 267 | ≈ (ruído; máx. 643 numa rodada) |
| `/api/caixa/livro` (.xlsx) | 285 | 301 | ≈ |
| `/api/caixa/lancamentos` (mês) | 256 | 234 | ≈ |
| `/api/caixa/exercicio` / `resumo` | 236 / 232 | 241 / 243 | ≈ |
| `/api/caixa/revisao` | 476 | 461 | ≈ |
| `/api/painel` | 151 | 217 | ≈ (rede do notebook varia ±60 ms) |
| `/api/caixa/atividade` | 120 | 131 | ≈ |
| `/api/empresas`, `/api/me` | 14 / 16 | 6 / 17 | = |

Conclusão: **sem regressão**; a diferença entre rodadas é variação da rede do
notebook até o Supabase, não do código. A frente de arquivadas não acrescentou
consulta à leitura (usa o mesmo cache de empresas).

## Sprint 15: medição própria (dentro do app)

O que antes só aparecia no painel da Vercel agora é medido pelo próprio app e
resumido para o master em **/configuracoes → "Como o app está respondendo"**:
as 10 chamadas e as 10 telas mais lentas (p50/p95), os erros mais frequentes e as
visitas por tela, nos últimos 7 dias.

**Como mede (tudo central; nenhuma tela mudou):**

| O quê | Onde | Observação |
|---|---|---|
| Tempo das chamadas a `/api` (método, rota, status, ms) | `components/medicao.tsx`, montado no `app/layout.tsx`, embrulha o `fetch` uma vez | Tempo **percebido no navegador** (rede incluída), não a duração da função. A ordem das rotas mais lentas vale; o número absoluto inclui a ida e volta. Cron e webhook não passam por navegador e ficam de fora. |
| LCP, TTFB, INP da carga da tela | `useReportWebVitals` no mesmo componente | Só carga completa (a navegação interna não gera LCP/TTFB). Os vitais ficam com a rota em que a tela abriu. |
| Visitas por tela | mudança de `usePathname` | Estimativa: amostra × 1/taxa. |
| Exceções do servidor (rota + código) | `instrumentation.ts` → `onRequestError` | Sempre (não é amostra). Código = nome da classe e código do banco (`TypeError`, `Error:23505`); nunca a mensagem. |

**Amostra:** cada carga de página sorteia se entra (`TAXA_AMOSTRA` = 25%, em
`lib/medicao.ts`); fora dela o navegador só manda os **erros** (status ≥ 400 ou sem
rede). Os tempos (p50/p95) usam só a amostra (`amostra = true`); os erros contam tudo.
O envio é em lote para `POST /api/medicao` (a cada 15 s ou 20 itens; `sendBeacon`
ao sair da tela), com limite de 10 envios/min por sessão e instância.

**Sem dado pessoal, em três travas:** (1) `normalizarRota` no navegador e de novo
no servidor — sem query nem âncora; uuid/número/CPF/e-mail/nome/texto com dígito
viram `[id]`, data vira `[data]`; (2) `classificarRota` só aceita rota que existe no
app (`lib/medicaoRotas.ts`; o resto vira `/[outra]`), e `tests/medicao.test.ts`
confere a lista contra `app/**/page.tsx` e `app/api/**/route.ts`; (3) CHECKs da
tabela (rota só `[a-z0-9/-[]]`, erro só código curto). Gravam-se só rota, método,
status, ms, métrica, código do erro e **papel** (da sessão, nunca do corpo); nada de
id, e-mail, escritório, empresa, corpo ou mensagem. `em` é arredondado ao minuto. Do
navegador, o único código de erro aceito é `rede`. Revisado pelo Escudo (21/11/2026).

**Nunca atrasa nem derruba:** a rota responde 204 na hora e grava em `after`;
`gravarMedicoes` nunca lança, tem prazo de 2 s por consulta e pausa (10 min sem a
tabela, 1 min com o banco falhando). Sem a 0031 aplicada, nada é gravado e a seção
do master avisa que falta a migração.

**Retenção:** ≈1 a cada 50 gravações apaga o que passou de 30 dias (índice em `em`).
Sem cron; se não houver tráfego, nada é apagado (e nada novo entra).

**Limites conhecidos:** usuário logado consegue enviar medições falsas (dentro do
limite e da lista de rotas) — só distorce o resumo, não vaza nada. A leitura do
resumo vai das mais novas às mais velhas com teto de 50 mil linhas.

## Para o integrador

1. **Aplicar `0020_indices_desempenho.sql`** (`supabase db push`). Pode ser antes ou
   depois do código; só cria índice (`if not exists`).
2. Testar em produção após publicar: abrir `/caixa` (trocar de mês: só os lançamentos
   recarregam), `/painel` e o fechamento, baixar um livro .xlsx/.pdf e conferir o
   total; o "N pendências" da fila do caixa deve bater com o da conferência.
3. **Região:** resolvida na Sprint 6 — `vercel.json` fixa `gru1` (ver a seção acima).
   Depois de publicar, conferir `x-vercel-id: gru1::…` e a duração das funções nos logs
   da Vercel.
4. Rota/consulta nova que possa passar de 1.000 linhas: usar `lerTudo`/`lerAteTeto`,
   com `.order('id')` no fim. Nunca `.limit(n>1000)`.
5. **Medição própria (Sprint 15): aplicar `0031_medicoes.sql`** (`supabase db push`).
   Ordem indiferente: sem a tabela o app não grava e não quebra; a seção do master
   avisa. Depois de publicar, abrir algumas telas logado e conferir em
   /configuracoes → "Como o app está respondendo" (com 25% de amostra pode levar
   algumas visitas para aparecer). Rota ou tela nova: acrescentar em
   `lib/medicaoRotas.ts` (o teste acusa). Rota de API nova que o cliente use já
   passa pela medição sem nada a fazer.
6. Sugestão do Escudo (decisão do fundador/jurídico): mencionar em `/privacidade`
   "medição técnica de desempenho, sem dado pessoal, guardada por 30 dias".
7. Pendência conhecida: `garantirExercicio` ainda abre exercício num GET (escrita em
   leitura) e `/api/caixa/lancamentos` ainda faz 2 etapas sequenciais (exercício → resto).
