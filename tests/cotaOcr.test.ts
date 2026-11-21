import { describe, expect, it } from 'vitest';
import {
  avaliarCota, competenciaBelem, COTA_PLANO_DESCONHECIDO, COTA_POR_PLANO, excedeuRitmo, limiteDoPlano, RITMO,
} from '@/lib/cotaOcr';

describe('limiteDoPlano', () => {
  it('usa os números decididos em 21/11/2026', () => {
    expect(limiteDoPlano('essencial')).toBe(150);
    expect(limiteDoPlano('escritorio')).toBe(600);
    expect(limiteDoPlano('ilimitado')).toBe(2000);
    expect(limiteDoPlano('teste')).toBe(COTA_POR_PLANO.teste);
    expect(limiteDoPlano('fundador')).toBeGreaterThanOrEqual(10000);
  });

  it('plano desconhecido ou ausente cai no menor plano pago (nunca em ilimitado)', () => {
    expect(limiteDoPlano('premium-2027')).toBe(COTA_PLANO_DESCONHECIDO);
    expect(limiteDoPlano(undefined)).toBe(COTA_PLANO_DESCONHECIDO);
    expect(limiteDoPlano(null)).toBe(COTA_PLANO_DESCONHECIDO);
    // "__proto__" e afins não viram limite infinito
    expect(limiteDoPlano('__proto__')).toBe(COTA_PLANO_DESCONHECIDO);
    expect(limiteDoPlano('toString')).toBe(COTA_PLANO_DESCONHECIDO);
  });
});

describe('avaliarCota', () => {
  it('abaixo de 80% libera sem mensagem', () => {
    const c = avaliarCota({ plano: 'essencial', usadas: 10 });
    expect(c).toMatchObject({ permitido: true, nivel: 'ok', usadas: 10, limite: 150, restantes: 140, mensagem: null });
  });

  it('a partir de 80% avisa quantas restam', () => {
    const c = avaliarCota({ plano: 'essencial', usadas: 120 });
    expect(c.permitido).toBe(true);
    expect(c.nivel).toBe('aviso');
    expect(c.mensagem).toContain('Restam 30 de 150');
  });

  it('a última leitura do mês ainda é permitida', () => {
    expect(avaliarCota({ plano: 'essencial', usadas: 149 })).toMatchObject({ permitido: true, restantes: 1 });
  });

  it('no limite bloqueia com convite para o próximo plano', () => {
    const c = avaliarCota({ plano: 'essencial', usadas: 150 });
    expect(c).toMatchObject({ permitido: false, nivel: 'esgotada', restantes: 0 });
    expect(c.mensagem).toContain('150 leituras');
    expect(c.mensagem).toContain('Escritório');
    expect(c.mensagem).toContain('preencher a folha à mão');
  });

  it('acima do limite (corrida) continua bloqueando', () => {
    expect(avaliarCota({ plano: 'teste', usadas: 999 }).permitido).toBe(false);
  });

  it('no maior plano não convida a subir, aponta o suporte', () => {
    const c = avaliarCota({ plano: 'ilimitado', usadas: 2000 });
    expect(c.permitido).toBe(false);
    expect(c.mensagem).toContain('suporte');
    expect(c.mensagem).toContain('2.000');
  });

  it('teste grátis convida para o Essencial', () => {
    const c = avaliarCota({ plano: 'teste', usadas: COTA_POR_PLANO.teste });
    expect(c.mensagem).toContain('Essencial');
  });

  it('escritório suspenso não lê, mesmo com cota sobrando', () => {
    const c = avaliarCota({ plano: 'escritorio', situacao: 'suspenso', usadas: 0 });
    expect(c).toMatchObject({ permitido: false, nivel: 'suspensa' });
    expect(c.mensagem).toContain('suspensa');
  });

  it('em teste ou ativo a situação não bloqueia', () => {
    expect(avaliarCota({ plano: 'teste', situacao: 'teste', usadas: 0 }).permitido).toBe(true);
    expect(avaliarCota({ plano: 'essencial', situacao: 'ativo', usadas: 0 }).permitido).toBe(true);
  });

  it('valor estranho em usadas não abre a cota', () => {
    expect(avaliarCota({ plano: 'essencial', usadas: Number.NaN }).usadas).toBe(0);
    expect(avaliarCota({ plano: 'essencial', usadas: -5 }).usadas).toBe(0);
    expect(avaliarCota({ plano: 'essencial', usadas: 150.9 }).permitido).toBe(false);
  });
});

describe('competenciaBelem', () => {
  it('usa o mês de Belém (UTC−3)', () => {
    expect(competenciaBelem(new Date('2026-11-21T15:00:00Z'))).toBe('2026-11');
    // 02:00Z do dia 1º ainda é o último dia do mês anterior em Belém
    expect(competenciaBelem(new Date('2026-12-01T02:00:00Z'))).toBe('2026-11');
    expect(competenciaBelem(new Date('2026-12-01T03:00:00Z'))).toBe('2026-12');
    expect(competenciaBelem(new Date('2027-01-01T01:00:00Z'))).toBe('2026-12');
  });
});

describe('excedeuRitmo', () => {
  it('bloqueia a partir do máximo de tentativas na janela (falhas incluídas)', () => {
    expect(excedeuRitmo(RITMO.maximo - 1)).toBe(false);
    expect(excedeuRitmo(RITMO.maximo)).toBe(true);
    expect(excedeuRitmo(Number.NaN)).toBe(false);
  });
});
