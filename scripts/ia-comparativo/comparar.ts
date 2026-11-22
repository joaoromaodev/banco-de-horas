// Comparativo de modelos de visão para a folha de ponto (Sprint 17, frente F).
//
// Roda as MESMAS folhas sintéticas (gerar_folhas.py — nada de folha real) nos
// modelos de visão da Cloudflare Workers AI e, como referência, no Gemini, com o
// MESMO prompt, esquema e validação do app (lib/ocr.ts), e mede o acerto por
// campo contra o gabarito. Não roda no CI (gasta a cota real).
//
// Uso (na raiz, com CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_AI_TOKEN e, para a
// referência, GEMINI_API_KEY no .env.local):
//   python scripts/ia-comparativo/gerar_folhas.py
//   npx vite-node -c vitest.config.ts scripts/ia-comparativo/comparar.ts -- [--orcamento 7000] [--modelos a,b] [--sem-gemini]
// Saída: tabela no terminal e scripts/ia-comparativo/saida/resultado.json.
import fs from 'node:fs';
import path from 'node:path';
import { chamarCloudflare } from '../../lib/ia/cloudflare';
import { chamarGemini } from '../../lib/ia/gemini';
import { reduzirImagem } from '../../lib/ia';
import { ErroIa } from '../../lib/ia/erros';
import { ESQUEMA_FOLHA, interpretarFolha, promptFolha } from '../../lib/ocr';

const PASTA = path.join(process.cwd(), 'scripts', 'ia-comparativo', 'saida');
const CAMPOS = ['entradaManha', 'saidaAlmoco', 'retornoAlmoco', 'saidaTarde'] as const;

const MODELOS_PADRAO = [
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/meta/llama-3.2-11b-vision-instruct',
  '@cf/google/gemma-4-26b-a4b-it',
];

function lerEnv() {
  const arq = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(arq)) return;
  for (const l of fs.readFileSync(arq, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
}

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface DiaGab { dia: number; entradaManha: string | null; saidaAlmoco: string | null; retornoAlmoco: string | null; saidaTarde: string | null; marcador: string | null }
interface Folha { arquivo: string; variacao: string; ano: number; mes: number; funcionario: string; dias: DiaGab[] }

/** "7:05", "07h05", "0705" → "07:05"; outra coisa volta como veio (conta como erro). */
function normal(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\s*[:hH.]\s*(\d{2})$/) ?? s.match(/^(\d{2})(\d{2})$/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s;
}

interface Placar {
  preenchidos: number; acertosPreenchidos: number;
  vazios: number; acertosVazios: number; inventados: number;
  marcadores: number; acertosMarcador: number;
  folhasOk: number; folhasFalha: number; falhas: string[];
  ms: number[]; neuronios: number[]; porVariacao: Record<string, { campos: number; acertos: number }>;
}
const novoPlacar = (): Placar => ({
  preenchidos: 0, acertosPreenchidos: 0, vazios: 0, acertosVazios: 0, inventados: 0,
  marcadores: 0, acertosMarcador: 0, folhasOk: 0, folhasFalha: 0, falhas: [], ms: [], neuronios: [], porVariacao: {},
});

function pontuar(p: Placar, folha: Folha, lidos: Map<number, Record<string, string | null>>) {
  const v = (p.porVariacao[folha.variacao] ??= { campos: 0, acertos: 0 });
  for (const g of folha.dias) {
    const l = lidos.get(g.dia);
    for (const c of CAMPOS) {
      const esperado = g[c];
      const lido = normal(l?.[c]);
      if (esperado) {
        p.preenchidos++; v.campos++;
        if (lido === esperado) { p.acertosPreenchidos++; v.acertos++; }
      } else {
        p.vazios++;
        if (lido === null) p.acertosVazios++; else p.inventados++;
      }
    }
    if (g.marcador) {
      p.marcadores++;
      if (l?.marcador === g.marcador) p.acertosMarcador++;
    }
  }
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function main() {
  lerEnv();
  const conta = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_AI_TOKEN?.trim();
  if (!conta || !token) throw new Error('Faltam CLOUDFLARE_ACCOUNT_ID e CLOUDFLARE_AI_TOKEN.');
  const gabarito: Folha[] = JSON.parse(fs.readFileSync(path.join(PASTA, 'gabarito.json'), 'utf8'));
  const modelos = arg('--modelos')?.split(',') ?? MODELOS_PADRAO;
  const orcamento = Number(arg('--orcamento') ?? 7000);
  const comGemini = !process.argv.includes('--sem-gemini') && !!process.env.GEMINI_API_KEY?.trim();
  let gastos = 0;

  const resultados: Record<string, Placar> = {};
  const alvos = [...modelos, ...(comGemini ? ['gemini-2.5-flash'] : [])];
  await Promise.all(alvos.map(async (modelo) => {
    const p = (resultados[modelo] = novoPlacar());
    for (const folha of gabarito) {
      if (!modelo.startsWith('gemini') && gastos >= orcamento) { p.falhas.push(`${folha.arquivo}: orçamento de neurônios atingido`); continue; }
      const bytes = new Uint8Array(fs.readFileSync(path.join(PASTA, folha.arquivo)));
      const prompt = promptFolha(folha.ano, folha.mes);
      const t0 = Date.now();
      try {
        let texto: string; let neuronios: number | null = null;
        if (modelo.startsWith('gemini')) {
          ({ texto } = await chamarGemini({ apiKey: process.env.GEMINI_API_KEY!.trim(), modelo, prompt, esquema: ESQUEMA_FOLHA, arquivo: { bytes, mime: 'image/jpeg' }, timeoutMs: 300_000 }));
        } else {
          const imagem = await reduzirImagem({ bytes, mime: 'image/jpeg' });
          const r = await chamarCloudflare({ conta, token, modelo, prompt, esquema: ESQUEMA_FOLHA, imagem, maxTokens: 4096, timeoutMs: 300_000 });
          texto = r.texto; neuronios = r.neuronios;
        }
        p.ms.push(Date.now() - t0);
        if (neuronios !== null) { p.neuronios.push(neuronios); gastos += neuronios; }
        const lida = interpretarFolha(texto, { ano: folha.ano, mes: folha.mes });
        if (!lida) throw new Error('JSON inválido');
        const porDia = new Map(lida.frequencia.dias.map((d) => [d.dia, d as unknown as Record<string, string | null>]));
        pontuar(p, folha, porDia);
        p.folhasOk++;
        console.log(`${modelo} ${folha.arquivo}: ${((Date.now() - t0) / 1000).toFixed(1)} s, ${neuronios ?? '—'} neurônios`);
      } catch (e) {
        p.folhasFalha++;
        if (e instanceof ErroIa && e.neuronios) gastos += e.neuronios;
        const msg = e instanceof ErroIa ? `${e.tipo}: ${e.detalhe}` : (e as Error).message;
        p.falhas.push(`${folha.arquivo}: ${msg.slice(0, 160)}`);
        // Folha que falhou conta como tudo errado (o usuário digitaria à mão).
        pontuar(p, folha, new Map());
        console.log(`${modelo} ${folha.arquivo}: FALHOU — ${msg.slice(0, 160)}`);
        if (e instanceof ErroIa && e.tipo === 'cota_diaria') break;
      }
    }
  }));

  const variacoes = [...new Set(gabarito.map((f) => f.variacao))];
  console.log('\n| Modelo | Horários lidos certos | Vazios mantidos vazios | Inventados | Marcador | ' + variacoes.join(' | ') + ' | Folhas ok | Tempo médio | Neurônios/folha |');
  console.log('|' + ' --- |'.repeat(9 + variacoes.length));
  for (const [modelo, p] of Object.entries(resultados)) {
    console.log(`| ${modelo} | ${pct(p.acertosPreenchidos, p.preenchidos)} | ${pct(p.acertosVazios, p.vazios)} | ${p.inventados} | ${pct(p.acertosMarcador, p.marcadores)} | `
      + variacoes.map((v) => pct(p.porVariacao[v]?.acertos ?? 0, p.porVariacao[v]?.campos ?? 0)).join(' | ')
      + ` | ${p.folhasOk}/${gabarito.length} | ${p.ms.length ? (media(p.ms) / 1000).toFixed(1) + ' s' : '—'} | ${p.neuronios.length ? media(p.neuronios).toFixed(0) : '—'} |`);
  }
  for (const [modelo, p] of Object.entries(resultados)) if (p.falhas.length) console.log(`\n${modelo}:\n  ${p.falhas.join('\n  ')}`);
  console.log(`\nNeurônios gastos no comparativo: ${gastos.toFixed(0)}`);
  fs.writeFileSync(path.join(PASTA, 'resultado.json'), JSON.stringify({ em: new Date().toISOString(), gastos, resultados }, null, 1));
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
