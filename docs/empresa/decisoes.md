# ClickContas — decisões

> Registro curto de decisões de produto tomadas sem consulta. Mais recente em cima.

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
