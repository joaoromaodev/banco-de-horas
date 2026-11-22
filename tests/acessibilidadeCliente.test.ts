// Acessibilidade das telas do cliente (Sprint 16, frente A) — leitura estática.
//
// Não há teste de tela no projeto (sem DOM): estes testes leem o código das telas
// que a empresa-cliente usa — /inicio, /caixa, /documentos, /enviar-ponto e o layout
// com o sino —, seguem os imports (componentes da pasta e primitivas) e conferem o
// que dá para conferir sem navegador:
//
// 1. todo botão, link, campo e lista tem nome acessível (texto, rótulo ou aria-label);
// 2. campo de valor em dinheiro abre o teclado numérico (`inputMode="decimal"`);
// 3. as primitivas dão alvo de toque de 44 px no celular;
// 4. os pares de cor (papéis de app/globals.css) usados nas telas têm contraste AA
//    nos dois temas.
//
// É uma varredura de texto, não um parser de JSX: depende do formato do projeto
// (`<Tag atributo=...>`). Se acusar algo, a mensagem diz o arquivo e a linha.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { alcancaveis, fonteSemComentarios, listarArquivos, RAIZ, rel } from './varreduraRotas';

const APP = join(RAIZ, 'app', '(app)');
const TELAS_CLIENTE = ['inicio', 'caixa', 'documentos', 'enviar-ponto'];

/** Só a tela de cada módulo (page.tsx da raiz da pasta) + o layout com o sino, e o que eles importam. */
const ENTRADAS = [
  join(APP, 'layout.tsx'),
  ...TELAS_CLIENTE.flatMap((t) => listarArquivos(join(APP, t), (n) => n === 'page.tsx').filter((a) => a === join(APP, t, 'page.tsx'))),
];
const ARQUIVOS = alcancaveis(ENTRADAS).filter((a) => a.endsWith('.tsx'));

interface Tag { arquivo: string; linha: number; nome: string; attrs: string; filhos: string | null; pos: number }

/** Fim da abertura de uma tag JSX (o `>` fora de chaves e de strings). */
function fimDaAbertura(f: string, i: number): number {
  const pilha: ('{' | '`')[] = []; // chaves e template strings abertas
  let aspas: string | null = null;
  for (; i < f.length; i++) {
    const c = f[i];
    if (aspas) {
      if (c === '\\') i++;
      else if (c === aspas) aspas = null;
      continue;
    }
    if (pilha[pilha.length - 1] === '`') {
      if (c === '\\') i++;
      else if (c === '`') pilha.pop();
      else if (c === '$' && f[i + 1] === '{') { pilha.push('{'); i++; }
      continue;
    }
    if (c === '"' || c === "'") aspas = c;
    else if (c === '`') pilha.push('`');
    else if (c === '{') pilha.push('{');
    else if (c === '}') pilha.pop();
    else if (c === '>' && pilha.length === 0) return i;
  }
  return -1;
}

function tags(arquivo: string, nomes: string[]): Tag[] {
  const f = fonteSemComentarios(arquivo);
  const r: Tag[] = [];
  const re = new RegExp(`<(${nomes.join('|')})(?=[\\s/>])`, 'g');
  for (const m of f.matchAll(re)) {
    const ini = m.index!;
    const fim = fimDaAbertura(f, ini + m[0].length);
    if (fim < 0) continue;
    const attrs = f.slice(ini + m[0].length, fim);
    const autoFecha = attrs.trimEnd().endsWith('/');
    let filhos: string | null = null;
    if (!autoFecha) {
      const fecha = f.indexOf(`</${m[1]}>`, fim);
      filhos = fecha < 0 ? '' : f.slice(fim + 1, fecha);
    }
    r.push({ arquivo, linha: f.slice(0, ini).split('\n').length, nome: m[1], attrs, filhos, pos: ini });
  }
  return r;
}

const onde = (t: Tag) => `${rel(t.arquivo)}:${t.linha} <${t.nome}>`;
const tem = (t: Tag, attr: string) => new RegExp(`(^|\\s)${attr}=`).test(t.attrs);

/** Os filhos têm texto (ou uma expressão que pode ser texto), além de ícones? */
function temTexto(filhos: string | null): boolean {
  if (!filhos) return false;
  const s = filhos
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/<svg[\s\S]*?<\/svg>/g, '')
    .replace(/<(Icone\w*|Icon|Giro|IconePainel)\b[^>]*\/>/g, '')
    .replace(/\{\s*<(Icone\w*|Icon)\b[^}]*\/>\s*\}/g, '')
    .replace(/<\/?[A-Za-z][^>]*>/g, ' ');
  return /[A-Za-zÀ-ú0-9]/.test(s.replace(/\{[^{}]*\}/g, '')) || /\{[^{}]+\}/.test(s);
}

/** A posição está dentro de um <label>…</label> aberto? */
function dentroDeLabel(arquivo: string, pos: number): boolean {
  const antes = fonteSemComentarios(arquivo).slice(0, pos);
  const abertos = [...antes.matchAll(/<label(?=[\s>])/g)].length;
  const fechados = [...antes.matchAll(/<\/label>/g)].length;
  return abertos > fechados;
}

describe('telas do cliente: varredura', () => {
  it('alcança as telas, o sino e as primitivas', () => {
    const nomes = ARQUIVOS.map(rel);
    for (const esperado of [
      'app/(app)/inicio/page.tsx', 'app/(app)/caixa/page.tsx', 'app/(app)/documentos/page.tsx',
      'app/(app)/enviar-ponto/page.tsx', 'app/(app)/Sino.tsx', 'app/(app)/caixa/SeletorConta.tsx',
      'app/(app)/Dialogo.tsx', 'components/ui.tsx', 'components/selecao.tsx', 'components/retorno.tsx',
    ]) expect(nomes).toContain(esperado);
  });
});

describe('telas do cliente: nome acessível', () => {
  it('todo <button>, <a> e <Botao> tem texto ou aria-label', () => {
    const sem = ARQUIVOS.flatMap((a) => tags(a, ['button', 'a', 'Botao']))
      .filter((t) => !tem(t, 'aria-label') && !tem(t, 'aria-labelledby') && !temTexto(t.filhos))
      .map(onde);
    expect(sem, `Botão/link sem nome acessível (só ícone?). Use <BotaoIcone rotulo="…"> ou aria-label:\n${sem.join('\n')}`).toEqual([]);
  });

  it('todo <BotaoIcone> tem rotulo', () => {
    const sem = ARQUIVOS.flatMap((a) => tags(a, ['BotaoIcone'])).filter((t) => !tem(t, 'rotulo')).map(onde);
    expect(sem).toEqual([]);
  });

  it('todo <input>/<textarea> tem rótulo (label, aria-label ou aria-labelledby)', () => {
    const sem = ARQUIVOS.flatMap((a) => tags(a, ['input', 'textarea']))
      .filter((t) => !/type="hidden"/.test(t.attrs) && !/aria-hidden="true"/.test(t.attrs))
      // primitiva que repassa as props (`{...resto}`): quem a usa é conferido no teste do Alternador/Marcacao
      .filter((t) => !(rel(t.arquivo).startsWith('components/') && /\{\.\.\.resto\}/.test(t.attrs)))
      .filter((t) => !tem(t, 'aria-label') && !tem(t, 'aria-labelledby') && !dentroDeLabel(t.arquivo, t.pos)
        // id ligado a um <label htmlFor> do mesmo arquivo (as primitivas montam assim)
        && !(tem(t, 'id') && /htmlFor=/.test(fonteSemComentarios(t.arquivo))))
      .map(onde);
    expect(sem, `Campo sem rótulo:\n${sem.join('\n')}`).toEqual([]);
  });

  it('todo <Entrada>, <AreaTexto>, <Selecao> e <EntradaSugestoes> tem rotulo ou aria-label', () => {
    const sem = ARQUIVOS.flatMap((a) => tags(a, ['Entrada', 'AreaTexto', 'Selecao', 'EntradaSugestoes']))
      .filter((t) => !tem(t, 'rotulo') && !tem(t, 'aria-label'))
      .map(onde);
    expect(sem, `Campo sem rótulo:\n${sem.join('\n')}`).toEqual([]);
  });

  it('todo <Alternador> e <Marcacao> tem texto ao lado ou aria-label', () => {
    const sem = ARQUIVOS.flatMap((a) => tags(a, ['Alternador', 'Marcacao']))
      .filter((t) => !tem(t, 'aria-label') && !temTexto(t.filhos))
      .map(onde);
    expect(sem).toEqual([]);
  });

  it('toda <img> tem alt (vazio quando é decorativa)', () => {
    const sem = ARQUIVOS.flatMap((a) => tags(a, ['img'])).filter((t) => !tem(t, 'alt')).map(onde);
    expect(sem).toEqual([]);
  });

  it('campo de valor em dinheiro abre o teclado numérico', () => {
    const sem = ARQUIVOS.flatMap((a) => tags(a, ['input', 'Entrada']))
      .filter((t) => /placeholder="0,00"/.test(t.attrs) && !/inputMode="decimal"/.test(t.attrs))
      .map(onde);
    expect(sem).toEqual([]);
  });

  it('nenhum alert/confirm/prompt nem <select> cru', () => {
    const achados = ARQUIVOS.flatMap((a) => {
      const f = fonteSemComentarios(a);
      return [...f.matchAll(/(?<![.\w])(alert|confirm|prompt)\(|<select[\s>]/g)].map((m) => `${rel(a)}: ${m[0]}`);
    });
    expect(achados).toEqual([]);
  });
});

describe('a própria varredura', () => {
  // Prova de que a varredura acusa de verdade (e não passa por não achar nada).
  const tmp = join(tmpdir(), `a11y-${process.pid}-${Date.now()}.tsx`);
  writeFileSync(tmp, [
    'export function X() {',
    '  return (<div>',
    '    <button type="button" onClick={() => a > b}><IconeExcluir size={14} /></button>',
    '    <button type="button" aria-label="Fechar"><IconeExcluir /></button>',
    '    <button type="button">{rotulo}</button>',
    '    <Botao onClick={() => f(`${x}`)}>Salvar</Botao>',
    '    <input value={v} onChange={(e) => s(e.target.value)} />',
    '    <label>Nome <input value={v} /></label>',
    '    <Selecao valor={v} onChange={s} opcoes={[]} />',
    '  </div>);',
    '}',
  ].join('\n'));
  afterAll(() => rmSync(tmp, { force: true }));

  it('acusa botão só com ícone, campo e lista sem rótulo', () => {
    const botoes = tags(tmp, ['button', 'Botao']);
    expect(botoes.map((t) => !tem(t, 'aria-label') && !temTexto(t.filhos))).toEqual([true, false, false, false]);
    const campos = tags(tmp, ['input']);
    expect(campos.map((t) => dentroDeLabel(tmp, t.pos))).toEqual([false, true]);
    expect(tags(tmp, ['Selecao']).filter((t) => !tem(t, 'rotulo') && !tem(t, 'aria-label'))).toHaveLength(1);
  });
});

describe('alvo de toque (44 px no celular)', () => {
  const ui = readFileSync(join(RAIZ, 'components', 'ui.tsx'), 'utf8');
  const bloco = (nome: string) => ui.match(new RegExp(`const ${nome}[^=]*=\\s*\\{([\\s\\S]*?)\\};`))?.[1] ?? '';

  it('Botao: todos os tamanhos têm h-11 abaixo de sm', () => {
    const t = bloco('BOTAO_TAMANHO');
    for (const tam of ['sm', 'md', 'lg']) expect(t.match(new RegExp(`${tam}: '([^']+)'`))?.[1]).toMatch(/(^|\s)h-11(\s|$)/);
  });
  it('campos (Entrada/Selecao): todos os tamanhos têm h-11 abaixo de sm', () => {
    const t = bloco('CONTROLE_TAMANHO');
    for (const tam of ['sm', 'md', 'lg']) expect(t.match(new RegExp(`${tam}: '([^']+)'`))?.[1]).toMatch(/(^|\s)h-11(\s|$)/);
  });
  it('BotaoIcone: 44 × 44 abaixo de sm', () => {
    expect(ui).toMatch(/tamanho === 'sm' \? 'h-11 w-11 sm:h-7 sm:w-7' : 'h-11 w-11 sm:h-8 sm:w-8'/);
  });
  it('opções da Selecao e fechar do Toast têm 44 px no celular', () => {
    expect(readFileSync(join(RAIZ, 'components', 'selecao.tsx'), 'utf8')).toMatch(/const OPCAO = '[^']*min-h-11/);
    expect(readFileSync(join(RAIZ, 'components', 'retorno.tsx'), 'utf8')).toMatch(/aria-label="Fechar notificação"\s+className="[^"]*h-11 w-11/);
  });
});

// ----------------------------------------------------------------- contraste

function cores(css: string, seletor: RegExp): Record<string, string> {
  const bloco = css.match(seletor)?.[1] ?? '';
  return Object.fromEntries([...bloco.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}

function luminancia(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contraste = (a: string, b: string) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

describe('contraste dos papéis de cor nos dois temas (WCAG AA)', () => {
  const css = readFileSync(join(RAIZ, 'app', 'globals.css'), 'utf8');
  const claro = cores(css, /@theme\s*\{([\s\S]*?)\n\}/);
  const escuro = { ...claro, ...cores(css, /:root\[data-tema='escuro'\]\s*\{([\s\S]*?)\n\}/) };

  // [texto, fundo, mínimo] — os pares que as telas do cliente usam (texto 4,5:1; contorno de campo 3:1).
  const PARES: [string, string, number][] = [
    ['tinta', 'superficie', 4.5], ['tinta', 'fundo', 4.5], ['tinta-suave', 'superficie', 4.5],
    ['tinta-suave', 'superficie-suave', 4.5], ['tinta-suave', 'superficie-realce', 4.5],
    ['tinta-fraca', 'superficie', 4.5], ['tinta-fraca', 'fundo', 4.5],
    ['primaria-texto', 'superficie', 4.5], ['primaria-texto', 'primaria-suave', 4.5],
    ['sobre-primaria', 'primaria', 4.5],
    ['sucesso', 'superficie', 4.5], ['sucesso', 'sucesso-suave', 4.5],
    ['aviso', 'superficie', 4.5], ['aviso', 'aviso-suave', 4.5],
    ['perigo', 'superficie', 4.5], ['perigo', 'perigo-suave', 4.5],
    ['borda-forte', 'superficie', 3], ['foco', 'superficie', 3], ['foco', 'fundo', 3],
  ];

  for (const [tema, paleta] of [['claro', claro], ['escuro', escuro]] as const) {
    it(`tema ${tema}`, () => {
      const falhas = PARES.flatMap(([t, f, min]) => {
        expect(paleta[t], `--color-${t} no tema ${tema}`).toMatch(/^#/);
        expect(paleta[f], `--color-${f} no tema ${tema}`).toMatch(/^#/);
        const c = contraste(paleta[t], paleta[f]);
        return c >= min ? [] : [`${t} sobre ${f}: ${c.toFixed(2)}:1 (mínimo ${min}:1)`];
      });
      expect(falhas).toEqual([]);
    });
  }

  it('branco sobre o botão de perigo (fixo nos dois temas)', () => {
    expect(contraste('#ffffff', claro['perigo-solido'])).toBeGreaterThanOrEqual(4.5);
  });
});
