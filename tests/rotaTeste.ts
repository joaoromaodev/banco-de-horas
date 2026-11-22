// Peças comuns dos testes de fluxo de rota: escritórios, empresas e sessões de
// teste, e o pedido HTTP com o cookie de sessão ASSINADO de verdade — as guardas
// de lib/acesso.ts rodam sem mock (só o cadastro e o banco são simulados).
import { NextRequest } from 'next/server';
import { criarSessao, COOKIE_SESSAO, type Sessao } from '@/lib/auth';

export const ESC_A = '00000000-0000-4000-8000-00000000000a';
export const ESC_B = '00000000-0000-4000-8000-00000000000b';

export interface EmpresaTeste {
  id: string; nome: string; escritorioId: string; arquivadaEm?: string | null;
  cnpj?: string; tipoPessoa?: 'fisica' | 'juridica'; trabalhaSabado: boolean;
}

/** emp-a1 e emp-a2 no escritório A; emp-b1 no B; emp-arq arquivada no A. */
export const empresasTeste = (): Record<string, EmpresaTeste> => ({
  'emp-a1': { id: 'emp-a1', nome: 'Padaria A1', escritorioId: ESC_A, cnpj: '11222333000181', trabalhaSabado: false },
  'emp-a2': { id: 'emp-a2', nome: 'Oficina A2', escritorioId: ESC_A, trabalhaSabado: false },
  'emp-b1': { id: 'emp-b1', nome: 'Mercado B1', escritorioId: ESC_B, trabalhaSabado: false },
  'emp-arq': { id: 'emp-arq', nome: 'Antiga Arq', escritorioId: ESC_A, arquivadaEm: '2026-06-01T12:00:00Z', trabalhaSabado: false },
});

export const SESSOES = {
  contadorA: { email: 'c@a.com', nome: 'Contadora A', role: 'usuario', escritorioId: ESC_A, modulos: ['caixa', 'ponto'] },
  contadorB: { email: 'c@b.com', nome: 'Contador B', role: 'usuario', escritorioId: ESC_B, modulos: ['caixa', 'ponto'] },
  // Outra pessoa da contabilidade do MESMO escritório A (ex.: "só quem iniciou o envio confirma").
  contador2A: { email: 'c2@a.com', nome: 'Contadora 2 A', role: 'usuario', escritorioId: ESC_A, modulos: ['caixa', 'ponto'] },
  clienteA1: { email: 'cli@a1.com', nome: 'Cliente A1', role: 'cliente', escritorioId: ESC_A, empresa: 'emp-a1', modulos: ['caixa'] },
  clienteA2: { email: 'cli@a2.com', nome: 'Cliente A2', role: 'cliente', escritorioId: ESC_A, empresa: 'emp-a2', modulos: ['caixa'] },
  clienteArq: { email: 'cli@arq.com', nome: 'Cliente Arq', role: 'cliente', escritorioId: ESC_A, empresa: 'emp-arq', modulos: ['caixa'] },
} satisfies Record<string, Omit<Sessao, 'exp'>>;
export type QuemTeste = keyof typeof SESSOES;

/**
 * Pedido como o navegador faz: URL com o caminho real (a guarda decide "é escrita?"
 * pelo método + caminho), corpo JSON e o cookie da sessão.
 */
export async function pedido(
  quem: QuemTeste | null, url: string, init: { method?: string; body?: unknown } = {},
): Promise<NextRequest> {
  const headers: Record<string, string> = {};
  if (quem) headers.cookie = `${COOKIE_SESSAO}=${await criarSessao(SESSOES[quem] as Omit<Sessao, 'exp'>)}`;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(new URL(url, 'http://localhost'), {
    method: init.method ?? 'GET',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/**
 * Mock de `@/lib/cadastro` (o real lê o Supabase), com a mesma regra de produção:
 * as listas (`lerEmpresas`) escondem arquivadas; `lerEmpresa(id)` e
 * `lerEmpresasComArquivadas` as incluem (a consulta de arquivada lê por eles).
 */
export function cadastroFalso(empresas: () => Record<string, EmpresaTeste>) {
  const visiveis = () => Object.values(empresas()).filter((e) => !e.arquivadaEm);
  return {
    lerEmpresa: async (id: string) => empresas()[id] ?? null,
    lerEmpresas: async () => visiveis(),
    lerEmpresasComArquivadas: async () => Object.values(empresas()),
    buscarUsuario: async () => null,
  };
}
