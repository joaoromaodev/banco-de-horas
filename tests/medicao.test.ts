// Medição própria (Sprint 15, frente A): a prova de que NADA PESSOAL é gravado —
// normalização da rota (ids, uuids, datas, e-mail, CPF viram placeholder; query some),
// lista fechada de rotas em sincronia com o app, código de erro sem mensagem,
// revalidação do que vem do navegador — e o resumo do master (p50/p95, erros, volume).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  codigoDoErro, ehErro, ehRotaDaApi, ERRO_VALIDO, normalizarRota, percentil, resumirMedicoes, TELAS_PUBLICAS, validarItem,
  type LinhaMedicao,
} from '@/lib/medicao';
import { classificarRota, OUTRA_API, OUTRA_TELA, PAGINAS, ROTAS_API, rotaDoArquivo } from '@/lib/medicaoRotas';
import { listarArquivos, RAIZ, rel, rotasDaApi } from './varreduraRotas';

const db = vi.hoisted(() => ({ atual: null as unknown }));
vi.mock('@/lib/db', async (orig) => ({ ...(await orig<typeof import('@/lib/db')>()), getDb: () => db.atual }));
const { gravarMedicoes, linhaDoItem, _reiniciarMedicao, ehTabelaAusente } = await import('@/lib/medicaoServidor');

const UUID = '3f2a9c1e-7b4d-4e8f-9a6b-1c2d3e4f5a6b';

describe('normalizarRota — sem dado pessoal', () => {
  it('uuid e número viram [id]', () => {
    expect(normalizarRota(`/api/dp/${UUID}`)).toBe('/api/dp/[id]');
    expect(normalizarRota('/api/caixa/lancamentos/12345')).toBe('/api/caixa/lancamentos/[id]');
    expect(normalizarRota(`/api/empresas/${UUID.toUpperCase()}/contas/42`)).toBe('/api/empresas/[id]/contas/[id]');
  });
  it('datas viram [data]', () => {
    expect(normalizarRota('/api/caixa/meses/2026-11')).toBe('/api/caixa/meses/[data]');
    expect(normalizarRota('/api/agenda/2026-11-21')).toBe('/api/agenda/[data]');
    expect(normalizarRota('/ponto/21-11-2026')).toBe('/ponto/[data]');
  });
  it('query string e âncora somem', () => {
    expect(normalizarRota('/api/dp?empresa=abc&cpf=123.456.789-00&email=ana@x.com')).toBe('/api/dp');
    expect(normalizarRota('/caixa#lancamento-99')).toBe('/caixa');
    expect(normalizarRota('/api/caixa/livro?ano=2026&formato=pdf')).toBe('/api/caixa/livro');
  });
  it('e-mail, CPF, nome e texto codificado viram [id]', () => {
    expect(normalizarRota('/api/usuarios/ana.souza@escritorio.com.br')).toBe('/api/usuarios/[id]');
    expect(normalizarRota('/api/dp/123.456.789-00')).toBe('/api/dp/[id]');
    expect(normalizarRota('/api/dp/12345678900')).toBe('/api/dp/[id]');
    expect(normalizarRota('/api/funcionarios/Maria')).toBe('/api/funcionarios/[id]');
    expect(normalizarRota('/api/funcionarios/jos%C3%A9')).toBe('/api/funcionarios/[id]');
    expect(normalizarRota('/api/x/' + 'a'.repeat(41))).toBe('/api/x/[id]');
  });
  it('URL absoluta: só o caminho; barra final e repetida não importam', () => {
    expect(normalizarRota('https://app.exemplo.com.br/api/me?x=1')).toBe('/api/me');
    expect(normalizarRota('/caixa/resumo/')).toBe('/caixa/resumo');
    expect(normalizarRota('//api//me')).toBe('/api/me');
    expect(normalizarRota('')).toBe('/');
  });
  it('nome fixo de rota fica como está', () => {
    expect(normalizarRota('/api/envio-ponto/foto')).toBe('/api/envio-ponto/foto');
    expect(normalizarRota('/ponto-cadastros')).toBe('/ponto-cadastros');
  });
});

describe('lista fechada de rotas', () => {
  it('ROTAS_API bate com app/api/**/route.ts', () => {
    const reais = rotasDaApi().map((r) => r.caminho).sort();
    expect([...ROTAS_API].sort(), 'Rota de API criada ou removida: atualize ROTAS_API em lib/medicaoRotas.ts').toEqual(reais);
  });
  it('PAGINAS bate com app/**/page.tsx', () => {
    const reais = listarArquivos(join(RAIZ, 'app'), (n) => n === 'page.tsx')
      .map((a) => '/' + rel(a).replace(/^app\//, '').replace(/(^|\/)page\.tsx$/, '').split('/').filter((s) => s && !/^\(.*\)$/.test(s)).join('/'))
      .sort();
    expect([...PAGINAS].sort(), 'Tela criada ou removida: atualize PAGINAS em lib/medicaoRotas.ts').toEqual([...new Set(reais)].sort());
  });
  it('rota que não existe no app vira [outra], mesmo "limpa"', () => {
    expect(classificarRota('/api/dp')).toBe('/api/dp');
    expect(classificarRota('/api/dp?cpf=1')).toBe('/api/dp');
    expect(classificarRota('/api/funcionarios/joao-silva')).toBe(OUTRA_API);
    expect(classificarRota(`/api/dp/${UUID}`)).toBe(OUTRA_API);
    expect(classificarRota('/maria-souza')).toBe(OUTRA_TELA);
    expect(classificarRota('/caixa/resumo')).toBe('/caixa/resumo');
  });
  it('rota do arquivo (onRequestError) vira a rota HTTP', () => {
    expect(rotaDoArquivo('/app/api/dp/route')).toBe('/api/dp');
    expect(rotaDoArquivo('/api/caixa/livro/route')).toBe('/api/caixa/livro');
    expect(rotaDoArquivo('/(app)/painel/page')).toBe('/painel');
    expect(rotaDoArquivo('/app/(app)/page')).toBe('/');
    expect(rotaDoArquivo('/app/api/inexistente/route')).toBe(OUTRA_API);
  });
  it('telas públicas são telas conhecidas', () => {
    for (const t of TELAS_PUBLICAS) expect(PAGINAS).toContain(t);
  });
});

describe('código de erro — nunca a mensagem', () => {
  it('nome da classe e código do banco, sem texto livre', () => {
    expect(codigoDoErro(new TypeError('falhou para ana@x.com CPF 123.456.789-00'))).toBe('TypeError');
    expect(codigoDoErro(Object.assign(new Error('duplicate key (cpf)=(12345678900)'), { code: '23505' }))).toBe('Error:23505');
    expect(codigoDoErro({ name: 'PostgrestError', code: 'PGRST116', message: 'x' })).toBe('PostgrestError:PGRST116');
  });
  it('nome ou código esquisito não passa', () => {
    expect(codigoDoErro({ name: 'Erro de ana@x.com', code: 'abc def' })).toBe('Erro');
    expect(codigoDoErro('texto solto')).toBe('Erro');
    expect(codigoDoErro(null)).toBe('Erro');
    expect(ERRO_VALIDO.test(codigoDoErro({ name: 'X'.repeat(80) }))).toBe(true);
  });
});

describe('validarItem — o servidor não confia no navegador', () => {
  const api = { tipo: 'api', rota: '/api/dp', metodo: 'GET', status: 200, ms: 123.4, amostra: true };
  it('item bom passa, com a rota de novo normalizada', () => {
    expect(validarItem({ ...api, rota: '/api/dp?cpf=12345678900' })).toEqual({ tipo: 'api', rota: '/api/dp', metodo: 'GET', status: 200, ms: 123, erro: undefined, amostra: true });
  });
  it('campos extras (e-mail, escritório, corpo) são ignorados', () => {
    const v = validarItem({ ...api, email: 'ana@x.com', escritorio: 'esc-1', corpo: { cpf: '1' }, mensagem: 'x' });
    expect(Object.keys(v!).sort()).toEqual(['amostra', 'erro', 'metodo', 'ms', 'rota', 'status', 'tipo']);
  });
  it('fora da amostra só erro entra', () => {
    expect(validarItem({ ...api, amostra: false })).toBeNull();
    expect(validarItem({ ...api, amostra: false, status: 500 })).not.toBeNull();
    expect(validarItem({ ...api, amostra: false, status: 0, erro: 'rede' })).not.toBeNull();
    expect(validarItem({ tipo: 'pagina', rota: '/painel', metrica: 'LCP', ms: 900, amostra: false })).toBeNull();
  });
  it('lixo é descartado', () => {
    expect(validarItem(null)).toBeNull();
    expect(validarItem({ ...api, tipo: 'erro' })).toBeNull(); // o navegador não grava "erro de servidor"
    expect(validarItem({ ...api, metodo: 'HEAD' })).toBeNull();
    expect(validarItem({ ...api, status: 700 })).toBeNull();
    expect(validarItem({ ...api, rota: '/painel' })).toBeNull();
    expect(validarItem({ ...api, rota: 'x'.repeat(301) })).toBeNull();
    expect(validarItem({ tipo: 'pagina', rota: '/api/dp', metrica: 'LCP', ms: 1, amostra: true })).toBeNull();
    expect(validarItem({ tipo: 'pagina', rota: '/painel', metrica: 'CLS', ms: 1, amostra: true })).toBeNull();
    expect(validarItem({ tipo: 'pagina', rota: '/painel', metrica: 'LCP', amostra: true })).toBeNull();
  });
  it('ms fora da faixa vira vazio; erro com texto livre some', () => {
    expect(validarItem({ ...api, ms: -5 })!.ms).toBeUndefined();
    expect(validarItem({ ...api, ms: 10 * 60_000 })!.ms).toBeUndefined();
    expect(validarItem({ ...api, status: 500, erro: 'falhou para ana@x.com' })!.erro).toBeUndefined();
    // Do navegador só `rede`: nem um código "bem-formado" passa (seria canal de texto livre).
    expect(validarItem({ ...api, status: 500, erro: 'MariaSilva' })!.erro).toBeUndefined();
    expect(validarItem({ ...api, status: 500, erro: 'a:12345678901' })!.erro).toBeUndefined();
    expect(validarItem({ ...api, status: 0, erro: 'rede' })!.erro).toBe('rede');
  });
  it('visita não leva ms', () => {
    expect(validarItem({ tipo: 'pagina', rota: '/painel', metrica: 'VISITA', ms: 5, amostra: true }))
      .toEqual({ tipo: 'pagina', rota: '/painel', metrica: 'VISITA', ms: undefined, amostra: true });
  });
});

describe('o que o navegador mede', () => {
  it('só a própria /api, nunca o envio da medição', () => {
    expect(ehRotaDaApi('/api/dp')).toBe(true);
    expect(ehRotaDaApi('/api/medicao')).toBe(false);
    expect(ehRotaDaApi('/painel')).toBe(false);
  });
  it('erro = status ≥ 400, 0 (sem rede) ou código', () => {
    expect(ehErro(200)).toBe(false);
    expect(ehErro(404)).toBe(true);
    expect(ehErro(0)).toBe(true);
    expect(ehErro(200, 'rede')).toBe(true);
  });
});

describe('linha gravada — só rota, papel e números', () => {
  it('não tem coluna para id, e-mail, escritório ou empresa', () => {
    const l = linhaDoItem(validarItem({ tipo: 'api', rota: `/api/usuarios/ana@x.com?id=${UUID}`, metodo: 'DELETE', status: 403, ms: 50, amostra: false })!, 'usuario');
    expect(Object.keys(l).sort()).toEqual(['amostra', 'erro', 'metodo', 'metrica', 'ms', 'papel', 'rota', 'status', 'taxa', 'tipo']);
    expect(l.rota).toBe(OUTRA_API);
    expect(JSON.stringify(l)).not.toMatch(/@|ana|3f2a9c1e/);
  });
  it('a migração 0031 não tem coluna pessoal, tem RLS ligada e nenhuma policy', () => {
    const sql = readFileSync(join(RAIZ, 'supabase', 'migrations', '0031_medicoes.sql'), 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(sql).toMatch(/enable row level security/i);
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).not.toMatch(/\b(email|escritorio_id|empresa_id|usuario_id|cpf|nome|mensagem|query|corpo)\b/i);
  });
});

describe('resumirMedicoes', () => {
  const linha = (p: Partial<LinhaMedicao>): LinhaMedicao => ({
    tipo: 'api', rota: '/api/dp', metodo: 'GET', status: 200, ms: 100, metrica: null, erro: null, taxa: 0.25, amostra: true, ...p,
  });
  it('percentil por posição', () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentil(v, 50)).toBe(50);
    expect(percentil(v, 95)).toBe(95);
    expect(percentil([7], 95)).toBe(7);
    expect(percentil([], 50)).toBe(0);
  });
  it('rotas mais lentas por p95, até 10, só com a amostra', () => {
    const linhas: LinhaMedicao[] = [];
    for (let r = 0; r < 12; r++) for (let i = 1; i <= 20; i++) linhas.push(linha({ rota: `/api/r${'abcdefghijkl'[r]}`, ms: i * (r + 1) }));
    // Erro fora da amostra com tempo enorme não pode puxar o p95.
    linhas.push(linha({ rota: '/api/ra', ms: 99_999, status: 500, amostra: false }));
    const r = resumirMedicoes(linhas);
    expect(r.rotasLentas).toHaveLength(10);
    expect(r.rotasLentas[0]).toMatchObject({ rota: '/api/rl', n: 20, p50: 120, p95: 228 });
    expect(r.rotasLentas.find((x) => x.rota === '/api/ra')).toBeUndefined(); // ficou fora do top 10
  });
  it('erros contam tudo (amostra ou não), agrupados por rota e código', () => {
    const r = resumirMedicoes([
      linha({ status: 500, amostra: false }), linha({ status: 500 }), linha({ status: 403, amostra: false }),
      linha({ tipo: 'erro', metodo: null, status: null, ms: null, erro: 'TypeError', rota: '/api/caixa/livro', amostra: false, taxa: 1 }),
      linha({ status: 0, erro: 'rede', amostra: false }),
    ]);
    expect(r.erros[0]).toMatchObject({ rota: '/api/dp', codigo: '500', n: 2 });
    expect(r.erros.map((e) => e.codigo).sort()).toEqual(['403', '500', 'TypeError', 'rede']);
  });
  it('telas: LCP p50/p95, TTFB e INP; volume estimado pela taxa', () => {
    const r = resumirMedicoes([
      linha({ tipo: 'pagina', rota: '/painel', metodo: null, status: null, metrica: 'LCP', ms: 1000 }),
      linha({ tipo: 'pagina', rota: '/painel', metodo: null, status: null, metrica: 'LCP', ms: 3000 }),
      linha({ tipo: 'pagina', rota: '/painel', metodo: null, status: null, metrica: 'TTFB', ms: 200 }),
      linha({ tipo: 'pagina', rota: '/painel', metodo: null, status: null, metrica: 'INP', ms: 80 }),
      linha({ tipo: 'pagina', rota: '/painel', metodo: null, status: null, metrica: 'VISITA', ms: null }),
      linha({ tipo: 'pagina', rota: '/painel', metodo: null, status: null, metrica: 'VISITA', ms: null }),
      linha({ tipo: 'pagina', rota: '/caixa', metodo: null, status: null, metrica: 'VISITA', ms: null }),
    ]);
    expect(r.paginasLentas[0]).toEqual({ rota: '/painel', n: 2, p50: 1000, p95: 3000, ttfbP50: 200, inpP95: 80 });
    expect(r.volume).toEqual([{ rota: '/painel', visitas: 8 }, { rota: '/caixa', visitas: 4 }]);
  });
});

describe('gravarMedicoes — nunca derruba, sem 0031 não insiste', () => {
  afterEach(() => { _reiniciarMedicao(); db.atual = null; });
  const L = [{ tipo: 'api' as const, rota: '/api/dp', metodo: 'GET', status: 200, ms: 10, taxa: 0.25, amostra: true }];

  it('tabela ausente: não lança, devolve false e pausa as próximas tentativas', async () => {
    const insert = vi.fn(() => ({ abortSignal: async () => ({ error: { code: 'PGRST205', message: "Could not find the table 'public.medicoes'" } }) }));
    db.atual = { from: () => ({ insert }) };
    expect(await gravarMedicoes(L)).toBe(false);
    expect(await gravarMedicoes(L)).toBe(false);
    expect(insert).toHaveBeenCalledTimes(1);
  });
  it('banco sem configuração (getDb lança): false, sem exceção', async () => {
    db.atual = { from: () => { throw new Error('SUPABASE_SECRET_KEY não configurada.'); } };
    await expect(gravarMedicoes(L)).resolves.toBe(false);
  });
  it('grava e, de vez em quando, apaga o que passou de 30 dias', async () => {
    const insert = vi.fn(() => ({ abortSignal: async () => ({ error: null }) }));
    const lt = vi.fn(() => ({ abortSignal: async () => ({ error: null }) }));
    db.atual = { from: () => ({ insert, delete: () => ({ lt }) }) };
    expect(await gravarMedicoes(L, () => 0.9)).toBe(true);
    expect(lt).not.toHaveBeenCalled();
    expect(await gravarMedicoes(L, () => 0)).toBe(true);
    expect(lt).toHaveBeenCalledWith('em', expect.any(String));
    const corte = new Date((lt.mock.calls[0] as unknown as [string, string])[1]).getTime();
    expect(Math.round((Date.now() - corte) / 86_400_000)).toBe(30);
  });
  it('banco lento (prazo estourado): não lança e pausa um minuto', async () => {
    const insert = vi.fn(() => ({ abortSignal: async () => { throw new DOMException('timeout', 'TimeoutError'); } }));
    db.atual = { from: () => ({ insert }) };
    expect(await gravarMedicoes(L)).toBe(false);
    expect(await gravarMedicoes(L)).toBe(false);
    expect(insert).toHaveBeenCalledTimes(1);
  });
  it('reconhece tabela ausente pelo código do Postgres e do PostgREST', () => {
    expect(ehTabelaAusente({ code: '42P01' })).toBe(true);
    expect(ehTabelaAusente({ code: 'PGRST205' })).toBe(true);
    expect(ehTabelaAusente({ code: '23505' })).toBe(false);
  });
});
