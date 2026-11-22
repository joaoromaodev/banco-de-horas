'use client';

// Livro Caixa — tela de lançamentos (Fase 3).
//
// Mês a mês, no formato da planilha que a contadora usa hoje:
// DATA · HISTÓRICO · COMPLEMENTO · CONTA · ENTRADA · SAÍDA · SALDO.
//
// Quem lança é o administrativo da empresa (papel `cliente`); a contabilidade vê
// todas as empresas, confere lançamento a lançamento e fecha o mês. Lançamento é
// editável e excluível, inclusive retroativo — MENOS em mês fechado: aí nada muda
// (de ninguém) até a contabilidade reabrir com motivo (Sprint 17, frente C). Quem
// trava de verdade é a rota (409); a tela só esconde o que não vai funcionar.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { campoDoErro, diaMes, dinheiro, documentoValido, formatarDocumento, MESES, MESES_LONGOS, type CampoLancamento } from './formato';
import SeletorConta, { Conta, rotuloConta } from './SeletorConta';
import SeletorAnalitica, { Historico } from './SeletorAnalitica';
import { comArquivadaDaUrl, FaixaArquivada } from '../FaixaArquivada';
import { IconeBaixar, IconeCadeado, IconeCheck, IconeConfirmar, IconeDesfazer, IconeDesfazerConfirmacao, IconeDocumento, IconeExcluir, IconeLapis, IconeSino, IconeSugestao } from '../icones';
import { DialogoConfirmacao, DialogoTexto, DialogoValor } from '../Dialogo';
import { AbasCaixa } from './AbasCaixa';
import LimiteFaturamento from './LimiteFaturamento';
import LerDocumento, { type DocumentoLido } from './LerDocumento';
import LerNota, { type LeituraSemIa } from './LerNota';
import {
  Alternador, Aviso, Botao, FalhaCarregamento, botaoCls, BotaoIcone, CabecalhoPagina, Carregando, Cartao, Conteudo, Entrada, Esqueleto,
  EstadoVazio, Indicador, Marcacao, Secao, Selo, seloCls, tb, type Tom,
} from '@/components/ui';
import { Selecao } from '@/components/selecao';
import { Toast, Toasts } from '@/components/retorno';
import { lerMe } from '@/lib/meCliente';
import { lerJson, mensagemDeCarga } from '@/lib/carga';
import { sugerirConta, type ConsultaSugestao, type ExemploConferido, type Sugestao } from '@/lib/sugestaoConta';
import type { NivelAlerta, ResultadoRevisao, RevisaoLancamento } from '@/lib/revisaoCaixa';
import type { PropostaDocumento } from '@/lib/documentoLancamento';
import type { LancamentoAnterior } from '@/lib/leituraSemIa';

interface Me { nome: string; email: string; role: 'master' | 'usuario' | 'cliente'; empresa: string | null; }
interface Empresa { id: string; nome: string; identificaPagador?: boolean; arquivadaEm?: string | null; }
// `Historico` (a Conta Analítica) vem de ./SeletorAnalitica.

interface Lancamento {
  id: string; data: string; historico: string; complemento: string | null; contaId: string | null;
  entrada: number; saida: number; juros: number; multa: number;
  pagadorNome: string | null; pagadorDocumento: string | null;
  criadoPor: string; criadoEm: string; atualizadoPor: string | null;
  conferidoPor: string | null; conferidoEm: string | null;
  /** Documento do portal de onde o lançamento veio (0029). */
  documentoId?: string | null;
}
interface RespostaMes {
  mes: number; lancamentos: Lancamento[];
  saldoTransportado: number; entradas: number; saidas: number; saldoFinal: number;
  confirmado: boolean;
}
interface ResumoMes { mes: number; entradas: number; saidas: number; saldoFinal: number; }
interface Termo { numeroLivro: number | null; numeroOrdem: number | null; dataTermo: string | null; qtdFolhas: number | null; }
interface EventoFechamento { mes: number; acao: 'fechou' | 'reabriu'; por: string; em: string; motivo: string | null }
interface Fechamentos { fechados: { mes: number; por: string; em: string }[]; historico: EventoFechamento[]; historicoDisponivel: boolean }
const quandoBR = (iso: string) => new Date(iso).toLocaleString('pt-BR', {
  timeZone: 'America/Belem', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
interface Pendencia { empresaId: string; pendentes: number; meses: number[]; ultimo: { historico: string; criadoEm: string; criadoPor: string; mes: number }; }

const PRIMEIRO_EXERCICIO = 2026; // a contadora começa o sistema em janeiro/2026

/** O banco ainda não tem a tabela? A mensagem crua não ajuda ninguém. */
const faltaMigracao = (msg: string) =>
  /could not find the table|does not exist|schema cache/i.test(msg);

interface Campos { data: string; historico: string; historicoId: string | null; complemento: string; contaId: string | null; entrada: string; saida: string; juros: string; multa: string; pagadorNome: string; pagadorDocumento: string; }

const vazio = (data: string): Campos =>
  ({ data, historico: '', historicoId: null, complemento: '', contaId: null, entrada: '', saida: '', juros: '', multa: '', pagadorNome: '', pagadorDocumento: '' });

/** Data que o formulário sugere: hoje, se hoje cair no mês aberto; senão o dia 1º. */
function dataPadrao(ano: number, mes: number): string {
  const h = new Date();
  const dia = h.getFullYear() === ano && h.getMonth() + 1 === mes ? h.getDate() : 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** Número digitado ("1.234,56", "1234.56") — 0 se vazio ou inválido. Espelha `paraValor`. */
function numeroDigitado(s: string): number {
  const v = Number(String(s ?? '').replace(/\s|R\$/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** O que o formulário já diz, no formato da sugestão de conta. A analítica escolhida não entra. */
function consultaDe(c: Campos): ConsultaSugestao {
  const entrada = numeroDigitado(c.entrada);
  const saida = numeroDigitado(c.saida) + numeroDigitado(c.juros) + numeroDigitado(c.multa);
  const direcao = entrada > 0 ? 'entrada' : saida > 0 ? 'saida' : null;
  return {
    complemento: c.complemento, direcao, valor: entrada || saida || null,
    pagadorNome: c.pagadorNome, pagadorDocumento: c.pagadorDocumento,
  };
}
const chaveConsulta = (q: ConsultaSugestao) => `${q.complemento.trim()}|${q.direcao ?? ''}|${q.valor ?? ''}`;

/** Sugestão como a tela guarda: a da IA traz o id do registro (para medir se foi aceita). */
type SugestaoTela = Sugestao & { id?: string | null };

/** Situação da leitura de documentos por IA para a empresa aberta (GET /api/caixa/documento-ia). */
interface IaDocumento {
  disponivel: boolean; podeLigar: boolean;
  plataforma?: boolean; ligadaNaEmpresa?: boolean; saude?: boolean;
}
/**
 * O rascunho lido de um documento e que está no formulário de novo lançamento:
 * pela IA (Sprint 12) ou sem IA — XML da nota, PDF com texto ou boleto (Sprint 17).
 */
interface Rascunho {
  empresa: string; origem: 'ia' | 'leitura'; documento: DocumentoLido | null; confianca: number; avisos: string[]; antes: Campos;
  /** Só na leitura sem IA: o que foi lido, a chave do documento e os lançamentos que já vieram dele. */
  titulo?: string; detalhes?: string[]; chave?: string | null;
  duplicados?: LancamentoAnterior[]; duplicidadeVerificada?: boolean;
}

/** Valor da proposta no formato que o formulário digita ("1234,56"). */
const valorDigitado = (v: number | null) => (v && v > 0 ? v.toFixed(2).replace('.', ',') : '');

export default function Caixa() {
  const [me, setMe] = useState<Me | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaSel, setEmpresaSel] = useState('');
  // Abre no mês corrente. Antes de 2026 não existe exercício, então cai em jan/2026.
  const [ano, setAno] = useState(() => Math.max(new Date().getFullYear(), PRIMEIRO_EXERCICIO));
  const [mes, setMes] = useState(() =>
    new Date().getFullYear() >= PRIMEIRO_EXERCICIO ? new Date().getMonth() + 1 : 1);

  const [contas, setContas] = useState<Conta[]>([]);
  const [historicos, setHistoricos] = useState<Historico[]>([]);
  const [resumo, setResumo] = useState<ResumoMes[]>([]);
  const [confirmados, setConfirmados] = useState<number[]>([]);
  const [saldoInicial, setSaldoInicial] = useState(0);
  const [dados, setDados] = useState<RespostaMes | null>(null);
  const [pendencias, setPendencias] = useState<Pendencia[]>([]);
  const [termo, setTermo] = useState<Termo | null>(null);
  const [mostrarDocs, setMostrarDocs] = useState(false);

  const [novo, setNovo] = useState<Campos>(() => vazio(dataPadrao(ano, mes)));
  const [cheque, setCheque] = useState(false);
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [edicao, setEdicao] = useState<Campos>(() => vazio(''));

  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Erro da rota que fala de um campo (data, conta, valor): pinta o campo e liga a mensagem a ele.
  const [erroCampo, setErroCampo] = useState<(ErroCampo & { onde: 'novo' | 'edicao' }) | null>(null);
  // Falha do carregamento principal (empresas, exercício, mês): fica na tela com "Tentar de novo".
  const [falhaEmpresas, setFalhaEmpresas] = useState<string | null>(null);
  const [falhaCarga, setFalhaCarga] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [aExcluir, setAExcluir] = useState<Lancamento | null>(null);
  const [desfazer, setDesfazer] = useState<Lancamento | null>(null); // último excluído, para desfazer
  const [editandoSaldo, setEditandoSaldo] = useState(false);
  // Fechamento do mês (só a contabilidade): quem fechou, histórico e os diálogos.
  const [fechamentos, setFechamentos] = useState<Fechamentos | null>(null);
  const [fechando, setFechando] = useState(false);
  const [reabrindo, setReabrindo] = useState(false);

  // Caixa inteligente (Sprint 5): sugestão de conta ao lançar e revisão antes da conferência.
  const [modelo, setModelo] = useState<{ exemplos: ExemploConferido[]; ia: boolean } | null>(null);
  const [sugIa, setSugIa] = useState<{ chave: string; sugestao: SugestaoTela } | null>(null);
  const [perguntandoIa, setPerguntandoIa] = useState(false);
  const [revisao, setRevisao] = useState<ResultadoRevisao | null>(null);
  const [soAtencao, setSoAtencao] = useState(false);
  const [ordem, setOrdem] = useState<'livro' | 'risco'>('livro');

  // Documento → lançamento por IA (Sprint 12): duas travas, rascunho no formulário.
  const [iaDoc, setIaDoc] = useState<IaDocumento | null>(null);
  const [lendoDoc, setLendoDoc] = useState(false);
  // Nota e boleto sem IA (Sprint 17): o mesmo rascunho, sem travas (nada sai do servidor).
  const [lendoNota, setLendoNota] = useState(false);
  const [confirmarDuplicado, setConfirmarDuplicado] = useState(false);
  const [rascunhoGuardado, setRascunho] = useState<Rascunho | null>(null);
  const [desfazerGuardado, setDesfazerRascunho] = useState<Rascunho | null>(null);
  // O rascunho é da empresa em que foi lido: trocar de empresa o esconde (e o Lançar não o leva).
  const rascunho = rascunhoGuardado?.empresa === empresaSel ? rascunhoGuardado : null;
  const desfazerRascunho = desfazerGuardado?.empresa === empresaSel ? desfazerGuardado : null;

  const ehGestor = me?.role === 'master' || me?.role === 'usuario';
  const anos = useMemo(() => {
    const ultimo = Math.max(new Date().getFullYear() + 1, PRIMEIRO_EXERCICIO);
    return Array.from({ length: ultimo - PRIMEIRO_EXERCICIO + 1 }, (_, i) => PRIMEIRO_EXERCICIO + i);
  }, []);

  /** Troca o mês/ano abertos e devolve o formulário ao estado inicial. */
  function irPara(novoAno: number, novoMes: number) {
    setAno(novoAno);
    setMes(novoMes);
    setNovo(vazio(dataPadrao(novoAno, novoMes)));
    setCheque(false);
    setEditandoId(null);
    setErroCampo(null);
    setRascunho(null);
    setDesfazerRascunho(null);
  }

  // ------------------------------------------------------------------ carga
  // Restaura o filtro salvo antes de tudo, para o fetch das empresas não
  // sobrescrever com a primeira da lista (o setEmpresaSel abaixo só preenche se
  // ainda estiver vazio). É o que mantém empresa/exercício entre as abas.
  useEffect(() => {
    const a = Number(localStorage.getItem('caixa.ano'));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lê localStorage/URL só no navegador, após hidratar (no useState inicial divergiria do HTML do servidor)
    if (a >= PRIMEIRO_EXERCICIO) setAno(a);
  }, []);
  // Não persiste o filtro do cliente: ele é fixo na própria empresa; salvar
  // poluiria a próxima sessão de gestor no mesmo navegador.
  useEffect(() => {
    // Arquivada (consulta) não vira o filtro lembrado: da próxima vez ela não estará na lista.
    const arquivada = empresas.find((e) => e.id === empresaSel)?.arquivadaEm;
    if (empresaSel && me?.role !== 'cliente' && !arquivada) localStorage.setItem('caixa.empresa', empresaSel);
  }, [empresaSel, me, empresas]);
  useEffect(() => { localStorage.setItem('caixa.ano', String(ano)); }, [ano]);
  // A oferta de desfazer é do mês/empresa onde a exclusão aconteceu; ao navegar, some.
  // Ajuste durante a renderização (padrão do React para "estado que muda com a
  // prop"), em vez de um efeito que pintaria o aviso antigo por um quadro.
  const ondeDesfazer = `${empresaSel}|${ano}|${mes}`;
  const [ondeAnterior, setOndeAnterior] = useState(ondeDesfazer);
  if (ondeAnterior !== ondeDesfazer) {
    setOndeAnterior(ondeDesfazer);
    setDesfazer(null);
  }

  const carregarEmpresas = useCallback(() => {
    setFalhaEmpresas(null);
    lerJson<{ empresas?: Empresa[] }>('/api/empresas').then(async (d) => {
      // `?empresa=` de uma arquivada (consulta, só leitura): entra na lista e é a selecionada.
      const { lista, consulta } = await comArquivadaDaUrl<Empresa>(d.empresas ?? []);
      setEmpresas(lista);
      // Fallback: para o cliente, /api/empresas já devolve só a empresa dele.
      setEmpresaSel((atual) => consulta || atual || lista[0]?.id || '');
    }).catch((e) => setFalhaEmpresas(mensagemDeCarga(e)));
  }, []);

  useEffect(() => {
    lerMe().then((d) => {
      if (!d?.autenticado) return;
      setMe(d);
      // O cliente é fixo na própria empresa e NUNCA herda o filtro salvo de outra
      // sessão no mesmo navegador (senão a API recebe o id de outra empresa → 403).
      // O gestor, sim, retoma o último filtro.
      if (d.role === 'cliente') {
        if (d.empresa) setEmpresaSel(d.empresa);
      } else {
        const e = localStorage.getItem('caixa.empresa');
        if (e) setEmpresaSel((atual) => atual || e);
      }
    }).catch(() => {}); // lerMe nunca rejeita (devolve null); sem ele, a lista de empresas decide
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga da API; zerar erro/espera/dados antigos antes do fetch é intencional
    carregarEmpresas();
  }, [carregarEmpresas]);

  const carregarExercicio = useCallback(async () => {
    if (!empresaSel) return;
    const d = await lerJson(`/api/caixa/exercicio?empresa=${encodeURIComponent(empresaSel)}&ano=${ano}`);
    setResumo(d.resumo ?? []);
    setConfirmados(d.confirmados ?? []);
    setSaldoInicial(d.exercicio?.saldoInicial ?? 0);
    setTermo(d.termo ?? null);
    // Quem fechou e o histórico: só a contabilidade (o cliente vê só "mês fechado").
    if (d.termo) {
      lerJson<Fechamentos>(`/api/caixa/meses?empresa=${encodeURIComponent(empresaSel)}&ano=${ano}`)
        .then(setFechamentos).catch(() => setFechamentos(null));
    } else setFechamentos(null);
  }, [empresaSel, ano]);

  const carregarMes = useCallback(async () => {
    if (!empresaSel) return;
    setDados(await lerJson<RespostaMes>(`/api/caixa/lancamentos?empresa=${encodeURIComponent(empresaSel)}&ano=${ano}&mes=${mes}`));
  }, [empresaSel, ano, mes]);

  // Revisão do exercício (só a contabilidade). Falhar aqui não derruba a tela.
  const carregarRevisao = useCallback(async () => {
    if (!empresaSel || !ehGestor) { setRevisao(null); return; }
    const r = await fetch(`/api/caixa/revisao?empresa=${encodeURIComponent(empresaSel)}&ano=${ano}`).catch(() => null);
    setRevisao(r?.ok ? await r.json().catch(() => null) : null);
  }, [empresaSel, ano, ehGestor]);

  // Fila de conferência: é o aviso "a empresa lançou" que a contadora pediu.
  // Depende só do ano — não recarrega a cada troca de mês (era uma varredura à toa).
  const carregarPendencias = useCallback(() => {
    if (!ehGestor) return;
    fetch(`/api/caixa/atividade?ano=${ano}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setPendencias(d?.empresas ?? []))
      .catch(() => {});
  }, [ehGestor, ano]);

  // Contador de cargas em andamento: o "carregando" só apaga quando a última termina.
  const emAndamento = useRef(0);
  const comEstado = useCallback(async (...cargas: Promise<unknown>[]) => {
    emAndamento.current++;
    setCarregando(true); setErro(null); setFalhaCarga(null);
    try {
      await Promise.all(cargas);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      // Migração pendente tem tela própria (BancoIncompleto); o resto fica na tela com "Tentar de novo".
      if (faltaMigracao(m)) setErro(m);
      else setFalhaCarga(mensagemDeCarga(e));
    } finally {
      emAndamento.current--;
      if (emAndamento.current === 0) setCarregando(false);
    }
  }, []);

  // Depois de gravar algo: refaz tudo o que a gravação pode ter mudado.
  const recarregar = useCallback(async () => {
    if (!empresaSel) return;
    await comEstado(carregarExercicio(), carregarMes(), carregarRevisao());
    carregarPendencias();
  }, [empresaSel, comEstado, carregarExercicio, carregarMes, carregarRevisao, carregarPendencias]);

  // Carga da tela, cada parte só quando o que ela usa muda (antes, trocar o mês
  // refazia também o exercício e a revisão do ano inteiro — a mais pesada das três).
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga da API; zerar erro/espera/dados antigos antes do fetch é intencional
  useEffect(() => { if (empresaSel) void comEstado(carregarExercicio()); }, [empresaSel, comEstado, carregarExercicio]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga da API; zerar erro/espera/dados antigos antes do fetch é intencional
  useEffect(() => { if (empresaSel) void comEstado(carregarMes()); }, [empresaSel, comEstado, carregarMes]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga da API; zerar erro/espera/dados antigos antes do fetch é intencional
  useEffect(() => { if (empresaSel) void carregarRevisao(); }, [empresaSel, carregarRevisao]);

  useEffect(() => {
    if (!empresaSel) return;
    fetch(`/api/caixa/contas?empresa=${encodeURIComponent(empresaSel)}`)
      .then((r) => r.json().then((d) => (r.ok ? d : Promise.reject(new Error(d.erro)))))
      .then((d) => { setContas(d.contas ?? []); setHistoricos(d.historicos ?? []); })
      .catch((e) => setErro(e instanceof Error ? e.message : String(e)));
  }, [empresaSel]);

  // Exemplos para a sugestão de conta: os lançamentos já conferidos da empresa.
  const carregarModelo = useCallback(() => {
    if (!empresaSel) return;
    fetch(`/api/caixa/sugestao?empresa=${encodeURIComponent(empresaSel)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setModelo(d ? { exemplos: d.exemplos ?? [], ia: !!d.ia } : null))
      .catch(() => setModelo(null));
  }, [empresaSel]);
  useEffect(() => { carregarModelo(); }, [carregarModelo]);

  // Leitura de documentos por IA: a tela só oferece o botão quando as duas travas deixam.
  const carregarIaDoc = useCallback(() => {
    if (!empresaSel) return;
    fetch(`/api/caixa/documento-ia?empresa=${encodeURIComponent(empresaSel)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setIaDoc(d))
      .catch(() => setIaDoc(null));
  }, [empresaSel]);
  useEffect(() => { carregarIaDoc(); }, [carregarIaDoc]);

  useEffect(() => { carregarPendencias(); }, [carregarPendencias]);

  // ------------------------------------------------------------------ ações
  async function chamar(url: string, init: RequestInit) {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.erro || 'Falha na operação.');
    return d;
  }

  /** Erro da gravação: no aviso do topo e, se for de um campo, ligado ao campo (que recebe o foco). */
  function falhaAoGravar(e: unknown, onde: 'novo' | 'edicao') {
    const mensagem = e instanceof Error ? e.message : String(e);
    setErro(mensagem);
    const campo = campoDoErro(mensagem);
    setErroCampo(campo ? { campo, mensagem, onde } : null);
    if (campo) {
      // Depois de pintar: o leitor de tela lê o rótulo, "inválido" e a mensagem do campo.
      requestAnimationFrame(() => {
        const alvo = campo === 'valor' ? 'entrada' : campo;
        const visivel = [...document.querySelectorAll<HTMLElement>(`[data-campo-lancamento="${onde}"] [id$="-${alvo}"]`)]
          .find((el) => el.offsetParent !== null);
        visivel?.focus();
      });
    }
  }

  async function lancar(jaConfirmouDuplicado = false) {
    // Nota/boleto que já está no livro: aponta antes de gravar (quem lança decide).
    if (!jaConfirmouDuplicado && rascunho?.duplicados?.length) { setConfirmarDuplicado(true); return; }
    setConfirmarDuplicado(false);
    setSalvando(true); setErro(null); setMsg(null); setErroCampo(null);
    try {
      const d = await chamar('/api/caixa/lancamentos', {
        method: 'POST',
        // A sugestão que estava na tela vai junto, para medir se foi aceita.
        body: JSON.stringify({
          empresa: empresaSel, ano, ...novo, cheque, sugestao: sugestaoNova ?? undefined,
          documentoId: rascunho?.documento?.id ?? undefined,
          chaveDocumento: rascunho?.chave ?? undefined,
        }),
      });
      setMsg(d.criados > 1 ? 'Cheque lançado: retirada do banco + pagamento.'
        : rascunho?.documento ? 'Lançado, com o documento anexado.' : 'Lançado.');
      setNovo(vazio(novo.data)); // mantém a data: quem digita o mês inteiro agradece
      setCheque(false);
      setRascunho(null);
      setDesfazerRascunho(null);
      await recarregar();
      await recarregarContas();
    } catch (e) {
      falhaAoGravar(e, 'novo');
    } finally {
      setSalvando(false);
    }
  }

  async function salvarEdicao() {
    if (!editandoId) return;
    setSalvando(true); setErro(null); setMsg(null); setErroCampo(null);
    try {
      await chamar('/api/caixa/lancamentos', { method: 'PATCH', body: JSON.stringify({ id: editandoId, ...edicao }) });
      setEditandoId(null);
      setMsg('Lançamento alterado.');
      await recarregar();
      await recarregarContas();
    } catch (e) {
      falhaAoGravar(e, 'edicao');
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarExclusao() {
    const l = aExcluir;
    if (!l) return;
    setAExcluir(null); setErro(null); setMsg(null);
    try {
      await chamar(`/api/caixa/lancamentos?id=${encodeURIComponent(l.id)}`, { method: 'DELETE' });
      setDesfazer(l); // guarda a linha apagada para o "desfazer"
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Recria o lançamento apagado — vira um lançamento novo (id e carimbo novos),
   * mas com os mesmos dados. É o "não perdi minha linha" que o QA pediu para quem
   * exclui sem querer.
   */
  async function desfazerExclusao() {
    const l = desfazer;
    if (!l) return;
    setDesfazer(null); setErro(null); setMsg(null);
    const recriar = (documentoId?: string) => chamar('/api/caixa/lancamentos', {
      method: 'POST',
      body: JSON.stringify({
        empresa: empresaSel, ano, data: l.data, historico: l.historico,
        complemento: l.complemento ?? '', contaId: l.contaId,
        entrada: l.entrada > 0 ? String(l.entrada) : '',
        saida: l.saida > 0 ? String(l.saida) : '',
        juros: l.juros > 0 ? String(l.juros) : '',
        multa: l.multa > 0 ? String(l.multa) : '',
        pagadorNome: l.pagadorNome ?? '', pagadorDocumento: l.pagadorDocumento ?? '',
        documentoId,
      }),
    });
    try {
      let semAnexo = false;
      try {
        await recriar(l.documentoId ?? undefined);
      } catch (e) {
        // O documento anexado foi excluído nesse meio-tempo: recria sem o vínculo.
        if (!l.documentoId) throw e;
        await recriar();
        semAnexo = true;
      }
      setMsg(semAnexo ? 'Exclusão desfeita — sem o anexo, que não está mais disponível.' : 'Exclusão desfeita.');
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  async function conferir(l: Lancamento, marcar: boolean) {
    try {
      await chamar('/api/caixa/lancamentos', { method: 'PATCH', body: JSON.stringify({ id: l.id, conferido: marcar }) });
      await carregarMes();
      carregarPendencias(); // conferir tira da fila
      carregarModelo(); // o conferido vira exemplo: a sugestão aprende na hora
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  async function fecharMes() {
    setFechando(false); setErro(null); setMsg(null);
    try {
      await chamar('/api/caixa/meses', { method: 'POST', body: JSON.stringify({ empresa: empresaSel, ano, mes }) });
      setEditandoId(null);
      setMsg(`${MESES_LONGOS[mes - 1]} fechado — o resumo fica visível ao cliente e os lançamentos do mês ficam travados.`);
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  async function reabrirMes(motivo: string) {
    setReabrindo(false); setErro(null); setMsg(null);
    try {
      const d = await chamar('/api/caixa/meses', { method: 'DELETE', body: JSON.stringify({ empresa: empresaSel, ano, mes, motivo }) });
      const reabertos: number[] = d.reabertos ?? [mes];
      setMsg(`${reabertos.map((m) => MESES_LONGOS[m - 1]).join(', ')} ${reabertos.length > 1 ? 'reabertos' : 'reaberto'}. O motivo ficou no histórico.`);
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  async function salvarSaldoInicial(v: string) {
    setEditandoSaldo(false); setErro(null); setMsg(null);
    try {
      await chamar('/api/caixa/exercicio', { method: 'PATCH', body: JSON.stringify({ empresa: empresaSel, ano, saldoInicial: v }) });
      setMsg('Saldo inicial atualizado.');
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  /** Fonte (c) da sugestão: a IA escolhe entre as contas da empresa. Só com clique. */
  async function perguntarIa() {
    const q = consultaDe(novo);
    setPerguntandoIa(true); setErro(null); setMsg(null);
    try {
      const d = await chamar('/api/caixa/sugestao', {
        method: 'POST', body: JSON.stringify({ empresa: empresaSel, complemento: q.complemento, direcao: q.direcao, valor: q.valor }),
      });
      if (d.sugestao) setSugIa({ chave: chaveConsulta(q), sugestao: d.sugestao });
      else setMsg(d.aviso ?? 'A IA não encontrou uma conta segura.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setPerguntandoIa(false);
    }
  }

  /**
   * A IA leu o documento: a proposta vira RASCUNHO no formulário de novo
   * lançamento (nada é gravado). O que já estava digitado fica guardado para o
   * "Desfazer". Campo que a IA não leu mantém o que havia.
   */
  function aplicarProposta(
    { proposta: p, documento }: { proposta: PropostaDocumento & { pagadorNome?: string | null; pagadorDocumento?: string | null }; documento: DocumentoLido | null },
    extra: Partial<Rascunho> = {},
  ) {
    setLendoDoc(false);
    setLendoNota(false);
    const antes = rascunho?.antes ?? novo;
    const valor = valorDigitado(p.valor);
    const preenchido: Campos = {
      ...vazio(p.data ?? novo.data),
      complemento: p.complemento || novo.complemento,
      contaId: p.historico ? p.contaId : null, historico: p.historico ?? '', historicoId: p.historico ? p.historicoId : null,
      entrada: p.direcao === 'entrada' ? valor : '',
      saida: p.direcao !== 'entrada' ? valor : '',
      pagadorNome: p.pagadorNome ?? '', pagadorDocumento: p.pagadorDocumento ?? '',
    };
    setNovo(preenchido);
    setCheque(false);
    const r: Rascunho = { empresa: empresaSel, origem: 'ia', documento, confianca: p.confianca, avisos: p.avisos, antes, ...extra };
    setRascunho(r);
    setDesfazerRascunho(r);
    setErro(null); setMsg(null);
  }

  /** Nota ou boleto lido sem IA: o mesmo rascunho, com a duplicidade e o que foi lido. */
  function aplicarLeitura(l: LeituraSemIa) {
    aplicarProposta({ proposta: l.proposta, documento: l.documento }, {
      origem: 'leitura', titulo: l.proposta.titulo, detalhes: l.proposta.detalhes, chave: l.proposta.chave,
      duplicados: l.duplicados, duplicidadeVerificada: l.duplicidadeVerificada,
    });
  }

  /** Desfaz o rascunho: o formulário volta ao que estava antes da leitura. */
  function descartarRascunho() {
    const r = rascunho ?? desfazerRascunho;
    if (r) setNovo(r.antes);
    setRascunho(null);
    setDesfazerRascunho(null);
  }

  /** A contabilidade liga/desliga a leitura de documentos por IA nesta empresa. */
  async function alternarIaDoc(ligada: boolean) {
    setErro(null); setMsg(null);
    try {
      await chamar('/api/caixa/documento-ia', { method: 'PATCH', body: JSON.stringify({ empresa: empresaSel, ligada }) });
      setMsg(ligada ? 'Leitura de documentos por IA ligada para esta empresa.' : 'Leitura de documentos por IA desligada para esta empresa.');
      carregarIaDoc();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  /** Digitar de novo no formulário tira a marca de erro do campo (o aviso do topo fica até fechar). */
  function mudarNovo(c: Campos) {
    setNovo(c);
    if (erroCampo?.onde === 'novo') setErroCampo(null);
  }
  function mudarEdicao(c: Campos) {
    setEdicao(c);
    if (erroCampo?.onde === 'edicao') setErroCampo(null);
  }

  /** "Usar" a sugestão: preenche titular + analítica — só com o clique do usuário. */
  function usarSugestao(s: SugestaoTela) {
    setNovo({ ...novo, contaId: s.contaId, historico: s.historico, historicoId: s.historicoId });
  }

  async function recarregarContas() {
    const r = await fetch(`/api/caixa/contas?empresa=${encodeURIComponent(empresaSel)}`);
    if (r.ok) { const d = await r.json(); setContas(d.contas ?? []); setHistoricos(d.historicos ?? []); }
  }

  async function criarConta(nome: string, grupo: string): Promise<Conta | null> {
    const d = await chamar('/api/caixa/contas', { method: 'POST', body: JSON.stringify({ empresa: empresaSel, nome, grupo }) });
    await recarregarContas();
    return d.conta ?? null;
  }

  /** Cria uma analítica nova sob a titular corrente (só a contabilidade). */
  async function criarAnalitica(texto: string, contaId: string | null): Promise<Historico | null> {
    if (!contaId) throw new Error('Escolha a conta titular antes de criar a analítica.');
    const d = await chamar('/api/caixa/historicos', { method: 'POST', body: JSON.stringify({ empresa: empresaSel, texto, contaId }) });
    await recarregarContas();
    return d.historico ?? null;
  }

  // ---------------------------------------------------------------- derivados
  /** Saldo corrido linha a linha, partindo do que veio do mês anterior. */
  const linhas = useMemo(() => {
    const saida: { l: Lancamento; saldo: number }[] = [];
    for (const l of dados?.lancamentos ?? []) {
      const anterior = saida.length ? saida[saida.length - 1].saldo : (dados?.saldoTransportado ?? 0);
      saida.push({ l, saldo: anterior + l.entrada - l.saida - l.juros - l.multa });
    }
    return saida;
  }, [dados]);

  // Sugestão para o novo lançamento: (a) analítica citada, (b) conferidos da empresa;
  // (c) a da IA, se o usuário pediu e o que está digitado não mudou desde então.
  const consultaNova = useMemo(() => consultaDe(novo), [novo]);
  const chaveNova = chaveConsulta(consultaNova);
  const resultadoSug = useMemo(
    () => (modelo ? sugerirConta(consultaNova, { exemplos: modelo.exemplos, contas, analiticas: historicos }) : null),
    [modelo, consultaNova, contas, historicos],
  );
  const sugestaoNova: SugestaoTela | null =
    (sugIa && sugIa.chave === chaveNova ? sugIa.sugestao : null) ?? resultadoSug?.sugestao ?? null;
  const faixaSugestao = (
    <FaixaSugestao sugestao={sugestaoNova} contas={contas} escolha={novo}
      podeIa={!!modelo?.ia && !!resultadoSug?.precisaIa && !sugestaoNova}
      perguntando={perguntandoIa} onUsar={usarSugestao} onPerguntarIa={perguntarIa} />
  );

  // Revisão: alertas por lançamento do mês aberto, para o selo, o filtro e a ordem.
  const pedemAtencao = linhas.filter((x) => revisao?.porLancamento[x.l.id]).length;
  const linhasVisiveis = useMemo(() => {
    const base = soAtencao ? linhas.filter((x) => revisao?.porLancamento[x.l.id]) : linhas;
    if (ordem !== 'risco') return base;
    // sort estável: empate mantém a ordem do livro
    return [...base].sort((a, b) => (revisao?.porLancamento[b.l.id]?.risco ?? 0) - (revisao?.porLancamento[a.l.id]?.risco ?? 0));
  }, [linhas, soAtencao, ordem, revisao]);

  // Saldo negativo só avisa, não bloqueia — decisão dela.
  const negativo = linhas.find((x) => x.saldo < 0);
  const semConta = linhas.filter((x) => !x.l.contaId).length;
  const aConferir = linhas.filter((x) => !x.l.conferidoEm).length;
  const minhaEmpresa = empresas.find((e) => e.id === (me?.role === 'cliente' ? me.empresa : empresaSel))?.nome;
  const nomeEmpresa = (id: string) => empresas.find((e) => e.id === id)?.nome ?? id;
  // Empresa que identifica o pagador (clínica/dentista) ganha duas colunas na
  // entrada: Cliente/Paciente e CPF/CNPJ — para Carnê-Leão/DMED. As demais não.
  const identificaPagador = !!empresas.find((e) => e.id === empresaSel)?.identificaPagador;
  const nCols = identificaPagador ? 12 : 10; // colunas da tabela (com pagador, +2)
  const arquivada = !!empresas.find((e) => e.id === empresaSel)?.arquivadaEm;
  // Mês fechado — ou anterior a um fechado, cujo saldo é o transportado dele: nada é
  // lançado, editado nem excluído (a rota recusa com 409). Os meses fecham em ordem.
  const posteriorFechado = confirmados.find((m) => m > mes) ?? null;
  const fechado = !!dados?.confirmado || posteriorFechado !== null;
  const anterioresAbertos = Array.from({ length: mes - 1 }, (_, i) => i + 1).filter((m) => !confirmados.includes(m));
  const reabreJunto = confirmados.filter((m) => m > mes);
  const podeLerDoc = !!iaDoc?.disponivel && !arquivada && !!empresaSel && !fechado;
  // A leitura sem IA não tem trava de IA: basta poder lançar na empresa (e o mês estar aberto).
  const podeLerNota = !arquivada && !!empresaSel && !fechado;
  const fechamentoDoMes = fechamentos?.fechados.find((f) => f.mes === mes);
  const historicoDoMes = (fechamentos?.historico ?? []).filter((h) => h.mes === mes);

  // O rascunho lido de um documento, acima do formulário (tabela e celular).
  const duplicados = rascunho?.duplicados ?? [];
  const linkDocumento = rascunho?.documento && (
    <a href={`/api/documentos/arquivo?id=${encodeURIComponent(rascunho.documento.id)}`}
      className="font-medium text-primaria-texto underline underline-offset-2">{rascunho.documento.nome}</a>
  );
  const avisoRascunho = rascunho && (rascunho.origem === 'ia' ? (
    <Aviso tom="info" titulo="Rascunho lido pela IA — confira antes de lançar"
      acao={<Botao tamanho="sm" variante="fantasma" onClick={descartarRascunho}>Descartar</Botao>}>
      <p>
        Do documento {linkDocumento}
        {' '}(confiança da leitura: {Math.round(rascunho.confianca * 100)}%). Confira data, valor, conta e complemento;
        ao lançar, o documento fica anexado ao lançamento.
      </p>
      {rascunho.avisos.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {rascunho.avisos.map((a) => <li key={a}>{a}</li>)}
        </ul>
      )}
    </Aviso>
  ) : (
    <Aviso tom={duplicados.length ? 'aviso' : 'info'}
      titulo={duplicados.length ? `${rascunho.titulo ?? 'Este documento'}: já existe lançamento com ele — confira antes de lançar de novo` : `Rascunho de ${rascunho.titulo ?? 'documento'} — confira antes de lançar`}
      acao={<Botao tamanho="sm" variante="fantasma" onClick={descartarRascunho}>Descartar</Botao>}>
      {duplicados.length > 0 && (
        <ul className="mb-1 list-disc space-y-0.5 pl-5 font-medium">
          {duplicados.map((d, i) => (
            <li key={`${d.data}-${i}`}>Lançado em {diaMes(d.data)}/{d.data.slice(0, 4)}{d.complemento ? ` · ${d.complemento}` : ''} · R$ {dinheiro(d.valor)}</li>
          ))}
        </ul>
      )}
      <p>
        {rascunho.documento ? <>Lido sem IA do documento {linkDocumento}; ao lançar, ele fica anexado.</> : 'Lido sem IA do código do boleto.'}
        {' '}Confira data, valor, conta e complemento.
        {rascunho.duplicidadeVerificada === false && !duplicados.length && ' Não deu para conferir se já foi lançado.'}
      </p>
      {(rascunho.avisos.length > 0 || (rascunho.detalhes?.length ?? 0) > 0) && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {rascunho.avisos.map((a) => <li key={a} className="font-medium">{a}</li>)}
          {rascunho.detalhes?.map((a) => <li key={a} className="text-tinta-suave">{a}</li>)}
        </ul>
      )}
    </Aviso>
  ));

  if (erro && faltaMigracao(erro)) return <BancoIncompleto erro={erro} />;

  const mesAberto = `${MESES[mes - 1]}/${ano}`;

  return (
    <div className="text-sm">
      <CabecalhoPagina titulo="Livro Caixa"
        subtitulo={ehGestor ? 'Movimento do caixa das empresas-clientes' : `Movimento do caixa — ${minhaEmpresa ?? 'sua empresa'}`}
        abas={<AbasCaixa ativa="lancamentos" ehGestor={ehGestor} />}
        acoes={<>
          {ehGestor && (
            <Selecao aria-label="Empresa" largura="w-56 max-w-full" valor={empresaSel} onChange={setEmpresaSel}
              placeholder="— nenhuma empresa —"
              opcoes={empresas.map((e) => ({ valor: e.id, rotulo: e.nome }))} />
          )}
          <Selecao aria-label="Exercício" largura="w-24" busca={false} valor={String(ano)} onChange={(v) => irPara(Number(v), mes)}
            opcoes={anos.map((a) => ({ valor: String(a), rotulo: String(a) }))} />
          {podeLerNota && (
            <Botao variante="secundaria" icone={<IconeDocumento />} onClick={() => setLendoNota(true)}>
              Ler nota ou boleto
            </Botao>
          )}
          {podeLerDoc && (
            <Botao variante="secundaria" icone={<IconeSugestao />} onClick={() => setLendoDoc(true)}>
              Ler documento
            </Botao>
          )}
          {ehGestor && (
            <Botao variante={mostrarDocs ? 'tonal' : 'secundaria'} aria-expanded={mostrarDocs} aria-controls="painel-documentos"
              icone={<IconeDocumento />} onClick={() => setMostrarDocs((v) => !v)}>
              Documentos
            </Botao>
          )}
        </>} />

      <Toasts>
        {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
        {msg && <Toast onFechar={() => setMsg(null)}>{msg}</Toast>}
        {desfazer && (
          <Toast tom="info" onFechar={() => setDesfazer(null)}
            acao={<Botao tamanho="sm" variante="tonal" icone={<IconeDesfazer size={15} />} onClick={desfazerExclusao}>Desfazer</Botao>}>
            Lançamento excluído — {diaMes(desfazer.data)} · {desfazer.historico}.
          </Toast>
        )}
        {desfazerRascunho && (
          <Toast tom="info" onFechar={() => setDesfazerRascunho(null)}
            acao={<Botao tamanho="sm" variante="tonal" icone={<IconeDesfazer size={15} />} onClick={descartarRascunho}>Desfazer</Botao>}>
            Rascunho preenchido com {desfazerRascunho.documento ? `o documento ${desfazerRascunho.documento.nome}` : (desfazerRascunho.titulo ?? 'o documento')}. Confira e clique em Lançar.
          </Toast>
        )}
      </Toasts>

      <Conteudo>
        {falhaEmpresas && (
          <FalhaCarregamento titulo="Não foi possível carregar as empresas." onTentar={carregarEmpresas}>{falhaEmpresas}</FalhaCarregamento>
        )}
        {falhaCarga && (
          <FalhaCarregamento titulo="Não foi possível carregar o movimento." onTentar={() => { void recarregar(); }} tentando={carregando}>
            {falhaCarga}
          </FalhaCarregamento>
        )}
        <FaixaArquivada empresa={empresas.find((e) => e.id === empresaSel)} />
        {empresaSel && <LimiteFaturamento empresaId={empresaSel} />}
        {ehGestor && mostrarDocs && (
          <PainelDocumentos
            empresaId={empresaSel} ano={ano} termo={termo}
            onErro={setErro} onMsg={setMsg}
            onSalvo={() => { void recarregar(); }}
            iaDoc={iaDoc} onAlternarIaDoc={alternarIaDoc} arquivada={arquivada}
          />
        )}

        {ehGestor && pendencias.length > 0 && (
          <Aviso tom="info" titulo="Lançamentos novos para conferir">
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {pendencias.map((p) => (
                <Botao key={p.empresaId} tamanho="sm" onClick={() => { setEmpresaSel(p.empresaId); irPara(ano, p.ultimo.mes); }}>
                  {nomeEmpresa(p.empresaId)}
                  <span className="rounded-full bg-primaria px-1.5 text-[11px] font-semibold leading-5 text-sobre-primaria">{p.pendentes}</span>
                </Botao>
              ))}
            </div>
          </Aviso>
        )}

        {/* Meses do exercício */}
        <nav aria-label="Meses do exercício"
          className="grid grid-cols-6 gap-1 rounded-xl border border-borda bg-superficie p-1.5 shadow-cartao md:grid-cols-12">
          {MESES.map((rotulo, i) => {
            const m = i + 1;
            const r = resumo.find((x) => x.mes === m);
            const temMovimento = r && (r.entradas > 0 || r.saidas > 0);
            const confirmado = confirmados.includes(m);
            return (
              <button key={m} type="button" onClick={() => irPara(ano, m)} aria-current={m === mes ? 'true' : undefined}
                aria-label={`${MESES_LONGOS[i]}${confirmado ? ' — fechado' : ''}${temMovimento ? '' : ' — sem movimento'}`}
                className={`relative flex h-11 items-center justify-center gap-1 rounded-lg text-xs font-semibold uppercase tracking-wide transition-colors md:h-9 ${
                  m === mes ? 'bg-primaria text-sobre-primaria shadow-cartao'
                    : temMovimento ? 'text-tinta hover:bg-superficie-realce'
                    : 'font-medium text-tinta-fraca hover:bg-superficie-realce hover:text-tinta'
                }`}>
                {rotulo}
                {confirmado && <IconeCadeado size={12} className={m === mes ? 'text-sobre-primaria' : 'text-sucesso'} />}
              </button>
            );
          })}
        </nav>

        {/* Resumo do mês */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Indicador rotulo="Saldo transportado" valor={dinheiro(dados?.saldoTransportado ?? 0)}
            tom={(dados?.saldoTransportado ?? 0) < 0 ? 'perigo' : 'neutro'} />
          <Indicador rotulo="Entradas do mês" valor={dinheiro(dados?.entradas ?? 0)} tom="sucesso" />
          <Indicador rotulo="Saídas do mês" valor={dinheiro(dados?.saidas ?? 0)} tom="perigo" />
          <Indicador rotulo="Saldo do mês" valor={dinheiro(dados?.saldoFinal ?? 0)} destaque
            tom={(dados?.saldoFinal ?? 0) < 0 ? 'perigo' : 'neutro'} />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-tinta-suave">
          {/* Saldo inicial só na aba de janeiro: é ele que abre o exercício e se
              propaga como "saldo transportado" nos demais meses. */}
          {mes === 1 && (
            <span className="inline-flex items-center gap-1">
              Saldo inicial do exercício: <strong className="font-semibold text-tinta">{dinheiro(saldoInicial)}</strong>
              {/* Com mês fechado o saldo inicial não muda (mudaria o saldo transportado dele). */}
              {ehGestor && confirmados.length === 0 && (
                <BotaoIcone rotulo="Editar saldo inicial" tom="primaria" tamanho="sm" onClick={() => setEditandoSaldo(true)}>
                  <IconeLapis size={14} />
                </BotaoIcone>
              )}
            </span>
          )}
          {fechado && <Selo tom="sucesso"><IconeCadeado size={12} /> Mês fechado</Selo>}
          {ehGestor && aConferir > 0 && (
            <Selo tom="aviso"><IconeSino size={12} /> {aConferir} lançamento(s) a conferir neste mês</Selo>
          )}
          {ehGestor && (dados?.confirmado || posteriorFechado === null) && (
            <span className="sm:ml-auto" data-dica={!dados?.confirmado && anterioresAbertos.length
              ? `Os meses fecham em ordem: feche antes ${anterioresAbertos.map((m) => MESES_LONGOS[m - 1]).join(', ')}`
              : dados?.confirmado ? 'Reabrir o mês — o motivo fica registrado' : 'Fechar o mês — libera o resumo ao cliente e trava os lançamentos'}>
              <Botao tamanho="sm" variante={dados?.confirmado ? 'secundaria' : 'sucesso'}
                onClick={() => (dados?.confirmado ? setReabrindo(true) : setFechando(true))}
                disabled={!dados || arquivada || (!dados.confirmado && anterioresAbertos.length > 0)}
                icone={dados?.confirmado ? <IconeDesfazerConfirmacao size={15} /> : <IconeConfirmar size={15} />}>
                {dados?.confirmado ? 'Reabrir o mês' : 'Fechar o mês'}
              </Botao>
            </span>
          )}
        </div>

        {fechado && (
          <Aviso tom="info" titulo={dados?.confirmado ? `${mesAberto} está fechado` : `${mesAberto} está travado`}>
            <p>
              {!dados?.confirmado && posteriorFechado !== null
                ? <>{MESES_LONGOS[posteriorFechado - 1]}/{ano} já está fechado e o saldo dele vem deste mês. </>
                : fechamentoDoMes ? <>Fechado por {fechamentoDoMes.por} em {quandoBR(fechamentoDoMes.em)}. </> : null}
              Nenhum lançamento deste mês pode ser criado, alterado ou excluído.{' '}
              {ehGestor
                ? `Para corrigir, use “Reabrir o mês”${!dados?.confirmado && posteriorFechado !== null ? ` em ${MESES_LONGOS[posteriorFechado - 1]}` : ''} e informe o motivo — ele fica registrado no histórico.`
                : 'Se algo precisa mudar, fale com a contabilidade: só ela reabre o mês.'}
            </p>
          </Aviso>
        )}
        {ehGestor && historicoDoMes.length > 0 && (
          <details className="rounded-xl border border-borda bg-superficie px-4 py-3 text-[13px]">
            <summary className="cursor-pointer font-medium text-tinta">Histórico de fechamento de {mesAberto} ({historicoDoMes.length})</summary>
            <ul className="mt-2 space-y-1.5 text-tinta-suave">
              {historicoDoMes.map((h, i) => (
                <li key={`${h.em}-${i}`}>
                  <Selo tom={h.acao === 'fechou' ? 'sucesso' : 'aviso'}>{h.acao === 'fechou' ? 'fechou' : 'reabriu'}</Selo>{' '}
                  {h.por} em {quandoBR(h.em)}{h.motivo ? <> — <span className="text-tinta">“{h.motivo}”</span></> : null}
                </li>
              ))}
            </ul>
          </details>
        )}
        {ehGestor && fechamentos && !fechamentos.historicoDisponivel && fechado && (
          <p className="text-xs text-tinta-suave">O histórico de fechar e reabrir depende de uma atualização do banco (migração 0034).</p>
        )}

        {negativo && (
          <Aviso tom="aviso">
            O saldo do caixa fica negativo em {diaMes(negativo.l.data)} ({dinheiro(negativo.saldo)}). Confira os
            lançamentos — o sistema não bloqueia, só avisa.
          </Aviso>
        )}
        {semConta > 0 && (
          <p className="text-xs font-medium text-aviso">
            {semConta} lançamento(s) sem conta. Só faz sentido em depósito ou retirada da conta corrente.
          </p>
        )}

        {/* Revisão antes da conferência (só a contabilidade): o que o exercício pede
            de atenção, e o filtro/ordem da tabela do mês. Só alerta, nunca bloqueia. */}
        {ehGestor && revisao && revisao.gerais.length > 0 && (
          <Aviso tom="aviso" titulo="Revisão do exercício">
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {revisao.gerais.map((g, i) => <li key={`${g.codigo}-${g.mes ?? i}`}>{g.motivo}</li>)}
            </ul>
          </Aviso>
        )}
        {ehGestor && revisao && linhas.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-tinta-suave">
            <Alternador checked={soAtencao} onChange={(e) => setSoAtencao(e.target.checked)} disabled={pedemAtencao === 0 && !soAtencao}>
              Só os que pedem atenção
            </Alternador>
            <Selecao aria-label="Ordem dos lançamentos" largura="w-52" busca={false} valor={ordem}
              onChange={(v) => setOrdem(v === 'risco' ? 'risco' : 'livro')}
              opcoes={[{ valor: 'livro', rotulo: 'Ordem do livro' }, { valor: 'risco', rotulo: 'Maior risco primeiro' }]} />
            <span>
              {pedemAtencao === 0 ? 'A revisão não viu nada fora do comum neste mês.'
                : `${pedemAtencao} lançamento(s) deste mês pede(m) atenção — passe o mouse no selo para ver o motivo.`}
            </span>
          </div>
        )}

        {/* Novo lançamento — no celular o formulário vem empilhado, fora da tabela. Mês fechado: sem formulário. */}
        {!fechado && <Cartao className="p-4 md:hidden">
          <h2 className="mb-3 text-[15px] font-semibold text-tinta">Novo lançamento</h2>
          {avisoRascunho && <div className="mb-3">{avisoRascunho}</div>}
          <div className="grid grid-cols-2 gap-3" data-campo-lancamento="novo">
            <Celulas empilhado campos={novo} setCampos={mudarNovo} contas={contas} historicos={historicos}
              podeCriar={ehGestor} onCriar={criarConta} onCriarAnalitica={criarAnalitica} identificaPagador={identificaPagador}
              erro={erroCampo?.onde === 'novo' ? erroCampo : null} />
          </div>
          <div className="mt-3 empty:hidden">{faixaSugestao}</div>
          <Marcacao type="checkbox" className="mt-3" checked={cheque} onChange={(e) => setCheque(e.target.checked)}>
            Pagamento em cheque — gera também a retirada da conta corrente (dois lançamentos)
          </Marcacao>
          <Botao variante="primaria" tamanho="lg" className="mt-4 w-full" onClick={() => { void lancar(); }} carregando={salvando} disabled={!empresaSel}>
            Lançar
          </Botao>
          <p className="mt-3 text-xs text-tinta-suave">
            Depósito em banco é <strong>saída</strong> do caixa; retirada é <strong>entrada</strong>.
          </p>
        </Cartao>}

        {avisoRascunho && <div className="max-md:hidden">{avisoRascunho}</div>}

        {/* Livro do mês */}
        <div className={tb.moldura}>
          <table className={`${tb.tabela} text-[13px]`}>
            <caption className="sr-only">Lançamentos de {mesAberto}</caption>
            <thead className={tb.cabeca}>
              <tr>
                <th className={tb.th}>Data</th>
                <th className={tb.th}>Complemento</th>
                {identificaPagador && <th className={tb.th}>Cliente/Paciente</th>}
                {identificaPagador && <th className={tb.th}>CPF/CNPJ</th>}
                <th className={tb.th}>Conta Titular</th>
                <th className={tb.th}>Conta Analítica</th>
                <th className={`${tb.th} text-right`}>Entrada</th>
                <th className={`${tb.th} text-right`}>Saída</th>
                <th className={`${tb.th} text-right`}>Juros</th>
                <th className={`${tb.th} text-right`}>Multa</th>
                <th className={`${tb.th} text-right`}>Saldo</th>
                <th className={tb.th}><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody className="[&>tr]:border-b [&>tr]:border-borda/70">
              <tr className="text-tinta-suave">
                <td className={tb.td} colSpan={nCols - 2}>Saldo transportado do mês anterior</td>
                <td className={`${tb.td} ${tb.num} font-medium`}>{dinheiro(dados?.saldoTransportado ?? 0)}</td>
                <td></td>
              </tr>

              {linhasVisiveis.map(({ l, saldo }) => editandoId === l.id ? (
                <tr key={l.id} className="bg-primaria-suave" data-campo-lancamento="edicao">
                  <Celulas campos={edicao} setCampos={mudarEdicao} contas={contas} historicos={historicos}
                    podeCriar={ehGestor} onCriar={criarConta} onCriarAnalitica={criarAnalitica} identificaPagador={identificaPagador}
                    erro={erroCampo?.onde === 'edicao' ? erroCampo : null} />
                  <td className={`${tb.td} ${tb.num} text-tinta-fraca`}>—</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right">
                    <Botao tamanho="sm" variante="primaria" onClick={salvarEdicao} carregando={salvando}>Salvar</Botao>
                    <Botao tamanho="sm" variante="fantasma" className="ml-1" onClick={() => setEditandoId(null)}>Cancelar</Botao>
                  </td>
                </tr>
              ) : (
                <tr key={l.id} className={`transition-colors ${l.conferidoEm ? 'hover:bg-superficie-realce/60' : 'bg-primaria-suave/70 hover:bg-primaria-realce/60'}`}>
                  <td className={`${tb.td} whitespace-nowrap`}>{diaMes(l.data)}</td>
                  <td className={`${tb.td} text-tinta-suave`}>
                    {l.complemento}
                    {l.documentoId && (
                      <a href={`/api/documentos/arquivo?id=${encodeURIComponent(l.documentoId)}`}
                        aria-label="Abrir o documento anexo" data-dica="Documento anexo"
                        className="ml-1.5 inline-flex h-11 w-11 items-center justify-center rounded-md align-middle text-primaria-texto transition-colors hover:bg-superficie-realce sm:h-6 sm:w-6">
                        <IconeDocumento size={14} />
                      </a>
                    )}
                  </td>
                  {identificaPagador && <td className={`${tb.td} text-tinta-suave`}>{l.pagadorNome}</td>}
                  {identificaPagador && (
                    <td className={`${tb.td} whitespace-nowrap ${
                      l.pagadorDocumento && !documentoValido(l.pagadorDocumento) ? 'font-medium text-aviso' : 'text-tinta-suave'
                    }`}
                      data-dica={l.pagadorDocumento && !documentoValido(l.pagadorDocumento) ? 'CPF/CNPJ com dígito inválido — confira' : undefined}>
                      {formatarDocumento(l.pagadorDocumento)}
                    </td>
                  )}
                  <td className={`${tb.td} ${l.contaId ? 'text-tinta-suave' : 'font-medium text-aviso'}`}>
                    {rotuloConta(contas, l.contaId)}
                  </td>
                  <td className={`${tb.td} text-tinta`}>
                    {l.historico}
                    {ehGestor && <SeloRevisao revisao={revisao?.porLancamento[l.id]} />}
                  </td>
                  <td className={`${tb.td} ${tb.num} text-sucesso`}>{l.entrada > 0 ? dinheiro(l.entrada) : ''}</td>
                  <td className={`${tb.td} ${tb.num} text-perigo`}>{l.saida > 0 ? dinheiro(l.saida) : ''}</td>
                  <td className={`${tb.td} ${tb.num} text-perigo`}>{l.juros > 0 ? dinheiro(l.juros) : ''}</td>
                  <td className={`${tb.td} ${tb.num} text-perigo`}>{l.multa > 0 ? dinheiro(l.multa) : ''}</td>
                  <td className={`${tb.td} ${tb.num} font-semibold ${saldo < 0 ? 'text-perigo' : 'text-tinta'}`}>{dinheiro(saldo)}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-right">
                    {ehGestor && (
                      <BotaoIcone tamanho="sm" tom={l.conferidoEm ? 'sucesso' : 'apagado'} aria-pressed={!!l.conferidoEm}
                        rotulo={l.conferidoEm ? 'Conferido' : 'Conferir'}
                        title={l.conferidoEm ? `Conferido por ${l.conferidoPor} — clique para desmarcar` : 'Marcar como conferido'}
                        onClick={() => conferir(l, !l.conferidoEm)}>
                        <IconeCheck size={15} />
                      </BotaoIcone>
                    )}
                    {!fechado && <BotaoIcone tamanho="sm" tom="primaria" rotulo="Editar lançamento" title="Editar" onClick={() => {
                      setEditandoId(l.id);
                      const hMatch = historicos.find((h) => h.texto === l.historico && h.contaId === l.contaId)
                        ?? historicos.find((h) => h.texto === l.historico);
                      setEdicao({
                        data: l.data, historico: l.historico, historicoId: hMatch?.id ?? null,
                        complemento: l.complemento ?? '',
                        contaId: l.contaId, entrada: l.entrada > 0 ? String(l.entrada) : '',
                        saida: l.saida > 0 ? String(l.saida) : '',
                        juros: l.juros > 0 ? String(l.juros) : '',
                        multa: l.multa > 0 ? String(l.multa) : '',
                        pagadorNome: l.pagadorNome ?? '', pagadorDocumento: l.pagadorDocumento ?? '',
                      });
                    }}>
                      <IconeLapis size={15} />
                    </BotaoIcone>}
                    {!fechado && (
                      <BotaoIcone tamanho="sm" tom="perigo" rotulo="Excluir lançamento" title="Excluir" onClick={() => setAExcluir(l)}>
                        <IconeExcluir size={15} />
                      </BotaoIcone>
                    )}
                  </td>
                </tr>
              ))}

              {carregando && !dados && [0, 1, 2].map((i) => (
                <tr key={`esqueleto-${i}`}>
                  <td colSpan={nCols} className="px-3 py-2.5"><Esqueleto className="h-4 w-full" /></td>
                </tr>
              ))}

              {!carregando && linhas.length > 0 && linhasVisiveis.length === 0 && (
                <tr><td colSpan={nCols}>
                  <EstadoVazio moldura={false} titulo="Nenhum lançamento deste mês pede atenção"
                    descricao="A revisão não encontrou nada a conferir com cuidado aqui." />
                </td></tr>
              )}

              {!carregando && linhas.length === 0 && (
                <tr><td colSpan={nCols}>
                  <EstadoVazio moldura={false} titulo={`Nenhum lançamento em ${mesAberto}`}
                    descricao={fechado ? 'O mês está fechado.' : 'Comece pelo formulário de novo lançamento.'} />
                </td></tr>
              )}
            </tbody>

            <tfoot>
              {fechado ? (
                <tr className="bg-superficie-suave max-md:hidden">
                  <td className={`${tb.td} font-medium text-tinta-suave`} colSpan={nCols - 2}>Saldo do mês</td>
                  <td className={`${tb.td} ${tb.num} font-semibold ${(dados?.saldoFinal ?? 0) < 0 ? 'text-perigo' : 'text-tinta'}`}>{dinheiro(dados?.saldoFinal ?? 0)}</td>
                  <td></td>
                </tr>
              ) : <>
              <tr className="bg-superficie-suave max-md:hidden" data-campo-lancamento="novo">
                <Celulas campos={novo} setCampos={mudarNovo} contas={contas} historicos={historicos}
                  podeCriar={ehGestor} onCriar={criarConta} onCriarAnalitica={criarAnalitica} identificaPagador={identificaPagador}
                  erro={erroCampo?.onde === 'novo' ? erroCampo : null} />
                <td className={`${tb.td} ${tb.num} font-semibold ${(dados?.saldoFinal ?? 0) < 0 ? 'text-perigo' : 'text-tinta'}`}>{dinheiro(dados?.saldoFinal ?? 0)}</td>
                <td className="px-2 py-1 text-right">
                  <Botao tamanho="sm" variante="primaria" onClick={() => { void lancar(); }} carregando={salvando} disabled={!empresaSel}>
                    Lançar
                  </Botao>
                </td>
              </tr>
              {sugestaoNova || resultadoSug?.precisaIa ? (
                <tr className="bg-superficie-suave max-md:hidden">
                  <td colSpan={nCols} className="px-3 pt-1">{faixaSugestao}</td>
                </tr>
              ) : null}
              <tr className="bg-superficie-suave max-md:hidden">
                <td colSpan={nCols} className="px-3 pb-3 pt-1 text-xs text-tinta-suave">
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5">
                    <Marcacao type="checkbox" className="text-xs" checked={cheque} onChange={(e) => setCheque(e.target.checked)}>
                      Pagamento em cheque — gera também a retirada da conta corrente (dois lançamentos)
                    </Marcacao>
                    <span>
                      Depósito em banco é <strong>saída</strong> do caixa; retirada é <strong>entrada</strong>.
                    </span>
                  </div>
                </td>
              </tr>
              </>}
              {/* No celular a linha de lançamento sai da tabela; o saldo final fica. */}
              <tr className="bg-superficie-suave md:hidden">
                <td className={`${tb.td} font-medium text-tinta-suave`} colSpan={nCols - 2}>Saldo do mês</td>
                <td className={`${tb.td} ${tb.num} font-semibold ${(dados?.saldoFinal ?? 0) < 0 ? 'text-perigo' : 'text-tinta'}`}>{dinheiro(dados?.saldoFinal ?? 0)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {carregando && <Carregando />}
      </Conteudo>

      {aExcluir && (
        <DialogoConfirmacao
          titulo="Excluir lançamento"
          mensagem={
            <>Deseja realmente excluir o lançamento de <strong>{diaMes(aExcluir.data)}</strong> — {aExcluir.historico}
              {' '}({aExcluir.entrada > 0 ? `entrada de ${dinheiro(aExcluir.entrada)}` : `saída de ${dinheiro(aExcluir.saida)}`})?
              {' '}Dá para desfazer logo em seguida.</>
          }
          onConfirmar={confirmarExclusao}
          onCancelar={() => setAExcluir(null)}
        />
      )}

      {lendoDoc && (
        <LerDocumento empresaId={empresaSel} ano={ano} mes={mes}
          onLido={(r) => aplicarProposta(r)} onFechar={() => setLendoDoc(false)} />
      )}

      {lendoNota && (
        <LerNota empresaId={empresaSel} ano={ano} mes={mes}
          onLido={aplicarLeitura} onFechar={() => setLendoNota(false)} />
      )}

      {confirmarDuplicado && rascunho && (
        <DialogoConfirmacao textoConfirmar="Lançar mesmo assim"
          titulo={`${rascunho.titulo ?? 'Este documento'} já está no livro`}
          mensagem={<>Já há {duplicados.length === 1 ? 'um lançamento' : `${duplicados.length} lançamentos`} deste documento
            ({duplicados.map((d) => `${diaMes(d.data)}/${d.data.slice(0, 4)}, R$ ${dinheiro(d.valor)}`).join('; ')}).
            Lançar de novo duplica o valor no caixa. Lance só se for outro pagamento de verdade.</>}
          onConfirmar={() => { void lancar(true); }}
          onCancelar={() => setConfirmarDuplicado(false)} />
      )}

      {fechando && (
        <DialogoConfirmacao perigo={false} titulo={`Fechar ${mesAberto}?`} textoConfirmar="Fechar o mês"
          mensagem={<>O resumo e o Demonstrativo do mês ficam visíveis ao cliente e os lançamentos de {mesAberto}{' '}
            <strong>ficam travados</strong>: ninguém cria, altera ou exclui — nem a contabilidade — até o mês ser reaberto com motivo.
            {aConferir > 0 ? <> Atenção: {aConferir} lançamento(s) ainda sem conferência.</> : null}</>}
          onConfirmar={fecharMes} onCancelar={() => setFechando(false)} />
      )}
      {reabrindo && (
        <DialogoTexto titulo={`Reabrir ${mesAberto}?`} textoConfirmar="Reabrir o mês" perigo
          descricao={<>Os lançamentos voltam a poder ser alterados e o resumo deixa de ficar visível ao cliente até o mês ser fechado de novo.
            {reabreJunto.length > 0 && <> Como o saldo deles vem deste mês, <strong>{reabreJunto.map((m) => MESES_LONGOS[m - 1]).join(', ')}</strong> também {reabreJunto.length > 1 ? 'reabrem' : 'reabre'}.</>}
            {' '}O motivo fica registrado no histórico, com o seu nome e a hora.</>}
          rotulo="Motivo da reabertura" placeholder="Ex.: o cliente lançou a venda do dia 30 em duplicidade."
          erroCurto="Escreva o motivo (pelo menos 5 letras)."
          onConfirmar={reabrirMes} onCancelar={() => setReabrindo(false)} />
      )}

      {editandoSaldo && (
        <DialogoValor
          titulo={`Saldo inicial do exercício de ${ano}`}
          descricao="Vem do encerramento do ano anterior. Aceita vírgula ou ponto."
          rotulo="Saldo inicial (R$)"
          valorInicial={dinheiro(saldoInicial)}
          onConfirmar={salvarSaldoInicial}
          onCancelar={() => setEditandoSaldo(false)}
        />
      )}
    </div>
  );
}

/**
 * A sugestão de conta do novo lançamento. Só mostra — preencher é o clique em
 * "Usar". Some quando a escolha do usuário já é a sugerida; quando ele escolheu
 * outra, continua visível (é um segundo olhar, não uma ordem).
 */
function FaixaSugestao({ sugestao, contas, escolha, podeIa, perguntando, onUsar, onPerguntarIa }: {
  sugestao: SugestaoTela | null; contas: Conta[]; escolha: Campos; podeIa: boolean; perguntando: boolean;
  onUsar: (s: SugestaoTela) => void; onPerguntarIa: () => void;
}) {
  const jaEscolheu = !!escolha.historico;
  const igual = !!sugestao && sugestao.historico === escolha.historico && (sugestao.contaId ?? null) === (escolha.contaId ?? null);
  if (sugestao && !igual) {
    const titular = sugestao.contaId ? rotuloConta(contas, sugestao.contaId) : 'sem conta titular';
    return (
      <div aria-live="polite"
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-primaria-borda bg-primaria-suave px-3 py-2 text-[13px] text-tinta">
        <IconeSugestao size={15} className="shrink-0 text-primaria-texto" />
        <span className="min-w-0 flex-1">
          {jaEscolheu ? 'O histórico sugere outra conta: ' : 'Sugestão: '}
          <strong className="font-semibold">{titular} › {sugestao.historico}</strong>
          <span className="text-tinta-suave"> — {sugestao.motivo}</span>
          {sugestao.origem === 'ia' && <Selo tom="primaria" className="ml-2">IA</Selo>}
        </span>
        <Botao tamanho="sm" variante="tonal" onClick={() => onUsar(sugestao)}>Usar</Botao>
      </div>
    );
  }
  if (podeIa && !jaEscolheu) {
    return (
      <div aria-live="polite" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-tinta-suave">
        <IconeSugestao size={15} className="shrink-0" />
        <span>O histórico desta empresa ainda não sabe classificar isso.</span>
        <Botao tamanho="sm" variante="fantasma" carregando={perguntando} onClick={onPerguntarIa}>
          Perguntar à IA
        </Botao>
      </div>
    );
  }
  return null;
}

const TOM_NIVEL: Record<NivelAlerta, Tom> = { alto: 'perigo', medio: 'aviso', baixo: 'neutro' };

/** Selo da revisão no lançamento: o rótulo do alerta mais grave; os motivos no balão (mouse e teclado). */
function SeloRevisao({ revisao }: { revisao: RevisaoLancamento | undefined }) {
  if (!revisao || revisao.alertas.length === 0) return null;
  const [primeiro, ...resto] = revisao.alertas; // já vêm do mais grave para o mais leve
  const motivos = revisao.alertas.map((a) => a.motivo).join(' · ');
  return (
    <span tabIndex={0} role="note" aria-label={`Pede atenção: ${motivos}`} data-dica={motivos}
      className={`${seloCls(TOM_NIVEL[primeiro.nivel])} ml-2 cursor-help align-middle`}>
      {primeiro.rotulo}{resto.length > 0 ? ` +${resto.length}` : ''}
    </span>
  );
}

// Altura à parte: 32 px na linha da tabela, 44 px no formulário do celular (alvo de toque).
const CAMPO_LINHA =
  'rounded-md border bg-superficie px-2 text-base text-tinta transition-colors placeholder:text-tinta-fraca focus:border-foco sm:text-[13px]';
const BORDA_CAMPO = 'border-borda-forte hover:border-tinta-suave';
const BORDA_ERRO = 'border-perigo';

/** Erro devolvido pela rota, já atribuído a um campo do formulário (ver `campoDoErro`). */
interface ErroCampo { campo: CampoLancamento; mensagem: string }

/**
 * Os campos editáveis do lançamento, iguais na linha nova e na linha em edição.
 * Por padrão saem como células (<td>) da tabela; com `empilhado`, como blocos
 * com rótulo visível (<label for>) — o formulário do celular.
 * `erro` pinta o campo, marca `aria-invalid` e liga a mensagem por `aria-describedby`.
 */
function Celulas({ campos, setCampos, contas, historicos, podeCriar, onCriar, onCriarAnalitica, identificaPagador, empilhado = false, erro = null }: {
  campos: Campos; setCampos: (c: Campos) => void; contas: Conta[]; historicos: Historico[];
  podeCriar: boolean; onCriar: (nome: string, grupo: string) => Promise<Conta | null>;
  onCriarAnalitica: (texto: string, contaId: string | null) => Promise<Historico | null>;
  identificaPagador: boolean; empilhado?: boolean; erro?: ErroCampo | null;
}) {
  const base = useId();
  const idDe = (c: string) => `${base}-${c}`;
  const idErro = `${base}-erro`;
  // Entrada e saída dividem a mensagem "informe o valor"; o cheque fala só da saída.
  const comErro = (c: CampoLancamento | 'entrada') =>
    !!erro && (erro.campo === c || (c === 'entrada' && erro.campo === 'valor') || (c === 'saida' && erro.campo === 'valor'));
  const aria = (c: CampoLancamento | 'entrada') =>
    comErro(c) ? { 'aria-invalid': true as const, 'aria-describedby': idErro } : {};
  const altura = empilhado ? 'h-11' : 'h-8';
  const borda = (c: CampoLancamento | 'entrada') => (comErro(c) ? BORDA_ERRO : BORDA_CAMPO);
  // Aviso, não trava: documento com dígito verificador inválido fica em âmbar.
  const docInvalido = !!campos.pagadorDocumento && !documentoValido(campos.pagadorDocumento);

  /** Trocar a titular limpa a analítica se ela deixou de pertencer à nova titular. */
  function escolherTitular(id: string | null) {
    const atual = campos.historicoId ? historicos.find((h) => h.id === campos.historicoId) : null;
    if (atual && atual.contaId !== id) {
      setCampos({ ...campos, contaId: id, historico: '', historicoId: null });
    } else {
      setCampos({ ...campos, contaId: id });
    }
  }

  /** Escolher a analítica preenche a titular à qual ela pertence (subgrupo dela). */
  function escolherAnalitica(h: Historico) {
    setCampos({ ...campos, historico: h.texto, historicoId: h.id, contaId: h.contaId ?? campos.contaId });
  }

  /**
   * Embrulha um campo: célula da tabela ou bloco com rótulo (celular). No celular o
   * rótulo é um <label for> de verdade — tocar nele leva ao campo. Na tabela o nome
   * acessível vem do `aria-label` do próprio campo (o cabeçalho da coluna é o visual).
   * A mensagem de erro, quando é deste campo, fica logo abaixo (celular) ou só para o
   * leitor de tela (tabela, onde o aviso aparece no topo).
   */
  const envolver = (campo: string, rotulo: string, conteudo: React.ReactNode, opcoes: { td?: string; largo?: boolean; erro?: boolean } = {}) => {
    const msg = opcoes.erro && erro ? (
      <span id={idErro} className={empilhado ? 'mt-1 block text-xs font-medium text-perigo' : 'sr-only'}>{erro.mensagem}</span>
    ) : null;
    return empilhado ? (
      <div key={campo} className={opcoes.largo ? 'col-span-2' : undefined}>
        <label htmlFor={idDe(campo)} className="mb-1 block text-xs font-medium text-tinta-suave">{rotulo}</label>
        {conteudo}
        {msg}
      </div>
    ) : (
      <td key={campo} className={`px-1 py-1 align-middle ${opcoes.td ?? ''}`}>{conteudo}{msg}</td>
    );
  };
  // No celular todo campo ocupa a largura do bloco; na tabela cada um tem a sua.
  const larg = (naTabela: string) => (empilhado ? 'w-full' : naTabela);
  // A mensagem de "informe o valor" mora uma vez só, embaixo da Entrada.
  const erroEm = (c: CampoLancamento | 'entrada') =>
    !!erro && (erro.campo === c || (c === 'entrada' && erro.campo === 'valor'));

  return (
    <>
      {envolver('data', 'Data',
        <input id={idDe('data')} type="date" aria-label={empilhado ? undefined : 'Data'} value={campos.data}
          onChange={(e) => setCampos({ ...campos, data: e.target.value })} {...aria('data')}
          className={`${CAMPO_LINHA} ${altura} ${borda('data')} ${larg('w-full min-w-[8.5rem]')}`} />, { erro: erroEm('data') })}
      {envolver('complemento', empilhado ? 'Complemento (o que foi)' : 'Complemento',
        <input id={idDe('complemento')} aria-label={empilhado ? undefined : 'Complemento'} value={campos.complemento}
          onChange={(e) => setCampos({ ...campos, complemento: e.target.value })}
          placeholder={empilhado ? 'Ex.: conta de luz de março' : 'Complemento'} className={`${CAMPO_LINHA} ${altura} ${BORDA_CAMPO} ${larg('w-full min-w-32')}`} />)}
      {identificaPagador && envolver('pagador', 'Cliente/Paciente',
        <input id={idDe('pagador')} aria-label={empilhado ? undefined : 'Cliente ou paciente'} value={campos.pagadorNome}
          onChange={(e) => setCampos({ ...campos, pagadorNome: e.target.value })} autoComplete="off"
          placeholder="Cliente/Paciente" className={`${CAMPO_LINHA} ${altura} ${BORDA_CAMPO} ${larg('w-full min-w-36')}`} />)}
      {identificaPagador && envolver('documento', 'CPF/CNPJ',
        <input id={idDe('documento')} aria-label={docInvalido ? 'CPF ou CNPJ — dígito inválido, confira' : empilhado ? undefined : 'CPF ou CNPJ'}
          value={campos.pagadorDocumento} onChange={(e) => setCampos({ ...campos, pagadorDocumento: e.target.value })}
          inputMode="numeric" autoComplete="off" placeholder="CPF/CNPJ"
          data-dica={docInvalido ? 'CPF/CNPJ com dígito inválido — confira (não bloqueia)' : undefined}
          className={`${CAMPO_LINHA} ${altura} ${larg('w-full min-w-32')} ${docInvalido ? 'border-aviso bg-aviso-suave' : BORDA_CAMPO}`} />)}
      {envolver('titular', 'Conta Titular',
        <SeletorConta id={idDe('titular')} contas={contas} valor={campos.contaId} compacto={!empilhado}
          onEscolher={escolherTitular} invalido={comErro('titular')} descritoPor={comErro('titular') ? idErro : undefined}
          podeCriar={podeCriar} onCriar={onCriar} />, { td: 'min-w-48', largo: true, erro: erroEm('titular') })}
      {envolver('analitica', 'Conta Analítica',
        <SeletorAnalitica id={idDe('analitica')} historicos={historicos} valor={campos.historico || null} titularId={campos.contaId} compacto={!empilhado}
          onEscolher={escolherAnalitica} invalido={comErro('analitica')} descritoPor={comErro('analitica') ? idErro : undefined}
          podeCriar={podeCriar} onCriar={(texto) => onCriarAnalitica(texto, campos.contaId)} />, { td: 'min-w-44', largo: true, erro: erroEm('analitica') })}
      {/* entrada e saída se excluem: digitar numa apaga a outra */}
      {envolver('entrada', 'Entrada (recebi)',
        <input id={idDe('entrada')} inputMode="decimal" autoComplete="off" aria-label={empilhado ? undefined : 'Entrada'} value={campos.entrada} placeholder="0,00"
          onChange={(e) => setCampos({ ...campos, entrada: e.target.value, saida: e.target.value ? '' : campos.saida })} {...aria('entrada')}
          className={`${CAMPO_LINHA} ${altura} ${borda('entrada')} ${larg('w-24')} text-right`} />, { erro: erroEm('entrada') })}
      {envolver('saida', 'Saída (paguei)',
        <input id={idDe('saida')} inputMode="decimal" autoComplete="off" aria-label={empilhado ? undefined : 'Saída'} value={campos.saida} placeholder="0,00"
          onChange={(e) => setCampos({ ...campos, saida: e.target.value, entrada: e.target.value ? '' : campos.entrada })} {...aria('saida')}
          className={`${CAMPO_LINHA} ${altura} ${borda('saida')} ${larg('w-24')} text-right`} />, { erro: erroEm('saida') })}
      {/* juros e multa são saídas adicionais: digitar num deles limpa a entrada */}
      {envolver('juros', 'Juros',
        <input id={idDe('juros')} inputMode="decimal" autoComplete="off" aria-label={empilhado ? undefined : 'Juros'} value={campos.juros} placeholder="0,00"
          onChange={(e) => setCampos({ ...campos, juros: e.target.value, entrada: e.target.value ? '' : campos.entrada })}
          className={`${CAMPO_LINHA} ${altura} ${BORDA_CAMPO} ${larg('w-20')} text-right`} />)}
      {envolver('multa', 'Multa',
        <input id={idDe('multa')} inputMode="decimal" autoComplete="off" aria-label={empilhado ? undefined : 'Multa'} value={campos.multa} placeholder="0,00"
          onChange={(e) => setCampos({ ...campos, multa: e.target.value, entrada: e.target.value ? '' : campos.entrada })}
          className={`${CAMPO_LINHA} ${altura} ${BORDA_CAMPO} ${larg('w-20')} text-right`} />)}
    </>
  );
}

/**
 * Painel de documentos do livro (Fase 6). Grava os campos por-livro do termo
 * (nº do livro, nº de ordem, data) e baixa o livro inteiro em PDF ou .xlsx —
 * termo de abertura + 12 meses + termo de encerramento.
 */
function PainelDocumentos({ empresaId, ano, termo, onErro, onMsg, onSalvo, iaDoc, onAlternarIaDoc, arquivada }: {
  empresaId: string; ano: number; termo: Termo | null;
  onErro: (m: string | null) => void; onMsg: (m: string | null) => void; onSalvo: () => void;
  iaDoc: IaDocumento | null; onAlternarIaDoc: (ligada: boolean) => void; arquivada: boolean;
}) {
  const [salvando, setSalvando] = useState(false);

  // Inputs não-controlados: `key` no <form> o remonta quando o termo carrega ou o
  // exercício muda, então os defaultValue refletem o dado atual sem setState-em-effect.
  const chave = `${empresaId}:${ano}:${termo?.numeroLivro ?? ''}:${termo?.numeroOrdem ?? ''}:${termo?.dataTermo ?? ''}`;

  async function salvar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!empresaId) return;
    const fd = new FormData(e.currentTarget);
    setSalvando(true); onErro(null); onMsg(null);
    try {
      const r = await fetch('/api/caixa/livro', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empresa: empresaId, ano,
          numeroLivro: fd.get('numeroLivro'), numeroOrdem: fd.get('numeroOrdem'), dataTermo: fd.get('dataTermo'),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.erro || 'Falha ao salvar.');
      onMsg('Dados do termo salvos.');
      onSalvo();
    } catch (err) {
      onErro(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  }

  const baixar = (formato: 'pdf' | 'xlsx') =>
    `/api/caixa/livro?empresa=${encodeURIComponent(empresaId)}&ano=${ano}&formato=${formato}`;

  return (
    <div id="painel-documentos">
      <Secao titulo={`Livro Caixa ${ano} — documentos`}
        descricao="Termo de abertura + os 12 meses + termo de encerramento, com as folhas numeradas. Os campos abaixo saem nos termos.">
        <form key={chave} onSubmit={salvar} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Entrada rotulo="Nº do livro" name="numeroLivro" defaultValue={termo?.numeroLivro?.toString() ?? ''} inputMode="numeric" placeholder="ex.: 1" />
            <Entrada rotulo="Nº de ordem" name="numeroOrdem" defaultValue={termo?.numeroOrdem?.toString() ?? ''} inputMode="numeric" placeholder="ex.: 1" />
            <Entrada rotulo="Data do termo" type="date" name="dataTermo" defaultValue={termo?.dataTermo ?? ''} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Botao type="submit" variante="tonal" carregando={salvando} disabled={!empresaId}>
              {salvando ? 'Salvando…' : 'Salvar dados do termo'}
            </Botao>
            <span className="mx-1 hidden h-5 w-px bg-borda sm:block" aria-hidden="true" />
            <a href={baixar('pdf')} className={botaoCls()}><IconeBaixar /> Baixar livro (PDF)</a>
            <a href={baixar('xlsx')} className={botaoCls()}><IconeBaixar /> Baixar livro (.xlsx)</a>
            {termo?.qtdFolhas ? (
              <span className="text-xs text-tinta-suave">Último PDF: {termo.qtdFolhas} folhas.</span>
            ) : null}
          </div>

          <Aviso tom="aviso">
            O texto dos termos é o padrão do Livro Caixa e ainda depende de validação da contadora
            (inclusive a variante de pessoa física). Onde faltar dado cadastral, o termo sai com um espaço em branco.
          </Aviso>
        </form>
      </Secao>

      {/* Trava 2 da leitura de documentos por IA: só aparece quando a plataforma ligou (trava 1). */}
      {iaDoc?.plataforma && (
        <Secao className="mt-5" titulo="Leitura de documentos por IA"
          descricao="Quem lança envia a foto ou o PDF de uma nota, recibo, boleto ou comprovante e a IA propõe o lançamento; nada é gravado sem conferência. O arquivo é lido pelo Google Gemini e cada leitura conta na cota mensal de IA do escritório.">
          {iaDoc.saude ? (
            <p className="text-[13px] text-tinta-suave">
              Não disponível: esta empresa identifica o pagador (saúde), e o documento pode trazer dados de pacientes.
            </p>
          ) : (
            <Alternador checked={!!iaDoc.ligadaNaEmpresa} disabled={!empresaId || arquivada || (!iaDoc.podeLigar && !iaDoc.ligadaNaEmpresa)}
              onChange={(e) => onAlternarIaDoc(e.target.checked)}>
              A IA pode ler os documentos desta empresa
            </Alternador>
          )}
        </Secao>
      )}
    </div>
  );
}

/** A migração 0002 ainda não foi aplicada — sem `lancamentos` não há tela. */
function BancoIncompleto({ erro }: { erro: string }) {
  return (
    <div className="text-sm">
      <CabecalhoPagina titulo="Livro Caixa" subtitulo="O banco ainda não está pronto" />
      <Conteudo largura="estreita">
        <Aviso tom="aviso" titulo="Falta aplicar a migração do banco">
          <p>
            A tabela de lançamentos não existe no Postgres. Rode
            <code className="mx-1 rounded bg-superficie px-1 font-mono text-xs">supabase/migrations/0002_lancamentos_e_conferencia.sql</code>
            no SQL Editor do Supabase e recarregue esta página.
          </p>
          <p className="mt-2 text-xs text-tinta-suave">Resposta do banco: {erro}</p>
        </Aviso>
      </Conteudo>
    </div>
  );
}
