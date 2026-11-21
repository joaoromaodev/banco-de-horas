// Configurações do escritório: validação, quem pode gravar, aplicar só às empresas
// sem contabilista e o recorte do `cliente` no proxy. Banco simulado onde preciso.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { criarSessao, COOKIE_SESSAO, type Sessao } from '@/lib/auth';
import {
  acessoAoEscritorio, cnpjValido, crcValido, empresasSemContabilista, formatarCnpj, validarConfig,
} from '@/lib/escritorioConfig';

const BASE = { nome: 'Contabilidade Teste', cnpj: '', contabilistaNome: '', contabilistaCrc: '', prazoPedidosPadrao: 10 };

describe('CNPJ', () => {
  it('aceita CNPJ válido, com ou sem máscara', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11222333000181')).toBe(true);
  });
  it('recusa dígito errado, tamanho errado e repetidos', () => {
    expect(cnpjValido('11.222.333/0001-82')).toBe(false);
    expect(cnpjValido('1122233300018')).toBe(false);
    expect(cnpjValido('11111111111111')).toBe(false);
    expect(cnpjValido('')).toBe(false);
  });
  it('formata', () => expect(formatarCnpj('11222333000181')).toBe('11.222.333/0001-81'));
});

describe('CRC', () => {
  it('aceita os formatos usuais', () => {
    for (const c of ['PA-012345/O-1', 'CRC PA 012345/O', '1SP123456/O-8']) expect(crcValido(c)).toBe(true);
  });
  it('recusa vazio, só letras, curto demais e símbolos estranhos', () => {
    for (const c of ['', 'PA', 'abcdef', '12', 'PA-123; DROP']) expect(crcValido(c)).toBe(false);
  });
});

describe('validarConfig', () => {
  it('aceita o mínimo (só o nome) e normaliza', () => {
    const r = validarConfig({ ...BASE, nome: '  Contabilidade   Teste ' });
    expect(r.ok && r.config.nome).toBe('Contabilidade Teste');
    expect(r.ok && r.config.cnpj).toBeNull();
  });
  it('guarda o CNPJ só com dígitos', () => {
    const r = validarConfig({ ...BASE, cnpj: '11.222.333/0001-81' });
    expect(r.ok && r.config.cnpj).toBe('11222333000181');
  });
  it('recusa nome vazio, CNPJ inválido, CRC ruim e prazo fora de 1–28', () => {
    const r = validarConfig({ nome: ' ', cnpj: '123', contabilistaNome: 'Ana', contabilistaCrc: 'xx', prazoPedidosPadrao: 29 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.erros).sort()).toEqual(['cnpj', 'contabilistaCrc', 'nome', 'prazoPedidosPadrao']);
    expect(validarConfig({ ...BASE, prazoPedidosPadrao: 0 }).ok).toBe(false);
    expect(validarConfig({ ...BASE, prazoPedidosPadrao: 10.5 }).ok).toBe(false);
  });
  it('CRC sem o nome de quem assina é recusado', () => {
    const r = validarConfig({ ...BASE, contabilistaCrc: 'PA-012345/O-1' });
    expect(!r.ok && r.erros.contabilistaNome).toBeTruthy();
  });
  it('sem prazo no corpo vale o padrão 10', () => {
    const r = validarConfig({ nome: 'X' });
    expect(r.ok && r.config.prazoPedidosPadrao).toBe(10);
  });
});

describe('quem pode o quê', () => {
  const adm = { role: 'usuario', escritorioId: 'A', adminEscritorio: true } as const;
  it('admin do próprio escritório edita', () => expect(acessoAoEscritorio(adm, 'A')).toBe('editar'));
  it('outro contador do escritório só lê', () => expect(acessoAoEscritorio({ ...adm, adminEscritorio: false }, 'A')).toBe('ler'));
  it('admin de outro escritório não alcança', () => expect(acessoAoEscritorio(adm, 'B')).toBeNull());
  it('master só lê', () => expect(acessoAoEscritorio({ role: 'master' }, 'B')).toBe('ler'));
  it('cliente e sem sessão não alcançam', () => {
    expect(acessoAoEscritorio({ role: 'cliente', escritorioId: 'A' }, 'A')).toBeNull();
    expect(acessoAoEscritorio(null, 'A')).toBeNull();
  });
});

describe('empresasSemContabilista', () => {
  it('pega quem não tem linha fiscal ou tem o campo em branco; não toca em quem já tem', () => {
    const r = empresasSemContabilista(['a', 'b', 'c', 'd'], [
      { empresaId: 'a', contabilista: 'Fulana', crc: 'PA-1/O' },
      { empresaId: 'b', contabilista: '', crc: '' },
      { empresaId: 'c', contabilista: '   ', crc: null },
    ]);
    expect(r).toEqual(['b', 'c', 'd']);
  });
});

// ------------------------------------------------------------ aplicar / desfazer (banco simulado)
type Linha = { empresa_id: string; contabilista: string; crc: string };
let tabela: Linha[] = [];

vi.mock('@/lib/cadastro', () => ({
  lerEmpresas: async () => [
    { id: 'e1', escritorioId: 'A' }, { id: 'e2', escritorioId: 'A' }, { id: 'e3', escritorioId: 'A' }, { id: 'x', escritorioId: 'B' },
  ],
  lerEmpresasComArquivadas: async () => [],
  buscarUsuario: async () => null,
}));
vi.mock('@/lib/escritorios', () => ({
  lerEscritorio: async () => ({ id: 'A', nome: 'A', contabilistaNome: 'Ana Souza', contabilistaCrc: 'PA-1/O', prazoPedidosPadrao: 10 }),
}));
vi.mock('@/lib/db', () => ({
  getDb: () => ({
    from: () => {
      const consulta = (op: string, dados?: Record<string, unknown>) => {
        const f: [string, unknown][] = [];
        const c = {
          eq: (k: string, v: unknown) => { f.push([k, v]); return c; },
          in: (k: string, v: unknown[]) => { f.push([k, v]); return c; },
          select: () => c,
          then: (ok: (v: unknown) => void) => {
            const casa = (l: Linha) => f.every(([k, v]) => {
              const atual = (l as unknown as Record<string, unknown>)[k];
              return Array.isArray(v) ? v.includes(atual) : atual === v;
            });
            if (op === 'select') return ok({ data: tabela.filter(casa), error: null });
            if (op === 'insert') { tabela.push({ ...(dados as unknown as Linha) }); return ok({ data: null, error: null }); }
            const alvo = tabela.filter(casa);
            alvo.forEach((l) => Object.assign(l, dados));
            return ok({ data: alvo, error: null });
          },
        };
        return c;
      };
      return {
        select: () => consulta('select'),
        insert: (d: Record<string, unknown>) => consulta('insert', d),
        update: (d: Record<string, unknown>) => consulta('update', d),
      };
    },
  }),
}));

const { aplicarResponsavel, desfazerAplicacao } = await import('@/lib/escritorioServidor');

describe('aplicar às empresas sem contabilista', () => {
  beforeEach(() => {
    tabela = [
      { empresa_id: 'e1', contabilista: 'Fulana Antiga', crc: 'SP-9/O' }, // já tem: não pode mudar
      { empresa_id: 'e2', contabilista: '', crc: '' },                    // em branco
      // e3 sem linha; x é de outro escritório
      { empresa_id: 'x', contabilista: '', crc: '' },
    ];
  });

  it('grava só nas sem contabilista do próprio escritório e não toca nas que já têm', async () => {
    const r = await aplicarResponsavel('A', 'admin@a.com');
    expect(r.aplicadas.map((a) => a.empresaId).sort()).toEqual(['e2', 'e3']);
    expect(tabela.find((l) => l.empresa_id === 'e1')).toMatchObject({ contabilista: 'Fulana Antiga', crc: 'SP-9/O' });
    expect(tabela.find((l) => l.empresa_id === 'e2')).toMatchObject({ contabilista: 'Ana Souza', crc: 'PA-1/O' });
    expect(tabela.find((l) => l.empresa_id === 'e3')).toMatchObject({ contabilista: 'Ana Souza' });
    expect(tabela.find((l) => l.empresa_id === 'x')).toMatchObject({ contabilista: '' }); // outro escritório intacto
  });

  it('rodar de novo não muda mais nada', async () => {
    await aplicarResponsavel('A', 'admin@a.com');
    expect((await aplicarResponsavel('A', 'admin@a.com')).aplicadas).toEqual([]);
  });

  it('desfazer volta só o que foi aplicado e respeita quem mudou depois', async () => {
    const r = await aplicarResponsavel('A', 'admin@a.com');
    tabela.find((l) => l.empresa_id === 'e3')!.contabilista = 'Outra Pessoa'; // alguém editou no meio tempo
    const n = await desfazerAplicacao('A', r.nome, [...r.aplicadas, { empresaId: 'x', crcAnterior: '' }], 'admin@a.com');
    expect(n).toBe(1);
    expect(tabela.find((l) => l.empresa_id === 'e2')).toMatchObject({ contabilista: '', crc: '' });
    expect(tabela.find((l) => l.empresa_id === 'e3')!.contabilista).toBe('Outra Pessoa');
    expect(tabela.find((l) => l.empresa_id === 'e1')!.contabilista).toBe('Fulana Antiga');
  });
});

// ------------------------------------------------------------ proxy
vi.mock('@/lib/cobrancaServidor', () => ({ situacaoDoEscritorio: async () => null }));
const { proxy } = await import('@/proxy');

describe('proxy — /escritorio', () => {
  const chamar = async (caminho: string, s: Omit<Sessao, 'exp'>) => {
    const token = await criarSessao(s);
    return proxy(new NextRequest(new URL(caminho, 'http://localhost'), { headers: { cookie: `${COOKIE_SESSAO}=${token}` } }));
  };
  const cliente: Omit<Sessao, 'exp'> = { email: 'e@x.com', nome: 'E', role: 'cliente', empresa: 'emp', escritorioId: 'A', modulos: ['caixa'] };
  const contador: Omit<Sessao, 'exp'> = { email: 'c@x.com', nome: 'C', role: 'usuario', escritorioId: 'A', adminEscritorio: true, modulos: ['caixa'] };

  it('cliente não alcança a tela nem a API', async () => {
    expect((await chamar('/api/escritorio', cliente)).status).toBe(403);
    expect((await chamar('/api/escritorio/responsavel', cliente)).status).toBe(403);
    expect((await chamar('/escritorio', cliente)).status).toBe(307);
  });
  it('contador passa (a guarda fina está nas rotas)', async () => {
    expect((await chamar('/api/escritorio', contador)).status).toBe(200);
  });
});
