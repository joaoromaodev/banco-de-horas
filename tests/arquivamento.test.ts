import { describe, it, expect } from 'vitest';
import { estaArquivada, limparMotivo, MOTIVO_MAX, podeReativar, soArquivadas, soAtivas } from '@/lib/arquivamento';

const lista = [
  { id: 'a', arquivadaEm: null },
  { id: 'b', arquivadaEm: '2026-11-01T10:00:00Z' },
  { id: 'c' },
];

describe('arquivamento de empresas', () => {
  it('separa ativas e arquivadas', () => {
    expect(soAtivas(lista).map((e) => e.id)).toEqual(['a', 'c']);
    expect(soArquivadas(lista).map((e) => e.id)).toEqual(['b']);
    expect(estaArquivada({ arquivadaEm: '' })).toBe(false);
  });

  it('limpa o motivo: vazio vira null e o texto é cortado', () => {
    expect(limparMotivo('   ')).toBeNull();
    expect(limparMotivo(undefined)).toBeNull();
    expect(limparMotivo('  encerrou contrato ')).toBe('encerrou contrato');
    expect(limparMotivo('x'.repeat(500))).toHaveLength(MOTIVO_MAX);
  });

  it('reativar respeita o limite do plano (só conta as ativas)', () => {
    expect(podeReativar('essencial', 0)).toEqual({ ok: true });
    const r = podeReativar('essencial', 10);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.limite).toBe(10);
      expect(r.erro).toMatch(/arquive outra ou suba/);
    }
  });

  it('plano ilimitado/fundador e plano desconhecido não barram', () => {
    expect(podeReativar('ilimitado', 9999).ok).toBe(true);
    expect(podeReativar('fundador', 9999).ok).toBe(true);
    expect(podeReativar(null, 9999).ok).toBe(true);
  });
});
