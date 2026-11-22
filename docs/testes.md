# Testes e CI

Última atualização: **21/11/2026** (Sprint 15, Frente B — arrumar a casa: lint e arquivada no portal).

Rede de segurança das regras puras de `lib/` e, desde a Sprint 14, das **guardas
das rotas de API**, do **proxy do cliente** e dos **fluxos críticos** pelas rotas.
Não há teste de tela; Supabase, Storage, Sheets e Gemini são sempre simulados.

## O que o CI passa a garantir (Sprint 14)

| Teste | Garante | Se quebrar |
|---|---|---|
| `guardaRotas.test.ts` | **Todo** handler exportado (GET/POST/PUT/PATCH/DELETE) de `app/api/**/route.ts` chama uma guarda de `lib/acesso.ts` (`exigir*` ou `sessaoDe`), direto ou por helper local/importado (`guardaEmpresa`, `exigirEmpresaPonto`, `exigirEmpregado`...). As exceções (login, logout, criar-conta, webhook do Asaas, cron) ficam numa lista comentada, cada uma com a **prova** da proteção (token, `CRON_SECRET`, limitador) e conferida como pública no proxy. Sem sessão, toda outra rota leva 401 no proxy. | A mensagem diz a rota e o método. Ponha a guarda no começo do handler; se for pública de verdade, PUBLICO no proxy + `EXCECOES` no teste. |
| `proxyCliente.test.ts` | Lê as telas do cliente (`/inicio`, `/caixa`, `/documentos`, `/enviar-ponto` e o layout com o sino), segue os imports e junta os `/api/...` citados. (1) tudo o que elas chamam passa no proxy para o cliente; (2) todo prefixo de API em `CLIENTE_PODE` é usado por alguma tela do cliente; (3) rota sob prefixo do cliente que nenhuma tela dele usa exige gestor (`exigirGestor`/`Master`/`AdminEscritorio`) — ou está em `COMPARTILHADAS_SEM_TELA` com motivo (hoje só `/api/envio-ponto/foto`); (4) toda API fora de `CLIENTE_PODE`/`PUBLICO` dá 403 ao cliente. | (1) falta prefixo em `CLIENTE_PODE`; (2) prefixo sobrando; (3) rota da contabilidade aberta ao cliente: `exigirGestor`. |
| `caixaFluxoRotas.test.ts` | Fluxo do caixa pelas rotas, com as **guardas reais** (cookie assinado) e banco em memória: cliente lança → resumo/Demonstrativo escondidos → contadora confere → confirma o mês (upsert) → cliente vê resumo e Demonstrativo (sem registro de envio) → livro PDF/XLSX. Editar o conferido derruba a conferência; desconfirmar esconde; cheque = 2 linhas. Isolamento: outro escritório, outra empresa do mesmo escritório, cliente em rota da contabilidade (conferir, confirmar, livro, revisão), conta de catálogo de outro escritório, empresa arquivada (contabilidade lê, grava 409; cliente dela 403), sem sessão 401 — sempre conferindo que **nada foi gravado**. | — |
| `envioPontoFluxoRotas.test.ts` | Folha enviada pelo cliente com guardas reais e I/O com estado: envia → confirma → lê → aplica (grafia do cadastro) → cliente vê "aplicada" → não reaplica/devolve/exclui → desfazer; e devolvida com motivo visível ao cliente. Isolamento: outro escritório (404/403), outra empresa (404/403, não envia em nome da outra), cliente não aplica/devolve, empresa arquivada (409 ao gravar; cliente 403). Complementa `envioPontoRotas.test.ts`, que mocka as guardas. | — |

| `mesFechadoRotas.test.ts` (Sprint 17 · C) | Mês fechado com guardas reais e banco em memória. **Caixa:** cliente e contadora recebem 409 ("… está fechado pela contabilidade… reabre o mês informando o motivo") ao lançar (inclusive cheque), editar, mover para o mês fechado e excluir; mês anterior a um fechado também trava; meses fecham em ordem; conferir segue livre; saldo inicial bloqueado; reabrir: cliente 403, sem motivo 400, com motivo 200 + histórico, reabre os posteriores; sem a 0034 reabrir dá 503. **Ponto:** foto só com horas/dias; salvar, aplicar envio e enviar foto em mês fechado → 409; pendência impede fechar; reabrir exige contabilidade e motivo; aceite (dúvida com texto, aceito definitivo, versão da declaração, teto de 30, assinatura velha 409), aviso do sino sem nome. Isolamento: outro escritório, outra empresa, contabilidade na rota do cliente, arquivada, sem sessão — sempre conferindo que nada foi gravado. | — |
| `mesFechado.test.ts` | Regras puras de `lib/mesFechado.ts`: motivo e dúvida, mensagens, situação do aceite por assinatura, aviso do sino, foto do resumo, comparação com o jsonb (chaves reordenadas), impedimento para fechar. | — |

Helpers: `tests/varreduraRotas.ts` (leitura estática das rotas e telas),
`tests/rotaTeste.ts` (escritórios, empresas e sessões de teste; pedido com cookie
assinado; cadastro falso que esconde arquivadas) e `tests/bancoFalso.ts`, que agora
também grava (`insert`/`update`/`delete`/`upsert`; `.not('col', 'in', '(…)')` desde a Sprint 17) com `aoGravar` (coluna gerada),
`aoLer` (join) e `visoes` (view, ex.: `resumo_mensal`).

### Rota nova: o que fazer

1. Comece cada handler com a guarda de `lib/acesso.ts` que corresponde e devolva
   `g.resposta` quando `!g.ok`. Empresa vinda do pedido: `exigirEmpresa` (ou
   `motivoNegado` depois de `exigirSessao`/`exigirGestor`). Só a contabilidade:
   `exigirGestor`. Avisos do cliente: `exigirClienteDaEmpresa`.
2. Declare o handler na coluna 0 (`export async function GET(...)`) — é o formato
   que a varredura lê; reexportação (`export { GET } from`) é acusada.
3. Se o cliente usa: ponha o prefixo em `CLIENTE_PODE` (proxy.ts) e chame a rota
   de uma tela do cliente. Se fica sob um prefixo do cliente mas é da
   contabilidade, use `exigirGestor`.
4. Pública de verdade (webhook, cron): PUBLICO no proxy + entrada em `EXCECOES`
   de `guardaRotas.test.ts` com o motivo e a prova.
5. Rode `npm test`: os dois testes-varredura dizem o que faltou.
6. Rota que lê/grava dado de empresa: acrescente um caso de isolamento (outro
   escritório, outra empresa, arquivada) no padrão de `caixaFluxoRotas.test.ts`.

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
| `ferias.test.ts` | `lib/ferias.ts` | aquisitivo/concessivo (29/02), art. 130 por faixa, saldo por período, vencendo/vencidas/dobro, feriados legais (20/11 sim, Carnaval não), início vedado antes de DSR/feriado, fracionamento (5/14/3 períodos, direito < 14), abono 1/3, sobreposição, afastado/desligado, alertas |
| `decimoTerceiro.test.ts` | `lib/decimoTerceiro.ts` | avos com 15+ dias, faltas derrubando o avo, desligado, previstos × contados, prazos antecipados (18/12/2026) |
| `dp.test.ts` | `lib/dp.ts`, `lib/dpAgenda.ts` | CPF, dinheiro BR, validação do empregado, `jornadaDoEmpregado`/`temBancoDeHoras` (frente B), itens do DP na agenda sem CPF/salário |
| `feriasPdf.test.ts` | `lib/feriasPdf.ts` | aviso e recibo válidos, acentos, sem abono/CPF |
| `dpAcesso.test.ts`, `dpRotas.test.ts` | `proxy.ts`, `app/api/dp/**` | só contabilidade com ponto; outro escritório 403 em ler/editar/programar/excluir/PDF; cliente 403; arquivada só consulta; lista sem CPF inteiro |
| `contratosPdf.test.ts` | `lib/contratosPdf.ts` | os três PDFs são válidos, contrato + termo, acentos e caracteres fora do WinAnsi, texto longo pagina |
| `caixa.test.ts` | `lib/caixa.ts`, `planoContasPadrao.ts`, `app/(app)/caixa/formato.ts` | `paraValor`, `validarLancamento` (entrada xor saída, juros/multa = saída, ano do exercício), `saidaEfetiva`, depósito = saída e retirada = entrada no catálogo, CPF/CNPJ |
| `sugestaoConta.test.ts` | `lib/sugestaoConta.ts` (+ `iaPermitida`/`lerRegistroSugestao`) | tokens com forma de número, pseudônimo do pagador, compactação; fontes (a) analítica e (b) histórico, valor separando NF grande/pequena, nunca conta fora da lista visível; não conferidos com peso 0,3/teto 0,6; IA só entre as contas da empresa, complemento mascarado, resposta fora da lista = nada; IA desligada por padrão e em empresa de saúde |
| `revisaoPonto.test.ts` | `lib/revisaoPonto.ts` | horário ilegível ("12>54"), fora de ordem, marcações ímpares, limite contratual + 2h com teto de 10h e 10 min de tolerância, intervalo zerado/curto/15 min/> 2h/não marcado, interjornada (com a virada do mês), 7º dia seguido (com o mês anterior), feriado e folga com horário, marcador × horário, dia em branco só entre o 1º e o último lançado, falta, atestado > 15 dias, noturno, ponto britânico, leitura incerta, risco e ordem, 100 funcionários < 200 ms |
| `resumoFolha.test.ts` | `lib/resumoFolha.ts` | normais/extras 50% e 100% (domingo, feriado, sábado de folga), tolerância de 10 min no dia, atraso, banco de horas (extras → banco, domingo segue a pagar, marcador sem acordo), faltas e DSR (duas na semana = 1, virada de mês, sábado de folga), atestado/férias/folga/feriado, impedimentos (marcação faltando, ilegível, marcador × horário), noturno (hora reduzida 8/7, virada da meia-noite, prorrogação após 5h, madrugada sem prorrogação), assinatura, CSV, `regrasDoEmpregado`, 100 funcionários |
| `revisaoCaixa.test.ts` | `lib/revisaoCaixa.ts` | duplicidade e quase (pagador na chave, cheque e transferência fora, balcão médio), documento só após NF/recibo e em 60 dias, valor fora do padrão (mediana + MAD), natureza invertida (estorno médio), pagador/CPF, data futura, alterado após confirmar, juros recorrentes, saldo negativo pelo fim do dia, mês sem lançamento com carência, risco, 5 mil lançamentos < 1 s |
| `limiteFaturamento.test.ts` | `lib/limiteFaturamento.ts` | níveis 80/100/120%, MEI (R$ 81 mil, proporcional R$ 6.750 × meses, só o ano-calendário, 97.200 ≠ retroativo), Simples (janela de 12 meses, faixas, sublimite, ano de início, menos de 12 meses), vigência editável, caixa incompleto, texto sempre "estimativa pelo caixa" |
| `demonstrativo.test.ts` | `lib/demonstrativo.ts` | mês liberado só em sequência desde janeiro, comparação com mês anterior/média só com meses visíveis, base zero, ranking das 5 maiores saídas, e-mail sem "DRE" e com HTML escapado |
| `livroCaixa.test.ts` | `lib/livroCaixa.ts` | saldo transportado encadeado, saída efetiva, cheque neutro, PDF gerado (nº de folhas, paginação, pessoa física) |
| `formatoLivro.test.ts` | `lib/formatoLivro.ts`, `lib/data.ts` | meses, `isoParaBR`, `dataBR` |
| `agenda.test.ts` | `lib/agenda.ts` | Páscoa/feriados nacionais (20/11, Carnaval, Corpus Christi), dia útil, antecipa/prorroga, n-ésimo e último dia útil, mensal/trimestral/anual/única, "acompanhar a partir de", catálogo e modelos, validação, resumo e e-mail (HTML escapado) |
| `auth.test.ts` | `lib/auth.ts` | `resolverModulos`, `temModulo`, sessão assinada (ida e volta, expiração em 12h, **token adulterado/forjado/outro segredo rejeitado**), PBKDF2 |
| `cobranca.test.ts` | `lib/cobranca.ts` | situação efetiva (fundador nunca bloqueia, teste, carência de 7 dias, pendente só com folga para quem assinou no teste, cancelada até o pago), `escritaBarrada` (falha fechada, exportações e cobrança livres), limites, troca proporcional, recálculo insensível à ordem, CPF/CNPJ |
| `gatewayAsaas.test.ts` | `lib/gatewayAsaas.ts` | config por env (sandbox por padrão), token do webhook, tradução de status e eventos, link só do Asaas, payload sem cartão |
| `paginacao.test.ts` | `lib/db.ts` (+ livro, saldo, empresas) | banco falso que corta em 1.000 linhas: `lerTudo`, `lerAteTeto`, `emLotes`, livro com 2.500 lançamentos, mês de 1.500, 1.300 empresas, saldo por 1 linha. Ver [`desempenho.md`](desempenho.md) |
| `medicao.test.ts`, `medicaoRotas.test.ts` | `lib/medicao*.ts`, `app/api/medicao`, `app/api/config/medicao` | medição própria (Sprint 15): ids/uuids/datas/e-mail/CPF viram placeholder e a query some; lista fechada de rotas em sincronia com `app/`; código de erro sem mensagem; o navegador só manda `rede`; linha gravada sem coluna pessoal e papel da sessão; 0031 com RLS e sem policy; p50/p95, erros e volume; sem tabela/banco lento não lança; resumo só para o master. Ver [`desempenho.md`](desempenho.md) |
| `proxySomenteLeitura.test.ts` | `proxy.ts` + `lib/acesso.ts` | 402 para contador e cliente do escritório bloqueado; leitura, exportação, login/logout e cobrança livres; master e escritório em dia passam; webhook público |
| `acessibilidadeCliente.test.ts` | telas do cliente (`/inicio`, `/caixa`, `/documentos`, `/enviar-ponto`, layout e sino) + o que importam | leitura estática (Sprint 16): botão/link sem nome, `BotaoIcone` sem `rotulo`, campo/lista sem rótulo, `<img>` sem `alt`, valor sem `inputMode="decimal"`, `alert`/`<select>`; 44 px das primitivas no celular; contraste AA dos papéis de `globals.css` nos dois temas; autoteste com arquivo de mentira. Ver [`qa-visual.md`](qa-visual.md) |
| `leituraSemIa.test.ts`, `leituraSemIaRotas.test.ts` | `lib/boleto.ts`, `lib/notaFiscalXml.ts`, `lib/leituraSemIa*.ts`, `app/api/caixa/documento-leitura` | Sprint 17 (nota e boleto sem IA): boleto bancário e de arrecadação com os DVs **conferidos à mão** (contas no comentário), fator de vencimento com o reinício de 2025, dígito trocado recusado; XML de NF-e/NFC-e, NFS-e nacional e ABRASF montados no teste (entrada × saída pelo CNPJ, filial, `tpNF 0`, parcelas, CPF fora do complemento, DOCTYPE recusado); PDF gerado com pdf-lib e lido pelo unpdf (recibo, boleto, DANFE, escaneado, torto, ambíguo → em branco); rota: 401/403/404/415, duplicidade só na mesma empresa, chave gravada no lançamento, sem a 0033 grava igual, **nenhum `fetch`** |
| `formularioCliente.test.ts` | `caixa/formato.ts` (`campoDoErro`), `lib/envioPonto.ts`, `lib/documentos.ts` | erro da rota de lançamento → campo (data, titular, analítica, valor, cheque); o que falta para enviar folha/documentos, por campo |

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
4. ~~Rotas de API e `proxy.ts`~~ — cobertos desde a Sprint 14 (varreduras + fluxos;
   ver acima). Ainda sem teste de fluxo: agenda, contratos, cobrança e painel (só a
   varredura de guarda).

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

## Achados da Sprint 14 (varreduras)

- **Nenhuma rota sem guarda.** Os 119 handlers de `app/api` (68 rotas) chamam guarda de
  `lib/acesso.ts`, exceto as 5 exceções legítimas (login, logout, criar-conta,
  webhook do Asaas com token, cron com `CRON_SECRET`).
- **Nenhuma API da contabilidade alcançável pelo cliente.** Sob os prefixos do
  cliente, as rotas sem tela do cliente (`/api/caixa/de-para`, `/api/caixa/seed`)
  exigem gestor/master; `/api/envio-ponto/foto` é compartilhada por decisão.
- ~~Observação: a contabilidade recebe 403 ao listar os envios de ponto de uma
  empresa arquivada.~~ **Resolvido na Sprint 15 (frente B)** — ver abaixo.

## Sprint 15, frente B — "Arrumar a casa"

**Empresa arquivada nos envios de ponto e no portal.** O 403 da Sprint 14 era do
**teste**, não da produção: o `cadastroFalso` de `tests/rotaTeste.ts` escondia as
arquivadas também em `lerEmpresa(id)`, enquanto o `lerEmpresa` real (lib/cadastro.ts)
as inclui desde a consulta de arquivadas. Em produção, `guardaEmpresa` →
`exigirEmpresa` → `motivoNegado` já lê o cadastro com as arquivadas. O fake agora
segue a produção (listas sem arquivadas; `lerEmpresa` com elas). Achado real de
verdade: `GET /api/documentos/arquivo` não passava por `respostaNegadaEmpresa`, então
o **cliente de empresa arquivada** (com cookie ainda válido) baixava documento —
corrigido; a contabilidade segue baixando (consulta).

| Teste | Garante |
|---|---|
| `envioPontoFluxoRotas.test.ts` (caso novo) | contabilidade lista a fila de envios e abre a foto da arquivada (200/302); outro escritório 403; nada muda |
| `documentosArquivadaRotas.test.ts` (novo) | Documentos e Pendências com guardas reais: contabilidade lista e baixa a arquivada; criar pendência, enviar, conferir, fechar e excluir dão **409** com a mensagem de reativar e nada é gravado; cliente da arquivada **403** (lista, pendências, download, envio); outro escritório 403/404 sem saber que ela está arquivada |

**Lint: de 45 avisos para 2.** Corrigidos de verdade: `BotaoTema` (components/tema.tsx)
lê a preferência com `useSyncExternalStore` (servidor = automático; o evento `storage`
e o próprio clique avisam); o "desfazer exclusão" do caixa some ao trocar
empresa/mês/ano por **ajuste durante a renderização**, sem efeito; a lista de
funcionários de `/folhas` é zerada no `onChange` da empresa; variáveis sem uso
(`contratos`, teste do pedido na visita). Os demais ficaram com
`// eslint-disable-next-line <regra> -- motivo`, em três motivos só:

- **carga da API** (o efeito busca ao montar ou ao trocar o filtro; zerar
  erro/espera antes do fetch é o que mantém `FalhaCarregamento` e "Tentar de novo"
  como estão) — trocar por outro padrão de carga é refatoração de tela, não de lint;
- **localStorage/URL após hidratar** (ano, empresa, formato, menu recolhido, lidas do
  sino): no `useState` inicial o HTML do servidor divergiria do navegador;
- **relógio** (`/inicio`, saudação pela hora de Belém), pelo mesmo motivo.

Ficaram **2 avisos** em `app/(app)/configuracoes/page.tsx` (carga da API), de
propósito: outra frente da Sprint 15 está mexendo nessa tela. Quem fechar a frente
dela põe o mesmo comentário de "carga da API".

## Lint

`eslint.config.mjs` (do main) ignora `.claude/**` e rebaixa `react-hooks/set-state-in-effect` a aviso (telas antigas carregam dados em efeito). O lint é bloqueante no CI. Aviso novo precisa de correção ou de `eslint-disable-next-line <regra> -- motivo` (ver Sprint 15 acima).
