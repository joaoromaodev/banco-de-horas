// Empresa arquivada: consulta sem reativar. Regras puras + guarda central + proxy (409).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { criarSessao, COOKIE_SESSAO, type Sessao } from '@/lib/auth';
import {
  acessoAArquivada, citaArquivada, ehEscritaDeDados, empresasCitadas, faixaArquivada,
} from '@/lib/arquivamento';
import { resolverDiaPrazo } from '@/lib/fechamento';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const EMPRESAS = [
  { id: 'ativa', nome: 'Ativa', escritorioId: A, arquivadaEm: null },
  { id: 'arq', nome: 'Arq', escritorioId: A, arquivadaEm: '2026-11-01T12:00:00Z' },
  { id: 'arq-b', nome: 'ArqB', escritorioId: B, arquivadaEm: '2026-11-01T12:00:00Z' },
];
vi.mock('@/lib/cadastro', () => ({
  lerEmpresasComArquivadas: async () => EMPRESAS,
  lerEmpresas: async () => EMPRESAS.filter((e) => !e.arquivadaEm),
  lerEmpresa: async (id: string) => EMPRESAS.find((e) => e.id === id) ?? null,
  buscarUsuario: async () => null,
}));
vi.mock('@/lib/cobrancaServidor', () => ({ situacaoDoEscritorio: async () => null }));

const { podeAcessarEmpresa } = await import('@/lib/acesso');
const { proxy } = await import('@/proxy');

const exp = Date.now() + 3_600_000;
const contadorA: Sessao = { email: 'c@a.com', nome: 'A', role: 'usuario', escritorioId: A, exp };
const master: Sessao = { email: 'm@x.com', nome: 'M', role: 'master', exp };
const clienteArq: Sessao = { email: 'cli@x.com', nome: 'C', role: 'cliente', escritorioId: A, empresa: 'arq', exp };

describe('regras puras', () => {
  it('escrita de dados: método e caminho', () => {
    expect(ehEscritaDeDados('GET', '/api/caixa/lancamentos')).toBe(false);
    expect(ehEscritaDeDados('POST', '/api/caixa/lancamentos')).toBe(true);
    expect(ehEscritaDeDados('DELETE', '/api/contratos')).toBe(true);
    expect(ehEscritaDeDados('POST', '/api/gerar')).toBe(false); // exportação
    expect(ehEscritaDeDados('POST', '/api/contratos/documento')).toBe(false);
    expect(ehEscritaDeDados('PATCH', '/api/empresas')).toBe(false); // arquivar/reativar tem regra própria
    expect(ehEscritaDeDados('POST', '/api/logout')).toBe(false);
  });
  it('acesso à arquivada: só leitura e só a contabilidade', () => {
    expect(acessoAArquivada('usuario', false)).toBe(true);
    expect(acessoAArquivada('master', false)).toBe(true);
    expect(acessoAArquivada('usuario', true)).toBe(false);
    expect(acessoAArquivada('master', true)).toBe(false);
    expect(acessoAArquivada('cliente', false)).toBe(false);
  });
  it('empresas citadas na consulta e no corpo', () => {
    expect(empresasCitadas(new URLSearchParams('empresa=x'), { empresas: ['y', ' z '], frequencia: { empresa: 'w' } }).sort())
      .toEqual(['w', 'x', 'y', 'z']);
    expect(empresasCitadas(new URLSearchParams(), null)).toEqual([]);
    expect(citaArquivada(['ativa'], EMPRESAS)).toBe(false);
    expect(citaArquivada(['ativa', 'arq'], EMPRESAS)).toBe(true);
  });
  it('faixa com a data', () => {
    expect(faixaArquivada('2026-11-01T12:00:00Z')).toBe('Empresa arquivada em 01/11/2026 — somente consulta');
    expect(faixaArquivada(null)).toBe('Empresa arquivada — somente consulta');
  });
  it('dia de prazo: vem → valida; não vem → padrão do escritório', () => {
    expect(resolverDiaPrazo(undefined, 15)).toBe(15);
    expect(resolverDiaPrazo(null, 15)).toBe(15);
    expect(resolverDiaPrazo('', 15)).toBe(15);
    expect(resolverDiaPrazo(5, 15)).toBe(5);
    expect(resolverDiaPrazo('7', 15)).toBe(7);
    expect(resolverDiaPrazo(0, 15)).toBeNull();
    expect(resolverDiaPrazo(29, 15)).toBeNull();
    expect(resolverDiaPrazo(3.5, 15)).toBeNull();
    expect(resolverDiaPrazo('abc', 15)).toBeNull();
    expect(resolverDiaPrazo(undefined, 99)).toBe(10); // padrão inválido cai em 10
  });
});

describe('podeAcessarEmpresa (guarda central)', () => {
  it('contador consulta a arquivada do próprio escritório, mas não grava', async () => {
    expect(await podeAcessarEmpresa(contadorA, 'arq')).toBe(true);
    expect(await podeAcessarEmpresa({ ...contadorA, escrita: true }, 'arq')).toBe(false);
    expect(await podeAcessarEmpresa({ ...contadorA, escrita: true }, 'ativa')).toBe(true);
  });
  it('arquivada de outro escritório continua negada, até para leitura', async () => {
    expect(await podeAcessarEmpresa(contadorA, 'arq-b')).toBe(false);
  });
  it('master lê; escrita em arquivada é negada', async () => {
    expect(await podeAcessarEmpresa(master, 'arq')).toBe(true);
    expect(await podeAcessarEmpresa({ ...master, escrita: true }, 'arq')).toBe(false);
    expect(await podeAcessarEmpresa({ ...master, escrita: true }, 'ativa')).toBe(true);
  });
  it('cliente de empresa arquivada não entra', async () => {
    expect(await podeAcessarEmpresa(clienteArq, 'arq')).toBe(false);
  });
});

describe('proxy — escrita em empresa arquivada', () => {
  let token = '';
  beforeEach(async () => { token = await criarSessao({ ...contadorA, modulos: ['caixa', 'ponto'] }); });
  const chamar = (metodo: string, caminho: string, corpo?: unknown) => proxy(new NextRequest(new URL(caminho, 'http://localhost'), {
    method: metodo,
    headers: { cookie: `${COOKIE_SESSAO}=${token}`, ...(corpo ? { 'content-type': 'application/json', 'content-length': String(JSON.stringify(corpo).length) } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  }));

  it('escrita com ?empresa= arquivada → 409 com código', async () => {
    const r = await chamar('DELETE', '/api/contratos?empresa=arq&id=1');
    expect(r.status).toBe(409);
    const d = await r.json();
    expect(d.codigo).toBe('empresa_arquivada');
    expect(d.erro).toMatch(/arquivada/);
  });
  it('escrita com corpo citando arquivada → 409', async () => {
    expect((await chamar('POST', '/api/caixa/lancamentos', { empresa: 'arq', valor: 1 })).status).toBe(409);
    expect((await chamar('POST', '/api/pendencias-recorrentes', { empresas: ['ativa', 'arq'], itens: [] })).status).toBe(409);
  });
  it('empresa ativa, leitura e exportação passam', async () => {
    expect((await chamar('POST', '/api/caixa/lancamentos', { empresa: 'ativa' })).status).toBe(200);
    expect((await chamar('GET', '/api/caixa/lancamentos?empresa=arq')).status).toBe(200);
    expect((await chamar('POST', '/api/gerar', { frequencia: { empresa: 'arq' } })).status).toBe(200);
  });
  it('reativar (PATCH /api/empresas) não é barrado pela faixa', async () => {
    expect((await chamar('PATCH', '/api/empresas', { id: 'arq', acao: 'reativar' })).status).toBe(200);
  });
});
