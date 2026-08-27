# Guia de Design — padrões reutilizáveis

Documentação do **sistema de design** deste app (layout, espaçamento, raios,
tipografia, componentes e estados de interação), pensada para ser reaproveitada
em **outros projetos**. É **agnóstica de marca**: as cores aparecem por *papel
semântico* (`primary`, `surface`, `danger`…), não pela paleta específica. Troque
a rampa `primary` pelo seu tom e todo o resto continua valendo.

Stack de referência: **Next.js (App Router) + Tailwind v4**. As receitas usam
classes utilitárias; a rampa neutra é o `slate` padrão do Tailwind.

---

## 1. Princípios

1. **Superfícies claras sobre um fundo neutro.** A página tem um fundo levemente
   acinzentado (`surface-muted`); o conteúdo mora em **cartões brancos**. A
   separação vem de cor de fundo + borda fina de 1px, quase nunca de sombra.
2. **Sem grade dura.** Tabelas e listas separam linhas com um traço leve
   (`divide-y`), não com bordas em todas as células. Nada de aparência de planilha.
3. **Campos discretos.** Inputs dentro de tabelas são "invisíveis" até o
   hover/foco. O formulário respira; a edição se revela ao interagir.
4. **Um raio, uma borda, um neutro.** Consistência acima de variedade: quase tudo
   é `rounded-lg`/`rounded-xl`, borda `border-slate-200/300`, texto `slate`.
5. **Estado sempre visível.** Todo elemento interativo tem hover e foco; foco usa
   um anel suave da cor primária. `disabled` = `opacity-50`.
6. **Densidade calma.** Tipografia pequena (13–14px base), muito respiro vertical
   (`space-y-6`), rótulos auxiliares em `text-xs` cinza.

---

## 2. Fundações (tokens)

### Cor por papel (troque a rampa `primary` pela sua)

Em Tailwind v4, declare no `@theme` do CSS global. Aqui os **papéis**; o `primary`
é uma rampa de 50→950 de um único matiz.

```css
@import "tailwindcss";

@theme {
  /* MARCA — troque este matiz por projeto (aqui um exemplo neutro-azulado) */
  --color-primary-950: #0b1220;
  --color-primary-900: #111a2e;  /* base: sidebar, botão primário, aba ativa */
  --color-primary-800: #1b2942;
  --color-primary-700: #24406c;
  --color-primary-600: #2f5aa6;  /* borda de foco */
  --color-primary-500: #3b74d1;
  --color-primary-100: #dbe6f7;  /* anel de foco */
  --color-primary-50:  #eef4fc;  /* faixa de cabeçalho de tabela / hero claro */

  /* SEMÂNTICAS (podem ser as rampas padrão do Tailwind) */
  /* success → green-*, danger → red-*, warning → amber-* */

  /* NEUTROS de página */
  --color-ink:     #0f172a;      /* texto principal (ou slate-900) */
  --color-surface: #f1f5f5;      /* fundo da página */
}

body { background: var(--color-surface); color: var(--color-ink); }
```

Mapa de uso das cores:

| Papel | Onde aparece | Classe típica |
|---|---|---|
| `primary-900` | sidebar, botão primário, aba ativa, título de destaque | `bg-primary-900`, `text-primary-900` |
| `primary-600` | borda de input em foco | `focus:border-primary-600` |
| `primary-100` | anel de foco (`ring`) | `focus:ring-primary-100` |
| `primary-50` | faixa de cabeçalho de tabela, chips sutis | `bg-primary-50` |
| `slate-200` | **toda** borda de card/tabela/input | `border-slate-200` |
| `slate-300` | borda de botão secundário e input de formulário | `border-slate-300` |
| `slate-100` | separador de linhas (`divide-y`) | `divide-slate-100` |
| `slate-500` | texto auxiliar / descrições | `text-slate-500` |
| `slate-400` | placeholder, estado vazio | `text-slate-400` |
| `slate-900` | títulos | `text-slate-900` |
| `red-600 / red-50` | ação destrutiva e fundo do hover | `text-red-600`, `hover:bg-red-50` |
| `green-50 / red-50` | mensagens de sucesso / erro | ver §4.9 |

### Tipografia

Fonte sans-serif de sistema/Geist. Escala enxuta:

| Uso | Classe | ~px |
|---|---|---|
| Título de página (h1) | `text-lg font-semibold` | 18 |
| Título de seção/modal (h2) | `text-base font-semibold` ou `font-semibold` | 16 |
| Corpo / inputs | `text-sm` | 14 |
| Rótulo auxiliar, descrição, badge | `text-xs` | 12 |
| Cabeçalho de tabela (overline) | `text-[11px] font-semibold uppercase tracking-wide` | 11 |

Base do app costuma ser `text-sm` (a raiz da página usa `className="text-sm"`).
Títulos em `slate-900`, textos de apoio em `slate-500`.

### Espaçamento & raios

- **Ritmo vertical entre seções:** `space-y-6`.
- **Padding de card:** `p-5`. **Padding de página:** `p-6`.
- **Cabeçalho de página:** `px-6 py-4`.
- **Container de leitura:** `mx-auto max-w-4xl` (formulários) ou `max-w-3xl` (telas de config).
- **Raios:** `rounded-xl` (cards, tabelas, modais), `rounded-lg` (botões, inputs, abas, nav),
  `rounded-md` (inputs dentro de célula, botão-ícone), `rounded-full` (badges, avatar).
- **Borda padrão:** `border border-slate-200` (1px). Botões/inputs de formulário usam `slate-300`.
- **Sombra:** evite; só em camadas flutuantes (modal = `shadow-xl`).

---

## 3. Layout (shell)

### Estrutura app

```
<div class="flex min-h-screen">
  <aside> … sidebar de largura fixa … </aside>   // bg-primary-900, text-white; w-60 (recolhida w-16)
  <main class="min-w-0 flex-1"> … </main>
</div>
```

- **Sidebar:** `bg-primary-900 text-white`, largura `w-60` (expandida) / `w-16` (recolhida),
  transição `transition-all duration-200`. Estado recolhido persistido em `localStorage`.
- **Item de navegação:** `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm`;
  ativo = `bg-white/10 font-medium text-white`; inativo = `text-white/70 hover:bg-white/5 hover:text-white`.
- **Rodapé da sidebar (usuário):** cartão translúcido `bg-white/5 rounded-lg` com avatar circular.

### Cabeçalho de página (padrão em toda tela)

```html
<header class="border-b border-slate-200 bg-white px-6 py-4">
  <h1 class="text-lg font-semibold text-slate-900">Título</h1>
  <p class="text-xs text-slate-500">Subtítulo curto de contexto</p>
</header>
<div class="mx-auto max-w-4xl space-y-6 p-6">
  … seções em card …
</div>
```

### Faixa "hero" (opcional, para telas de destaque/login)

Gradiente radial da cor primária, cantos arredondados, texto branco:

```css
.hero {
  background: radial-gradient(120% 140% at 100% 0%,
              var(--color-primary-700) 0%, var(--color-primary-900) 45%, var(--color-primary-950) 100%);
  color: #fff;
  border-radius: 1rem;
}
```

---

## 4. Componentes (receitas)

### 4.1 Card / seção

```html
<section class="rounded-xl border border-slate-200 bg-white p-5">
  <h2 class="mb-1 font-semibold">Título da seção</h2>
  <p class="mb-2 text-xs text-slate-500">Descrição auxiliar.</p>
  … conteúdo …
</section>
```

Sufixo de módulo opcional no título: `<span class="font-normal text-slate-400">· Nome do módulo</span>`.

### 4.2 Botões

```html
<!-- Primário -->
<button class="rounded-lg bg-primary-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-800 disabled:opacity-50">Salvar</button>

<!-- Secundário -->
<button class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50">+ Item</button>

<!-- Destrutivo -->
<button class="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">Remover</button>
```

Grupo de ações: `mt-2 flex gap-2` (primário à esquerda, secundário ao lado).

### 4.3 Input de formulário

```html
<label class="mb-1 block text-xs font-medium text-slate-600">Rótulo</label>
<input class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none
              focus:border-primary-600 focus:ring-2 focus:ring-primary-100" />
```

Formulários em grade: `grid grid-cols-1 gap-3 sm:grid-cols-2`.

### 4.4 Tabela (padrão do site — sem grade dura)

O ponto central do visual: container arredondado, cabeçalho em faixa `primary-50`,
linhas com `divide-y`, célula editável discreta.

```html
<div class="overflow-x-auto rounded-xl border border-slate-200">
  <table class="w-full text-sm">
    <thead>
      <tr class="border-b border-slate-200 bg-primary-50/70 text-left
                 text-[11px] font-semibold uppercase tracking-wide text-primary-800">
        <th class="px-3 py-2.5">Coluna</th>
        <th class="w-12 px-3 py-2.5"></th>   <!-- coluna de ação estreita -->
      </tr>
    </thead>
    <tbody class="divide-y divide-slate-100">
      <tr class="group transition-colors hover:bg-slate-50/70">
        <td class="px-2 py-1"><input class="{cell}" /></td>
        <td class="px-2 py-1 text-center">
          <button class="{delBtn}" aria-label="Remover"><!-- ícone --></button>
        </td>
      </tr>
      <!-- estado vazio -->
      <tr><td colspan="N" class="px-3 py-8 text-center text-slate-400">Nada cadastrado.</td></tr>
    </tbody>
  </table>
</div>
```

Classes reutilizáveis referenciadas acima:

```
{cell}  = w-full rounded-md border border-transparent bg-transparent px-2.5 py-1.5
          text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400
          hover:border-slate-200 focus:border-primary-500 focus:bg-white focus:ring-2 focus:ring-primary-100
{cellC} = {cell} text-center          // números
{delBtn}= rounded-md p-1.5 text-slate-300 transition-colors
          hover:bg-red-50 hover:text-red-600 group-hover:text-slate-400
```

Ideia-chave: o input não tem caixa (`border-transparent bg-transparent`); ganha
contorno só no `hover` (borda cinza) e no `focus` (borda + anel primário + fundo
branco). O botão de remover fica quase apagado e **acende** quando o mouse passa
pela linha (`group-hover`) ou por ele.

Para células **somente-leitura**, use texto direto: `<td class="px-3 py-1.5 text-slate-800">valor</td>`.
Checkbox: `<input type="checkbox" class="h-4 w-4 accent-primary-700">`.

### 4.5 Abas (sub-navegação de módulo)

```html
<nav class="flex gap-1 text-xs">
  <span class="rounded-lg border border-primary-700 bg-primary-900 px-3 py-1.5 text-white">Ativa</span>
  <a class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 hover:border-primary-500">Outra</a>
</nav>
```

Aba ativa = `<span>` preenchido; inativas = `<a>` contornado.

### 4.6 Badge / pill

```html
<span class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">Rótulo</span>
```

### 4.7 Lista (registros sem edição inline)

```html
<div class="divide-y divide-slate-100 rounded-lg border border-slate-200">
  <div class="flex items-center justify-between px-3 py-2.5">
    <div>
      <div class="font-medium text-slate-800">Título</div>
      <div class="text-xs text-slate-500">Subtítulo</div>
    </div>
    <div class="flex items-center gap-3">… badge / ação …</div>
  </div>
</div>
```

### 4.8 Estado vazio

Sempre presente. Em tabela/lista, uma linha centralizada em `text-slate-400`
(`px-3 py-8 text-center`). Nunca deixe a área simplesmente em branco.

### 4.9 Mensagens (feedback de ação)

```html
<p class="rounded-lg bg-red-50 px-3 py-2 text-red-700">Erro…</p>
<p class="rounded-lg bg-green-50 px-3 py-2 text-green-700">Sucesso…</p>
```

Ficam no topo do container de conteúdo, acima das seções.

### 4.10 Modal (confirmação / entrada de valor)

Substitui `confirm()`/`prompt()` nativos. Overlay esmaecido + cartão branco;
rodapé com faixa `slate-50` e ações à direita. Fecha no `Esc` e no clique fora.

```html
<div class="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/30 p-4 pt-24">
  <div class="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-xl">
    <div class="p-5">
      <h2 class="text-base font-semibold text-slate-900">Título</h2>
      <p class="mt-2 text-sm text-slate-600">Mensagem.</p>
    </div>
    <div class="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
      <button class="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100">Cancelar</button>
      <button class="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700">Confirmar</button>
    </div>
  </div>
</div>
```

Botão de confirmar: **vermelho** para ação destrutiva; **primário** para ação neutra.

### 4.11 Avatar

Círculo com iniciais (ou ícone) sobre a cor primária/destaque:
`flex h-9 w-9 items-center justify-center rounded-full bg-primary-700 text-sm font-semibold text-white`.

---

## 5. Estados & interação

- **Hover:** superfícies mudam de fundo sutilmente (`hover:bg-slate-50/70`, `hover:bg-slate-100`);
  bordas escurecem levemente. Use `transition-colors`.
- **Foco:** `focus:border-primary-600 focus:ring-2 focus:ring-primary-100` — anel suave, nunca outline padrão do browser (`outline-none`).
- **Disabled:** `disabled:opacity-50` (mantém o layout, só apaga).
- **Ações destrutivas** revelam-se no hover da linha (`group` + `group-hover`), evitando poluir a tabela.

---

## 6. Convenções

- **Ícones:** traço (`stroke`), não preenchidos. `stroke-width` ~1.8, `viewBox 0 0 24 24`,
  `stroke-linecap/linejoin: round`. Tamanho 16–18px em linha.
- **Sem emojis** na interface.
- **Idioma & formatos:** rótulos no idioma do produto; datas `DD/MM/AAAA`.
- **Acessibilidade:** todo botão-ícone tem `aria-label`/`title`; modais fecham no `Esc`.
- **Responsivo:** grades `grid-cols-1 sm:grid-cols-2`; tabelas largas em
  `overflow-x-auto`; o `<body>` nunca rola na horizontal.

---

## 7. Como portar para outro projeto

1. Copie o bloco `@theme` do §2 e **troque só a rampa `primary`** pelo matiz do
   novo produto (mantenha os 50→950). Neutros (`slate`), `success`/`danger`/`warning`
   podem seguir as rampas padrão do Tailwind.
2. Cole as classes reutilizáveis (`{cell}`, `{cellC}`, `{delBtn}`, botões, tabela)
   trocando `primary-*` pelo seu token — o resto do vocabulário (`slate`, raios,
   espaçamentos) permanece igual.
3. Siga a estrutura de tela do §3 (header + container `max-w-4xl space-y-6` +
   seções em card) e os componentes do §4. Isso sozinho já entrega a "cara" do sistema.

> Este guia descreve **padrões de design**, não a identidade visual específica.
> A marca (nome, logo, matiz) vive fora daqui — troque a rampa `primary` e o
> sistema veste qualquer marca sem perder a consistência.
