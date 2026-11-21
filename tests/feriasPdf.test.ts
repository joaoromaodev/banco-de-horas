import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { gerarPdfFerias, type DadosDocumentoFerias } from '@/lib/feriasPdf';

const dados = (extra: Partial<DadosDocumentoFerias['ferias']> = {}): DadosDocumentoFerias => ({
  empresa: { nome: 'Vaz & Vouzela Ltda', cnpj: '12.345.678/0001-90', cidade: 'Belém' },
  empregado: { nome: 'João da Conceição Ávila', cpf: '52998224725', cargo: 'Açougueiro', admissao: '2025-03-10' },
  periodo: { inicio: '2025-03-10', fim: '2026-03-09' },
  ferias: { inicio: '2027-01-04', dias: 20, abonoDias: 10, avisoEm: '2026-12-01', pagamentoEm: '2026-12-31', ...extra },
  data: '2026-12-01',
});

describe('gerarPdfFerias', () => {
  it.each(['aviso', 'recibo'] as const)('gera um PDF válido de %s, com acentos', async (doc) => {
    const bytes = await gerarPdfFerias(doc, dados());
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toContain('João da Conceição Ávila');
  });
  it('sem abono, sem pagamento e sem CPF também sai', async () => {
    const d = dados({ abonoDias: 0, pagamentoEm: null });
    d.empregado.cpf = null;
    for (const doc of ['aviso', 'recibo'] as const) {
      const pdf = await PDFDocument.load(await gerarPdfFerias(doc, d));
      expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    }
  });
});
