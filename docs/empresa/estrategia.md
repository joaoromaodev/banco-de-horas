# ClickContas — estratégia

> Documento do "dono". Decisões de produto e negócio. Atualize quando uma decisão mudar;
> registre o porquê em `decisoes.md`.

Última atualização: **21/11/2026**

## Tese

O escritório contábil pequeno (1–10 pessoas) ainda vive de **papel e digitação**: a
empresa-cliente manda foto, planilha ou documento físico e alguém do escritório
redigita. Cada ferramenta que fizemos para a Edilse Goes **inverte esse fluxo** — o
cliente lança ou a IA lê, o contador só confere. Esse é o produto:

> **ClickContas: o cliente lança, a IA lê, o contador confere.**

Não competimos com o ERP contábil (Domínio, Alterdata, Questor, Contmatic). Somos a
**camada entre o cliente e o ERP**: coleta, conferência e documentos prontos.

## Cliente-alvo (ICP)

- Escritório contábil pequeno, interior e capitais do Norte/Nordeste primeiro
  (Belém é a base, a Edilse é a referência).
- Atende MEI, Simples, profissionais liberais (clínicas, consultórios) e comércio.
- Dor principal: tempo perdido redigitando + cliente desorganizado.
- Quem decide: o próprio contador dono. Quem usa: ele, o auxiliar e o cliente dele.

## Produto — módulos

| Módulo | Status | Valor para o contador |
|---|---|---|
| Livro Caixa | em uso (Edilse, 1 cliente real) | cliente lança, contador concilia, livro sai em PDF/xlsx |
| Folha de Ponto (OCR) | em uso (Edilse) | foto da folha manuscrita → planilha de horas |
| Contrato de Experiência | em uso (Edilse) | contrato + VT + aviso de término, alerta de vencimento |
| **Portal do Cliente** (próximo) | planejado | uma casa só para o cliente: lançar caixa, enviar documentos, ver pendências |
| **Agenda de obrigações** | planejado | vencimentos (DAS, contratos, certificados) por cliente, com aviso |
| **Recibos/RPA e Carnê-Leão** | ideia | profissional liberal PF (como o NÉLIO) é cliente típico |

## Modelo de negócio

Assinatura mensal ou anual, cobrança por **escritório**, preço por faixa de
empresas-clientes ativas. Pix/boleto/cartão via gateway brasileiro (Asaas é a
primeira opção: Pix e boleto nativos, assinatura recorrente, taxa baixa).

| Plano | Empresas-clientes | Mensal | Anual (2 meses grátis) |
|---|---|---|---|
| Essencial | até 10 | R$ 89 | R$ 890 |
| Escritório | até 40 | R$ 189 | R$ 1.890 |
| Ilimitado | sem limite | R$ 349 | R$ 3.490 |

- Todos os módulos em todos os planos (simples de vender); OCR com cota mensal por
  plano — 150 / 600 / 2.000 folhas (custo de IA é o único custo variável relevante).
- **14 dias grátis**, sem cartão.
- A Edilse é da **equipe**: consultora contábil e cliente-teste (escritório
  `fundador`). Ainda não há cliente pagante; as empresas dela são o laboratório.
- Preços são hipótese — validar com 5 contadores antes do lançamento.

## Metas

1. **Dez/2026** — base SaaS pronta: escritórios como inquilinos, cadastro
   self-service com teste grátis, site público com planos.
2. **Jan/2027** — cobrança automática no ar; Edilse migrada para o modelo novo;
   2º escritório piloto (indicação da Edilse).
3. **Mar/2027** — 10 escritórios pagantes.

## Nome e marca

Mantemos **ClickContas** (`lib/brand.ts`, logo já feita na paleta petróleo + verde).
O nome é falado "Clique Contas" — é o mesmo produto. Domínio a verificar
(`clickcontas.com.br`). Trocar de nome agora jogaria fora a identidade recém-feita
sem ganho.

## O que NÃO fazemos (por enquanto)

- App mobile nativo (a web responsiva resolve).
- Escrituração contábil / SPED (é do ERP).
- Integração bancária (Open Finance) — só depois de 10 pagantes.

## Antes de ir ao mercado

Em 21/11/2026 o João decidiu: o produto **não é vendido ainda**. A venda está
escondida atrás de `VENDAS_ABERTAS` em `lib/brand.ts` (`false`): sem preços, teste
grátis, `/planos` (redireciona para `/conheca`), cadastro anunciado nem menu
"Assinatura". `/criar-conta` segue funcionando para testes. Para religar: trocar a
chave para `true`, **depois de cumprir a lista abaixo**.

### O que os termos de uso (`app/(site)/termos`) precisam ter

- Troca de plano: subida vale já, com cobrança proporcional dos dias restantes;
  descida e troca mensal↔anual valem na renovação, sem crédito.
- Carência de 7 dias após o vencimento; depois, somente leitura (consulta e
  exportação continuam). Pagamento libera na hora.
- Fim do teste sem assinar = somente leitura, nada apagado.
- Cancelamento a qualquer momento, acesso até o fim do período pago; exportação por
  90 dias após cancelamento (proposta a validar).
- Limite de empresas por plano (10/40/sem limite): passar do limite barra só o
  cadastro de novas; descer de plano não apaga nada.
- Cota mensal de leituras de IA por plano, limite de ritmo e uso justo do Ilimitado.
- Arrependimento (art. 49 do CDC) e reembolso do plano anual — validar com advogado.
- Revisar limitação de responsabilidade e suspensão contra cláusula abusiva.
- Preços **não** vão escritos nos termos: remeter a `/planos`.

### O que a política de privacidade (`app/(site)/privacidade`) precisa ter

- Suboperadores com finalidade, dados e país: Supabase (banco e arquivos), Vercel
  (hospedagem), **Asaas** (pagamento; CPF/CNPJ do pagador vai só a ele, não guardamos
  nem dados de cartão), **Google/Gemini** (foto da folha de ponto e nomes lidos por IA;
  exige API em nível pago, sem treino com o conteúdo — confirmar), Resend (e-mail).
- Documentos enviados pelo cliente: bucket privado, 10 MB, URL assinada de curta
  duração, quem acessa (equipe do escritório e a empresa-cliente que enviou).
- Leitura por IA das folhas: o que vai ao Google, revisão humana obrigatória, sem
  decisão automatizada.
- Tabela de retenção (propor prazos, marcar o que depende de validação jurídica):
  ponto/folha (guarda trabalhista — jurídico), `ponto_leituras_ocr` (sugestão 13
  meses), documentos enviados (vigência + 90 dias; excluídos pelo usuário: definir),
  fiscal/cobrança (5 anos), backups (30 dias). Hoje falta rotina que aplique esses
  prazos (ver `docs/documentos.md`, "Faxina e retenção").
- Transferência internacional e regiões dos projetos (Supabase, Vercel).
- Dados da empresa `[entre colchetes]`: razão social, CNPJ, DPO, e-mail, foro.

### Outras travas do lançamento

Razão social e CNPJ, revisão jurídica dos dois
textos, Asaas configurado, Gemini em nível pago.
