import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { gerarPdf } from '@/lib/contratosPdf';
import { normalizarDados, type Documento } from '@/lib/contratos';

const dados = (extra = {}) => normalizarDados({
  empresaNome: 'Vaz & Vouzela Ltda', empresaEndereco: 'Rua Três de Maio, nº 253 – São Brás – Belém/PA', cidade: 'Belém',
  nome: 'João da Conceição Ávila', sexo: 'M', cpf: '123.456.789-09', ctps: '1234567', ctpsUf: 'PA',
  nacionalidade: 'Brasileiro', estadoCivil: 'Solteiro(a)', funcao: 'Auxiliar de Açougue',
  salario: '1.518,00', salarioExtenso: 'mil quinhentos e dezoito reais',
  admissao: '2026-11-02', diasPeriodo: 45, diasProrrogacao: 45, vt: 'sim', endRua: 'Travessa São Pedro', endNum: '10',
  ...extra,
});

const cabecalho = (b: Uint8Array) => Buffer.from(b.slice(0, 5)).toString('latin1');

describe('gerarPdf', () => {
  it.each(['contrato', 'vale', 'encerramento'] as Documento[])('gera um PDF válido de %s', async (doc) => {
    const bytes = await gerarPdf(doc, dados());
    expect(cabecalho(bytes)).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(pdf.getTitle()).toContain('João da Conceição Ávila');
  });

  it('contrato tem corpo + termo de prorrogação (2 páginas ou mais)', async () => {
    const pdf = await PDFDocument.load(await gerarPdf('contrato', dados()));
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);
  });

  it('não quebra com caracteres fora do WinAnsi nem com dados vazios', async () => {
    await expect(gerarPdf('contrato', dados({ nome: 'Zé → Ŷ 😀', empresaNome: '' }))).resolves.toBeInstanceOf(Uint8Array);
    await expect(gerarPdf('vale', normalizarDados({ nome: 'X', admissao: '2026-11-02' }))).resolves.toBeInstanceOf(Uint8Array);
  });

  it('nomes e textos muito longos paginam sem erro', async () => {
    const longo = 'palavra '.repeat(400) + 'x'.repeat(300);
    await expect(gerarPdf('contrato', dados({ empresaEndereco: longo }))).resolves.toBeInstanceOf(Uint8Array);
  });
});
