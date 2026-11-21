# ClickContas — roadmap

> Fonte da verdade do que está sendo feito. Cada sprint tem frentes independentes
> (arquivos diferentes) que rodam em paralelo, uma sessão por frente. Ao terminar uma
> frente, marque aqui e anote a branch.

Última atualização: **21/11/2026**

## Sprint 1 — Fundação SaaS (✅ concluída e publicada em 21/11/2026)

| Frente | Sessão | Branch | Status |
|---|---|---|---|
| A. Multi-escritório (inquilinos) + cadastro self-service com teste grátis | `multi-escritorio` | `claude/multi-escritorio-1e4a33` | ✅ integrada — ver [`docs/multi-escritorio.md`](../multi-escritorio.md) |
| B. Site público: landing, planos, termos de uso, privacidade (LGPD) | `site-publico` | `claude/site-publico-c4e042` | ✅ integrada. Pendências: depoimento da Edilse, dados da empresa nos termos, advogado |
| C. Qualidade: testes (Vitest) das regras puras + CI no GitHub Actions | `testes-ci` | `claude/testes-ci-eaaca5` | ✅ integrada — ver [`docs/testes.md`](../testes.md) |

Integração (dono): merge, migração em produção (com backup) e push após lint/build/testes. Mensagens à Edilse: o dono redige, o João envia.

## Sprint 2 — Cobrança e Ponto no Postgres (iniciada 21/11/2026)

Migrações numeradas de antemão para não colidir: A `0011`, B `0012`, C `0013`.

| Frente | Sessão | Modelo | Status |
|---|---|---|---|
| A. Cobrança: assinatura (gateway escolhido por consultor), webhook, conta somente leitura ao fim do teste | `cobranca` | Opus alto | ⏳ reassumida no notebook em 21/11 (decisão do João): sessão `cobranca`, branch `claude/cobranca-notebook-*`. A antiga `claude/cobranca-118569` ficou vazia |
| B. Folha de Ponto do Sheets para o Postgres, por escritório + chave Gemini da plataforma + cota de OCR por plano | `ponto-postgres` | Opus alto | ⏳ reassumida no notebook em 21/11: sessão `ponto`, branch `claude/ponto-postgres-notebook-*`. A antiga `claude/ponto-postgres-8196ff` ficou vazia |
| C. Catálogo do Livro Caixa por escritório (base global + extensões) | `catalogo-caixa` | Sonnet médio | ✅ branch `claude/catalogo-caixa-859f94` pronta; integra depois da 0011 e 0012 (ordem das migrações) |
| D. Modo escuro e polimento visual (tokens, contraste, telas novas) | `modo-escuro` | Sonnet médio | ✅ branch `claude/modo-escuro-cc7676` (tokens escuros AA, seletor claro/escuro/auto, telas e gráficos varridos; integrada e publicada em 21/11/2026) |

## Sprint 3 — Portal do Cliente e Agenda (iniciada 21/11/2026)

Migrações reservadas: A `0014`, B `0015`. Próximo número livre: `0016`. Ordem de
aplicação em produção: 0011 → 0012 → 0013 → 0014 → 0015.

| Frente | Sessão | Modelo | Status |
|---|---|---|---|
| A. Agenda de obrigações por empresa (recorrência, dia útil, marcar feita) + aviso por e-mail (cron) | `agenda` | Opus alto | ✅ pronta em `claude/agenda-obrigacoes-e01a60` (`b4f6f62`, 215 testes). Espera a 0011–0013 para entrar com a 0014. Vercel: `CRON_SECRET` (obrigatória), `RESEND_API_KEY` + `EMAIL_REMETENTE` (opcionais). Ver "Para o integrador" em `docs/agenda.md` |
| B. Portal do cliente: envio de documentos (Storage privado) e pendências pedidas pelo contador | `documentos` | Opus alto | ✅ pronta em `claude/portal-documentos-d0eb5c` (`dde500c`, 230 testes, revisada pelo Escudo). Espera a 0011–0014 para entrar com a 0015 (cria o bucket privado `documentos`). Ver `docs/documentos.md` |
| C. Contratos: alertas de todas as empresas no topo + PDF direto | `contratos` | Sonnet médio | ✅ integrada e publicada em 21/11/2026 (`claude/contratos-alertas-pdf-44eb3e`; PDF conferido, coluna do horário corrigida na integração) |
| D. Painel inicial do contador ("o que precisa de atenção hoje") em `/painel` | `painel` | Sonnet médio | ⏳ branch `claude/painel-contador-*`, feita sobre `integracao/sprint3`. A `/` continua do ponto; decidir na integração do ponto se o painel vira a página inicial |

## Achados da integração

- **Por que A e B não entraram em `main` ainda (21/11/2026):** se os arquivos 0014
  e 0015 chegarem à `main` antes da 0011–0013, um `db push` aplica as duas fora de
  ordem e depois recusa a 0011. A e B já estão juntas, verdes (270 testes), na
  branch `integracao/sprint3` (conflito só no roadmap, resolvido com o de `main`).
  Ordem de integração: cobrança (0011) → ponto (0012)
  → catálogo (0013) → agenda (0014) → documentos (0015), cada uma com seu merge.
- **Notebook (segunda máquina):** Supabase CLI logado e vinculado ao projeto
  `zxjeibkttmacpuukvyzo` em 21/11/2026; `migration list --remote` mostra 0000–0010
  aplicadas, igual à `main`.
- **Alertas de contratos conferidos com dados reais (21/11/2026):** sessão local da
  Edilse, só leitura — a rota responde sem erro; 0 alertas porque ainda não há
  contrato salvo em `contratos_experiencia`.

- **Sheets nega acesso com as credenciais locais** ("The caller does not have
  permission" em `/api/funcionarios` no dev, 21/11/2026). A produção usa
  `GOOGLE_SERVICE_ACCOUNT_JSON` da Vercel. Repassado à frente `ponto-postgres`; a
  importação real depende disso.
- Acesso conferido em 21/11/2026 com sessões locais da Edilse e da Adriana, só com
  leituras: Edilse vê as 3 empresas, o caixa e o resumo do NÉLIO, a equipe e os
  contratos; Adriana vê só a Vaz & Vouzela e leva 403 no NÉLIO e no ponto.

## Backlog da Edilse (pedidos e pendências)

- [ ] Validar texto legal dos termos do Livro Caixa (variante PF é nossa).
- [ ] Coletar dados fiscais das empresas (trava o termo definitivo).
- [ ] Validar layout impresso dos 3 documentos de contrato.
- [ ] PDF/xlsx do livro com rótulos "Conta Titular / Conta Analítica".
- [ ] Reclassificar, se for o caso, os 15 lançamentos de material de expediente.

## Feito

- Livro Caixa fases 1–6, Folha de Ponto, Contrato de Experiência, nova identidade
  visual e design system (até `5cc9b75`).
