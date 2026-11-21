// Mede, SÓ LENDO, o tempo das principais rotas do app contra o banco de produção.
//
//   1) suba o app localmente com as variáveis de produção (nada é publicado):
//        npm run build
//        node --env-file=../../.env.local node_modules/next/dist/bin/next start -p 3111
//   2) meça:
//        node scripts/medir-desempenho.mjs --env=../../.env.local --rotulo=antes --salvar=antes.json
//        node scripts/medir-desempenho.mjs --env=../../.env.local --rotulo=depois --comparar=antes.json
//
// Opções: --base=http://localhost:3111 (padrão)   --n=7 (repetições por rota)
//         --env=<arquivo> (padrão .env.local)      --salvar=<json>   --comparar=<json>
//         --permitir-remoto  (só se você mesmo quiser apontar para uma URL publicada)
//
// Garantias de não gravar nada:
//  - só faz GET, e só em rotas de leitura (lista fechada em ROTAS, abaixo);
//  - o livro é pedido em .xlsx (o .pdf grava a quantidade de folhas);
//  - só usa (empresa, ano) cujo exercício JÁ existe — o GET de lançamentos abriria
//    um exercício novo se faltasse, e isso seria uma escrita;
//  - o banco é consultado direto apenas com SELECT (descoberta dos alvos).
// A sessão é assinada aqui com o SESSION_SECRET (papel `master`, mesmo formato de
// lib/auth.ts); nenhuma senha é lida nem usada.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const arg = (nome, padrao) => {
  const a = process.argv.find((x) => x.startsWith(`--${nome}=`));
  return a ? a.slice(nome.length + 3) : padrao;
};
const flag = (nome) => process.argv.includes(`--${nome}`);

function carregarEnv(arquivo) {
  if (!fs.existsSync(arquivo)) return;
  for (const l of fs.readFileSync(arquivo, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
carregarEnv(arg('env', '.env.local'));

const BASE = arg('base', 'http://localhost:3111').replace(/\/$/, '');
const N = Math.max(1, Number(arg('n', '7')));
const ROTULO = arg('rotulo', 'medicao');
const SALVAR = arg('salvar', '');
const COMPARAR = arg('comparar', '');

const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(BASE);
if (!local && !flag('permitir-remoto')) {
  console.error(`Recusado: ${BASE} não é local. Suba o app na sua máquina (veja o topo do arquivo) ou passe --permitir-remoto.`);
  process.exit(2);
}
for (const v of ['SESSION_SECRET', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SECRET_KEY']) {
  if (!process.env[v]) { console.error(`Falta a variável ${v} (use --env=<arquivo>).`); process.exit(2); }
}

// ---- sessão assinada localmente (igual a lib/auth.ts: corpo.assinatura, HMAC-SHA256, base64url) ----
const b64u = (buf) => Buffer.from(buf).toString('base64url');
function cookieMaster() {
  const corpo = b64u(JSON.stringify({
    email: 'medicao@local', nome: 'Medição', role: 'master', modulos: ['ponto', 'caixa'], exp: Date.now() + 30 * 60_000,
  }));
  const assinatura = b64u(crypto.createHmac('sha256', process.env.SESSION_SECRET.trim()).update(corpo).digest());
  return `sessao=${corpo}.${assinatura}`;
}
const COOKIE = cookieMaster();

// ---- descoberta dos alvos (SELECT apenas) ----
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL.trim(), process.env.SUPABASE_SECRET_KEY.trim(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function alvos() {
  const { data: ex, error } = await db.from('exercicios').select('id, empresa_id, ano');
  if (error) throw new Error(`exercicios: ${error.message}`);
  let melhor = null;
  for (const e of ex ?? []) {
    const { count } = await db.from('lancamentos').select('id', { count: 'exact', head: true }).eq('exercicio_id', e.id);
    if (!melhor || (count ?? 0) > melhor.lancamentos) melhor = { ...e, lancamentos: count ?? 0 };
  }
  if (!melhor) return null;
  const { data: res } = await db.from('resumo_mensal').select('mes, entradas, saidas').eq('exercicio_id', melhor.id);
  const mes = (res ?? []).reduce((m, r) => (Number(r.entradas) + Number(r.saidas) > m.v ? { mes: r.mes, v: Number(r.entradas) + Number(r.saidas) } : m), { mes: 12, v: -1 }).mes;
  const { count: empresas } = await db.from('empresas').select('id', { count: 'exact', head: true });
  const { count: totalLanc } = await db.from('lancamentos').select('id', { count: 'exact', head: true });
  return { ...melhor, mes, empresas: empresas ?? 0, totalLancamentos: totalLanc ?? 0 };
}

const alvo = await alvos();
if (!alvo) { console.error('Nenhum exercício existente: nada seguro para medir no caixa.'); process.exit(1); }
const e = encodeURIComponent(alvo.empresa_id);

// Lista fechada de rotas de LEITURA.
const ROTAS = [
  ['GET /api/me', '/api/me'],
  ['GET /api/empresas', '/api/empresas'],
  ['GET /api/painel', '/api/painel'],
  ['GET /api/painel/fechamento', '/api/painel/fechamento'],
  ['GET /api/caixa/lancamentos (mês)', `/api/caixa/lancamentos?empresa=${e}&ano=${alvo.ano}&mes=${alvo.mes}`],
  ['GET /api/caixa/exercicio', `/api/caixa/exercicio?empresa=${e}&ano=${alvo.ano}`],
  ['GET /api/caixa/resumo', `/api/caixa/resumo?empresa=${e}&ano=${alvo.ano}`],
  ['GET /api/caixa/contas', `/api/caixa/contas?empresa=${e}`],
  ['GET /api/caixa/sugestao', `/api/caixa/sugestao?empresa=${e}`],
  ['GET /api/caixa/revisao', `/api/caixa/revisao?empresa=${e}&ano=${alvo.ano}`],
  ['GET /api/caixa/atividade', `/api/caixa/atividade?ano=${alvo.ano}`],
  ['GET /api/caixa/livro (.xlsx)', `/api/caixa/livro?empresa=${e}&ano=${alvo.ano}&formato=xlsx`],
  ['GET /api/agenda', '/api/agenda'],
  ['GET /api/documentos', `/api/documentos?empresa=${e}`],
  ['GET /api/funcionarios', `/api/funcionarios?empresa=${e}`],
];

const mediana = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

async function pedir(caminho) {
  const t = performance.now();
  const r = await fetch(BASE + caminho, { headers: { cookie: COOKIE }, cache: 'no-store' });
  const corpo = await r.arrayBuffer();
  return { ms: performance.now() - t, status: r.status, bytes: corpo.byteLength };
}

try { await pedir('/api/me'); } catch (err) {
  console.error(`Não consegui falar com ${BASE}. O app está rodando? (${err.message})`); process.exit(1);
}

console.log(`\nMedição "${ROTULO}" — ${new Date().toISOString()}`);
console.log(`Alvo: empresa ${alvo.empresa_id} · ${alvo.ano} (mês ${alvo.mes}) · ${alvo.lancamentos} lançamentos no exercício · ${alvo.totalLancamentos} no banco · ${alvo.empresas} empresas · ${N} repetições\n`);

const resultados = {};
for (const [nome, caminho] of ROTAS) {
  const tempos = [];
  let status = 0, bytes = 0;
  const primeira = await pedir(caminho); // 1ª (a "fria") fica à parte
  status = primeira.status; bytes = primeira.bytes;
  for (let i = 0; i < N; i++) { const r = await pedir(caminho); tempos.push(r.ms); status = r.status; bytes = r.bytes; }
  resultados[nome] = { fria: primeira.ms, mediana: mediana(tempos), min: Math.min(...tempos), max: Math.max(...tempos), status, bytes };
}

const antes = COMPARAR && fs.existsSync(COMPARAR) ? JSON.parse(fs.readFileSync(COMPARAR, 'utf8')) : null;
const f = (x) => `${Math.round(x)}`.padStart(6);
const cab = antes
  ? 'rota'.padEnd(36) + ' status   fria  mediana    min    max |  antes(med)  Δ%'
  : 'rota'.padEnd(36) + ' status   fria  mediana    min    max   KB';
console.log(cab);
console.log('-'.repeat(cab.length + 4));
for (const [nome, r] of Object.entries(resultados)) {
  let linha = `${nome.padEnd(36)} ${String(r.status).padStart(6)} ${f(r.fria)} ${f(r.mediana)} ${f(r.min)} ${f(r.max)}`;
  if (antes?.resultados?.[nome]) {
    const a = antes.resultados[nome].mediana;
    const d = ((r.mediana - a) / a) * 100;
    linha += ` | ${f(a)}  ${d >= 0 ? '+' : ''}${d.toFixed(0)}%`;
  } else if (!antes) {
    linha += ` ${(r.bytes / 1024).toFixed(1).padStart(6)}`;
  }
  console.log(linha);
}
console.log('\n(ms; "fria" = primeira chamada, inclui cache vazio e compilação; mediana das demais.)\n');

if (SALVAR) {
  fs.writeFileSync(SALVAR, JSON.stringify({ rotulo: ROTULO, em: new Date().toISOString(), alvo, n: N, resultados }, null, 2));
  console.log(`Salvo em ${SALVAR}`);
}
