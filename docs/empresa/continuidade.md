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

## 7. Passagem de bastão (sessão do dono limpa em 21/11/2026)

A conversa da sessão do dono foi limpa para liberar contexto. **Ao retomar, leia esta
seção primeiro**, depois `roadmap.md` (Sprints 1–11) e `equipe.md` (item 8, ciclo das
sessões).

### O que o João combinou (vale até ele dizer o contrário)
- **Não perguntar** "abro a próxima?": seguir evoluindo sprint após sprint até ele mandar
  pausar. Ao João só vai fato que só ele sabe.
- **Não vender ainda**: venda escondida (`VENDAS_ABERTAS = false`); foco em
  funcionalidade, inteligência e otimização. Sem nomes de pessoas no site.
- **Só este notebook** (o computador de casa ficou sem orçamento).
- **Ao fim de cada integração**: arquivar as sessões concluídas, remover worktrees e
  apagar branches `integracao/*` já em `main`.
- **Quando o contexto passar de ~50%**: documentar aqui e limpar a sessão.

### Sprint 11 (concluída e publicada em 21/11 — tabela mantida como histórico)
| Frente | Onde | Como integrar |
|---|---|---|
| A. Página inicial do cliente (`/inicio`) | subagente em worktree → branch `claude/inicio-cliente` | migração 0029 se houver |
| B. Rescisão completa (INSS/IRRF, médias do ponto) | subagente em worktree → branch `claude/rescisao-completa` | migração 0030 se houver |
| C. Pente-fino visual no navegador | sessão "Sprint 11 C — Pente-fino visual" → branch `claude/pente-fino-visual-*` | relatório em `docs/qa-visual.md` |

Se a notificação de alguma frente não chegar (subagentes podem não sobreviver à
limpeza), confira com `git fetch --all` e `git log main..origin/<branch>`. Branch vazia
depois de bastante tempo = refazer a frente (brief no `roadmap.md`, Sprint 11).
Worktrees de subagentes ficam em `.claude/worktrees/agent-*` (remover depois).

### Rotina de integração (a que vem funcionando)
1. `git fetch --all`; criar `integracao/<sprint>` a partir de `main`; merge `--no-ff` de
   cada branch na ordem das migrações. Conflitos comuns: docs (manter os dois lados;
   arquivos com CRLF — normalizar antes de resolver) e imports.
2. Ler a seção "Para o integrador" de cada doc; ligar o que uma frente deixou para a
   outra (ganchos).
3. `rm -rf .next` (o cache de tipos de outra branch quebra o typecheck) e rodar
   `npm run typecheck && npm run lint && npm test && npm run build`.
4. Migração: backup JSON das tabelas afetadas em `Desktop\backups-clickcontas\`
   (script com supabase-js e a secret key), `npx --yes supabase@3.2.0 db push --remote
   --dry-run`, depois `--yes`, e `migration list --remote`. No PowerShell use `npx.cmd`.
5. `git checkout main && git merge --ff-only integracao/<sprint> && git push origin main`;
   esperar a CI (`gh run watch`) e o status da Vercel (API de statuses do commit, com
   `GH_TOKEN` tirado de `git credential fill`, usuário `joaoromaodev`).
6. Testar em produção: rotas públicas por `curl`; fluxos com o app local
   (`npx next dev -p 3100`, mesmo código, banco de produção) usando **conta de teste**
   criada em `/criar-conta` e sessão local da Edilse **só para leitura** (`criarSessao`
   de `lib/auth.ts`). Apagar a conta de teste e tudo dela no fim e conferir as
   contagens (escritórios 2, usuários 4, empresas 3, lançamentos 46, frequências 183,
   empregados 9). Matar o processo da porta 3100 no fim (`Get-NetTCPConnection`).
7. Atualizar `roadmap.md`, arquivar sessões, limpar worktrees e `integracao/*`.

### Produção agora
- Migrações **0000–0031** aplicadas (0024–0026 não usadas). Próximo livre: **0032**.
- Funções da Vercel em `gru1` (São Paulo), junto do Supabase (`sa-east-1`).
- 1162 testes, lint sem avisos; CI verde no último push. Sprints 11–15 concluídas e publicadas; nenhuma frente em andamento. Próximo passo: deixar a medição juntar uma semana de uso e decidir a Sprint 16 pelos números (telas lentas, erros) e pelo que a Edilse responder. IA de documentos do caixa e e-mail de avisos ao cliente publicados desligados.

### Pendências que só o João resolve
- Vercel: `CRON_SECRET` (resumo da agenda), `RESEND_API_KEY` + `EMAIL_REMETENTE`
  (e-mails), `MASTER_PASSWORD` forte (o login de master fica desligado com senha fraca).
- Gemini no nível pago.
- Mensagem para a Edilse com as 3 perguntas (Carnê-Leão/beneficiário, IA lendo
  documentos, conta bancária fora do caixa) e pedido de digitar as 9 admissões no `/dp`
  (dá para fazer em lote). Texto pronto no último relatório; não enviar.

### Limpeza de conta de teste (aprendido na Sprint 13)
Cadastrar funcionário pelo `/api/funcionarios` também cria linha em `dp_empregados`;
apagar essa tabela junto. Conferir também os buckets `ponto` e `documentos`.

### Próximas ideias (depois da Sprint 13)
Carnê-Leão e documento → lançamento (dependem da Edilse); rescisão com convenção
coletiva, pensão alimentícia e adicional noturno sobre HE noturna (OJ 97); e-mail ao cliente de folha devolvida/pendência (depende do Resend); medir a
duração das funções na Vercel após uso real.
