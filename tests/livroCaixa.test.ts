// O PDF do livro é gerado só com pdf-lib a partir de LivroCaixaDados — não toca
// o banco —, então dá para exercitar saldo transportado e folhas aqui.
// O saldo corrido em si (saldo + entrada − saidaEfetiva) é reproduzido por
// `montarLivro` (I/O) e por `desenharMes` (privada); ver docs/testes.md.
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { gerarLivroCaixaPDF } from '@/lib/livroCaixa';
import type { LivroCaixaDados, LinhaLivro, MesLivro } from '@/lib/caixa';
import { saidaEfetiva } from '@/lib/caixa';

const linha = (n: number, p: Partial<LinhaLivro>): LinhaLivro => ({
  id: String(n), data: '2026-01-10', historico: 'Recebido de cliente', complemento: null, contaId: null,
  entrada: 0, saida: 0, juros: 0, multa: 0, pagadorNome: null, pagadorDocumento: null,
  criadoPor: 'a', criadoEm: '2026-01-10T10:00:00Z', atualizadoPor: null, conferidoPor: null, conferidoEm: null,
  contaCodigo: null, contaNome: null, ...p,
});

/** Mesma conta de `montarLivro`: encadeia o saldo transportado mês a mês. */
function encadear(saldoInicial: number, porMes: Record<number, LinhaLivro[]>): MesLivro[] {
  const meses: MesLivro[] = [];
  let saldo = saldoInicial;
  for (let m = 1; m <= 12; m++) {
    const linhas = porMes[m] ?? [];
    const entradas = linhas.reduce((s, l) => s + l.entrada, 0);
    const saidas = linhas.reduce((s, l) => s + saidaEfetiva(l), 0);
    meses.push({ mes: m, saldoTransportado: saldo, linhas, entradas, saidas, saldoFinal: saldo + entradas - saidas });
    saldo = saldo + entradas - saidas;
  }
  return meses;
}

const dados = (meses: MesLivro[], tipoPessoa: 'juridica' | 'fisica' = 'juridica'): LivroCaixaDados => ({
  empresa: { id: 'e1', nome: 'Empresa Teste Ltda', documento: '11222333000181', tipoPessoa },
  fiscal: {
    endereco: 'Rua A', numeroEndereco: '10', municipio: 'Belém', estado: 'PA', inscricaoEstadual: null,
    inscricaoMunicipal: null, registroJunta: null, registroNumero: null, prefeitura: null, cidadeTermo: 'Belém',
    contabilista: 'Edilse Goes da Costa', crc: '01619/0-3',
  },
  termo: { numeroLivro: 1, numeroOrdem: 1, dataTermo: '2026-12-31', qtdFolhas: null },
  exercicioId: 'x1', ano: 2026, saldoInicial: 1000, meses,
  totalEntradas: meses.reduce((s, m) => s + m.entradas, 0),
  totalSaidas: meses.reduce((s, m) => s + m.saidas, 0),
  saldoFinalAno: meses[11].saldoFinal,
});

describe('saldo transportado e saldo corrido (mesma regra do livro)', () => {
  const meses = encadear(1000, {
    1: [linha(1, { entrada: 500 }), linha(2, { saida: 200, juros: 10, multa: 5 })],
    2: [linha(3, { saida: 1500 })], // deixa o saldo negativo
  });
  it('cada mês recebe o saldo final do anterior', () => {
    expect(meses[0].saldoTransportado).toBe(1000);
    expect(meses[0].saldoFinal).toBe(1000 + 500 - 215);
    expect(meses[1].saldoTransportado).toBe(meses[0].saldoFinal);
    expect(meses[1].saldoFinal).toBe(1285 - 1500);
    expect(meses[11].saldoTransportado).toBe(meses[1].saldoFinal); // meses vazios só transportam
    expect(meses[11].saldoFinal).toBe(-215);
  });
  it('a saída do mês é a efetiva (com juros e multa)', () => {
    expect(meses[0].saidas).toBe(215);
  });
  it('cheque: retirada + pagamento é neutro no caixa', () => {
    const [m] = encadear(0, { 1: [linha(1, { entrada: 107 }), linha(2, { saida: 100, juros: 5, multa: 2 })] });
    expect(m.saldoFinal).toBe(0);
  });
});

describe('gerarLivroCaixaPDF', () => {
  it('gera PDF válido com termo de abertura + miolo + encerramento', async () => {
    const meses = encadear(1000, { 1: [linha(1, { entrada: 500 })] });
    const { pdf, qtdFolhas } = await gerarLivroCaixaPDF(dados(meses));
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(qtdFolhas);
    expect(qtdFolhas).toBe(12 + 2); // 1 página por mês + 2 termos
  });
  it('mês com muitos lançamentos ocupa mais de uma folha', async () => {
    const muitas = Array.from({ length: 60 }, (_, i) => linha(i, { entrada: 1 }));
    const { qtdFolhas } = await gerarLivroCaixaPDF(dados(encadear(0, { 3: muitas })));
    expect(qtdFolhas).toBeGreaterThan(14);
  });
  it('pessoa física e dados faltando (linhas pontilhadas) não quebram', async () => {
    const d = dados(encadear(0, {}), 'fisica');
    d.termo = { numeroLivro: null, numeroOrdem: null, dataTermo: null, qtdFolhas: null };
    d.fiscal.cidadeTermo = null;
    await expect(gerarLivroCaixaPDF(d)).resolves.toMatchObject({ qtdFolhas: 14 });
  });
});
