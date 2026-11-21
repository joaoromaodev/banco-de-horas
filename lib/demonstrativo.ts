// Demonstrativo de caixa do mês — regras PURAS (sem I/O; tests/demonstrativo.test.ts).
// A leitura do banco está em lib/demonstrativoServidor.ts. Ver docs/resumo-cliente.md.
//
// É o resumo que a contadora entrega ao cliente de um mês JÁ CONFIRMADO: entradas,
// saídas e saldo, comparados com o mês anterior e com a média dos 12 meses antes.
// Nunca chame de "DRE": é um livro caixa — o que entrou, o que saiu e o saldo.

export const TITULO = 'Demonstrativo de caixa';

/** Quantos meses antes entram na média de comparação. */
export const MESES_DA_MEDIA = 12;
/** Mínimo de meses confirmados para a média fazer sentido. */
export const MINIMO_PARA_MEDIA = 2;
export const MAIORES_SAIDAS = 5;

/** Um mês do livro que o cliente PODE ver (confirmado e em sequência desde janeiro). */
export interface MesDaSerie {
  ano: number;
  mes: number;
  entradas: number;
  saidas: number;
  saldoFinal: number;
}

export interface SaidaPorConta { conta: string; valor: number }

export interface PendenciaDemonstrativo { titulo: string; prazo: string | null }
export interface ObrigacaoDemonstrativo { nome: string; competencia: string; vencimento: string; atrasada: boolean }

export interface Comparacao {
  entradas: number;
  saidas: number;
  /** Variação do mês contra a base, em fração (0,1 = +10%). Nulo quando a base é zero. */
  variacaoEntradas: number | null;
  variacaoSaidas: number | null;
}

export interface Demonstrativo {
  ano: number;
  mes: number;
  entradas: number;
  saidas: number;
  /** Entradas − saídas do mês. */
  resultado: number;
  saldoFinal: number;
  /** Nulo quando o mês anterior não está entre os confirmados visíveis. */
  anterior: (Comparacao & { ano: number; mes: number }) | null;
  /** Média dos meses confirmados antes deste (até 12). Nulo com menos de 2 meses. */
  media: (Comparacao & { meses: number }) | null;
  maioresSaidas: SaidaPorConta[];
  /** Saídas que não são gasto (depósito em banco, transferência): ficam fora do ranking. */
  movimentacaoBancaria: number;
  pendencias: PendenciaDemonstrativo[];
  obrigacoes: ObrigacaoDemonstrativo[];
  /** Até 12 meses terminando neste, do mais antigo ao mais novo — para o gráfico. */
  serie: MesDaSerie[];
}

const cent = (n: number) => Math.round(n * 100) / 100;
const chave = (m: { ano: number; mes: number }) => m.ano * 12 + (m.mes - 1);

export function variacao(valor: number, base: number): number | null {
  return base > 0 ? (valor - base) / base : null;
}

/** "+12%", "−8%", "igual" — texto para tela e e-mail. Nulo vira "sem base". */
export function textoVariacao(v: number | null): string {
  if (v == null) return 'sem base para comparar';
  const p = Math.round(v * 100);
  if (p === 0) return 'igual';
  return `${p > 0 ? '+' : '−'}${Math.abs(p)}%`;
}

/** Agrupa as saídas por conta e devolve as maiores; o resto vira "Outras contas". */
export function maioresSaidas(saidas: SaidaPorConta[], limite = MAIORES_SAIDAS): SaidaPorConta[] {
  const por = new Map<string, number>();
  for (const s of saidas) if (s.valor > 0) por.set(s.conta, cent((por.get(s.conta) ?? 0) + s.valor));
  const ordenadas = [...por.entries()].map(([conta, valor]) => ({ conta, valor }))
    .sort((a, b) => b.valor - a.valor || a.conta.localeCompare(b.conta, 'pt-BR'));
  const topo = ordenadas.slice(0, limite);
  const resto = cent(ordenadas.slice(limite).reduce((s, x) => s + x.valor, 0));
  return resto > 0 ? [...topo, { conta: 'Outras contas', valor: resto }] : topo;
}

/**
 * Monta o demonstrativo do mês. `serie` deve conter SÓ meses que o cliente pode
 * ver (confirmados em sequência); o mês pedido tem que estar nela — quem chama
 * confere antes (`mesLiberado`). Meses fora da série nunca entram na comparação.
 */
export function montarDemonstrativo(e: {
  ano: number; mes: number; serie: MesDaSerie[];
  saidasPorConta: SaidaPorConta[]; movimentacaoBancaria?: number;
  pendencias?: PendenciaDemonstrativo[]; obrigacoes?: ObrigacaoDemonstrativo[];
}): Demonstrativo | null {
  const atual = e.serie.find((m) => m.ano === e.ano && m.mes === e.mes);
  if (!atual) return null;
  const k = chave(atual);
  const antes = e.serie.filter((m) => chave(m) < k).sort((a, b) => chave(b) - chave(a));

  const comparar = (base: { entradas: number; saidas: number }): Comparacao => ({
    entradas: cent(base.entradas), saidas: cent(base.saidas),
    variacaoEntradas: variacao(atual.entradas, base.entradas), variacaoSaidas: variacao(atual.saidas, base.saidas),
  });

  const imediato = antes.find((m) => chave(m) === k - 1);
  const janela = antes.filter((m) => chave(m) >= k - MESES_DA_MEDIA);
  const media = janela.length >= MINIMO_PARA_MEDIA
    ? { meses: janela.length, ...comparar({
      entradas: janela.reduce((s, m) => s + m.entradas, 0) / janela.length,
      saidas: janela.reduce((s, m) => s + m.saidas, 0) / janela.length,
    }) }
    : null;

  return {
    ano: e.ano, mes: e.mes,
    entradas: cent(atual.entradas), saidas: cent(atual.saidas),
    resultado: cent(atual.entradas - atual.saidas), saldoFinal: cent(atual.saldoFinal),
    anterior: imediato ? { ano: imediato.ano, mes: imediato.mes, ...comparar(imediato) } : null,
    media,
    maioresSaidas: maioresSaidas(e.saidasPorConta),
    movimentacaoBancaria: cent(e.movimentacaoBancaria ?? 0),
    pendencias: e.pendencias ?? [],
    obrigacoes: e.obrigacoes ?? [],
    serie: e.serie.filter((m) => chave(m) <= k && chave(m) > k - 12).sort((a, b) => chave(a) - chave(b)),
  };
}

/**
 * O cliente pode ver o mês? Só se ele estiver na sequência confirmada desde
 * janeiro (o saldo de um mês abre o seguinte: liberar abril solto entregaria
 * janeiro a março junto). `confirmados` são os números dos meses (1–12) do exercício.
 */
export function mesLiberado(confirmados: number[], mes: number): boolean {
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return false;
  for (let m = 1; m <= mes; m++) if (!confirmados.includes(m)) return false;
  return true;
}

/** Até onde (mês 0–12) vai a sequência confirmada desde janeiro. */
export function liberadoAte(confirmados: number[]): number {
  let n = 0;
  while (n < 12 && confirmados.includes(n + 1)) n++;
  return n;
}

// --------------------------------------------------------------------- textos

const MESES_LONGOS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const nomeDoMes = (mes: number, ano: number) => `${MESES_LONGOS[mes - 1]} de ${ano}`;
export const reais = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const brData = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** O que o cliente vê numa linha de comparação. */
function linhaComparacao(rotulo: string, c: Comparacao | null): string | null {
  if (!c) return null;
  return `${rotulo}: entradas ${reais(c.entradas)} (${textoVariacao(c.variacaoEntradas)}) · saídas ${reais(c.saidas)} (${textoVariacao(c.variacaoSaidas)})`;
}

/** Assunto, texto e HTML do e-mail ao cliente. Estilos em linha (e-mail não lê CSS externo). */
export function emailDoDemonstrativo(d: Demonstrativo, o: { empresa: string; escritorio: string; url?: string }) {
  const periodo = nomeDoMes(d.mes, d.ano);
  const assunto = `${TITULO} de ${periodo} — ${o.empresa}`;
  const linhas = [
    linhaComparacao(`Mês anterior (${String(d.anterior?.mes ?? '').padStart(2, '0')}/${d.anterior?.ano ?? ''})`, d.anterior),
    d.media ? linhaComparacao(`Média dos ${d.media.meses} ${d.media.meses === 1 ? 'mês' : 'meses'} anteriores`, d.media) : null,
  ].filter((x): x is string => !!x);

  const texto = [
    `${TITULO} — ${o.empresa} — ${periodo}`, '',
    `Entradas: ${reais(d.entradas)}`, `Saídas: ${reais(d.saidas)}`, `Saldo no fim do mês: ${reais(d.saldoFinal)}`, '',
    ...linhas, ...(linhas.length ? [''] : []),
    ...(d.maioresSaidas.length ? ['Maiores saídas:', ...d.maioresSaidas.map((s) => `- ${s.conta}: ${reais(s.valor)}`), ''] : []),
    ...(d.pendencias.length ? ['Documentos que ainda faltam:', ...d.pendencias.map((p) => `- ${p.titulo}${p.prazo ? ` (até ${brData(p.prazo)})` : ''}`), ''] : []),
    ...(d.obrigacoes.length ? ['Obrigações que vencem:', ...d.obrigacoes.map((x) => `- ${x.nome} — ${brData(x.vencimento)}${x.atrasada ? ' (atrasada)' : ''}`), ''] : []),
    o.url ? `Ver no sistema: ${o.url}` : '',
    `Enviado por ${o.escritorio}. Valores conforme o seu livro caixa.`,
  ].join('\n').trim();

  const cel = 'padding:6px 0;border-bottom:1px solid #dde6e7';
  const lista = (titulo: string, itens: string[]) => itens.length
    ? `<h2 style="font-size:15px;margin:18px 0 4px">${titulo}</h2><ul style="margin:0;padding-left:18px;font-size:14px">${itens.map((i) => `<li style="margin:2px 0">${i}</li>`).join('')}</ul>` : '';
  // Cores fixas: e-mail não tem os tokens do app (valores do tema claro de app/globals.css).
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f2226;max-width:640px">
<h1 style="font-size:18px;margin:0 0 4px">${TITULO}</h1>
<p style="margin:0 0 16px;color:#47595d">${esc(o.empresa)} · ${esc(periodo)}</p>
<table role="presentation" style="border-collapse:collapse;width:100%;font-size:15px">
<tr><td style="${cel}">Entradas</td><td style="${cel};text-align:right;color:#15803d"><strong>${reais(d.entradas)}</strong></td></tr>
<tr><td style="${cel}">Saídas</td><td style="${cel};text-align:right;color:#b91c1c"><strong>${reais(d.saidas)}</strong></td></tr>
<tr><td style="${cel}">Saldo no fim do mês</td><td style="${cel};text-align:right"><strong>${reais(d.saldoFinal)}</strong></td></tr>
</table>
${lista('Comparação', linhas.map(esc))}
${lista('Maiores saídas', d.maioresSaidas.map((s) => `${esc(s.conta)}: ${reais(s.valor)}`))}
${lista('Documentos que ainda faltam', d.pendencias.map((p) => `${esc(p.titulo)}${p.prazo ? ` (até ${brData(p.prazo)})` : ''}`))}
${lista('Obrigações que vencem', d.obrigacoes.map((x) => `${esc(x.nome)} — ${brData(x.vencimento)}${x.atrasada ? ' (atrasada)' : ''}`))}
${o.url ? `<p style="margin-top:20px"><a href="${esc(o.url)}" style="color:#14636c">Ver no ClickContas</a></p>` : ''}
<p style="margin-top:20px;font-size:12px;color:#5f7377">Enviado por ${esc(o.escritorio)}. Valores conforme o seu livro caixa.</p>
</div>`;
  return { assunto, texto, html };
}
