import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  resolverModulos, temModulo, criarSessao, lerSessao, hashSenha, conferirSenha,
  MODULOS, type Sessao,
} from '@/lib/auth';

afterEach(() => vi.useRealTimers());

const sessao = (extra: Partial<Sessao> = {}): Sessao =>
  ({ email: 'a@b.com', nome: 'Ana', role: 'usuario', exp: Date.now() + 1000, ...extra });

describe('resolverModulos', () => {
  it('cliente é sempre só caixa, mesmo que guardem outra coisa', () => {
    expect(resolverModulos('cliente')).toEqual(['caixa']);
    expect(resolverModulos('cliente', ['ponto'])).toEqual(['caixa']);
  });
  it('master tem tudo', () => {
    expect(resolverModulos('master')).toEqual(MODULOS);
    expect(resolverModulos('master', ['caixa'])).toEqual(MODULOS);
  });
  it('usuário usa o que foi habilitado', () => {
    expect(resolverModulos('usuario', ['caixa'])).toEqual(['caixa']);
    expect(resolverModulos('usuario', ['ponto'])).toEqual(['ponto']);
  });
  it('usuário legado (vazio/nulo) fica com tudo', () => {
    expect(resolverModulos('usuario', [])).toEqual(MODULOS);
    expect(resolverModulos('usuario', null)).toEqual(MODULOS);
    expect(resolverModulos('usuario')).toEqual(MODULOS);
  });
  it('devolve cópia: alterar o resultado não altera MODULOS', () => {
    resolverModulos('master').pop();
    expect(MODULOS).toEqual(['ponto', 'caixa']);
  });
});

describe('temModulo', () => {
  it('sem sessão nunca tem', () => {
    expect(temModulo(null, 'caixa')).toBe(false);
    expect(temModulo(undefined, 'ponto')).toBe(false);
  });
  it('master sempre tem', () => {
    expect(temModulo(sessao({ role: 'master', modulos: [] }), 'ponto')).toBe(true);
  });
  it('respeita sessao.modulos', () => {
    const s = sessao({ modulos: ['caixa'] });
    expect(temModulo(s, 'caixa')).toBe(true);
    expect(temModulo(s, 'ponto')).toBe(false);
  });
  it('sessão antiga sem o campo modulos tem tudo (legado)', () => {
    expect(temModulo(sessao(), 'ponto')).toBe(true);
  });
});

describe('sessão assinada', () => {
  it('cria e lê de volta', async () => {
    const token = await criarSessao({ email: 'a@b.com', nome: 'Ana João', role: 'cliente', empresa: 'x', modulos: ['caixa'] });
    expect(token.split('.')).toHaveLength(2);
    const s = await lerSessao(token);
    expect(s).toMatchObject({ email: 'a@b.com', nome: 'Ana João', role: 'cliente', empresa: 'x', modulos: ['caixa'] });
    expect(s!.exp).toBeGreaterThan(Date.now());
  });

  it('suporta acentos e emoji no nome (UTF-8)', async () => {
    const token = await criarSessao({ email: 'a@b.com', nome: 'Conceição 🌳', role: 'usuario' });
    expect((await lerSessao(token))?.nome).toBe('Conceição 🌳');
  });

  it('dura 12h e expira depois', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-21T10:00:00Z'));
    const token = await criarSessao({ email: 'a@b.com', nome: 'A', role: 'usuario' });
    vi.setSystemTime(new Date('2026-11-21T21:59:00Z'));
    expect(await lerSessao(token)).not.toBeNull();
    vi.setSystemTime(new Date('2026-11-21T22:01:00Z'));
    expect(await lerSessao(token)).toBeNull();
  });

  it('rejeita token adulterado no corpo (escalada de papel)', async () => {
    const token = await criarSessao({ email: 'a@b.com', nome: 'A', role: 'cliente', empresa: 'x' });
    const [corpo, assinatura] = token.split('.');
    const json = JSON.parse(Buffer.from(corpo, 'base64url').toString());
    json.role = 'master';
    const forjado = Buffer.from(JSON.stringify(json)).toString('base64url');
    expect(await lerSessao(`${forjado}.${assinatura}`)).toBeNull();
  });

  it('rejeita assinatura trocada ou vazia', async () => {
    const token = await criarSessao({ email: 'a@b.com', nome: 'A', role: 'usuario' });
    const [corpo, assinatura] = token.split('.');
    const ruim = (assinatura[0] === 'A' ? 'B' : 'A') + assinatura.slice(1);
    expect(await lerSessao(`${corpo}.${ruim}`)).toBeNull();
    expect(await lerSessao(`${corpo}.`)).toBeNull();
  });

  it('rejeita assinatura feita com outro segredo', async () => {
    const token = await criarSessao({ email: 'a@b.com', nome: 'A', role: 'usuario' });
    vi.stubEnv('SESSION_SECRET', 'outro-segredo');
    try {
      expect(await lerSessao(token)).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([undefined, null, '', 'semponto', '.', 'a.b.c'])('rejeita token malformado %j', async (t) => {
    expect(await lerSessao(t as string | null | undefined)).toBeNull();
  });
});

describe('senha (PBKDF2)', () => {
  it('confere a senha certa e recusa a errada', async () => {
    const { salt, hash } = await hashSenha('admin1234');
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await conferirSenha('admin1234', salt, hash)).toBe(true);
    expect(await conferirSenha('admin12345', salt, hash)).toBe(false);
    expect(await conferirSenha('', salt, hash)).toBe(false);
  });
  it('sal aleatório: mesma senha, hashes diferentes', async () => {
    const a = await hashSenha('x');
    const b = await hashSenha('x');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });
  it('mesmo sal é determinístico', async () => {
    const { salt, hash } = await hashSenha('x');
    expect((await hashSenha('x', salt)).hash).toBe(hash);
  });
});
