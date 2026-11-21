// Leitura estática das rotas de API e das telas, para os testes-varredura
// (`guardaRotas.test.ts` e `proxyCliente.test.ts`). Não é um parser de TypeScript:
// depende do formato do projeto — declarações de topo começando na coluna 0
// (`export async function GET`, `function x`, `const x =`) e imports em `import ... from '...'`.
// Se uma rota fugir desse formato, a varredura falha com mensagem (não passa em silêncio).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const RAIZ = resolve(__dirname, '..');
export const METODOS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** Caminho relativo à raiz, com `/` (para mensagens e chaves estáveis no Windows). */
export const rel = (abs: string) => relative(RAIZ, abs).split(sep).join('/');

export function listarArquivos(dir: string, filtro: (nome: string) => boolean): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) saida.push(...listarArquivos(p, filtro));
    else if (filtro(nome)) saida.push(p);
  }
  return saida.sort();
}

/** Todos os `route.ts` de `app/api`, com o caminho HTTP correspondente. */
export function rotasDaApi(): { arquivo: string; caminho: string }[] {
  return listarArquivos(join(RAIZ, 'app', 'api'), (n) => n === 'route.ts').map((arquivo) => ({
    arquivo,
    caminho: '/' + rel(dirname(arquivo)).replace(/^app\//, ''),
  }));
}

// ------------------------------------------------------------------ fonte

const cacheFonte = new Map<string, string>();

/** Fonte sem comentários (strings preservadas — `'http://'` não vira comentário). */
export function fonteSemComentarios(arquivo: string): string {
  const pronto = cacheFonte.get(arquivo);
  if (pronto !== undefined) return pronto;
  const s = readFileSync(arquivo, 'utf8');
  let out = '';
  let i = 0;
  let aspas: string | null = null;
  while (i < s.length) {
    const c = s[i];
    if (aspas) {
      out += c;
      if (c === '\\') { out += s[i + 1] ?? ''; i += 2; continue; }
      if (c === aspas) aspas = null;
      i++;
      continue;
    }
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') {
      const fim = s.indexOf('*/', i + 2);
      // Mantém as quebras de linha: as declarações continuam na coluna 0.
      out += s.slice(i, fim < 0 ? s.length : fim + 2).replace(/[^\n]/g, '');
      i = fim < 0 ? s.length : fim + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') aspas = c;
    out += c;
    i++;
  }
  cacheFonte.set(arquivo, out);
  return out;
}

const INICIO_DECL = /^(export\s+)?(default\s+)?(async\s+)?(function|const|let|class|interface|type|enum)\b/;

/**
 * Corpo de uma declaração de topo (`function nome`, `const nome =`), do início
 * até a próxima declaração de topo. `null` se não houver.
 */
export function corpoDe(fonte: string, nome: string): string | null {
  const linhas = fonte.split('\n');
  const decl = new RegExp(`^(export\\s+)?(async\\s+)?(function\\s*\\*?\\s*${nome}\\b|const\\s+${nome}\\b|let\\s+${nome}\\b)`);
  const ini = linhas.findIndex((l) => decl.test(l));
  if (ini < 0) return null;
  let fim = ini + 1;
  while (fim < linhas.length && !(INICIO_DECL.test(linhas[fim]) || /^import\b/.test(linhas[fim]))) fim++;
  return linhas.slice(ini, fim).join('\n');
}

/** Handlers HTTP exportados pela rota. */
export function handlers(arquivo: string): string[] {
  const f = fonteSemComentarios(arquivo);
  const achados = new Set<string>();
  for (const m of f.matchAll(/^export\s+(?:async\s+)?(?:function\s+|const\s+)(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/gm)) achados.add(m[1]);
  // Reexportação (`export { GET } from`) não é suportada pela varredura: acusa.
  if (/^export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE)\b/m.test(f)) {
    throw new Error(`${rel(arquivo)}: reexporta handler com "export { ... }". A varredura de guarda não acompanha; declare o handler no próprio route.ts.`);
  }
  return [...achados];
}

/** Mapa `nome importado → arquivo` (só imports do projeto: `@/`, `./`, `../`). */
export function importsDe(arquivo: string): Map<string, string> {
  const f = fonteSemComentarios(arquivo);
  const mapa = new Map<string, string>();
  for (const m of f.matchAll(/import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    if (m[1]) continue;
    const alvo = resolverModulo(arquivo, m[3]);
    if (!alvo) continue;
    const chaves = m[2].match(/\{([\s\S]*)\}/)?.[1] ?? '';
    for (const parte of chaves.split(',')) {
      const p = parte.trim().replace(/^type\s+/, '');
      if (!p || parte.trim().startsWith('type ')) continue;
      const [original, apelido] = p.split(/\s+as\s+/).map((x) => x.trim());
      mapa.set(apelido ?? original, `${alvo}#${original}`);
    }
  }
  return mapa;
}

/** Resolve `@/x`, `./x`, `../x` para o arquivo .ts/.tsx; pacotes → null. */
export function resolverModulo(de: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(RAIZ, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(de), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Nomes chamados num trecho (`nome(`), sem palavras-chave. */
function chamadas(trecho: string): Set<string> {
  const fora = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'await', 'new']);
  const r = new Set<string>();
  for (const m of trecho.matchAll(/(?<![.\w$])(?<!function\s*\*?\s*)([A-Za-z_$][\w$]*)\s*(?:<[^()]*>)?\s*\(/g)) if (!fora.has(m[1])) r.add(m[1]);
  return r;
}

// ------------------------------------------------------------------ guardas

const ACESSO = join(RAIZ, 'lib', 'acesso.ts');

/**
 * Guardas-base: o que `lib/acesso.ts` exporta como `exigir*`, mais `sessaoDe` (a
 * rota que lê a sessão e decide sozinha, como `/api/me`). Lido do arquivo: uma
 * guarda nova em lib/acesso.ts passa a contar sem mexer no teste.
 */
export function guardasBase(): Set<string> {
  const f = fonteSemComentarios(ACESSO);
  const nomes = [...f.matchAll(/^export\s+async\s+function\s+(exigir\w+)/gm)].map((m) => m[1]);
  return new Set([...nomes, 'sessaoDe']);
}

/** Guardas que só deixam passar a contabilidade (ou o master). */
export const GUARDAS_GESTOR = new Set(['exigirGestor', 'exigirMaster', 'exigirAdminEscritorio']);

/**
 * O trecho chama (direta ou indiretamente, por função local ou importada do
 * projeto) alguma das guardas de `alvo`? Devolve a cadeia até a guarda, ou null.
 */
export function cadeiaAteGuarda(
  arquivo: string, trecho: string, alvo: Set<string>, visitados = new Set<string>(),
): string[] | null {
  const imports = importsDe(arquivo);
  const fonte = fonteSemComentarios(arquivo);
  for (const nome of chamadas(trecho)) {
    const importado = imports.get(nome);
    if (alvo.has(nome)) {
      // Só vale a guarda de verdade: importada de lib/acesso.ts (ou o próprio arquivo).
      const original = importado?.split('#')[1];
      if (arquivo === ACESSO || (importado?.startsWith(ACESSO + '#') && original === nome)) return [nome];
    }
    let dest: { arquivo: string; nome: string } | null = null;
    if (importado) {
      const [arq, original] = importado.split('#');
      if (arq === ACESSO && alvo.has(original)) return [original];
      dest = { arquivo: arq, nome: original };
    } else if (corpoDe(fonte, nome) !== null) {
      dest = { arquivo, nome };
    }
    if (!dest) continue;
    const chave = `${dest.arquivo}#${dest.nome}`;
    if (visitados.has(chave)) continue;
    visitados.add(chave);
    const corpo = corpoDe(fonteSemComentarios(dest.arquivo), dest.nome);
    if (!corpo) continue;
    const resto = cadeiaAteGuarda(dest.arquivo, corpo, alvo, visitados);
    if (resto) return [`${dest.nome}${dest.arquivo === arquivo ? '' : ` (${rel(dest.arquivo)})`}`, ...resto];
  }
  return null;
}

/** Corpo do handler exportado (lança se a varredura não conseguir isolá-lo). */
export function corpoDoHandler(arquivo: string, metodo: string): string {
  const corpo = corpoDe(fonteSemComentarios(arquivo), metodo);
  if (!corpo) throw new Error(`${rel(arquivo)}: não achei o corpo de ${metodo} (declare na coluna 0: "export async function ${metodo}(...)").`);
  return corpo;
}

// ------------------------------------------------------------------ telas

/** Arquivos alcançados por import a partir das entradas (só do projeto). */
export function alcancaveis(entradas: string[]): string[] {
  const vistos = new Set<string>();
  const fila = [...entradas];
  while (fila.length) {
    const a = fila.pop()!;
    if (vistos.has(a)) continue;
    vistos.add(a);
    const f = fonteSemComentarios(a);
    for (const m of f.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
      if (/^import\s+type\b/.test(m[0])) continue;
      const alvo = resolverModulo(a, m[1]);
      if (alvo && !vistos.has(alvo)) fila.push(alvo);
    }
    for (const m of f.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const alvo = resolverModulo(a, m[1]);
      if (alvo && !vistos.has(alvo)) fila.push(alvo);
    }
  }
  return [...vistos].sort();
}

/** Caminhos `/api/...` citados em strings (fetch, href) — com o arquivo de onde vieram. */
export function apisCitadas(arquivos: string[]): Map<string, string[]> {
  const r = new Map<string, string[]>();
  for (const a of arquivos) {
    for (const m of fonteSemComentarios(a).matchAll(/['"`](\/api\/[A-Za-z0-9_\-/]*)/g)) {
      const caminho = m[1].replace(/\/+$/, '');
      r.set(caminho, [...new Set([...(r.get(caminho) ?? []), rel(a)])]);
    }
  }
  return r;
}

/** Strings de um array literal de topo (`const NOME = [ ... ];`) — para ler o proxy sem exportar nada. */
export function arrayLiteral(arquivo: string, nome: string): string[] {
  const f = fonteSemComentarios(arquivo);
  const m = f.match(new RegExp(`const\\s+${nome}\\s*=\\s*\\[([\\s\\S]*?)\\];`));
  if (!m) throw new Error(`${rel(arquivo)}: não achei "const ${nome} = [...]".`);
  return [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
}

/** Mesmo critério do proxy: igual ou prefixo seguido de `/`. */
export const casaCom = (lista: string[], caminho: string) =>
  lista.some((p) => caminho === p || caminho.startsWith(p + '/'));
