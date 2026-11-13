# Contrato de Experiência — estado do módulo

> Documento de continuidade. Leia antes de mexer em `/contratos`. Mantenha-o
> atualizado ao fim de cada etapa.

Última atualização: **12/11/2026**

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
  chamam `exigirGestor` + `podeAcessarEmpresa`.
- Um formulário só (empregadora, empregado, contrato, horário, VT, aviso) gera
  os três `.docx` ou um `.zip` com todos (`POST /api/contratos/documento`).
  **Gerar não depende de salvar** — funciona mesmo sem a tabela no banco.
- Contratos salvos ficam no Postgres (`contratos_experiencia`, migração `0003`),
  com situação `experiencia` / `efetivado` / `encerrado`. Os em experiência
  geram alerta no topo quando o 1º período ou a prorrogação vence em ≤ 7 dias,
  e alerta vermelho quando já venceu (contrato vencido sem providência vira
  prazo indeterminado — o alerta só some quando ela marca efetivado/encerrado).
- Exclusão: confirmação + **desfazer** (exclusão lógica, `excluido_em`).
- Pré-preenchimentos: razão social e horário vêm do cadastro da empresa
  (jornada e "trabalha sábado"); endereço da sede e cidade vêm do último
  contrato salvo da empresa (ou do navegador); nome sugere os funcionários do
  cadastro do ponto e puxa o cargo para a função.

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
- ⚠️ **Migração `0003` ainda não aplicada no Supabase** — o CLI desta máquina
  está logado numa conta sem permissão no projeto `zxjeibkttmacpuukvyzo`.
  Aplicar com `npx supabase login` (conta dona do projeto) → `npx supabase link
  --project-ref zxjeibkttmacpuukvyzo` → `npx supabase migration list` →
  `npx supabase db push`; ou colar o SQL de
  `supabase/migrations/0003_contratos_experiencia.sql` no SQL Editor. Até lá a
  página avisa e só não salva.
- ⬜ Validar com a Edilse o layout impresso dos três documentos.

## Ideias para depois (não pedidas)

- Alertas de vencimento de **todas** as empresas no topo (hoje é por empresa).
- Aviso no Timesheet/menu quando houver contrato vencendo.
- PDF direto (hoje sai `.docx`, que ela edita/imprime no Word).
- Entrar no módulo `ponto` (ou um módulo `dp`) quando a Fase 5, Parte A, do
  `docs/livro-caixa.md` criar a liberação de módulos por contador.
