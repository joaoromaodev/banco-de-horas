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

## Sprint 5 — Caixa inteligente e fechamento mensal (✅ concluída e publicada em 21/11/2026)

| Frente | Branch | Status |
|---|---|---|
| A. Caixa inteligente: sugestão de conta/analítica que aprende com o que a contadora confere (histórico → frequência nos conferidos → IA opcional); revisão antes da conferência (duplicidade, valor fora do padrão, natureza trocada, pagador/CPF, juros recorrentes, mês sem lançamento, saldo negativo, mudou após confirmar); contabilista/CRC padrão vem do escritório (não mais o nome da Edilse) | `claude/caixa-inteligente-2c9894` | ✅ publicada; 0017 aplicada. Acurácia nos 46 lançamentos reais do NÉLIO: oferece em 70%, acerta 94% quando oferece (sem IA). IA desligada (`CAIXA_IA_SUGESTAO`), nunca em empresa que identifica pagador |
| B. Fechamento mensal: pedidos mensais por empresa abertos no dia 1º pelo cron e fechados quando o documento chega; checklist "X de Y empresas fechadas" no painel (`/api/painel/fechamento`); agenda proposta pelo regime/sinais (um clique, com desfazer); contratos de experiência na agenda e no e-mail | `claude/fechamento-mensal-795cfa` | ✅ publicada; 0018 aplicada |

Produção: migrações 0000–0018; próximo número livre **0019**. Backup antes:
`backup-antes-0017-0018-2026-11-21.json`. Teste de ponta a ponta com conta de teste
(sugestão 0,82 de confiança com 4 conferidos, duplicidade apontada, pedido mensal,
proposta da agenda, checklist, 403 em 12 rotas das empresas da Edilse); conta apagada,
contagens iguais às do backup.

## Sprint 6 — Configurações e desempenho (✅ concluída e publicada em 21/11/2026)

| Frente | Branch | Status |
|---|---|---|
| A. Tela **Escritório** (`/escritorio`): dados (CNPJ validado), responsável técnico (padrão dos dados fiscais; "aplicar às empresas sem contabilista" com desfazer), prazo padrão dos pedidos mensais, atalho da equipe | `claude/config-escritorio-a08c39` | ✅ publicada; 0019 aplicada |
| B. Desempenho: paginação única contra o corte de 1.000 linhas do Supabase (livro, saldo, painel, ponto…), N+1 do fechamento (−69%), leituras em paralelo, índices | `claude/desempenho-d007b5` | ✅ publicada; 0020 aplicada. Números em `docs/desempenho.md` |
| Integração: **funções da Vercel em São Paulo** (`regions: ["gru1"]`), junto do banco (`sa-east-1`) — antes rodavam nos EUA e cada consulta cruzava o continente | — | ✅ conferido pelo cabeçalho `x-vercel-id` (`gru1::gru1`) |

Produção: migrações 0000–0020; próximo número livre **0021**. Backup antes:
`backup-antes-0019-0020-2026-11-21.json`. Teste com conta de teste (CNPJ inválido
recusado, responsável aplicado só à empresa de teste, escritório e empresas da Edilse
intactos); conta apagada.

## Sprint 7 — Revisão do ponto e arquivadas (✅ concluída e publicada em 21/11/2026)

| Frente | Branch | Status |
|---|---|---|
| A. Revisão inteligente da Folha de Ponto: regras da CLT explicáveis (jornada acima de 8h+2h, intervalo intrajornada, interjornada de 11h, semana acima de 44h, domingo/feriado, marcações faltando, horário ilegível, dias copiados), selo por dia, resumo por funcionário, filtro e lista por risco; só alerta | `claude/revisao-ponto-853f4d` | ✅ publicada, sem migração. Nos 183 dias reais: 9 achados, todos concretos (`12>54`, 10h13 numa jornada, 3 dias sem intervalo, 1 intervalo de 30 min, 2 faltas) |
| B. Empresa arquivada consultável sem reativar (caixa, livro, ponto, contratos, documentos; escrita barrada); pedido mensal sem dia usa o prazo do escritório; desempenho medido de novo com as funções em São Paulo | `claude/arquivadas-acabamentos-632774` | ✅ publicada, sem migração |

Produção: migrações 0000–0020 (0021 e 0022 não foram usadas; próximo número livre
**0021**). Testes: revisão do ponto nos dados reais da Edilse (só leitura) e arquivada
com conta de teste (consulta e livro ok; gravação barrada); conta apagada.

## Sprint 8 — Departamento Pessoal e relatórios (✅ concluída e publicada em 21/11/2026)

| Frente | Branch | Status |
|---|---|---|
| A. Departamento Pessoal (`/dp`): cadastro único do empregado (ponto e contratos ligados por id), férias (aquisitivo/concessivo, faltas do art. 130, fracionamento, 2 dias antes de feriado/DSR, aviso e recibo em PDF, vencidas em dobro) e 13º (avos, 30/11 e 20/12) na agenda e no e-mail | `claude/departamento-pessoal-1a4640` | ✅ publicada; 0021 aplicada. Backfill: 9 empregados criados a partir do ponto, 183 frequências ligadas por id, nenhuma marcação alterada. **Falta a contadora digitar a admissão dos 9** |
| B. Resumo do ponto para a folha: extras 50%/100%, adicional noturno com hora reduzida, faltas com DSR, atestados, atrasos; só horas; xlsx e CSV; carimbo "conferido" | `claude/resumo-folha-b496c0` | ✅ publicada; 0022 aplicada. Na integração, ligado ao acordo de banco de horas do cadastro do DP |
| C. Caixa para o cliente: alerta de limite de faturamento (MEI/Simples, 80/100/120%, "estimativa pelo caixa") e Demonstrativo de caixa mensal com prévia e envio liberado pela contadora (visível ao cliente) | `claude/caixa-cliente-55c77c` | ✅ publicada; 0023 aplicada. O alerta só aparece quando o regime da empresa está informado |

Produção: migrações 0000–0023; próximo número livre **0024**. Backup antes:
`backup-antes-0021-0023-2026-11-21.json`. Testes: leituras com os dados reais
(DP da Vaz, resumo de outubro, limite e demonstrativo do NÉLIO) e escrita com conta de
teste (empregado, férias, agenda); conta apagada.

## Sprint 9 — Conferência entre módulos e rescisão (✅ concluída e publicada em 21/11/2026)

| Frente | Branch | Status |
|---|---|---|
| A. Conferência entre módulos (ativo sem admissão, ponto sem vínculo, contrato encerrado com ponto, desligado com ponto, FÉRIAS sem programação, férias com ponto) no painel e no DP; 409 claro ao gravar em empresa arquivada; jornada única (revisão, planilha e resumo usam `jornadaDoEmpregado`) | `claude/conferencia-modulos` | ✅ publicada, sem migração. Nos dados reais: aponta os 9 empregados sem admissão |
| B. Simulação de rescisão (9 tipos; aviso proporcional com projeção; 13º e férias; experiência arts. 479/480; FGTS como estimativa sobre saldo informado; prazos do art. 477), memória de cálculo com fonte legal por linha e PDF marcado "SIMULAÇÃO"; valores brutos | `claude/simulacao-rescisao` | ✅ publicada, sem migração. Exemplo conferido com o `contador`: R$ 10.822,23. Três pontos sem consenso para a Edilse decidir (ver `docs/departamento-pessoal.md`) |

## Sprint 10 — Ponto pelo cliente e agilidade (✅ concluída e publicada em 21/11/2026)

| Frente | Branch | Status |
|---|---|---|
| A. Folha de ponto enviada pelo cliente (`/enviar-ponto`): foto pelo celular → bucket privado `ponto` → leitura pela IA em fila (cota do escritório) → rascunho → a contadora confere ao lado da foto e aplica (com desfazer) ou devolve com motivo; o cliente acompanha o status | `claude/ponto-cliente-c3e04b` | ✅ publicada; 0028 aplicada. Na integração: avisos no sino (folha recebida, lida, falhou), sem nome de funcionário |
| B. Edição em lote e importação por planilha no DP (com desfazer); sino de notificações no app; `/ponto?empresa=&ano=&mes=` | `claude/agilidade-1dcfee` | ✅ publicada; 0027 aplicada |

Produção: migrações 0000–0029 (0024–0026 não usadas); próximo número livre **0030**.
Teste de ponta a ponta da folha pelo cliente com conta de teste: envio, foto no bucket,
leitura ("lida"), fila da contadora, 2 avisos no sino, cliente barrado na empresa da
Edilse e na Timesheet; conta, foto e dados apagados.

## Sprint 11 — Cliente, rescisão completa e QA visual (✅ concluída e publicada em 21/11/2026)

| Frente | Branch | Status |
|---|---|---|
| A. Página inicial do cliente (`/inicio`): movimento a lançar, pedidos da contabilidade, folhas devolvidas e último Demonstrativo; cada bloco falha sozinho; vira a home do cliente | `claude/inicio-cliente` | ✅ publicada em 21/11, sem migração |
| B. Rescisão completa: INSS/IRRF, médias de horas extras do ponto, valores líquidos | `claude/rescisao-completa` | ✅ publicada em 21/11, sem migração; rota `/api/dp/medias`. Tabelas em `lib/tabelasTributos.ts` (INSS 2025/2026, IRRF Lei 15.191 + redução Lei 15.270). Exemplo conferido com o `contador`: bruto R$ 34.795,76, líquido R$ 33.202,49 |
| C. Pente-fino visual no navegador: 5 defeitos corrigidos (rolagem horizontal no celular, checkboxes do fechamento, fila do ponto repetida, data do DP em lote, rótulo "(Sheets)"); relatório em `docs/qa-visual.md` | `claude/pente-fino-visual-20f3c4` | ✅ publicada em 21/11 |

Publicação de A + C: 930 testes; de B: 980 testes, CI e Vercel verdes, `/api/dp/medias` responde 401 sem sessão. A + C, CI e Vercel verdes; em produção `/inicio` exige login e
`/api/inicio-cliente` responde 401 sem sessão.

## Sprint 12 — IA lendo documentos e acabamentos (✅ concluída e publicada em 21/11/2026)

| Frente | Branch | Status |
|---|---|---|
| A. Documento → lançamento sugerido por IA, atrás de chave desligada (plataforma + empresa) | `claude/documento-lancamento` | ✅ publicada **desligada**; 0029 aplicada (backup `backup-antes-0029-2026-11-21.json`). Escudo: aprovado com ressalvas (corrigidas; 3 menores no doc). Para ligar: privacidade citando a IA do caixa, Gemini pago (`GEMINI_API_KEY_CAIXA`), aceite da Edilse, depois `CAIXA_IA_DOCUMENTO=ligada` e opção por empresa |
| B. Acabamentos das ressalvas do QA visual | `claude/acabamentos-qa` | ✅ publicada em 21/11 (KPIs lado a lado no celular, Demonstrativo abre no último mês confirmado — `mesInicial`, contratos em duas linhas, gráfico do resumo em 12 px). Falta: gráfico do Demonstrativo no celular |
| C. Teste logado em produção de `/inicio` e da rescisão (conta de teste, só relatório) | — | ✅ feito em 21/11: tudo passou (isolamento do cliente em 12 telas e 8 APIs, rescisão conferida à mão com R$ 3.000 e R$ 9.000, PDF "SIMULAÇÃO"); contagens iguais antes e depois. Corrigido na main: menu da contadora piscava para o cliente |

## Sprint 13 — Avisos ao cliente e acabamentos de IA (✅ concluída e publicada em 21/11/2026)

| Frente | Branch | Status |
|---|---|---|
| A. Sino do cliente: folha devolvida, pedido da contabilidade, Demonstrativo pronto | `claude/avisos-cliente` | ✅ publicada, sem migração. Avisos montados do que já existe (não gravados); "lido" do cliente separado. Escudo: pode publicar. E-mail ao cliente só com `RESEND_API_KEY` + `AVISOS_CLIENTE_EMAIL=ligado` + `APP_URL` — **desligado**, decisão futura |
| B. Foto girada antes da IA, limite do cliente só com leituras dele, gráfico do Demonstrativo no celular | `claude/acabamentos-ia` | ✅ publicada, sem migração (teste logado em produção passou: 3 avisos, links, "lido", isolamento, foto com EXIF 6 lida certa; contagens iguais). `lib/fotoParaIa.ts` (sharp) põe a foto em pé e tira o EXIF também na folha de ponto (que subia crua); subcota do cliente só com leituras dele, corrida fechada; gráfico do Demonstrativo a 12 px |

## Sprint 14 — Confiabilidade (✅ concluída e publicada em 21/11/2026)

| Frente | Branch | Status |
|---|---|---|
| A. Nada falha calado (pedidos mensais sem depender do cron, `error.tsx`, erros visíveis, painel do que está desligado) | `claude/nada-falha-calado` | ✅ publicada; 0030 aplicada (backup `backup-antes-0030-2026-11-21.json`). Pedidos do mês abertos na 1ª visita a `/painel`/`/inicio` (idempotente pelo índice da 0018); limpeza de fotos oportunista (50/dia); `error.tsx`; `FalhaCarregamento` em 17 telas; "O que está desligado" em `/configuracoes` |
| B. Testes de guarda em todas as rotas e de rota nos fluxos críticos | `claude/testes-rotas` | ✅ publicada. 68 rotas / 119 handlers, todas com guarda; CI quebra rota nova sem guarda; fluxos do caixa e da folha do cliente testados com guardas reais. Pendente: `GET /api/envio-ponto` dá 403 em empresa arquivada (guarda de `documentos/comum` usa só ativas) |

Sprint 15 (prevista): medição própria de desempenho e erros, sem dado pessoal; lint subiu de 32 para 45 avisos (`set-state-in-effect`) — limpar.

## Sprint 15 — Medir por dentro e arrumar a casa (✅ concluída e publicada em 21/11/2026)

| Frente | Branch | Status |
|---|---|---|
| A. Medição própria: tempo de páginas e rotas e erros, sem dado pessoal, resumo para o master | `claude/medicao` | ✅ publicada; 0031 aplicada (tabela nova `medicoes`, 30 dias). Amostra de 25% + todos os erros; tempo das rotas é o sentido no navegador (inclui rede); rotas normalizadas, sem dado pessoal (Escudo: pode publicar). Seção "Como o app está respondendo" em `/configuracoes`; privacidade cita a medição técnica. Lint: 0 avisos |
| B. Arrumar a casa: avisos do lint (45 → 0 onde der), consulta de envios em empresa arquivada | `claude/arrumar-casa` | ✅ publicada em 21/11. Lint 45 → 2 avisos (os 2 em `/configuracoes`, da frente A). **Corrigido:** cliente de empresa arquivada baixava documentos por `/api/documentos/arquivo` (sem guarda de empresa). O 403 de envios em arquivada era só do cadastro falso dos testes |

## Sprint 16 — Cliente no celular (✅ concluída e publicada em 22/11/2026)

| Frente | Branch | Status |
|---|---|---|
| A. Acessibilidade e celular nas telas do cliente (`/inicio`, `/caixa`, `/documentos`, `/enviar-ponto`) | `claude/acessibilidade-cliente` | ✅ publicada, sem migração. Toque de 44 px no celular, erro no próprio campo, rótulos simples, foco do menu e do sino; corrigido: sino pedia notificações sem parar com o painel aberto. Teste estático de nome acessível e contraste. Pendente: editar lançamento e lista de documentos no celular em cartões |
| ~~B. Implantação guiada~~ | — | ❌ cancelada em 22/11: o João pediu foco em produto, sem implantação/venda (ver `decisoes.md`) |

## Sprint 17 — Planejada a partir dos concorrentes (`concorrentes.md`)

Tudo sem serviço pago. Começa quando a Sprint 16 A for integrada (mexe nas mesmas telas).

| Frente | Por quê |
|---|---|
| A. Envio do escritório → cliente com registro de leitura (guia, DAS, holerite; "lido em…"; quem não abriu perto do vencimento) | motivo nº 1 de o cliente abrir o portal em todos os concorrentes |
| B. Situação por documento (recebido/aceito/devolvido com motivo), "Não tenho este mês" e lembrete antes do prazo | tira o "chegou? serviu?" do WhatsApp |
| C. Leitor de XML de NF-e/NFS-e e de PDF/boleto **sem IA** → lançamento pronto, nota duplicada apontada | "documento → lançamento" exato, de graça, sem Gemini |
| D. Extrato OFX/CSV no caixa: linha vira sugestão, diferenças banco × caixa, confirmação em lote | corta a digitação mais repetitiva |
| E. Mês fechado que trava + aceite do cliente no resumo do ponto | o número que foi para a folha não muda depois |
| F. Troca do Gemini gratuito pela Cloudflare Workers AI (comparativo em folhas antes) | `ia-gratuita.md`; depende de o João criar a conta gratuita da Cloudflare |

Achado: desde a IN RFB 2.240/2024 o recibo de saúde sai no Receita Saúde e vai direto ao
Carnê-Leão Web — a frente Carnê-Leão deve **conferir** esses recibos contra o caixa, não emitir.

## Próximas frentes (backlog priorizado)

| Frente | Modelo | Depende de |
|---|---|---|
| Carnê-Leão e recibos (PF) | Opus alto | respostas da Edilse (beneficiário ≠ pagador; layout do Carnê-Leão Web) |
| Ver no painel de logs da Vercel a duração das funções depois de uso real (ganho da região) | João/dono | acesso à Vercel |

## Antes de ir ao mercado (adiado por decisão do João)

Só o João consegue:
- [ ] Vercel → `CRON_SECRET` (o aviso da agenda precisa disto **já**, mesmo sem venda);
      `RESEND_API_KEY` + `EMAIL_REMETENTE`; mais tarde `ASAAS_*`. Conferir `GEMINI_API_KEY`.
- [ ] **`MASTER_PASSWORD` forte na Vercel (≥ 12 caracteres, não `admin1234`)**: desde 21/11 o
      login de administrador fica desligado em produção com senha ausente ou fraca.
- [ ] Gemini no nível pago (no gratuito o Google pode usar as fotos das folhas). Também
      destrava a IA que lê documentos do caixa (Sprint 12 A).
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
- [ ] Rescisão: confirmar redução da Lei 15.270 no 13º; 13º sem desconto simplificado;
      mês sem ponto entra com zero na média; regra dos 15 dias no aquisitivo; data-base e
      piso da categoria; salário pago no mês seguinte (ver `docs/departamento-pessoal.md`).
- [ ] Reclassificar, se for o caso, os 15 lançamentos de material de expediente.

## Feito

- Livro Caixa fases 1–6, Folha de Ponto, Contrato de Experiência, nova identidade
  visual e design system (até `5cc9b75`).
