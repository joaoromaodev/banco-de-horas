// Documento → lançamento por IA: regras puras (travas, prompt, leitura da resposta).
import { describe, it, expect } from 'vitest';
import {
  categoriaLidaPelaIa, chaveGeminiDocumento, iaDocumentoNaPlataforma, imagemSemMetadados, interpretarLeitura, mascararTexto, montarPromptDocumento, opcoesDocumento,
  situacaoIaDocumento, tipoLidoPelaIa,
} from '@/lib/documentoLancamento';

const ENV_LIGADO = { CAIXA_IA_DOCUMENTO: 'ligada', GEMINI_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv;

describe('travas', () => {
  it('a plataforma só liga com CAIXA_IA_DOCUMENTO=ligada e a chave do Gemini', () => {
    expect(iaDocumentoNaPlataforma({} as NodeJS.ProcessEnv)).toBe(false);
    expect(iaDocumentoNaPlataforma({ CAIXA_IA_DOCUMENTO: 'ligada' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(iaDocumentoNaPlataforma({ CAIXA_IA_DOCUMENTO: 'sim', GEMINI_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(iaDocumentoNaPlataforma(ENV_LIGADO)).toBe(true);
    expect(iaDocumentoNaPlataforma({ CAIXA_IA_DOCUMENTO: ' Ligada ', GEMINI_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it('a empresa começa desligada; saúde nunca; as duas travas juntas liberam', () => {
    expect(situacaoIaDocumento({}, ENV_LIGADO)).toMatchObject({ disponivel: false, motivo: 'empresa' });
    expect(situacaoIaDocumento({ iaDocumento: true }, {} as NodeJS.ProcessEnv)).toMatchObject({ disponivel: false, motivo: 'plataforma' });
    expect(situacaoIaDocumento({ iaDocumento: true, identificaPagador: true }, ENV_LIGADO)).toMatchObject({ disponivel: false, motivo: 'saude' });
    expect(situacaoIaDocumento({ iaDocumento: true }, ENV_LIGADO)).toMatchObject({ disponivel: true, motivo: null });
    expect(situacaoIaDocumento(null, ENV_LIGADO).disponivel).toBe(false);
  });

  it('chave própria do caixa tem precedência sobre a da plataforma', () => {
    expect(chaveGeminiDocumento({ GEMINI_API_KEY: 'geral', GEMINI_API_KEY_CAIXA: 'caixa' } as unknown as NodeJS.ProcessEnv)).toBe('caixa');
    expect(chaveGeminiDocumento({ GEMINI_API_KEY: 'geral' } as unknown as NodeJS.ProcessEnv)).toBe('geral');
    expect(iaDocumentoNaPlataforma({ CAIXA_IA_DOCUMENTO: 'ligada', GEMINI_API_KEY_CAIXA: 'c' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });

  it('só nota, recibo e outros; nunca extrato nem folha', () => {
    expect(['nota', 'recibo', 'outros'].every(categoriaLidaPelaIa)).toBe(true);
    expect(categoriaLidaPelaIa('extrato')).toBe(false);
    expect(categoriaLidaPelaIa('folha')).toBe(false);
  });

  it('só foto e PDF vão para a IA (HEIC fica fora: não dá para limpar os metadados)', () => {
    expect(tipoLidoPelaIa('application/pdf')).toBe(true);
    expect(tipoLidoPelaIa('image/jpeg')).toBe(true);
    expect(tipoLidoPelaIa('image/heic')).toBe(false);
    expect(tipoLidoPelaIa('application/xml')).toBe(false);
    expect(tipoLidoPelaIa('text/csv')).toBe(false);
    expect(tipoLidoPelaIa(undefined)).toBe(false);
  });
});

const contas = [
  { id: 'c-luz', codigo: '3.1', nome: 'Energia', natureza: 'despesa' as const, daEmpresa: true },
  { id: 'c-venda', codigo: '1.1', nome: 'Vendas', natureza: 'receita' as const, daEmpresa: true },
  { id: 'c-outra', codigo: '3.9', nome: 'Outra', natureza: 'despesa' as const, daEmpresa: false },
];
const analiticas = [
  { id: 'h-luz', texto: 'Pago conta de luz', contaId: 'c-luz', natureza: 'despesa' as const, daEmpresa: true },
  { id: 'h-venda', texto: 'Recebido venda', contaId: 'c-venda', natureza: 'receita' as const, daEmpresa: true },
  { id: 'h-alheia', texto: 'Alheia', contaId: 'c-outra', natureza: 'despesa' as const, daEmpresa: false },
];

describe('opções e prompt', () => {
  it('só as analíticas da empresa, filtradas pela direção informada', () => {
    expect(opcoesDocumento(null, contas, analiticas).map((o) => o.historicoId)).toEqual(['h-luz', 'h-venda']);
    expect(opcoesDocumento('saida', contas, analiticas).map((o) => o.historicoId)).toEqual(['h-luz']);
    expect(opcoesDocumento('entrada', contas, analiticas)[0]).toMatchObject({ historicoId: 'h-venda', natureza: 'receita' });
  });

  it('o prompt leva exercício, direção e a lista de contas — nada da empresa nem de quem lança', () => {
    const t = montarPromptDocumento({ ano: 2026, direcao: 'saida', opcoes: opcoesDocumento('saida', contas, analiticas) });
    expect(t).toContain('2026');
    expect(t).toContain('0. 3.1 Energia › Pago conta de luz (saída)');
    expect(t).toContain('SAÍDA');
    expect(t).not.toContain('Alheia');
    expect(t).toMatch(/NÃO escreva CPF/);
  });
});

describe('leitura da resposta', () => {
  const opcoes = opcoesDocumento(null, contas, analiticas);
  const ctx = { ano: 2026, direcaoInformada: null };
  const resp = (o: Record<string, unknown>) => JSON.stringify({ confianca: 0.9, legivel: true, ...o });

  it('proposta completa', () => {
    const p = interpretarLeitura(resp({ data: '2026-03-10', valor: 187.4, direcao: 'saida', complemento: 'Conta de luz — Equatorial', indice: 0 }), opcoes, ctx);
    expect(p).toMatchObject({
      data: '2026-03-10', valor: 187.4, direcao: 'saida', contaId: 'c-luz', historicoId: 'h-luz', historico: 'Pago conta de luz',
      complemento: 'Conta de luz — Equatorial', confianca: 0.9, avisos: [],
    });
  });

  it('JSON torto ou ilegível → null (nada inventado)', () => {
    expect(interpretarLeitura('não é json', opcoes, ctx)).toBeNull();
    expect(interpretarLeitura(resp({ legivel: false }), opcoes, ctx)).toBeNull();
    expect(interpretarLeitura(undefined, opcoes, ctx)).toBeNull();
  });

  it('índice fora da lista ou natureza trocada → sem conta, com aviso', () => {
    expect(interpretarLeitura(resp({ direcao: 'saida', indice: 9, valor: 10, data: '2026-01-02' }), opcoes, ctx)!.contaId).toBeNull();
    const trocada = interpretarLeitura(resp({ direcao: 'saida', indice: 1, valor: 10, data: '2026-01-02' }), opcoes, ctx)!;
    expect(trocada.historico).toBeNull();
    expect(trocada.avisos.join(' ')).toMatch(/escolha a conta/);
    // a direção que quem lança informou vale mais que a lida
    expect(interpretarLeitura(resp({ direcao: 'entrada', indice: 0 }), opcoes, { ano: 2026, direcaoInformada: 'saida' })!.direcao).toBe('saida');
  });

  it('data fora do exercício, inválida ou valor estranho ficam vazios, com aviso', () => {
    const fora = interpretarLeitura(resp({ data: '2025-12-30', valor: 50, indice: 0, direcao: 'saida' }), opcoes, ctx)!;
    expect(fora.data).toBeNull();
    expect(fora.avisos[0]).toMatch(/30\/12\/2025, fora do exercício de 2026/);
    expect(interpretarLeitura(resp({ data: '2026-02-30' }), opcoes, ctx)!.data).toBeNull();
    expect(interpretarLeitura(resp({ valor: -5 }), opcoes, ctx)!.valor).toBeNull();
    expect(interpretarLeitura(resp({ valor: '1234,567' }), opcoes, ctx)!.valor).toBe(1234.57);
    expect(interpretarLeitura(resp({ confianca: 7 }), opcoes, ctx)!.confianca).toBe(1);
  });

  it('mascara dado pessoal que a IA tenha escrito no complemento', () => {
    expect(mascararTexto('Recibo — Maria CPF 123.456.789-09')).not.toMatch(/123/);
    expect(mascararTexto('Pago a fulano@email.com')).toBe('Pago a [e-mail]');
    expect(mascararTexto('Boleto 23793.38128 60000.000003 00000.000400 1 84340000012345')).toBe('Boleto [número]');
    expect(mascararTexto('Tel (91) 98888-7777')).not.toMatch(/98888/);
    expect(mascararTexto('NF 1234 — Equatorial')).toBe('NF 1234 — Equatorial');
    expect(mascararTexto('x'.repeat(300))).toHaveLength(120);
  });
});

describe('foto sem metadados (localização, aparelho)', () => {
  const ascii = (t: string) => Array.from(t, (c) => c.charCodeAt(0));
  const tem = (b: Uint8Array, t: string) => Buffer.from(b).includes(Buffer.from(t, 'latin1'));

  it('JPEG: tira APP1 (EXIF/XMP) e comentário, mantém JFIF e a imagem', () => {
    const exif = [0xff, 0xe1, 0x00, 0x0c, ...ascii('Exif  GPS!')];
    const jfif = [0xff, 0xe0, 0x00, 0x07, ...ascii('JFIF ')];
    const com = [0xff, 0xfe, 0x00, 0x06, ...ascii('oi:)')];
    const imagem = [0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9];
    const b = new Uint8Array([0xff, 0xd8, ...jfif, ...exif, ...com, ...imagem]);
    const r = imagemSemMetadados(b, 'image/jpeg')!;
    expect(tem(r, 'GPS!')).toBe(false);
    expect(tem(r, 'oi:)')).toBe(false);
    expect(Array.from(r)).toEqual([0xff, 0xd8, ...jfif, ...imagem]);
    expect(imagemSemMetadados(new Uint8Array([1, 2, 3]), 'image/jpeg')).toBeNull();
  });

  it('PNG: tira eXIf e tEXt, mantém IHDR/IDAT/IEND', () => {
    const chunk = (tipo: string, dados: number[]) => {
      const n = dados.length;
      return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...ascii(tipo), ...dados, 0, 0, 0, 0];
    };
    const ihdr = chunk('IHDR', Array(13).fill(1));
    const idat = chunk('IDAT', [9, 9, 9]);
    const iend = chunk('IEND', []);
    const b = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...ihdr,
      ...chunk('tEXt', ascii('Author Fulano')), ...chunk('eXIf', ascii('GPS!')), ...idat, ...iend]);
    const r = imagemSemMetadados(b, 'image/png')!;
    expect(tem(r, 'Fulano')).toBe(false);
    expect(tem(r, 'GPS!')).toBe(false);
    expect(r.length).toBe(8 + ihdr.length + idat.length + iend.length);
  });

  it('WEBP: tira EXIF/XMP, apaga as marcas no VP8X e corrige o tamanho do RIFF', () => {
    const le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    const chunk = (tipo: string, dados: number[]) => [...ascii(tipo), ...le(dados.length), ...dados, ...(dados.length % 2 ? [0] : [])];
    const vp8x = chunk('VP8X', [0x0c | 0x10, 0, 0, 0, 1, 0, 0, 1, 0, 0]);
    const vp8 = chunk('VP8 ', [7, 7, 7, 7]);
    const corpo = [...ascii('WEBP'), ...vp8x, ...vp8, ...chunk('EXIF', ascii('GPS!!')), ...chunk('XMP ', ascii('<x/>'))];
    const b = new Uint8Array([...ascii('RIFF'), ...le(corpo.length), ...corpo]);
    const r = imagemSemMetadados(b, 'image/webp')!;
    expect(tem(r, 'GPS!!')).toBe(false);
    expect(tem(r, '<x/>')).toBe(false);
    expect(r[12 + 8] & 0x0c).toBe(0); // marcas de EXIF e XMP
    expect(r[12 + 8] & 0x10).toBe(0x10); // as outras ficam
    const riff = r[4] + (r[5] << 8) + (r[6] << 16) + (r[7] << 24);
    expect(riff).toBe(r.length - 8);
  });

  it('formato desconhecido → null (a rota recusa em vez de mandar como está)', () => {
    expect(imagemSemMetadados(new Uint8Array([0, 0, 0]), 'image/heic')).toBeNull();
  });
});
