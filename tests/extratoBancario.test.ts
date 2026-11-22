// Extrato no caixa (Sprint 17, Frente D) — regra pura: OFX e CSV sintéticos,
// classificação, as pernas de cada modo (a regra da contadora: banco fora do caixa)
// e a conciliação com o livro.
import { describe, expect, it } from 'vitest';
import {
  conciliar, decodificarExtrato, diasEntre, ehTransferencia, FORMATO_CHAVE_EXTRATO, HISTORICO_DEPOSITO, HISTORICO_RETIRADA,
  lerCsv, lerDataBanco, lerExtrato, lerLote, lerOfx, lerValorBanco, mapaPeloCabecalho, mascararHistorico, mesTravado,
  pernasDaLinha, sugerirPerna, tipoDaLinha, type LancamentoConciliacao, type LinhaExtrato,
} from '@/lib/extratoBancario';

// OFX 1.x (SGML, sem fechar as folhas), como o Itaú/BB exportam, em Windows-1252.
const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS><DTSERVER>20260210120000[-3:BRT]<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>0341<BRANCHID>1234<ACCTID>98765-4<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260101<DTEND>20260131
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260105100000[-3:BRT]<TRNAMT>1500.00<FITID>A001<MEMO>PIX RECEBIDO CLIENTE LTDA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260110<TRNAMT>-320.50<FITID>A002<MEMO>PAGTO CONTA DE LUZ EQUATORIAL</STMTTRN>
<STMTTRN><TRNTYPE>ATM<DTPOSTED>20260112<TRNAMT>-200.00<FITID>A003<MEMO>SAQUE CAIXA ELETRONICO</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260115<TRNAMT>800,00<FITID>A004<MEMO>DEPOSITO EM DINHEIRO</STMTTRN>
<STMTTRN><TRNTYPE>CHECK<DTPOSTED>20260120<TRNAMT>-450.00<FITID>A005<CHECKNUM>000123<MEMO>CHEQUE COMPENSADO</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260125<TRNAMT>-12.90<FITID>A006<MEMO>TARIFA PACOTE SERVIÇOS CPF 123.456.789-09</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>1316.60<DTASOF>20260131</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>
`;

// OFX 2.x (XML, tudo fechado).
const OFX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>260</BANKID><ACCTID>12345678</ACCTID></BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260301000000</DTSTART><DTEND>20260331000000</DTEND>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20260302</DTPOSTED><TRNAMT>99.90</TRNAMT><FITID>x-1</FITID><NAME>Transferência recebida</NAME><MEMO>Fulano &amp; Cia</MEMO></STMTTRN>
<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260303</DTPOSTED><TRNAMT>-10.00</TRNAMT><FITID>x-2</FITID><MEMO>Compra no débito</MEMO></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

const linha = (p: Partial<LinhaExtrato>): LinhaExtrato => ({
  chave: `ofx:${'a'.repeat(26)}`, data: '2026-01-10', valor: 100, sentido: 'debito', historico: 'PIX ENVIADO',
  documento: null, tipo: 'movimento', ordem: 1, ...p,
});
const lanc = (p: Partial<LancamentoConciliacao>): LancamentoConciliacao => ({
  id: 'l1', data: '2026-01-10', historico: 'Pago conta de luz', complemento: null, contaId: 'c-luz', entrada: 0, saida: 100, ...p,
});

describe('leitura de valores e datas', () => {
  it('valor como os bancos escrevem', () => {
    expect(lerValorBanco('-1.234,56')).toBe(-1234.56);
    expect(lerValorBanco('1234.56', true)).toBe(1234.56);
    expect(lerValorBanco('R$ 1.234,56 D')).toBe(-1234.56);
    expect(lerValorBanco('100,00-')).toBe(-100);
    expect(lerValorBanco('(50,00)')).toBe(-50);
    expect(lerValorBanco('1.234')).toBe(1234); // milhar no CSV brasileiro
    expect(lerValorBanco('1.234', true)).toBe(1.23); // decimal no OFX
    expect(lerValorBanco('abc')).toBeNull();
    expect(lerValorBanco('')).toBeNull();
  });
  it('datas', () => {
    expect(lerDataBanco('31/01/2026')).toBe('2026-01-31');
    expect(lerDataBanco('31/01/26')).toBe('2026-01-31');
    expect(lerDataBanco('2026-01-31 10:00')).toBe('2026-01-31');
    expect(lerDataBanco('20260131120000[-3:BRT]')).toBe('2026-01-31');
    expect(lerDataBanco('31/02/2026')).toBeNull();
    expect(diasEntre('2025-12-31', '2026-01-02')).toBe(2);
  });
  it('CPF, números longos e e-mail saem do histórico', () => {
    expect(mascararHistorico('PIX 123.456.789-09 JOAO joao@x.com conta 12345678901')).toBe('PIX [CPF] JOAO [e-mail] conta [número]');
    expect(mascararHistorico('PIX ***.456.789-** MARIA')).toBe('PIX [CPF] MARIA');
  });
  it('Windows-1252 declarado no cabeçalho do OFX', () => {
    const bytes = new Uint8Array([...new TextEncoder().encode('CHARSET:1252\n<OFX><MEMO>SERVI'), 0xc7, 0x4f]);
    expect(decodificarExtrato(bytes)).toContain('SERVIÇO');
    expect(decodificarExtrato(new TextEncoder().encode('Descrição'))).toBe('Descrição');
  });
});

describe('OFX', () => {
  it('1.x SGML: transações, sinal, conta mascarada e período', () => {
    const r = lerOfx(OFX_SGML);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const l = r.leitura;
    expect(l.formato).toBe('ofx');
    expect(l.linhas).toHaveLength(6);
    expect(l.conta).toBe('Banco 341 · conta final 7654');
    expect(l.periodo).toEqual({ de: '2026-01-01', ate: '2026-01-31' });
    expect(l.linhas.map((x) => [x.data, x.valor, x.sentido, x.tipo])).toEqual([
      ['2026-01-05', 1500, 'credito', 'movimento'],
      ['2026-01-10', 320.5, 'debito', 'movimento'],
      ['2026-01-12', 200, 'debito', 'saque'],
      ['2026-01-15', 800, 'credito', 'deposito'],
      ['2026-01-20', 450, 'debito', 'cheque'],
      ['2026-01-25', 12.9, 'debito', 'movimento'],
    ]);
    expect(l.linhas[4].documento).toBe('000123');
    expect(l.linhas[5].historico).toBe('TARIFA PACOTE SERVIÇOS CPF [CPF]');
    expect(l.linhas.every((x) => FORMATO_CHAVE_EXTRATO.test(x.chave))).toBe(true);
    // Mesma entrada, mesma chave (é o que barra a importação dupla).
    const deNovo = lerOfx(OFX_SGML);
    expect(deNovo.ok && deNovo.leitura.linhas.map((x) => x.chave)).toEqual(l.linhas.map((x) => x.chave));
  });
  it('2.x XML, com NAME + MEMO e entidade', () => {
    const r = lerExtrato(OFX_XML);
    expect(r.ok && r.leitura.linhas.map((x) => [x.historico, x.sentido])).toEqual([
      ['Transferência recebida — Fulano & Cia', 'credito'], ['Compra no débito', 'debito'],
    ]);
  });
  it('FITID repetido com a mesma data e valor vira #2 (não some)', () => {
    const dup = OFX_SGML.replace('<TRNTYPE>DEBIT<DTPOSTED>20260110<TRNAMT>-320.50<FITID>A002<MEMO>PAGTO CONTA DE LUZ EQUATORIAL',
      '<TRNTYPE>CREDIT<DTPOSTED>20260105<TRNAMT>1500.00<FITID>A001<MEMO>PIX RECEBIDO CLIENTE LTDA');
    const r = lerOfx(dup);
    expect(r.ok && r.leitura.linhas[1].chave).toBe(r.ok && `${r.leitura.linhas[0].chave}#2`);
  });
  it('sem transação ou sem <OFX>: erro claro', () => {
    expect(lerOfx('OFXHEADER:100\n<OFX></OFX>')).toEqual({ ok: false, erro: 'Não achei nenhuma transação neste OFX.' });
    expect(lerExtrato('<html><body>oi</body></html>').ok).toBe(false);
  });
});

describe('CSV dos bancos', () => {
  it('Itaú: preâmbulo, ";", valor assinado, linha de saldo fora', () => {
    const csv = 'Agência: 1234 Conta: 98765-4\n\ndata;lançamento;ag./origem;valor (R$);saldos (R$)\n02/01/2026;SALDO ANTERIOR;;;1.000,00\n05/01/2026;PIX TRANSF JOSE;;-150,00;850,00\n06/01/2026;TED RECEBIDA ACME;;2.500,00;3.350,00\n';
    const r = lerCsv(csv);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.leitura.linhas.map((x) => [x.data, x.valor, x.sentido, x.historico])).toEqual([
      ['2026-01-05', 150, 'debito', 'PIX TRANSF JOSE'], ['2026-01-06', 2500, 'credito', 'TED RECEBIDA ACME'],
    ]);
    expect(r.leitura.descartadas).toBe(1);
    expect(r.leitura.csv?.mapa).toMatchObject({ data: 0, historico: 1, valor: 3 });
  });
  it('Banco do Brasil: vírgula, aspas, valor com ponto decimal', () => {
    const csv = '"Data","Dependencia Origem","Histórico","Data do Balancete","Número do documento","Valor",\n"10/02/2026","","Pagamento de Boleto - ENERGIA","","123","-89.90",\n"11/02/2026","","Depósito em dinheiro","","","300.00",\n"11/02/2026","","Saldo do dia","","","0",\n';
    const r = lerCsv(csv);
    expect(r.ok && r.leitura.linhas.map((x) => [x.valor, x.sentido, x.tipo, x.documento])).toEqual([
      [89.9, 'debito', 'movimento', '123'], [300, 'credito', 'deposito', null],
    ]);
  });
  it('colunas de crédito e débito separadas', () => {
    const csv = 'Data;Descrição;Crédito;Débito;Saldo\n03/03/2026;Recebimento cartão;1.200,00;;\n04/03/2026;Aluguel;;2.000,00;\n';
    const r = lerCsv(csv);
    expect(r.ok && r.leitura.linhas.map((x) => [x.valor, x.sentido])).toEqual([[1200, 'credito'], [2000, 'debito']]);
  });
  it('valor sem sinal + coluna D/C', () => {
    const csv = 'Data;Histórico;Valor;D/C\n03/03/2026;Tarifa;10,00;D\n04/03/2026;Pix;50,00;C\n';
    const r = lerCsv(csv);
    expect(r.ok && r.leitura.linhas.map((x) => x.sentido)).toEqual(['debito', 'credito']);
  });
  it('cabeçalho desconhecido: pede o mapeamento; com ele, lê', () => {
    const csv = 'quando,oque,quanto\n2026-04-01,Venda,100.50\n2026-04-02,Compra,-20\n';
    const r = lerCsv(csv);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.csv?.colunas).toHaveLength(3);
    const ok = lerCsv(csv, { data: 0, historico: 1, valor: 2 });
    expect(ok.ok && ok.leitura.linhas.map((x) => [x.valor, x.sentido])).toEqual([[100.5, 'credito'], [20, 'debito']]);
    expect(lerCsv(csv, { data: 0, historico: 9, valor: 2 }).ok).toBe(false);
  });
  it('mapa pelo cabeçalho não confunde "data lançamento" com o histórico', () => {
    expect(mapaPeloCabecalho(['Data Lançamento', 'Histórico', 'Valor', 'Saldo'])).toMatchObject({ data: 0, historico: 1, valor: 2 });
    expect(mapaPeloCabecalho(['Nome', 'Idade'])).toBeNull();
  });
});

describe('classificação e pernas (a regra do banco fora do caixa)', () => {
  it('só é saque/depósito em dinheiro quando o banco diz', () => {
    expect(tipoDaLinha('SAQUE 24H', 'debito')).toBe('saque');
    expect(tipoDaLinha('DEP DINHEIRO AG 1234', 'credito')).toBe('deposito');
    expect(tipoDaLinha('DEPOSITO', 'credito')).toBe('movimento'); // pode ser um cliente pagando
    expect(tipoDaLinha('CHEQUE COMPENSADO', 'debito')).toBe('cheque');
    expect(tipoDaLinha('DEPOSITO CHEQUE', 'credito')).toBe('movimento');
  });
  it('modo par: pagamento = retirada + pagamento; recebimento = recebimento + depósito', () => {
    const pg = pernasDaLinha(linha({ sentido: 'debito' }), 'par');
    expect(pg.map((p) => [p.direcao, p.historico, p.transferencia])).toEqual([['entrada', HISTORICO_RETIRADA, true], ['saida', '', false]]);
    const rc = pernasDaLinha(linha({ sentido: 'credito' }), 'par');
    expect(rc.map((p) => [p.direcao, p.historico, p.transferencia])).toEqual([['entrada', '', false], ['saida', HISTORICO_DEPOSITO, true]]);
    // Saque é entrada no caixa; depósito em dinheiro é saída — a regra da contadora.
    expect(pernasDaLinha(linha({ tipo: 'saque' }), 'par').map((p) => [p.direcao, p.historico])).toEqual([['entrada', HISTORICO_RETIRADA]]);
    expect(pernasDaLinha(linha({ tipo: 'deposito', sentido: 'credito' }), 'par').map((p) => [p.direcao, p.historico])).toEqual([['saida', HISTORICO_DEPOSITO]]);
    const ch = pernasDaLinha(linha({ tipo: 'cheque', documento: '123' }), 'par');
    expect(ch.map((p) => p.complemento)).toEqual(['Cheque 123 — PIX ENVIADO', 'Cheque 123 — PIX ENVIADO']);
    // O par é neutro no caixa: a soma das transferências zera a principal.
    for (const ps of [pg, rc]) expect(ps.reduce((s, p) => s + (p.direcao === 'entrada' ? p.valor : -p.valor), 0)).toBe(0);
  });
  it('modo direto: uma perna; saque e depósito em dinheiro ficam fora', () => {
    expect(pernasDaLinha(linha({ sentido: 'debito' }), 'direto').map((p) => p.direcao)).toEqual(['saida']);
    expect(pernasDaLinha(linha({ sentido: 'credito' }), 'direto').map((p) => p.direcao)).toEqual(['entrada']);
    expect(pernasDaLinha(linha({ tipo: 'saque' }), 'direto')).toEqual([]);
  });
  it('transferência reconhecida pelo texto do livro', () => {
    expect(ehTransferencia('Retirada de conta corrente')).toBe(true);
    expect(ehTransferencia('Deposito em conta corrente')).toBe(true);
    expect(ehTransferencia('Pago conta de luz')).toBe(false);
  });
  it('a conta vem da caixaInteligente e nunca na transferência', () => {
    const base = {
      exemplos: [], contas: [{ id: 'c-luz', codigo: '2.02.02', nome: 'Energia Elétrica', natureza: 'despesa' as const }],
      analiticas: [{ id: 'h-luz', texto: 'Pago conta de luz', contaId: 'c-luz', natureza: 'despesa' as const }],
    };
    const [ret, pag] = pernasDaLinha(linha({ historico: 'PAGTO CONTA DE LUZ EQUATORIAL' }), 'par');
    expect(sugerirPerna(ret, base)).toBeNull();
    expect(sugerirPerna(pag, base)).toMatchObject({ origem: 'analitica' });
    expect(pag).toMatchObject({ contaId: 'c-luz', historicoId: 'h-luz', historico: 'Pago conta de luz' });
  });
});

describe('conciliação', () => {
  const periodo = { de: '2026-01-01', ate: '2026-01-31' };
  it('casa por valor, direção e data ± 2 dias; o resto é sugestão', () => {
    const linhas = [
      linha({ chave: `ofx:${'1'.repeat(26)}`, ordem: 1, data: '2026-01-10', valor: 100 }),
      linha({ chave: `ofx:${'2'.repeat(26)}`, ordem: 2, data: '2026-01-20', valor: 55 }),
    ];
    const caixa = [
      lanc({ id: 'pag', data: '2026-01-12', saida: 100 }), // 2 dias: casa
      lanc({ id: 'ret', data: '2026-01-10', historico: HISTORICO_RETIRADA, contaId: null, entrada: 100, saida: 0 }),
      lanc({ id: 'longe', data: '2026-01-25', saida: 55 }), // 5 dias: não casa
      lanc({ id: 'dinheiro', data: '2026-01-15', historico: 'Venda à vista', entrada: 30, saida: 0 }),
    ];
    const c = conciliar(linhas, caixa, { modo: 'par', periodo });
    expect(c.itens[0]).toMatchObject({ estado: 'casada', pernas: [] });
    expect(c.itens[0].casadoCom.map((l) => l.id).sort()).toEqual(['pag', 'ret']);
    expect(c.itens[1]).toMatchObject({ estado: 'nova' });
    expect(c.itens[1].pernas).toHaveLength(2);
    expect(c.soNoCaixa.outros.map((l) => l.id).sort()).toEqual(['dinheiro', 'longe']);
    expect(c.totais).toMatchObject({ linhas: 2, novas: 1, casadas: 1 });
  });
  it('um para um: dois PIX iguais no banco e um no caixa → um casado, um novo', () => {
    const l1 = linha({ chave: `csv:${'1'.repeat(26)}`, ordem: 1, sentido: 'credito' });
    const l2 = linha({ chave: `csv:${'1'.repeat(26)}#2`, ordem: 2, sentido: 'credito' });
    const c = conciliar([l1, l2], [lanc({ id: 'rec', historico: 'Recebido', entrada: 100, saida: 0 })], { modo: 'direto', periodo });
    expect(c.itens.map((i) => i.estado)).toEqual(['casada', 'nova']);
  });
  it('parcial: o pagamento já está no caixa, falta a retirada', () => {
    const c = conciliar([linha({})], [lanc({ id: 'pag' })], { modo: 'par', periodo });
    expect(c.itens[0].estado).toBe('parcial');
    expect(c.itens[0].pernas.map((p) => p.historico)).toEqual([HISTORICO_RETIRADA]);
    expect(c.itens[0].notas[0]).toContain('falta "Retirada de conta corrente"');
  });
  it('transferência do caixa sem par no banco é diferença à parte', () => {
    const c = conciliar([], [lanc({ id: 'dep', historico: HISTORICO_DEPOSITO, contaId: null })], { modo: 'par', periodo });
    expect(c.soNoCaixa.transferencias.map((l) => l.id)).toEqual(['dep']);
  });
  it('linha já importada (a chave) não sugere de novo e prende os lançamentos dela', () => {
    const l = linha({});
    const marcas = new Map([[l.chave, { situacao: 'lancada' as const, lancamentoIds: ['ret', 'pag'] }]]);
    const caixa = [lanc({ id: 'pag' }), lanc({ id: 'ret', historico: HISTORICO_RETIRADA, contaId: null, entrada: 100, saida: 0 })];
    const c = conciliar([l], caixa, { modo: 'par', periodo, marcas });
    expect(c.itens[0]).toMatchObject({ estado: 'importada', pernas: [] });
    expect(c.soNoCaixa.outros).toEqual([]);
  });
  it('mês fechado (ou anterior a um fechado) trava a linha', () => {
    expect(mesTravado('2026-01-10', { 2026: [1] })).toBe(true);
    expect(mesTravado('2026-01-10', { 2026: [3] })).toBe(true);
    expect(mesTravado('2026-04-10', { 2026: [3] })).toBe(false);
    const c = conciliar([linha({})], [], { modo: 'par', periodo, fechadosPorAno: { 2026: [1] } });
    expect(c.itens[0].travada).toBe(true);
    expect(c.totais.travadas).toBe(1);
  });
  it('modo direto: saque fica fora, não vira lançamento', () => {
    const c = conciliar([linha({ tipo: 'saque' })], [], { modo: 'direto', periodo });
    expect(c.itens[0].estado).toBe('fora');
  });
  it('1.000 linhas × 1.000 lançamentos em menos de 1 s', () => {
    const ls = Array.from({ length: 1000 }, (_, i) => linha({ chave: `csv:${i.toString(16).padStart(26, '0')}`, ordem: i, valor: 10 + (i % 50), data: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}` }));
    const cx = Array.from({ length: 1000 }, (_, i) => lanc({ id: `l${i}`, saida: 10 + (i % 50), data: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}` }));
    const t = performance.now();
    conciliar(ls, cx, { modo: 'par', periodo });
    expect(performance.now() - t).toBeLessThan(1000);
  });
});

describe('lote', () => {
  const ok = { chave: `ofx:${'a'.repeat(26)}`, data: '2026-01-10', valor: 10, sentido: 'debito', acao: 'lancar', pernas: [{ direcao: 'saida', valor: 10, historico: 'X' }] };
  it('valida', () => {
    expect(lerLote([ok]).ok).toBe(true);
    expect(lerLote([])).toMatchObject({ ok: false });
    expect(lerLote([{ ...ok, chave: 'qualquer' }])).toMatchObject({ ok: false });
    expect(lerLote([ok, ok])).toMatchObject({ ok: false, erro: 'A mesma linha do extrato apareceu duas vezes.' });
    expect(lerLote([{ ...ok, pernas: [] }])).toMatchObject({ ok: false });
    expect(lerLote([{ ...ok, acao: 'casar', lancamentoIds: ['nao-uuid'] }])).toMatchObject({ ok: false });
    expect(lerLote(Array.from({ length: 501 }, (_, i) => ({ ...ok, chave: `ofx:${i.toString(16).padStart(26, '0')}` })))).toMatchObject({ ok: false });
  });
});
