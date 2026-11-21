import { describe, it, expect } from 'vitest';
import {
  ACCEPT, caminhoNoStorage, categoriaValida, competenciaBR, competenciaPadrao, competenciasRecentes,
  competenciaValida, conferirAssinatura, dataValida, deveReabrir, extensao, LIMITE_BYTES, nomeSeguro,
  podeAtenderPendencia, podeConferir, podeExcluirDocumento, podeGerirPendencia, podeVerRegistro,
  resumoPendencias, situacaoPrazo, tamanhoBR, TIPOS_ACEITOS, tipoPorExtensao, validarArquivo,
} from '@/lib/documentos';
import type { Quem } from '@/lib/visibilidade';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const DOC = '11111111-2222-4333-8444-555555555555';

const master: Quem = { email: 'm@x.com', role: 'master' };
const contadorA: Quem = { email: 'c@a.com', role: 'usuario', escritorioId: A };
const contadorB: Quem = { email: 'c@b.com', role: 'usuario', escritorioId: B };
const clienteA1: Quem = { email: 'cli@a1.com', role: 'cliente', escritorioId: A, empresa: 'emp-a1' };
const clienteSemEscritorio: Quem = { email: 'x@x.com', role: 'cliente', empresa: 'emp-a1' };
const contadorSemEscritorio: Quem = { email: 'y@y.com', role: 'usuario' };

const docA1 = { empresaId: 'emp-a1', escritorioId: A, status: 'recebido' as const };
const docA2 = { empresaId: 'emp-a2', escritorioId: A, status: 'recebido' as const };
const docB = { empresaId: 'emp-b1', escritorioId: B, status: 'recebido' as const };

const bytes = (...partes: (string | number[])[]) =>
  new Uint8Array(partes.flatMap((p) => (typeof p === 'string' ? Array.from(p, (c) => c.charCodeAt(0)) : p)));

describe('validarArquivo', () => {
  it('aceita os tipos da lista, com e sem MIME do navegador', () => {
    expect(validarArquivo({ nome: 'nota.pdf', tamanho: 1000, tipo: 'application/pdf' })).toMatchObject({ ok: true, tipo: { ext: 'pdf' } });
    expect(validarArquivo({ nome: 'FOTO.JPEG', tamanho: 1000, tipo: 'image/jpeg' })).toMatchObject({ ok: true, tipo: { ext: 'jpg' } });
    expect(validarArquivo({ nome: 'extrato.ofx', tamanho: 10, tipo: '' })).toMatchObject({ ok: true, tipo: { ext: 'ofx' } });
    expect(validarArquivo({ nome: 'IMG_1.HEIC', tamanho: 10, tipo: 'application/octet-stream' })).toMatchObject({ ok: true });
    expect(validarArquivo({ nome: 'nfe.xml', tamanho: 10, tipo: 'text/xml' })).toMatchObject({ ok: true });
  });

  it('recusa tipos fora da lista (executáveis, HTML, SVG, macro) e arquivo sem extensão', () => {
    for (const nome of ['a.exe', 'a.html', 'a.svg', 'a.js', 'a.xlsm', 'a.docm', 'a.zip', 'semextensao', 'a.pdf.exe']) {
      expect(validarArquivo({ nome, tamanho: 10 }).ok, nome).toBe(false);
    }
  });

  it('recusa MIME que contradiz a extensão', () => {
    const r = validarArquivo({ nome: 'nota.pdf', tamanho: 10, tipo: 'text/html' });
    expect(r.ok).toBe(false);
  });

  it('limite de tamanho: exatamente 10 MB passa, um byte a mais não; vazio não', () => {
    expect(validarArquivo({ nome: 'a.pdf', tamanho: LIMITE_BYTES }).ok).toBe(true);
    expect(validarArquivo({ nome: 'a.pdf', tamanho: LIMITE_BYTES + 1 }).ok).toBe(false);
    expect(validarArquivo({ nome: 'a.pdf', tamanho: 0 }).ok).toBe(false);
    expect(validarArquivo({ nome: 'a.pdf', tamanho: Number.NaN }).ok).toBe(false);
  });

  it('a lista de tipos é a mesma do CHECK/bucket da migração 0015', () => {
    expect(TIPOS_ACEITOS.map((t) => t.mime).sort()).toEqual([
      'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/x-ofx', 'application/xml', 'image/heic', 'image/jpeg', 'image/png', 'image/webp', 'text/csv',
    ]);
    expect(LIMITE_BYTES).toBe(10485760);
    expect(ACCEPT).toContain('.pdf');
    expect(ACCEPT).not.toContain('svg');
  });
});

describe('nomeSeguro e extensão', () => {
  it('tira caminho, controle e caracteres proibidos', () => {
    expect(nomeSeguro('C:\\Users\\x\\nota.pdf')).toBe('nota.pdf');
    expect(nomeSeguro('../../etc/passwd')).toBe('passwd');
    expect(nomeSeguro('a\u0000b<>"|?*.pdf')).toBe('ab.pdf');
    expect(nomeSeguro('...oculto.pdf')).toBe('oculto.pdf');
    expect(nomeSeguro('   ')).toBe('documento');
  });

  it('corta nome longo preservando a extensão', () => {
    const n = nomeSeguro(`${'a'.repeat(300)}.pdf`);
    expect(n.length).toBeLessThanOrEqual(120);
    expect(n.endsWith('.pdf')).toBe(true);
  });

  it('extensao', () => {
    expect(extensao('a.PDF')).toBe('pdf');
    expect(extensao('a')).toBe('');
    expect(tipoPorExtensao('jpeg')?.ext).toBe('jpg');
  });
});

describe('conferirAssinatura (bytes de verdade)', () => {
  it('reconhece os binários', () => {
    expect(conferirAssinatura(bytes('%PDF-1.7\n'), 'pdf')).toBe(true);
    expect(conferirAssinatura(bytes([0xff, 0xd8, 0xff, 0xe0]), 'jpg')).toBe(true);
    expect(conferirAssinatura(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'png')).toBe(true);
    expect(conferirAssinatura(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '), 'webp')).toBe(true);
    expect(conferirAssinatura(bytes([0, 0, 0, 0x18], 'ftypheic'), 'heic')).toBe(true);
    expect(conferirAssinatura(bytes([0x50, 0x4b, 0x03, 0x04]), 'xlsx')).toBe(true);
  });

  it('recusa executável e HTML renomeados', () => {
    expect(conferirAssinatura(bytes('MZ\x90\x00'), 'pdf')).toBe(false);
    expect(conferirAssinatura(bytes('<html><script>alert(1)</script>'), 'pdf')).toBe(false);
    expect(conferirAssinatura(bytes('<!DOCTYPE html><html>'), 'xml')).toBe(false);
    expect(conferirAssinatura(bytes('<svg onload="x">'), 'xml')).toBe(false);
    expect(conferirAssinatura(bytes('<html>'), 'csv')).toBe(false);
    expect(conferirAssinatura(bytes([0, 0, 0, 0x18], 'ftypisom'), 'heic')).toBe(false);
    expect(conferirAssinatura(bytes('%PDF-'), 'exe')).toBe(false);
  });

  it('textos: XML com BOM, OFX SGML e XML, CSV; binário com byte nulo não', () => {
    expect(conferirAssinatura(bytes([0xef, 0xbb, 0xbf], '\n<?xml version="1.0"?><nfeProc/>'), 'xml')).toBe(true);
    expect(conferirAssinatura(bytes('OFXHEADER:100\nDATA:OFXSGML'), 'ofx')).toBe(true);
    expect(conferirAssinatura(bytes('<?xml version="1.0"?><?OFX ?>'), 'ofx')).toBe(true);
    expect(conferirAssinatura(bytes('data;valor\n01/10/2026;10,00'), 'csv')).toBe(true);
    expect(conferirAssinatura(bytes('data;valor', [0], 'x'), 'csv')).toBe(false);
    expect(conferirAssinatura(bytes('qualquer coisa'), 'ofx')).toBe(false);
  });
});

describe('caminhoNoStorage', () => {
  it('monta <escritorio>/<documento>.<ext> só com uuids', () => {
    expect(caminhoNoStorage(A, DOC, 'jpeg')).toBe(`${A}/${DOC}.jpg`);
  });
  it('recusa id que não é uuid (nada digitado pelo usuário vira caminho)', () => {
    expect(() => caminhoNoStorage('../x', DOC, 'pdf')).toThrow();
    expect(() => caminhoNoStorage(A, 'emp-a1/../../b', 'pdf')).toThrow();
    expect(() => caminhoNoStorage(A, DOC, 'exe')).toThrow();
  });
});

describe('campos', () => {
  it('competência AAAA-MM', () => {
    expect(competenciaValida('2026-10')).toBe(true);
    for (const c of ['2026-13', '2026-00', '2026-1', '26-10', '1999-12', 10, null]) expect(competenciaValida(c)).toBe(false);
    expect(competenciaBR('2026-10')).toBe('out/2026');
  });
  it('competência padrão = mês anterior; recentes atravessam o ano', () => {
    expect(competenciaPadrao('2026-11-21')).toBe('2026-10');
    expect(competenciaPadrao('2027-01-05')).toBe('2026-12');
    expect(competenciasRecentes('2027-02-01', 3)).toEqual(['2027-02', '2027-01', '2026-12']);
  });
  it('categoria e data', () => {
    expect(categoriaValida('extrato')).toBe(true);
    expect(categoriaValida('boleto')).toBe(false);
    expect(dataValida('2026-02-29')).toBe(false);
    expect(dataValida('2028-02-29')).toBe(true);
  });
  it('tamanhoBR', () => {
    expect(tamanhoBR(500)).toBe('500 B');
    expect(tamanhoBR(2048)).toBe('2 KB');
    expect(tamanhoBR(3.5 * 1024 * 1024)).toBe('3,5 MB');
  });
});

describe('recorte de acesso', () => {
  it('master vê tudo; contador só o próprio escritório', () => {
    expect(podeVerRegistro(master, docB)).toBe(true);
    expect(podeVerRegistro(contadorA, docA1)).toBe(true);
    expect(podeVerRegistro(contadorA, docA2)).toBe(true);
    expect(podeVerRegistro(contadorA, docB)).toBe(false);
    expect(podeVerRegistro(contadorB, docA1)).toBe(false);
  });

  it('cliente só a própria empresa, e só no escritório dele', () => {
    expect(podeVerRegistro(clienteA1, docA1)).toBe(true);
    expect(podeVerRegistro(clienteA1, docA2)).toBe(false);
    expect(podeVerRegistro(clienteA1, { ...docA1, escritorioId: B })).toBe(false);
  });

  it('falha fechada: sessão ou registro sem escritório', () => {
    expect(podeVerRegistro(clienteSemEscritorio, docA1)).toBe(false);
    expect(podeVerRegistro(contadorSemEscritorio, docA1)).toBe(false);
    expect(podeVerRegistro(contadorA, { ...docA1, escritorioId: null })).toBe(false);
  });

  it('conferir: só a contabilidade, e não o que ainda está subindo', () => {
    expect(podeConferir(contadorA, docA1)).toBe(true);
    expect(podeConferir(clienteA1, docA1)).toBe(false);
    expect(podeConferir(contadorB, docA1)).toBe(false);
    expect(podeConferir(contadorA, { ...docA1, status: 'enviando' })).toBe(false);
  });

  it('excluir: cliente só o não conferido da própria empresa; contador do escritório sempre', () => {
    expect(podeExcluirDocumento(clienteA1, docA1)).toBe(true);
    expect(podeExcluirDocumento(clienteA1, { ...docA1, status: 'conferido' })).toBe(false);
    expect(podeExcluirDocumento(clienteA1, docA2)).toBe(false);
    expect(podeExcluirDocumento(contadorA, { ...docA1, status: 'conferido' })).toBe(true);
    expect(podeExcluirDocumento(contadorB, docA1)).toBe(false);
  });

  it('pendência: só a contabilidade gere; atende quem vê, se estiver aberta', () => {
    const p = { empresaId: 'emp-a1', escritorioId: A, status: 'aberta' as const };
    expect(podeGerirPendencia(contadorA, p)).toBe(true);
    expect(podeGerirPendencia(clienteA1, p)).toBe(false);
    expect(podeGerirPendencia(contadorB, p)).toBe(false);
    expect(podeAtenderPendencia(clienteA1, p)).toBe(true);
    expect(podeAtenderPendencia(clienteA1, { ...p, status: 'atendida' })).toBe(false);
    expect(podeAtenderPendencia(clienteA1, { ...p, empresaId: 'emp-a2' })).toBe(false);
  });
});

describe('pendências', () => {
  it('situação do prazo', () => {
    expect(situacaoPrazo(null, '2026-11-21')).toBe('sem-prazo');
    expect(situacaoPrazo('2026-11-20', '2026-11-21')).toBe('vencida');
    expect(situacaoPrazo('2026-11-21', '2026-11-21')).toBe('vence-logo');
    expect(situacaoPrazo('2026-11-24', '2026-11-21')).toBe('vence-logo');
    expect(situacaoPrazo('2026-11-25', '2026-11-21')).toBe('no-prazo');
  });
  it('resumo conta só as abertas', () => {
    expect(resumoPendencias([
      { status: 'aberta', prazo: '2026-11-01' },
      { status: 'aberta', prazo: null },
      { status: 'atendida', prazo: '2026-11-01' },
    ], '2026-11-21')).toEqual({ abertas: 2, vencidas: 1 });
  });
  it('reabre quando o último envio que atendia some', () => {
    expect(deveReabrir(0)).toBe(true);
    expect(deveReabrir(1)).toBe(false);
  });
});

describe('correções da revisão de segurança', () => {
  it('cliente não restaura o que a contabilidade excluiu; contador restaura', async () => {
    const { podeRestaurarDocumento } = await import('@/lib/documentos');
    expect(podeRestaurarDocumento(clienteA1, { ...docA1, excluidoPorGestor: true })).toBe(false);
    expect(podeRestaurarDocumento(clienteA1, { ...docA1, excluidoPorGestor: false })).toBe(true);
    expect(podeRestaurarDocumento(contadorA, { ...docA1, excluidoPorGestor: true })).toBe(true);
    expect(podeRestaurarDocumento(contadorB, { ...docA1, excluidoPorGestor: true })).toBe(false);
  });
  it('recusado não é conferido nem excluído pelo cliente', () => {
    expect(podeConferir(contadorA, { ...docA1, status: 'rejeitado' })).toBe(false);
    expect(podeExcluirDocumento(clienteA1, { ...docA1, status: 'rejeitado' })).toBe(false);
  });
  it('XML com XHTML/script em qualquer ponto é recusado', () => {
    expect(conferirAssinatura(bytes('<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><script>x</script></html>'), 'xml')).toBe(false);
    expect(conferirAssinatura(bytes('<?xml version="1.0"?><a><b/><svg/></a>'), 'xml')).toBe(false);
    expect(conferirAssinatura(bytes('<?xml version="1.0"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe"/>'), 'xml')).toBe(true);
  });
  it('nome sem caracteres bidirecionais', () => {
    expect(nomeSeguro('nota\u202Efdp.exe')).toBe('notafdp.exe');
  });
  it('uuidValido', async () => {
    const { uuidValido } = await import('@/lib/documentos');
    expect(uuidValido(DOC)).toBe(true);
    expect(uuidValido('-'.repeat(36))).toBe(false);
    expect(uuidValido(undefined)).toBe(false);
  });
});
