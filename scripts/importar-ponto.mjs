// Importa a Folha de Ponto do Google Sheets para o Postgres (migração 0012).
//
//   node scripts/importar-ponto.mjs --simular      # padrão: só lê, conta e mostra
//   node scripts/importar-ponto.mjs --gravar       # grava (depois da 0012 aplicada)
//   opções: --escritorio=<uuid>  (padrão: escritório fundador, o da Edilse)
//           --env=<arquivo>      (padrão: .env.local na pasta atual)
//
// - A planilha é lida com escopo SOMENTE LEITURA: o script nunca altera o Sheets.
// - Idempotente: grava com "insere o que falta, não sobrescreve" (upsert com
//   ignoreDuplicates nas chaves únicas da 0012). Rodar de novo não duplica nem
//   desfaz o que foi editado no app depois da importação.
// - Em --gravar, salva antes uma cópia JSON do que leu da planilha (pasta
//   temporária do sistema) e a APAGA ao fim de uma gravação sem erro. Com
//   --manter-copia ela fica (dado pessoal: apague depois de conferir).
// - Precisa de NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, GOOGLE_SHEETS_ID e
//   GOOGLE_SERVICE_ACCOUNT_JSON (ou GOOGLE_SERVICE_ACCOUNT_FILE).
//
// A regra de mapeamento (o que entra, o que fica de fora) é pura e testada:
// lib/pontoImportacao.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import { planejarImportacao } from '../lib/pontoImportacao.ts';

const ESCRITORIO_FUNDADOR_ID = '00000000-0000-4000-8000-000000000001';
const ABAS = ['Funcionarios', 'Frequencias', 'Feriados', 'Config'];
const LOTE = 500;

const args = process.argv.slice(2);
const opcao = (nome) => args.find((a) => a.startsWith(`--${nome}=`))?.split('=').slice(1).join('=');
const gravar = args.includes('--gravar');
if (gravar && args.includes('--simular')) {
  console.error('Use --simular OU --gravar, não os dois.');
  process.exit(2);
}
const escritorioId = opcao('escritorio') ?? ESCRITORIO_FUNDADOR_ID;

// ---------------------------------------------------------------- ambiente
function carregarEnv(arquivo) {
  if (!fs.existsSync(arquivo)) return;
  for (const linha of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = linha.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
carregarEnv(path.resolve(opcao('env') ?? '.env.local'));

function exigir(nome) {
  const v = process.env[nome]?.trim();
  if (!v) { console.error(`Falta a variável ${nome}.`); process.exit(2); }
  return v;
}

function contaServico() {
  let raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) {
    const arq = exigir('GOOGLE_SERVICE_ACCOUNT_FILE');
    raw = fs.readFileSync(path.resolve(arq), 'utf8');
  }
  const o = JSON.parse(raw);
  return { email: o.client_email, key: String(o.private_key).replace(/\\n/g, '\n') };
}

// ---------------------------------------------------------------- leitura
async function lerPlanilha() {
  const { email, key } = contaServico();
  const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const spreadsheetId = exigir('GOOGLE_SHEETS_ID');
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existentes = new Set((meta.data.sheets ?? []).map((s) => s.properties?.title));
  const abas = {};
  for (const aba of ABAS) {
    if (!existentes.has(aba)) { abas[aba] = []; continue; }
    const r = await sheets.spreadsheets.values.get({ spreadsheetId, range: aba });
    abas[aba] = r.data.values ?? [];
  }
  return abas;
}

async function tabelasExistem(db) {
  // Sem `head`: num HEAD o PostgREST responde 204 sem erro mesmo sem a tabela.
  const { error } = await db.from('ponto_frequencias').select('id').limit(1);
  if (!error) return true;
  if (error.code === 'PGRST205' || error.code === '42P01') return false;
  throw new Error(error.message);
}

async function contarNoBanco(db) {
  const r = {};
  for (const t of ['ponto_funcionarios', 'ponto_frequencias', 'ponto_feriados']) {
    const { count, error } = await db.from(t).select('id', { head: true, count: 'exact' }).eq('escritorio_id', escritorioId);
    if (error || count === null) throw new Error(`${t}: ${error?.message ?? 'contagem indisponível'}`);
    r[t] = count;
  }
  return r;
}

async function inserir(db, tabela, linhas, conflito) {
  for (let i = 0; i < linhas.length; i += LOTE) {
    const { error } = await db.from(tabela).upsert(linhas.slice(i, i + LOTE), { onConflict: conflito, ignoreDuplicates: true });
    if (error) throw new Error(`${tabela}: ${error.message}`);
  }
}

// ---------------------------------------------------------------- principal
async function main() {
  console.log(`Importação da Folha de Ponto — modo ${gravar ? 'GRAVAR' : 'SIMULAR (nada é gravado)'}`);
  const db = createClient(exigir('NEXT_PUBLIC_SUPABASE_URL'), exigir('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: escritorio, error: eEsc } = await db.from('escritorios').select('id, nome, plano').eq('id', escritorioId).maybeSingle();
  if (eEsc) throw new Error(eEsc.message);
  if (!escritorio) throw new Error(`Escritório ${escritorioId} não existe.`);
  const { data: empresas, error: eEmp } = await db.from('empresas').select('id, nome, escritorio_id');
  if (eEmp) throw new Error(eEmp.message);
  console.log(`Escritório de destino: ${escritorio.nome} (plano ${escritorio.plano}); ` +
    `${empresas.filter((e) => e.escritorio_id === escritorioId).length} empresa(s) dele no banco.`);

  const abas = await lerPlanilha();
  const linhas = (aba) => Math.max(0, (abas[aba]?.length ?? 0) - 1);
  console.log(`Planilha: Funcionarios ${linhas('Funcionarios')}, Frequencias ${linhas('Frequencias')}, ` +
    `Feriados ${linhas('Feriados')} linha(s) de dados.`);
  const chavesConfig = (abas.Config ?? []).slice(1).map((r) => r[0]).filter(Boolean);
  if (chavesConfig.length) {
    console.log(`Config: ${chavesConfig.join(', ')} — NÃO importadas (a chave do Gemini agora é da plataforma).`);
  }

  const plano = planejarImportacao({
    escritorioId,
    empresas,
    funcionarios: abas.Funcionarios,
    frequencias: abas.Frequencias,
    feriados: abas.Feriados,
  });

  const nomeEmpresa = new Map(empresas.map((e) => [e.id, e.nome]));
  const porEmpresa = (lista) => {
    const m = {};
    for (const l of lista) { const n = nomeEmpresa.get(l.empresa_id) ?? l.empresa_id; m[n] = (m[n] ?? 0) + 1; }
    return m;
  };
  const meses = {};
  for (const f of plano.frequencias) {
    const k = `${nomeEmpresa.get(f.empresa_id) ?? f.empresa_id} · ${String(f.mes).padStart(2, '0')}/${f.ano}`;
    meses[k] ??= new Set();
    meses[k].add(f.funcionario);
  }

  console.log('\nVai entrar:');
  console.log(`  funcionários: ${plano.funcionarios.length}`, porEmpresa(plano.funcionarios));
  console.log(`  frequências (dias): ${plano.frequencias.length} (${plano.frequenciasLegadas} recuperadas do vínculo legado)`, porEmpresa(plano.frequencias));
  for (const [k, s] of Object.entries(meses).sort()) console.log(`    ${k}: ${s.size} funcionário(s)`);
  console.log(`  feriados: ${plano.feriados.length}`);
  console.log('\nFica de fora:');
  if (!Object.keys(plano.ignorados).length) console.log('  nada');
  for (const [motivo, n] of Object.entries(plano.ignorados)) console.log(`  ${n} × ${motivo}`);
  if (plano.avisos.length) {
    console.log('\nAvisos:');
    for (const a of plano.avisos) console.log(`  - ${a}`);
  }

  const existem = await tabelasExistem(db);
  if (!existem) {
    console.log('\nBanco: a migração 0012 ainda NÃO foi aplicada (tabelas ponto_* não existem).');
    if (gravar) { console.error('Aplique a 0012 antes de gravar.'); process.exit(1); }
    return;
  }
  const antes = await contarNoBanco(db);
  console.log('\nBanco (escritório de destino) antes:', antes);
  if (!gravar) return;

  const copia = path.join(os.tmpdir(), `ponto-sheets-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(copia, JSON.stringify({ Funcionarios: abas.Funcionarios, Frequencias: abas.Frequencias, Feriados: abas.Feriados }));
  console.log(`Cópia do que foi lido da planilha: ${copia}`);

  await inserir(db, 'ponto_funcionarios', plano.funcionarios, 'empresa_id,nome');
  await inserir(db, 'ponto_frequencias', plano.frequencias, 'empresa_id,funcionario,ano,mes,dia');
  await inserir(db, 'ponto_feriados', plano.feriados, 'escritorio_id,data');
  const depois = await contarNoBanco(db);
  console.log('Banco depois:', depois);
  if (args.includes('--manter-copia')) {
    console.log(`Cópia mantida em ${copia} — dado pessoal: apague depois de conferir.`);
  } else {
    fs.rmSync(copia, { force: true });
    console.log('Cópia temporária apagada (use --manter-copia para guardá-la).');
  }
  console.log('Pronto. Rodar de novo não duplica nada.');
}

main().catch((e) => {
  console.error('Falhou:', e instanceof Error ? e.message : e);
  process.exit(1);
});
