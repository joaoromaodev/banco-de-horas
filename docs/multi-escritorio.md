# Multi-escritório (Sprint 1 · Frente A)

> O inquilino do SaaS é o **escritório contábil**. Toda empresa e todo usuário
> (menos o `master`) pertencem a um escritório, e é por ele que se decide quem vê o quê.

## Decisões

| Tema | Decisão |
|---|---|
| Inquilino | Tabela `escritorios` (id, nome, cnpj, plano, `teste_ate`, `situacao`, criado_em). RLS ligada sem policies, como o resto. |
| Vínculo | `usuarios.escritorio_id` e `empresas.escritorio_id` (FK `on delete restrict`). `master` fica sem escritório: é o administrador da **plataforma** e vê tudo. |
| Visibilidade | Regras puras em `lib/visibilidade.ts` (`empresaVisivel`, `gerenciaUsuario`, `papeisQueCria`, `avisoTeste`); `lib/acesso.ts` as aplica com sessão e I/O. `usuario` vê **todas** as empresas do escritório (o escritório é a unidade, não mais o contador); `cliente` vê só a vinculada e só se for do escritório dele. |
| Regra transitória | **Removida.** "Empresa sem dono é visível a todos" deixou de existir. Empresa sem escritório só o master vê (falha fechada). |
| Colunas antigas | `empresas.contador` e `usuarios.dono` ficam, mas viram **informação** (responsável / quem cadastrou), não visibilidade. |
| Administrador do escritório | Flag `usuarios.admin_escritorio`. Quem cria a conta em `/criar-conta` é admin; quando o master cadastra o primeiro contador de um escritório, ele vira admin. O admin cadastra contadores (tela **Equipe**, `/equipe`) e clientes; o contador comum só clientes (tela **Cadastro**). Ninguém gerencia a si mesmo por essa via. |
| Módulos do convidado | O admin só libera módulos que ele mesmo tem. |
| Sessão | `escritorioId` e `adminEscritorio` entram no cookie no login. **Sessões antigas** (emitidas antes do deploy, até 12 h) não têm o campo: `sessaoDe` completa do banco com cache de 60 s — a Edilce e o NÉLIO não caem. |
| Login | Contador/cliente sem escritório é barrado com mensagem clara (só acontece se a migração não rodou). |
| Cadastro self-service | `/criar-conta` + `POST /api/criar-conta` (públicos no `proxy.ts`). Cria escritório em teste (14 dias, defaults da tabela) + usuário admin com `caixa` e `ponto`, e já devolve o cookie. E-mail único (checagem + INSERT que dá 409 em corrida, nunca upsert), senha ≥ 8, rate-limit de 5 tentativas / 30 min por IP em memória (`lib/limite.ts` — por instância na Vercel; suficiente por ora). Erros do banco não vazam na resposta. |
| Senha mínima | 8 caracteres para senha nova em todo lugar (`SENHA_MIN` em `lib/auth.ts`). Senhas antigas continuam valendo. |
| Aviso de teste | Faixa discreta no topo do layout para o contador quando faltam ≤ 3 dias ou o teste acabou. Não bloqueia nada (bloqueio vem com a cobrança, Sprint 2). |
| Excluir usuário | Confirmação + **Desfazer** (Equipe, Cadastro e Configurações). O DELETE devolve uma ficha AES-GCM com o registro (válida 30 min); o POST `{ restaurar }` recria o usuário com a mesma senha. Sem estado no servidor. |
| Empresas | `POST /api/empresas` grava só no escritório da sessão e remove só dentro dele. Id enviado que pertence a outro escritório → 403 (antes um upsert podia "roubar" a empresa). O master grava preservando o escritório de cada uma; empresa nova sem escritório ele não cria. |
| Folha de Ponto | Continua no Google Sheets (migra na Sprint 2). As rotas de ponto agora checam `podeAcessarEmpresa` (`/api/folha`, `/folha-lote`, `/gerar`, `/gerar-lote`, `/salvar`, `/extrair`, `/funcionarios`); `GET /api/funcionarios` sem empresa filtra pelas empresas visíveis. **Feriados são globais** (a lista de Belém): ler é livre, gravar só master e o escritório fundador. |

## Migração `supabase/migrations/0010_escritorios.sql`

**Aplicada em produção em 21/11/2026**, com backup prévio de `usuarios` e `empresas`.
Antes de aplicar, o dono mudou o backfill para **falha fechada**: só entram no
escritório da Edilse os clientes e os contadores donos de alguma empresa. Havia uma
contadora (Bianca Ramos) sem nenhuma empresa — pela versão original ela passaria a
ver todas as da Edilse; ficou com um escritório próprio, em teste. Se ela for da
equipe da Edilse, mova por SQL (`update usuarios set escritorio_id = '00000000-0000-4000-8000-000000000001', admin_escritorio = false where ...`).
Resultado conferido: 3 empresas e o login da Adriana (Vaz & Vouzela) no escritório
da Edilse; ela é admin. Teste em produção pelo dev local: conta nova não vê nada e
leva 403 ao tentar ler ou sobrescrever a empresa do NÉLIO (conta de teste apagada depois).

Texto original da seção, para referência: O que faz: cria `escritorios`, adiciona
`escritorio_id` (anulável) em `usuarios` e `empresas` e `admin_escritorio` em
`usuarios`, cria o escritório da Edilce com id fixo
`00000000-0000-4000-8000-000000000001` (`ESCRITORIO_FUNDADOR_ID`, plano
`fundador`, situação `ativo`) e pendura nele **todos** os usuários não-master e
**todas** as empresas. Contadores existentes viram admins do escritório. É
idempotente (pode rodar de novo sem duplicar).

É compatível com o código **antigo** (nada que ele grava passa a falhar), mas o
código **novo** depende dela. Por isso a ordem importa.

### Passo a passo (com o OK do João)

1. `git fetch` e `npx supabase migration list --remote` — confirme que `0010`
   continua livre (já houve colisão). Hoje a última aplicada é `0009`.
2. No SQL Editor do Supabase, confira quem vai para o escritório da Edilce:
   ```sql
   select email, nome, role, empresa, dono from usuarios order by role, email;
   select id, nome, contador from empresas order by ordem;
   ```
   Se houver conta de teste de outro contador, decida antes (remover, ou mover
   depois para outro escritório pelo SQL).
3. Aplique: `npx supabase db push` (ou cole o arquivo no SQL Editor).
4. Confira: `select count(*) from empresas where escritorio_id is null;` e o
   mesmo em `usuarios where role <> 'master'` → ambos `0`.
5. Publique o código desta branch **logo em seguida**. Entre a migração e o
   deploy, o código antigo segue funcionando; empresa criada nesse intervalo
   nasce sem escritório (rode de novo o `update empresas ...` do backfill).
6. Depois do deploy, numa migração futura: `alter table empresas alter column
   escritorio_id set not null;` (de propósito fora da 0010, para não quebrar o
   código antigo no intervalo).

## Excluir empresa = arquivar (Sprint 4, migração `0016`)

Problema: excluir empresa com dados dava erro cru do Postgres (ponto, FK `restrict`),
**apagava em cascata a agenda** e deixava órfãos caixa, contratos, documentos e
pendências (sem FK). Decisão (com o subagente `contador`): **a tela nunca apaga** —
**arquiva**. Contabilidade tem dever de guarda (fiscal 5 anos; trabalhista, mais).

- `empresas.arquivada_em/_por/_motivo` (migração `0016_empresas_arquivamento.sql`, aditiva).
- `lerEmpresas()`/`lerEmpresa()` **escondem** arquivadas → somem de listas, seletores,
  painel, agenda, cron e das guardas (`podeAcessarEmpresa`: 403, exceto master).
  `lerEmpresasComArquivadas()` só para checar dono/reativar.
- `salvarEmpresas` **não remove mais nada**; arquivar/reativar é `PATCH /api/empresas`
  `{ id, acao: 'arquivar'|'reativar' }` (contador: só do escritório; outro escritório = 404).
- Reativar volta a contar no limite do plano (`podeReativar`, 402); só ativas contam.
- Login do `cliente` de empresa arquivada é barrado ("fale com a sua contabilidade");
  o usuário não é apagado. Sessão já aberta perde acesso nas rotas (guardas).
- Tela Cadastro: confirmação "Arquivar" + toast **Desfazer**; seção "Empresas arquivadas" com Reativar.
- Exclusão definitiva: **só por SQL do master**, após o prazo de guarda.

### Para o integrador (arquivamento)
- Aplicar `0016` **antes** de publicar o código (sem a coluna, `lerEmpresas` falha).
- Testar em produção sem alterar dados reais: abrir Cadastro (nenhuma arquivada,
  seção não aparece); `GET /api/empresas?arquivadas=1` → `[]`. Teste de ponta a ponta
  de arquivar/reativar só com empresa de teste de um escritório de teste.
- Pendências: prazo de guarda a confirmar (5/10 anos);
  CNPJ duplicado não é validado ainda; script de exclusão definitiva não existe.

### Consultar arquivada sem reativar (Sprint 7, sem migração)

A contadora abre a empresa arquivada em **somente leitura**: em Cadastro → "Empresas
arquivadas" há os botões *Livro caixa*, *Ponto*, *Contratos*, *Documentos* (links
`/<módulo>?empresa=<id>`). A tela mostra a faixa **"Empresa arquivada em DD/MM/AAAA —
somente consulta"** com **Reativar**. Consulta, PDF/.xlsx do livro, `.xlsx` do ponto e
documentos funcionam; escrita não.

- **Guarda central** (`lib/arquivamento.ts` + `lib/acesso.ts`):
  - `sessaoDe(req)` marca a sessão (só em memória) com `escrita` quando o método/caminho
    grava dados (`ehEscritaDeDados`: tudo que não é GET/HEAD, menos exportações por POST
    como `/api/gerar` e `/api/contratos/documento`, e menos `/api/empresas`,
    login/logout/cobrança, que têm regra própria).
  - `podeAcessarEmpresa` agora enxerga arquivadas: **leitura** → contador do mesmo
    escritório e master; **escrita** → sempre negada (inclusive master); `cliente` de
    arquivada → sempre negado; arquivada de outro escritório → negada.
  - `proxy.ts`: escrita que cita a empresa (`?empresa=`, corpo JSON `empresa`,
    `empresaId`, `empresas[]`, `frequencia.empresa`) arquivada → **409** com
    `codigo: 'empresa_arquivada'` e mensagem clara. Rotas que só descobrem a empresa pelo
    id do registro (editar/excluir lançamento, contrato, pedido) caem na rede de
    segurança de `podeAcessarEmpresa` (403 "Acesso restrito a esta empresa.").
  - `POST /api/empresas` com id de arquivada → 409.
- `lerEmpresa(id)` passou a devolver arquivada também (`lerEmpresas()` continua só com
  ativas). **Regra para rota nova que grave:** chame `podeAcessarEmpresa(g.sessao, id)`
  *depois* de `exigirGestor/exigirEmpresa(req)` (é o que dá o `escrita`); não use
  `lerEmpresa` para decidir acesso.
- Continuam de fora de listas, painel, agenda, cron, fechamento e contagem do plano
  (todos usam `lerEmpresas`/`empresasVisiveis`). O login do `cliente` segue barrado.
- Testes: `tests/arquivadasConsulta.test.ts` (regras, guarda, proxy 409).

### Para o integrador (consulta de arquivadas)
- **Sem migração.** Publicar o código; nada a aplicar.
- Em produção, com conta de **teste** (escritório de teste; nunca as empresas da
  Edilse): criar empresa de teste, lançar 1 item no caixa, arquivar; em Cadastro →
  Consultar → Livro caixa: faixa aparece, livro .xlsx baixa, "Lançar" falha com a
  mensagem de arquivada (409); `DELETE /api/caixa/lancamentos?id=…` → 403; Reativar na
  faixa volta ao normal. Entrar como cliente da empresa arquivada → barrado no login.
- Conferir que a arquivada **não** aparece no painel, na agenda nem no seletor das telas.
- Pendente: as telas não escondem os botões de gravar (a barreira é do servidor; o
  clique mostra o erro).

## Como foi testado

- `npm run build` passa. `npm run lint`: os únicos erros são dívida anterior
  (`set-state-in-effect`, `no-explicit-any` em arquivos antigos, que a Frente C
  rebaixa a aviso); nenhum erro novo desta frente.
- Regras puras (`lib/visibilidade.ts`, `lib/limite.ts`): 9 testes com
  `node --test` (escritório A × B, sessão sem escritório, empresa órfã, cliente,
  gestão de usuários, aviso de teste, limitador). Prontos para virar Vitest quando
  a Frente C entrar.
- **Ponta a ponta, contra Postgres 16 + PostgREST locais em Docker** (nunca contra
  produção): migrações 0000–0010 aplicadas sobre um estado "legado" (Edilce,
  NÉLIO, master no banco, empresas com e sem `contador`); backfill conferido e
  reaplicado (idempotente). No dev server: criar conta → já logado → Cadastro
  vazio (não vê as 3 empresas da Edilce); empresa nova no escritório B; tentativas
  de B sobre a empresa do NÉLIO (sobrescrever no cadastro, caixa, contratos,
  folha, funcionários, criar cliente nela) → 403/400; sequestro do e-mail da
  Edilce → 409; criar master → 403; apagar a Edilce → 403; feriados → 403.
  Equipe: admin adiciona contador, remove e desfaz (o contador volta e loga com a
  senha original); contador não-admin não cria contador. Edilce vê só as 3 dela;
  NÉLIO só a dele; master vê todas. Sessão antiga sem `escritorioId` é completada
  do banco. Rate-limit responde 429. Aviso de teste com 2 dias e vencido.
  `/criar-conta` em 375 px.
- **Sem teste:** o banco real do Supabase (a migração não foi aplicada lá) e a
  Folha de Ponto com o Google Sheets real (o ambiente local não tinha Sheets).

## Pendências e armadilhas

- ~~Catálogo do Livro Caixa é global.~~ Resolvido na migração `0013` (Sprint 2,
  Frente C): `escritorio_id` anulável em `plano_contas` e `historicos_padrao` —
  nulo = base da plataforma, preenchido = extensão do escritório. Ver
  [`livro-caixa.md`](livro-caixa.md), "Catálogo por escritório (0013)".
- ~~Feriados globais~~ — por escritório desde a Sprint 2 (`docs/folha-de-ponto.md`).
- ~~Chave do Gemini da instalação~~ — da plataforma (`GEMINI_API_KEY`) desde a Sprint 2.
- **Rate-limit por instância** (memória). Se o cadastro virar alvo, mover para
  o Postgres.
- O aviso de teste ainda não tem link para `/planos` (página da Frente B) — pôr
  quando as branches se juntarem.
- Mover usuário/empresa entre escritórios só por SQL; não há tela.

## Configurações do escritório (Sprint 6, Frente A — migração 0019)

Tela **Escritório** (`/escritorio`, item no menu de todo `usuario`). O administrador
do escritório edita; os demais contadores só consultam; o `cliente` não alcança
(fora de `CLIENTE_PODE` em `proxy.ts`). Regras puras (CNPJ, CRC, prazo, quem pode)
em `lib/escritorioConfig.ts`; banco em `lib/escritorioServidor.ts`.

- **Dados:** nome (obrigatório) e CNPJ (opcional, validado pelos dígitos; guardado só
  com números).
- **Responsável técnico:** `escritorios.contabilista_nome/_crc` (0017). É o padrão
  das empresas **sem** contabilista — a leitura (`lerFiscal`) já cai nele. O botão
  "Gravar nas empresas sem contabilista" (`POST /api/escritorio/responsavel`) escreve
  o nome em `empresa_fiscal` só onde o campo está em branco ou não há linha; quem já
  tem não é tocado. Pede confirmação e oferece **Desfazer** (`PATCH`), que só volta
  as empresas que ainda estão com o nome aplicado (edição feita no meio tempo
  fica) e só as do próprio escritório.
- **Prazo padrão dos pedidos mensais:** `escritorios.prazo_pedidos_padrao` (1–28,
  padrão 10 = o valor que era fixo). A tela "Pedidos mensais" usa como valor inicial
  dos campos de dia (onde antes havia 10 fixo). Não altera pedidos já criados: cada
  um guarda o seu `dia_prazo`.
- **Aviso da agenda por e-mail:** a tela reaproveita `/api/agenda/avisos` e
  `agenda_avisos` (ver `agenda.md`); nada novo no banco.
- **Rotas:** `GET/PATCH /api/escritorio` (leitura: contador do escritório, master com
  `?escritorio=`; gravação: `exigirAdminEscritorio`, sempre no escritório da
  sessão — o corpo não escolhe qual escritório). O master só lê.

### Para o integrador

1. **Migração `0019_escritorio_preferencias.sql`** — aditiva (uma coluna com default
   10). Aplicar antes ou depois de publicar: sem ela a tela abre e usa 10; salvar
   responde "falta aplicar a migração 0019" (503) em vez de quebrar.
2. **Testar em produção com conta de teste (nunca no escritório da Edilse):**
   - admin de um escritório de teste abre `/escritorio`, salva nome/CNPJ/CRC/prazo;
     CNPJ inválido e prazo 29 são recusados;
   - contador não-admin vê tudo desabilitado; `PATCH /api/escritorio` com ele → 403;
   - cliente (empresa) em `/escritorio` → volta para o caixa; `/api/escritorio` → 403;
   - com 2 empresas de teste (uma com contabilista, uma sem), "Gravar nas empresas sem
     contabilista" muda só a sem; "Desfazer" a devolve em branco;
   - em Pedidos mensais, o campo de dia novo vem com o prazo salvo;
   - ligar/desligar o resumo da agenda e trocar destinatários reflete em `agenda_avisos`.
3. Sem variável de ambiente nova.

## Sprint 9 · Frente A — gravar em empresa arquivada (409)

`podeAcessarEmpresa` continua devolvendo true/false, mas agora é só o veredito de
`motivoNegado(sessao, empresaId)` (`lib/acesso.ts`), que devolve o **motivo**:
`null` (pode), `{ status: 409, codigo: 'empresa_arquivada' }` (contabilidade **gravando** em
arquivada do próprio escritório: "Empresa arquivada — reative em Cadastros para alterar") ou
`{ status: 403 }` (todo o resto). A visibilidade é conferida antes: quem não enxerga a empresa
(outro escritório, outro cliente) recebe 403 genérico e não descobre que ela existe. O cliente
de empresa arquivada segue 403. Nada foi afrouxado: o conjunto de negados é o mesmo.

Usam o motivo: `exigirEmpresa`, `exigirEmpresaPonto` (ponto, DP, folha, resumo…), as rotas do
caixa (lançamentos, contas, exercício, fiscal, histórico, livro, meses, revisão, sugestão),
agenda, contratos, pedidos mensais e, por id de registro, documentos e pendências (antes
**essas duas não barravam** escrita por id em arquivada; agora barram). `MENSAGEM_ARQUIVADA`
(proxy e `/api/empresas`) ganhou o mesmo texto. Rotas novas: use `exigirEmpresa*`,
`respostaNegadaEmpresa(s, id)` ou `motivoNegado(s, id)` — não monte o 403 à mão.

### Para o integrador (Frente A, Sprint 9)

- Testes: `tests/arquivadaMotivo.test.ts`; `tests/dpRotas.test.ts` agora espera 409.
- A tela que mostra `erro` da API já exibe a mensagem; nenhum ajuste de UI.
- Testar em produção sem gravar: arquivar/reativar só em empresa de teste; em empresa arquivada,
  tentar lançar no caixa deve mostrar "Empresa arquivada — reative em Cadastros para alterar".
