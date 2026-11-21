# ClickContas — como a equipe trabalha

> A "equipe" são sessões do Claude Code coordenadas pela sessão do dono (CEO/CTO).
> Este arquivo define papéis, qual modelo/esforço cada um usa e as regras do jogo.

## Papéis

| Papel | Quem | Modelo / esforço | Faz |
|---|---|---|---|
| Dono (CEO/CTO) | sessão principal | Opus, esforço baixo–médio | estratégia, roadmap, briefs, revisão e integração das branches |
| Arquiteto | sessão por frente estrutural | Opus, alto | mudanças de modelo de dados, autorização, migrações |
| Dev de produto | sessão por frente de tela | Sonnet, médio | telas, páginas, componentes seguindo o design system |
| QA | sessão de testes | Sonnet, médio | testes automatizados, CI, verificação no navegador |
| Rotinas | tarefas agendadas | Sonnet | revisão semanal do roadmap, checagem de pendências |

## Gestão de tokens

- Opus só onde erro custa caro (dados, segurança, cobrança). Todo o resto, Sonnet.
- Sessões começam **fresh** com um brief fechado — não herdam a conversa inteira.
- Uma frente = um conjunto de arquivos = uma sessão em worktree própria. Duas
  sessões nunca editam os mesmos arquivos.
- Quando o orçamento do dia acaba, o que falta vira tarefa agendada com prompt
  autocontido apontando para este diretório.

## Regras

1. Ler `AGENTS.md`, `docs/identidade-visual.md` e o doc do módulo antes de mexer.
2. Commit na branch da frente; `main` só recebe pela integração do dono.
3. **Push/deploy e migração em produção são do dono** (autorizado pelo João em
   21/11/2026), feitos na integração: só depois de lint, build e testes passarem,
   e migração só com `migration list --remote`, backup dos dados afetados e plano
   de reversão. Sessões de frente não fazem push nem aplicam migração.
4. **Mensagem para a Edilce ou clientes: nunca enviar.** O dono escreve o texto
   pronto e entrega ao João, que envia.
5. Migração nova: `git fetch` + `npx supabase migration list --remote` antes de
   numerar (já houve colisão).
6. Toda tela segue o design system; excluir sempre com confirmação **e** desfazer.
7. Ao fim, atualizar `docs/empresa/roadmap.md` e o doc do módulo.
