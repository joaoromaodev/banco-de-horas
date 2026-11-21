'use client';

// Simular rescisão: escolhe o tipo, a data, o aviso e o que o sistema não sabe (médias,
// saldo do FGTS…) e mostra a memória de cálculo linha a linha (lib/rescisao.ts). É só
// SIMULAÇÃO: não grava nada, não muda a situação do empregado e o PDF é gerado aqui no
// navegador (lib/rescisaoPdf.ts, carregado sob demanda), com marca d'água.
import { useId, useState } from 'react';
import { Modal } from '../Dialogo';
import { Aviso, Botao, cx, Entrada, Indicador, Marcacao, tb } from '@/components/ui';
import { Selecao } from '@/components/selecao';
import { br, lerDinheiro, type Empregado } from '@/lib/dp';
import { somarDias, type FeriasProgramada } from '@/lib/ferias';
import {
  AVISO_SIMULACAO, ehExperiencia, modosDeAviso, reais, ROTULO_AVISO, simularRescisao, TIPOS_RESCISAO,
  type EntradaRescisao, type LinhaRescisao, type ModoAviso, type TipoRescisao,
} from '@/lib/rescisao';

const paraCampo = (v: number | null) => (v == null ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const valorOuZero = (s: string) => { const n = lerDinheiro(s); return n == null || Number.isNaN(n) ? 0 : n; };
const valorOuNull = (s: string) => { const n = lerDinheiro(s); return n == null || Number.isNaN(n) ? null : n; };
const limparNome = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();

function LinhaTabela({ l }: { l: LinhaRescisao }) {
  return (
    <tr className={tb.linha}>
      <td className={tb.td}>
        <span className="text-tinta">{l.descricao}</span>
        <span className="block text-xs text-tinta-suave">{l.memoria}</span>
        <span className="block text-[11px] text-tinta-fraca">{l.fonte}</span>
      </td>
      <td className={cx(tb.td, tb.num, 'whitespace-nowrap align-top', l.grupo === 'desconto' && 'text-perigo', l.grupo === 'informativo' && 'text-tinta-suave')}>
        {l.grupo === 'desconto' ? `− ${reais(l.valor)}` : l.grupo === 'informativo' ? `(${reais(l.valor)})` : reais(l.valor)}
      </td>
    </tr>
  );
}

export function SimularRescisao({ empregado: e, empresa, ferias, faltas, feriados, hoje, onBaixou, onFechar }: {
  empregado: Empregado;
  empresa: { nome: string; cnpj?: string | null };
  ferias: FeriasProgramada[];
  faltas: string[];
  feriados: string[];
  hoje: string;
  onBaixou: (msg: string) => void;
  onFechar: () => void;
}) {
  const id = useId();
  const [tipo, setTipo] = useState<TipoRescisao>('sem_justa_causa');
  const [aviso, setAviso] = useState<ModoAviso>('indenizado');
  const [desligamento, setDesligamento] = useState(hoje);
  const [fimExperiencia, setFimExperiencia] = useState(e.admissao ? somarDias(e.admissao, 89) : '');
  const [diasFaltaram, setDiasFaltaram] = useState('');
  const [salario, setSalario] = useState(paraCampo(e.salarioBase));
  const [adicionais, setAdicionais] = useState('');
  const [medias, setMedias] = useState('');
  const [saldoFgts, setSaldoFgts] = useState('');
  const [fgtsAnterior, setFgtsAnterior] = useState('');
  const [adiantado, setAdiantado] = useState('');
  const [outros, setOutros] = useState('');
  const [bancoHoras, setBancoHoras] = useState('');
  const [domestico, setDomestico] = useState(false);
  const [quitados, setQuitados] = useState<string[]>([]);
  const [gerando, setGerando] = useState(false);
  const [erroPdf, setErroPdf] = useState<string | null>(null);

  const modos = modosDeAviso(tipo);
  const entrada: EntradaRescisao = {
    tipo, aviso: modos.includes(aviso) ? aviso : modos[0], admissao: e.admissao ?? '', desligamento,
    salarioBase: valorOuZero(salario), adicionaisFixos: valorOuZero(adicionais), mediasVariaveis: valorOuZero(medias),
    saldoFgts: valorOuNull(saldoFgts), fgtsMesAnterior: valorOuZero(fgtsAnterior), decimoAdiantado: valorOuZero(adiantado),
    outrosDescontos: valorOuZero(outros), fimExperiencia: ehExperiencia(tipo) ? fimExperiencia || null : null,
    diasAvisoNaoCumpridos: Number(diasFaltaram) || 0, bancoHorasPositivo: Number(String(bancoHoras).replace(',', '.')) || 0,
    horasSemanais: e.horasSemanais, temBancoHoras: e.bancoHoras, domestico, faltas, aquisitivoBase: e.aquisitivoBase,
    ferias, periodosQuitados: quitados, feriados, situacao: e.situacao, afastamentoTipo: e.afastamentoTipo,
  };
  // Recalcula a cada renderização: é puro e barato.
  const r = simularRescisao(entrada);

  function trocarTipo(t: string) {
    const novo = t as TipoRescisao;
    setTipo(novo);
    setAviso(modosDeAviso(novo)[0]);
  }

  async function baixar() {
    setGerando(true); setErroPdf(null);
    try {
      const { gerarPdfRescisao } = await import('@/lib/rescisaoPdf');
      const bytes = await gerarPdfRescisao({
        empresa, empregado: { nome: e.nome, cpf: e.cpf, cargo: e.cargo }, entrada, resultado: r, data: hoje,
      });
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `SIMULACAO DE RESCISAO - ${limparNome(e.nome.toUpperCase())}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      onBaixou('PDF da simulação baixado. Lembre: não substitui o TRCT.');
    } catch {
      setErroPdf('Não foi possível gerar o PDF. Tente de novo.');
    } finally {
      setGerando(false);
    }
  }

  const proventos = r.linhas.filter((l) => l.grupo === 'provento');
  const descontos = r.linhas.filter((l) => l.grupo === 'desconto');
  const informativos = r.linhas.filter((l) => l.grupo === 'informativo');
  const comSaldo = r.ferias.filter((p) => p.devidos > 0);
  const ok = r.erros.length === 0;

  return (
    <Modal onFechar={onFechar} rotuladoPor={id} largura="max-w-4xl">
      <div className="max-h-[78vh] overflow-y-auto p-5">
        <h2 id={id} className="text-base font-semibold text-tinta">Simular rescisão — {e.nome}</h2>
        <p className="mt-1 text-[13px] text-tinta-suave">
          Nada aqui é gravado e a situação do empregado não muda. Admissão em {br(e.admissao) || '—'}.
        </p>
        <Aviso tom="aviso" className="mt-3" titulo="Simulação">{AVISO_SIMULACAO}</Aviso>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Selecao rotulo="Tipo de rescisão" valor={tipo} onChange={trocarTipo} busca={false} classeCampo="sm:col-span-2"
            opcoes={TIPOS_RESCISAO.map((t) => ({ valor: t.valor, rotulo: t.rotulo, detalhe: t.detalhe }))} />
          <Entrada rotulo="Data do desligamento" type="date" value={desligamento} onChange={(x) => setDesligamento(x.target.value)}
            dica="Último dia trabalhado (no aviso trabalhado, o último dia do aviso)." />
          {modos[0] !== 'nenhum' && (
            <Selecao rotulo="Aviso prévio" valor={entrada.aviso} onChange={(x) => setAviso(x as ModoAviso)} busca={false}
              opcoes={modos.map((m) => ({ valor: m, rotulo: ROTULO_AVISO[m] }))} />
          )}
          {entrada.aviso === 'parcial' && (
            <Entrada rotulo="Dias do aviso que faltaram" type="number" min={1} max={30} value={diasFaltaram} onChange={(x) => setDiasFaltaram(x.target.value)} />
          )}
          {ehExperiencia(tipo) && (
            <Entrada rotulo="Último dia da experiência" type="date" value={fimExperiencia} onChange={(x) => setFimExperiencia(x.target.value)}
              dica="Confira no contrato (45 + 45 ou 90 dias)." />
          )}
          <Entrada rotulo="Salário base (R$)" inputMode="decimal" value={salario} onChange={(x) => setSalario(x.target.value)}
            dica="Vem do cadastro; mudar aqui não altera a ficha." />
          <Entrada rotulo="Adicionais fixos por mês (R$)" inputMode="decimal" value={adicionais} onChange={(x) => setAdicionais(x.target.value)}
            dica="Insalubridade, periculosidade, gratificação fixa. Entram também no saldo." />
          <Entrada rotulo="Médias de variáveis por mês (R$)" inputMode="decimal" value={medias} onChange={(x) => setMedias(x.target.value)}
            dica="Horas extras, comissões, adicional noturno. Entram no aviso, 13º e férias." />
          <Entrada rotulo="Saldo do FGTS para fins rescisórios (R$)" inputMode="decimal" value={saldoFgts} onChange={(x) => setSaldoFgts(x.target.value)}
            dica="Do extrato. O sistema não sabe o saldo real." />
          <Entrada rotulo="FGTS do mês anterior não recolhido (R$)" inputMode="decimal" value={fgtsAnterior} onChange={(x) => setFgtsAnterior(x.target.value)}
            dica="O depósito vence dia 20: se ainda não está no extrato." />
          <Entrada rotulo="1ª parcela do 13º já paga (R$)" inputMode="decimal" value={adiantado} onChange={(x) => setAdiantado(x.target.value)} />
          <Entrada rotulo="Adiantamentos e outros descontos (R$)" inputMode="decimal" value={outros} onChange={(x) => setOutros(x.target.value)} />
          <Entrada rotulo="Banco de horas: saldo positivo (horas)" inputMode="decimal" value={bancoHoras} onChange={(x) => setBancoHoras(x.target.value)}
            dica={e.bancoHoras ? 'Pago como hora extra com 50% (art. 59 §3º).' : 'Sem acordo no cadastro; preencha só se houver.'} />
          <div className="flex items-end pb-2">
            <Marcacao type="checkbox" checked={domestico} onChange={(x) => setDomestico(x.target.checked)}>Empregador doméstico (LC 150/2015)</Marcacao>
          </div>
        </div>

        {comSaldo.length > 0 && (
          <fieldset className="mt-4 rounded-lg border border-borda p-3">
            <legend className="px-1 text-[13px] font-semibold text-tinta">Férias vencidas calculadas pelo sistema</legend>
            <p className="text-xs text-tinta-suave">Contam só as férias programadas aqui que começaram até o desligamento. Se algum período foi gozado ou pago fora do sistema, marque.</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {comSaldo.map((p) => (
                <Marcacao key={p.inicio} type="checkbox" checked={quitados.includes(p.inicio)}
                  onChange={(x) => setQuitados((q) => (x.target.checked ? [...q, p.inicio] : q.filter((i) => i !== p.inicio)))}>
                  {br(p.inicio)} a {br(p.fim)} — {p.devidos} dias{p.dobro ? ' em dobro' : ''}: já quitado fora do sistema
                </Marcacao>
              ))}
            </div>
          </fieldset>
        )}

        {!ok ? (
          <Aviso tom="perigo" titulo="Não dá para simular assim" className="mt-4">
            <ul className="list-disc pl-4">{r.erros.map((x) => <li key={x}>{x}</li>)}</ul>
          </Aviso>
        ) : (
          <>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Indicador rotulo="Total bruto estimado" valor={reais(r.totalBruto)} destaque />
              <Indicador rotulo="Pagar até (art. 477 §6º)" valor={br(r.prazoPagamento)} />
              <Indicador rotulo={r.fgts?.percentual ? `Multa do FGTS (${Math.round(r.fgts.percentual * 100)}%)` : 'Multa do FGTS'}
                valor={r.fgts?.multa != null ? reais(r.fgts.multa) : r.fgts?.percentual ? 'Informe o saldo' : 'Não há'} />
            </div>
            <p className="mt-2 text-[13px] text-tinta-suave">
              {r.aviso.dias ? `Aviso de ${r.aviso.dias} dias (${r.anosCompletos} ano${r.anosCompletos === 1 ? '' : 's'} completo${r.anosCompletos === 1 ? '' : 's'})` : 'Sem aviso prévio'}
              {' · '}data projetada (CTPS): <strong className="text-tinta">{br(r.projecao)}</strong>
              {' · '}pagar depois do prazo gera multa de um salário ({reais(r.multa477)}, art. 477 §8º).
            </p>

            <h3 className="mt-5 text-[13px] font-semibold text-tinta">Memória de cálculo</h3>
            <div className={cx(tb.moldura, 'mt-2')}>
              <table className={tb.tabela}>
                <thead className={tb.cabeca}>
                  <tr><th className={tb.th}>Verba e cálculo</th><th className={cx(tb.th, 'text-right')}>Valor</th></tr>
                </thead>
                <tbody className={tb.corpo}>
                  {proventos.map((l) => <LinhaTabela key={l.id} l={l} />)}
                  <tr className="bg-superficie-suave">
                    <td className={cx(tb.td, 'font-semibold text-tinta')}>Total de verbas</td>
                    <td className={cx(tb.td, tb.num, 'font-semibold text-tinta')}>{reais(r.totalProventos)}</td>
                  </tr>
                  {descontos.map((l) => <LinhaTabela key={l.id} l={l} />)}
                  {descontos.length > 0 && (
                    <tr className="bg-superficie-suave">
                      <td className={cx(tb.td, 'font-semibold text-tinta')}>Descontos considerados</td>
                      <td className={cx(tb.td, tb.num, 'font-semibold text-perigo')}>− {reais(r.totalDescontos)}</td>
                    </tr>
                  )}
                  <tr className="bg-superficie-realce">
                    <td className={cx(tb.td, 'font-semibold text-tinta')}>Total bruto estimado <span className="font-normal text-tinta-suave">(sem INSS e IRRF)</span></td>
                    <td className={cx(tb.td, tb.num, 'font-semibold text-tinta')}>{reais(r.totalBruto)}</td>
                  </tr>
                  {informativos.map((l) => <LinhaTabela key={l.id} l={l} />)}
                </tbody>
              </table>
            </div>

            {r.fgts && (
              <div className="mt-4 rounded-lg border border-borda bg-superficie-suave p-3 text-[13px] text-tinta">
                <p className="font-semibold">FGTS — estimativa, fora do total (vai para a conta vinculada)</p>
                <p className="mt-1 text-tinta-suave">
                  Depósito da rescisão: 8% × {reais(r.fgts.base)} = <strong className="text-tinta">{reais(r.fgts.deposito)}</strong> (saldo, aviso indenizado, 13º e banco de horas; férias indenizadas não têm FGTS).
                </p>
                <p className="mt-1 text-tinta-suave">
                  {r.fgts.multa != null ? <>Multa: <strong className="text-tinta">{reais(r.fgts.multa)}</strong> = {r.fgts.memoria}.</> : r.fgts.memoria}
                </p>
              </div>
            )}

            {r.alertas.length > 0 && (
              <div className="mt-4 space-y-2">
                {r.alertas.map((a) => (
                  <Aviso key={a.texto} tom={a.nivel === 'perigo' ? 'perigo' : a.nivel === 'aviso' ? 'aviso' : 'info'}>{a.texto}</Aviso>
                ))}
              </div>
            )}
          </>
        )}
        {erroPdf && <Aviso tom="perigo" className="mt-4">{erroPdf}</Aviso>}
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-borda bg-superficie-suave px-5 py-3 sm:flex-row sm:justify-end">
        <Botao onClick={onFechar}>Fechar</Botao>
        <Botao variante="primaria" carregando={gerando} disabled={!ok} onClick={baixar}>Baixar PDF da simulação</Botao>
      </div>
    </Modal>
  );
}
