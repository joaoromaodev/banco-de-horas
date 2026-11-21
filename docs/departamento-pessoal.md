# Departamento Pessoal (Sprint 8 · Frente A)

> Cadastro único do empregado, férias e 13º. Antes o DP estava espalhado: o ponto
> ligava a frequência ao funcionário **pelo nome** e ninguém tinha admissão; o
> contrato de experiência guardava admissão e salário num JSON. Agora há um
> cadastro só (`dp_empregados`), ponto e contratos apontam para ele por **id**, e
> férias e 13º saem dele — inclusive na Agenda e no resumo por e-mail.

Branch: `claude/departamento-pessoal-1a4640`. Migração: **`0021_departamento_pessoal.sql`**
(**não aplicada**). Última atualização: 21/11/2026.

## Onde está

| Peça | Arquivo |
|---|---|
| Empregado: modelo, validação, CPF, **`jornadaDoEmpregado`**, **`temBancoDeHoras`** | `lib/dp.ts` — `tests/dp.test.ts` |
| Férias: aquisitivo/concessivo, art. 130, programação, alertas | `lib/ferias.ts` — `tests/ferias.test.ts` (41 testes) |
| 13º: avos e prazos | `lib/decimoTerceiro.ts` — `tests/decimoTerceiro.test.ts` |
| DP na agenda / e-mail (derivado) | `lib/dpAgenda.ts` — em `tests/dp.test.ts` |
| Banco (empregados, férias, faltas do ponto, contrato → empregado) | `lib/dpServidor.ts` |
| Aviso e recibo de férias (PDF) | `lib/feriasPdf.ts` (usa o `Escritor` de `lib/contratosPdf.ts`) — `tests/feriasPdf.test.ts` |
| Rotas | `app/api/dp/route.ts` (lista, cria, edita), `empregado/` (ficha), `ferias/` (programar, excluir, desfazer), `documento/` (PDF), `comum.ts` |
| Tela | `app/(app)/dp/page.tsx` (lista), `Ficha.tsx`, `FormEmpregado.tsx`, `ProgramarFerias.tsx` |
| **Simulação de rescisão** (Sprint 9) | `lib/rescisao.ts`, `lib/rescisaoPdf.ts` — `tests/rescisao.test.ts`; tela `SimularRescisao.tsx` (ver seção própria) |
| Acesso | `proxy.ts` (`/dp`, `/api/dp` em `ROTAS_PONTO`) — `tests/dpAcesso.test.ts`; isolamento das rotas em `tests/dpRotas.test.ts` |

## Decisões

| Tema | Decisão |
|---|---|
| Tabela nova × evoluir `ponto_funcionarios` | **Tabela nova** `dp_empregados`. O cadastro do ponto apaga quem sai da lista e renomear vira apagar + criar (`salvarFuncionarios`): admissão e salário se perderiam. `ponto_funcionarios.empregado_id` aponta para o empregado. |
| Frequência por id | `ponto_frequencias.empregado_id` (anulável). O **nome continua gravado** e segue sendo a chave do Timesheet (frente B é dona dele). **Gatilhos** no banco preenchem o id: funcionário novo no ponto → acha ou **cria** o empregado de mesmo nome; frequência nova → herda o empregado do funcionário de mesmo nome (não cria: nome livre com erro de digitação não vira empregado); empregado novo → liga o que estava solto com o mesmo nome. Assim `lib/pontoDb.ts` não mudou e a ordem migração/deploy não importa. |
| Contrato → empregado | Salvar ou editar o contrato chama `ligarEmpregadoDoContrato`: procura por CPF, depois por nome (sem caixa/espaços) — pelo nome **só** se houver um único homônimo e o CPF não contradizer; homônimo ambíguo ou com outro CPF não liga nem cria (fica para a tela). Sem achar ninguém, **cria** (nome em maiúsculas, como no ponto). Só **preenche o que está vazio** (admissão, cargo, salário, CPF) — nunca sobrescreve o que a contadora editou no DP. Falha sem derrubar o contrato. |
| Jornada contratual | O DP guarda **horas por semana, escala e o dia do DSR**. A jornada **diária** continua no cadastro do ponto (funcionário → empresa → 8h), que é o que o Timesheet usa — uma fonte só para o dia. `jornadaDoEmpregado` junta as duas. |
| Banco de horas | `banco_horas` + `banco_horas_desde`. Sem data = vale para qualquer data (a ficha avisa). |
| Situação | ativo / afastado (com **tipo**: doença, acidente, maternidade, outro) / desligado, sempre com data. Desligado sai dos alertas (férias e 13º vão na rescisão). Não há exclusão de empregado (histórico trabalhista). |
| Início do aquisitivo | Editável (`aquisitivo_base`; vazio = admissão). O `contador` pediu: o art. 133 zera o período e o novo começa no retorno (§2º); readmissão também. Sem isso, todos os períodos seguintes ficariam errados. |
| CPF e salário | Só a contabilidade vê. A **lista** (`GET /api/dp`) já sai do servidor com o CPF mascarado e sem salário; o dado inteiro só vem na ficha (`/api/dp/empregado`) e no PDF. Na ficha o CPF aparece mascarado (`***.982.***-**`) com "Mostrar". Nunca vão para e-mail, log ou IA; os erros do banco não chegam à resposta. CPF validado pelos dígitos. |
| Recibo de férias | **Sem valores**: datas, dias e um quadro de proventos/descontos em branco para preencher pela folha. Calcular remuneração, 1/3, INSS e IRRF fica para a etapa de valores. |
| Documento por GET | `/api/dp/documento` é GET: só gera o arquivo do que está gravado, então funciona em somente leitura e na consulta de empresa arquivada sem mexer nas listas de exportação. |

## Regras de férias (`lib/ferias.ts`)

Critérios revisados com o subagente **`contador`** em 21/11/2026.

- **Aquisitivo**: 12 meses a partir da admissão (ou do início editado). **Concessivo**:
  os 12 meses seguintes (art. 134). 29/02 vira 01/03 em ano não bissexto.
- **Direito (art. 130)**: só faltas **injustificadas** = marcador `FALTA` do ponto
  dentro do aquisitivo. Até 5 → 30 dias; 6–14 → 24; 15–23 → 18; 24–32 → 12; mais de
  32 → perde. A ficha mostra "ponto em X de Y meses": sem folha lançada, a falta não é
  vista. Atestado (art. 473) não conta. Art. 133 (perdas) não é calculado: aviso +
  início editável.
- **Cada período tem saldo próprio** (um vencido e um simples ao mesmo tempo não se somam).
- **Programação** (bloqueia): até 3 períodos; cada ≥ 5 dias; um ≥ 14 (art. 134 §1º); o
  que sobra tem de ser 0 ou ≥ 5 e, se ainda não há período de 14, permitir um; com
  direito < 14 (faltas), **período único** (leitura conservadora; a lei não trata);
  abono ≤ 1/3 do direito (art. 143); não pode sobrepor outras férias; **início não pode
  cair nos 2 dias antes de feriado ou do DSR** (art. 134 §3º), nem no próprio feriado/DSR;
  empregado afastado ou desligado não programa.
- **Feriados para férias**: os nacionais **em lei** (inclui 20/11, Lei 14.759/2023) e a
  Sexta-feira Santa, mais os cadastrados no ponto pelo escritório. **Carnaval e Corpus
  Christi não** (ponto facultativo) — diferente da agenda, que os trata como não úteis
  para vencimento bancário. Sugestão do `contador` para Belém: cadastrar 15/08 (Adesão
  do Pará) e 12/01 (aniversário de Belém) — a contadora confere.
- **Avisos** (não bloqueiam): aviso com menos de 30 dias (art. 135); pagamento depois de
  2 dias antes do início (art. 145; atraso = multa do art. 153, **não** dobro — a Súmula
  450 caiu na ADPF 501); férias antes de completar o aquisitivo; dias depois do fim do
  concessivo = **dobro** (art. 137; Súmula 81); fracionamento depende da concordância do
  empregado; abono pedido até 15 dias antes do fim do aquisitivo não pode ser negado.
- **Pagamento sugerido**: 2 dias antes do início, recuando para dia útil.
- **Estados do período**: em aquisição · a programar · **vencendo** (o último dia para
  começar o saldo sem dobro está a ≤ 60 dias — sobra ~30 para o aviso) · **vencidas**
  (concessivo acabou com saldo) · programadas · sem direito.
- **Afastado por doença/acidente há mais de 6 meses**: o alerta é suspenso ("novo
  aquisitivo começa no retorno", art. 133 IV).

## Regras do 13º (`lib/decimoTerceiro.ts`)

- **Avos**: 1/12 por mês com **15 dias ou mais** de trabalho (Lei 4.090/62 art. 1º §2º)
  = dias de contrato no mês − faltas lançadas. A ficha mostra os 12 meses, quantos já
  contam e quantos estão previstos até dezembro. **Sem valores em reais.**
- **Prazos** (Lei 4.749/65): 1ª parcela até 30/11, 2ª até 20/12, antecipados para o dia
  útil anterior (2026: 30/11 e **18/12**).
- **Afastamento** muda o cálculo conforme o tipo (`contador`): doença → empresa paga até
  o 15º dia, o resto é abono do INSS (Lei 8.213 art. 40); acidente não reduz (Súmula 46
  TST); maternidade conta. Hoje é **aviso na ficha**, não cálculo.

## Agenda e resumo por e-mail (derivados, sem duplicar)

`lib/dpAgenda.ts → itensDoDp` gera os itens a cada consulta, como os contratos:

| Item | Prazo mostrado | Some quando |
|---|---|---|
| Férias vencidas de X | fim do concessivo (fica como atrasada) | o saldo é programado |
| Férias de X — dar o aviso até… | limite de início − 30 dias | o saldo é programado |
| Férias programadas de X | o próximo marco: dar o aviso até (se não informado), pagar até, início | o início passa |
| 13º salário — 1ª / 2ª parcela (N empregados) | 1 por empresa, nos 30 dias antes | o prazo passa (o sistema não registra o pagamento) |

- **Agenda** (`/agenda` → Visão geral): seção "Departamento pessoal" (janela de 30 dias +
  atrasados), só para quem tem o módulo ponto, com link para o `/dp`.
- **E-mail** (`/api/cron/agenda`): os mesmos itens entram no resumo do escritório, com
  antecedência própria (13º: 30 dias; "vencendo": 15). O texto leva **só o nome do
  empregado** — nunca salário nem CPF. Limitação herdada: o resumo só sai para
  escritório que tem alguma obrigação cadastrada na agenda (`escritoriosComAgenda`).

## Tela `/dp`

- **Lista** por empresa (seletor no topo, lembrado no navegador; aceita `?empresa=` e a
  consulta de arquivada): indicadores (ativos, vencidas, vencendo, sem admissão), aviso
  dos que estão sem admissão, busca, desligados ocultos por padrão, ordem por urgência.
  Ação primária: **Cadastrar empregado**.
- **Ficha** (`?empregado=`): alertas no topo, dados (CPF mascarado), tabela de períodos
  (faltas, cobertura do ponto, direito, saldo, situação), férias programadas com
  **Aviso** e **Recibo** em PDF e excluir (**confirmação + Desfazer**), 13º com os avos
  mês a mês e os prazos. Ação primária: **Programar férias** (diálogo com validação ao
  vivo: erros seguram o botão, avisos informam; depois de programar, toast com
  **Desfazer**). "Editar dados" abre o mesmo formulário do cadastro.

## Simulação de rescisão (Sprint 9 · Frente B)

> **Só simulação, sem valor de documento oficial** (recomendação do consultor contador):
> o valor real depende de médias, convenção coletiva, estabilidades, aviso proporcional e
> do saldo do FGTS, que o sistema não conhece — um erro vira dívida trabalhista do cliente.
> Tela e PDF dizem "Simulação — não substitui o TRCT; confira convenção e médias".
> **Valores brutos, sem INSS, IRRF nem pensão.** Nada é gravado (sem migração), a situação
> do empregado não muda e o PDF é gerado no navegador.

Branch: `claude/simulacao-rescisao`. Regras revisadas com o subagente **`contador`** em
21/11/2026 (o exemplo abaixo foi conferido por ele, número a número).

| Peça | Arquivo |
|---|---|
| Regras (puro) | `lib/rescisao.ts` — `simularRescisao(entrada)`; fontes legais no cabeçalho e em cada linha (`fonte`) |
| PDF da simulação (marca d'água "SIMULAÇÃO", aviso no topo e no rodapé de cada página) | `lib/rescisaoPdf.ts` (usa o `Escritor` de `lib/contratosPdf.ts`) |
| Testes (54) | `tests/rescisao.test.ts` |
| Tela | `app/(app)/dp/SimularRescisao.tsx`, aberto pelo botão **Simular rescisão** da ficha (`Ficha.tsx`) |
| Dados | os da ficha (`/api/dp/empregado`, que passou a devolver também o CNPJ da empresa) |

### Entradas

Do cadastro: admissão, salário base (editável **só na simulação**), horas semanais,
banco de horas, início do aquisitivo editado, situação; do ponto: faltas (`FALTA`); da
programação: férias. Informadas pela contadora: tipo, data do desligamento (último dia
trabalhado; no aviso trabalhado, o último dia do aviso), modo do aviso, **adicionais
fixos** (insalubridade, periculosidade, gratificação — entram também no saldo), **médias
de variáveis** (HE, comissões, noturno — aviso, 13º, férias e art. 479), saldo do FGTS
para fins rescisórios (extrato), FGTS do mês anterior ainda não recolhido, 1ª parcela do
13º já paga, outros descontos, saldo positivo do banco de horas, fim da experiência,
empregador doméstico e os períodos de férias já quitados fora do sistema.

### Regras

| Verba | Regra | Fonte |
|---|---|---|
| Saldo de salário | (salário + adicionais) ÷ 30 × dias do mês até o desligamento; mês completo = 30 (inclusive fevereiro e meses de 31); da admissão se foi no mesmo mês; − faltas do mês. Médias não entram. DSR perdido não é calculado (alerta) | CLT art. 462 |
| Aviso proporcional | 30 + 3 × anos completos (até 20) = até 90 dias; anos até a **comunicação** | Lei 12.506/2011; NT 184/2012 MTE |
| Aviso indenizado | (salário + adicionais + médias) ÷ 30 × dias; projeção = desligamento + dias | CLT art. 487 §1º e §5º; Súmula 380; OJ 82 SDI-1 |
| Aviso trabalhado | 30 dias trabalhados (comunicação = desligamento − 30); os 3n da Lei 12.506 **indenizados** e projetados. Prática dominante — alerta "confira a convenção"; redução do art. 488 | idem |
| Pedido de demissão | aviso sempre 30 (proporcional só a favor do empregado). Trabalhado / dispensado: nada; não cumprido: desconto de 30 dias do **salário base**; cumprido em parte: só os dias que faltaram | CLT art. 487 §2º |
| Acordo | aviso indenizado **pela metade** (trabalhado: integral, acréscimo pela metade); projeção pela metade, arredondada para cima (divergente — alerta); multa 20%; saque de 80% e sem seguro-desemprego (alerta) | CLT art. 484-A |
| Culpa recíproca | metade do aviso, do 13º e das férias proporcionais; vencidas integrais; multa 20% | CLT art. 484; Súmula 14; Lei 8.036 art. 18 §2º |
| Rescisão indireta | verbas da dispensa sem justa causa (aviso indenizado) | CLT art. 483 |
| Justa causa | só saldo e férias vencidas + 1/3; a 1ª parcela do 13º paga vira desconto | Lei 4.090 art. 3º; CLT art. 146 par. único; Súmula 171 |
| Falecimento | saldo, 13º, férias; sem aviso e sem multa; dependentes ou sucessores | Lei 6.858/80 |
| 13º | (salário + adicionais + médias) ÷ 12 × avos (mês com ≥ 15 dias, faltas descontadas), do ano do desligamento; linha própria para os avos da **projeção** (inclusive do ano seguinte, se atravessar) | Lei 4.090 art. 1º §2º; Decreto 57.155/65 art. 2º; Súmula 157 |
| Férias vencidas | períodos completos até a data **projetada**; direito do art. 130 − dias **gozados até o desligamento** − abono vendido (programação futura não desconta); **dobro** se o concessivo acabou antes do desligamento (vencendo dentro da projeção: simples + alerta); 1/3 também sobre a dobra; remuneração da rescisão | CLT arts. 130, 137, 146; Súmulas 7 e 328 |
| Férias proporcionais | 1/12 por mês do aquisitivo em curso ou fração ≥ 15 dias, até a data projetada, × direito do art. 130 ÷ 30; + 1/3 | CLT arts. 146 par. único, 147; Súmula 261 |
| Experiência | término no prazo: sem aviso nem multa; antecipada pelo empregador: metade da remuneração dos dias que faltavam, sem FGTS sobre ela, **multa 40%**; pelo empregado: até o mesmo valor, só se houver prejuízo — **informativo, fora do total**. Mais de 90 dias ou desligamento depois do termo = erro (use sem justa causa) | CLT arts. 445, 451, 479, 480; Decreto 99.684/90 art. 14; Súmula 125 |
| Banco de horas | saldo positivo × (salário + adicionais) ÷ divisor (horas semanais × 5; padrão 220) × 1,5 | CLT art. 59 §3º |
| Descontos | total limitado a um mês de remuneração (salário + adicionais) | CLT art. 477 §5º |
| FGTS (fora do total) | 8% × (saldo + aviso indenizado + 13º − 1ª parcela já recolhida + banco de horas); férias indenizadas e art. 479 fora. Multa = 40% (sem justa causa, indireta, art. 479) ou 20% (acordo, culpa) × (saldo informado + mês anterior + 8% da rescisão); sem saldo informado, não estima. Doméstico: sem multa (3,2% mensais) | Súmula 305; OJ 195; Lei 8.036 art. 18; LC 150 art. 22 |
| Prazo | desligamento + 10 dias corridos (inclusive no indenizado), antecipado para dia útil (feriados legais + os do ponto do escritório); vale para o S-2299 e os documentos. Atraso: multa de um **salário base** | CLT art. 477 §6º e §8º; OJ 162 SDI-1 |

Arredondamento: **cada linha em centavos**; totais somam as linhas (no exemplo, R$ 10.822,23;
arredondando só no fim daria R$ 10.822,22).

Alertas (não bloqueiam): estabilidades (gestante, acidente, CIPA, sindical — também na
experiência; Súmula 348), empregado afastado (perigo), data-base (Lei 7.238/84 art. 9º;
Súmulas 182 e 314), justa causa com risco de reversão, rescisão indireta e culpa
recíproca dependem da Justiça, férias programadas dentro do aviso, período vencido sem
nenhuma férias no sistema ("marque como quitado"), sem médias informadas, banco de horas
sem saldo, cláusula assecuratória (art. 481; Súmula 163) e aprendiz (art. 433 §2º).

### Exemplo conferido pelo `contador`

Admissão 10/03/2023, desligamento 20/11/2026 (feriado nacional — para mensalista não muda
o saldo), dispensa sem justa causa, aviso indenizado, salário R$ 2.000,00, sem médias nem
faltas, só o período 10/03/2025–09/03/2026 sem gozo: 3 anos → aviso de 39 dias
R$ 2.600,00, projeção 29/12/2026; saldo 20 dias R$ 1.333,33; 13º 11/12 R$ 1.833,33 +
1/12 da projeção R$ 166,67; férias vencidas simples R$ 2.000,00 + 1/3 R$ 666,67;
proporcionais 10/12 R$ 1.666,67 + 1/3 R$ 555,56; **total bruto R$ 10.822,23**; FGTS da
rescisão 8% × R$ 5.933,33 = R$ 474,67; pagar até 30/11/2026.

### Limites (de propósito)

- Sem INSS, IRRF, pensão, vale-transporte e contribuições: valores **brutos**.
- Médias e adicionais são **informados**, não calculados do ponto ou da folha.
- Saldo do FGTS é **informado** (o sistema não conhece o extrato).
- Não aplica convenção coletiva (aviso maior, adicional de HE acima de 50%, indenizações).
- Não calcula art. 133 (perda de férias por afastamento/licença), reajuste pela data-base,
  estabilidade (só avisa) nem saldo negativo de banco de horas.
- Férias vencidas dependem da programação no sistema: o que foi gozado antes do sistema
  tem de ser marcado como quitado na própria simulação (não fica gravado).

### Para o integrador

- **Sem migração** e sem rota nova: a simulação roda no navegador com os dados que a
  ficha já carrega. Única mudança no servidor: `/api/dp/empregado` devolve também
  `empresa.cnpj` (para o cabeçalho do PDF; a rota já é só da contabilidade).
- Conferir em produção (**conta e escritório de teste**, nunca nas empresas da Edilse):
  ficha de um empregado com admissão e salário → **Simular rescisão**; trocar os tipos e
  ver as linhas mudarem; experiência com mais de 90 dias → erro; **Baixar PDF da
  simulação** → marca d'água "SIMULAÇÃO", aviso no topo e no rodapé, acentos; fechar e
  confirmar que a situação continua a mesma e nada foi gravado.
- Pontos que a contadora deve confirmar (divergentes, segundo o `contador`): projeção do
  aviso no acordo e na culpa recíproca (metade × integral), data de corte da dobra das
  férias (desligamento × projeção) e se o aviso trabalhado pode ser exigido integral.
- Não verificado no navegador (sem banco local além do de produção); regras e PDF cobertos
  por testes, PDF conferido renderizado.

## Para a frente B (resumo do ponto para a folha)

```ts
import { lerEmpregadosParaFolha } from '@/lib/dpServidor';      // Map<nome do ponto, Empregado>
import { jornadaDoEmpregado, temBancoDeHoras } from '@/lib/dp';

const emp = (await lerEmpregadosParaFolha(escritorioId, empresaId)).get(freq.funcionario) ?? null;
const jornada = jornadaDoEmpregado(emp, funcionarioDoPonto, empresa); // utilMin, sabadoMin, trabalhaSabado, horasSemanais, escala, dsr, fonte
const banco = temBancoDeHoras(emp, dataISO);                            // acordo vigente na data?
```

Sem a 0021, o mapa vem vazio: jornada do funcionário/empresa e "sem banco de horas".

## Para o integrador

### 1. Aplicar a 0021

1. `git fetch` e `npx supabase migration list --remote` — confirme 0000–0020 aplicadas e
   **0021 livre**.
2. **Backup** antes (SQL Editor → exportar, ou `pg_dump`) de `ponto_funcionarios`,
   `ponto_frequencias` e `contratos_experiencia` — a migração só **acrescenta** colunas e
   preenche `empregado_id`, mas mexe nessas três tabelas.
3. Aplique (`npx supabase db push --remote`, ou cole o arquivo no SQL Editor). É
   idempotente: rodar de novo não duplica.
4. Ordem com o código: tanto faz. Sem a 0021 a tela `/dp` mostra "aguardando o banco",
   a agenda segue sem os itens do DP e o contrato salva sem ligar. Com a 0021 e o código
   antigo, os gatilhos já vão preenchendo os ids.
5. Reversão (perde só dados do DP):
   ```sql
   drop trigger if exists dp_vincular_funcionario on ponto_funcionarios;
   drop trigger if exists dp_vincular_frequencia on ponto_frequencias;
   alter table ponto_funcionarios drop column if exists empregado_id;
   alter table ponto_frequencias drop column if exists empregado_id;
   alter table contratos_experiencia drop column if exists empregado_id;
   drop table if exists dp_ferias, dp_empregados;
   drop function if exists dp_vincular_funcionario(), dp_vincular_frequencia(), dp_ligar_soltos();
   ```

### 2. Conferir o backfill dos 9 da Vaz & Vouzela (só leitura)

Antes (21/11/2026, conferido em produção só leitura): 9 funcionários, todos da Vaz &
Vouzela, todos com cargo; 183 frequências, **nenhuma com nome sem funcionário**; 2
faltas; **0 contratos de experiência** salvos (então nenhuma admissão vem de contrato).

```sql
select count(*) from dp_empregados;                                          -- 9
select count(*) from ponto_funcionarios where empregado_id is null;          -- 0
select count(*) from ponto_frequencias where empregado_id is null;           -- 0
select count(*) from ponto_frequencias;                                      -- 183 (nada some)
select e.nome, count(q.id) dias from dp_empregados e
  left join ponto_frequencias q on q.empregado_id = e.id group by e.nome order by e.nome;  -- soma 183
select count(*) from dp_empregados where admissao is null;                   -- 9 (a contadora digita)
```

### 3. O que testar em produção (conta de teste, escritório de teste — **nunca** gravar nas empresas da Edilse)

1. **Só leitura na Edilse**: `/dp` → Vaz & Vouzela lista os 9, todos "Sem admissão";
   abrir uma ficha mostra "Ligado a …" na linha Folha de ponto. Não salvar nada.
2. **Conta de teste**: criar empresa de teste; no ponto, cadastrar o funcionário
   "TESTE UM" → ele aparece no `/dp` sozinho (gatilho). Editar: admissão 10/03/2025,
   CPF válido, salário, banco de horas.
3. Ficha → período 10/03/2025–09/03/2026 "A programar", 30 dias. Lançar 6 faltas no
   ponto dentro do período → direito cai para 24.
4. **Programar férias**: escolher uma sexta (DSR domingo) → erro do art. 134 §3º;
   escolher segunda com 10 dias → ok; tentar mais 10 → erro "um período de 14"; 14 → ok.
   Toast **Desfazer** remove; excluir pede confirmação e oferece Desfazer.
5. Baixar **Aviso** e **Recibo** (PDF): acentos, datas, quadro de valores em branco.
6. **Agenda → Visão geral**: seção "Departamento pessoal" com o 13º (1ª parcela 30/11,
   2ª 18/12) e os marcos das férias. Cron com `?dia=` de uma segunda: os mesmos itens no
   resumo, **sem salário nem CPF**.
7. **Contrato de experiência** na empresa de teste com um nome novo → empregado criado
   no DP com admissão, função e salário do contrato; com o nome de um que já existe →
   só preenche o que estava vazio.
8. **Isolamento**: outra conta de teste (outro escritório): `GET /api/dp?empresa=<id da Vaz>`
   → 403; `GET /api/dp/empregado?id=<id de um empregado da Vaz>` → 403;
   `GET /api/dp/documento?ferias=…` → 403. Como **cliente** (empresa): `/dp` volta ao caixa,
   `/api/dp` → 403.
9. Empresa de teste **arquivada**: a ficha abre (consulta), Aviso/Recibo baixam,
   "Programar férias" e "Salvar" falham com a mensagem de arquivada/acesso.

## Revisão do Escudo (21/11/2026)

Veredito: sem caminho para um escritório ler ou gravar empregado/férias de outro, nem
para o `cliente` alcançar o módulo; arquivada só consulta; CPF/salário fora de URL,
e-mail, log e mensagens de erro; gatilhos `SECURITY INVOKER` com `search_path` fixo;
backfill só junta por `empresa_id` (global). Achados e o que foi feito:

| Achado | Severidade | Feito |
|---|---|---|
| Contrato ligava ao 1º homônimo e preenchia CPF/salário na pessoa errada | média | Só liga por nome com homônimo único e CPF compatível |
| Lista devolvia CPF inteiro e salário (máscara só visual) | média | Lista mascara no servidor e omite salário |
| `.or()` do PostgREST montado com o nome (barra invertida quebrava a consulta) | baixa | Trocado por consultas com `.eq()` |
| `dp_ferias.empregado_id` com FK simples | baixa | FK composta `(empregado_id, empresa_id, escritorio_id)` |
| RLS ligada só no fim da migração | baixa | Ligada logo após cada `create table` |
| Faltavam testes de isolamento das rotas | baixa | `tests/dpRotas.test.ts` (outro escritório, cliente, arquivada, validação no servidor) |

Para decidir (dono/jurídico): o termo com o escritório precisa cobrir CPF e salário dos
empregados das empresas clientes (escritório = controlador, ClickContas = operador);
prazo de guarda do cadastro do desligado; registrar quem gerou aviso/recibo (hoje só
`atualizado_por`/`criado_por`). As colunas `empregado_id` de ponto e contratos ficaram
com FK simples (`on delete set null` composto exigiria Postgres 15+ e apagaria a empresa
junto); quem as preenche são os gatilhos, sempre da mesma empresa.

## Como foi testado

- `npm run typecheck`, `npm run lint`, `npm test` e `npm run build` verdes.
- Regras puras com testes (férias, 13º, empregado, agenda derivada, PDF) e o recorte do
  proxy (`tests/dpAcesso.test.ts`).
- Produção **só leitura**: contagem dos funcionários, frequências, faltas e contratos
  para calibrar o backfill (números acima). Nada foi gravado.
- **Não verificado no navegador nem contra a 0021 aplicada**: não há banco local além do
  de produção, e a migração não foi aplicada (por regra). O SQL da 0021 não rodou em
  nenhum Postgres — conferir no SQL Editor (passo 1) é o primeiro teste real.

## Pendências e armadilhas

- **Renomear no ponto** apaga e recria o funcionário (`salvarFuncionarios`): o gatilho
  cria um **empregado novo** com o nome novo; o antigo fica no DP (com o histórico). Hoje
  é preciso juntar à mão. Ideia: no DP, "este é o mesmo que…" (mesclar), ou o cadastro do
  ponto passar a editar pelo id.
- Renomear no DP não renomeia no ponto (a ficha avisa). As frequências continuam ligadas
  pelo id do funcionário.
- **Art. 133** (perdas por afastamento > 6 meses, licença remunerada > 30 dias etc.),
  **férias coletivas** (arts. 139–141), **convenção coletiva** e **menor estudante**
  (art. 136 §2º) não são calculados — pontos levantados pelo `contador`.
- Antecedência do "vencendo" é fixa em 60 dias (o `contador` sugeriu configurável
  60–90); exigiria preferência do escritório.
- Itens do DP na agenda não têm "feito/dispensar" (sugestão do `contador`): o 13º some
  depois do prazo e as férias somem quando programadas.
- Afastamento no 13º é aviso, não cálculo (doença > 15 dias muda os avos).
- Escritório só com DP e sem obrigações na agenda não recebe o resumo por e-mail
  (mesma limitação dos contratos).
- Retenção do dado pessoal (CPF, salário) segue a do resto do sistema — a definir com o
  jurídico.
<<<<<<< HEAD

## Sprint 9 · Frente A — conferência entre módulos

Só alerta (nunca corrige), com link para a tela onde se corrige. Regras puras em
`lib/conferenciaModulos.ts` (`tests/conferenciaModulos.test.ts`); leituras em
`lib/conferenciaModulosServidor.ts`; rotas `GET /api/dp/conferencia?empresa=` (uma empresa,
`exigirEmpresaPonto`) e `GET /api/painel/conferencia` (todas as visíveis, `exigirGestor` +
módulo `ponto`); tela `app/(app)/ConferenciaModulos.tsx` (bloco do `/painel`, lista do `/dp`
e aviso na ficha do empregado, filtrado pelo empregado).

| Regra | Quando alerta |
|---|---|
| Ativo sem admissão | `situacao = ativo` e sem `admissao` (afastado/desligado não) |
| Ponto sem vínculo | há ponto lançado, mas sem admissão no DP **e** sem contrato de experiência (por CPF, senão pelo nome). Ativo sem admissão já aparece na regra acima e não repete |
| Contrato encerrado com ponto | contrato `encerrado` e ponto **trabalhado** (algum horário) depois do término (`dados.termino`; sem ele, vencimento da prorrogação/1º período). **Efetivado não alerta** (segue trabalhando); contrato novo ou admissão posterior ao término anulam |
| Desligado com ponto | `desligado` e ponto trabalhado depois de `situacaoDesde` (no próprio dia não conta) |
| FÉRIAS sem programação | marcador FÉRIAS em dias fora de qualquer `dp_ferias` (início..fim do gozo) do empregado |
| Férias com ponto | dia com horário dentro de férias programadas (o dia marcado FÉRIAS não conta) |

- Janela: ponto dos **3 últimos meses** (`MESES_CONFERIDOS`); só dias lançados.
- Ponto ↔ empregado: pelo vínculo `empregado_id` do ponto; sem ele, pelo nome (se único na empresa).
- **Cada fonte degrada sozinha** (DP, ponto, contratos, férias): a que falhar entra em
  `indisponiveis`, as regras que dependem dela são puladas e a tela diz o que não pôde ler.
  Sem a 0021 as colunas de DP somem e a conferência fica só com o que existe.
- Sem migração. Sem escrita no banco.

### Para o integrador (Frente A, Sprint 9)

- Arquivos novos: `lib/conferenciaModulos.ts`, `lib/conferenciaModulosServidor.ts`,
  `app/api/dp/conferencia/route.ts`, `app/api/painel/conferencia/route.ts`,
  `app/(app)/ConferenciaModulos.tsx`. Tocados: `app/(app)/painel/page.tsx`,
  `app/(app)/dp/page.tsx`, `app/(app)/dp/Ficha.tsx` (só inserem o componente),
  `lib/contratosServidor.ts` (+ `listarContratosDeEmpresas`).
- Testar em produção (só leitura): `/painel` → bloco "Conferência entre módulos"; `/dp` de
  uma empresa real → bloco acima da lista; ficha de empregado com divergência → aviso.
  Conferir a contagem contra o Timesheet. Nunca alterar dados da Edilse para "criar" caso.
- Empresa arquivada passa a responder **409** "Empresa arquivada — reative em Cadastros para
  alterar" a gravações do DP (era 403); ver `docs/multi-escritorio.md`.
=======
- Simulação de rescisão: só simulação; limites e pontos divergentes na seção própria.
  Próximo passo natural: INSS/IRRF e médias de horas extras tiradas do ponto.
>>>>>>> origin/claude/simulacao-rescisao
