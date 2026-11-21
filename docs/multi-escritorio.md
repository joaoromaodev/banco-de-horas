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

## Migração pendente — `supabase/migrations/0010_escritorios.sql`

**Não aplicada no remoto.** O que faz: cria `escritorios`, adiciona
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

- **Catálogo do Livro Caixa é global.** `plano_contas` e `historicos_padrao` são
  compartilhados por todos os escritórios: um contador de outro escritório que
  cria conta/analítica "nova" a põe no catálogo que a Edilce também vê. Não vaza
  dado de empresa, mas polui. Próximo passo: catálogo base + extensões por
  escritório.
- **Feriados globais** até a Folha de Ponto ir para o Postgres (Sprint 2).
- **Chave do Gemini** ainda é da instalação (Configurações do master).
- **Rate-limit por instância** (memória). Se o cadastro virar alvo, mover para
  o Postgres.
- O aviso de teste ainda não tem link para `/planos` (página da Frente B) — pôr
  quando as branches se juntarem.
- Mover usuário/empresa entre escritórios só por SQL; não há tela.
