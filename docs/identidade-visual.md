# Identidade visual — ClickContas

> **Leia antes de criar ou mexer em qualquer tela.** Toda página usa os papéis de
> cor de `app/globals.css` e as primitivas de `components/`. Vitrine navegável, com
> todos os componentes renderizados: [`design-system.html`](design-system.html).
> (O [`design-system.md`](design-system.md) é o guia genérico antigo, agnóstico de
> marca; em caso de divergência, vale este arquivo.)

Marca: **ClickContas — Praticidade Contábil** (`lib/brand.ts`). Petróleo + verde,
tema claro e escuro (claro / escuro / automático). Objetivo: bonito, simples, elegante — e nada
com cara de padrão do navegador.

## Regras de ouro

1. **Papéis, não cores.** Nenhuma tela escreve `slate-*`, `red-*`, `emerald-*`,
   `amber-*`… Use `text-tinta`, `border-borda`, `text-perigo` etc. Faltou um tom?
   Ele entra como papel no `globals.css`.
2. **Primitivas, não markup solto.** Botão é `<Botao>`, campo é `<Entrada>`, lista
   é `<Selecao>`. Proibido: `<select>`, `<datalist>`, `alert()`, `confirm()`,
   `prompt()`, `title=` cru (use `data-dica`).
3. **Uma ação primária** por tela — ou por cartão-formulário, quando a tela tem
   formulários independentes. O resto é `secundaria`, `tonal` ou `fantasma`.
4. **Excluir = confirmar + desfazer.** `DialogoConfirmacao` antes; `<Toast>` com
   botão "Desfazer" depois (sem cronômetro).
5. **Toda ação responde**: sucesso em toast (some em 5 s), erro em toast que fica.
   Aviso permanente da tela (saldo negativo, migração pendente) é `<Aviso>` em linha.
6. **375 px funciona**: a barra lateral vira gaveta, tabela rola dentro da moldura
   (`tb.moldura`), formulários empilham (`grid-cols-1` → `sm:`/`md:`).

## Tokens (`app/globals.css`, bloco `@theme`)

| Papel | Classe Tailwind | Valor | Uso |
|---|---|---|---|
| fundo | `bg-fundo` | `#f3f7f7` | fundo da página |
| superfície | `bg-superficie` | `#ffffff` | cartões, tabelas, diálogos, campos |
| superfície suave | `bg-superficie-suave` | `#f6f9f9` | cabeçalho de tabela, rodapé de diálogo |
| superfície realce | `bg-superficie-realce` | `#eef5f6` | hover de linha, item selecionado |
| borda | `border-borda` | `#dde6e7` | cartões, divisórias |
| borda forte | `border-borda-forte` | `#7f9499` | contorno de campo (3:1); em botão use `/50` |
| tinta | `text-tinta` | `#0f2226` | texto principal, títulos (16:1) |
| tinta suave | `text-tinta-suave` | `#47595d` | apoio, rótulos (7:1) |
| tinta fraca | `text-tinta-fraca` | `#5f7377` | placeholder, vazio (4,6:1) — o mínimo para texto |
| primária | `bg-primaria` / `-hover` | `#0f4c54` / `#0a3a40` | botão primário, aba ativa |
| primária suave | `bg-primaria-suave` | `#eef5f6` | botão tonal, aviso informativo |
| primária texto | `text-primaria-texto` | `#14636c` | links e destaque sobre claro |
| sucesso | `text-sucesso`, `bg-sucesso-suave`, `ring-sucesso-borda` | `#15803d` | **entradas**, confirmado |
| aviso | `text-aviso`, `bg-aviso-suave`, `border-aviso-borda` | `#92400e` | atenção, a conferir |
| perigo | `text-perigo`, `bg-perigo-suave`, `bg-perigo-solido` | `#b91c1c` / `#c81e1e` | erro, **saídas**, excluir |
| primária borda / realce | `border-primaria-borda`, `ring-primaria-borda`, `bg-primaria-realce` | `#bcdadd` / `#d7e7e9` | contorno do tonal e do aviso info; hover do tonal, esqueleto |
| sobre primária | `text-sobre-primaria` | `#ffffff` | texto/ícone sobre `bg-primaria` (**no escuro é petróleo escuro**) |
| sucesso realce | `bg-sucesso-realce` | `#d1fadf` | hover do botão de sucesso |
| perigo hover | `bg-perigo-hover` | `#b91c1c` | hover do botão destrutivo |
| foco | (automático) | `#1c808b` | anel de foco do teclado |
| gráficos | `var(--color-grafico-entrada)`, `-saida` | `#059669` / `#dc2626` | séries do resumo do caixa (SVG) |

Os valores acima são do **tema claro**; o escuro redefine os mesmos papéis (ver
abaixo). Regra de ouro: **texto sobre `bg-primaria` é `text-sobre-primaria`, nunca
`text-white`** — no escuro a primária é um azul-petróleo claro e o texto vira
escuro. `text-white` só vale sobre o que é fixo nos dois temas (botão perigo sólido,
barra lateral, painel da marca, hero do site).

As rampas `petroleo-50…950` e `verde-50…700` continuam existindo, mas são para a
moldura da marca (barra lateral, painel do login). Nas telas, use os papéis.

- **Tipografia** (Geist): título de página `text-xl font-semibold tracking-tight`;
  título de seção `text-[15px] font-semibold`; corpo `text-sm`; apoio
  `text-[13px]`/`text-xs` em `tinta-suave`; cabeçalho de tabela `text-[11px]
  uppercase tracking-wider`. Tabelas já saem com `tabular-nums`.
- **Espaço**: ritmo de 4 px. Entre seções `space-y-5`; dentro de cartão `p-4 sm:p-5`;
  grade de formulário `gap-4`.
- **Raio**: `rounded-md` (célula, botão-ícone) · `rounded-lg` (botão, campo) ·
  `rounded-xl` (cartão, tabela, diálogo) · `rounded-full` (selo, avatar).
- **Sombra**: `shadow-cartao` (quase nada) e `shadow-flutuante` (diálogo, lista
  suspensa, toast). Só essas.
- **Foco**: global em `globals.css` — anel de 2 px em todo elemento interativo.
  Não escreva `outline-none`.
- **Movimento**: `animate-entrada` (toast). `prefers-reduced-motion` é respeitado.

Globais prontos (não reimplementar): barra de rolagem da marca (use
`rolagem-escura` sobre fundo petróleo), checkbox e radio desenhados, indicador de
data/hora, `::selection`.

## Tema escuro

Mesmos papéis, outros valores — definidos em `app/globals.css`, bloco
`:root[data-tema='escuro']`. Telas **nunca** testam o tema: só usam papéis, então
tudo já nasce nos dois temas. Não escreva `dark:`.

- **Mecanismo** (`components/tema.tsx`): um script no `<head>` (antes da primeira
  pintura, sem piscar) resolve a preferência — `localStorage['cc-tema']` =
  `claro` | `escuro`; ausente = **automático**, que segue `prefers-color-scheme` ao
  vivo — e grava o tema resolvido em `<html data-tema>`. `color-scheme` acompanha, então
  campos de data e a barra do navegador também escurecem. O botão `BotaoTema`
  (menu do usuário, na barra lateral) alterna automático → claro → escuro.
- **Paleta escura**: fundo `#0a1618`, superfície `#112226`, tinta `#e9f2f3`,
  primária `#4fb3bf` (texto sobre ela `#05262b`), sucesso `#4ade80`, aviso `#fbbf24`,
  perigo `#f87171`. Contrastes sobre a superfície: tinta 15:1, tinta-suave 9:1,
  tinta-fraca 6,4:1, primária-texto 8:1, estados ≥ 6:1, borda-forte 4,6:1 (AA).
- **O que é igual nos dois temas** (moldura da marca, escura por natureza): barra
  lateral, painel do login e hero do site (`petroleo-*` e `.hero`), `Dialogo` (só o
  véu). Dentro deles use `text-white`/`petroleo-*`; fora, só papéis.
- **Balão de dica**: invertido (`bg-tinta text-fundo`) — claro no escuro, escuro no claro.
- **Gráficos SVG**: cores via `var(--color-…)` em `fill`/`stroke` (funcionam como
  atributo); entrada/saída têm tokens próprios (`grafico-entrada/saida`), mais claros
  no escuro. Nunca hex solto.
- **Conferir uma tela nova**: alterne o tema (botão do rodapé da barra lateral) e
  veja desktop e 375 px nos dois. Se algo ficar ilegível, falta um papel — crie em
  `globals.css` (nos dois blocos), não pinte a tela.

## Primitivas

### `@/components/ui`

| Componente | Para quê |
|---|---|
| `Botao` | `variante`: `primaria` · `secundaria` (padrão) · `tonal` · `fantasma` · `perigo` · `sucesso`; `tamanho`: `sm` · `md` · `lg`; `carregando`; `icone`. `botaoCls()` veste um `<a>` de download. |
| `BotaoIcone` | Botão só com ícone. `rotulo` obrigatório (vira `aria-label` e balão de dica). `tom`: `neutro` · `apagado` · `primaria` · `perigo` · `sucesso`. |
| `Entrada`, `AreaTexto` | Campo com `rotulo`, `dica`, `erro` (já ligados por `aria-*`), `tamanho`, `largura`, `classeCampo` (classes do envelope, ex.: `md:col-span-2`). `controleCls()` para um input cru. |
| `Campo` | Envelope de rótulo para um controle próprio. |
| `Marcacao` | Checkbox/radio com texto (`type="checkbox"`/`"radio"`). |
| `Alternador` | Liga/desliga (checkbox com `role="switch"`). |
| `CampoArquivo` | Envio de arquivo: clicar ou soltar. |
| `CabecalhoPagina` | Topo de toda tela: `titulo`, `subtitulo`, `acoes`, `abas`. |
| `Abas` | Sub-navegação do módulo (links; ver `AbasPonto`, `caixa/AbasCaixa`). |
| `Conteudo` | Área da tela; `largura`: `cheia` · `media` · `estreita`. |
| `Cartao`, `Secao` | Superfície; `Secao` tem `titulo`, `descricao`, `acoes`. |
| `Selo` | Pílula de situação; `tom`: `neutro` · `primaria` · `sucesso` · `aviso` · `perigo`. |
| `Aviso` | Aviso em linha; `tom`: `info` · `sucesso` · `aviso` · `perigo` · `neutro`; `titulo`, `acao`. |
| `EstadoVazio` | Nunca deixe uma área em branco. `moldura={false}` dentro de tabela. |
| `FalhaCarregamento` | O **carregamento principal** da tela falhou: `Aviso` de perigo com mensagem humana e "Tentar de novo" (`onTentar`, `tentando`). Use com `lerJson`/`mensagemDeCarga` de `lib/carga.ts` — resposta não-ok ou sem rede vira mensagem em português, nunca texto técnico. **Proibido** `.catch(() => {})` no carregamento principal (tela vazia parece "não tem nada"). Fonte opcional que falha sozinha (bloco do `/inicio`, cota, sugestões) segue com `Aviso tom="neutro"` ou em silêncio, com comentário dizendo por quê. Erro inesperado de renderização cai em `app/(app)/error.tsx` (e `app/global-error.tsx` no layout raiz). |
| `Indicador` | Número de destaque (saldo, entradas, saídas); `destaque` em um só. |
| `Esqueleto`, `Carregando` | Carregamento: bloco pulsante e linha "Carregando…". |
| `Paginacao` | Anterior · página X de Y · próxima (ainda sem uso; pronto para listas longas). |
| `tb`, `celulaCls` | Classes de tabela (`moldura`, `tabela`, `cabeca`, `th`, `corpo`, `linha`, `td`, `tdCampo`, `num`, `vazio`) e do campo dentro de célula. |

### `@/components/selecao`

- `Selecao` — lista suspensa própria. `valor`, `onChange(valor)`, `opcoes:
  {valor, rotulo, detalhe?}[]`, `placeholder`. Busca automática acima de 8 opções
  (`busca={false}` desliga). `aparencia`: `campo` · `celula` (em tabela) · `selo`.
  Teclado: setas, Home/End, Enter, Esc, digitar. Abre em portal (não é cortada
  por tabela nem por modal).
- `EntradaSugestoes` — texto livre com sugestões (o antigo `<datalist>`).

### `@/components/retorno`

- `Toasts` + `Toast` — uma pilha por tela, um `<Toast>` por estado:
  ```tsx
  <Toasts>
    {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
    {msg && <Toast onFechar={() => setMsg(null)}>{msg}</Toast>}
    {desfazer && <Toast tom="info" onFechar={() => setDesfazer(null)}
      acao={<Botao tamanho="sm" variante="tonal" onClick={desfazerExclusao}>Desfazer</Botao>}>…</Toast>}
  </Toasts>
  ```
- `Dicas` — já montado no layout raiz. Qualquer elemento com `data-dica="texto"`
  ganha o balão (mouse e foco de teclado).

### `app/(app)/Dialogo.tsx`

`Modal` (moldura: foco preso, Esc, clique fora, devolve o foco),
`DialogoConfirmacao` (foco inicial no "Cancelar" quando é destrutivo) e
`DialogoValor` (substitui `prompt`).

## Esqueleto de uma tela

```tsx
<div className="text-sm">
  <CabecalhoPagina titulo="…" subtitulo="…" acoes={…} abas={<AbasCaixa … />} />
  <Toasts>…</Toasts>
  <Conteudo largura="media">
    <Secao titulo="…" descricao="…">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Entrada rotulo="Nome" … />
        <Selecao rotulo="Empresa" valor={…} onChange={…} opcoes={…} />
      </div>
      <div className="mt-5"><Botao variante="primaria">Salvar</Botao></div>
    </Secao>
  </Conteudo>
</div>
```

Tabela: `<div className={tb.moldura}><table className={tb.tabela}>…`; dinheiro
com `tb.num` + `text-sucesso` (entrada) ou `text-perigo` (saída).

## O que ficou de fora (de propósito)

- **Calendário próprio**: data e hora usam o campo nativo, estilizado (teclado e
  leitor de tela de graça); só o pop-up do calendário é do navegador.
- **Cores dos gráficos** (`caixa/resumo/Graficos.tsx`): entrada verde e saída
  vermelha foram mantidas (par validado para daltonismo); no escuro viram
  `#34d399` / `#f87171`, via tokens `grafico-entrada/saida`.
