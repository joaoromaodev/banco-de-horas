# QA visual — Sprint 11 (pente-fino no navegador)

Data: 21/11/2026. Navegador embutido, app local (`npm run dev`), conta de teste
`qa-visual-…@example.com` (contadora) e um login de cliente da empresa de teste, com
empresa, 2 empregados, 7 lançamentos e a folha de outubro. **Tudo apagado no fim**
(escritório, empresa, 2 usuários, dados; Storage vazio); contagens das 35 tabelas
idênticas às de antes.

Legenda: ✅ conferido e ok · ⚠️ ok com ressalva (ver pendências) · ❌ defeito (corrigido, se
estiver em "Corrigido") · — não exercitado nesta combinação.

Método: leitura da tela + captura, auditoria por script de rolagem horizontal
(`scrollWidth` × largura) e leitura do console em aba limpa. Claro e escuro conferidos
nas telas-chave; as demais usam só papéis de cor (nada de cor solta), então herdam o
tema. Marcado "✅" no escuro quando a tela foi vista no escuro ou é a mesma estrutura de
uma já vista.

## Tabela telas × combinações

### Contadora

| Tela | Desktop claro | Desktop escuro | 375 px claro | 375 px escuro | Console | Observação |
|---|---|---|---|---|---|---|
| `/painel` (checklist, conferência entre módulos, KPIs) | ✅ | ✅ | ✅ | ✅ | limpo | ~~KPIs empilham 1 por linha no celular~~ → 3 lado a lado (Sprint 12, Acabamento 1) |
| `/agenda` (visão geral, DP) | ✅ | ✅ | ✅ | ✅ | limpo | vazio humano, aponta "Obrigações por empresa" |
| `/agenda/obrigacoes` | ✅ | ✅ | ✅ | ✅ | limpo | |
| `/documentos` | ✅ | ✅ | ✅ | ✅ | limpo | tabela de arquivos ganhou `relative` por prevenção |
| `/fechamento` (pedidos mensais) | ❌→✅ | ✅ | ✅ | ✅ | era erro | checkboxes viravam campos de texto (ver Corrigido 1) |
| `/escritorio` | ✅ | ✅ | ✅ | ✅ | limpo | |
| `/dp` lista + grade em lote | ✅ | ✅ | ❌→✅ | ✅ | limpo | página ganhava 100 px de rolagem horizontal (Corrigido 2); data sem barras dava erro (Corrigido 4) |
| `/dp` ficha (férias, 13º) | ✅ | ✅ | ✅ | ✅ | limpo | |
| `/dp` simulação de rescisão | — | — | — | — | — | arquivo da frente B: não mexi; só abri o botão |
| `/ponto` Timesheet + revisão CLT + "Resumo para a folha" | ❌→✅ | ✅ | ❌→✅ | ✅ | era erro | fila "Folhas enviadas" aparecia 6× e 100–1.100 px de rolagem no celular (Corrigido 2 e 3) |
| `/ponto` folha aberta (editor) | ✅ | ✅ | ✅ | ✅ | limpo | rótulo "(Sheets)" obsoleto (Corrigido 5) |
| `/ponto` fila de folhas do cliente — estado vazio | ✅ | ✅ | ✅ | ✅ | limpo | com envio real (foto + IA): ver "Não exercitado" |
| `/caixa` lançamentos, excluir com confirmação + desfazer | ✅ | ✅ | ❌→✅ | ✅ | limpo | tabela do livro arrastava a página (800 px) |
| `/caixa/resumo` | ✅ | ✅ | ✅ | ✅ | limpo | ~~rótulos do gráfico pequenos~~ → desenho em pixels reais, 12 px (Acabamento 4) |
| `/caixa/demonstrativo` | ✅ | ✅ | ✅ | ✅ | limpo | ~~abre em "Janeiro · em aberto"~~ → último mês confirmado ou com movimento (Acabamento 2) |
| `/caixa/cadastros`, `/cadastros`, `/ponto-cadastros`, `/equipe`, `/folhas` | ✅ | ✅ | ✅ | ✅ | limpo | |
| `/contratos` | ✅ | ✅ | ✅ | ✅ | limpo | ~~barra de ações flutuante apertada em 1024 px~~ → duas linhas, downloads em grade 2×2 (Acabamento 3) |
| Sino de notificações | ✅ | ✅ | ✅ | ✅ | limpo | vazio humano ("Nada novo nos últimos 14 dias") |
| Modo escuro (botão do rodapé) | ✅ | | | | | persistência em `localStorage` ok |

### Cliente

| Tela | Desktop claro | Desktop escuro | 375 px claro | 375 px escuro | Observação |
|---|---|---|---|---|---|
| `/enviar-ponto` | ✅ | ✅ | ✅ | ✅ | envio real (foto + IA) não exercitado |
| `/caixa` (visão do cliente) | ✅ | ✅ | ✅ | ✅ | |
| `/documentos` (cliente) | ✅ | ✅ | ✅ | ✅ | |
| `/` | ✅ | | ✅ | | cai em `/caixa` (a página inicial do cliente é da frente A) |

## Corrigido (com arquivo)

1. **Pedidos mensais: caixas de marcação apareciam como campos de texto.** `Marcacao` não
   definia `type`, e a tela `/fechamento` não o passava — o React ainda avisava de
   "input não controlado". Agora o padrão é `checkbox`.
   [`components/ui.tsx`](../components/ui.tsx)
2. **Rolagem horizontal da página inteira no celular** em `/caixa` (801 px), `/ponto`
   (1.172 px) e `/dp` (475 px). Causa: o `sr-only` (posição absoluta) do cabeçalho
   "Ação" escapava da moldura de rolagem porque ela não era posicionada. A moldura de
   tabela (`tb.moldura`) ganhou `relative`; o mesmo nas duas tabelas soltas de
   contratos e documentos.
   [`components/ui.tsx`](../components/ui.tsx),
   [`app/(app)/contratos/page.tsx`](../app/(app)/contratos/page.tsx),
   [`app/(app)/documentos/page.tsx`](../app/(app)/documentos/page.tsx)
3. **Timesheet: "Folhas enviadas pelos clientes" repetida 6×** e erro "duas crianças com a
   mesma chave" no console: `FolhasEnviadas` e `ResumoFolha` eram irmãos com
   `key={empresa}`. Chaves distintas.
   [`app/(app)/ponto/page.tsx`](../app/(app)/ponto/page.tsx)
4. **DP, grade em lote: data digitada sem barras (`01062026`) dava "Data inválida".** A
   leitura aceita agora `ddmmaaaa` (com teste).
   [`lib/dpLote.ts`](../lib/dpLote.ts), [`tests/dpLote.test.ts`](../tests/dpLote.test.ts)
5. **Botão "Salvar no banco (Sheets)"**: o ponto grava no Postgres desde a migração 0012.
   Texto agora é "Salvar no banco".
   [`app/(app)/ponto/page.tsx`](../app/(app)/ponto/page.tsx)
6. Teste de regressão para 1 e 2: [`tests/uiMoldura.test.ts`](../tests/uiMoldura.test.ts).

## Acabamentos — Sprint 12, frente B (as ressalvas ⚠️ acima)

Conferido por teste e leitura de código — o app **não** foi aberto no navegador nesta
rodada (o `.env` aponta para produção e o login exige credencial real). Vale um olhar
rápido em 375 px e 1024 px no próximo QA.

1. **`/painel`, KPIs no celular.** A grade passa a `grid-cols-3` em qualquer largura
   (`gap-2`, `sm:gap-3`) e o `Indicador` ficou mais enxuto abaixo de `sm`
   (`px-3 py-3`, `min-w-0`). O rótulo "Para esta semana" virou "Esta semana" para caber
   numa linha em ~100 px de cartão; a frase acima dos números já dá o contexto.
   [`app/(app)/painel/page.tsx`](../app/(app)/painel/page.tsx),
   [`components/ui.tsx`](../components/ui.tsx)
2. **`/caixa/demonstrativo`, mês inicial — decisão:** abre no **último mês confirmado em
   sequência desde janeiro** (é o que a contadora envia e o único que o cliente vê). Sem
   nenhum confirmado, no **último mês com movimento** (sem passar do mês corrente — um
   lançamento adiantado de dezembro não puxa a tela); sem movimento, no **mês anterior
   ao corrente** (a competência que fecha agora), dezembro num exercício passado e
   janeiro num futuro. O `?mes=` do link do e-mail continua mandando. Regra pura em
   `mesInicial` com 6 testes.
   [`lib/demonstrativo.ts`](../lib/demonstrativo.ts),
   [`app/(app)/caixa/demonstrativo/page.tsx`](../app/(app)/caixa/demonstrativo/page.tsx),
   [`tests/demonstrativo.test.ts`](../tests/demonstrativo.test.ts)
3. **`/contratos`, barra flutuante em 1024 px** (a coluna do formulário tem ~420 px ao
   lado da lista). A barra virou duas linhas: "Salvar contrato" + formato (Word/PDF) em
   cima; os quatro downloads embaixo, `tamanho="sm"`, num grupo "Baixar documentos" que
   é grade 2×2 quando o **contêiner** é estreito e fileira única a partir de `@xl` (576 px)
   (container query do Tailwind 4 — mede a barra, não a janela). "Admissão completa
   (.zip)" ficou "Admissão (.zip)" com `data-dica` explicando o que vai no arquivo.
   [`app/(app)/contratos/page.tsx`](../app/(app)/contratos/page.tsx)
4. **`/caixa/resumo`, rótulos do gráfico.** Causa: o SVG tinha `viewBox` fixo de
   720 × 200 e escalava para caber, então a fonte "10" virava ~5 px na coluna de 400 px
   e menos no celular. Agora o contêiner é medido (`ResizeObserver`) e o desenho é feito
   na largura real: eixo e meses em 12 px, rótulo do último saldo em 13 px, altura
   190–220 px. Abaixo de ~30 px por mês, os meses aparecem um sim, um não (jan, mar,
   mai…); a dica do mês em foco encosta para dentro perto das bordas. Geometria pura em
   `geometria.ts`, com teste.
   [`app/(app)/caixa/resumo/Graficos.tsx`](../app/(app)/caixa/resumo/Graficos.tsx),
   [`app/(app)/caixa/resumo/geometria.ts`](../app/(app)/caixa/resumo/geometria.ts),
   [`tests/graficosResumo.test.ts`](../tests/graficosResumo.test.ts)

Fica anotado: o gráfico do **Demonstrativo** (`caixa/demonstrativo/Grafico.tsx`) usa o
mesmo `viewBox` fixo (640 px, fonte 11) — no desktop sai quase em tamanho real, mas no
celular encolhe. Candidato a reaproveitar `geometria.ts` numa próxima rodada.

## Pendências (priorizadas)

1. **Envio real de folha pelo cliente não foi exercitado** (foto → bucket → IA → fila →
   aplicar/devolver com desfazer): exigiria chamar o Gemini da plataforma. Falta um olhar
   no navegador com uma foto de verdade, no celular.
2. **Livro Caixa: "Revisão do exercício" lista um aviso por mês sem lançamento** (9 linhas
   amarelas em novembro). Para empresa nova ou com poucos meses vira ruído; sugerir
   recolher em "ver todos" ou resumir ("sem lançamento de janeiro a setembro").
3. ~~**Painel no celular: 3 KPIs (Atrasadas / Esta semana / Para conferir) em uma coluna**
   gastam três telas; `grid-cols-3` com número grande já cabe em 375 px.~~ Resolvido (Acabamento 1).
4. ~~**Demonstrativo de caixa abre em "Janeiro · em aberto"**: deveria abrir no último mês
   confirmado (ou no mês anterior), que é o que a contadora vai enviar.~~ Resolvido (Acabamento 2).
5. **Duas ações "Completar cadastro" na lista do DP** (aviso e cabeçalho da tabela) e dois
   botões "Abrir ficha" por empregado no acessibilidade (versão tabela e cartão):
   conferir se o duplicado fica oculto para leitor de tela (`aria-hidden`/`hidden`).
6. Menores: ~~gráfico do resumo do caixa com rótulos de eixo ~9 px; barra flutuante de
   "Salvar contrato" apertada em 1024 px~~ (resolvidos, Acabamentos 3 e 4); o rodapé da barra lateral não mostra o nome do
   usuário enquanto a sessão carrega (mostra "—").

## Não exercitado / fora de escopo

- `/inicio`, `proxy.ts`, `lib/inicio*.ts` (frente A) e `lib/rescisao*.ts`,
  `SimularRescisao.tsx` (frente B): nenhum defeito anotado, mas **a rescisão não foi
  aberta** aqui.
- Exportações (`.xlsx`, PDF, `.zip`) e envio do demonstrativo não foram baixados/enviados
  nesta rodada: os botões carregam, o conteúdo dos arquivos está coberto pelos testes de
  regra.
- Contratos: formulário aberto e botão "Salvar contrato" vistos; geração do `.docx`
  não conferida.
