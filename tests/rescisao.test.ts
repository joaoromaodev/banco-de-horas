import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  anosCompletos, avosFerias, diasAvisoProporcional, diasSaldoSalario, modosDeAviso, prazoPagamento, simularRescisao,
  somarMeses, type EntradaRescisao, type ResultadoRescisao,
} from '@/lib/rescisao';
import { gerarPdfRescisao } from '@/lib/rescisaoPdf';

// Exemplo conferido pelo `contador` (21/11/2026): admissão 10/03/2023, desligamento
// 20/11/2026, sem justa causa, aviso indenizado, R$ 2.000,00, períodos anteriores gozados.
const ferGozadas = [
  { aquisitivoInicio: '2023-03-10', inicio: '2024-06-03', dias: 30, abonoDias: 0 },
  { aquisitivoInicio: '2024-03-10', inicio: '2025-06-02', dias: 30, abonoDias: 0 },
];
const base = (extra: Partial<EntradaRescisao> = {}): EntradaRescisao => ({
  tipo: 'sem_justa_causa', aviso: 'indenizado', admissao: '2023-03-10', desligamento: '2026-11-20',
  salarioBase: 2000, ferias: ferGozadas, ...extra,
});
const v = (r: ResultadoRescisao, id: string) => r.linhas.find((l) => l.id === id)?.valor ?? 0;
const tem = (r: ResultadoRescisao, id: string) => r.linhas.some((l) => l.id === id);
const alerta = (r: ResultadoRescisao, trecho: string) => r.alertas.some((a) => a.texto.includes(trecho));

describe('utilidades de data', () => {
  it('somarMeses segura o fim do mês', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(somarMeses('2024-01-31', 1)).toBe('2024-02-29');
    expect(somarMeses('2026-03-10', 10)).toBe('2027-01-10');
  });
  it('anos completos contam no dia anterior ao aniversário', () => {
    expect(anosCompletos('2023-03-10', '2024-03-08')).toBe(0);
    expect(anosCompletos('2023-03-10', '2024-03-09')).toBe(1);
    expect(anosCompletos('2023-03-10', '2026-11-20')).toBe(3);
  });
  it('aviso proporcional: 30 + 3 por ano, até 90 (Lei 12.506)', () => {
    expect(diasAvisoProporcional(0)).toBe(30);
    expect(diasAvisoProporcional(1)).toBe(33);
    expect(diasAvisoProporcional(20)).toBe(90);
    expect(diasAvisoProporcional(35)).toBe(90);
  });
  it('avos de férias: mês do aquisitivo ou fração de 15 dias', () => {
    expect(avosFerias('2026-03-10', '2026-12-29')).toBe(10); // 9 meses + 20 dias
    expect(avosFerias('2026-03-10', '2026-12-23')).toBe(9); // 9 meses + 14 dias (10/12 a 23/12) → não conta
  });
  it('fração de 14 dias não conta; 15 conta', () => {
    expect(avosFerias('2026-03-10', '2026-04-22')).toBe(1); // 1 mês + 13 dias
    expect(avosFerias('2026-03-10', '2026-04-23')).toBe(1); // 1 mês + 14 dias
    expect(avosFerias('2026-03-10', '2026-04-24')).toBe(2); // 1 mês + 15 dias
    expect(avosFerias('2026-03-10', '2026-03-23')).toBe(0);
    expect(avosFerias('2026-03-10', '2027-03-09')).toBe(12);
  });
  it('saldo de salário em mês comercial de 30 dias', () => {
    expect(diasSaldoSalario('2020-01-01', '2026-11-20')).toBe(20);
    expect(diasSaldoSalario('2020-01-01', '2026-02-28')).toBe(30); // fevereiro completo
    expect(diasSaldoSalario('2020-01-01', '2026-01-31')).toBe(30); // mês de 31
    expect(diasSaldoSalario('2026-01-11', '2026-01-31')).toBe(20); // admitido no mês, até o fim
    expect(diasSaldoSalario('2026-11-05', '2026-11-20')).toBe(16);
  });
  it('prazo do art. 477: +10 dias, antecipado para dia útil', () => {
    expect(prazoPagamento('2026-11-20')).toBe('2026-11-30'); // segunda
    expect(prazoPagamento('2026-11-21')).toBe('2026-12-01'); // terça
    expect(prazoPagamento('2026-11-24')).toBe('2026-12-04'); // 04/12 sexta
    expect(prazoPagamento('2026-11-25')).toBe('2026-12-04'); // 05/12 sábado → sexta
    expect(prazoPagamento('2026-12-15')).toBe('2026-12-24'); // 25/12 feriado → 24
    expect(prazoPagamento('2026-11-03', ['2026-11-13'])).toBe('2026-11-12'); // feriado do escritório
  });
  it('modos de aviso por tipo', () => {
    expect(modosDeAviso('sem_justa_causa')).toEqual(['indenizado', 'trabalhado']);
    expect(modosDeAviso('pedido_demissao')[0]).toBe('trabalhado');
    expect(modosDeAviso('justa_causa')).toEqual(['nenhum']);
  });
});

describe('sem justa causa — exemplo conferido pelo contador', () => {
  const r = simularRescisao(base());
  it('aviso de 39 dias e projeção em 29/12/2026', () => {
    expect(r.erros).toEqual([]);
    expect(r.anosCompletos).toBe(3);
    expect(r.aviso.dias).toBe(39);
    expect(r.projecao).toBe('2026-12-29');
    expect(v(r, 'aviso')).toBe(2600);
  });
  it('verbas linha a linha', () => {
    expect(v(r, 'saldo')).toBe(1333.33);
    expect(v(r, '13')).toBe(1833.33);
    expect(v(r, '13_aviso')).toBe(166.67);
    expect(r.avos13).toEqual({ ate: 11, projecao: 1 });
    expect(v(r, 'ferias_2025-03-10')).toBe(2000);
    expect(v(r, 'terco_vencidas')).toBe(666.67);
    expect(v(r, 'ferias_prop')).toBe(1666.67);
    expect(v(r, 'terco_prop')).toBe(555.56);
  });
  it('total bruto R$ 10.822,23 (arredondamento por linha) e prazo 30/11', () => {
    expect(r.totalProventos).toBe(10822.23);
    expect(r.totalDescontos).toBe(0);
    expect(r.totalBruto).toBe(10822.23);
    expect(r.prazoPagamento).toBe('2026-11-30');
    expect(r.multa477).toBe(2000);
  });
  it('FGTS: 8% sobre saldo + aviso + 13º; multa só com saldo informado', () => {
    expect(r.fgts?.base).toBe(5933.33);
    expect(r.fgts?.deposito).toBe(474.67);
    expect(r.fgts?.multa).toBeNull();
    expect(alerta(r, 'multa de 40% não foi estimada')).toBe(true);
    const c = simularRescisao(base({ saldoFgts: 6000, fgtsMesAnterior: 160 }));
    expect(c.fgts?.multa).toBe(2653.87); // 40% × (6000 + 160 + 474,67)
  });
  it('alerta de estabilidade e de médias', () => {
    expect(alerta(r, 'estabilidades')).toBe(true);
    expect(alerta(r, 'Sem médias informadas')).toBe(true);
    expect(alerta(r, 'data-base')).toBe(true);
  });
});

describe('aviso trabalhado', () => {
  const r = simularRescisao(base({ aviso: 'trabalhado' }));
  it('30 trabalhados, acréscimo da Lei 12.506 indenizado e projetado', () => {
    // comunicação 21/10/2026 → 3 anos → 39 dias; 9 indenizados
    expect(r.aviso.comunicacao).toBe('2026-10-21');
    expect(r.aviso.trabalhados).toBe(30);
    expect(r.aviso.indenizados).toBe(9);
    expect(v(r, 'aviso')).toBe(600);
    expect(r.projecao).toBe('2026-11-29');
    expect(alerta(r, 'art. 488')).toBe(true);
  });
  it('menos de 1 ano: só os 30 trabalhados, nada indenizado', () => {
    const c = simularRescisao(base({ aviso: 'trabalhado', admissao: '2026-02-02', ferias: [] }));
    expect(c.aviso.dias).toBe(30);
    expect(tem(c, 'aviso')).toBe(false);
    expect(c.projecao).toBe('2026-11-20');
  });
});

describe('anos de aviso contados até a comunicação', () => {
  it('teto de 90 dias com 25 anos', () => {
    const r = simularRescisao(base({ admissao: '2001-01-15', ferias: [], periodosQuitados: [] }));
    expect(r.aviso.dias).toBe(90);
  });
  it('aniversário dentro do aviso trabalhado não conta (comunicação antes)', () => {
    // admissão 10/12/2023; comunicação 21/10/2026 → 2 anos (o 3º só em 09/12)
    const r = simularRescisao(base({ admissao: '2023-12-10', aviso: 'trabalhado', ferias: [] }));
    expect(r.anosCompletos).toBe(2);
    expect(r.aviso.dias).toBe(36);
  });
});

describe('pedido de demissão', () => {
  it('trabalhado: sem aviso a pagar, 13º e férias proporcionais (Súmulas 157 e 261)', () => {
    const r = simularRescisao(base({ tipo: 'pedido_demissao', aviso: 'trabalhado', admissao: '2026-05-04', ferias: [] }));
    expect(r.aviso.dias).toBe(30);
    expect(tem(r, 'aviso')).toBe(false);
    expect(r.projecao).toBe('2026-11-20');
    expect(r.avos13.ate).toBe(7); // mai (28 dias) … nov (20)
    expect(v(r, '13')).toBe(1166.67);
    expect(avosFerias('2026-05-04', '2026-11-20')).toBe(7); // 6 meses + 17 dias
    expect(v(r, 'ferias_prop')).toBe(1166.67);
    expect(r.fgts?.multa).toBeNull();
    expect(r.fgts?.percentual).toBe(0);
    expect(alerta(r, 'só vale a favor do empregado')).toBe(true);
  });
  it('não cumprido: desconta 30 dias do salário base, mesmo com médias', () => {
    const r = simularRescisao(base({ tipo: 'pedido_demissao', aviso: 'nao_cumprido', mediasVariaveis: 300 }));
    expect(v(r, 'aviso_desconto')).toBe(2000);
    expect(r.totalDescontos).toBe(2000);
  });
  it('cumprido em parte: só os dias que faltaram', () => {
    const r = simularRescisao(base({ tipo: 'pedido_demissao', aviso: 'parcial', diasAvisoNaoCumpridos: 12 }));
    expect(v(r, 'aviso_desconto')).toBe(800);
    expect(r.aviso.trabalhados).toBe(18);
  });
  it('dispensado pelo empregador: nada pago nem descontado', () => {
    const r = simularRescisao(base({ tipo: 'pedido_demissao', aviso: 'dispensado' }));
    expect(tem(r, 'aviso')).toBe(false);
    expect(tem(r, 'aviso_desconto')).toBe(false);
  });
});

describe('acordo (art. 484-A)', () => {
  const r = simularRescisao(base({ tipo: 'acordo', saldoFgts: 5000 }));
  it('metade do aviso indenizado, projeção pela metade (arredondada para cima)', () => {
    expect(r.aviso.indenizados).toBe(19.5);
    expect(v(r, 'aviso')).toBe(1300);
    expect(r.aviso.projetados).toBe(20);
    expect(r.projecao).toBe('2026-12-10');
    expect(alerta(r, 'pela metade ou integral')).toBe(true);
  });
  it('multa de 20% e alerta do saque de 80%', () => {
    expect(r.fgts?.percentual).toBe(0.2);
    expect(r.fgts?.multa).toBeCloseTo(0.2 * (5000 + (r.fgts?.deposito ?? 0)), 2);
    expect(alerta(r, '80%')).toBe(true);
  });
  it('demais verbas integrais', () => {
    expect(v(r, '13')).toBe(1833.33);
    expect(v(r, 'ferias_2025-03-10')).toBe(2000);
  });
});

describe('culpa recíproca', () => {
  it('metade do aviso, do 13º e das férias proporcionais; vencidas integrais; multa de 20%', () => {
    const r = simularRescisao(base({ tipo: 'culpa_reciproca', saldoFgts: 1000 }));
    expect(v(r, 'aviso')).toBe(1300);
    expect(r.projecao).toBe('2026-12-10');
    expect(r.avos13).toEqual({ ate: 11, projecao: 0 }); // dezembro com 10 dias não conta
    expect(v(r, '13')).toBe(916.67);
    expect(v(r, 'ferias_2025-03-10')).toBe(2000);
    // até 10/12: 9 meses (10/03→09/12) + 1 dia → 9 avos; × 1/2
    expect(v(r, 'ferias_prop')).toBe(750);
    expect(r.fgts?.percentual).toBe(0.2);
  });
});

describe('justa causa', () => {
  const r = simularRescisao(base({ tipo: 'justa_causa', aviso: 'indenizado', saldoFgts: 9000, decimoAdiantado: 900 }));
  it('só saldo e férias vencidas + 1/3', () => {
    expect(r.aviso.dias).toBe(0);
    expect(r.projecao).toBe('2026-11-20');
    expect(r.linhas.filter((l) => l.grupo === 'provento').map((l) => l.id)).toEqual(['saldo', 'ferias_2025-03-10', 'terco_vencidas']);
    expect(r.fgts?.multa).toBeNull();
    expect(alerta(r, 'reverti')).toBe(true);
  });
  it('a 1ª parcela do 13º adiantada vira desconto e não abate a base do FGTS', () => {
    expect(v(r, '13_adiantado')).toBe(900);
    expect(r.totalBruto).toBe(centavosSoma(1333.33 + 2000 + 666.67 - 900));
    expect(r.fgts?.base).toBe(1333.33);
  });
});
function centavosSoma(x: number) { return Math.round(x * 100) / 100; }

describe('férias vencidas', () => {
  it('em dobro quando o concessivo acabou antes do desligamento (1/3 sobre a dobra)', () => {
    // período 10/03/2023–09/03/2024 sem gozo: concessivo até 09/03/2025 < desligamento
    const r = simularRescisao(base({ ferias: [ferGozadas[1]] }));
    expect(v(r, 'ferias_2023-03-10')).toBe(4000);
    expect(v(r, 'terco_vencidas')).toBe(2000); // (4000 + 2000) ÷ 3
    expect(alerta(r, 'sem nenhuma férias no sistema')).toBe(true);
  });
  it('período marcado como quitado sai da conta', () => {
    const r = simularRescisao(base({ ferias: [ferGozadas[1]], periodosQuitados: ['2023-03-10'] }));
    expect(tem(r, 'ferias_2023-03-10')).toBe(false);
    expect(r.ferias.find((p) => p.inicio === '2023-03-10')?.quitado).toBe(true);
  });
  it('desconta gozo parcial até o desligamento e o abono vendido; programação futura não', () => {
    const fer = [...ferGozadas, { aquisitivoInicio: '2025-03-10', inicio: '2026-11-11', dias: 20, abonoDias: 10 }];
    const r = simularRescisao(base({ ferias: fer }));
    // 11/11 a 20/11 = 10 dias gozados + 10 de abono → devidos 10
    expect(r.ferias.find((p) => p.inicio === '2025-03-10')?.devidos).toBe(10);
    const futura = simularRescisao(base({ ferias: [...ferGozadas, { aquisitivoInicio: '2025-03-10', inicio: '2026-12-01', dias: 30, abonoDias: 0 }] }));
    expect(futura.ferias.find((p) => p.inicio === '2025-03-10')?.devidos).toBe(30);
  });
  it('faltas reduzem o direito (art. 130)', () => {
    const faltas = Array.from({ length: 6 }, (_, i) => `2025-04-0${i + 1}`);
    const r = simularRescisao(base({ faltas }));
    expect(r.ferias.find((p) => p.inicio === '2025-03-10')?.direito).toBe(24);
    expect(v(r, 'ferias_2025-03-10')).toBe(1600);
  });
  it('a projeção do aviso completa o período: vira vencida simples', () => {
    // admissão 01/01/2026, desligamento 10/12/2026 com 33? não: < 1 ano → 30 dias → projeção 09/01/2027
    const r = simularRescisao(base({ admissao: '2026-01-01', desligamento: '2026-12-10', ferias: [] }));
    expect(r.projecao).toBe('2027-01-09');
    expect(v(r, 'ferias_2026-01-01')).toBe(2000);
    // 13º: 12/12 de 2026 (11 até o desligamento + dezembro pela projeção); jan/2027 tem 9 dias → não
    expect(r.avos13).toEqual({ ate: 11, projecao: 1 });
  });
  it('concessivo que vence dentro da projeção: simples, com alerta', () => {
    // período 10/03/2025–09/03/2026, concessivo 09/03/2027; desligamento 01/03/2027 + 42 dias
    const r = simularRescisao(base({ desligamento: '2027-03-01', ferias: ferGozadas }));
    expect(r.projecao > '2027-03-09').toBe(true);
    expect(r.linhas.find((l) => l.id === 'ferias_2025-03-10')?.descricao).not.toContain('dobro');
    expect(alerta(r, 'vence dentro da projeção')).toBe(true);
  });
});

describe('13º atravessando o ano e adiantamento', () => {
  it('projeção em janeiro com 15 dias ou mais soma 1/12 do ano seguinte', () => {
    const r = simularRescisao(base({ desligamento: '2026-12-15' }));
    // 39 dias → 23/01/2027: 12/12 de 2026 (dezembro já conta até 15/12) + jan/2027 (23 dias)
    expect(r.projecao).toBe('2027-01-23');
    expect(r.avos13).toEqual({ ate: 12, projecao: 1 });
  });
  it('1ª parcela adiantada é desconto e sai da base do FGTS', () => {
    const r = simularRescisao(base({ decimoAdiantado: 1000 }));
    expect(v(r, '13_adiantado')).toBe(1000);
    expect(r.totalBruto).toBe(9822.23);
    expect(r.fgts?.base).toBe(4933.33);
  });
  it('faltas tiram o avo do mês com menos de 15 dias', () => {
    const faltas = ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10'];
    const r = simularRescisao(base({ faltas }));
    expect(r.avos13.ate).toBe(10); // novembro: 20 − 6 = 14 dias
    expect(v(r, 'saldo')).toBe(933.33); // 14 dias
    expect(alerta(r, 'repouso semanal')).toBe(true);
  });
});

describe('médias, adicionais e banco de horas', () => {
  it('adicionais fixos entram no saldo; médias não', () => {
    const r = simularRescisao(base({ adicionaisFixos: 300, mediasVariaveis: 600 }));
    expect(v(r, 'saldo')).toBe(1533.33); // 2300 ÷ 30 × 20
    expect(v(r, 'aviso')).toBe(3770); // 2900 ÷ 30 × 39
    expect(v(r, '13')).toBe(2658.33); // 2900 ÷ 12 × 11
    expect(r.multa477).toBe(2000); // salário base
    expect(alerta(r, 'Sem médias informadas')).toBe(false);
  });
  it('banco de horas positivo pago com 50% pelo divisor da jornada e com FGTS', () => {
    const r = simularRescisao(base({ bancoHorasPositivo: 10, horasSemanais: 44 }));
    expect(v(r, 'banco_horas')).toBe(136.36); // 2000 ÷ 220 × 1,5 × 10
    expect(r.fgts?.base).toBe(centavosSoma(5933.33 + 136.36));
    const r40 = simularRescisao(base({ bancoHorasPositivo: 10, horasSemanais: 40 }));
    expect(v(r40, 'banco_horas')).toBe(150);
  });
  it('acordo de banco de horas sem saldo informado → alerta', () => {
    expect(alerta(simularRescisao(base({ temBancoHoras: true })), 'banco de horas')).toBe(true);
  });
});

describe('descontos limitados (art. 477 §5º)', () => {
  it('o total considera no máximo um mês de remuneração', () => {
    const r = simularRescisao(base({ tipo: 'pedido_demissao', aviso: 'nao_cumprido', outrosDescontos: 1500 }));
    expect(r.totalDescontos).toBe(2000);
    expect(alerta(r, 'art. 477 §5º')).toBe(true);
  });
});

describe('contrato de experiência', () => {
  const exp = (extra: Partial<EntradaRescisao>) => base({ admissao: '2026-09-01', fimExperiencia: '2026-11-29', ferias: [], ...extra });
  it('término no prazo: sem aviso e sem multa', () => {
    const r = simularRescisao(exp({ tipo: 'experiencia_termino', desligamento: '2026-11-29', saldoFgts: 400 }));
    expect(r.erros).toEqual([]);
    expect(r.aviso.dias).toBe(0);
    expect(r.fgts?.multa).toBeNull();
    expect(r.avos13.ate).toBe(3);
    expect(avosFerias('2026-09-01', '2026-11-29')).toBe(3);
    expect(v(r, 'ferias_prop')).toBe(500);
  });
  it('antecipado pelo empregador: metade dos dias que faltavam (art. 479) e multa de 40%', () => {
    const r = simularRescisao(exp({ tipo: 'experiencia_antecipada_empregador', desligamento: '2026-10-30', saldoFgts: 300 }));
    expect(v(r, 'art479')).toBe(1000); // 30 dias ÷ 2 = 15 dias
    expect(r.fgts?.percentual).toBe(0.4);
    expect(r.fgts?.base).toBe(centavosSoma(v(r, 'saldo') + v(r, '13'))); // art. 479 sem FGTS
    expect(r.projecao).toBe('2026-10-30');
  });
  it('antecipado pelo empregado: art. 480 é informativo, fora do total', () => {
    const r = simularRescisao(exp({ tipo: 'experiencia_antecipada_empregado', desligamento: '2026-10-30' }));
    expect(r.linhas.find((l) => l.id === 'art480')?.grupo).toBe('informativo');
    expect(r.totalBruto).toBe(r.totalProventos);
    expect(r.linhas.find((l) => l.id === 'art480')?.valor).toBe(1000);
  });
  it('erros: mais de 90 dias, desligamento depois do termo, falta o termo', () => {
    expect(simularRescisao(exp({ tipo: 'experiencia_termino', fimExperiencia: '2026-12-15', desligamento: '2026-12-15' })).erros[0]).toContain('90 dias');
    expect(simularRescisao(exp({ tipo: 'experiencia_antecipada_empregador', desligamento: '2026-12-01' })).erros[0]).toContain('prazo indeterminado');
    expect(simularRescisao(exp({ tipo: 'experiencia_termino', fimExperiencia: null })).erros[0]).toContain('último dia');
    expect(simularRescisao(exp({ tipo: 'experiencia_antecipada_empregador', desligamento: '2026-11-29' })).erros[0]).toContain('no prazo');
  });
});

describe('outros tipos e validação', () => {
  it('rescisão indireta = verbas da dispensa sem justa causa', () => {
    const a = simularRescisao(base({ tipo: 'rescisao_indireta' }));
    expect(a.totalBruto).toBe(10822.23);
    expect(a.fgts?.percentual).toBe(0.4);
  });
  it('falecimento: sem aviso nem multa, com 13º e férias', () => {
    const r = simularRescisao(base({ tipo: 'falecimento', saldoFgts: 1000 }));
    expect(r.aviso.dias).toBe(0);
    expect(r.fgts?.multa).toBeNull();
    expect(v(r, '13')).toBe(1833.33);
    expect(alerta(r, 'Lei 6.858/80')).toBe(true);
  });
  it('doméstico: sem multa do FGTS', () => {
    const r = simularRescisao(base({ domestico: true, saldoFgts: 5000 }));
    expect(r.fgts?.multa).toBeNull();
    expect(r.fgts?.memoria).toContain('3,2%');
  });
  it('empregado afastado → alerta de perigo', () => {
    const r = simularRescisao(base({ situacao: 'afastado', afastamentoTipo: 'acidente' }));
    expect(r.alertas.some((a) => a.nivel === 'perigo' && a.texto.includes('acidente'))).toBe(true);
  });
  it('férias programadas dentro do aviso → alerta', () => {
    const r = simularRescisao(base({ ferias: [...ferGozadas, { aquisitivoInicio: '2025-03-10', inicio: '2026-12-01', dias: 15, abonoDias: 0 }] }));
    expect(alerta(r, 'não podem coincidir')).toBe(true);
  });
  it('erros de entrada', () => {
    expect(simularRescisao(base({ salarioBase: 0 })).erros).toContain('Informe o salário base.');
    expect(simularRescisao(base({ admissao: '' })).erros[0]).toContain('admissão');
    expect(simularRescisao(base({ desligamento: '2020-01-01' })).erros[0]).toContain('antes da admissão');
    expect(simularRescisao(base({ desligamento: '2026-02-30' })).erros[0]).toContain('desligamento');
  });
  it('modo de aviso inválido para o tipo cai no padrão', () => {
    const r = simularRescisao(base({ tipo: 'rescisao_indireta', aviso: 'trabalhado' }));
    expect(r.aviso.trabalhados).toBe(0);
    expect(v(r, 'aviso')).toBe(2600);
  });
  it('aquisitivo editado (art. 133 §2º) muda os períodos', () => {
    const r = simularRescisao(base({ aquisitivoBase: '2025-08-01', ferias: [] }));
    expect(r.ferias.map((p) => p.inicio)).toEqual(['2025-08-01']);
    // proporcionais desde 01/08/2026 até 29/12: 4 meses + 29 dias → 5
    expect(v(r, 'ferias_prop')).toBe(833.33);
  });
});

describe('PDF da simulação', () => {
  it('gera um PDF válido com marca de simulação e acentos', async () => {
    const entrada = base({ saldoFgts: 6000, decimoAdiantado: 500, mediasVariaveis: 200 });
    const resultado = simularRescisao(entrada);
    const bytes = await gerarPdfRescisao({
      empresa: { nome: 'Vaz & Vouzela Ltda', cnpj: '12.345.678/0001-90' },
      empregado: { nome: 'João da Conceição Ávila', cpf: '52998224725', cargo: 'Açougueiro' },
      entrada, resultado, data: '2026-11-21',
    });
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(pdf.getTitle()).toBe('Simulação de rescisão — João da Conceição Ávila');
  });
  it('experiência antecipada pelo empregado (informativo) também sai', async () => {
    const entrada = base({ tipo: 'experiencia_antecipada_empregado', admissao: '2026-09-01', fimExperiencia: '2026-11-29', desligamento: '2026-10-30', ferias: [] });
    const bytes = await gerarPdfRescisao({ empresa: { nome: 'Teste' }, empregado: { nome: 'Fulano' }, entrada, resultado: simularRescisao(entrada), data: '2026-11-21' });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
