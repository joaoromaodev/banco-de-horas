# Contrato de Experiência — estado do módulo

> Documento de continuidade. Leia antes de mexer em `/contratos`. Mantenha-o
> atualizado ao fim de cada etapa.

Última atualização: **21/11/2026** (Sprint 3, Frente C)

## Por que existe

Pedido da Edilse em 12/11/2026, por WhatsApp: abrir uma aba no sistema para
**contrato de experiência**, por causa de uma empresa-cliente (Vaz & Vouzela) que
admite muita gente por experiência. Ela mandou três modelos do Word:

| Documento | Modelo original | Template |
|---|---|---|
| Contrato de trabalho a título de experiência (+ termo de prorrogação) | `CONTRATO DE EXPERIÊNCIA modelo.docx` | `modelos/contrato-experiencia/contrato.docx` |
| Declaração de opção de vale-transporte (+ trajeto) | `DECLARAÇÃO DE OPÇÃO DE VALE TRANSP modelo.docx` | `vale.docx` |
| Aviso de término do contrato de experiência | `ENCERRAMENTO DO TERMINO DO CONTRATO DE EXPERIÊNCIA modelo.docx` | `encerramento.docx` |

## Como funciona

- Página `/contratos` (só gestor: master/contabilidade). O `cliente` não alcança
  porque nem `/contratos` nem `/api/contratos` estão em `CLIENTE_PODE`, e as rotas
  chamam `exigirGestor` + `podeAcessarEmpresa`. Fica atrás do módulo **`ponto`**
  (`ROTAS_PONTO` em `proxy.ts`) e aparece no menu no grupo da Folha de Ponto —
  é departamento pessoal da mesma contadora; um contador só-caixa não vê.
- Um formulário só (empregadora, empregado, contrato, horário, VT, aviso) gera
  os três `.docx` ou um `.zip` com todos (`POST /api/contratos/documento`).
  **Gerar não depende de salvar** — funciona mesmo sem a tabela no banco.
- Contratos salvos ficam no Postgres (`contratos_experiencia`, migração `0009`),
  com situação `experiencia` / `efetivado` / `encerrado`. Os em experiência
  geram alerta no topo quando o 1º período ou a prorrogação vence em ≤ 7 dias,
  e alerta vermelho quando já venceu (contrato vencido sem providência vira
  prazo indeterminado — o alerta só some quando ela marca efetivado/encerrado).
  **Desde 21/11/2026 a faixa do topo é de todas as empresas** do usuário (ver
  "Alertas consolidados").
- Exclusão: confirmação + **desfazer** (exclusão lógica, `excluido_em`).
- Pré-preenchimentos: razão social e horário vêm do cadastro da empresa
  (jornada e "trabalha sábado"); endereço da sede e cidade vêm do último
  contrato salvo da empresa, senão do cadastro fiscal (`empresa_fiscal`), senão
  do navegador; nome sugere os funcionários do
  cadastro do ponto e puxa o cargo para a função.

## Alertas consolidados (Sprint 3 / Frente C)

- Faixa no topo de `/contratos` com os contratos **em experiência** de **todas as
  empresas que o usuário enxerga** cujo marco (fim do 1º período ou da prorrogação)
  vence em ≤ 7 dias ou já passou. Cada linha mostra empregado, empresa, marco e
  prazo; clicar troca para a empresa e abre o contrato.
- Regra de urgência: função pura `alertasConsolidados` em `lib/contratos.ts`
  (testes em `tests/contratos.test.ts`). Ordem: vencidos primeiro, do mais
  atrasado ao menos; depois os que vencem, do mais próximo ao mais distante;
  empate por nome. A faixa fica vermelha se houver algum vencido.
- Dados: `GET /api/contratos/alertas` (`exigirGestor` + `empresasVisiveis`:
  master vê tudo; contador, o escritório dele). Uma consulta só
  (`listarEmExperiencia`). Sem a tabela (migração 0009 pendente) responde vazio.
- A faixa recarrega depois de salvar, mudar situação, excluir e desfazer.

## PDF direto (Sprint 3 / Frente C)

- Ao lado dos botões de download há a escolha **Word | PDF** (lembrada no
  navegador). `POST /api/contratos/documento` aceita `formato: 'pdf'` (padrão
  `docx`); o ".zip da admissão" sai com o formato escolhido.
- **Decisão:** PDF desenhado com **pdf-lib** (`lib/contratosPdf.ts`) a partir dos
  mesmos campos de `camposDoDocumento`, e não convertido do .docx. Motivos: a
  Vercel não tem LibreOffice; serviço externo de conversão custaria dinheiro e
  mandaria CPF/CTPS para fora; pdf-lib já é dependência e roda em qualquer função.
  Sem dependência nova, sem arquivo de fonte para versionar.
- **Fonte:** Times (padrão do PDF, codificação WinAnsi), que cobre todo o
  português — acentos, ç, aspas curvas, travessão. Não é "embutida" no arquivo: o
  leitor usa a Times dele (todos têm). Caractere fora do WinAnsi vira `?` em vez
  de derrubar a geração.
- **Fidelidade:** reproduz o **texto, a ordem e as cláusulas** dos três modelos
  (contrato + termo de prorrogação em página própria, declaração de VT com os
  trajetos, aviso de término), mas **não o desenho pixel a pixel** — margens,
  tabela do horário e blocos de assinatura são nossos. Por isso o **.docx continua
  sendo o padrão** (é o que a contadora edita e imprime); o PDF é a alternativa
  para mandar/arquivar sem abrir o Word.
- **Manutenção:** se o texto de um modelo mudar (`preparar_modelos.py`), o PDF
  **não muda sozinho** — atualize o texto correspondente em `lib/contratosPdf.ts`.

## Regras de data (lib/contratos.ts)

- O dia da admissão conta: `vencimento = admissão + dias − 1`.
- Prorrogação até `admissão + período + prorrogação − 1`. Total ≤ 90 dias (CLT
  art. 445) — bloqueia. Uma prorrogação só (art. 451). Padrão 45 + 45.
- Retorno para a rescisão: sugere término + 10 dias (art. 477 §6), recuando para
  sexta se cair no fim de semana. Editável.
- Avisos que **não** bloqueiam: horário acima de 44h semanais, CPF sem 11
  dígitos, mesmo CPF com outro contrato a menos de ~6 meses (art. 452).
- Datas sempre como `AAAA-MM-DD` + `Date.UTC`; "hoje" é calculado no fuso
  `America/Belem`.

## Templates — armadilha principal

Os `.docx` em `modelos/contrato-experiencia/` têm `{{PLACEHOLDERS}}` gravados
**inteiros dentro de um único `<w:t>`** pelo script
`preparar_modelos.py` (que também reflui o parágrafo de abertura, que no
original era centralizado com quebras de linha manuais). O preenchimento em
runtime é um replace de string com escape de XML.

- **Não edite os templates no Word**: o Word quebra `{{X}}` em vários trechos e
  o placeholder deixa de ser trocado. `gerarDocx` acusa erro se sobrar `{{`.
- Para mudar o texto: altere o modelo original da contadora e rode
  `python -I preparar_modelos.py <pasta_com_contrato/vale/encerramento.docx> modelos/contrato-experiencia`
  (o script localiza parágrafos por índice e por texto exato — se o original
  mudar de estrutura, ajuste o script; ele falha com `assert` se não achar).
- Os templates são lidos com `fs` em runtime; `next.config.ts` os inclui no
  bundle da função via `outputFileTracingIncludes`.
- Textos com gênero viram placeholders (`O_SR`, `PORTADOR`, `CHAMADO`,
  `REGISTRADO`, nacionalidade). "EMPREGADO" e "notificá-lo" ficaram como no original.

## Estado

- ✅ Etapa 1 (12/11/2026): página, geração dos três documentos, cadastro salvo,
  alertas de vencimento, exclusão com desfazer.
- ✅ Migração `0009` aplicada em produção (12/11/2026). Ela nasceu como `0003`
  num checkout com `main` desatualizado — o remoto já ia até `0008`. Lição:
  **`git fetch` + `supabase migration list --remote` antes de numerar migração.**
  No CLI v3 o `db push` precisa de `--remote` (sem ele tenta o banco local).
- ⬜ Validar com a Edilse o layout impresso dos três documentos (.docx e PDF).

- ✅ Sprint 3 / Frente C (21/11/2026): alertas de todas as empresas no topo e
  PDF direto. Sem migração.

## Para o integrador (o que testar em produção)

Sem migração e sem variável de ambiente nova. Nada disto foi exercitado contra o
banco real (a máquina de desenvolvimento não tem `.env.local`): só typecheck,
lint, Vitest e build.

1. **Faixa de alertas:** entre como contador de um escritório com 2+ empresas e
   contratos em experiência. Cadastre/edite um contrato com admissão que faça o
   1º período vencer em ≤ 7 dias (e outro vencido) em empresas diferentes → ambos
   aparecem no topo, vencido primeiro, faixa vermelha. Clique num de outra
   empresa: troca a empresa e abre o contrato. Marque como efetivado → some da faixa.
2. **Recorte:** um contador de outro escritório **não** pode ver esses contratos na
   faixa; o master vê todos. Um usuário `cliente` continua sem alcançar a tela.
3. **Sem tabela:** antes da migração 0009 a faixa some e a tela segue gerando documentos.
4. **PDF:** escolha **PDF**, baixe os três documentos e o .zip. Confira acentuação
   (nome com ç/ã/é), os campos preenchidos, a tabela de horário (dia de FOLGA),
   o termo de prorrogação em página própria e as linhas de assinatura. Compare com
   o .docx — **se a Edilse achar o layout diferente demais, o .docx segue como padrão.**
5. **Impressão:** imprima o PDF em A4 e confira margens/quebra de página (o contrato
   deve caber em 1 página + termo; texto muito longo no endereço pode empurrar a
   assinatura para a página seguinte).

## Ideias para depois (não pedidas)

- Aviso no Timesheet/menu quando houver contrato vencendo.
- Módulo próprio `dp` em vez de pegar carona no `ponto`, se algum contador
  quiser contratos sem a folha de ponto.
