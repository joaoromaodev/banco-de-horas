import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMaster, senhaMasterAceitavel } from '@/lib/config';
import { getSecret } from '@/lib/auth';

afterEach(() => vi.unstubAllEnvs());

describe('senhaMasterAceitavel', () => {
  it('no dev aceita qualquer senha definida', () => {
    expect(senhaMasterAceitavel('admin1234', false)).toBe(true);
    expect(senhaMasterAceitavel(undefined, false)).toBe(false);
  });

  it('em produção recusa ausente, curta e padrões conhecidos', () => {
    expect(senhaMasterAceitavel(undefined, true)).toBe(false);
    expect(senhaMasterAceitavel('admin1234', true)).toBe(false);
    expect(senhaMasterAceitavel('ADMIN1234', true)).toBe(false);
    expect(senhaMasterAceitavel('curta-123', true)).toBe(false);
    expect(senhaMasterAceitavel('uma-senha-bem-longa-42', true)).toBe(true);
  });
});

describe('getMaster', () => {
  it('em produção sem MASTER_PASSWORD o master fica desligado (não cai em admin1234)', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('MASTER_PASSWORD', '');
    expect(getMaster().senha).toBeNull();
  });

  it('em produção com a senha padrão o master fica desligado', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('MASTER_PASSWORD', 'admin1234');
    expect(getMaster().senha).toBeNull();
  });

  it('em produção com senha forte o master funciona', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('MASTER_PASSWORD', 'uma-senha-bem-longa-42');
    expect(getMaster().senha).toBe('uma-senha-bem-longa-42');
  });
});

describe('getSecret', () => {
  it('em produção sem SESSION_SECRET falha em vez de usar o texto fixo', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('SESSION_SECRET', '');
    expect(() => getSecret()).toThrow(/SESSION_SECRET/);
  });

  it('com SESSION_SECRET usa o valor configurado', () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('SESSION_SECRET', 'segredo-configurado');
    expect(getSecret()).toBe('segredo-configurado');
  });
});
