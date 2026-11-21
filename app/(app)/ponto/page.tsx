'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DiaFreq, Empresa, Frequencia, Funcionario, MARCADORES } from '@/lib/tipos';
import { MESES, DIAS_SEMANA, diasNoMes, diaSemana, tipoDoDia, JORNADA_PADRAO } from '@/lib/calendario';
import { validar, Alerta } from '@/lib/validacao';
import { achadosPorDia, revisarFolha } from '@/lib/revisaoPonto';
import { dataBR } from '@/lib/data';
import LupaImagem from '../LupaImagem';
import { AbasPonto } from '../AbasPonto';
import { comArquivadaDaUrl, empresaDaUrl, FaixaArquivada } from '../FaixaArquivada';
import { anoMesDaUrl, urlDoPonto } from '@/lib/pontoUrl';
import { IconeBaixar, IconeDesfazer } from '../icones';
import { DialogoConfirmacao } from '../Dialogo';
import { AchadosDoMes, PainelRevisaoMes, RevisaoDoMes, SeloAchados } from './RevisaoPonto';
import { ResumoFolha } from './ResumoFolha';
import { acaoEnvio, DialogoDevolver, FolhasEnviadas, type EnvioGestor } from './FolhasEnviadas';
import { Alternador, Aviso, Botao, CabecalhoPagina, CampoArquivo, Cartao, Conteudo, Entrada, EstadoVazio, Secao, Selo, tb } from '@/components/ui';
import { EntradaSugestoes, Selecao } from '@/components/selecao';
import { Toast, Toasts } from '@/components/retorno';

type Campo = 'entradaManha' | 'saidaAlmoco' | 'retornoAlmoco' | 'saidaTarde';
const CAMPOS: Campo[] = ['entradaManha', 'saidaAlmoco', 'retornoAlmoco', 'saidaTarde'];
const CAMPO_LABEL: Record<Campo, string> = {
  entradaManha: 'Entrada',
  saidaAlmoco: 'Saída almoço',
  retornoAlmoco: 'Retorno',
  saidaTarde: 'Saída',
};

function gridVazio(ano: number, mes: number): DiaFreq[] {
  const N = diasNoMes(ano, mes);
  return Array.from({ length: N }, (_, i) => ({
    dia: i + 1,
    entradaManha: null,
    saidaAlmoco: null,
    retornoAlmoco: null,
    saidaTarde: null,
    marcador: null,
  }));
}

/** Mescla dias extraídos sobre um grid completo 1..N. */
function mesclar(ano: number, mes: number, dias: DiaFreq[]): DiaFreq[] {
  const base = gridVazio(ano, mes);
  const porDia = new Map(dias.map((d) => [d.dia, d]));
  return base.map((d) => ({ ...d, ...(porDia.get(d.dia) ?? {}) }));
}

/** Situação da cota mensal de leituras por IA (ver lib/cotaOcr.ts). */
interface CotaOcr {
  permitido: boolean;
  nivel: 'ok' | 'aviso' | 'esgotada' | 'suspensa';
  usadas: number;
  limite: number;
  mensagem: string | null;
}

export default function Home() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresa, setEmpresa] = useState('');
  const [funcionario, setFuncionario] = useState('');
  const [ano, setAno] = useState(2026);
  const [mes, setMes] = useState(6);
  const [feriadosTxt, setFeriadosTxt] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [dias, setDias] = useState<DiaFreq[] | null>(null);
  const [incertos, setIncertos] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [funcList, setFuncList] = useState<Funcionario[]>([]);
  const [feriadosCad, setFeriadosCad] = useState<string[]>([]);
  const [cota, setCota] = useState<CotaOcr | null>(null);
  const [bancoPendente, setBancoPendente] = useState(false);
  // Revisão inteligente (lib/revisaoPonto.ts): o mês salvo da empresa + a folha em edição.
  const [revisaoMes, setRevisaoMes] = useState<RevisaoDoMes | null>(null);
  const [carregandoRevisao, setCarregandoRevisao] = useState(false);
  const [soDiasAtencao, setSoDiasAtencao] = useState(false);
  /** A folha em edição tem mudanças não salvas (abrir outra pede confirmação). */
  const [sujo, setSujo] = useState(false);
  const [pedidoAbrir, setPedidoAbrir] = useState<string | null>(null);
  const editorRef = useRef<HTMLElement | null>(null);
  const chaveRevisao = useRef('');
  /** Conta as gravações de folha: o Resumo para a folha se recalcula quando muda. */
  const [salvos, setSalvos] = useState(0);
  // Folha enviada pelo cliente aberta no editor (FolhasEnviadas.tsx): aplicar em vez de salvar.
  const [envioAberto, setEnvioAberto] = useState<EnvioGestor | null>(null);
  const [pedidoEnvio, setPedidoEnvio] = useState<EnvioGestor | null>(null);
  const [confirmarAplicar, setConfirmarAplicar] = useState(false);
  const [devolvendo, setDevolvendo] = useState<EnvioGestor | null>(null);
  const [versaoEnvios, setVersaoEnvios] = useState(0);
  const [desfazer, setDesfazer] = useState<{ texto: string; acao: () => Promise<void> } | null>(null);

  const carregarRevisao = useCallback(async () => {
    if (!empresa) { setRevisaoMes(null); return; }
    const chave = `${empresa}|${ano}|${mes}`;
    chaveRevisao.current = chave;
    // Trocou empresa ou mês: some a revisão antiga (recarregar o mesmo mês não pisca).
    setRevisaoMes((atual) => (atual?.chave === chave ? atual : null));
    setCarregandoRevisao(true);
    try {
      const r = await fetch(`/api/revisao-ponto?empresa=${encodeURIComponent(empresa)}&ano=${ano}&mes=${mes}`);
      const d = await r.json();
      if (chaveRevisao.current === chave) setRevisaoMes(r.ok ? { ...d, chave } : null); // resposta atrasada de outro mês: ignora
    } catch {
      setRevisaoMes(null);
    } finally {
      setCarregandoRevisao(false);
    }
  }, [empresa, ano, mes]);

  useEffect(() => {
    const t = setTimeout(carregarRevisao, 250); // o ano é digitado: espera parar
    return () => clearTimeout(t);
  }, [carregarRevisao]);

  // `?ano=&mes=` da URL (só na montagem); depois a URL acompanha a escolha.
  useEffect(() => {
    const { ano: a, mes: m } = anoMesDaUrl(window.location.search);
    if (a) setAno(a);
    if (m) setMes(m);
  }, []);
  useEffect(() => {
    if (!empresa) return; // ainda lendo a URL e a lista de empresas
    const nova = urlDoPonto(window.location.href, empresa, ano, mes);
    if (nova !== window.location.href) window.history.replaceState(null, '', nova);
  }, [empresa, ano, mes]);

  // Carrega cadastros (funciona mesmo se a planilha não estiver configurada).
  useEffect(() => {
    fetch('/api/empresas').then((r) => r.json()).then(async (d) => {
      if (Array.isArray(d.empresas)) {
        // `?empresa=` de uma arquivada (consulta, só leitura): entra na lista e é a selecionada.
        const { lista, consulta } = await comArquivadaDaUrl<Empresa>(d.empresas);
        setEmpresas(lista);
        // `?empresa=` (links da conferência, do painel e da agenda) abre direto na empresa.
        const daUrl = empresaDaUrl();
        const valida = lista.some((e) => e.id === daUrl) ? daUrl : '';
        if (lista.length) setEmpresa((prev) => consulta || prev || valida || lista[0].id);
      }
    }).catch(() => {});
  }, []);

  // Funcionários, feriados (do escritório da empresa) e cota de leituras por IA.
  useEffect(() => {
    if (!empresa) { setFuncList([]); setFeriadosCad([]); setCota(null); return; }
    const q = `empresa=${encodeURIComponent(empresa)}`;
    fetch(`/api/funcionarios?${q}`).then((r) => r.json()).then((d) => {
      setBancoPendente(Boolean(d.aguardandoBanco));
      if (Array.isArray(d.funcionarios)) setFuncList(d.funcionarios);
    }).catch(() => {});
    fetch(`/api/feriados?${q}`).then((r) => r.json()).then((d) => {
      if (Array.isArray(d.feriados)) setFeriadosCad(d.feriados.map((f: { data: string }) => f.data));
    }).catch(() => {});
    fetch(`/api/extrair?${q}`).then((r) => r.json()).then((d) => setCota(d.cota ?? null)).catch(() => {});
  }, [empresa]);

  const empresaSel = useMemo(() => empresas.find((e) => e.id === empresa), [empresas, empresa]);
  const trabalhaSabado = empresaSel?.trabalhaSabado ?? JORNADA_PADRAO.trabalhaSabado;

  const feriados = useMemo(
    () => new Set([
      ...feriadosCad,
      ...feriadosTxt.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean),
    ]),
    [feriadosTxt, feriadosCad],
  );

  const alertas: Alerta[] = useMemo(() => {
    if (!dias) return [];
    const freq: Frequencia = { empresa, funcionario, ano, mes, dias };
    return validar(freq, feriados, { ...JORNADA_PADRAO, trabalhaSabado });
  }, [dias, empresa, funcionario, ano, mes, feriados, trabalhaSabado]);

  // Revisão da folha em edição, ao vivo: jornada do cadastro do funcionário e, se a
  // folha veio do banco, a última semana do mês anterior (interjornada, 7º dia).
  const revisaoFolha = useMemo(() => {
    if (!dias) return null;
    const cad = funcList.find((f) => f.nome === funcionario);
    const salva = revisaoMes?.folhas.find((f) => f.funcionario === funcionario);
    return revisarFolha({
      funcionario,
      dias,
      anteriores: salva?.anteriores,
      jornada: {
        utilMin: cad?.jornadaUtilMin ?? empresaSel?.jornadaUtilMin ?? JORNADA_PADRAO.utilMin,
        sabadoMin: cad?.jornadaSabadoMin ?? empresaSel?.jornadaSabadoMin ?? JORNADA_PADRAO.sabadoMin,
        trabalhaSabado,
      },
      incertos: [...incertos].map((k) => {
        const [d, campo] = k.split(':');
        return { dia: Number(d), campo };
      }),
    }, { ano, mes, feriados });
  }, [dias, funcionario, funcList, revisaoMes, empresaSel, trabalhaSabado, incertos, ano, mes, feriados]);
  const achadosDoDia = useMemo(() => (revisaoFolha ? achadosPorDia(revisaoFolha) : new Map()), [revisaoFolha]);
  const achadosDoMesFolha = useMemo(() => revisaoFolha?.achados.filter((a) => a.dia === null) ?? [], [revisaoFolha]);

  /** Abre a folha salva do funcionário no editor (pede confirmação se há edição não salva). */
  function abrirFolha(nome: string, confirmado = false) {
    const salva = revisaoMes?.folhas.find((f) => f.funcionario === nome);
    if (!salva) return;
    if (!confirmado && sujo && dias && nome !== funcionario) { setPedidoAbrir(nome); return; }
    setPedidoAbrir(null);
    setEnvioAberto(null);
    setFuncionario(nome);
    setDias(mesclar(ano, mes, salva.dias));
    setIncertos(new Set());
    escolherArquivo(null);
    setSujo(false);
    setSoDiasAtencao(true);
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
  }

  const alertaPorCampo = useMemo(() => {
    const m = new Map<string, Alerta>();
    for (const a of alertas) {
      const k = `${a.dia}:${a.campo}`;
      if (!m.has(k) || a.nivel === 'erro') m.set(k, a);
    }
    return m;
  }, [alertas]);

  function escolherArquivo(f: File | null) {
    if (f) setEnvioAberto(null);
    setArquivo(f);
    setImgUrl(f ? URL.createObjectURL(f) : null);
  }

  async function lerFolha() {
    setErro(null);
    if (!arquivo) {
      setErro('Escolha a foto da folha primeiro.');
      return;
    }
    setCarregando(true);
    try {
      const fd = new FormData();
      fd.append('file', arquivo);
      fd.append('ano', String(ano));
      fd.append('mes', String(mes));
      if (empresa) fd.append('empresa', empresa);
      if (funcionario) fd.append('funcionario', funcionario);
      const res = await fetch('/api/extrair', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.cota) setCota(data.cota);
      if (!res.ok) throw new Error(data.erro ?? 'Falha na leitura.');
      if (data.cota?.nivel === 'aviso' && data.cota.mensagem) setAviso(data.cota.mensagem);
      setEnvioAberto(null);
      if (data.frequencia?.funcionario && !funcionario) setFuncionario(data.frequencia.funcionario);
      setDias(mesclar(ano, mes, data.frequencia.dias ?? []));
      setSujo(true);
      setIncertos(new Set((data.incertos ?? []).map((c: { dia: number; campo: string }) => `${c.dia}:${c.campo}`)));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }

  function preencherManual() {
    setErro(null);
    setEnvioAberto(null);
    setDias(gridVazio(ano, mes));
    setIncertos(new Set());
    setSujo(false);
  }

  function editar(dia: number, campo: Campo | 'marcador', valor: string) {
    setSujo(true);
    setDias((prev) =>
      (prev ?? []).map((d) =>
        d.dia === dia ? { ...d, [campo]: valor === '' ? null : valor } : d,
      ),
    );
    setIncertos((prev) => {
      const n = new Set(prev);
      n.delete(`${dia}:${campo}`);
      return n;
    });
  }

  async function baixar() {
    setErro(null);
    if (!empresa) {
      setErro('Selecione a empresa.');
      return;
    }
    if (!funcionario) {
      setErro('Informe o nome do funcionário.');
      return;
    }
    setCarregando(true);
    try {
      const freq: Frequencia = { empresa, funcionario, ano, mes, dias: dias ?? [] };
      const res = await fetch('/api/gerar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frequencia: freq, feriados: [...feriados] }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.erro ?? 'Falha ao gerar.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${funcionario}_${MESES[mes]}_${ano}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }

  async function salvarSheets() {
    setErro(null);
    setAviso(null);
    if (!empresa) {
      setErro('Selecione a empresa.');
      return;
    }
    if (!funcionario) {
      setErro('Informe o nome do funcionário.');
      return;
    }
    setCarregando(true);
    try {
      const freq: Frequencia = { empresa, funcionario, ano, mes, dias: dias ?? [] };
      const res = await fetch('/api/salvar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frequencia: freq }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro ?? 'Falha ao salvar.');
      setAviso(`Salvo: ${data.dias} dia(s) de ${funcionario} (${MESES[mes]}/${ano}).`);
      setSujo(false);
      carregarRevisao();
      setSalvos((x) => x + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }

  /** Abre a folha enviada pelo cliente: a foto ao lado do rascunho lido pela IA (pede confirmação se há edição não salva). */
  function abrirEnvio(e: EnvioGestor, confirmado = false) {
    if (!confirmado && sujo && dias) { setPedidoEnvio(e); return; }
    setPedidoEnvio(null);
    setAno(e.ano);
    setMes(e.mes);
    setFuncionario(e.funcionario);
    setDias(mesclar(e.ano, e.mes, e.rascunho?.dias ?? []));
    setIncertos(new Set((e.rascunho?.incertos ?? []).map((c) => `${c.dia}:${c.campo}`)));
    setArquivo(null);
    // A rota redireciona para uma URL assinada de 60 s; `v` evita reaproveitar uma vencida.
    setImgUrl(e.temFoto ? `/api/envio-ponto/foto?id=${encodeURIComponent(e.id)}&v=${Date.now()}` : null);
    setEnvioAberto(e);
    setSujo(false);
    setSoDiasAtencao(false);
    requestAnimationFrame(() => editorRef.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }));
  }

  /** Grava o rascunho conferido na frequência do funcionário (com desfazer). */
  async function aplicarEnvio() {
    setConfirmarAplicar(false);
    const e = envioAberto;
    if (!e || !dias) return;
    setErro(null);
    setAviso(null);
    setCarregando(true);
    try {
      const r = await acaoEnvio(e.id, 'aplicar', { funcionario, dias });
      const nome = funcionario;
      setEnvioAberto(null);
      setSujo(false);
      carregarRevisao();
      setSalvos((x) => x + 1);
      setVersaoEnvios((x) => x + 1);
      setDesfazer({
        texto: `Folha de ${nome} aplicada à frequência: ${r.dias} dia(s) em ${MESES[e.mes]}/${e.ano}.`,
        acao: async () => {
          await acaoEnvio(e.id, 'desfazer-aplicacao');
          setAviso('Aplicação desfeita: a frequência voltou ao que era e a folha voltou para a fila.');
        },
      });
    } catch (x) {
      setErro(x instanceof Error ? x.message : String(x));
    } finally {
      setCarregando(false);
    }
  }

  async function devolverEnvio(e: EnvioGestor, motivo: string) {
    setDevolvendo(null);
    setErro(null);
    try {
      await acaoEnvio(e.id, 'devolver', { motivo });
      if (envioAberto?.id === e.id) { setEnvioAberto(null); setDias(null); setImgUrl(null); setSujo(false); }
      setVersaoEnvios((x) => x + 1);
      setDesfazer({
        texto: `Folha de ${e.funcionario} devolvida ao cliente.`,
        acao: async () => {
          await acaoEnvio(e.id, 'desfazer-devolucao');
          setAviso('Devolução desfeita: a folha voltou para a fila.');
        },
      });
    } catch (x) {
      setErro(x instanceof Error ? x.message : String(x));
    }
  }

  async function executarDesfazer() {
    const d = desfazer;
    setDesfazer(null);
    if (!d) return;
    try {
      await d.acao();
      carregarRevisao();
      setSalvos((x) => x + 1);
      setVersaoEnvios((x) => x + 1);
    } catch (x) {
      setErro(x instanceof Error ? x.message : String(x));
    }
  }

  async function gerarLote() {
    setErro(null);
    setAviso(null);
    if (!empresa) {
      setErro('Selecione a empresa.');
      return;
    }
    setCarregando(true);
    try {
      const res = await fetch(`/api/gerar-lote?empresa=${encodeURIComponent(empresa)}&ano=${ano}&mes=${mes}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.erro ?? 'Falha ao gerar lote.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${empresaSel?.nome ?? 'planilhas'}_${MESES[mes]}_${ano}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }

  const nErros = alertas.filter((a) => a.nivel === 'erro').length;
  const diasComErro = new Set(alertas.filter((a) => a.nivel === 'erro').map((a) => a.dia));
  const diasAtencao = revisaoFolha?.diasAtencao ?? 0;
  const envioMesTrocado = Boolean(envioAberto && (envioAberto.ano !== ano || envioAberto.mes !== mes));
  const diasJaSalvos = revisaoMes?.folhas.find((f) => f.funcionario === funcionario)?.dias.length ?? 0;
  const diasNoRascunho = (dias ?? []).filter((d) => d.entradaManha || d.saidaAlmoco || d.retornoAlmoco || d.saidaTarde || d.marcador).length;

  return (
    <div className="text-sm">
      <CabecalhoPagina titulo="Timesheet" subtitulo="Suba a folha, revise e gere a planilha"
        acoes={<Selo>{dataBR()}</Selo>} abas={<AbasPonto ativa="timesheet" />} />

      <Toasts>
        {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
        {aviso && <Toast onFechar={() => setAviso(null)}>{aviso}</Toast>}
        {desfazer && (
          <Toast tom="info" onFechar={() => setDesfazer(null)}
            acao={<Botao tamanho="sm" variante="tonal" icone={<IconeDesfazer />} onClick={executarDesfazer}>Desfazer</Botao>}>
            {desfazer.texto}
          </Toast>
        )}
      </Toasts>

      <Conteudo>
        <FaixaArquivada empresa={empresaSel} />
        {bancoPendente && (
          <Aviso tom="aviso" titulo="Aguardando o banco de dados">
            A Folha de Ponto está mudando de casa. Enquanto a atualização não termina, não dá para salvar nem ler
            folhas; tente de novo em alguns minutos.
          </Aviso>
        )}
        <Secao titulo="Folha do mês" descricao="Escolha a empresa, o funcionário e o mês; depois envie a foto da folha manuscrita ou preencha à mão.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Selecao rotulo="Empresa" classeCampo="md:col-span-2" valor={empresa} placeholder="— cadastre uma empresa —"
              onChange={(v) => { setEmpresa(v); setFuncionario(''); setEnvioAberto(null); }}
              opcoes={empresas.map((e) => ({ valor: e.id, rotulo: e.nome }))} />
            <EntradaSugestoes rotulo="Funcionário" classeCampo="md:col-span-2" value={funcionario} onChange={setFuncionario}
              sugestoes={funcList.map((f) => f.nome)}
              placeholder={empresa ? 'Nome completo (ou selecione)' : 'Selecione a empresa primeiro'} />
            <Selecao rotulo="Mês" busca={false} valor={String(mes)} onChange={(v) => setMes(Number(v))}
              opcoes={MESES.slice(1).map((m, i) => ({ valor: String(i + 1), rotulo: m }))} />
            <Entrada rotulo="Ano" type="number" value={ano} onChange={(e) => setAno(Number(e.target.value))} />
            <CampoArquivo rotulo="Foto da folha" classeCampo="md:col-span-2" accept="image/*" texto="Escolher ou soltar a foto aqui"
              nome={arquivo?.name} onArquivo={escolherArquivo} />
            <Entrada rotulo="Feriados extras (opcional)" classeCampo="md:col-span-4" value={feriadosTxt}
              onChange={(e) => setFeriadosTxt(e.target.value)}
              placeholder={feriadosCad.length ? `${feriadosCad.length} do cadastro + extras aqui` : 'AAAA-MM-DD, ex.: 2026-06-19'} />
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {/* Com a revisão aberta, a ação principal da tela passa a ser baixar a planilha. */}
            <Botao variante={dias ? 'secundaria' : 'primaria'} onClick={lerFolha} carregando={carregando}>
              {carregando ? 'Lendo…' : 'Ler folha (OCR)'}
            </Botao>
            <Botao onClick={preencherManual}>Preencher manualmente</Botao>
          </div>
          {cota && (
            <p className={`mt-3 text-[13px] ${cota.nivel === 'ok' ? 'text-tinta-suave' : 'font-medium text-tinta'}`} role="status">
              {cota.permitido
                ? `Leituras por IA neste mês: ${cota.usadas.toLocaleString('pt-BR')} de ${cota.limite.toLocaleString('pt-BR')}.`
                : cota.mensagem}
            </p>
          )}
        </Secao>

        <Cartao className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-tinta">Gerar em lote</h2>
            <p className="mt-0.5 text-[13px] text-tinta-suave">
              Todas as planilhas de {empresaSel?.nome || 'empresa'} em {MESES[mes]}/{ano} salvas no banco.
            </p>
          </div>
          <Botao onClick={gerarLote} disabled={carregando} icone={<IconeBaixar />}>Baixar todas (.zip)</Botao>
        </Cartao>

        {empresa && !bancoPendente && (
          <FolhasEnviadas key={empresa} empresa={empresa} ano={ano} mes={mes} envioAberto={envioAberto?.id ?? null} versao={versaoEnvios}
            onAbrir={(e) => abrirEnvio(e)} onDevolver={setDevolvendo}
            onMensagem={(texto, tom) => (tom === 'perigo' ? setErro(texto) : setAviso(texto))} />
        )}

        {empresa && !bancoPendente && (
          <PainelRevisaoMes revisao={revisaoMes} carregando={carregandoRevisao} ano={ano} mes={mes}
            funcionarioAberto={dias ? funcionario : ''} onAbrir={(nome) => abrirFolha(nome)} />
        )}

        {empresa && !bancoPendente && (
          <ResumoFolha key={empresa} empresa={empresa} empresaNome={empresaSel?.nome ?? ''} ano={ano} mes={mes}
            funcionarioAberto={dias ? funcionario : ''} onAbrir={(nome) => abrirFolha(nome)} recarregar={salvos} />
        )}

        {dias && (
          <section ref={editorRef} className="grid scroll-mt-4 grid-cols-1 gap-5 lg:grid-cols-2" aria-label="Revisão da folha">
            <div className="lg:sticky lg:top-4 lg:self-start">
              <h2 className="mb-2 text-[15px] font-semibold text-tinta">
                {envioAberto ? `Foto enviada pelo cliente — ${envioAberto.funcionario}` : 'Folha original'}
              </h2>
              {envioAberto?.tipo === 'image/heic' && (
                <p className="mb-2 text-[13px] text-tinta-suave">Foto em HEIC (iPhone): alguns navegadores não mostram este formato; o Safari mostra.</p>
              )}
              {imgUrl
                ? <LupaImagem src={imgUrl} />
                : <EstadoVazio titulo="Sem imagem" descricao="Preenchimento manual — não há folha para conferir." />}
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[15px] font-semibold text-tinta">Revisão — {MESES[mes]}/{ano}</h2>
                <span className="flex flex-wrap gap-1.5" role="status">
                  {nErros > 0 && <Selo tom="perigo">{nErros} erro(s)</Selo>}
                  {diasAtencao > 0 && <Selo tom="aviso">{diasAtencao} dia(s) pede(m) atenção</Selo>}
                  {nErros + diasAtencao + achadosDoMesFolha.length === 0 && <Selo tom="sucesso">tudo certo</Selo>}
                </span>
              </div>
              {achadosDoMesFolha.length > 0 && <div className="mb-3"><AchadosDoMes achados={achadosDoMesFolha} /></div>}
              <div className="mb-2 text-[13px] text-tinta-suave">
                <Alternador checked={soDiasAtencao} onChange={(e) => setSoDiasAtencao(e.target.checked)}
                  disabled={diasAtencao === 0 && !soDiasAtencao}>
                  Só os dias que pedem atenção
                </Alternador>
              </div>

              <div className={tb.moldura}>
                <table className={`${tb.tabela} text-[13px]`}>
                  <thead className={tb.cabeca}>
                    <tr>
                      <th className={`${tb.th} text-center`}>Dia</th>
                      {CAMPOS.map((c) => <th key={c} className={`${tb.th} text-center`}>{CAMPO_LABEL[c]}</th>)}
                      <th className={tb.th}>Marcador</th>
                      <th className={tb.th}>Revisão</th>
                    </tr>
                  </thead>
                  <tbody className={tb.corpo}>
                    {dias.map((d) => {
                      const wd = diaSemana(ano, mes, d.dia);
                      const tipo = tipoDoDia(ano, mes, d.dia, feriados);
                      const fds = wd === 0 || wd === 6 || tipo === 'feriado';
                      const achadosDia = achadosDoDia.get(d.dia);
                      if (soDiasAtencao && !achadosDia && !diasComErro.has(d.dia)) return null;
                      return (
                        <tr key={d.dia} className={fds ? 'bg-superficie-suave' : ''}>
                          <td className="whitespace-nowrap px-2 py-1 text-center" data-dica={DIAS_SEMANA[wd]}>
                            <span className="font-semibold text-tinta">{d.dia}</span>
                            <span className="ml-1 text-[11px] text-tinta-suave">{DIAS_SEMANA[wd].slice(0, 3)}</span>
                          </td>
                          {CAMPOS.map((campo) => {
                            const k = `${d.dia}:${campo}`;
                            const a = alertaPorCampo.get(k);
                            const inc = incertos.has(k);
                            const cls = a?.nivel === 'erro'
                              ? 'border-perigo bg-perigo-suave'
                              : inc || a?.nivel === 'alerta'
                                ? 'border-aviso bg-aviso-suave'
                                : 'border-borda hover:border-borda-forte';
                            const dica = a?.msg ?? (inc ? 'Leitura incerta — confira' : undefined);
                            return (
                              <td key={campo} className="px-1 py-1 text-center">
                                <input
                                  value={(d[campo] as string) ?? ''}
                                  onChange={(e) => editar(d.dia, campo, e.target.value)}
                                  placeholder="--:--"
                                  aria-label={`${CAMPO_LABEL[campo]} do dia ${d.dia}${dica ? ` — ${dica}` : ''}`}
                                  aria-invalid={a?.nivel === 'erro' ? true : undefined}
                                  data-dica={dica}
                                  className={`h-8 w-[4.25rem] rounded-md border bg-superficie px-1 text-center text-tinta transition-colors placeholder:text-tinta-fraca focus:border-foco ${cls}`}
                                />
                              </td>
                            );
                          })}
                          <td className="px-1 py-1">
                            <Selecao aparencia="celula" largura="w-32" aria-label={`Marcador do dia ${d.dia}`} placeholder="—"
                              valor={d.marcador ?? ''} onChange={(v) => editar(d.dia, 'marcador', v)}
                              opcoes={[{ valor: '', rotulo: '—' }, ...MARCADORES.map((m) => ({ valor: m, rotulo: m }))]} />
                          </td>
                          <td className="px-2 py-1"><SeloAchados achados={achadosDia} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {envioAberto ? (
                <div className="mt-4 space-y-2">
                  <p className="text-[13px] text-tinta-suave">
                    Rascunho lido pela IA a partir da foto do cliente. Confira e ajuste os dias; nada vai para a frequência até você aplicar.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span data-dica={nErros > 0 ? 'Corrija os erros antes de aplicar'
                      : envioMesTrocado ? `Esta folha é de ${MESES[envioAberto.mes]}/${envioAberto.ano}: volte o mês para aplicar` : undefined}>
                      <Botao variante="primaria" onClick={() => setConfirmarAplicar(true)}
                        disabled={carregando || nErros > 0 || envioMesTrocado || !funcionario.trim()}>
                        Aplicar à frequência
                      </Botao>
                    </span>
                    <Botao variante="fantasma" onClick={() => setDevolvendo(envioAberto)} disabled={carregando}>Devolver ao cliente</Botao>
                    <span data-dica={nErros > 0 ? 'Corrija os erros antes de baixar' : undefined}>
                      <Botao onClick={baixar} disabled={carregando || nErros > 0} icone={<IconeBaixar />}>Baixar planilha (.xlsx)</Botao>
                    </span>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span data-dica={nErros > 0 ? 'Corrija os erros antes de baixar' : undefined}>
                    <Botao variante="primaria" onClick={baixar} disabled={carregando || nErros > 0} icone={<IconeBaixar />}>
                      Baixar planilha (.xlsx)
                    </Botao>
                  </span>
                  <span data-dica={nErros > 0 ? 'Corrija os erros antes de salvar' : undefined}>
                    <Botao onClick={salvarSheets} disabled={carregando || nErros > 0}>Salvar no banco (Sheets)</Botao>
                  </span>
                </div>
              )}
            </div>
          </section>
        )}
      </Conteudo>

      {pedidoEnvio && (
        <DialogoConfirmacao titulo="Trocar a folha em edição?"
          mensagem={`A folha de ${funcionario || 'quem está aberto'} tem alterações que ainda não foram salvas. Abrir a folha enviada de ${pedidoEnvio.funcionario} descarta essas alterações.`}
          textoConfirmar="Abrir mesmo assim" perigo
          onConfirmar={() => abrirEnvio(pedidoEnvio, true)} onCancelar={() => setPedidoEnvio(null)} />
      )}

      {confirmarAplicar && envioAberto && (
        <DialogoConfirmacao titulo="Aplicar à frequência?"
          mensagem={`${diasNoRascunho} dia(s) vão para a frequência de ${funcionario} em ${MESES[mes]}/${ano}`
            + (diasJaSalvos ? `, substituindo os ${diasJaSalvos} dia(s) já salvos deste mês.` : '.')
            + (diasAtencao ? ` A revisão ainda aponta ${diasAtencao} dia(s) pedindo atenção.` : '')
            + ' Dá para desfazer logo em seguida.'}
          textoConfirmar="Aplicar"
          onConfirmar={aplicarEnvio} onCancelar={() => setConfirmarAplicar(false)} />
      )}

      {devolvendo && (
        <DialogoDevolver envio={devolvendo} onConfirmar={(m) => devolverEnvio(devolvendo, m)} onCancelar={() => setDevolvendo(null)} />
      )}

      {pedidoAbrir && (
        <DialogoConfirmacao titulo="Trocar a folha em edição?"
          mensagem={`A folha de ${funcionario || 'quem está aberto'} tem alterações que ainda não foram salvas. Abrir a de ${pedidoAbrir} descarta essas alterações.`}
          textoConfirmar="Abrir mesmo assim" perigo
          onConfirmar={() => abrirFolha(pedidoAbrir, true)} onCancelar={() => setPedidoAbrir(null)} />
      )}
    </div>
  );
}
