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

## Pendências do lançamento (o que falta para o 1º escritório pagante)

Só o João consegue (contas e painéis que o Claude não acessa):
- [ ] Vercel → variáveis de produção: `CRON_SECRET`; `RESEND_API_KEY` + `EMAIL_REMETENTE`
      (domínio verificado no Resend); `ASAAS_API_KEY`, `ASAAS_AMBIENTE=sandbox`,
      `ASAAS_WEBHOOK_TOKEN`; conferir `GEMINI_API_KEY` e `MASTER_PASSWORD`. Novo deploy depois.
- [ ] Asaas: criar conta, webhook apontando para `/api/cobranca/webhook` (passo a passo em `docs/cobranca.md`).
- [ ] Gemini no nível pago (no gratuito o Google pode usar as fotos das folhas).
- [ ] Razão social e CNPJ da ClickContas (termos, NFS-e do Asaas).

O time faz (próxima sprint):
- Termos e privacidade (**adiado**: venda fechada, ver `estrategia.md` → "Antes de ir ao mercado"): Asaas e Google como suboperadores, carência de 7 dias,
  troca de plano proporcional, retenção do ponto e das leituras de IA.
- [x] Unificar a tabela de preços do site (`app/(site)/planos/Precos.tsx`) com `PLANOS` de `lib/cobranca.ts` (teste em `tests/precosSite.test.ts`).
- [x] Esconder a venda do site e do app atrás de `VENDAS_ABERTAS` (`lib/brand.ts`).
- Excluir empresa com ponto: mensagem clara (hoje sai o erro cru do banco) ou arquivar.
- Decidir se o `/painel` vira a página inicial do contador.
- Teste de ponta a ponta da cobrança no sandbox quando a chave existir.

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
