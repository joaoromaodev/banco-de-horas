import { describe, expect, it } from 'vitest';
import { notificacaoDoEnvio } from '@/lib/envioPontoEventos';

const ev = { envioId: 'e1', escritorioId: 'x', empresaId: 'emp 1', ano: 2026, mes: 10 };

describe('notificacaoDoEnvio', () => {
  it('folha recebida avisa a contadora com link para o ponto no mês certo', () => {
    const n = notificacaoDoEnvio({ ...ev, tipo: 'recebida' })!;
    expect(n.href).toBe('/ponto?empresa=emp+1&ano=2026&mes=10');
    expect(n.texto).toContain('out/2026');
    expect(n.chave).toBe('envio-ponto:e1:recebida');
  });
  it('lida e falhou avisam; aplicada e devolvida não', () => {
    expect(notificacaoDoEnvio({ ...ev, tipo: 'lida' })).not.toBeNull();
    expect(notificacaoDoEnvio({ ...ev, tipo: 'falhou' })).not.toBeNull();
    expect(notificacaoDoEnvio({ ...ev, tipo: 'aplicada' })).toBeNull();
    expect(notificacaoDoEnvio({ ...ev, tipo: 'devolvida' })).toBeNull();
  });
  it('não leva nome de funcionário', () => {
    expect(JSON.stringify(notificacaoDoEnvio({ ...ev, tipo: 'lida' }))).not.toMatch(/funcion/i);
  });
});
