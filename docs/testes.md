# Testes e CI

Última atualização: **21/11/2026** (Sprint 1, Frente C).

Rede de segurança das regras puras de `lib/`. Não há teste de tela nem de rota
(ainda): tudo o que precisa de Supabase, Google Sheets ou Gemini ficou de fora de
propósito.

## Como rodar

```powershell
npm test              # roda tudo uma vez (Vitest)
npm run test:watch    # modo contínuo
npm run typecheck     # tsc --noEmit
npm run lint
npm run build
```

O CI (`.github/workflows/ci.yml`) roda `npm ci` → lint → typecheck → test → build
em todo push e pull request, no Node 20.

- Config: `vitest.config.ts` (alias `@/` igual ao `tsconfig.json`; `TZ=UTC` fixo
  para provar que as datas não dependem do fuso do computador).
- Testes ficam em `tests/*.test.ts`, um por módulo.
- **Build no CI:** o build não exige nenhuma variável — `getDb()`, Sheets e Gemini
  só leem `process.env` quando uma requisição chega. O workflow define valores
  falsos mesmo assim, por segurança, caso alguma rota passe a ler env no import.
  Nunca coloque credencial real no workflow.

## O que está coberto

| Arquivo de teste | Módulo | Destaques |
|---|---|---|
| `tempo.test.ts` | `lib/tempo.ts` | parse de `8:00`/`08h00`/`0800`, inválidos, fração do dia, saldo negativo |
| `calendario.test.ts` | `lib/calendario.ts` | bissexto, tipo do dia, jornada com/sem sábado, marcadores que zeram o "a cumprir" (BANCO DE HORAS não zera) |
| `validacao.test.ts` | `lib/validacao.ts` | dia vazio, folga com horário, ordem cronológica, plausibilidade, jornada > 12h |
| `contratos.test.ts` | `lib/contratos.ts` | vencimento = admissão + dias − 1, prorrogação, teto de 90 dias, retorno +10 dias recuando para sexta, `hojeBelem` (UTC−3), por extenso, `lerValor`, campos dos modelos, alertas, `alertasConsolidados` (ordem por urgência, janela, só em experiência) |
| `contratosPdf.test.ts` | `lib/contratosPdf.ts` | os três PDFs são válidos, contrato + termo, acentos e caracteres fora do WinAnsi, texto longo pagina |
| `caixa.test.ts` | `lib/caixa.ts`, `planoContasPadrao.ts`, `app/(app)/caixa/formato.ts` | `paraValor`, `validarLancamento` (entrada xor saída, juros/multa = saída, ano do exercício), `saidaEfetiva`, depósito = saída e retirada = entrada no catálogo, CPF/CNPJ |
| `sugestaoConta.test.ts` | `lib/sugestaoConta.ts` (+ `iaPermitida`/`lerRegistroSugestao`) | tokens com forma de número, pseudônimo do pagador, compactação; fontes (a) analítica e (b) histórico, valor separando NF grande/pequena, nunca conta fora da lista visível; não conferidos com peso 0,3/teto 0,6; IA só entre as contas da empresa, complemento mascarado, resposta fora da lista = nada; IA desligada por padrão e em empresa de saúde |
| `revisaoCaixa.test.ts` | `lib/revisaoCaixa.ts` | duplicidade e quase (pagador na chave, cheque e transferência fora, balcão médio), documento só após NF/recibo e em 60 dias, valor fora do padrão (mediana + MAD), natureza invertida (estorno médio), pagador/CPF, data futura, alterado após confirmar, juros recorrentes, saldo negativo pelo fim do dia, mês sem lançamento com carência, risco, 5 mil lançamentos < 1 s |
| `livroCaixa.test.ts` | `lib/livroCaixa.ts` | saldo transportado encadeado, saída efetiva, cheque neutro, PDF gerado (nº de folhas, paginação, pessoa física) |
| `formatoLivro.test.ts` | `lib/formatoLivro.ts`, `lib/data.ts` | meses, `isoParaBR`, `dataBR` |
| `agenda.test.ts` | `lib/agenda.ts` | Páscoa/feriados nacionais (20/11, Carnaval, Corpus Christi), dia útil, antecipa/prorroga, n-ésimo e último dia útil, mensal/trimestral/anual/única, "acompanhar a partir de", catálogo e modelos, validação, resumo e e-mail (HTML escapado) |
| `auth.test.ts` | `lib/auth.ts` | `resolverModulos`, `temModulo`, sessão assinada (ida e volta, expiração em 12h, **token adulterado/forjado/outro segredo rejeitado**), PBKDF2 |
| `cobranca.test.ts` | `lib/cobranca.ts` | situação efetiva (fundador nunca bloqueia, teste, carência de 7 dias, pendente só com folga para quem assinou no teste, cancelada até o pago), `escritaBarrada` (falha fechada, exportações e cobrança livres), limites, troca proporcional, recálculo insensível à ordem, CPF/CNPJ |
| `gatewayAsaas.test.ts` | `lib/gatewayAsaas.ts` | config por env (sandbox por padrão), token do webhook, tradução de status e eventos, link só do Asaas, payload sem cartão |
| `paginacao.test.ts` | `lib/db.ts` (+ livro, saldo, empresas) | banco falso que corta em 1.000 linhas: `lerTudo`, `lerAteTeto`, `emLotes`, livro com 2.500 lançamentos, mês de 1.500, 1.300 empresas, saldo por 1 linha. Ver [`desempenho.md`](desempenho.md) |
| `proxySomenteLeitura.test.ts` | `proxy.ts` + `lib/acesso.ts` | 402 para contador e cliente do escritório bloqueado; leitura, exportação, login/logout e cobrança livres; master e escritório em dia passam; webhook público |

**Atenção para a Frente A:** `auth.test.ts` testa o comportamento *atual* (sessão
sem `escritorioId`). Ao acrescentar o campo, ajuste os `toMatchObject` de
`criarSessao`/`lerSessao` e adicione casos do novo campo.

## O que NÃO está coberto (e sugestão de extração)

Funções que misturam regra com I/O. Não refatorei produção; a regra fica sem teste
direto até ser extraída:

1. **Cheque = 2 lançamentos** — mora em `app/api/caixa/lancamentos/route.ts`
   (POST). Extrair `montarLinhasCheque(l, autor, agora): Linha[]` para
   `lib/caixa.ts` (retirada com `saida+juros+multa` antes do pagamento, `criado_em`
   com +1 ms) e testar.
2. **Saldo corrido / saldo transportado** — `montarLivro` (caixa.ts) e
   `saldoTransportado` misturam SELECT com a soma, e o saldo corrido por linha está
   dentro de `desenharMes` (livroCaixa.ts, privada). Extrair
   `encadearMeses(saldoInicial, linhas): MesLivro[]` e `saldoCorrido(saldoAnterior,
   linha)`. Hoje `livroCaixa.test.ts` reproduz a conta em um helper local — se a
   regra mudar em produção, esse helper **não** acusa. A extração fecha isso.
3. **`lib/cadastro.ts`, `lib/sheets.ts`, `lib/folhaPonto.ts`, `lib/planilha*.ts`,
   `lib/ocr.ts`, `lib/contratosServidor.ts`** — I/O (Supabase/Sheets/Gemini/docx/xlsx).
   `planilha.ts`/`planilhaCaixa.ts` (ExcelJS) e `folhaPonto.ts` (pdf-lib) seriam
   bons candidatos a teste de "gera arquivo e relê" numa próxima rodada.
4. Rotas de API e `proxy.ts` (lista de permissão do `cliente`) — sem teste; é onde
   a Frente A mexe. Vale um teste de contrato por rota depois da integração.

## Bugs e riscos achados

Nenhum teste de comportamento falhou. A revisão levantou estes pontos, registrados
como `it.todo` (não corrigi nada em silêncio):

| # | Onde | Achado | Gravidade |
|---|---|---|---|
| 1 | `lib/auth.ts` `getSecret()` | Sem `SESSION_SECRET` o app cai num segredo padrão **público** no código; em produção isso permite forjar sessão de master. O `.env.example` já avisa, mas nada impede o deploy sem a variável. Sugestão: falhar quando `NODE_ENV=production` e a variável faltar. (O teste de token adulterado passa porque cobre assinatura com o segredo atual; o risco é o segredo conhecido.) | alta |
| 2 | `lib/config.ts` | `MASTER_PASSWORD` cai em `admin1234` e `MASTER_EMAIL` num e-mail fixo quando faltam as variáveis. Mesmo cuidado. | alta |
| 3 | `lib/auth.ts` | Assinatura da sessão e hash da senha comparados com `!==`/`===` (não é tempo constante). Risco baixo na prática. | baixa |
| 4 | `lib/auth.ts` | PBKDF2 com 100.000 iterações; a recomendação atual para SHA-256 é ~600.000. Mudar exige re-hash no login. | baixa |
| 5 | `lib/caixa.ts` `paraValor` | `"1,234.56"` (formato americano) vira `1.23` e `"1234.567"` vira `1.234.567`, sem erro. Para entrada digitada em pt-BR é raro, mas o valor errado entra no livro em silêncio. | média |
| 6 | `lib/caixa.ts` `paraValor` | `"1.234"` é sempre lido como 1234 (milhar). Comportamento coerente com pt-BR, só vale saber — travado em teste. | informativo |

Os itens 1–5 estão como `it.todo` em `tests/auth.test.ts` e `tests/caixa.test.ts`.

## Armadilhas ao escrever testes aqui

- Teste de data: use `vi.useFakeTimers()` + `vi.setSystemTime(...)` para `hojeBelem`
  e `dadosVazios`; lembre que Belém é UTC−3 (02:00Z ainda é o dia anterior).
- Importar `lib/caixa.ts` é seguro: `getDb()` é preguiçoso e só falha se chamado.
- `process.env` em teste: `vi.stubEnv` + `vi.unstubAllEnvs()` num `finally`.

## Lint

`eslint.config.mjs` (do main) ignora `.claude/**` e rebaixa `react-hooks/set-state-in-effect` a aviso (telas antigas carregam dados em efeito). O lint é bloqueante no CI.
