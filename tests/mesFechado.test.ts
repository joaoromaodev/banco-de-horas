// Regras puras do mês fechado (lib/mesFechado.ts) — Sprint 17, frente C.
import { describe, expect, it } from 'vitest';
import {
  avisoRespostaAceite, avisosAceitePonto, fotoDoResumo, impedimentoParaFechar, mensagemCaixaFechado, mensagemPontoFechado,
  mensagemCaixaPosteriorFechado, mensagemFecharEmOrdem, mensagemSaldoInicialFechado, mesmaFoto, motivoReabertura, situacaoAceite, textoDuvida, type AceiteRegistro,
} from '@/lib/mesFechado';
import { resumirMes } from '@/lib/resumoFolha';

describe('motivo e dúvida', () => {
  it('motivo da reabertura: obrigatório, 5 a 500 letras, espaços colapsados', () => {
    expect(motivoReabertura(undefined)).toBeNull();
    expect(motivoReabertura('   ')).toBeNull();
    expect(motivoReabertura('abcd')).toBeNull();
    expect(motivoReabertura('  Venda\n em   duplicidade ')).toBe('Venda em duplicidade');
    expect(motivoReabertura('x'.repeat(501))).toBeNull();
    expect(motivoReabertura('x'.repeat(500))).toHaveLength(500);
  });
  it('dúvida do cliente: 3 a 1.000 letras', () => {
    expect(textoDuvida('ok')).toBeNull();
    expect(textoDuvida('Dia 12?')).toBe('Dia 12?');
    expect(textoDuvida('x'.repeat(1001))).toBeNull();
  });
  it('mensagens dizem o mês, que está fechado e como corrigir', () => {
    expect(mensagemCaixaFechado(2026, 3)).toMatch(/^Março\/2026 está fechado pela contabilidade.*reabre o mês informando o motivo\.$/);
    expect(mensagemPontoFechado(2026, 10)).toMatch(/Outubro\/2026 está fechado/);
    expect(mensagemSaldoInicialFechado(2026, [1, 2])).toMatch(/Janeiro\/2026, Fevereiro\/2026 estão fechados\. Reabra os meses/);
    expect(mensagemCaixaPosteriorFechado(2026, 1, 3)).toMatch(/^Março\/2026 está fechado e o saldo dele vem de Janeiro\/2026/);
    expect(mensagemFecharEmOrdem(2026, [1, 2])).toMatch(/^Feche antes Janeiro\/2026, Fevereiro\/2026/);
  });
});

const aceite = (p: Partial<AceiteRegistro>): AceiteRegistro =>
  ({ assinatura: 'A', resposta: 'aceito', duvida: null, por: 'cli@x.com', em: '2026-11-01T10:00:00Z', ...p });

describe('situação do aceite', () => {
  it('sem resposta: pendente; dúvida; aceito é definitivo; só conta a assinatura atual', () => {
    expect(situacaoAceite('A', []).situacao).toBe('pendente');
    expect(situacaoAceite('A', [aceite({ resposta: 'duvida', duvida: 'x' })]).situacao).toBe('duvida');
    const r = situacaoAceite('A', [
      aceite({ resposta: 'aceito', em: '2026-11-02T10:00:00Z' }),
      aceite({ resposta: 'duvida', duvida: 'x', em: '2026-11-03T10:00:00Z' }),
    ]);
    expect(r.situacao).toBe('aceito');
    expect(r.ultimo?.em).toBe('2026-11-02T10:00:00Z');
    // Aceite de números antigos (antes de reabrir) não vale para os novos.
    expect(situacaoAceite('B', [aceite({ assinatura: 'A' })]).situacao).toBe('pendente');
  });
});

describe('aviso no sino do cliente', () => {
  it('um por mês pendente, sem nome nem número; chave muda se fechar de novo', () => {
    const itens = avisosAceitePonto([
      { ano: 2026, mes: 10, fechadoEm: '2026-11-05T12:00:00Z', situacao: 'pendente' },
      { ano: 2026, mes: 9, fechadoEm: '2026-10-05T12:00:00Z', situacao: 'aceito' },
      { ano: 2026, mes: 8, fechadoEm: '2026-09-05T12:00:00Z', situacao: 'duvida' },
    ]);
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ tipo: 'aceite_ponto', href: '/enviar-ponto#aceite', quando: '2026-11-05T12:00:00.000Z' });
    expect(itens[0].texto).toBe('Outubro/2026 · confira as horas do mês e responda à contabilidade.');
    const de2 = avisosAceitePonto([{ ano: 2026, mes: 10, fechadoEm: '2026-11-06T12:00:00Z', situacao: 'pendente' }]);
    expect(de2[0].chave).not.toBe(itens[0].chave);
  });
});

describe('aviso no sino da contabilidade (Sprint 18 · A)', () => {
  const n = { empresaId: 'emp-1', ano: 2026, mes: 10, em: '2026-11-05T12:00:00.000Z' };
  it('aceite e dúvida: só o mês e o link do fechamento; uma chave por resposta', () => {
    const ok = avisoRespostaAceite({ ...n, resposta: 'aceito' });
    expect(ok).toMatchObject({ titulo: 'O cliente aceitou o resumo do ponto', texto: 'Outubro/2026 · confirmado pela empresa.' });
    expect(ok.href).toBe('/ponto?empresa=emp-1&ano=2026&mes=10');
    const duv = avisoRespostaAceite({ ...n, resposta: 'duvida' });
    expect(duv.titulo).toBe('O cliente tem uma dúvida no resumo do ponto');
    expect(duv.texto).toMatch(/^Outubro\/2026 · leia a dúvida no fechamento/);
    expect(avisoRespostaAceite({ ...n, resposta: 'duvida', em: '2026-11-06T12:00:00.000Z' }).chave).not.toBe(duv.chave);
  });
  it('não recebe nem repassa o texto da dúvida', () => {
    // A assinatura da função não tem campo para o texto: nada do que o cliente escreveu chega ao aviso.
    const duv = avisoRespostaAceite({ ...n, resposta: 'duvida', duvida: 'Maria estava de atestado' } as never);
    expect(JSON.stringify(duv)).not.toMatch(/Maria|atestado/);
  });
});

describe('foto do resumo e impedimento', () => {
  const dia = (d: number, extra = {}) => ({ dia: d, entradaManha: '08:00', saidaAlmoco: '12:00', retornoAlmoco: '13:00', saidaTarde: '17:00', marcador: null, ...extra });
  const regras = { jornada: { utilMin: 480, sabadoMin: 0, trabalhaSabado: false }, temBanco: false };
  it('só horas e dias por funcionário', () => {
    // 02/11/2026 é segunda.
    const r = resumirMes([{ funcionario: 'ANA', dias: [dia(2, { saidaTarde: '19:00' })], regras }], { ano: 2026, mes: 11, feriados: new Set() });
    const foto = fotoDoResumo(r);
    expect(foto.percentuais).toEqual({ extraUtil: 50, extraDomFeriado: 100, adicionalNoturno: 20 });
    expect(foto.funcionarios).toEqual([expect.objectContaining({ funcionario: 'ANA', dias: 1, normaisMin: 480, extrasMin: 120 })]);
    expect(JSON.stringify(foto)).not.toMatch(/detalhe|impedimentos|conferir/);
    expect(impedimentoParaFechar(r)).toBeNull();
  });
  it('compara a foto guardada (jsonb reordena as chaves) com o cálculo de agora', () => {
    const r = resumirMes([{ funcionario: 'ANA', dias: [dia(2)], regras }], { ano: 2026, mes: 11, feriados: new Set() });
    const foto = fotoDoResumo(r);
    const embaralhada = {
      funcionarios: foto.funcionarios.map((f) => Object.fromEntries(Object.entries(f).reverse())),
      percentuais: Object.fromEntries(Object.entries(foto.percentuais).reverse()),
    };
    expect(mesmaFoto(foto, embaralhada as typeof foto)).toBe(true);
    const outra = fotoDoResumo(resumirMes([{ funcionario: 'ANA', dias: [dia(2, { saidaTarde: '18:00' })], regras }], { ano: 2026, mes: 11, feriados: new Set() }));
    expect(mesmaFoto(foto, outra)).toBe(false);
    expect(mesmaFoto(foto, null)).toBe(false);
  });
  it('sem folha ou com pendência impeditiva, não fecha', () => {
    expect(impedimentoParaFechar(resumirMes([], { ano: 2026, mes: 11, feriados: new Set() }))).toMatch(/Não há folha/);
    const r = resumirMes([{ funcionario: 'ANA', dias: [dia(2, { saidaTarde: null })], regras }], { ano: 2026, mes: 11, feriados: new Set() });
    expect(impedimentoParaFechar(r)).toMatch(/1 funcionário\(s\)/);
  });
});
