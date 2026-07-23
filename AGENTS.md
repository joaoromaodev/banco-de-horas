<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Este projeto

Dois módulos, com bancos diferentes:

- **Folha de ponto** (`/`, `/folhas`) — foto da folha manuscrita → OCR com Gemini →
  revisão → `.xlsx`. Persiste no **Google Sheets**. Exclusivo da contabilidade.
- **Livro Caixa** (`/caixa`) — a empresa-cliente lança o movimento, a contadora
  concilia. Persiste no **Postgres (Supabase)**. Em construção.

Três papéis — `master`, `usuario` (contabilidade) e `cliente` (empresa). O `cliente`
segue **lista de permissão** em `proxy.ts`: o que não está em `CLIENTE_PODE` ele não
alcança. Toda rota de API nova precisa chamar a guarda correspondente de
`lib/acesso.ts`.

**Antes de mexer no Livro Caixa, leia [`docs/livro-caixa.md`](docs/livro-caixa.md)** —
decisões da contadora, etapas concluídas, o que vem a seguir e armadilhas conhecidas.
Mantenha esse arquivo atualizado ao fim de cada etapa.
