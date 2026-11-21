// Contrato das rotas do Departamento Pessoal: tenta furar o isolamento entre
// escritórios, chegar como cliente e gravar em empresa arquivada. Banco simulado
// (vi.mock de lib/dpServidor e lib/cadastro); a guarda de empresa é a real
// (lib/pontoAcesso + podeAcessarEmpresa de lib/acesso).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Sessao } from '@/lib/auth';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const EMP_A = '11111111-1111-4111-8111-111111111111';
const FER_A = '22222222-2222-4222-8222-222222222222';
const EMP_ARQ = '33333333-3333-4333-8333-333333333333';

const exp = Date.now() + 3_600_000;
const SESSOES: Record<string, Sessao> = {
  contadorA: { email: 'c@a.com', nome: 'A', role: 'usuario', escritorioId: A, modulos: ['ponto'], exp },
  contadorB: { email: 'c@b.com', nome: 'B', role: 'usuario', escritorioId: B, modulos: ['ponto'], exp },
  clienteA: { email: 'cli@a.com', nome: 'CA', role: 'cliente', escritorioId: A, empresa: 'emp-a', modulos: ['caixa'], exp },
};
let sessaoAtual: Sessao | null = null;

const EMPRESAS = [
  { id: 'emp-a', nome: 'A', escritorioId: A, trabalhaSabado: false, arquivadaEm: null as string | null },
  { id: 'emp-b', nome: 'B', escritorioId: B, trabalhaSabado: false, arquivadaEm: null as string | null },
  { id: 'emp-arq', nome: 'Arq', escritorioId: A, trabalhaSabado: false, arquivadaEm: '2026-11-01T00:00:00Z' as string | null },
];

vi.mock('@/lib/cadastro', () => ({
  lerEmpresa: async (id: string) => EMPRESAS.find((e) => e.id === id) ?? null,
  lerEmpresas: async () => EMPRESAS.filter((e) => !e.arquivadaEm),
  lerEmpresasComArquivadas: async () => EMPRESAS,
  buscarUsuario: async () => null,
}));
vi.mock('@/lib/cobrancaServidor', () => ({ situacaoDoEscritorio: vi.fn(async () => null) }));

vi.mock('@/lib/acesso', async (orig) => {
  const real = await orig<typeof import('@/lib/acesso')>();
  const negar = (msg: string, status: number) => ({ ok: false as const, resposta: Response.json({ erro: msg }, { status }) });
  const comEscrita = (req: NextRequest) => (sessaoAtual && !['GET', 'HEAD'].includes(req.method) ? { ...sessaoAtual, escrita: true } : sessaoAtual);
  return {
    ...real,
    exigirGestor: async (req: NextRequest) => {
      const s = comEscrita(req);
      if (!s) return negar('Não autenticado.', 401);
      if (s.role === 'cliente') return negar('Acesso restrito.', 403);
      return { ok: true as const, sessao: s };
    },
  };
});

const empregado = (id: string, empresaId: string, escritorioId: string) => ({
  id, escritorioId, empresaId, nome: 'MARIA', cpf: '52998224725', cargo: null, admissao: '2025-03-10', salarioBase: 2000,
  horasSemanais: 44, escala: null, dsr: 0, bancoHoras: false, bancoHorasDesde: null, situacao: 'ativo', situacaoDesde: null,
  afastamentoTipo: null, aquisitivoBase: null, origem: 'manual', atualizadoEm: null, atualizadoPor: null,
});
const EMPREGADOS: Record<string, ReturnType<typeof empregado>> = {
  [EMP_A]: empregado(EMP_A, 'emp-a', A),
  [EMP_ARQ]: empregado(EMP_ARQ, 'emp-arq', A),
};
const FERIAS = {
  [FER_A]: { id: FER_A, empregadoId: EMP_A, empresaId: 'emp-a', escritorioId: A, aquisitivoInicio: '2025-03-10', inicio: '2027-01-04', dias: 30, abonoDias: 0, avisoEm: null, pagamentoEm: null, excluida: false },
};
const gravacoes: string[] = [];

vi.mock('@/lib/dpServidor', async (orig) => {
  const real = await orig<typeof import('@/lib/dpServidor')>();
  return {
    ...real,
    lerEmpregado: async (id: string) => EMPREGADOS[id] ?? null,
    lerFerias: async (id: string) => (FERIAS as Record<string, (typeof FERIAS)[typeof FER_A]>)[id] ?? null,
    listarEmpregados: async (esc: string | null, empresas?: string[]) => Object.values(EMPREGADOS).filter((e) => (!esc || e.escritorioId === esc) && (!empresas || empresas.includes(e.empresaId))),
    listarFerias: async () => [],
    lerFaltas: async (_e: unknown, emps: { id: string }[]) => new Map(emps.map((e) => [e.id, []])),
    mesesComPonto: async () => [],
    funcionarioDoPonto: async () => null,
    // Março/26 com 2 h de HE num dia útil (08–12 e 13–19 = 10 h; jornada 8 h).
    lerPontoDoEmpregado: async () => new Map([['2026-03', [
      { dia: 10, entradaManha: '08:00', saidaAlmoco: '12:00', retornoAlmoco: '13:00', saidaTarde: '19:00', marcador: null },
    ]]]),
    criarEmpregado: async () => { gravacoes.push('criarEmpregado'); return EMPREGADOS[EMP_A]; },
    atualizarEmpregado: async () => { gravacoes.push('atualizarEmpregado'); return EMPREGADOS[EMP_A]; },
    criarFerias: async () => { gravacoes.push('criarFerias'); return FERIAS[FER_A]; },
    excluirFerias: async () => { gravacoes.push('excluirFerias'); },
  };
});
vi.mock('@/lib/pontoDb', async (orig) => ({ ...(await orig<typeof import('@/lib/pontoDb')>()), lerFeriados: async () => [] }));

const lista = await import('@/app/api/dp/route');
const ficha = await import('@/app/api/dp/empregado/route');
const ferias = await import('@/app/api/dp/ferias/route');
const documento = await import('@/app/api/dp/documento/route');
const medias = await import('@/app/api/dp/medias/route');

const req = (url: string, init?: { method?: string; body?: unknown }) => new NextRequest(new URL(url, 'http://localhost'), {
  method: init?.method ?? 'GET',
  ...(init?.body ? { body: JSON.stringify(init.body), headers: { 'content-type': 'application/json' } } : {}),
});

beforeEach(() => { sessaoAtual = null; gravacoes.length = 0; });

describe('isolamento entre escritórios', () => {
  it('contador A lê a ficha; contador B leva 403 com o id de A', async () => {
    sessaoAtual = SESSOES.contadorA;
    expect((await ficha.GET(req(`/api/dp/empregado?id=${EMP_A}`))).status).toBe(200);
    sessaoAtual = SESSOES.contadorB;
    expect((await ficha.GET(req(`/api/dp/empregado?id=${EMP_A}`))).status).toBe(403);
  });
  it('B não lista empregados da empresa de A', async () => {
    sessaoAtual = SESSOES.contadorB;
    expect((await lista.GET(req('/api/dp?empresa=emp-a'))).status).toBe(403);
  });
  it('B não edita, não programa, não exclui nem baixa documento de A', async () => {
    sessaoAtual = SESSOES.contadorB;
    expect((await lista.PATCH(req('/api/dp', { method: 'PATCH', body: { id: EMP_A, dados: { nome: 'X' } } }))).status).toBe(403);
    expect((await ferias.POST(req('/api/dp/ferias', { method: 'POST', body: { empregadoId: EMP_A, aquisitivoInicio: '2025-03-10', inicio: '2027-01-04', dias: 30 } }))).status).toBe(403);
    expect((await ferias.DELETE(req(`/api/dp/ferias?id=${FER_A}`, { method: 'DELETE' }))).status).toBe(403);
    expect((await documento.GET(req(`/api/dp/documento?ferias=${FER_A}&doc=aviso`))).status).toBe(403);
    expect(gravacoes).toEqual([]);
  });
  it('B não cadastra empregado em empresa de A', async () => {
    sessaoAtual = SESSOES.contadorB;
    expect((await lista.POST(req('/api/dp', { method: 'POST', body: { empresa: 'emp-a', dados: { nome: 'X' } } }))).status).toBe(403);
    expect(gravacoes).toEqual([]);
  });
  it('a lista não leva CPF inteiro nem salário', async () => {
    sessaoAtual = SESSOES.contadorA;
    const x = await (await lista.GET(req('/api/dp?empresa=emp-a'))).json();
    expect(x.empregados[0].cpf).toBe('***.982.***-**');
    expect(x.empregados[0].salarioBase).toBeNull();
  });
  it('id inexistente: 404 só para gestor; sem sessão, 401', async () => {
    sessaoAtual = SESSOES.contadorA;
    expect((await ficha.GET(req('/api/dp/empregado?id=44444444-4444-4444-8444-444444444444'))).status).toBe(404);
    sessaoAtual = null;
    expect((await ficha.GET(req(`/api/dp/empregado?id=${EMP_A}`))).status).toBe(401);
  });
});

describe('médias do ponto para a rescisão (/api/dp/medias)', () => {
  it('B leva 403 com o id de A; cliente 403; sem sessão 401', async () => {
    sessaoAtual = SESSOES.contadorB;
    expect((await medias.GET(req(`/api/dp/medias?id=${EMP_A}&ate=2026-11-20`))).status).toBe(403);
    sessaoAtual = SESSOES.clienteA;
    expect((await medias.GET(req(`/api/dp/medias?id=${EMP_A}&ate=2026-11-20`))).status).toBe(403);
    sessaoAtual = null;
    expect((await medias.GET(req(`/api/dp/medias?id=${EMP_A}&ate=2026-11-20`))).status).toBe(401);
  });
  it('A recebe só horas, mês a mês, desde a admissão (2025-03) até o mês do desligamento', async () => {
    sessaoAtual = SESSOES.contadorA;
    const r = await medias.GET(req(`/api/dp/medias?id=${EMP_A}&ate=2026-11-20`));
    expect(r.status).toBe(200);
    const { meses } = await r.json();
    expect(meses[0].mes).toBe('2025-03');
    expect(meses[meses.length - 1].mes).toBe('2026-11');
    const marco = meses.find((m: { mes: string }) => m.mes === '2026-03');
    expect(marco).toMatchObject({ temPonto: true, he50Min: 120, he100Min: 0 });
    expect(meses.find((m: { mes: string }) => m.mes === '2026-04').temPonto).toBe(false);
    expect(JSON.stringify(meses)).not.toMatch(/salario|cpf/i);
  });
  it('data inválida → 400', async () => {
    sessaoAtual = SESSOES.contadorA;
    expect((await medias.GET(req(`/api/dp/medias?id=${EMP_A}&ate=xx`))).status).toBe(400);
  });
});

describe('cliente e empresa arquivada', () => {
  it('cliente leva 403 mesmo na própria empresa', async () => {
    sessaoAtual = SESSOES.clienteA;
    expect((await lista.GET(req('/api/dp?empresa=emp-a'))).status).toBe(403);
    expect((await ficha.GET(req(`/api/dp/empregado?id=${EMP_A}`))).status).toBe(403);
  });
  it('arquivada: a ficha abre (consulta), mas editar e programar são barrados', async () => {
    sessaoAtual = SESSOES.contadorA;
    expect((await ficha.GET(req(`/api/dp/empregado?id=${EMP_ARQ}`))).status).toBe(200);
    const patch = await lista.PATCH(req('/api/dp', { method: 'PATCH', body: { id: EMP_ARQ, dados: { nome: 'X' } } }));
    expect(patch.status).toBe(409);
    expect((await patch.json()).erro).toBe('Empresa arquivada — reative em Cadastros para alterar');
    expect((await ferias.POST(req('/api/dp/ferias', { method: 'POST', body: { empregadoId: EMP_ARQ, aquisitivoInicio: '2025-03-10', inicio: '2027-01-04', dias: 30 } }))).status).toBe(409);
    expect(gravacoes).toEqual([]);
  });
  it('contador A programa férias válidas na empresa ativa (validação do servidor)', async () => {
    sessaoAtual = SESSOES.contadorA;
    const ok = await ferias.POST(req('/api/dp/ferias', { method: 'POST', body: { empregadoId: EMP_A, aquisitivoInicio: '2025-03-10', inicio: '2027-01-04', dias: 30 } }));
    expect(ok.status).toBe(200);
    const sexta = await ferias.POST(req('/api/dp/ferias', { method: 'POST', body: { empregadoId: EMP_A, aquisitivoInicio: '2025-03-10', inicio: '2027-01-08', dias: 30 } }));
    expect(sexta.status).toBe(400);
    expect(gravacoes).toEqual(['criarFerias']);
  });
});
