// Nota e boleto sem IA (Sprint 17, Frente B): boleto (dígitos conferidos à mão),
// XML de NF-e/NFC-e/NFS-e (nacional e ABRASF) e PDF com texto. Tudo SINTÉTICO —
// XMLs e PDFs montados aqui, sem dado real; CNPJs e chaves inventados.
import { describe, it, expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  acharBoletoNoTexto, dataDoFator, fatorDaData, lerBoleto, modulo10, modulo11Bancario,
} from '@/lib/boleto';
import { chaveNfeValida, decomporChaveNfe, dvChaveNfe, lerNotaXml, lerXml, papelDaEmpresa } from '@/lib/notaFiscalXml';
import {
  comContaSugerida, FORMATO_CHAVE, propostaDoCodigo, propostaDoTextoPdf, propostaDoXml, type ContextoLeitura,
} from '@/lib/leituraSemIa';
import { textoDoPdf } from '@/lib/leituraSemIaServidor';
import { exemploDe } from '@/lib/sugestaoConta';

const HOJE = '2026-11-21';
const ctx = (p: Partial<ContextoLeitura> = {}): ContextoLeitura => ({ ano: 2026, hoje: HOJE, direcaoInformada: null, ...p });

// ------------------------------------------------------------------ boleto

// Boleto bancário montado e conferido À MÃO (contas no comentário):
//   banco 341, moeda 9, vencimento 07/07/2026 (fator 1500, já no ciclo novo),
//   valor R$ 1.234,56, campo livre "000…0001" (24 zeros e 1).
//   DV geral (módulo 11 nos 43 números, pesos 2–9 da direita):
//     1×2 + (6×3 + 5×4 + 4×5 + 3×6 + 2×7 + 1×8) + (5×7 + 1×8) + (9×9 + 1×2 + 4×3 + 3×4)
//     = 2 + 98 + 43 + 107 = 250; 250 mod 11 = 8; 11 − 8 = 3.
//   Campo 1 "341900000": 0,0,0,0,0 + 9×1 + 1×2 + 4×1 + 3×2(=6) = 21 → DV 9.
//   Campo 2 "0000000000" → DV 0. Campo 3 "0000000001": 1×2 = 2 → DV 8.
const LINHA_ITAU = '34190.00009 00000.000000 00000.000018 3 15000000123456';
const BARRAS_ITAU = '34193150000001234560000000000000000000000001';

// Arrecadação (energia), montada à mão: "836" + DV + valor R$ 150,00 + empresa 0001 + 25 zeros.
//   DV geral (módulo 10, id 6): 1(×1) + 5×2(=1) + 1×1 + 6×2(=3) + 3×1 + 8×2(=7) = 16 → 4.
//   Blocos: "83640000001" → 1×2 + 4×1 + 6×2(=3) + 3×1 + 8×2(=7) = 19 → DV 1;
//           "50000001000" → 1×1 + 5×2(=1) = 2 → DV 8; os dois de zeros → DV 0.
const LINHA_ENERGIA = '83640000001-1 50000001000-8 00000000000-0 00000000000-0';

describe('boleto — dígitos verificadores', () => {
  it('módulo 10 e 11 batem com as contas à mão', () => {
    expect(modulo10('341900000')).toBe(9);
    expect(modulo10('0000000000')).toBe(0);
    expect(modulo10('0000000001')).toBe(8);
    expect(modulo11Bancario(BARRAS_ITAU.slice(0, 4) + BARRAS_ITAU.slice(5))).toBe(3);
  });

  it('linha digitável bancária → valor, vencimento (fator novo) e banco', () => {
    const r = lerBoleto(LINHA_ITAU, HOJE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.boleto).toMatchObject({
      tipo: 'bancario', codigoBarras: BARRAS_ITAU, valor: 1234.56, vencimento: '2026-07-07',
      banco: { codigo: '341', nome: 'Itaú' }, linhaDigitavel: LINHA_ITAU,
    });
    // O código de barras (44) dá o mesmo resultado; colado corrido também.
    const b = lerBoleto(BARRAS_ITAU, HOJE);
    expect(b.ok && b.boleto.valor).toBe(1234.56);
    expect(lerBoleto(LINHA_ITAU.replace(/\D/g, ''), HOJE).ok).toBe(true);
  });

  it('um número trocado não vira valor errado: o dígito verificador recusa', () => {
    // Trocar um número do campo 2 → DV do campo 2 não confere.
    const r = lerBoleto(LINHA_ITAU.replace('00000.000000', '00010.000000'), HOJE);
    expect(r).toEqual({ ok: false, erro: expect.stringContaining('campo 2') });
    // Trocar o valor (campo 5, sem DV próprio) → o DV geral não confere.
    const v = lerBoleto(LINHA_ITAU.replace('15000000123456', '15000000123457'), HOJE);
    expect(v).toEqual({ ok: false, erro: expect.stringContaining('verificador geral') });
    expect(lerBoleto('1234', HOJE)).toEqual({ ok: false, erro: expect.stringContaining('47 números') });
  });

  it('fator de vencimento: 9999 = 21/02/2025 e o reinício em 1000 = 22/02/2025', () => {
    expect(dataDoFator(9999, HOJE)).toBe('2025-02-21');
    expect(dataDoFator(1000, HOJE)).toBe('2025-02-22');
    expect(dataDoFator(1500, HOJE)).toBe('2026-07-07');
    // Lido em 2005, o 1000 é o do ciclo antigo (03/07/2000), o mais perto da referência.
    expect(dataDoFator(1000, '2005-01-01')).toBe('2000-07-03');
    expect(dataDoFator(4789, '2010-01-01')).toBe('2010-11-17');
    expect(dataDoFator(0, HOJE)).toBeNull();
    expect(fatorDaData('2026-07-07')).toBe(1500);
    expect(fatorDaData('2025-02-21')).toBe(9999);
    expect(fatorDaData('2025-02-22')).toBe(1000);
  });

  it('valor em aberto (zeros) e sem vencimento (fator 0) viram aviso, não número inventado', () => {
    // Monta pelo próprio código de barras: fator 0000 e valor zero; o DV geral é recalculado.
    const sem = '3419' + '0000' + '0000000000' + '0000000000000000000000001';
    const barras = sem.slice(0, 4) + modulo11Bancario(sem) + sem.slice(4);
    const r = lerBoleto(barras, HOJE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.boleto.valor).toBeNull();
    expect(r.boleto.vencimento).toBeNull();
    expect(r.boleto.avisos.join(' ')).toMatch(/valor em aberto/);
    expect(r.boleto.avisos.join(' ')).toMatch(/vencimento/);
  });

  it('arrecadação (conta de energia): valor, segmento e sem vencimento', () => {
    const r = lerBoleto(LINHA_ENERGIA, HOJE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.boleto).toMatchObject({ tipo: 'arrecadacao', valor: 150, vencimento: null, banco: null, segmento: 'Energia elétrica e gás' });
    expect(r.boleto.codigoBarras).toBe('83640000001500000010000000000000000000000000');
    expect(lerBoleto(LINHA_ENERGIA.replace('-8', '-7'), HOJE)).toEqual({ ok: false, erro: expect.stringContaining('bloco 2') });
  });

  it('acha a linha digitável no meio do texto do PDF', () => {
    const t = `Banco Itaú\nRecibo do pagador\n${LINHA_ITAU}\nVencimento 07/07/2026 Valor R$ 1.234,56\nCNPJ 12.345.678/0001-95`;
    expect(acharBoletoNoTexto(t, HOJE)?.codigoBarras).toBe(BARRAS_ITAU);
    expect(acharBoletoNoTexto('Nota 123 de 05/03/2026 total 1.234,56', HOJE)).toBeNull();
  });

  it('proposta do boleto: saída, vencimento como data, chave para a duplicidade', () => {
    const r = propostaDoCodigo(LINHA_ITAU, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.proposta).toMatchObject({
      fonte: 'boleto', direcao: 'saida', valor: 1234.56, data: '2026-07-07', chave: `boleto:${BARRAS_ITAU}`, complemento: 'Boleto Itaú',
    });
    expect(FORMATO_CHAVE.test(r.proposta.chave!)).toBe(true);
    // Vencimento fora do exercício aberto: a data fica em branco, com aviso.
    const fora = propostaDoCodigo(LINHA_ITAU, ctx({ ano: 2027 }));
    expect(fora.ok && fora.proposta.data).toBeNull();
    expect(fora.ok && fora.proposta.avisos.join(' ')).toMatch(/fora do exercício de 2027/);
  });
});

// ------------------------------------------------------------------ XML

const CNPJ_EMPRESA = '11222333000181';
const CNPJ_FORNECEDOR = '44555666000199';

function chaveNfe(cnpjEmitente: string, modelo = '55', numero = 1234): string {
  const sem = `15` + `2603` + cnpjEmitente + modelo + '001' + String(numero).padStart(9, '0') + '1' + '12345678';
  return sem + dvChaveNfe(sem);
}

function xmlNfe(p: { emit: string; dest: string; destCpf?: boolean; tpNF?: string; modelo?: string; vNF?: string; dup?: [string, string][]; tPag?: string }) {
  const chave = chaveNfe(p.emit, p.modelo ?? '55');
  const dup = (p.dup ?? []).map(([d, v], i) => `<dup><nDup>00${i + 1}</nDup><dVenc>${d}</dVenc><vDup>${v}</vDup></dup>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
  <NFe xmlns="http://www.portalfiscal.inf.br/nfe">
    <infNFe Id="NFe${chave}" versao="4.00">
      <ide><cUF>15</cUF><natOp>Venda de mercadoria</natOp><mod>${p.modelo ?? '55'}</mod><serie>1</serie><nNF>1234</nNF>
        <dhEmi>2026-03-05T10:20:30-03:00</dhEmi><tpNF>${p.tpNF ?? '1'}</tpNF><finNFe>1</finNFe></ide>
      <emit><CNPJ>${p.emit}</CNPJ><xNome>Distribuidora Exemplo &amp; Cia LTDA</xNome><xFant>Exemplo</xFant>
        <enderEmit><xLgr>Rua A</xLgr></enderEmit></emit>
      <dest>${p.destCpf ? `<CPF>${p.dest}</CPF>` : `<CNPJ>${p.dest}</CNPJ>`}<xNome>${p.destCpf ? 'Fulano Ficticio' : 'Comprador Teste LTDA'}</xNome></dest>
      <det nItem="1"><prod><cProd>1</cProd><vProd>1000.00</vProd></prod></det>
      <total><ICMSTot><vProd>1000.00</vProd><vNF>${p.vNF ?? '1234.56'}</vNF></ICMSTot></total>
      ${dup ? `<cobr>${dup}</cobr>` : ''}
      <pag><detPag><tPag>${p.tPag ?? '15'}</tPag><vPag>${p.vNF ?? '1234.56'}</vPag></detPag></pag>
    </infNFe>
    <Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><SignedInfo/></Signature>
  </NFe>
  <protNFe versao="4.00"><infProt><chNFe>${chave}</chNFe><cStat>100</cStat></infProt></protNFe>
</nfeProc>`;
}

const xmlNfseNacional = (prest: string, toma: string, tomaCpf = false) => `<?xml version="1.0" encoding="utf-8"?>
<NFSe versao="1.00" xmlns="http://www.sped.fazenda.gov.br/nfse">
  <infNFSe Id="NFS150120021${prest}000000000004226041234567890">
    <xLocEmi>Belém</xLocEmi><nNFSe>42</nNFSe><dhProc>2026-04-02T09:00:00-03:00</dhProc>
    <emit><CNPJ>${prest}</CNPJ><xNome>Serviços Exemplo LTDA</xNome></emit>
    <valores><vLiq>950.00</vLiq></valores>
    <DPS versao="1.00"><infDPS Id="DPS1">
      <dhEmi>2026-04-01T15:00:00-03:00</dhEmi><serie>900</serie><nDPS>42</nDPS>
      <prest><CNPJ>${prest}</CNPJ></prest>
      <toma>${tomaCpf ? `<CPF>${toma}</CPF>` : `<CNPJ>${toma}</CNPJ>`}<xNome>${tomaCpf ? 'Paciente Ficticio' : 'Tomador Teste LTDA'}</xNome></toma>
      <valores><vServPrest><vServ>1000.00</vServ></vServPrest></valores>
    </infDPS></DPS>
  </infNFSe>
</NFSe>`;

const xmlAbrasf = (prest: string, toma: string) => `<?xml version="1.0" encoding="UTF-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Nfse versao="2.04"><InfNfse Id="nfse77">
    <Numero>77</Numero><CodigoVerificacao>ABC123</CodigoVerificacao><DataEmissao>2026-05-10T11:00:00</DataEmissao>
    <ValoresNfse><BaseCalculo>500.00</BaseCalculo><ValorLiquidoNfse>480.00</ValorLiquidoNfse></ValoresNfse>
    <PrestadorServico><IdentificacaoPrestador><CpfCnpj><Cnpj>${prest}</Cnpj></CpfCnpj></IdentificacaoPrestador>
      <RazaoSocial>Consultoria Ficticia ME</RazaoSocial></PrestadorServico>
    <DeclaracaoPrestacaoServico><InfDeclaracaoPrestacaoServico>
      <Competencia>2026-05-01</Competencia>
      <Servico><Valores><ValorServicos>500.00</ValorServicos><ValorIss>25.00</ValorIss></Valores></Servico>
      <Prestador><CpfCnpj><Cnpj>${prest}</Cnpj></CpfCnpj></Prestador>
      <Tomador><IdentificacaoTomador><CpfCnpj><Cnpj>${toma}</Cnpj></CpfCnpj></IdentificacaoTomador><RazaoSocial>Tomador ABRASF LTDA</RazaoSocial></Tomador>
    </InfDeclaracaoPrestacaoServico></DeclaracaoPrestacaoServico>
  </InfNfse></Nfse>
</CompNfse>`;

describe('XML de nota fiscal', () => {
  it('leitor de XML: namespaces, entidades, CDATA; recusa DOCTYPE (sem XXE)', () => {
    const r = lerXml('<a:x xmlns:a="u"><a:y k="1&amp;2">t &lt; <![CDATA[<b>]]></a:y></a:x>');
    expect(r?.nome).toBe('x');
    expect(r?.filhos[0]).toMatchObject({ nome: 'y', attrs: { k: '1&2' }, texto: 't < <b>' });
    expect(lerXml('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>')).toBeNull();
    expect(lerXml('<x><y></x>')).toBeNull();
    expect(lerNotaXml('<html>não é nota</html>')).toEqual({ ok: false, erro: expect.stringContaining('não é de nota fiscal') });
  });

  it('chave de acesso: DV e o que ela diz', () => {
    const c = chaveNfe(CNPJ_FORNECEDOR);
    expect(chaveNfeValida(c)).toBe(true);
    expect(chaveNfeValida(c.slice(0, 43) + ((Number(c[43]) + 1) % 10))).toBe(false);
    expect(decomporChaveNfe(c)).toEqual({ anoMes: '2026-03', cnpjEmitente: CNPJ_FORNECEDOR, modelo: '55', serie: '1', numero: '1234' });
  });

  it('NF-e de compra (empresa destinatária) → saída, com nome do fornecedor', () => {
    const r = propostaDoXml(xmlNfe({ emit: CNPJ_FORNECEDOR, dest: CNPJ_EMPRESA }), { documento: '11.222.333/0001-81', identificaPagador: false }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const chave = chaveNfe(CNPJ_FORNECEDOR);
    expect(r.proposta).toMatchObject({
      fonte: 'nfe', direcao: 'saida', data: '2026-03-05', valor: 1234.56, chave: `nfe:${chave}`,
      complemento: 'NF 1234 — Distribuidora Exemplo & Cia LTDA', titulo: 'NF-e 1234',
    });
    expect(r.proposta.detalhes.join(' ')).toContain('Chave de acesso');
  });

  it('NF-e de venda (empresa emitente) → entrada; nome de pessoa física fica fora do complemento', () => {
    const r = propostaDoXml(xmlNfe({ emit: CNPJ_EMPRESA, dest: '12345678909', destCpf: true }), { documento: CNPJ_EMPRESA, identificaPagador: false }, ctx());
    expect(r.ok && r.proposta.direcao).toBe('entrada');
    expect(r.ok && r.proposta.complemento).toBe('NF 1234');
    expect(r.ok && r.proposta.pagadorNome).toBeNull();
  });

  it('empresa que identifica pagador: o CPF do comprador vai para o pagador, não para o complemento', () => {
    const r = propostaDoXml(xmlNfe({ emit: CNPJ_EMPRESA, dest: '12345678909', destCpf: true }), { documento: CNPJ_EMPRESA, identificaPagador: true }, ctx());
    expect(r.ok && r.proposta).toMatchObject({ pagadorNome: 'Fulano Ficticio', pagadorDocumento: '123.456.789-09', complemento: 'NF 1234' });
  });

  it('NFC-e (65), nota de entrada (tpNF 0), parcelas, sem pagamento e filial', () => {
    const nfce = lerNotaXml(xmlNfe({ emit: CNPJ_FORNECEDOR, dest: CNPJ_EMPRESA, modelo: '65' }));
    expect(nfce.ok && nfce.nota.tipo).toBe('nfce');
    // Nota de entrada emitida pela própria empresa (compra de produtor): saída.
    const ent = lerNotaXml(xmlNfe({ emit: CNPJ_EMPRESA, dest: '12345678909', destCpf: true, tpNF: '0' }));
    expect(ent.ok && papelDaEmpresa(ent.nota, CNPJ_EMPRESA)).toEqual({ papel: 'emitente', direcao: 'saida', filial: false });
    // Filial (mesma raiz): reconhece, com detalhe.
    const filial = propostaDoXml(xmlNfe({ emit: CNPJ_FORNECEDOR, dest: '11222333000262' }), { documento: CNPJ_EMPRESA, identificaPagador: false }, ctx());
    expect(filial.ok && filial.proposta.direcao).toBe('saida');
    expect(filial.ok && filial.proposta.detalhes.join(' ')).toMatch(/matriz\/filial/);
    const par = propostaDoXml(xmlNfe({ emit: CNPJ_FORNECEDOR, dest: CNPJ_EMPRESA, dup: [['2026-04-05', '617.28'], ['2026-05-05', '617.28']], tPag: '90' }),
      { documento: CNPJ_EMPRESA, identificaPagador: false }, ctx());
    expect(par.ok && par.proposta.avisos.join(' ')).toMatch(/2 parcelas \(vencimentos 05\/04\/2026, 05\/05\/2026\)/);
    expect(par.ok && par.proposta.avisos.join(' ')).toMatch(/sem pagamento/);
  });

  it('nota que não é da empresa, empresa sem CNPJ e direção marcada ao contrário viram aviso', () => {
    const outra = propostaDoXml(xmlNfe({ emit: CNPJ_FORNECEDOR, dest: '99888777000166' }), { documento: CNPJ_EMPRESA, identificaPagador: false }, ctx());
    expect(outra.ok && outra.proposta.direcao).toBeNull();
    expect(outra.ok && outra.proposta.avisos.join(' ')).toMatch(/não aparece nesta nota/);
    const semCnpj = propostaDoXml(xmlNfe({ emit: CNPJ_FORNECEDOR, dest: CNPJ_EMPRESA }), { documento: null, identificaPagador: false }, ctx({ direcaoInformada: 'saida' }));
    expect(semCnpj.ok && semCnpj.proposta.direcao).toBe('saida');
    expect(semCnpj.ok && semCnpj.proposta.avisos.join(' ')).toMatch(/sem CNPJ/);
    const contra = propostaDoXml(xmlNfe({ emit: CNPJ_FORNECEDOR, dest: CNPJ_EMPRESA }), { documento: CNPJ_EMPRESA, identificaPagador: false }, ctx({ direcaoInformada: 'entrada' }));
    expect(contra.ok && contra.proposta.direcao).toBe('saida');
    expect(contra.ok && contra.proposta.avisos.join(' ')).toMatch(/Você marcou recebimento/);
    // Fora do exercício: data em branco, com aviso.
    const fora = propostaDoXml(xmlNfe({ emit: CNPJ_FORNECEDOR, dest: CNPJ_EMPRESA }), { documento: CNPJ_EMPRESA, identificaPagador: false }, ctx({ ano: 2027 }));
    expect(fora.ok && fora.proposta.data).toBeNull();
  });

  it('NFS-e padrão nacional: tomador → saída pelo líquido; prestador → entrada', () => {
    const comprou = propostaDoXml(xmlNfseNacional(CNPJ_FORNECEDOR, CNPJ_EMPRESA), { documento: CNPJ_EMPRESA, identificaPagador: false }, ctx());
    expect(comprou.ok).toBe(true);
    if (!comprou.ok) return;
    expect(comprou.proposta).toMatchObject({
      fonte: 'nfse', direcao: 'saida', data: '2026-04-01', valor: 950, complemento: 'NFS-e 42 — Serviços Exemplo LTDA',
    });
    expect(comprou.proposta.chave).toMatch(/^nfse:\d{50}$/);
    expect(comprou.proposta.detalhes.join(' ')).toMatch(/retenções/);
    const prestou = propostaDoXml(xmlNfseNacional(CNPJ_EMPRESA, '12345678909', true), { documento: CNPJ_EMPRESA, identificaPagador: true }, ctx());
    expect(prestou.ok && prestou.proposta).toMatchObject({ direcao: 'entrada', complemento: 'NFS-e 42', pagadorNome: 'Paciente Ficticio' });
  });

  it('NFS-e ABRASF 2.04 (prefeitura): número, líquido e chave prestador+número', () => {
    const r = propostaDoXml(xmlAbrasf(CNPJ_EMPRESA, CNPJ_FORNECEDOR), { documento: CNPJ_EMPRESA, identificaPagador: false }, ctx());
    expect(r.ok && r.proposta).toMatchObject({
      fonte: 'nfse', direcao: 'entrada', data: '2026-05-10', valor: 480, chave: `nfse:${CNPJ_EMPRESA}:77`,
      complemento: 'NFS-e 77 — Tomador ABRASF LTDA', titulo: 'NFS-e (prefeitura) 77',
    });
  });

  it('evento (cancelamento) não é a nota', () => {
    const ev = '<procEventoNFe><evento><infEvento><tpEvento>110111</tpEvento></infEvento></evento></procEventoNFe>';
    expect(lerNotaXml(ev)).toEqual({ ok: false, erro: expect.stringContaining('evento da nota') });
  });
});

// ------------------------------------------------------------------ PDF com texto

async function pdfCom(linhas: string[]): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([595, 842]);
  linhas.forEach((l, i) => p.drawText(l, { x: 40, y: 800 - i * 18, size: 11, font: f }));
  d.setAuthor('Autor Ficticio');
  return d.save();
}

const EMPRESA = { documento: CNPJ_EMPRESA, identificaPagador: false };

describe('PDF com texto', () => {
  it('extrai o texto no servidor (unpdf) e lê um recibo por rótulos', async () => {
    const texto = await textoDoPdf(await pdfCom([
      'RECIBO Nº 45',
      'Recebi de Padaria Ficticia LTDA a importância de R$ 350,00 (trezentos e cinquenta reais)',
      'referente a conserto do forno.',
      'Belém, 10 de março de 2026',
    ]));
    expect(texto).toContain('RECIBO');
    const p = propostaDoTextoPdf(texto, EMPRESA, ctx({ direcaoInformada: 'saida' }));
    expect(p).toMatchObject({ fonte: 'pdf', data: '2026-03-10', valor: 350, direcao: 'saida', complemento: 'Recibo 45', chave: null });
    expect(p!.confianca).toBeLessThan(1);
  });

  it('PDF do boleto: acha a linha digitável e usa o boleto (exato)', async () => {
    const texto = await textoDoPdf(await pdfCom(['Itaú Unibanco', LINHA_ITAU, 'Vencimento 07/07/2026', 'Valor do documento R$ 1.234,56']));
    const p = propostaDoTextoPdf(texto, EMPRESA, ctx());
    expect(p).toMatchObject({ fonte: 'boleto', valor: 1234.56, data: '2026-07-07', chave: `boleto:${BARRAS_ITAU}` });
  });

  it('DANFE em PDF: chave de acesso impressa → nota (mesma chave do XML), valor e data pelos rótulos', async () => {
    const chave = chaveNfe(CNPJ_FORNECEDOR);
    const texto = await textoDoPdf(await pdfCom([
      'DANFE - Documento Auxiliar da Nota Fiscal Eletrônica',
      'CHAVE DE ACESSO',
      chave.replace(/(\d{4})(?=\d)/g, '$1 '),
      'DATA DA EMISSÃO',
      '05/03/2026',
      'VALOR TOTAL DOS PRODUTOS 1.000,00',
      'VALOR TOTAL DA NOTA',
      '1.234,56',
    ]));
    const p = propostaDoTextoPdf(texto, EMPRESA, ctx());
    expect(p).toMatchObject({ fonte: 'nfe', chave: `nfe:${chave}`, direcao: 'saida', data: '2026-03-05', valor: 1234.56, complemento: 'NF 1234' });
  });

  it('não achou: diz claramente e deixa em branco (nada inventado)', async () => {
    const duasDatas = propostaDoTextoPdf('Comprovante\nPedido feito em 01/03/2026\nEntregue 05/03/2026\nR$ 10,00 R$ 20,00', EMPRESA, ctx());
    expect(duasDatas?.data).toBeNull();
    expect(duasDatas?.valor).toBeNull();
    expect(duasDatas?.avisos.join(' ')).toMatch(/mais de uma data/);
    expect(duasDatas?.avisos.join(' ')).toMatch(/vários valores/);
    expect(duasDatas?.avisos.join(' ')).toMatch(/pagamento \(saída\) ou recebimento/);
    const nada = propostaDoTextoPdf('Documento qualquer sem número nenhum aqui', EMPRESA, ctx());
    expect(nada?.avisos.join(' ')).toMatch(/Não achei data/);
    expect(nada?.avisos.join(' ')).toMatch(/Não achei o valor/);
  });

  it('o rótulo decide: data de pagamento vence a de emissão; "vence em" é vencimento', () => {
    const p = propostaDoTextoPdf('Recibo\nData de emissão: 01/03/2026\nData do pagamento: 03/03/2026\nValor pago: R$ 99,90\nItem 05/03/2026', EMPRESA, ctx());
    expect(p).toMatchObject({ data: '2026-03-03', valor: 99.9 });
    const v = propostaDoTextoPdf('Fatura 12\nVence em 15/03/2026\nTotal a pagar R$ 80,00', EMPRESA, ctx());
    expect(v).toMatchObject({ data: '2026-03-15', valor: 80, complemento: 'Fatura 12' });
    expect(v?.avisos.join(' ')).toMatch(/vencimento/);
  });

  it('PDF escaneado (sem texto) → null: a tela diz que não dá sem IA', async () => {
    const d = await PDFDocument.create();
    d.addPage([200, 200]);
    const texto = await textoDoPdf(await d.save());
    expect(propostaDoTextoPdf(texto, EMPRESA, ctx())).toBeNull();
  });

  it('PDF torto é recusado com mensagem clara', async () => {
    await expect(textoDoPdf(new TextEncoder().encode('%PDF-1.4 isto não é um pdf'))).rejects.toThrow(/Não foi possível abrir este PDF/);
  });
});

// ------------------------------------------------------------------ conta pelo histórico

describe('conta sugerida pelo que a empresa já tem (nunca IA)', () => {
  const contas = [
    { id: 'c-merc', codigo: '3.1', nome: 'Mercadorias', natureza: 'despesa' as const },
    { id: 'c-venda', codigo: '4.1', nome: 'Vendas', natureza: 'receita' as const },
  ];
  const analiticas = [
    { id: 'h-merc', texto: 'Compra de mercadorias', contaId: 'c-merc', natureza: 'despesa' as const },
    { id: 'h-venda', texto: 'Venda de mercadorias', contaId: 'c-venda', natureza: 'receita' as const },
  ];
  const exemplos = [1180, 990, 1300, 1250].map((v, i) => exemploDe({
    complemento: `NF ${1000 + i} — Distribuidora Exemplo & Cia LTDA`, contaId: 'c-merc', historico: 'Compra de mercadorias',
    entrada: 0, saida: v, conferido: true,
  }));

  it('o mesmo fornecedor lançado antes puxa a conta', () => {
    const r = propostaDoXml(xmlNfe({ emit: CNPJ_FORNECEDOR, dest: CNPJ_EMPRESA }), EMPRESA, ctx());
    if (!r.ok) throw new Error(r.erro);
    const p = comContaSugerida(r.proposta, { exemplos, contas, analiticas });
    expect(p).toMatchObject({ contaId: 'c-merc', historico: 'Compra de mercadorias', historicoId: 'h-merc' });
    expect(p.detalhes.join(' ')).toMatch(/Conta sugerida pelo que a empresa já lançou/);
  });

  it('sem histórico nem direção: conta em branco e o pedido para escolher', () => {
    const p = propostaDoTextoPdf('Recibo 3\nValor pago R$ 50,00 em 02/03/2026', EMPRESA, ctx());
    comContaSugerida(p!, { exemplos: [], contas, analiticas });
    expect(p!.historico).toBeNull();
    expect(p!.avisos.join(' ')).toMatch(/Escolha a conta/);
  });
});
