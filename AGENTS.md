<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Este projeto

Módulos, com bancos diferentes:

- **Folha de ponto** (`/ponto`, `/folhas`) — foto da folha manuscrita → OCR com Gemini →
  revisão → `.xlsx`. Persiste no **Postgres** por escritório (migração `0012`; o
  Google Sheets só serve à importação), com cota de leituras por plano. Exclusivo
  da contabilidade. Leia [`docs/folha-de-ponto.md`](docs/folha-de-ponto.md).
- **Livro Caixa** (`/caixa`) — a empresa-cliente lança o movimento, a contadora
  concilia. Persiste no **Postgres (Supabase)**. Em construção.
- **Contrato de Experiência** (`/contratos`) — gera contrato, declaração de VT e
  aviso de término a partir dos modelos `.docx` da contadora; lembra vencimentos.
  Persiste no **Postgres**. Exclusivo da contabilidade. Antes de mexer, leia
  [`docs/contratos-experiencia.md`](docs/contratos-experiencia.md) (templates não
  podem ser editados no Word).
- **Departamento Pessoal** (`/dp`) — cadastro único do empregado (admissão, salário,
  jornada contratual, banco de horas, situação), férias (aquisitivo, art. 130,
  fracionamento, aviso e recibo em PDF) e 13º (avos e prazos), com os prazos na
  Agenda. Persiste no **Postgres** (migração `0021`); liga ponto e contratos ao
  empregado por **id**. Exclusivo da contabilidade, atrás do módulo ponto. Antes de
  mexer, leia [`docs/departamento-pessoal.md`](docs/departamento-pessoal.md).

Multi-escritório: o inquilino é o **escritório contábil** (`escritorios`, migração
`0010`); empresas e usuários têm `escritorio_id` e o recorte é por ele — leia
[`docs/multi-escritorio.md`](docs/multi-escritorio.md). Três papéis — `master`
(administra a plataforma, vê tudo), `usuario` (contabilidade; o admin do escritório
gerencia a equipe) e `cliente` (empresa). O `cliente`
segue **lista de permissão** em `proxy.ts`: o que não está em `CLIENTE_PODE` ele não
alcança. Toda rota de API nova precisa chamar a guarda correspondente de
`lib/acesso.ts`.

**Antes de mexer no Livro Caixa, leia [`docs/livro-caixa.md`](docs/livro-caixa.md)** —
decisões da contadora, etapas concluídas, o que vem a seguir e armadilhas conhecidas.
Mantenha esse arquivo atualizado ao fim de cada etapa.

**Antes de criar ou alterar qualquer tela, leia
[`docs/identidade-visual.md`](docs/identidade-visual.md)** — os papéis de cor de
`app/globals.css` e as primitivas de `components/` (`ui`, `selecao`, `retorno`) e de
`app/(app)/Dialogo.tsx`. Em resumo: nada de `slate-*`/`red-*` soltos, nada de
`<select>`, `<datalist>`, `alert/confirm/prompt` nem `title=` cru; uma ação primária
por tela; excluir sempre com confirmação **e** desfazer. A vitrine dos componentes
está em [`docs/design-system.html`](docs/design-system.html).

**Plano da empresa:** estratégia, roadmap e regras da equipe de sessões em
[`docs/empresa/`](docs/empresa/). Antes de começar uma frente, veja
[`roadmap.md`](docs/empresa/roadmap.md) e [`equipe.md`](docs/empresa/equipe.md). Retomando em outra conta ou máquina: [`continuidade.md`](docs/empresa/continuidade.md).
