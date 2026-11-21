// Simulação de rescisão em PDF — mesmo desenhista dos contratos e das férias
// (lib/contratosPdf.ts, pdf-lib, Times). Gerado no NAVEGADOR (a tela importa este módulo
// sob demanda): nada é gravado nem enviado ao servidor.
//
// Não é TRCT: cada página leva a marca d'água "SIMULAÇÃO" e o aviso no topo e no rodapé.
// Desde a Sprint 11: INSS, IRRF, líquido e a origem das médias do ponto (meses e horas).
import { degrees, rgb } from 'pdf-lib';
import { rotuloMes, type MediaPeriodo } from './mediasPonto';
import { Escritor, LARGURA, MARGEM, A4 } from './contratosPdf';
import { br, cpfFormatado } from './dp';
import { AVISO_SIMULACAO, reais, rotuloTipo, ROTULO_AVISO, type EntradaRescisao, type LinhaRescisao, type ResultadoRescisao } from './rescisao';

export interface DadosPdfRescisao {
  empresa: { nome: string; cnpj?: string | null };
  empregado: { nome: string; cpf?: string | null; cargo?: string | null };
  entrada: Pick<EntradaRescisao, 'tipo' | 'aviso' | 'admissao' | 'desligamento' | 'salarioBase' | 'adicionaisFixos' | 'mediasVariaveis' | 'fimExperiencia'>;
  resultado: ResultadoRescisao;
  /** Data em que a simulação foi feita. */
  data: string;
}

const CINZA = rgb(0.45, 0.45, 0.45);
/** O sinal de menos (U+2212) não existe na fonte padrão do PDF: vira hífen. */
const menos = (s: string) => s.replace(/−/g, '-');

function marcaDagua(e: Escritor) {
  const f = e.fontes.neg;
  for (const p of e.pdf.getPages()) {
    const texto = 'SIMULAÇÃO';
    const tam = 84;
    const w = f.widthOfTextAtSize(texto, tam);
    // Diagonal, centrada: o canto de partida recua metade da largura ao longo de 45°.
    const cx = A4[0] / 2, cy = A4[1] / 2;
    const d = w / 2 / Math.SQRT2;
    p.drawText(texto, { x: cx - d, y: cy - d - tam / 3, size: tam, font: f, color: rgb(0.75, 0.1, 0.1), opacity: 0.1, rotate: degrees(45) });
    const rod = e.limpo(e.fontes.reg, AVISO_SIMULACAO);
    p.drawText(rod, { x: MARGEM.x, y: MARGEM.base / 2, size: 8, font: e.fontes.reg, color: CINZA, maxWidth: LARGURA });
  }
}

function linhaValor(e: Escritor, l: LinhaRescisao) {
  const tam = 10;
  const sinal = l.grupo === 'desconto' || l.grupo === 'tributo' ? '- ' : '';
  const valor = l.grupo === 'informativo' ? `(${reais(l.valor)})` : `${sinal}${reais(l.valor)}`;
  const largValor = 96;
  const desc = e.quebrar(e.fontes.reg, tam, menos(l.descricao), LARGURA - largValor - 8);
  const mem = e.quebrar(e.fontes.reg, 8.5, menos(`${l.memoria} · ${l.fonte}`), LARGURA - 12);
  e.garantir(desc.length * tam * 1.35 + mem.length * 8.5 * 1.3 + 6);
  desc.forEach((ln, i) => {
    e.y -= tam * 1.35;
    e.texto(ln, MARGEM.x, e.y, tam);
    if (i === 0) {
      const t = e.limpo(e.fontes.reg, valor);
      e.texto(t, MARGEM.x + LARGURA - e.largura(e.fontes.reg, tam, t), e.y, tam);
    }
  });
  for (const ln of mem) {
    e.y -= 8.5 * 1.3;
    e.pagina.drawText(ln, { x: MARGEM.x + 12, y: e.y, size: 8.5, font: e.fontes.reg, color: CINZA });
  }
  e.y -= 4;
  e.pagina.drawLine({ start: { x: MARGEM.x, y: e.y }, end: { x: MARGEM.x + LARGURA, y: e.y }, thickness: 0.3, color: rgb(0.8, 0.8, 0.8) });
}

function total(e: Escritor, rotulo: string, valor: string, negrito = true) {
  e.garantir(18);
  e.y -= 15;
  e.texto(rotulo, MARGEM.x, e.y, 10.5, negrito);
  const f = negrito ? e.fontes.neg : e.fontes.reg;
  const t = e.limpo(f, valor);
  e.texto(t, MARGEM.x + LARGURA - e.largura(f, 10.5, t), e.y, 10.5, negrito);
}

/** Gera o PDF da simulação. */
export async function gerarPdfRescisao(d: DadosPdfRescisao): Promise<Uint8Array> {
  const e = await Escritor.criar(`Simulação de rescisão — ${d.empregado.nome.trim()}`);
  const r = d.resultado;
  const en = d.entrada;

  e.par(d.empresa.nome.toUpperCase(), { negrito: true, depois: 1 });
  if (d.empresa.cnpj) e.par(`CNPJ: ${d.empresa.cnpj}`, { tam: 10, depois: 8 });
  e.par('SIMULAÇÃO DE RESCISÃO', { negrito: true, tam: 13, alinhar: 'centro', depois: 4 });
  e.par(AVISO_SIMULACAO, { tam: 9.5, alinhar: 'centro', negrito: true, depois: 10 });

  e.par(`Empregado(a): ${d.empregado.nome.toUpperCase()}`, { negrito: true, depois: 2 });
  const id = [
    d.empregado.cpf ? `CPF: ${cpfFormatado(d.empregado.cpf)}` : '',
    d.empregado.cargo ? `Função: ${d.empregado.cargo}` : '',
    `Admissão: ${br(en.admissao)}`,
  ].filter(Boolean).join('   ·   ');
  e.par(id, { tam: 10, depois: 6 });

  const rem = [`salário base ${reais(en.salarioBase)}`];
  if (en.adicionaisFixos) rem.push(`adicionais fixos ${reais(en.adicionaisFixos)}`);
  if (en.mediasVariaveis) rem.push(`outras médias ${reais(en.mediasVariaveis)}`);
  if (r.medias?.aviso) rem.push('médias do ponto por verba (abaixo)');
  const aviso = r.aviso.dias
    ? `${ROTULO_AVISO[en.aviso].toLowerCase()} — ${r.aviso.dias} dias${r.aviso.trabalhados ? `, ${r.aviso.trabalhados} trabalhados` : ''}${r.aviso.indenizados ? `, ${String(r.aviso.indenizados).replace('.', ',')} indenizados` : ''}`
    : 'não se aplica';
  e.tabela([LARGURA * 0.32, LARGURA * 0.68], [
    ['Tipo', rotuloTipo(en.tipo)],
    ['Desligamento (último dia)', br(en.desligamento)],
    ['Aviso prévio', aviso],
    ['Data projetada (CTPS)', br(r.projecao)],
    ...(en.fimExperiencia ? [['Fim da experiência', br(en.fimExperiencia)]] : []),
    ['Remuneração usada', rem.join(' + ')],
    ['Pagar até', r.prazoPagamento ? `${br(r.prazoPagamento)} (CLT art. 477 §6º)` : '—'],
  ], { altura: 17, tam: 9.5 });

  e.espaco(4);
  e.par('Memória de cálculo', { negrito: true, depois: 2 });
  for (const l of r.linhas.filter((x) => x.grupo === 'provento')) linhaValor(e, l);
  total(e, 'Total de verbas', reais(r.totalProventos));
  const desc = r.linhas.filter((x) => x.grupo === 'desconto');
  if (desc.length) {
    e.espaco(8);
    e.par('Descontos da rescisão', { negrito: true, depois: 2 });
    for (const l of desc) linhaValor(e, l);
    total(e, 'Total de descontos considerado', `- ${reais(r.totalDescontos)}`);
  }
  e.espaco(4);
  total(e, 'Total bruto (antes de INSS e IRRF)', reais(r.totalBruto));
  const trib = r.linhas.filter((x) => x.grupo === 'tributo');
  if (trib.length) {
    e.espaco(8);
    e.par('INSS e IRRF', { negrito: true, depois: 2 });
    for (const l of trib) linhaValor(e, l);
    total(e, 'Total de INSS e IRRF', `- ${reais(r.totalTributos)}`);
  }
  e.espaco(4);
  total(e, 'LÍQUIDO ESTIMADO (sem pensão alimentícia)', reais(r.totalLiquido));

  if (r.medias && (r.medias.aviso || r.medias.decimo || r.medias.ferias.length)) {
    e.espaco(8);
    e.par('Médias de horas extras e adicional noturno (Folha de Ponto)', { negrito: true, depois: 2 });
    const item = (titulo: string, m: MediaPeriodo | null) => {
      if (!m) return;
      const ajustados = m.meses.filter((x) => x.ajustado).map((x) => rotuloMes(x.mes));
      const fora = m.meses.filter((x) => !x.considerado).map((x) => rotuloMes(x.mes));
      e.par(menos(`• ${titulo}: ${reais(m.valor)} — ${m.memoria}.${ajustados.length ? ` Horas ajustadas pela contadora: ${ajustados.join(', ')}.` : ''}${fora.length ? ` Fora da média: ${fora.join(', ')}.` : ''}`), { tam: 9.5, depois: 2 });
    };
    item('Aviso (últimos 12 meses)', r.medias.aviso);
    item(`13º (meses de ${en.desligamento.slice(0, 4)})`, r.medias.decimo);
    for (const f of r.medias.ferias) item(`Férias do aquisitivo desde ${br(f.inicio)}`, f.media);
    e.par('HE 50% (dia útil e sábado de folga), 100% (domingo e feriado) e noturno 20% sobre a hora computada, com reflexo no DSR mês a mês; valor-hora atual (Súmula 347 TST). Mês sem ponto entra com zero.', { tam: 8.5, depois: 2 });
  }

  const info = r.linhas.filter((x) => x.grupo === 'informativo');
  if (info.length) {
    e.espaco(8);
    e.par('Informativo (fora do total)', { negrito: true, depois: 2 });
    for (const l of info) linhaValor(e, l);
  }

  if (r.fgts) {
    e.espaco(10);
    e.par('FGTS (estimativa — depositado na conta vinculada, fora do total)', { negrito: true, depois: 2 });
    e.par(`Depósito sobre as verbas da rescisão: 8% × ${reais(r.fgts.base)} = ${reais(r.fgts.deposito)} (saldo, aviso indenizado, 13º e banco de horas; férias indenizadas não têm FGTS — OJ 195 SDI-1).`, { tam: 9.5, depois: 2 });
    e.par(r.fgts.multa !== null ? `Multa estimada: ${reais(r.fgts.multa)} = ${r.fgts.memoria}. O saldo é o informado pelo usuário; confira no extrato.` : r.fgts.memoria, { tam: 9.5, depois: 2 });
  }

  e.espaco(8);
  e.par('Prazos e alertas', { negrito: true, depois: 2 });
  if (r.prazoPagamento) {
    e.par(`• Pagamento, entrega dos documentos e comunicação (eSocial S-2299) até ${br(r.prazoPagamento)}. Depois disso, multa de um salário base (${reais(r.multa477)}) a favor do empregado (CLT art. 477 §8º).`, { tam: 9.5, depois: 2 });
  }
  for (const a of r.alertas) e.par(menos(`• ${a.texto}`), { tam: 9.5, depois: 2 });

  e.espaco(8);
  e.par(`Simulação feita em ${br(d.data)} no ClickContas. Não tem valor de documento oficial: o cálculo final é do programa da folha, com a convenção coletiva, as médias e o extrato do FGTS.`, { tam: 9, depois: 0 });

  marcaDagua(e);
  return e.bytes();
}
