// Gravar em empresa arquivada: 409 com "reative em Cadastros"; o resto segue 403.
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { criarSessao, COOKIE_SESSAO, type Sessao } from '@/lib/auth';

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

const { podeAcessarEmpresa, motivoNegado, respostaNegadaEmpresa, exigirEmpresa } = await import('@/lib/acesso');

const exp = Date.now() + 3_600_000;
const contadorA: Sessao = { email: 'c@a.com', nome: 'A', role: 'usuario', escritorioId: A, exp };
const master: Sessao = { email: 'm@x.com', nome: 'M', role: 'master', exp };
const clienteArq: Sessao = { email: 'cli@x.com', nome: 'C', role: 'cliente', escritorioId: A, empresa: 'arq', exp };

describe('motivoNegado', () => {
  it('contador/master gravando na arquivada do escritório → 409 com a mensagem de reativar', async () => {
    expect(await motivoNegado({ ...contadorA, escrita: true }, 'arq')).toEqual({
      status: 409, erro: 'Empresa arquivada — reative em Cadastros para alterar', codigo: 'empresa_arquivada',
    });
    expect((await motivoNegado({ ...master, escrita: true }, 'arq'))?.status).toBe(409);
  });
  it('leitura e empresa ativa passam (null)', async () => {
    expect(await motivoNegado(contadorA, 'arq')).toBeNull();
    expect(await motivoNegado({ ...contadorA, escrita: true }, 'ativa')).toBeNull();
    expect(await motivoNegado(master, 'arq')).toBeNull();
  });
  it('arquivada de OUTRO escritório: 403 genérico, mesmo gravando (não revela que existe)', async () => {
    expect(await motivoNegado({ ...contadorA, escrita: true }, 'arq-b')).toMatchObject({ status: 403, erro: 'Acesso restrito a esta empresa.' });
    expect(await motivoNegado(contadorA, 'arq-b')).toMatchObject({ status: 403 });
  });
  it('cliente na arquivada, empresa inexistente e id vazio: 403', async () => {
    expect(await motivoNegado({ ...clienteArq, escrita: true }, 'arq')).toMatchObject({ status: 403 });
    expect(await motivoNegado(clienteArq, 'arq')).toMatchObject({ status: 403 });
    expect(await motivoNegado({ ...contadorA, escrita: true }, 'nao-existe')).toMatchObject({ status: 403 });
    expect(await motivoNegado(contadorA, '  ')).toMatchObject({ status: 403 });
  });
  it('respostaNegadaEmpresa devolve a Response 409 com código', async () => {
    const r = await respostaNegadaEmpresa({ ...contadorA, escrita: true }, 'arq');
    expect(r?.status).toBe(409);
    expect(await r?.json()).toMatchObject({ codigo: 'empresa_arquivada' });
    expect(await respostaNegadaEmpresa({ ...contadorA, escrita: true }, 'ativa')).toBeNull();
  });
  it('podeAcessarEmpresa segue com o mesmo veredito (true/false)', async () => {
    expect(await podeAcessarEmpresa({ ...contadorA, escrita: true }, 'arq')).toBe(false);
    expect(await podeAcessarEmpresa(contadorA, 'arq')).toBe(true);
    expect(await podeAcessarEmpresa({ ...contadorA, escrita: true }, 'arq-b')).toBe(false);
  });
});

describe('exigirEmpresa', () => {
  it('POST na arquivada → 409; ativa e GET na arquivada → ok; outro escritório → 403', async () => {
    const token = await criarSessao({ ...contadorA, modulos: ['caixa', 'ponto'] });
    const req = (metodo: string) => new NextRequest(new URL('http://localhost/api/caixa/lancamentos'), {
      method: metodo, headers: { cookie: `${COOKIE_SESSAO}=${token}` },
    });
    const g1 = await exigirEmpresa(req('POST'), 'arq');
    expect(!g1.ok && g1.resposta.status).toBe(409);
    expect((await exigirEmpresa(req('POST'), 'ativa')).ok).toBe(true);
    expect((await exigirEmpresa(req('GET'), 'arq')).ok).toBe(true);
    const g2 = await exigirEmpresa(req('POST'), 'arq-b');
    expect(!g2.ok && g2.resposta.status).toBe(403);
  });
});
