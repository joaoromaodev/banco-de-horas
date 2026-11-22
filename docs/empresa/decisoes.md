# ClickContas — decisões

> Registro curto de decisões de produto tomadas sem consulta. Mais recente em cima.

## 21/11/2026 — Endurecimento do login

- Em produção, o master só entra com `MASTER_PASSWORD` forte (≥ 12, fora de uma
  lista de padrões); sem isso, o login de master fica desligado em vez de cair em
  `admin1234`. `SESSION_SECRET` ausente em produção passa a ser erro (antes, texto
  fixo = cookie forjável). Login com limite de tentativas por IP e por e-mail.
  Conferido depois do deploy: a produção tem `SESSION_SECRET` (cookie falso → login).

## 21/11/2026 — Sem nomes de pessoas no site

- Pedido do João: a landing não usa nome de cliente nem de pessoa da equipe por
  enquanto. A seção de depoimento provisório (que ainda trazia o nome com a grafia
  errada — o certo é **Edilse**, com S) foi removida. Depoimento só volta com texto
  real aprovado, quando o lançamento for decidido.

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
- ~~Depoimento provisório~~ — removido em 21/11/2026 (ver acima).
- Textos legais são rascunho; campos `[entre colchetes]` (razão social, CNPJ, DPO, foro)
  dependem de dados da empresa.

## 21/11/2026 — Sprint 12, decidida pelo dono

O João pediu que o dono decida sozinho. O planejado até a Sprint 11 está publicado; o
backlog restante depende de terceiros. Decisões:

- **Documento → lançamento sugerido por IA entra agora, desligado.** É o coração da tese
  ("o cliente lança, a IA lê, o contador confere"). Construímos atrás de duas travas,
  como a IA do caixa: variável de ambiente da plataforma e opção por empresa, ambas
  desligadas. Ligar em produção só depois do Gemini pago, do aceite da Edilse e da
  política de privacidade citar o uso. Nada de documento real no Gemini gratuito.
- **Acabamentos das ressalvas do QA visual** (KPIs do painel no celular, Demonstrativo
  abrindo em janeiro, barra de ações de contratos em 1024 px, rótulos do gráfico do
  resumo) — baratos e visíveis para quem usa todo dia.
- **Teste logado em produção da Sprint 11** (`/inicio` e rescisão) com conta de teste,
  que ficou faltando na integração.
- Carnê-Leão e convenção coletiva continuam esperando a Edilse.

## 21/11/2026 — Sprint 13, decidida pelo dono

- **Avisos ao cliente pelo sino** (folha devolvida, pedido da contabilidade, Demonstrativo
  pronto): o e-mail depende do Resend, mas o aviso dentro do app não depende de ninguém
  e fecha o ciclo "a contadora pede → o cliente vê".
- **Acabamentos de IA e tela:** foto chega girada à IA (rotação perdida ao limpar os
  dados do celular), limite de 30 leituras do cliente contando também as da
  contabilidade, gráfico do Demonstrativo encolhendo no celular.

## 21/11/2026 — Sprint 14 (confiabilidade), decidida pelo dono após parecer da Bússola

- **Pausa em funcionalidade nova.** O uso real ainda é pequeno (1 cliente no caixa, 9
  empregados sem admissão); mais tela agora é palpite. A sprint é de confiabilidade.
- **Achado:** sem `CRON_SECRET` na Vercel, `/api/cron/agenda` responde 503 e, além do
  e-mail, deixa de abrir os pedidos mensais do fechamento e de apagar fotos antigas do
  ponto — calado. Os pedidos de 1º/12 não sairiam.
- **A. Nada falha calado:** pedidos mensais abertos também na primeira visita do mês
  (idempotente, índice único se faltar); `error.tsx`; carregamentos principais com
  mensagem e "tentar de novo"; tela do master com o que está desligado.
- **B. Testes de guarda e de rota:** CI quebra se uma rota de `app/api` não chamar a
  guarda; testes de rota nos fluxos de dinheiro e acesso.
- **C. Medição própria de desempenho e erros** fica para a Sprint 15.

## 22/11/2026 — Foco do beta (João)

- MVP/beta: foco total em qualidade do produto; **nada de venda nem de implantação em
  cliente**; **tudo gratuito** pelo máximo de tempo. Implantação guiada (Sprint 16 B)
  cancelada. Gemini pago fora — alternativa gratuita em `ia-gratuita.md`.
- As próximas sprints saem da pesquisa de concorrentes (`concorrentes.md`).
- `CRON_SECRET` configurado na Vercel (produção) pela CLI em 22/11.
