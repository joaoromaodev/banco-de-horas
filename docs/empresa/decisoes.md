# ClickContas — decisões

> Registro curto de decisões de produto tomadas sem consulta. Mais recente em cima.

## 21/11/2026 — Venda fechada até o produto estar pronto (Sprint 4 / Frente A)

- Decisão do João: **primeiro o produto fica pronto, depois vai ao mercado.** Nada de
  campanha, preço público nem teste grátis anunciado.
- Uma chave só, `VENDAS_ABERTAS` em `lib/brand.ts` (hoje `false`), esconde: link e
  botão de planos/teste no cabeçalho, rodapé e landing, preço e "teste grátis" da
  `/conheca`, "Criar conta" do login e o menu "Assinatura" do app. `/planos`
  redireciona para `/conheca`. Nenhum código foi apagado; `/criar-conta` segue
  funcionando (usado em testes) e a faixa de somente leitura do app continua.
- Preços do site unificados: `Precos.tsx` e a tabela de `/planos` leem `PLANOS`
  (`lib/cobranca.ts`) e a cota de `lib/cotaOcr.ts`; `tests/precosSite.test.ts` trava.
- **Termos e privacidade não foram reescritos agora.** A lista do que precisam ter
  está em `estrategia.md` → "Antes de ir ao mercado", para quando o lançamento for
  decidido (aí sim com advogado).

## 21/11/2026 — Integração das Sprints 2 e 3

- Integradas de uma vez, na ordem 0011 → 0015, numa branch `integracao/geral` e
  depois `main` (fast-forward). Backup JSON antes; 0013 falhou no primeiro push
  (gatilho barrava o próprio backfill), foi corrigida e reaplicada — a falha não
  deixou nada pela metade.
- **Ponto:** importação da planilha logo antes do deploy; a planilha fica como
  arquivo morto (remover as variáveis do Sheets da Vercel depois de uns dias).
- **Cobrança no ar sem gateway:** sem `ASAAS_API_KEY`, ninguém cai em somente
  leitura. Ligar o Asaas é decisão consciente, porque a partir dali teste vencido trava.

## 21/11/2026 — Cobrança (Sprint 2 / Frente A)

- **Gateway: Asaas.** Consultor de cobrança confirmou: é o único entre Asaas, Iugu,
  Pagar.me, Mercado Pago, Stripe BR e Efí que junta numa integração só assinatura
  recorrente em que o cliente escolhe Pix, boleto ou cartão na própria fatura
  (`billingType: UNDEFINED`), NFS-e automática por assinatura e régua de cobrança
  pronta, com tarifa fixa por transação, sem mensalidade e com sandbox completo.
  Para equipe minúscula e ticket de R$ 89–349 de contadores do Norte/Nordeste
  (que preferem Pix e boleto), é o menor esforço de integração e manutenção.
- **Carência de 7 dias** depois do vencimento antes do somente leitura; o pagamento
  libera na hora.
- **Troca de plano:** subida vale já, com cobrança proporcional dos dias restantes;
  descida e troca mensal↔anual valem na renovação, sem crédito. Escrever nos termos.
- **Cancelamento:** acesso até o fim do período pago; depois somente leitura.
- **Teste sem limite de empresas;** limites valem nos planos pagos (10/40/∞).
- **Sem gateway configurado, teste vencido não trava** (não haveria como pagar).
- CPF/CNPJ do pagador vai só ao Asaas; não guardamos. Detalhes em `docs/cobranca.md`.

## 21/11/2026 — Cobrança e ponto reassumidos no notebook

- O João pediu para tocar tudo nesta máquina, sem tarefa agendada nem espera do
  prazo de 24 h: cobrança (0011) e ponto (0012) foram reabertos aqui em sessões
  Opus. As branches antigas do computador de casa estavam vazias; se aparecer algo
  nelas, as sessões novas aproveitam. **Não rodar as frentes de novo em casa.**

## 21/11/2026 — Abertura da Sprint 3 (segunda máquina)

- Sprint 3 aberta com a Sprint 2 ainda pendente, em frentes que não tocam nos
  arquivos da cobrança e do ponto: agenda (0014), documentos do cliente (0015) e
  contratos (sem migração). O painel do contador espera, porque a `/` é do ponto.
- Documentos do cliente ficam em bucket **privado** do Storage, com download só por
  URL assinada gerada depois da guarda de acesso.
- E-mail de aviso atrás de `lib/email.ts`: sem chave do provedor, não envia e só
  registra (não trava a publicação).
- Sessões de frente passam a dar push da própria branch (nunca em `main`), para o
  trabalho aparecer no outro computador.

## 21/11/2026 — Integração da Sprint 1

- Migração 0010 com **backfill em falha fechada** (contador sem empresa ganha
  escritório próprio, não herda as empresas da Edilse). Ver `docs/multi-escritorio.md`.
- `turbopack.root` fixado no `next.config.ts`: um `package-lock.json` solto na
  pasta do usuário fazia o dev quebrar o proxy.

## 21/11/2026 — Revisão do dono sobre a Frente B

Aceitas todas as decisões abaixo. Ajustes:

- **Cota de OCR fechada em números:** Essencial 150 folhas/mês, Escritório 600,
  Ilimitado 2.000 (uso justo). Leitura de uma folha com Gemini Flash custa centavos;
  a cota existe para conter abuso, não para segmentar. Cobrança da cota entra na
  Sprint 2 junto com a chave de IA da plataforma.
- **Lançamento público** só depois de: razão social e CNPJ da ClickContas nos termos,
  depoimento real aprovado pela Edilse e revisão jurídica. Até lá o site fica no ar
  só como página do produto (sem campanha).

## 21/11/2026 — Site público (Frente B)

Decididas pela sessão `site-publico`, valem até alguém mudar:

- **Sem fidelidade**, cancelamento a qualquer momento, acesso até o fim do período pago.
- **Troca de plano** a qualquer momento, com ajuste proporcional.
- **Fim do teste sem assinar:** conta em modo somente leitura, nada é apagado; dados
  exportáveis por 90 dias após cancelamento (proposta; confirmar com advogado).
- **Cota de OCR** exibida como "básica / ampliada / máxima" até os números existirem.
- **Depoimento da Edilce** provisório, marcado `TODO: validar com a Edilce`.
- Textos legais são rascunho; campos `[entre colchetes]` (razão social, CNPJ, DPO, foro)
  dependem de dados da empresa.
