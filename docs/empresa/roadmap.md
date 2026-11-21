# ClickContas — roadmap

> Fonte da verdade do que está sendo feito. Cada sprint tem frentes independentes
> (arquivos diferentes) que rodam em paralelo, uma sessão por frente. Ao terminar uma
> frente, marque aqui e anote a branch.

Última atualização: **21/11/2026**

## Sprint 1 — Fundação SaaS (✅ concluída e publicada em 21/11/2026)

| Frente | Sessão | Branch | Status |
|---|---|---|---|
| A. Multi-escritório (inquilinos) + cadastro self-service com teste grátis | `multi-escritorio` | `claude/multi-escritorio-1e4a33` | ✅ integrada — ver [`docs/multi-escritorio.md`](../multi-escritorio.md) |
| B. Site público: landing, planos, termos de uso, privacidade (LGPD) | `site-publico` | `claude/site-publico-c4e042` | ✅ integrada. Pendências: dados da empresa nos termos, advogado (depoimento removido em 21/11) |
| C. Qualidade: testes (Vitest) das regras puras + CI no GitHub Actions | `testes-ci` | `claude/testes-ci-eaaca5` | ✅ integrada — ver [`docs/testes.md`](../testes.md) |

Integração (dono): merge, migração em produção (com backup) e push após lint/build/testes. Mensagens à Edilse: o dono redige, o João envia.

## Sprint 2 — Cobrança e Ponto no Postgres (✅ concluída e publicada em 21/11/2026)

| Frente | Branch | Status |
|---|---|---|
| A. Cobrança (Asaas): assinatura, webhook idempotente, somente leitura central, limite de empresas por plano | `claude/cobranca-notebook-c98848` | ✅ publicada; 0011 aplicada. **Falta configurar o Asaas** (ver "Pendências do lançamento") — sem a chave, teste vencido não trava |
| B. Folha de Ponto no Postgres por escritório + chave Gemini da plataforma + cota de OCR | `claude/ponto-postgres-notebook-3cd4c9` | ✅ publicada; 0012 aplicada; importados da planilha 9 funcionários e 183 dias da Vaz & Vouzela. A planilha virou arquivo morto |
| C. Catálogo do Livro Caixa por escritório | `claude/catalogo-caixa-859f94` | ✅ publicada; 0013 aplicada (corrigida na integração: o gatilho barrava o próprio backfill) |
| D. Modo escuro | `claude/modo-escuro-cc7676` | ✅ publicada |

## Sprint 3 — Portal do Cliente e Agenda (✅ concluída e publicada em 21/11/2026)

| Frente | Branch | Status |
|---|---|---|
| A. Agenda de obrigações + aviso por e-mail | `claude/agenda-obrigacoes-e01a60` | ✅ publicada; 0014 aplicada. O e-mail só sai com `CRON_SECRET` (+ Resend) na Vercel |
| B. Documentos e pendências do cliente (bucket privado) | `claude/portal-documentos-d0eb5c` | ✅ publicada; 0015 aplicada; bucket `documentos` privado, 10 MB |
| C. Contratos: alertas de todas as empresas + PDF | `claude/contratos-alertas-pdf-44eb3e` | ✅ publicada |
| D. Painel do contador em `/painel` | `claude/painel-contador-665600` | ✅ publicada. A `/` continua sendo a Timesheet |

Produção em 21/11/2026: migrações 0000–0015 aplicadas; próximo número livre **0016**.
Backup antes da 0011–0015: `Desktopackups-clickcontasackup-antes-0011-0015-2026-11-21.json`
(fora do repositório). Teste de ponta a ponta com conta de teste (agenda, pendência,
envio de PDF, painel, cobrança sem Asaas, 403 nas 3 empresas da Edilse): 26/26 ok;
conta apagada, contagens iguais às do backup.

## Sprint 4 — Venda fechada e acabamentos (✅ concluída e publicada em 21/11/2026)

**Decisão do João (21/11):** não vender ainda; primeiro deixar o produto pronto.
Prioridade: funcionalidades, inteligência e otimização.

| Frente | Branch | Status |
|---|---|---|
| A. Venda escondida atrás de `VENDAS_ABERTAS = false` (`lib/brand.ts`): sem preços, teste grátis nem "Assinatura" no site e no menu; `/planos` → `/conheca`. Preços do site lidos de `PLANOS` | `claude/termos-precos-a471e7` | ✅ publicada. Termos/privacidade adiados (lista em `estrategia.md` → "Antes de ir ao mercado") |
| B. Excluir empresa = **arquivar** (0016; dados preservados, reativável); `/` redireciona por papel (contador → `/painel`, cliente → `/caixa`); Timesheet em `/ponto` | `claude/acabamentos-f68827` | ✅ publicada; 0016 aplicada (backup `backup-antes-0016-2026-11-21.json`). Teste de ponta a ponta 11/11, conta de teste apagada |

Produção: migrações 0000–0016; próximo número livre **0017**.

## Sprint 5 — Caixa inteligente e fechamento mensal (✅ concluída e publicada em 21/11/2026)

| Frente | Branch | Status |
|---|---|---|
| A. Caixa inteligente: sugestão de conta/analítica que aprende com o que a contadora confere (histórico → frequência nos conferidos → IA opcional); revisão antes da conferência (duplicidade, valor fora do padrão, natureza trocada, pagador/CPF, juros recorrentes, mês sem lançamento, saldo negativo, mudou após confirmar); contabilista/CRC padrão vem do escritório (não mais o nome da Edilse) | `claude/caixa-inteligente-2c9894` | ✅ publicada; 0017 aplicada. Acurácia nos 46 lançamentos reais do NÉLIO: oferece em 70%, acerta 94% quando oferece (sem IA). IA desligada (`CAIXA_IA_SUGESTAO`), nunca em empresa que identifica pagador |
| B. Fechamento mensal: pedidos mensais por empresa abertos no dia 1º pelo cron e fechados quando o documento chega; checklist "X de Y empresas fechadas" no painel (`/api/painel/fechamento`); agenda proposta pelo regime/sinais (um clique, com desfazer); contratos de experiência na agenda e no e-mail | `claude/fechamento-mensal-795cfa` | ✅ publicada; 0018 aplicada |

Produção: migrações 0000–0018; próximo número livre **0019**. Backup antes:
`backup-antes-0017-0018-2026-11-21.json`. Teste de ponta a ponta com conta de teste
(sugestão 0,82 de confiança com 4 conferidos, duplicidade apontada, pedido mensal,
proposta da agenda, checklist, 403 em 12 rotas das empresas da Edilse); conta apagada,
contagens iguais às do backup.

## Sprint 6 — proposta

| Frente | Modelo | O que é |
|---|---|---|
| A. Configurações do escritório | Sonnet médio | tela para o escritório editar responsável técnico (contabilista/CRC — hoje só no banco), preferências (dia de prazo padrão dos pedidos, aviso por e-mail) e equipe num lugar só |
| B. Desempenho e robustez | Sonnet médio | paginação no livro (PDF/xlsx) e no saldo transportado acima de 1.000 lançamentos; índices e N+1 nas rotas mais usadas; medir o tempo das telas principais |
| C. Carnê-Leão e recibos (PF) | Opus alto | quando a Edilse responder as perguntas (beneficiário ≠ pagador, layout do Carnê-Leão Web) |
| D. Documento → lançamento sugerido por IA | Opus alto | opção por empresa, desligada no início; depende do aceite da Edilse e do Gemini pago |

## Antes de ir ao mercado (adiado por decisão do João)

Só o João consegue:
- [ ] Vercel → `CRON_SECRET` (o aviso da agenda precisa disto **já**, mesmo sem venda);
      `RESEND_API_KEY` + `EMAIL_REMETENTE`; mais tarde `ASAAS_*`. Conferir `GEMINI_API_KEY`.
- [ ] **`MASTER_PASSWORD` forte na Vercel (≥ 12 caracteres, não `admin1234`)**: desde 21/11 o
      login de administrador fica desligado em produção com senha ausente ou fraca.
- [ ] Gemini no nível pago (no gratuito o Google pode usar as fotos das folhas).
- [ ] Asaas, razão social e CNPJ — só quando o lançamento for decidido.

O time faz quando o lançamento for decidido: termos e privacidade (lista em
`estrategia.md`), teste da cobrança no sandbox, `VENDAS_ABERTAS = true`.

## Achados da integração

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
