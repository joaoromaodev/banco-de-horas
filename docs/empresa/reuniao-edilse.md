# Reunião com a Edilse

**Como usar:** quando o João disser "vou para a reunião com a Edilse", ele recebe este
material. Leia o "Em 2 minutos", leve as perguntas e anote as respostas no fim. Depois
da reunião, passe cada resposta para o doc de origem e risque o item aqui.

**Última atualização:** 21/11/2026 (depois da Sprint 15).

## Em 2 minutos

1. **IA lendo comprovantes no Livro Caixa:** ela aceita ligar, em alguma empresa? (pergunta L1)
2. **Carnê-Leão:** quando quem paga não é o paciente, precisa do CPF dos dois? E como ela lança hoje no Carnê-Leão Web? (C1, C2)
3. **Rescisão:** confirmar os pontos de cálculo antes de usar a simulação de verdade (D1 a D8).
4. **Conta bancária fora do caixa:** o que entra e o que fica fora do livro (L2).
5. **Livro definitivo:** validar o texto dos termos (sobretudo pessoa física) e passar os dados fiscais das empresas (L3 e pedido 3).

## Pedidos para ela fazer

| # | Tarefa | Onde no sistema | Fonte |
|---|---|---|---|
| 1 | Preencher admissão e salário dos **9 empregados da Vaz & Vouzela** (todos estão "sem admissão"). Dá para fazer **todos de uma vez**, numa grade ou numa planilha modelo. | Departamento Pessoal → **Completar cadastro** | `departamento-pessoal.md` (Sprint 10 B), `continuidade.md` |
| 2 | Cadastrar os **feriados** do escritório (hoje nenhum; sem eles o ponto não reconhece "feriado trabalhado"). | Folha de Ponto → Cadastros | `folha-de-ponto.md` |
| 3 | Passar os **dados fiscais** de cada empresa (endereço, inscrições, Junta, cidade do termo). Sem eles os termos do livro saem incompletos. | Livro Caixa → Cadastros (dados fiscais) | `livro-caixa.md` (Fase 6), `roadmap.md` |
| 4 | Conferir os **15 lançamentos de "material de expediente"** do NÉLIO (R$ 7.333,31): o que for insumo clínico volta para Material de Consumo. | Livro Caixa do NÉLIO | `livro-caixa.md` (Q1), `roadmap.md` |
| 5 | Imprimir o contrato, a declaração de VT e o aviso de término **em PDF e em Word** e comparar. | Contratos → formato PDF | `contratos-experiencia.md` |
| 6 | Mostrar (ou mandar um print de) **como ela lança hoje no Carnê-Leão Web**. | fora do sistema | `roadmap.md` |

## Perguntas

### Departamento Pessoal (rescisão)

Todas de `departamento-pessoal.md` (Sprints 9 e 11) e do backlog em `roadmap.md`. O
cálculo foi conferido pelo nosso consultor; estes pontos ficaram sem consenso.

- **D1.** No **acordo** (art. 484-A) e na **culpa recíproca**, o aviso projeta pela metade ou integral? *Muda férias e 13º projetados.*
- **D2.** A dobra das férias vencidas conta até o **dia do desligamento** ou até o **fim do aviso projetado**? *Muda se a dobra entra.*
- **D3.** O aviso trabalhado pode ser exigido **integral**? *Hoje o sistema segue uma das leituras.*
- **D4.** A redução do IR da **Lei 15.270** vale também no **13º**? E o 13º fica **sem o desconto simplificado**? *No exemplo, R$ 114,39 de diferença.*
- **D5.** Média de horas extras: **mês sem folha de ponto** entra como zero na divisão ou fica de fora? *Abaixa ou não a média.*
- **D6.** Avos nas pontas do período: **15 dias ou mais conta 1 avo** — é o critério dela?
- **D7.** **Data-base e piso** da categoria dos clientes com empregados (Vaz & Vouzela)? *Hoje o sistema não conhece convenção.*
- **D8.** Na prática o salário do mês é pago **no próprio mês ou no seguinte**? *Muda o IRRF da rescisão (regime de caixa).*

### Livro Caixa

- **L1. IA lendo comprovantes.** Ela tinha decidido "não anexa, não lê". Hoje está **pronto e desligado**. O que faz: quem lança clica em "Ler documento", manda a foto ou o PDF de uma **nota, recibo ou outro** comprovante, e o sistema **preenche o lançamento como rascunho**; a pessoa confere e lança, e o comprovante fica anexado. **Vai para o Google (Gemini):** só a imagem ou as 2 primeiras páginas do PDF, sem dados do celular, mais a lista de contas da empresa; **não vão** nome/CNPJ da empresa nem quem lançou. **Nunca vão** extrato nem folha. O comprovante pode ter nome e CPF de terceiros. Empresas de saúde (como o NÉLIO) **ficam de fora**. *Opções:* manter desligado · ligar em uma empresa para testar · ligar onde ela escolher (só depois do Google pago e da privacidade revisada). *Fonte:* `livro-caixa.md` (Sprint 12), `decisoes.md`.
- **L2. Conta bancária fora do caixa.** O movimento que passa **só pelo banco** fica fora do livro? *Hoje: depósito no banco = saída do caixa, retirada = entrada, sem conta de resultado.* Fonte: `continuidade.md`, `livro-caixa.md`.
- **L3. Texto dos termos** de abertura e encerramento: serve? Em especial o de **pessoa física**, que redigimos nós. Fonte: `livro-caixa.md` (Fase 6), `roadmap.md`.
- **L4. Rótulos do livro impresso:** usar "Conta Titular / Conta Analítica"? E a coluna **Cliente/Paciente** deve sair no PDF/planilha, com qual nome? Fonte: `roadmap.md`, `livro-caixa.md`.
- **L5. Devolução de fornecedor:** vai para "Recuperação de despesas" ou abate a despesa? Fonte: `livro-caixa.md`.
- **L6.** Até que dia do mês o cliente costuma lançar? *Define a carência do aviso "mês sem lançamento" (hoje 10 dias).* Fonte: `livro-caixa.md`.

### Carnê-Leão

- **C1.** Quando quem paga **não é o paciente atendido**, ela precisa do CPF **dos dois**? *Hoje guardamos só quem pagou.* Fonte: `livro-caixa.md`, `roadmap.md`.
- **C2.** Como ela monta o **Carnê-Leão Web** hoje (o que digita, de onde tira)? *É o que falta para começar os recibos e o Carnê-Leão.* Fonte: `roadmap.md`.
- **C3.** O aviso do sistema deve falar em **DMED** ou em **Receita Saúde**? Fonte: `livro-caixa.md`.

### Folha de Ponto

- **P1.** Algum cliente usa **intervalo pré-assinalado** (só 2 marcações)? Alguma empresa com **12x36** ou **trabalho noturno**? Fonte: `folha-de-ponto.md`.
- **P2.** O DSR perdido por falta vai na folha do **mês da falta** ou do **mês do domingo**? *Adotamos o do domingo.* Fonte: `folha-de-ponto.md`.
- **P3.** A convenção prevê **sábado a 100%** ou perda de DSR por atraso? Há **banco de horas** por acordo? Há **horistas**? Fonte: `folha-de-ponto.md`.

### Contratos

- **K1.** O **PDF** dos três documentos ficou bom ou o **Word** continua como padrão? Fonte: `contratos-experiencia.md`.

### Agenda

- **A1.** O **ISS de Belém** vence dia 10? A **DMED** continua em 2027 e a **EFD-Reinf** segue no dia 15? Fonte: `agenda.md`.

## O que mostrar a ela

Novidades das Sprints 11 a 15, ainda não vistas por ela:

1. **Página inicial do cliente:** ao entrar, o cliente vê só o que precisa fazer (lançar o mês, documentos pedidos, folhas devolvidas) e o último Demonstrativo. Se não houver nada, "Tudo em dia".
2. **Rescisão completa:** além das verbas, calcula **INSS, IRRF e o líquido**, puxa a **média de horas extras do ponto** (ela pode tirar meses) e gera PDF marcado "SIMULAÇÃO".
3. **Sino do cliente:** o cliente é avisado de folha devolvida, pedido de documento e Demonstrativo pronto (o e-mail ainda está desligado).
4. **Pedidos mensais automáticos:** extrato, notas e recibos de cada mês são pedidos sozinhos no primeiro acesso do mês, e se fecham quando o cliente envia.
5. **Folha de ponto pelo cliente:** a foto tirada de lado chega sempre em pé para a leitura, o que reduz erro de leitura.
6. **Nada falha calado:** quando algo não carrega, a tela avisa; em Configurações há a lista do que está desligado.
7. **Ler documento com IA** (L1): só explicar, está desligado em produção.

## Respostas

| Item | Resposta | Data |
|---|---|---|
| L1 IA lendo comprovantes | | |
| C1 CPF de quem paga e do paciente | | |
| C2 Carnê-Leão Web hoje | | |
| C3 DMED ou Receita Saúde | | |
| D1 Projeção no acordo/culpa recíproca | | |
| D2 Corte da dobra das férias | | |
| D3 Aviso trabalhado integral | | |
| D4 Lei 15.270 e simplificado no 13º | | |
| D5 Mês sem ponto na média | | |
| D6 Regra dos 15 dias | | |
| D7 Data-base e piso | | |
| D8 Salário no mês ou no seguinte | | |
| L2 Conta bancária fora do caixa | | |
| L3 Texto dos termos (PF) | | |
| L4 Rótulos do livro e coluna do paciente | | |
| L5 Devolução de fornecedor | | |
| L6 Dia limite de lançamento | | |
| P1 Pré-assinalado, 12x36, noturno | | |
| P2 DSR: mês da falta ou do domingo | | |
| P3 Sábado 100%, banco de horas, horistas | | |
| K1 Contratos: PDF ou Word | | |
| A1 ISS Belém, DMED, EFD-Reinf | | |
| Pedidos 1–6 (combinado e prazo) | | |


> Acrescentado em 22/11: o cliente pode ver nomes mais simples que "Conta Titular" e "Conta Analítica" na tela dele? (fonte: `docs/qa-visual.md`, Sprint 16)

> Acrescentado em 22/11 (Sprint 17):
> - **Avisar:** "Confirmar o mês" do Livro Caixa virou **"Fechar o mês"** e agora **trava**: os meses que ela já tinha confirmado (e os anteriores a eles) não aceitam mais lançamento, edição nem exclusão; para mudar, ela reabre o mês informando o motivo (fica no histórico). Os meses fecham em ordem, a partir de janeiro.
> - **Mostrar:** envio de guia/DAS/holerite para o cliente com "baixado em"; aceitar ou devolver documento do cliente com motivo; "Não tenho este mês"; lembrete 3 dias antes do prazo; leitura de XML de nota, boleto e PDF sem IA; fechamento do mês do ponto com aceite do cliente.
> - **Perguntar:** prazo para o cliente dar o aceite do resumo do ponto; quem guarda a folha de ponto original; se o contrato de serviço dela prevê aceite eletrônico (o aceite **não** é espelho assinado pelo empregado — art. 74 da CLT). Fonte: `docs/folha-de-ponto.md`.
> - **Pedir:** 3 ou 4 fotos de folhas de ponto reais (pode tapar os nomes) para medir a nova IA gratuita.
