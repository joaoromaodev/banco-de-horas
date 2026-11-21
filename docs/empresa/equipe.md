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
3. **Nunca** sem OK do João: `git push`, deploy, migração no Supabase de produção,
   mensagem para a Edilce ou qualquer cliente.
4. Migração nova: `git fetch` + `npx supabase migration list --remote` antes de
   numerar (já houve colisão). Escrever a migração, não aplicar.
5. Toda tela segue o design system; excluir sempre com confirmação **e** desfazer.
6. Ao fim, atualizar `docs/empresa/roadmap.md` e o doc do módulo.
