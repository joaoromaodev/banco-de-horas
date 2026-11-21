# ClickContas — como retomar o projeto em outra conta ou máquina

> Para o João tocar o projeto de qualquer Claude Code (outra conta, outro computador)
> sem perder o fio. Tudo o que o "dono" sabe e que não está no código está aqui ou nos
> outros arquivos de `docs/empresa/`.

Última atualização: **21/11/2026**

## 1. Preparar a máquina (só na primeira vez)

```powershell
git clone https://github.com/joaoromaodev/banco-de-horas.git
cd banco-de-horas
npm install
```

Credenciais que **não estão no Git** (copie do computador de casa, por pendrive ou
cofre de senhas, nunca por chat):

| Arquivo | Para quê |
|---|---|
| `.env.local` | variáveis abaixo |
| `service-account.json` | conta de serviço do Google (Folha de Ponto ainda no Sheets) |

Variáveis do `.env.local` (as mesmas existem na Vercel):

| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Postgres (Livro Caixa, cadastros, contratos, escritórios) |
| `SESSION_SECRET` | assinatura do cookie de login (o local é diferente do de produção) |
| `MASTER_EMAIL`, `MASTER_PASSWORD` | login do administrador da plataforma |
| `GEMINI_API_KEY`, `GEMINI_MODELO` | leitura das folhas de ponto por IA |
| `GOOGLE_SHEETS_ID`, `GOOGLE_SERVICE_ACCOUNT_FILE` (ou `_JSON`) | Sheets |
| Cobrança (Sprint 2, nomes finais em `docs/cobranca.md`) | gateway de pagamento |

Logins de linha de comando (cada um abre o navegador para você aprovar):

```powershell
gh auth login
```

```powershell
npx supabase login
```

```powershell
npx supabase link --project-ref zxjeibkttmacpuukvyzo
```

Confira: `npx supabase migration list --remote` deve listar as migrações sem erro.

## 2. O prompt para começar cada sessão de fim de semana

Abra o Claude Code na pasta do projeto e cole:

> Você é o dono (CEO/CTO) da ClickContas. Leia `AGENTS.md` e todos os arquivos de
> `docs/empresa/` (comece por `continuidade.md`), depois `git fetch --all` e veja o
> estado das branches `claude/*`. Continue de onde parou: integre o que estiver
> pronto, publique, e inicie a próxima frente do roadmap. Siga as regras de
> autonomia da seção 3 de `continuidade.md`. No fim, atualize o roadmap e me dê um
> relatório curto.

## 3. Regras do jogo (combinadas com o João)

Estas regras também estão na memória local do Claude, mas a memória **não viaja**
entre computadores — este arquivo é a cópia oficial.

- **Envolvimento mínimo do João.** O Claude decide sozinho, inicia sprints sem
  esperar ordem, integra, publica (`git push origin main` = deploy na Vercel) e
  aplica migrações no Supabase de produção.
- Dúvida de produto: consultar um subagente com papel (contador, advogado LGPD,
  especialista em cobrança, designer) ou fazer "reunião" entre sessões — **não**
  perguntar ao João. Ao João só vai o que é fato que só ele sabe (ex.: CNPJ).
- **Mensagens para a Edilse ou terceiros: nunca enviar.** Escrever o texto pronto e
  entregar ao João.
- **A Edilse é da equipe** (consultora e cliente-teste, escritório `fundador`). Não há
  cliente real. Pode-se testar logado como ela, mas **nunca alterar os lançamentos e
  cadastros já feitos das empresas dela** (NÉLIO, Vaz & Vouzela, L A T Hage). Teste
  de escrita: conta criada em `/criar-conta` e apagada no fim.
- As senhas no banco são hash. Para testar como a Edilse no dev local, assine uma
  sessão com o `SESSION_SECRET` local (`criarSessao` de `lib/auth.ts`); não troque a
  senha dela.
- Antes de migração: `npx supabase migration list --remote`, backup (export JSON via
  supabase-js com a secret key) das tabelas afetadas, depois
  `npx supabase db push --remote --yes` e conferir.
- Push só com `npm run typecheck`, `npm run lint`, `npm test` e `npm run build` verdes.
- Excluir na interface sempre com confirmação **e** desfazer; nada de controles
  nativos (select, alert, scrollbar padrão) — ver `docs/identidade-visual.md`.

## 4. Onde está cada coisa

| O quê | Onde |
|---|---|
| Produção | https://banco-de-horas-henna.vercel.app (deploy automático no push em `main`) |
| Repositório | https://github.com/joaoromaodev/banco-de-horas (CI em `.github/workflows/ci.yml`) |
| Banco | Supabase, projeto `zxjeibkttmacpuukvyzo` |
| Estratégia, preços, metas | `docs/empresa/estrategia.md` |
| O que está sendo feito | `docs/empresa/roadmap.md` |
| Papéis, modelos, regras da equipe | `docs/empresa/equipe.md` |
| Decisões tomadas e porquê | `docs/empresa/decisoes.md` |
| Módulos | `docs/livro-caixa.md`, `docs/contratos-experiencia.md`, `docs/multi-escritorio.md`, `docs/testes.md` (e, ao fim da Sprint 2, `docs/cobranca.md`, `docs/folha-de-ponto.md`) |

## 5. Trabalho em andamento

As sessões paralelas trabalham em branches `claude/<frente>-xxxx`. **Branch que só
existe no computador de casa não aparece na outra máquina**: antes de sair de um
computador, rode

```powershell
git push origin --all
```

e, na outra, `git fetch --all`. A conversa de cada sessão não viaja; o commit e os
docs de cada frente bastam para outra sessão continuar.

Estado em 21/11/2026: Sprints 1, 2 e 3 publicadas; produção com migrações
0000–0015. O que falta está em "Pendências do lançamento" no `roadmap.md`. Ordem de
integração das migrações: **0011 (cobrança) → 0012 (ponto) → 0013 (catálogo)** — o
CLI do Supabase recusa aplicar uma migração de número menor que a última aplicada,
então não aplique a 0013 antes das outras duas. Na Sprint 3: 0014 (agenda) e
0015 (documentos), sempre depois da 0013.

## 6. Máquina de trabalho

Desde 21/11/2026 o projeto é tocado **só no notebook** (o computador de casa ficou
sem orçamento; o João pediu para esquecê-lo). Não há tarefa agendada: a antiga
`clickcontas-revisao-semanal` do computador de casa não deve ser reativada sem
combinar, para não rodar duas integrações sobre a mesma branch.
