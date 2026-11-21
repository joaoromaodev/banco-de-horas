# Desempenho e robustez

Última atualização: **21/11/2026** (Sprint 6, Frente B).

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

## Para o integrador

1. **Aplicar `0020_indices_desempenho.sql`** (`supabase db push`). Pode ser antes ou
   depois do código; só cria índice (`if not exists`).
2. Testar em produção após publicar: abrir `/caixa` (trocar de mês: só os lançamentos
   recarregam), `/painel` e o fechamento, baixar um livro .xlsx/.pdf e conferir o
   total; o "N pendências" da fila do caixa deve bater com o da conferência.
3. **Região:** `vercel.json` não fixa região (padrão da Vercel é `iad1`, EUA). Se o
   projeto Supabase do ClickContas estiver em `sa-east-1` (os dois projetos visíveis
   na conta estão), fixar `"regions": ["gru1"]` corta ~100+ ms **por consulta** — maior
   ganho disponível e não mexi porque é configuração de publicação. Conferir antes qual
   é a região do projeto.
4. Rota/consulta nova que possa passar de 1.000 linhas: usar `lerTudo`/`lerAteTeto`,
   com `.order('id')` no fim. Nunca `.limit(n>1000)`.
5. Pendência conhecida: `garantirExercicio` ainda abre exercício num GET (escrita em
   leitura) e `/api/caixa/lancamentos` ainda faz 2 etapas sequenciais (exercício → resto).
