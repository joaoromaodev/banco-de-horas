import { afterEach, describe, expect, it, vi } from 'vitest';
import { avisosDemonstrativo, avisosFolhaDevolvida, avisosPedido, MAX_MOTIVO } from '@/lib/avisosCliente';
import { montarNotificacoes } from '@/lib/notificacoes';

describe('avisos ao cliente — folha devolvida', () => {
  const base = { ano: 2026, mes: 10, motivo: 'Foto cortada, faltam os dias 20 a 31', devolvidoEm: '2026-11-20T12:00:00.000Z' };
  it('um aviso por envio devolvido, com o motivo e SEM o nome do funcionário', () => {
    const r = avisosFolhaDevolvida([{ ...base, id: 'f1', funcionario: 'MARIA DA SILVA', situacao: 'devolvida' }]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tipo: 'folha_devolvida', href: '/enviar-ponto', quando: base.devolvidoEm });
    expect(r[0].texto).toBe('Outubro/2026 · Motivo: Foto cortada, faltam os dias 20 a 31');
    expect(JSON.stringify(r)).not.toMatch(/MARIA/i);
  });
  it('já reenviada para o mesmo funcionário e mês: some; outra situação não avisa', () => {
    const r = avisosFolhaDevolvida([
      { ...base, id: 'f1', funcionario: 'Ana', situacao: 'devolvida' },
      { ...base, id: 'f2', funcionario: 'ana ', situacao: 'recebida', devolvidoEm: null },
      { ...base, id: 'f3', funcionario: 'Bia', situacao: 'aplicada' },
      { ...base, id: 'f4', funcionario: 'Caio', situacao: 'devolvida', devolvidoEm: null },
    ]);
    expect(r).toEqual([]);
  });
  it('motivo longo é cortado; sem motivo, texto padrão; chave muda se devolver de novo', () => {
    const [a] = avisosFolhaDevolvida([{ ...base, id: 'f1', funcionario: 'X', situacao: 'devolvida', motivo: 'x'.repeat(400) }]);
    expect(a.texto!.length).toBeLessThan(MAX_MOTIVO + 30);
    const [b] = avisosFolhaDevolvida([{ ...base, id: 'f1', funcionario: 'X', situacao: 'devolvida', motivo: null, devolvidoEm: '2026-11-21T08:00:00.000Z' }]);
    expect(b.texto).toBe('Outubro/2026 · A contabilidade pediu uma nova foto.');
    expect(b.chave).not.toBe(a.chave);
  });
});

describe('avisos ao cliente — pedido de documento', () => {
  it('só pedido aberto; leva o prazo e vai para /documentos', () => {
    const r = avisosPedido([
      { id: 'p1', titulo: 'Extrato de outubro', prazo: '2026-11-30', status: 'aberta', criadoEm: '2026-11-20T10:00:00.000Z' },
      { id: 'p2', titulo: 'Notas', prazo: null, status: 'aberta', criadoEm: '2026-11-21T10:00:00.000Z' },
      { id: 'p3', titulo: 'Atendido', prazo: null, status: 'atendida', criadoEm: '2026-11-21T10:00:00.000Z' },
    ]);
    expect(r.map((i) => i.texto)).toEqual(['Extrato de outubro · Prazo: 30/11/2026', 'Notas · Sem prazo']);
    expect(r.every((i) => i.href === '/documentos' && i.tipo === 'pedido')).toBe(true);
  });
});

describe('avisos ao cliente — demonstrativo', () => {
  it('um aviso por mês liberado, na hora em que o último de 1..M foi confirmado', () => {
    const r = avisosDemonstrativo(2026, [
      { mes: 1, confirmadoEm: '2026-02-05T10:00:00.000Z' },
      { mes: 2, confirmadoEm: '2026-03-05T10:00:00.000Z' },
      { mes: 4, confirmadoEm: '2026-05-05T10:00:00.000Z' }, // buraco em março: não libera
    ]);
    expect(r.map((i) => i.href)).toEqual(['/caixa/demonstrativo?ano=2026&mes=1', '/caixa/demonstrativo?ano=2026&mes=2']);
  });
  it('confirmar o buraco libera vários de uma vez: um aviso só, do mês mais alto', () => {
    const r = avisosDemonstrativo(2026, [
      { mes: 1, confirmadoEm: '2026-02-05T10:00:00.000Z' },
      { mes: 2, confirmadoEm: '2026-11-20T10:00:00.000Z' },
      { mes: 3, confirmadoEm: '2026-04-05T10:00:00.000Z' },
      { mes: 4, confirmadoEm: '2026-05-05T10:00:00.000Z' },
    ]);
    expect(r.map((i) => [i.href, i.quando])).toEqual([
      ['/caixa/demonstrativo?ano=2026&mes=1', '2026-02-05T10:00:00.000Z'],
      ['/caixa/demonstrativo?ano=2026&mes=4', '2026-11-20T10:00:00.000Z'],
    ]);
    expect(r[1].texto).toBe('Abril/2026 · confirmado pela contabilidade.');
  });
  it('a janela do sino deixa só o recente', () => {
    const itens = avisosDemonstrativo(2026, [
      { mes: 1, confirmadoEm: '2026-02-05T10:00:00.000Z' },
      { mes: 2, confirmadoEm: '2026-11-20T10:00:00.000Z' },
    ]);
    const r = montarNotificacoes(itens, { lidasAte: '2026-11-01T00:00:00.000Z', lidas: [] }, new Date('2026-11-21T12:00:00.000Z'));
    expect(r.itens.map((i) => i.href)).toEqual(['/caixa/demonstrativo?ano=2026&mes=2']);
    expect(r.naoLidas).toBe(1);
  });
});

describe('gancho de e-mail ao cliente', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it('sem RESEND_API_KEY, sem a trava ou sem APP_URL: não envia nem chama o provedor', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    const { avisarClientePorEmail } = await import('@/lib/avisosClienteEmail');
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('AVISOS_CLIENTE_EMAIL', 'ligado');
    vi.stubEnv('APP_URL', 'https://app.exemplo');
    expect(await avisarClientePorEmail('esc', 'emp', 2)).toEqual({ situacao: 'desligado', motivo: 'sem_chave' });
    vi.stubEnv('RESEND_API_KEY', 're_teste');
    vi.stubEnv('AVISOS_CLIENTE_EMAIL', '');
    expect(await avisarClientePorEmail('esc', 'emp', 2)).toEqual({ situacao: 'desligado', motivo: 'trava' });
    vi.stubEnv('AVISOS_CLIENTE_EMAIL', 'ligado');
    vi.stubEnv('APP_URL', '');
    expect(await avisarClientePorEmail('esc', 'emp', 2)).toEqual({ situacao: 'desligado', motivo: 'sem_app_url' });
    expect(f).not.toHaveBeenCalled();
  });
  it('corpo é um resumo neutro (sem motivo nem título) com link para /inicio', async () => {
    const { montarEmailAviso } = await import('@/lib/avisosClienteEmail');
    const m = montarEmailAviso(3, 'https://app.exemplo/');
    expect(m.assunto).toBe('Você tem 3 avisos no ClickContas');
    expect(m.texto).toContain('https://app.exemplo/inicio');
    expect(m.html).toContain('href="https://app.exemplo/inicio"');
    expect(montarEmailAviso(1, 'https://x').assunto).toBe('Você tem 1 aviso no ClickContas');
  });
});

describe('corte de 13 meses (igual ao /enviar-ponto)', () => {
  it('desdeTrezeMeses', async () => {
    const { desdeTrezeMeses } = await import('@/lib/avisosCliente');
    expect(desdeTrezeMeses('2026-11-21')).toEqual({ ano: 2025, mes: 10 });
    expect(desdeTrezeMeses('2026-01-05')).toEqual({ ano: 2024, mes: 12 });
  });
});
