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
| A. Cobrança: assinatura (gateway escolhido por consultor), webhook, conta somente leitura ao fim do teste | `cobranca` | Opus alto | ⏳ |
| B. Folha de Ponto do Sheets para o Postgres, por escritório + chave Gemini da plataforma + cota de OCR por plano | `ponto-postgres` | Opus alto | ⏳ |
| C. Catálogo do Livro Caixa por escritório (base global + extensões) | `catalogo-caixa` | Sonnet médio | ⏳ |
| D. Modo escuro e polimento visual (tokens, contraste, telas novas) | `modo-escuro` | Sonnet médio | ✅ branch `claude/modo-escuro-cc7676` (tokens escuros AA, seletor claro/escuro/auto, telas e gráficos varridos; falta integrar) |

## Sprint 3 — Portal do Cliente e Agenda

- Portal do cliente unificado (caixa + envio de documentos + pendências).
- Agenda de obrigações por cliente com aviso por e-mail.
- Contratos: alertas de todas as empresas no topo, PDF direto.
- Painel inicial do contador: o que precisa de atenção hoje.

## Backlog da Edilse (pedidos e pendências)

- [ ] Validar texto legal dos termos do Livro Caixa (variante PF é nossa).
- [ ] Coletar dados fiscais das empresas (trava o termo definitivo).
- [ ] Validar layout impresso dos 3 documentos de contrato.
- [ ] PDF/xlsx do livro com rótulos "Conta Titular / Conta Analítica".
- [ ] Reclassificar, se for o caso, os 15 lançamentos de material de expediente.

## Feito

- Livro Caixa fases 1–6, Folha de Ponto, Contrato de Experiência, nova identidade
  visual e design system (até `5cc9b75`).
