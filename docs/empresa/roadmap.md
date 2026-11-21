# ClickContas — roadmap

> Fonte da verdade do que está sendo feito. Cada sprint tem frentes independentes
> (arquivos diferentes) que rodam em paralelo, uma sessão por frente. Ao terminar uma
> frente, marque aqui e anote a branch.

Última atualização: **21/11/2026**

## Sprint 1 — Fundação SaaS (iniciada 21/11/2026)

| Frente | Sessão | Branch | Status |
|---|---|---|---|
| A. Multi-escritório (inquilinos) + cadastro self-service com teste grátis | `multi-escritorio` | a definir | ⏳ |
| B. Site público: landing, planos, termos de uso, privacidade (LGPD) | `site-publico` | a definir | ⏳ |
| C. Qualidade: testes (Vitest) das regras puras + CI no GitHub Actions | `testes-ci` | a definir | ⏳ |

Integração (eu): revisar cada branch, juntar em `main` local, rodar build + testes.
Integração (dono): merge, migração em produção (com backup) e push após lint/build/testes. Mensagens à Edilce: o dono redige, o João envia.

## Sprint 2 — Cobrança e Ponto no Postgres

- Assinatura via Asaas (planos da `estrategia.md`), bloqueio suave ao fim do teste.
- Folha de Ponto sai do Google Sheets para o Postgres (hoje é o único módulo
  preso ao Sheets — impede multi-escritório de verdade e esbarra na cota de 60/min).
- Cota de OCR por plano + chave do Gemini da plataforma (não mais por instalação).
- Corrigir o modo escuro (armadilha antiga em `docs/livro-caixa.md`).

## Sprint 3 — Portal do Cliente e Agenda

- Portal do cliente unificado (caixa + envio de documentos + pendências).
- Agenda de obrigações por cliente com aviso por e-mail.
- Contratos: alertas de todas as empresas no topo, PDF direto.
- Painel inicial do contador: o que precisa de atenção hoje.

## Backlog da Edilce (pedidos e pendências)

- [ ] Validar texto legal dos termos do Livro Caixa (variante PF é nossa).
- [ ] Coletar dados fiscais das empresas (trava o termo definitivo).
- [ ] Validar layout impresso dos 3 documentos de contrato.
- [ ] PDF/xlsx do livro com rótulos "Conta Titular / Conta Analítica".
- [ ] Reclassificar, se for o caso, os 15 lançamentos de material de expediente.

## Feito

- Livro Caixa fases 1–6, Folha de Ponto, Contrato de Experiência, nova identidade
  visual e design system (até `5cc9b75`).
