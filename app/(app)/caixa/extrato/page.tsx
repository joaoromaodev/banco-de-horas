'use client';

// Livro Caixa — Extrato (Sprint 17, Frente D). Só a contabilidade.
//
// A contadora importa o extrato (OFX ou CSV, do computador ou o que o cliente
// mandou em Documentos) de uma empresa e confere: o que está no banco e não no
// caixa vira SUGESTÃO de lançamento (conta pela caixaInteligente), o que já está
// no caixa aparece casado, e o que está no caixa e não no banco aparece como
// diferença. Nada grava sozinho: ela escolhe linha a linha e confirma EM LOTE —
// com Desfazer. Mês fechado não recebe lançamento (a linha vem travada).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AbasCaixa } from '../AbasCaixa';
import { dinheiro } from '../formato';
import {
  Aviso, Botao, CabecalhoPagina, CampoArquivo, Carregando, Conteudo, EstadoVazio, FalhaCarregamento, Indicador, Secao, Selo, tb,
} from '@/components/ui';
import { Selecao, type Opcao } from '@/components/selecao';
import { Toast, Toasts } from '@/components/retorno';
import { lerMe } from '@/lib/meCliente';
import { lerJson, mensagemDeCarga } from '@/lib/carga';
import { competenciaBR } from '@/lib/documentos';
import type {
  Conciliacao, InfoCsv, ItemConciliacao, LancamentoConciliacao, MapaCsv, ModoExtrato, PernaSugerida,
} from '@/lib/extratoBancario';

interface Empresa { id: string; nome: string }
interface Analitica { id: string; texto: string; contaId: string | null; natureza: 'receita' | 'despesa'; daEmpresa: boolean }
interface Conta { id: string; codigo: string; nome: string }
interface DocumentoLista { id: string; nome: string; tipo: string; competencia: string }

interface Resultado extends Conciliacao {
  origem: { nome: string; documento: string | null };
  modo: ModoExtrato; instalada: boolean; formato: 'ofx' | 'csv'; conta: string | null;
  periodo: { de: string; ate: string }; descartadas: number; avisos: string[]; csv: InfoCsv | null;
}

type Acao = 'lancar' | 'deixar' | 'ignorar';
interface Escolha { acao: Acao; historico: string; historicoId: string | null; contaId: string | null }

const TIPOS_EXTRATO = ['application/x-ofx', 'text/csv'];
const dataBR = (d: string) => d.split('-').reverse().join('/');
const ROTULO_MODO: Record<ModoExtrato, string> = {
  par: 'Fora do caixa (padrão)',
  direto: 'Dentro do caixa',
};

/** Arquivo → base64, sem estourar a pilha em arquivo grande. */
async function paraBase64(f: File): Promise<string> {
  const b = new Uint8Array(await f.arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** A perna que recebe a conta (a que não é transferência). */
const principalDe = (it: ItemConciliacao): PernaSugerida | undefined => it.pernas.find((p) => !p.transferencia);

function descreverPernas(pernas: PernaSugerida[]): string {
  return pernas.map((p) => (p.transferencia ? p.historico : p.direcao === 'entrada' ? 'recebimento' : 'pagamento')
    + (p.direcao === 'entrada' ? ' (entrada)' : ' (saída)')).join(' + ');
}

export default function ExtratoCaixa() {
  const router = useRouter();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaSel, setEmpresaSel] = useState('');
  const [falhaEmpresas, setFalhaEmpresas] = useState('');
  const [modo, setModo] = useState<ModoExtrato>('par');
  const [instalada, setInstalada] = useState(true);
  const [analiticas, setAnaliticas] = useState<Analitica[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [docs, setDocs] = useState<DocumentoLista[]>([]);

  const [fonte, setFonte] = useState<'arquivo' | 'documento'>('arquivo');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [documentoId, setDocumentoId] = useState('');
  const [mapa, setMapa] = useState<MapaCsv | null>(null);
  const [csv, setCsv] = useState<InfoCsv | null>(null);
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);

  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>({});
  const [faltaConta, setFaltaConta] = useState<Set<string>>(new Set());
  const [lendo, setLendo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [desfazer, setDesfazer] = useState<{ lote: string; ids: string[]; texto: string } | null>(null);

  // A tela é da contabilidade: o cliente volta para os lançamentos.
  const carregarEmpresas = useCallback(() => {
    setFalhaEmpresas('');
    lerJson<{ empresas?: Empresa[] }>('/api/empresas').then((d) => {
      const lista = d.empresas ?? [];
      setEmpresas(lista);
      setEmpresaSel((atual) => atual || lista[0]?.id || '');
    }).catch((e) => setFalhaEmpresas(mensagemDeCarga(e)));
  }, []);
  useEffect(() => {
    lerMe().then((d) => {
      if (d?.role === 'cliente') { router.replace('/caixa'); return; }
      const e = localStorage.getItem('caixa.empresa');
      if (e) setEmpresaSel((atual) => atual || e);
      carregarEmpresas();
    }).catch(() => {}); // lerMe nunca rejeita
  }, [router, carregarEmpresas]);
  useEffect(() => { if (empresaSel) localStorage.setItem('caixa.empresa', empresaSel); }, [empresaSel]);

  // Trocar de empresa limpa a conferência (é de outra empresa) — ajuste durante a renderização.
  const [empresaVista, setEmpresaVista] = useState(empresaSel);
  if (empresaVista !== empresaSel) {
    setEmpresaVista(empresaSel);
    setResultado(null); setEscolhas({}); setCsv(null); setMapa(null); setDocumentoId(''); setDesfazer(null);
  }

  // Opcionais da tela: o modo, as contas e os extratos do portal. Falha de um não
  // trava a importação (o modo cai no padrão; sem contas, a conta fica para escolher).
  useEffect(() => {
    if (!empresaSel) return;
    const q = encodeURIComponent(empresaSel);
    lerJson<{ modo: ModoExtrato; instalada: boolean }>(`/api/caixa/extrato?empresa=${q}`)
      .then((d) => { setModo(d.modo); setInstalada(d.instalada); }).catch(() => {});
    lerJson<{ contas: Conta[]; historicos: Analitica[] }>(`/api/caixa/contas?empresa=${q}`)
      .then((d) => { setContas(d.contas ?? []); setAnaliticas(d.historicos ?? []); }).catch(() => {});
    lerJson<{ documentos: DocumentoLista[] }>(`/api/documentos?empresa=${q}`)
      .then((d) => setDocs((d.documentos ?? []).filter((x) => TIPOS_EXTRATO.includes(x.tipo)).slice(0, 40))).catch(() => setDocs([]));
  }, [empresaSel]);

  const contaPorId = useMemo(() => new Map(contas.map((c) => [c.id, c])), [contas]);
  const opcoesPorNatureza = useMemo(() => {
    const ordenar = (a: Analitica, b: Analitica) => Number(b.daEmpresa) - Number(a.daEmpresa) || a.texto.localeCompare(b.texto, 'pt-BR');
    const op = (n: 'receita' | 'despesa'): Opcao[] => analiticas.filter((a) => a.natureza === n).sort(ordenar).map((a) => {
      const c = a.contaId ? contaPorId.get(a.contaId) : null;
      return { valor: a.id, rotulo: a.texto, detalhe: c ? `${c.codigo} ${c.nome}` : 'sem conta titular' };
    });
    return { receita: op('receita'), despesa: op('despesa') };
  }, [analiticas, contaPorId]);

  /** Escolhas iniciais: lançar o que é novo e não está travado; o resto fica. */
  function escolhasIniciais(r: Resultado): Record<string, Escolha> {
    const e: Record<string, Escolha> = {};
    for (const it of r.itens) {
      if (it.estado !== 'nova' && it.estado !== 'parcial') continue;
      const p = principalDe(it);
      e[it.chave] = {
        acao: it.estado === 'nova' && !it.travada ? 'lancar' : 'deixar',
        historico: p?.historico ?? '', historicoId: p?.historicoId ?? null, contaId: p?.contaId ?? null,
      };
    }
    return e;
  }

  async function ler(mapaUsado: MapaCsv | null = null) {
    setErroArquivo(null); setErro(null);
    if (fonte === 'arquivo' && !arquivo) { setErroArquivo('Escolha o arquivo do extrato (OFX ou CSV).'); return; }
    if (fonte === 'documento' && !documentoId) { setErroArquivo('Escolha o extrato enviado em Documentos.'); return; }
    setLendo(true);
    try {
      const corpo: Record<string, unknown> = { empresa: empresaSel, ...(mapaUsado ? { mapa: mapaUsado } : {}) };
      if (fonte === 'arquivo' && arquivo) {
        if (arquivo.size > 2 * 1024 * 1024) { setErroArquivo('O extrato passa de 2 MB. Exporte um período menor.'); return; }
        corpo.arquivo = { nome: arquivo.name, base64: await paraBase64(arquivo) };
      } else corpo.documento = documentoId;
      const r = await fetch('/api/caixa/extrato', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
      const d = await r.json().catch(() => null);
      if (!r.ok) {
        // CSV sem colunas reconhecidas: a tela mostra o mapeamento para escolher.
        if (d?.csv) { setCsv(d.csv); setMapa(d.csv.mapa ?? mapaUsado ?? { data: 0, historico: 1, valor: 2, credito: null, debito: null, tipo: null, documento: null }); }
        setResultado(null);
        setErroArquivo(d?.erro ?? 'Não foi possível ler o extrato.');
        return;
      }
      const res = d as Resultado;
      setResultado(res); setModo(res.modo); setInstalada(res.instalada);
      setEscolhas(escolhasIniciais(res)); setFaltaConta(new Set());
      setCsv(res.csv); setMapa(res.csv?.mapa ?? null);
    } catch {
      setErroArquivo('Sem conexão com o servidor. Confira a internet e tente de novo.');
    } finally {
      setLendo(false);
    }
  }

  async function mudarModo(novo: ModoExtrato) {
    const antes = modo;
    setModo(novo);
    try {
      await lerJson('/api/caixa/extrato', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ empresa: empresaSel, modo: novo }) });
      setMsg(novo === 'par' ? 'A conta bancária fica fora do caixa nesta empresa.' : 'A conta bancária fica dentro do caixa nesta empresa.');
      if (resultado) await ler(mapa);
    } catch (e) {
      setModo(antes);
      setErro(mensagemDeCarga(e));
    }
  }

  const itens = resultado?.itens ?? [];
  const aLancar = itens.filter((it) => (it.estado === 'nova' || it.estado === 'parcial'));
  const jaNoCaixa = itens.filter((it) => it.estado === 'casada' || it.estado === 'importada');
  const fora = itens.filter((it) => it.estado === 'fora');
  const nLancar = aLancar.filter((it) => escolhas[it.chave]?.acao === 'lancar').length;
  const nIgnorar = aLancar.filter((it) => escolhas[it.chave]?.acao === 'ignorar').length;

  function escolher(chave: string, mudar: Partial<Escolha>) {
    setEscolhas((e) => ({ ...e, [chave]: { ...e[chave], ...mudar } }));
    if (mudar.historicoId !== undefined) setFaltaConta((f) => { const n = new Set(f); n.delete(chave); return n; });
  }
  function marcarTodas(acao: Acao) {
    setEscolhas((e) => {
      const n = { ...e };
      for (const it of aLancar) if (!it.travada && n[it.chave]) n[it.chave] = { ...n[it.chave], acao };
      return n;
    });
  }

  async function confirmar() {
    if (!resultado) return;
    // Erro mora no campo: a linha sem conta analítica é apontada e recebe o foco.
    const sem = aLancar.filter((it) => escolhas[it.chave]?.acao === 'lancar' && principalDe(it) && !escolhas[it.chave].historico);
    if (sem.length) {
      setFaltaConta(new Set(sem.map((it) => it.chave)));
      document.getElementById(`conta-${sem[0].chave}`)?.focus();
      setErro(`Escolha a conta analítica de ${sem.length === 1 ? '1 linha' : `${sem.length} linhas`} antes de lançar.`);
      return;
    }
    const lote = [
      ...aLancar.filter((it) => escolhas[it.chave]?.acao === 'lancar' || escolhas[it.chave]?.acao === 'ignorar').map((it) => {
        const e = escolhas[it.chave];
        return {
          chave: it.chave, data: it.data, valor: it.valor, sentido: it.sentido, historicoBanco: it.historico,
          acao: e.acao === 'lancar' ? 'lancar' : 'ignorar',
          pernas: e.acao === 'lancar' ? it.pernas.map((p) => (p.transferencia ? p : { ...p, historico: e.historico, historicoId: e.historicoId, contaId: e.contaId })) : [],
        };
      }),
      // As casadas ficam registradas para a próxima importação reconhecer (precisa da 0035).
      ...(resultado.instalada ? itens.filter((it) => it.estado === 'casada').map((it) => ({
        chave: it.chave, data: it.data, valor: it.valor, sentido: it.sentido, historicoBanco: it.historico,
        acao: 'casar', pernas: [], lancamentoIds: it.casadoCom.map((l) => l.id),
      })) : []),
    ];
    if (lote.length === 0) { setErro('Nada escolhido para lançar ou ignorar.'); return; }
    setGravando(true); setErro(null);
    try {
      const d = await lerJson<{ lote: string; criados: number; lancamentoIds: string[]; registrado: boolean }>('/api/caixa/extrato/lote', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ empresa: empresaSel, itens: lote }),
      });
      const texto = d.criados === 1 ? '1 lançamento criado a partir do extrato.' : `${d.criados} lançamentos criados a partir do extrato.`;
      setDesfazer({ lote: d.lote, ids: d.lancamentoIds, texto: d.registrado ? texto : `${texto} (Sem a migração 0035, as linhas ignoradas não ficam lembradas.)` });
      await ler(mapa);
    } catch (e) {
      setErro(mensagemDeCarga(e));
    } finally {
      setGravando(false);
    }
  }

  async function desfazerLote() {
    if (!desfazer) return;
    const alvo = desfazer;
    setDesfazer(null);
    try {
      const d = await lerJson<{ excluidos: number }>('/api/caixa/extrato/lote', {
        method: 'DELETE', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ empresa: empresaSel, lote: alvo.lote, lancamentoIds: alvo.ids }),
      });
      setMsg(d.excluidos === 1 ? 'Desfeito: 1 lançamento excluído.' : `Desfeito: ${d.excluidos} lançamentos excluídos.`);
      await ler(mapa);
    } catch (e) {
      setErro(mensagemDeCarga(e));
    }
  }

  const opcoesColuna: Opcao[] = (csv?.colunas ?? []).map((c, i) => ({ valor: String(i), rotulo: c || `Coluna ${i + 1}` }));
  const opcoesColunaOpcional: Opcao[] = [{ valor: '', rotulo: '— nenhuma —' }, ...opcoesColuna];
  const campoMapa = (k: keyof MapaCsv, rotulo: string, opcional: boolean) => (
    <Selecao key={k} rotulo={rotulo} busca={false} valor={mapa?.[k] == null ? '' : String(mapa[k])}
      opcoes={opcional ? opcoesColunaOpcional : opcoesColuna}
      onChange={(v) => setMapa((m) => ({ ...(m ?? { data: 0, historico: 1, valor: null, credito: null, debito: null, tipo: null, documento: null }), [k]: v === '' ? null : Number(v) }))} />
  );

  return (
    <div className="text-sm">
      <CabecalhoPagina titulo="Livro Caixa — extrato" subtitulo="Importe o extrato do banco e confira com o caixa"
        abas={<AbasCaixa ativa="extrato" ehGestor />}
        acoes={(
          <Selecao aria-label="Empresa" largura="w-56 max-w-full" valor={empresaSel} onChange={setEmpresaSel}
            placeholder="— nenhuma empresa —" opcoes={empresas.map((e) => ({ valor: e.id, rotulo: e.nome }))} />
        )} />

      <Toasts>
        {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
        {msg && <Toast onFechar={() => setMsg(null)}>{msg}</Toast>}
        {desfazer && (
          <Toast tom="info" onFechar={() => setDesfazer(null)}
            acao={<Botao tamanho="sm" variante="tonal" onClick={desfazerLote}>Desfazer</Botao>}>{desfazer.texto}</Toast>
        )}
      </Toasts>

      <Conteudo className="space-y-5">
        {falhaEmpresas && <FalhaCarregamento titulo="Não foi possível carregar as empresas." onTentar={carregarEmpresas}>{falhaEmpresas}</FalhaCarregamento>}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Secao titulo="Importar extrato" descricao="OFX ou CSV do banco, até 2 MB. Nada é lançado agora: você confere cada linha antes.">
            <div className="space-y-4">
              <Selecao rotulo="De onde vem o extrato" busca={false} valor={fonte} onChange={(v) => { setFonte(v as 'arquivo' | 'documento'); setErroArquivo(null); }}
                opcoes={[
                  { valor: 'arquivo', rotulo: 'Arquivo do computador' },
                  { valor: 'documento', rotulo: 'Enviado pelo cliente em Documentos', detalhe: docs.length ? `${docs.length} em OFX/CSV` : 'nenhum' },
                ]} />
              {fonte === 'arquivo' ? (
                <div>
                  <CampoArquivo rotulo="Arquivo do extrato" accept=".ofx,.csv,.txt" nome={arquivo?.name ?? null}
                    texto="Escolher OFX ou CSV" onArquivo={(f) => { setArquivo(f); setErroArquivo(null); setCsv(null); setMapa(null); }} />
                </div>
              ) : (
                <Selecao rotulo="Extrato enviado" valor={documentoId} onChange={(v) => { setDocumentoId(v); setErroArquivo(null); setCsv(null); setMapa(null); }}
                  placeholder={docs.length ? 'Escolha o extrato' : 'Nenhum OFX/CSV em Documentos'} disabled={!docs.length}
                  opcoes={docs.map((d) => ({ valor: d.id, rotulo: d.nome, detalhe: competenciaBR(d.competencia) }))} />
              )}
              {erroArquivo && <p role="alert" className="text-[13px] font-medium text-perigo">{erroArquivo}</p>}

              {csv && (
                <div className="space-y-3 rounded-lg border border-borda bg-superficie-suave p-3">
                  <p className="text-[13px] text-tinta-suave">
                    Colunas do CSV {csv.mapa ? '(reconhecidas pelo cabeçalho — mude se estiver errado)' : '— diga qual é qual'}.
                    Valor numa coluna só (negativo = débito) <em>ou</em> crédito e débito separados.
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {campoMapa('data', 'Data', false)}
                    {campoMapa('historico', 'Histórico', false)}
                    {campoMapa('valor', 'Valor', true)}
                    {campoMapa('tipo', 'Tipo (D/C)', true)}
                    {campoMapa('credito', 'Crédito', true)}
                    {campoMapa('debito', 'Débito', true)}
                    {campoMapa('documento', 'Documento', true)}
                  </div>
                  {csv.amostra.length > 0 && (
                    <div className={tb.moldura}>
                      <table className={`${tb.tabela} text-xs`}>
                        <caption className="sr-only">Primeiras linhas do CSV</caption>
                        <thead className={tb.cabeca}><tr>{csv.colunas.map((c, i) => <th key={i} className={tb.th}>{c}</th>)}</tr></thead>
                        <tbody>{csv.amostra.map((l, i) => <tr key={i} className={tb.linha}>{l.map((x, k) => <td key={k} className={tb.td}>{x}</td>)}</tr>)}</tbody>
                      </table>
                    </div>
                  )}
                  <Botao onClick={() => ler(mapa)} carregando={lendo}>Ler com estas colunas</Botao>
                </div>
              )}

              <Botao variante={resultado ? 'secundaria' : 'primaria'} onClick={() => ler(csv ? mapa : null)} carregando={lendo} disabled={!empresaSel}>
                {resultado ? 'Ler de novo' : 'Ler extrato'}
              </Botao>
            </div>
          </Secao>

          <Secao titulo="Conta bancária e o caixa" descricao="Como cada linha do banco vira lançamento nesta empresa.">
            <div className="space-y-3">
              <Selecao rotulo="A conta bancária fica" busca={false} valor={modo} disabled={!instalada || !empresaSel}
                onChange={(v) => mudarModo(v as ModoExtrato)}
                dica={instalada ? undefined : 'Para mudar, falta instalar a migração 0035 — por enquanto vale o padrão.'}
                opcoes={(['par', 'direto'] as ModoExtrato[]).map((m) => ({ valor: m, rotulo: ROTULO_MODO[m] }))} />
              {modo === 'par' ? (
                <p className="text-[13px] leading-relaxed text-tinta-suave">
                  A regra do livro: <strong className="text-tinta">depósito no banco é saída do caixa e retirada é entrada</strong>.
                  Um pagamento pelo banco vira a retirada de conta corrente + o pagamento (como o cheque);
                  um recebimento no banco vira o recebimento + o depósito em conta corrente. Saque e depósito em
                  dinheiro viram só a transferência.
                </p>
              ) : (
                <p className="text-[13px] leading-relaxed text-tinta-suave">
                  O banco conta como caixa: cada linha vira um lançamento só (crédito = entrada, débito = saída).
                  Saque e depósito em dinheiro ficam de fora, porque não mudam o saldo.
                </p>
              )}
            </div>
          </Secao>
        </div>

        {lendo && !resultado && <Carregando>Lendo o extrato…</Carregando>}

        {resultado && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Indicador rotulo="Linhas do extrato" valor={String(resultado.totais.linhas)} />
              <Indicador rotulo="No banco e não no caixa" valor={String(resultado.totais.novas + resultado.totais.parciais)} destaque tom={resultado.totais.novas ? 'perigo' : 'neutro'} />
              <Indicador rotulo="Já no caixa" valor={String(resultado.totais.casadas + resultado.totais.importadas)} tom="sucesso" />
              <Indicador rotulo="No caixa e não no banco" valor={String(resultado.soNoCaixa.transferencias.length + resultado.soNoCaixa.outros.length)} />
            </div>

            <p className="text-[13px] text-tinta-suave">
              {resultado.origem.nome}{resultado.conta ? ` · ${resultado.conta}` : ''} · de {dataBR(resultado.periodo.de)} a {dataBR(resultado.periodo.ate)}
              {resultado.descartadas ? ` · ${resultado.descartadas} linha(s) de saldo ou sem valor ignoradas` : ''}
            </p>
            {resultado.avisos.map((a) => <Aviso key={a} tom="aviso">{a}</Aviso>)}
            {!resultado.instalada && (
              <Aviso tom="neutro">
                Falta a migração 0035: dá para lançar, e o que já está no caixa é reconhecido pela data e pelo valor, mas as
                linhas ignoradas não ficam lembradas e o modo da empresa fica no padrão.
              </Aviso>
            )}
            {resultado.totais.travadas > 0 && (
              <Aviso tom="aviso" titulo="Mês fechado">
                {resultado.totais.travadas === 1 ? '1 linha é' : `${resultado.totais.travadas} linhas são`} de mês fechado pela
                contabilidade (ou anterior a um fechado) e não pode{resultado.totais.travadas === 1 ? '' : 'm'} ser lançada{resultado.totais.travadas === 1 ? '' : 's'}.
                Para lançar, reabra o mês em Lançamentos, informando o motivo.
              </Aviso>
            )}

            <Secao titulo="No banco e não no caixa"
              descricao="Cada linha vira o lançamento sugerido. Confira a conta, escolha o que fazer e confirme tudo de uma vez."
              acoes={aLancar.length > 0 ? (
                <>
                  <Botao tamanho="sm" variante="fantasma" onClick={() => marcarTodas('lancar')}>Lançar todas</Botao>
                  <Botao tamanho="sm" variante="fantasma" onClick={() => marcarTodas('deixar')}>Nenhuma</Botao>
                </>
              ) : undefined}>
              {aLancar.length === 0 ? (
                <EstadoVazio moldura={false} titulo="Tudo o que está no extrato já está no caixa." />
              ) : (
                <div className="space-y-4">
                  <div className={tb.moldura}>
                    <table className={`${tb.tabela} text-[13px]`}>
                      <caption className="sr-only">Linhas do extrato que não estão no caixa</caption>
                      <thead className={tb.cabeca}>
                        <tr>
                          <th className={tb.th}>O que fazer</th>
                          <th className={tb.th}>Data</th>
                          <th className={tb.th}>Histórico do banco</th>
                          <th className={`${tb.th} text-right`}>Valor</th>
                          <th className={tb.th}>No caixa vira</th>
                          <th className={tb.th}>Conta analítica</th>
                        </tr>
                      </thead>
                      <tbody className="[&>tr]:border-b [&>tr]:border-borda/70">
                        {aLancar.map((it) => (
                          <LinhaLancar key={it.chave} it={it} escolha={escolhas[it.chave]} faltaConta={faltaConta.has(it.chave)}
                            opcoes={principalDe(it)?.direcao === 'entrada' ? opcoesPorNatureza.receita : opcoesPorNatureza.despesa}
                            analiticas={analiticas} onEscolher={(m) => escolher(it.chave, m)} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Botao variante="primaria" onClick={confirmar} carregando={gravando} disabled={nLancar + nIgnorar === 0}>
                      {nLancar > 0 ? `Lançar ${nLancar === 1 ? '1 linha' : `${nLancar} linhas`}` : 'Gravar escolhas'}
                    </Botao>
                    <span className="text-[13px] text-tinta-suave">
                      {nIgnorar > 0 ? `${nIgnorar} para ignorar nas próximas importações. ` : ''}
                      Dá para desfazer logo depois.
                    </span>
                  </div>
                </div>
              )}
            </Secao>

            <Secao titulo="No caixa e não no banco"
              descricao={`Lançamentos de ${dataBR(resultado.periodo.de)} a ${dataBR(resultado.periodo.ate)} sem par no extrato.`}>
              <div className="space-y-4">
                <ListaCaixa titulo="Transferências com o banco sem par no extrato" vazio="Nenhuma — toda retirada e todo depósito do caixa aparecem no banco."
                  tom="aviso" itens={resultado.soNoCaixa.transferencias}
                  nota="Retirada ou depósito de conta corrente que o banco não mostra: confira a data, o valor ou a conta bancária." />
                <ListaCaixa titulo="Outros lançamentos do período" vazio="Nenhum."
                  tom="neutro" itens={resultado.soNoCaixa.outros}
                  nota="O que foi pago ou recebido em dinheiro não passa pelo banco — é normal. Confira se algum deveria estar no extrato." />
              </div>
            </Secao>

            {jaNoCaixa.length > 0 && (
              <details className="rounded-xl border border-borda bg-superficie shadow-cartao">
                <summary className="flex min-h-11 cursor-pointer items-center px-4 text-[15px] font-semibold text-tinta sm:px-5">
                  Já no caixa ({jaNoCaixa.length})
                </summary>
                <ul className="divide-y divide-borda/70 border-t border-borda px-4 sm:px-5">
                  {jaNoCaixa.map((it) => (
                    <li key={it.chave} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-[13px]">
                      <span className="tabular-nums text-tinta-suave">{dataBR(it.data)}</span>
                      <span className="min-w-0 flex-1 text-tinta">{it.historico}</span>
                      <span className={`tabular-nums ${it.sentido === 'credito' ? 'text-sucesso' : 'text-perigo'}`}>{dinheiro(it.valor)}</span>
                      <Selo tom={it.estado === 'importada' ? 'primaria' : 'sucesso'}>{it.estado === 'importada' ? 'importada antes' : 'casada'}</Selo>
                      {it.casadoCom.length > 0 && (
                        <span className="w-full text-xs text-tinta-suave">
                          No caixa: {it.casadoCom.map((l) => `${dataBR(l.data)} · ${l.historico}${l.complemento ? ` — ${l.complemento}` : ''}`).join('; ')}
                        </span>
                      )}
                      {it.notas.map((n) => <span key={n} className="w-full text-xs text-tinta-suave">{n}</span>)}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {fora.length > 0 && (
              <details className="rounded-xl border border-borda bg-superficie shadow-cartao">
                <summary className="flex min-h-11 cursor-pointer items-center px-4 text-[15px] font-semibold text-tinta sm:px-5">
                  Fora do caixa ({fora.length})
                </summary>
                <ul className="divide-y divide-borda/70 border-t border-borda px-4 sm:px-5">
                  {fora.map((it) => (
                    <li key={it.chave} className="flex flex-wrap items-baseline gap-x-3 py-2 text-[13px]">
                      <span className="tabular-nums text-tinta-suave">{dataBR(it.data)}</span>
                      <span className="min-w-0 flex-1 text-tinta">{it.historico}</span>
                      <span className="tabular-nums">{dinheiro(it.valor)}</span>
                      {it.notas.map((n) => <span key={n} className="w-full text-xs text-tinta-suave">{n}</span>)}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </Conteudo>
    </div>
  );
}

function LinhaLancar({ it, escolha, faltaConta, opcoes, analiticas, onEscolher }: {
  it: ItemConciliacao; escolha: Escolha | undefined; faltaConta: boolean; opcoes: Opcao[];
  analiticas: Analitica[]; onEscolher: (m: Partial<Escolha>) => void;
}) {
  const principal = principalDe(it);
  const acao = escolha?.acao ?? 'deixar';
  // A sugestão pode trazer uma analítica que não está na lista (texto do histórico): entra como opção.
  const lista = escolha?.historico && !escolha.historicoId && !opcoes.some((o) => o.rotulo === escolha.historico)
    ? [{ valor: '__sugerida', rotulo: escolha.historico, detalhe: 'sugerida' }, ...opcoes] : opcoes;
  const valorSel = escolha?.historicoId ?? (escolha?.historico ? '__sugerida' : '');
  return (
    <tr className={`${tb.linha} align-top ${acao === 'lancar' ? '' : 'text-tinta-suave'}`}>
      <td className={tb.td}>
        {it.travada ? <Selo tom="aviso">mês fechado</Selo> : (
          <Selecao aria-label={`O que fazer com ${it.historico} de ${dataBR(it.data)}`} aparencia="selo" busca={false}
            tom={acao === 'lancar' ? 'primaria' : acao === 'ignorar' ? 'neutro' : 'neutro'} largura="w-auto" valor={acao}
            onChange={(v) => onEscolher({ acao: v as Acao })}
            opcoes={[
              { valor: 'lancar', rotulo: 'Lançar' },
              { valor: 'deixar', rotulo: 'Agora não' },
              { valor: 'ignorar', rotulo: 'Ignorar sempre' },
            ]} />
        )}
      </td>
      <td className={`${tb.td} whitespace-nowrap tabular-nums`}>{dataBR(it.data)}</td>
      <td className={tb.td}>
        <span className="text-tinta">{it.historico}</span>
        {it.notas.map((n) => <span key={n} className="mt-0.5 block text-xs text-aviso">{n}</span>)}
      </td>
      <td className={`${tb.td} ${tb.num} whitespace-nowrap ${it.sentido === 'credito' ? 'text-sucesso' : 'text-perigo'}`}>
        {it.sentido === 'debito' ? '−' : ''}{dinheiro(it.valor)}
      </td>
      <td className={`${tb.td} text-xs`}>{descreverPernas(it.pernas)}</td>
      <td className={`${tb.td} min-w-56`}>
        {principal ? (
          <>
            <Selecao id={`conta-${it.chave}`} aria-label={`Conta analítica de ${it.historico} de ${dataBR(it.data)}`} aparencia="celula"
              valor={valorSel} placeholder="Escolha a conta" opcoes={lista} disabled={it.travada}
              erro={faltaConta ? 'Escolha a conta analítica.' : undefined}
              onChange={(v) => {
                if (v === '__sugerida') return;
                const a = analiticas.find((x) => x.id === v);
                if (a) onEscolher({ historico: a.texto, historicoId: a.id, contaId: a.contaId });
              }} />
            {it.sugestao && escolha?.historico && (
              <span className="mt-1 block text-xs text-tinta-suave">Sugerida: {it.sugestao.motivo}</span>
            )}
          </>
        ) : <span className="text-xs text-tinta-suave">sem conta (transferência)</span>}
      </td>
    </tr>
  );
}

function ListaCaixa({ titulo, vazio, nota, tom, itens }: {
  titulo: string; vazio: string; nota: string; tom: 'aviso' | 'neutro'; itens: LancamentoConciliacao[];
}) {
  return (
    <div>
      <h3 className="flex items-center gap-2 text-[13px] font-semibold text-tinta">
        {titulo} <Selo tom={itens.length && tom === 'aviso' ? 'aviso' : 'neutro'}>{itens.length}</Selo>
      </h3>
      {itens.length === 0 ? <p className="mt-1 text-[13px] text-tinta-suave">{vazio}</p> : (
        <>
          <p className="mt-1 text-[13px] text-tinta-suave">{nota}</p>
          <ul className="mt-2 divide-y divide-borda/70 rounded-lg border border-borda">
            {itens.map((l) => (
              <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2 text-[13px]">
                <span className="tabular-nums text-tinta-suave">{dataBR(l.data)}</span>
                <span className="min-w-0 flex-1 text-tinta">{l.historico}{l.complemento ? ` — ${l.complemento}` : ''}</span>
                <span className={`tabular-nums ${l.entrada ? 'text-sucesso' : 'text-perigo'}`}>{l.entrada ? dinheiro(l.entrada) : `−${dinheiro(l.saida)}`}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
