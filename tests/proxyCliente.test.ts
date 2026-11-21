// Varredura do proxy para o papel `cliente`. Lê as telas que o cliente abre de
// fato (/inicio, /caixa, /documentos, /enviar-ponto e o layout com o sino), segue
// os imports e junta todo `/api/...` citado. Confere, passando pelo proxy.ts de
// verdade, que:
//   1. tudo o que essas telas chamam está em CLIENTE_PODE (senão a tela quebra);
//   2. todo prefixo de API em CLIENTE_PODE é usado por alguma tela do cliente;
//   3. rota sob um prefixo do cliente que nenhuma tela do cliente usa é da
//      contabilidade: cada handler dela exige gestor (exigirGestor/Master/Admin);
//   4. o resto da API (fora de CLIENTE_PODE e do PUBLICO) devolve 403 ao cliente.
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { criarSessao, COOKIE_SESSAO, type Sessao } from '@/lib/auth';
import {
  alcancaveis, apisCitadas, arrayLiteral, cadeiaAteGuarda, casaCom, corpoDoHandler, GUARDAS_GESTOR, handlers,
  listarArquivos, RAIZ, rel, rotasDaApi,
} from './varreduraRotas';

vi.mock('@/lib/cobrancaServidor', () => ({ situacaoDoEscritorio: vi.fn(async () => null) }));
const { proxy } = await import('@/proxy');

const PROXY = join(RAIZ, 'proxy.ts');
const CLIENTE_PODE = arrayLiteral(PROXY, 'CLIENTE_PODE');
const PUBLICO = arrayLiteral(PROXY, 'PUBLICO');
const API_CLIENTE = CLIENTE_PODE.filter((p) => p.startsWith('/api/'));

/** Telas do cliente: as páginas dessas pastas e o layout que as envolve (sino, faixa, /api/me). */
const TELAS_CLIENTE = ['inicio', 'caixa', 'documentos', 'enviar-ponto'];
const APP = join(RAIZ, 'app', '(app)');
const ENTRADAS = [
  join(APP, 'layout.tsx'),
  ...TELAS_CLIENTE.flatMap((t) => listarArquivos(join(APP, t), (n) => n === 'page.tsx')),
];
const ARQUIVOS = alcancaveis(ENTRADAS);
// Em lib/ só contam os módulos que de fato chamam a API do navegador (`fetch(`):
// lib/cobranca.ts e lib/arquivamento.ts citam caminhos como REGRA, não como chamada.
const ARQUIVOS_DE_TELA = ARQUIVOS.filter((a) => !rel(a).startsWith('lib/') || /\bfetch\(/.test(readFileSync(a, 'utf8')));
const CITADAS = apisCitadas(ARQUIVOS_DE_TELA);

/**
 * Rotas sob prefixo do cliente, que nenhuma tela do cliente chama, mas que o
 * cliente pode alcançar por decisão (a rota recorta por papel/registro). Cada uma
 * com o porquê; o resto tem de ser só da contabilidade.
 */
const COMPARTILHADAS_SEM_TELA: Record<string, string> = {
  '/api/envio-ponto/foto': 'A foto do próprio envio; a rota recorta pelo registro (podeVerEnvio) — ver envioPontoRotas.test.ts.',
};

const cliente: Omit<Sessao, 'exp'> = { email: 'cli@x.com', nome: 'Cli', role: 'cliente', escritorioId: 'esc', empresa: 'emp', modulos: ['caixa'] };

async function irComo(s: Omit<Sessao, 'exp'>, caminho: string) {
  const cookie = `${COOKIE_SESSAO}=${await criarSessao(s)}`;
  return proxy(new NextRequest(new URL(caminho, 'http://localhost'), { headers: { cookie } }));
}

describe('varredura do proxy (papel cliente)', () => {
  it('a varredura enxerga as telas e as chamadas (não está cega)', () => {
    expect(ENTRADAS.length).toBeGreaterThanOrEqual(5);
    expect(API_CLIENTE.length).toBeGreaterThan(5);
    for (const esperado of ['/api/me', '/api/inicio-cliente', '/api/caixa/lancamentos', '/api/envio-ponto', '/api/documentos', '/api/notificacoes']) {
      expect(CITADAS.has(esperado), `as telas do cliente deveriam citar ${esperado}`).toBe(true);
    }
  });

  it('as telas do cliente passam no proxy', async () => {
    for (const t of TELAS_CLIENTE) {
      const r = await irComo(cliente, `/${t}`);
      expect(r.status, `/${t} redireciona o cliente — está em CLIENTE_PODE?`).toBe(200);
    }
  });

  it('1. toda API que as telas do cliente chamam está em CLIENTE_PODE', async () => {
    const barradas: string[] = [];
    for (const [api, de] of CITADAS) {
      const r = await irComo(cliente, api);
      if (r.status !== 200) barradas.push(`${api} (status ${r.status}; citada em ${de.join(', ')})`);
    }
    expect(barradas, [
      'A tela do cliente chama uma API que o proxy barra para o cliente:',
      ...barradas.map((b) => `  - ${b}`),
      'O que fazer: se o cliente precisa dela, acrescente o prefixo em CLIENTE_PODE (proxy.ts) e garanta que a rota',
      'recorta pela empresa da sessão (exigirEmpresa / exigirClienteDaEmpresa). Se a chamada é só da contabilidade,',
      'deixe-a fora do caminho do cliente na tela.',
    ].join('\n')).toEqual([]);
  });

  it('2. todo prefixo de API em CLIENTE_PODE é usado por alguma tela do cliente', () => {
    const sobrando = API_CLIENTE.filter((p) => ![...CITADAS.keys()].some((c) => casaCom([p], c)));
    expect(sobrando, `CLIENTE_PODE libera ${sobrando.join(', ')} mas nenhuma tela do cliente usa. Tire de CLIENTE_PODE (o cliente não deve alcançar API sem tela) ou ajuste TELAS_CLIENTE neste teste.`).toEqual([]);
  });

  it('3. rota sob prefixo do cliente sem uso nas telas do cliente é só da contabilidade', () => {
    const abertas: string[] = [];
    const conferidas: string[] = [];
    for (const { arquivo, caminho } of rotasDaApi()) {
      if (!casaCom(API_CLIENTE, caminho) || CITADAS.has(caminho) || COMPARTILHADAS_SEM_TELA[caminho]) continue;
      conferidas.push(caminho);
      for (const m of handlers(arquivo)) {
        if (!cadeiaAteGuarda(arquivo, corpoDoHandler(arquivo, m), GUARDAS_GESTOR)) abertas.push(`${m} ${caminho} (${rel(arquivo)})`);
      }
    }
    // Hoje: /api/caixa/de-para e /api/caixa/seed (a varredura não pode passar vazia).
    expect(conferidas).toEqual(expect.arrayContaining(['/api/caixa/de-para', '/api/caixa/seed']));
    expect(abertas, [
      'Rota alcançável pelo cliente (prefixo em CLIENTE_PODE), sem tela do cliente que a use e sem exigir gestor:',
      ...abertas.map((a) => `  - ${a}`),
      'O que fazer: se é da contabilidade, use exigirGestor (lib/acesso.ts) no handler. Se o cliente usa por decisão,',
      'registre em COMPARTILHADAS_SEM_TELA neste teste, com o motivo, e cubra o recorte num teste de rota.',
    ].join('\n')).toEqual([]);
  });

  it('as exceções compartilhadas continuam existindo e sob prefixo do cliente', () => {
    const caminhos = new Set(rotasDaApi().map((r) => r.caminho));
    for (const c of Object.keys(COMPARTILHADAS_SEM_TELA)) {
      expect(caminhos.has(c), `${c} sumiu — tire de COMPARTILHADAS_SEM_TELA`).toBe(true);
      expect(casaCom(API_CLIENTE, c), `${c} saiu de CLIENTE_PODE — tire de COMPARTILHADAS_SEM_TELA`).toBe(true);
    }
  });

  it('4. API da contabilidade (fora de CLIENTE_PODE e do PUBLICO) → 403 para o cliente', async () => {
    const vazadas: string[] = [];
    let conferidas = 0;
    for (const { caminho } of rotasDaApi()) {
      if (casaCom(CLIENTE_PODE, caminho) || casaCom(PUBLICO, caminho)) continue;
      conferidas++;
      for (const metodo of ['GET', 'POST']) {
        const cookie = `${COOKIE_SESSAO}=${await criarSessao(cliente)}`;
        const r = await proxy(new NextRequest(new URL(caminho, 'http://localhost'), { method: metodo, headers: { cookie } }));
        if (r.status !== 403) vazadas.push(`${metodo} ${caminho} → ${r.status}`);
      }
    }
    expect(conferidas).toBeGreaterThan(30);
    expect(vazadas, `API da contabilidade alcançável pelo cliente:\n${vazadas.join('\n')}`).toEqual([]);
    // Amostras explícitas — se alguém puser um prefixo largo demais em CLIENTE_PODE, quebra aqui.
    for (const c of ['/api/painel', '/api/agenda', '/api/dp', '/api/contratos', '/api/usuarios', '/api/escritorio', '/api/cobranca', '/api/folha', '/api/salvar', '/api/extrair', '/api/pendencias-recorrentes', '/api/config']) {
      expect((await irComo(cliente, c)).status, `${c} não pode ser do cliente`).toBe(403);
    }
  });
});
