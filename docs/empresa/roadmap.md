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

## Sprint 5 — Caixa inteligente e fechamento mensal (planejada)

Priorizada pelo consultor contador (21/11/2026), em ordem:

| Frente | Modelo | O que é |
|---|---|---|
| A. Caixa inteligente | Opus alto | (1) sugestão de conta/analítica ao lançar — histórico padrão → frequência no que a contadora já conferiu naquela empresa → IA só se nada resolver; aprende com a correção; nunca cria conta nem marca conferido. (2) Revisão antes da conferência: duplicidade, valor fora do padrão, receita lançada como saída, pagador/CPF faltando, juros recorrentes, mês sem lançamento, saldo negativo; fila por risco; só alerta, regras explicáveis |
| B. Fechamento mensal | Sonnet médio | pendências recorrentes abertas no dia 1º e fechadas quando o arquivo chega; checklist do mês no painel (lançou, conferiu, confirmou, documentos); propor modelo de obrigações pelo regime/funcionários; vencimento de contrato de experiência na agenda |

Depois (dependem da Edilse): Carnê-Leão e recibos para PF (campo de beneficiário além
do pagador); documento enviado → lançamento sugerido por IA (opção por empresa).
Fora por ora: extrato OFX/conciliação (não há conta de banco no modelo do livro caixa).

## Antes de ir ao mercado (adiado por decisão do João)

Só o João consegue:
- [ ] Vercel → `CRON_SECRET` (o aviso da agenda precisa disto **já**, mesmo sem venda);
      `RESEND_API_KEY` + `EMAIL_REMETENTE`; mais tarde `ASAAS_*`. Conferir `GEMINI_API_KEY` e `MASTER_PASSWORD`.
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
