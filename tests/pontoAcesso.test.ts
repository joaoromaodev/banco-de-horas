// Isolamento entre escritórios nas guardas do ponto. Usa a regra real de
// lib/acesso.ts + lib/visibilidade.ts; só o cadastro (banco) é simulado.
import { describe, expect, it, vi } from 'vitest';
import type { Empresa } from '@/lib/tipos';

const EMPRESAS: Empresa[] = [
  { id: 'emp-a', nome: 'Empresa A', trabalhaSabado: false, escritorioId: 'esc-a' },
  { id: 'emp-b', nome: 'Empresa B', trabalhaSabado: false, escritorioId: 'esc-b' },
  { id: 'emp-orfa', nome: 'Sem escritório', trabalhaSabado: false, escritorioId: null },
];

vi.mock('@/lib/cadastro', () => ({
  lerEmpresas: async () => EMPRESAS,
  lerEmpresasComArquivadas: async () => EMPRESAS,
  lerEmpresa: async (id: string) => EMPRESAS.find((e) => e.id === id) ?? null,
  buscarUsuario: async () => null,
}));

const { escritorioDaEmpresa, respostaErroPonto } = await import('@/lib/pontoAcesso');
const { ErroBancoPendente } = await import('@/lib/pontoDb');

const contadorA = { email: 'a@x.com', nome: 'A', role: 'usuario' as const, modulos: [], escritorioId: 'esc-a', exp: 0 };
const master = { email: 'm@x.com', nome: 'M', role: 'master' as const, modulos: [], exp: 0 };
const clienteA = { email: 'c@x.com', nome: 'C', role: 'cliente' as const, modulos: [], escritorioId: 'esc-a', empresa: 'emp-a', exp: 0 };

describe('escritorioDaEmpresa', () => {
  it('contador alcança empresa do próprio escritório, com o escritório da empresa', async () => {
    expect(await escritorioDaEmpresa(contadorA, 'emp-a')).toMatchObject({ escritorioId: 'esc-a', empresa: { id: 'emp-a' } });
  });

  it('contador do escritório A NÃO alcança empresa do B', async () => {
    expect(await escritorioDaEmpresa(contadorA, 'emp-b')).toBeNull();
  });

  it('contador sem escritório na sessão não alcança nada', async () => {
    expect(await escritorioDaEmpresa({ ...contadorA, escritorioId: undefined }, 'emp-a')).toBeNull();
  });

  it('master usa o escritório da empresa (cota e dados caem no escritório certo)', async () => {
    expect(await escritorioDaEmpresa(master, 'emp-b')).toMatchObject({ escritorioId: 'esc-b' });
  });

  it('empresa sem escritório ou inexistente: falha fechada, até para o master', async () => {
    expect(await escritorioDaEmpresa(master, 'emp-orfa')).toBeNull();
    expect(await escritorioDaEmpresa(master, 'nao-existe')).toBeNull();
    expect(await escritorioDaEmpresa(contadorA, '')).toBeNull();
  });

  it('cliente de outra empresa não passa (a rota ainda exige gestor antes)', async () => {
    expect(await escritorioDaEmpresa(clienteA, 'emp-b')).toBeNull();
  });
});

describe('respostaErroPonto', () => {
  it('banco sem a 0012 → 503 com aguardandoBanco', async () => {
    const r = respostaErroPonto(new ErroBancoPendente(), 'x');
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({ aguardandoBanco: true });
  });

  it('outro erro → 502 com texto genérico, sem o detalhe interno', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = respostaErroPonto(new Error('duplicate key value violates constraint ponto_x'), 'Falha ao salvar.');
    expect(r.status).toBe(502);
    expect(await r.json()).toEqual({ erro: 'Falha ao salvar.' });
    erro.mockRestore();
  });
});
