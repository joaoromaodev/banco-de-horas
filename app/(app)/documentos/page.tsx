'use client';

// Portal do cliente — documentos e pendências. Ver docs/documentos.md.
//
// Mesma tela para os dois lados:
// - cliente: envia arquivos (arrastar ou foto do celular), vê o que enviou e
//   atende as pendências que o escritório abriu;
// - contabilidade: escolhe a empresa, aceita ou devolve (com motivo) os documentos e
//   abre/fecha pendências.
// Sprint 17 (0032): documentos que o escritório publica para a empresa, com "aberto em"
// (Entregas.tsx), situação por documento e "Não tenho este mês" no pedido.
// A tela só esconde botões; quem decide de verdade são as rotas.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ACCEPT, CATEGORIAS, Categoria, competenciaBR, competenciaPadrao, competenciasRecentes, conferirEnvioDocumentos, type ErrosEnvioDocumentos, LIMITE_TEXTO,
  MAX_MOTIVO_DEVOLUCAO, MAX_OBS_SEM_MOVIMENTO, motivoDevolucao, ROTULO_CATEGORIA, situacaoPrazo, StatusDocumento, StatusPendencia, tamanhoBR,
  TIPOS_TEXTO, validarArquivo,
} from '@/lib/documentos';
import { hojeBelem } from '@/lib/contratos';
import { lerMe } from '@/lib/meCliente';
import { lerJson as lerCarga, mensagemDeCarga, MENSAGEM_GENERICA, MENSAGEM_SEM_REDE } from '@/lib/carga';
import { DialogoConfirmacao, Modal } from '../Dialogo';
import { comArquivadaDaUrl, FaixaArquivada } from '../FaixaArquivada';
import { IconeAlerta, IconeBaixar, IconeCheck, IconeDesfazer, IconeDocumento, IconeExcluir, IconeLapis, IconeMais } from '../icones';
import {
  AreaTexto, Aviso, Botao, BotaoIcone, CabecalhoPagina, Carregando, Conteudo, cx, Entrada, EstadoVazio, FalhaCarregamento, Secao,
  Selo, tb, Tom,
} from '@/components/ui';
import { Selecao } from '@/components/selecao';
import { Toast, Toasts } from '@/components/retorno';
import { Entregas, NaoAbertas, type Desfazivel } from './Entregas';

type Papel = 'master' | 'usuario' | 'cliente';
interface Me { role: Papel; email: string; empresa: string | null }
interface Empresa { id: string; nome: string; arquivadaEm?: string | null }

interface Documento {
  id: string; empresaId: string; competencia: string; categoria: Categoria; nome: string; tamanho: number;
  tipo: string; observacao: string | null; pendenciaId: string | null; status: StatusDocumento;
  enviadoPor: string; enviadoEm: string; conferidoPor: string | null; conferidoEm: string | null;
  devolvidoEm?: string | null; motivoDevolucao?: string | null;
}
interface Pendencia {
  id: string; empresaId: string; titulo: string; descricao: string | null; categoria: Categoria | null;
  competencia: string | null; prazo: string | null; status: StatusPendencia; atendidaEm: string | null;
  atendidaPor: string | null; criadoEm: string;
  semMovimentoEm?: string | null; semMovimentoObs?: string | null;
}

type EstadoFila = 'esperando' | 'enviando' | 'ok' | 'erro';
interface ItemFila { chave: string; arquivo: File; estado: EstadoFila; erro?: string }

const TOM_STATUS: Record<StatusDocumento, Tom> = { enviando: 'neutro', recebido: 'aviso', conferido: 'sucesso', devolvido: 'perigo', rejeitado: 'perigo' };
/** Situação de cada documento: recebido → aceito, ou devolvido com motivo. A contabilidade lê "a conferir". */
const rotuloStatus = (s: StatusDocumento, gestor: boolean) => ({
  enviando: 'Enviando', recebido: gestor ? 'A conferir' : 'Recebido', conferido: 'Aceito', devolvido: 'Devolvido', rejeitado: 'Recusado',
}[s]);

const dataBR = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Belem' }) : '');
const diaBR = (d: string | null) => (d ? d.split('-').reverse().join('/') : '');

async function lerJson(r: Response) {
  const x = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(x.erro ?? 'Não foi possível concluir. Tente de novo.');
  return x;
}

const opcoesCategoria = CATEGORIAS.map((c) => ({ valor: c, rotulo: ROTULO_CATEGORIA[c] }));

export default function DocumentosPage() {
  const hoje = useMemo(() => hojeBelem(), []);
  const competencias = useMemo(() => competenciasRecentes(hoje, 13), [hoje]);

  const [me, setMe] = useState<Me | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaSel, setEmpresaSel] = useState('');
  const [documentos, setDocumentos] = useState<Documento[] | null>(null);
  const [pendencias, setPendencias] = useState<Pendencia[] | null>(null);
  const [filtroComp, setFiltroComp] = useState('');
  const [semTabela, setSemTabela] = useState(false);

  const [erro, setErro] = useState<string | null>(null);
  // Falha da carga principal: na tela, com "Tentar de novo" (antes, "Carregando…" para sempre).
  const [falha, setFalha] = useState<{ msg: string; de: 'inicio' | 'lista'; id?: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [desfazer, setDesfazer] = useState<Desfazivel | null>(null);
  const [excluindoDoc, setExcluindoDoc] = useState<Documento | null>(null);
  const [devolvendo, setDevolvendo] = useState<Documento | null>(null);
  const [semMovimento, setSemMovimento] = useState<Pendencia | null>(null);
  // Muda quando algo é publicado/excluído: o resumo "ainda não abertos" recarrega.
  const [versaoEntregas, setVersaoEntregas] = useState(0);
  const [excluindoPend, setExcluindoPend] = useState<Pendencia | null>(null);
  const [editandoPend, setEditandoPend] = useState<Pendencia | 'nova' | null>(null);

  // formulário de envio
  const [competencia, setCompetencia] = useState(() => competenciaPadrao(hoje));
  const [categoria, setCategoria] = useState<Categoria | ''>('');
  const [observacao, setObservacao] = useState('');
  const [pendenciaSel, setPendenciaSel] = useState('');
  const [fila, setFila] = useState<ItemFila[]>([]);
  const [enviando, setEnviando] = useState(false);
  const formRef = useRef<HTMLDivElement>(null);
  // O que falta no formulário de envio, por campo (mensagem embaixo do campo, ligada a ele).
  const [errosCampo, setErrosCampo] = useState<ErrosEnvioDocumentos>({});
  const idCategoria = useId();

  const gestor = me?.role === 'master' || me?.role === 'usuario';
  const empresaId = gestor ? empresaSel : (me?.empresa ?? '');
  const empresa = empresas.find((e) => e.id === empresaId);

  const carregar = useCallback(async (id: string) => {
    if (!id) return;
    const q = `empresa=${encodeURIComponent(id)}`;
    setFalha(null);
    try {
      const [d, p] = await Promise.all([
        fetch(`/api/documentos?${q}`).then(lerJson),
        fetch(`/api/pendencias?${q}`).then(lerJson),
      ]);
      setDocumentos(d.documentos ?? []);
      setPendencias(p.pendencias ?? []);
      setSemTabela(false);
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      if (/migração 0015/.test(m)) { setSemTabela(true); setDocumentos([]); setPendencias([]); return; }
      setFalha({ msg: e instanceof TypeError ? MENSAGEM_SEM_REDE : m || MENSAGEM_GENERICA, de: 'lista', id });
    }
  }, []);

  const iniciar = useCallback(() => {
    setFalha(null);
    Promise.all([
      lerMe(),
      lerCarga<{ empresas?: Empresa[] }>('/api/empresas'),
    ]).then(async ([m, e]) => {
      if (!m?.autenticado) throw new Error(MENSAGEM_GENERICA);
      setMe({ role: m.role, email: m.email, empresa: m.empresa });
      const base: Empresa[] = (e?.empresas ?? []).map((x: Empresa) => ({ id: x.id, nome: x.nome }));
      // `?empresa=` de uma arquivada (consulta, só leitura): entra na lista e é a selecionada.
      const { lista, consulta } = m.role === 'cliente' ? { lista: base, consulta: '' } : await comArquivadaDaUrl<Empresa>(base);
      setEmpresas(lista);
      if (m.role === 'cliente') { carregar(m.empresa ?? ''); return; }
      let salva = '';
      try { salva = localStorage.getItem('documentos.empresa') ?? ''; } catch {}
      const id = consulta || (lista.some((x) => x.id === salva) ? salva : lista[0]?.id ?? '');
      setEmpresaSel(id);
      carregar(id);
    }).catch((e) => setFalha({ msg: mensagemDeCarga(e), de: 'inicio' }));
  }, [carregar]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga da API; zerar erro/espera/dados antigos antes do fetch é intencional
  useEffect(() => { iniciar(); }, [iniciar]);

  function trocarEmpresa(id: string) {
    setEmpresaSel(id);
    setDocumentos(null); setPendencias(null); setDesfazer(null); setPendenciaSel(''); setFila([]);
    if (!empresas.find((e) => e.id === id)?.arquivadaEm) { try { localStorage.setItem('documentos.empresa', id); } catch {} }
    carregar(id);
  }

  const abertas = (pendencias ?? []).filter((p) => p.status === 'aberta');
  const atendidas = (pendencias ?? []).filter((p) => p.status === 'atendida');
  const vencidas = abertas.filter((p) => situacaoPrazo(p.prazo, hoje) === 'vencida').length;

  // ------------------------------------------------------------------ envio
  function adicionarArquivos(lista: FileList | File[] | null) {
    if (!lista) return;
    const novos = Array.from(lista).map((arquivo, i) => {
      const v = validarArquivo({ nome: arquivo.name, tamanho: arquivo.size, tipo: arquivo.type });
      return {
        chave: `${Date.now()}-${i}-${arquivo.name}`, arquivo,
        estado: v.ok ? 'esperando' : 'erro', erro: v.ok ? undefined : v.erro,
      } as ItemFila;
    });
    setFila((f) => [...f.filter((x) => x.estado !== 'ok'), ...novos].slice(-20));
    setErrosCampo((e) => ({ ...e, arquivos: undefined }));
  }

  /** Atender uma pendência: o formulário vem preenchido com o que o escritório sugeriu. */
  function atender(p: Pendencia) {
    setPendenciaSel(p.id);
    if (p.categoria) setCategoria(p.categoria);
    if (p.competencia) setCompetencia(p.competencia);
    setErrosCampo({});
    formRef.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    // O foco vai para o campo de arquivo (o leitor de tela anuncia "Escolher arquivos").
    formRef.current?.querySelector<HTMLElement>('[data-zona-envio] input')?.focus({ preventScroll: true });
  }

  async function enviarUm(item: ItemFila): Promise<void> {
    const v = validarArquivo({ nome: item.arquivo.name, tamanho: item.arquivo.size, tipo: item.arquivo.type });
    if (!v.ok) throw new Error(v.erro);
    // 1. o servidor valida, grava e devolve a URL de upload assinada
    const ini = await fetch('/api/documentos', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empresa: empresaId, competencia, categoria, nome: item.arquivo.name, tamanho: item.arquivo.size,
        tipo: item.arquivo.type, observacao, pendencia: pendenciaSel || null,
      }),
    }).then(lerJson);
    // 2. o arquivo vai direto ao Storage, com o tipo que o servidor definiu
    const corpo = new FormData();
    corpo.append('cacheControl', '3600');
    corpo.append('', new File([item.arquivo], v.nome, { type: ini.mime }));
    const up = await fetch(ini.url, { method: 'PUT', body: corpo, headers: { 'x-upsert': 'false' } });
    if (!up.ok) throw new Error('O arquivo não subiu. Confira a conexão e tente de novo.');
    // 3. o servidor confere os bytes e libera o documento
    await fetch('/api/documentos', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ini.id, acao: 'confirmar' }),
    }).then(lerJson);
  }

  async function enviar() {
    const pendentes = fila.filter((f) => f.estado === 'esperando' || (f.estado === 'erro' && validarArquivo({ nome: f.arquivo.name, tamanho: f.arquivo.size, tipo: f.arquivo.type }).ok));
    // O botão fica sempre ativo: o que faltar aparece no próprio campo, e o foco vai até ele.
    const faltando = conferirEnvioDocumentos({ categoria, arquivosProntos: pendentes.length });
    setErrosCampo(faltando);
    if (faltando.categoria) { document.getElementById(idCategoria)?.focus(); return; }
    if (faltando.arquivos) { formRef.current?.querySelector<HTMLElement>('[data-zona-envio] input')?.focus(); return; }
    setEnviando(true); setErro(null);
    let ok = 0;
    for (const item of pendentes) {
      setFila((f) => f.map((x) => (x.chave === item.chave ? { ...x, estado: 'enviando', erro: undefined } : x)));
      try {
        await enviarUm(item);
        ok++;
        setFila((f) => f.map((x) => (x.chave === item.chave ? { ...x, estado: 'ok' } : x)));
      } catch (e) {
        const m = e instanceof Error ? e.message : 'Falha no envio.';
        setFila((f) => f.map((x) => (x.chave === item.chave ? { ...x, estado: 'erro', erro: m } : x)));
      }
    }
    setEnviando(false);
    if (ok) {
      setMsg(ok === 1 ? 'Documento enviado ao escritório.' : `${ok} documentos enviados ao escritório.`);
      setObservacao(''); setPendenciaSel('');
      carregar(empresaId);
    }
    if (ok < pendentes.length) setErro('Alguns arquivos não foram enviados. Veja o motivo na lista.');
  }

  // ------------------------------------------------------------------ ações
  async function acaoDoc(d: Documento, acao: 'conferir' | 'desconferir') {
    try {
      await fetch('/api/documentos', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: d.id, acao }),
      }).then(lerJson);
      setMsg(acao === 'conferir' ? 'Documento aceito.' : 'O documento voltou para "a conferir".');
      carregar(empresaId);
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha.'); }
  }

  /** Devolver com motivo: o cliente vê o motivo e recebe o aviso. Desfazer = voltar para "a conferir". */
  async function devolverDoc(d: Documento, motivo: string) {
    await fetch('/api/documentos', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: d.id, acao: 'devolver', motivo }),
    }).then(lerJson);
    setDevolvendo(null);
    setDesfazer({ texto: `"${d.nome}" devolvido. A empresa já vê o motivo.`, url: '/api/documentos', corpo: { id: d.id, acao: 'desconferir' } });
    carregar(empresaId);
  }

  /** "Não tenho este mês": o pedido sai de aberto, com a observação opcional. */
  async function marcarSemMovimento(p: Pendencia, observacao: string) {
    await fetch('/api/pendencias', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, acao: 'nao-tenho', observacao }),
    }).then(lerJson);
    setSemMovimento(null);
    setDesfazer({ texto: `Pedido "${p.titulo}" respondido: não houve este mês.`, url: '/api/pendencias', corpo: { id: p.id, acao: 'desfazer-nao-tenho' } });
    carregar(empresaId);
  }

  async function desfazerSemMovimento(p: Pendencia) {
    try {
      await fetch('/api/pendencias', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, acao: 'desfazer-nao-tenho' }),
      }).then(lerJson);
      setMsg('O pedido voltou a ficar aberto.');
      carregar(empresaId);
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha.'); }
  }

  /** Reenviar um documento devolvido: o formulário vem com a categoria, a competência e o pedido dele. */
  function reenviar(d: Documento) {
    setCategoria(d.categoria);
    setCompetencia(d.competencia);
    const pedidoAberto = (pendencias ?? []).find((p) => p.id === d.pendenciaId && p.status === 'aberta');
    setPendenciaSel(pedidoAberto?.id ?? '');
    setErrosCampo({});
    formRef.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    formRef.current?.querySelector<HTMLElement>('[data-zona-envio] input')?.focus({ preventScroll: true });
  }

  async function excluirDoc(d: Documento) {
    setExcluindoDoc(null);
    try {
      await fetch(`/api/documentos?id=${encodeURIComponent(d.id)}`, { method: 'DELETE' }).then(lerJson);
      setDesfazer({ texto: `"${d.nome}" excluído.`, url: '/api/documentos', corpo: { id: d.id, acao: 'restaurar' } });
      carregar(empresaId);
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha.'); }
  }

  async function acaoPend(p: Pendencia, acao: 'fechar' | 'reabrir') {
    try {
      await fetch('/api/pendencias', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, acao }),
      }).then(lerJson);
      setMsg(acao === 'fechar' ? 'Pendência marcada como atendida.' : 'Pendência reaberta.');
      carregar(empresaId);
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha.'); }
  }

  async function excluirPend(p: Pendencia) {
    setExcluindoPend(null);
    try {
      await fetch(`/api/pendencias?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' }).then(lerJson);
      setDesfazer({ texto: `Pendência "${p.titulo}" excluída.`, url: '/api/pendencias', corpo: { id: p.id, acao: 'restaurar' } });
      carregar(empresaId);
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha.'); }
  }

  async function desfazerExclusao() {
    if (!desfazer) return;
    const alvo = desfazer;
    setDesfazer(null);
    try {
      await fetch(alvo.url, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(alvo.corpo),
      }).then(lerJson);
      setMsg('Desfeito.');
      carregar(empresaId);
      setVersaoEntregas((v) => v + 1);
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha.'); }
  }

  const docsFiltrados = (documentos ?? []).filter((d) => !filtroComp || d.competencia === filtroComp);
  const nomePendencia = (id: string | null) => (pendencias ?? []).find((p) => p.id === id)?.titulo;

  // ------------------------------------------------------------------ tela
  return (
    <div className="text-sm">
      <CabecalhoPagina
        titulo="Documentos"
        subtitulo={gestor
          ? 'O que as empresas enviaram e o que o escritório pediu.'
          : `Envie notas, extratos e recibos ao escritório${empresa ? ` — ${empresa.nome}` : ''}.`}
        acoes={gestor && empresas.length > 0 ? (
          <Selecao aria-label="Empresa" valor={empresaSel} onChange={trocarEmpresa} largura="w-full sm:w-72"
            opcoes={empresas.map((e) => ({ valor: e.id, rotulo: e.nome }))} />
        ) : undefined}
      />

      <Toasts>
        {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
        {msg && <Toast onFechar={() => setMsg(null)}>{msg}</Toast>}
        {desfazer && (
          <Toast tom="info" onFechar={() => setDesfazer(null)}
            acao={<Botao tamanho="sm" variante="tonal" icone={<IconeDesfazer />} onClick={desfazerExclusao}>Desfazer</Botao>}>
            {desfazer.texto}
          </Toast>
        )}
      </Toasts>

      <Conteudo largura="media">
        {me && gestor && <FaixaArquivada empresa={empresas.find((e) => e.id === empresaSel)} />}
        {me && gestor && empresas.length > 0 && (
          <NaoAbertas hoje={hoje} recarregar={versaoEntregas}
            onEscolherEmpresa={(id) => { if (empresas.some((e) => e.id === id)) trocarEmpresa(id); }} />
        )}
        {falha && (
          <FalhaCarregamento titulo={falha.de === 'inicio' ? 'Não foi possível abrir os documentos.' : 'Não foi possível carregar os documentos desta empresa.'}
            onTentar={() => (falha.de === 'inicio' ? iniciar() : void carregar(falha.id ?? ''))}>{falha.msg}</FalhaCarregamento>
        )}
        {!me && !falha && <Carregando />}
        {me && gestor && empresas.length === 0 && (
          <EstadoVazio titulo="Nenhuma empresa cadastrada" descricao="Cadastre uma empresa-cliente para receber documentos dela."
            acao={<a href="/cadastros" className="text-primaria-texto underline">Ir para o cadastro</a>} />
        )}
        {semTabela && (
          <Aviso tom="aviso" titulo="Módulo ainda não instalado">
            As tabelas de documentos ainda não existem no banco. O administrador precisa aplicar a migração 0015.
          </Aviso>
        )}

        {me && empresaId && !semTabela && (
          <>
            {/* ---------------------------------------- do escritório para a empresa (0032) */}
            <Entregas key={empresaId} gestor={gestor} empresaId={empresaId} somenteLeitura={Boolean(empresa?.arquivadaEm)}
              hoje={hoje} competencias={competencias} onMsg={(m) => { setMsg(m); setVersaoEntregas((v) => v + 1); }} onErro={setErro}
              onDesfazivel={(d) => { setDesfazer(d); setVersaoEntregas((v) => v + 1); }} />

            {/* ---------------------------------------------- pendências */}
            <Secao
              titulo={gestor ? 'Pendências da empresa' : 'O escritório está pedindo'}
              descricao={pendencias === null ? undefined : abertas.length
                ? `${abertas.length} ${abertas.length === 1 ? 'pendência aberta' : 'pendências abertas'}${vencidas ? `, ${vencidas} com prazo vencido` : ''}.`
                : 'Nada pendente agora.'}
              acoes={gestor ? (
                <Botao variante="tonal" tamanho="sm" icone={<IconeMais />} onClick={() => setEditandoPend('nova')}>Nova pendência</Botao>
              ) : undefined}>
              {pendencias === null ? (falha ? null : <Carregando className="p-4" />) : (
                <ListaPendencias
                  abertas={abertas} atendidas={atendidas} hoje={hoje} gestor={gestor}
                  onAtender={atender} onEditar={(p) => setEditandoPend(p)} onFechar={(p) => acaoPend(p, 'fechar')}
                  onReabrir={(p) => acaoPend(p, 'reabrir')} onExcluir={setExcluindoPend}
                  onNaoTenho={setSemMovimento} onDesfazerNaoTenho={desfazerSemMovimento}
                />
              )}
            </Secao>

            {/* ---------------------------------------------- envio */}
            <div ref={formRef}>
              <Secao titulo="Enviar documentos"
                descricao={`${TIPOS_TEXTO}. Até ${LIMITE_TEXTO} por arquivo.`}>
                {/* A Secao já dá o respiro: sem um segundo padding (no celular apertava os campos). */}
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Selecao rotulo="Mês de referência" valor={competencia} onChange={setCompetencia}
                      dica="O mês a que os documentos se referem."
                      opcoes={competencias.map((c) => ({ valor: c, rotulo: competenciaBR(c) }))} />
                    <Selecao id={idCategoria} rotulo="Tipo de documento" valor={categoria}
                      onChange={(v) => { setCategoria(v as Categoria); setErrosCampo((e) => ({ ...e, categoria: undefined })); }}
                      placeholder="Escolha o tipo" erro={errosCampo.categoria} opcoes={opcoesCategoria} />
                    {abertas.length > 0 && (
                      <Selecao rotulo="Atende a pendência" valor={pendenciaSel} onChange={setPendenciaSel} classeCampo="sm:col-span-2"
                        opcoes={[{ valor: '', rotulo: 'Nenhuma — envio avulso' }, ...abertas.map((p) => ({ valor: p.id, rotulo: p.titulo }))]} />
                    )}
                    <Entrada rotulo="Observação (opcional)" value={observacao} maxLength={500} classeCampo="sm:col-span-2"
                      placeholder="Ex.: notas de compra da filial" onChange={(e) => setObservacao(e.target.value)} />
                  </div>

                  <ZonaEnvio onArquivos={adicionarArquivos} desabilitado={enviando} erro={errosCampo.arquivos} />

                  {fila.length > 0 && <FilaEnvio fila={fila} onRemover={(k) => setFila((f) => f.filter((x) => x.chave !== k))} enviando={enviando} />}

                  <div>
                    <Botao variante="primaria" tamanho="lg" className="w-full sm:w-auto" carregando={enviando} onClick={enviar}>
                      Enviar ao escritório
                    </Botao>
                  </div>
                </div>
              </Secao>
            </div>

            {/* ---------------------------------------------- enviados */}
            <Secao titulo={gestor ? 'Documentos recebidos' : 'O que você já enviou'}
              acoes={(
                <Selecao aria-label="Filtrar por competência" tamanho="sm" largura="w-40" valor={filtroComp} onChange={setFiltroComp}
                  opcoes={[{ valor: '', rotulo: 'Todos os meses' }, ...competencias.map((c) => ({ valor: c, rotulo: competenciaBR(c) }))]} />
              )}>
              {documentos === null ? (falha ? null : <Carregando className="p-4" />) : docsFiltrados.length === 0 ? (
                <EstadoVazio moldura={false} icone={<IconeDocumento size={22} />}
                  titulo={filtroComp ? `Nada enviado em ${competenciaBR(filtroComp)}` : 'Nenhum documento ainda'}
                  descricao={gestor ? 'Quando a empresa enviar, os arquivos aparecem aqui.' : 'Os arquivos que você enviar aparecem aqui.'} />
              ) : (
                <>
                {/* Cliente no celular (abaixo de 640 px): cartões em vez da tabela que rola de lado. */}
                {!gestor && (
                  <ul className="divide-y divide-borda sm:hidden" aria-label="Documentos que você já enviou">
                    {docsFiltrados.map((d) => (
                      <li key={d.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                        <div className="flex items-start justify-between gap-3">
                          <a href={`/api/documentos/arquivo?id=${encodeURIComponent(d.id)}`}
                            className="inline-flex min-h-11 min-w-0 items-center gap-1.5 font-medium text-primaria-texto hover:underline">
                            <IconeBaixar size={14} className="shrink-0" />
                            <span className="break-all">{d.nome}</span>
                          </a>
                          <Selo tom={TOM_STATUS[d.status]}>{rotuloStatus(d.status, false)}</Selo>
                        </div>
                        <p className="text-[13px] text-tinta-suave">
                          {ROTULO_CATEGORIA[d.categoria]} · {competenciaBR(d.competencia)} · enviado em {dataBR(d.enviadoEm)} · {tamanhoBR(d.tamanho)}
                          {d.pendenciaId && nomePendencia(d.pendenciaId) ? ` · atende: ${nomePendencia(d.pendenciaId)}` : ''}
                          {d.observacao ? ` · ${d.observacao}` : ''}
                        </p>
                        {d.status === 'devolvido' && d.motivoDevolucao && (
                          <p className="text-[13px] text-perigo">Motivo: {d.motivoDevolucao}</p>
                        )}
                        {(d.status === 'devolvido' || d.status === 'recebido') && (
                          <div className="flex flex-wrap gap-2">
                            {d.status === 'devolvido' && (
                              <Botao tamanho="sm" variante="tonal" aria-label={`Enviar de novo: ${d.nome}`} onClick={() => reenviar(d)}>Enviar de novo</Botao>
                            )}
                            {d.status === 'recebido' && (
                              <Botao tamanho="sm" variante="fantasma" className="text-perigo" icone={<IconeExcluir size={14} />}
                                aria-label={`Excluir ${d.nome}`} onClick={() => setExcluindoDoc(d)}>Excluir</Botao>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <div className={cx('relative overflow-x-auto', !gestor && 'hidden sm:block')}>
                  <table className={tb.tabela}>
                    <caption className="sr-only">{gestor ? 'Documentos recebidos' : 'Documentos que você já enviou'}</caption>
                    <thead className={tb.cabeca}>
                      <tr>
                        <th className={tb.th}>Arquivo</th>
                        <th className={tb.th}>Categoria</th>
                        <th className={tb.th}>Competência</th>
                        <th className={tb.th}>Enviado</th>
                        <th className={tb.th}>Situação</th>
                        <th className={tb.th}><span className="sr-only">Ações</span></th>
                      </tr>
                    </thead>
                    <tbody className={tb.corpo}>
                      {docsFiltrados.map((d) => (
                        <tr key={d.id} className={tb.linha}>
                          <td className={tb.td}>
                            <a href={`/api/documentos/arquivo?id=${encodeURIComponent(d.id)}`}
                              className="inline-flex min-h-11 max-w-[18rem] items-center gap-1.5 font-medium text-primaria-texto hover:underline sm:min-h-0">
                              <IconeBaixar size={14} className="shrink-0" />
                              <span className="truncate">{d.nome}</span>
                            </a>
                            <div className="text-xs text-tinta-suave">
                              {tamanhoBR(d.tamanho)}
                              {d.pendenciaId && nomePendencia(d.pendenciaId) ? ` · atende: ${nomePendencia(d.pendenciaId)}` : ''}
                              {d.observacao ? ` · ${d.observacao}` : ''}
                            </div>
                          </td>
                          <td className={cx(tb.td, 'whitespace-nowrap')}>{ROTULO_CATEGORIA[d.categoria]}</td>
                          <td className={cx(tb.td, 'whitespace-nowrap')}>{competenciaBR(d.competencia)}</td>
                          <td className={cx(tb.td, 'whitespace-nowrap text-tinta-suave')}>
                            {dataBR(d.enviadoEm)}
                            {gestor && <div className="text-xs">{d.enviadoPor}</div>}
                          </td>
                          <td className={tb.td}>
                            <Selo tom={TOM_STATUS[d.status]}>{rotuloStatus(d.status, gestor)}</Selo>
                            {d.status === 'devolvido' && d.motivoDevolucao && (
                              <div className="mt-1 max-w-[16rem] whitespace-normal text-xs text-perigo">Motivo: {d.motivoDevolucao}</div>
                            )}
                          </td>
                          <td className={cx(tb.td, 'whitespace-nowrap text-right')}>
                            {!gestor && d.status === 'devolvido' && (
                              <Botao tamanho="sm" variante="tonal" aria-label={`Enviar de novo: ${d.nome}`} onClick={() => reenviar(d)}>Enviar de novo</Botao>
                            )}
                            {gestor && d.status === 'recebido' && (
                              <>
                                <BotaoIcone rotulo={`Aceitar ${d.nome}`} title="Aceitar" tom="sucesso" onClick={() => acaoDoc(d, 'conferir')}>
                                  <IconeCheck />
                                </BotaoIcone>
                                <BotaoIcone rotulo={`Devolver ${d.nome} ao cliente`} title="Devolver com motivo" tom="perigo" onClick={() => setDevolvendo(d)}>
                                  <IconeAlerta />
                                </BotaoIcone>
                              </>
                            )}
                            {gestor && (d.status === 'conferido' || d.status === 'devolvido') && (
                              <BotaoIcone rotulo={`Voltar ${d.nome} para a conferir`} title={d.status === 'conferido' ? 'Desfazer o aceite' : 'Desfazer a devolução'}
                                tom="apagado" onClick={() => acaoDoc(d, 'desconferir')}>
                                <IconeDesfazer />
                              </BotaoIcone>
                            )}
                            {(gestor || d.status === 'recebido') && (
                              <BotaoIcone rotulo={`Excluir ${d.nome}`} title="Excluir" tom="perigo" onClick={() => setExcluindoDoc(d)}>
                                <IconeExcluir />
                              </BotaoIcone>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </>
              )}
            </Secao>
          </>
        )}
      </Conteudo>

      {excluindoDoc && (
        <DialogoConfirmacao titulo="Excluir documento?"
          mensagem={<>O arquivo <strong>{excluindoDoc.nome}</strong> sai da lista. Você poderá desfazer logo em seguida.</>}
          onConfirmar={() => excluirDoc(excluindoDoc)} onCancelar={() => setExcluindoDoc(null)} />
      )}
      {excluindoPend && (
        <DialogoConfirmacao titulo="Excluir pendência?"
          mensagem={<>A pendência <strong>{excluindoPend.titulo}</strong> some para a empresa. Você poderá desfazer logo em seguida.</>}
          onConfirmar={() => excluirPend(excluindoPend)} onCancelar={() => setExcluindoPend(null)} />
      )}
      {devolvendo && (
        <DialogoTexto titulo="Devolver documento ao cliente"
          descricao={<>Diga o que precisa ser corrigido em <strong>{devolvendo.nome}</strong>. A empresa vê o motivo e recebe o aviso.</>}
          rotulo="Motivo" obrigatorio max={MAX_MOTIVO_DEVOLUCAO} placeholder="Ex.: a foto está cortada; mande o extrato do mês inteiro"
          textoConfirmar="Devolver ao cliente"
          validar={(v) => { const m = motivoDevolucao(v); return m.ok ? null : m.erro; }}
          onCancelar={() => setDevolvendo(null)} onConfirmar={(motivo) => devolverDoc(devolvendo, motivo)} />
      )}
      {semMovimento && (
        <DialogoTexto titulo={semMovimento.competencia ? 'Não tem este mês?' : 'Não tem este documento?'}
          descricao={<>O pedido <strong>{semMovimento.titulo}</strong>{semMovimento.competencia ? ` (${competenciaBR(semMovimento.competencia)})` : ''} sai da lista de pendências. A contabilidade vê a sua resposta.</>}
          rotulo="Observação (opcional)" max={MAX_OBS_SEM_MOVIMENTO} placeholder="Ex.: a empresa não teve movimento no banco"
          textoConfirmar="Confirmar"
          onCancelar={() => setSemMovimento(null)} onConfirmar={(obs) => marcarSemMovimento(semMovimento, obs)} />
      )}
      {editandoPend && (
        <DialogoPendencia
          pendencia={editandoPend === 'nova' ? null : editandoPend} empresaId={empresaId} competencias={competencias}
          onCancelar={() => setEditandoPend(null)}
          onSalvo={(texto) => { setEditandoPend(null); setMsg(texto); carregar(empresaId); }}
          onErro={setErro}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------------- partes

function ListaPendencias({ abertas, atendidas, hoje, gestor, onAtender, onEditar, onFechar, onReabrir, onExcluir, onNaoTenho, onDesfazerNaoTenho }: {
  abertas: Pendencia[]; atendidas: Pendencia[]; hoje: string; gestor: boolean;
  onAtender: (p: Pendencia) => void; onEditar: (p: Pendencia) => void; onFechar: (p: Pendencia) => void;
  onReabrir: (p: Pendencia) => void; onExcluir: (p: Pendencia) => void;
  onNaoTenho: (p: Pendencia) => void; onDesfazerNaoTenho: (p: Pendencia) => void;
}) {
  const [verAtendidas, setVerAtendidas] = useState(false);
  if (!abertas.length && !atendidas.length) {
    return (
      <EstadoVazio moldura={false} titulo={gestor ? 'Nenhuma pendência' : 'Tudo em dia'}
        descricao={gestor ? 'Peça à empresa o que falta: extrato, nota, recibo…' : 'Quando o escritório precisar de algo, aparece aqui.'} />
    );
  }
  const linha = (p: Pendencia) => {
    const prazo = situacaoPrazo(p.prazo, hoje);
    return (
      <li key={p.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-tinta">{p.titulo}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-tinta-suave">
            {p.categoria && <span>{ROTULO_CATEGORIA[p.categoria]}</span>}
            {p.competencia && <span>· {competenciaBR(p.competencia)}</span>}
            {p.status === 'aberta' && p.prazo && (
              <Selo tom={prazo === 'vencida' ? 'perigo' : prazo === 'vence-logo' ? 'aviso' : 'neutro'}>
                {prazo === 'vencida' ? `Venceu em ${diaBR(p.prazo)}` : prazo === 'vence-logo' ? `Vence logo: ${diaBR(p.prazo)}` : `Até ${diaBR(p.prazo)}`}
              </Selo>
            )}
            {p.status === 'atendida' && (p.semMovimentoEm
              ? <Selo tom="neutro">Não teve este mês · {dataBR(p.semMovimentoEm)}</Selo>
              : <Selo tom="sucesso">Atendida{p.atendidaEm ? ` em ${dataBR(p.atendidaEm)}` : ''}</Selo>)}
          </div>
          {p.descricao && <p className="mt-1 whitespace-pre-line text-[13px] text-tinta-suave">{p.descricao}</p>}
          {p.semMovimentoEm && p.semMovimentoObs && <p className="mt-1 text-[13px] text-tinta-suave">Observação: {p.semMovimentoObs}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {p.status === 'aberta' && !gestor && (
            <>
              <Botao tamanho="sm" variante="tonal" aria-label={`Enviar agora: ${p.titulo}`} onClick={() => onAtender(p)}>Enviar agora</Botao>
              <Botao tamanho="sm" variante="fantasma" aria-label={`Não tenho: ${p.titulo}`} onClick={() => onNaoTenho(p)}>
                {p.competencia ? 'Não tenho este mês' : 'Não tenho'}
              </Botao>
            </>
          )}
          {p.status === 'atendida' && p.semMovimentoEm && !gestor && (
            <BotaoIcone rotulo={`Desfazer a resposta: ${p.titulo}`} title="Desfazer" tom="apagado" onClick={() => onDesfazerNaoTenho(p)}>
              <IconeDesfazer />
            </BotaoIcone>
          )}
          {gestor && p.status === 'aberta' && (
            <>
              <BotaoIcone rotulo="Editar" tom="apagado" onClick={() => onEditar(p)}><IconeLapis /></BotaoIcone>
              <BotaoIcone rotulo="Marcar como atendida" tom="sucesso" onClick={() => onFechar(p)}><IconeCheck /></BotaoIcone>
            </>
          )}
          {gestor && p.status === 'atendida' && (
            <BotaoIcone rotulo="Reabrir" tom="apagado" onClick={() => onReabrir(p)}><IconeDesfazer /></BotaoIcone>
          )}
          {gestor && <BotaoIcone rotulo="Excluir" tom="perigo" onClick={() => onExcluir(p)}><IconeExcluir /></BotaoIcone>}
        </div>
      </li>
    );
  };
  return (
    <div>
      {abertas.length > 0 && <ul className="divide-y divide-borda/70">{abertas.map(linha)}</ul>}
      {atendidas.length > 0 && (
        <div className={cx(abertas.length > 0 && 'border-t border-borda')}>
          <button type="button" onClick={() => setVerAtendidas((v) => !v)} aria-expanded={verAtendidas}
            className="min-h-11 w-full px-4 py-2.5 text-left text-[13px] font-medium text-primaria-texto hover:bg-superficie-realce sm:min-h-0 sm:px-5">
            {verAtendidas ? 'Esconder atendidas' : `Ver atendidas (${atendidas.length})`}
          </button>
          {verAtendidas && <ul className="divide-y divide-borda/70 border-t border-borda">{atendidas.map(linha)}</ul>}
        </div>
      )}
    </div>
  );
}

/** Área de envio: clicar, arrastar (vários arquivos) ou, no celular, tirar foto. */
function ZonaEnvio({ onArquivos, desabilitado, erro }: { onArquivos: (f: FileList | null) => void; desabilitado: boolean; erro?: string }) {
  const id = useId();
  const idErro = `${id}-erro`;
  const [sobre, setSobre] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <label htmlFor={id} data-zona-envio tabIndex={-1}
        onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
        onDragLeave={() => setSobre(false)}
        onDrop={(e) => { e.preventDefault(); setSobre(false); if (!desabilitado) onArquivos(e.dataTransfer.files); }}
        className={cx(
          'flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-foco',
          sobre ? 'border-primaria bg-primaria-suave' : erro ? 'border-perigo bg-superficie' : 'border-borda-forte bg-superficie hover:border-primaria hover:bg-superficie-realce',
          desabilitado && 'pointer-events-none opacity-60',
        )}>
        <input id={id} type="file" multiple accept={ACCEPT} className="sr-only" disabled={desabilitado}
          aria-describedby={erro ? idErro : undefined} aria-invalid={erro ? true : undefined}
          onChange={(e) => { onArquivos(e.target.files); e.target.value = ''; }} />
        <IconeBaixar size={22} className="rotate-180 text-primaria-texto" />
        {/* No celular não há arrastar nem clicar: o texto fala em tocar. */}
        <span className="font-medium text-tinta">
          <span className="sm:hidden">Toque aqui para escolher os arquivos</span>
          <span className="max-sm:hidden">Arraste os arquivos aqui ou clique para escolher</span>
        </span>
        <span className="text-xs text-tinta-suave">Pode mandar vários de uma vez.</span>
      </label>
      {erro && <p id={idErro} role="alert" className="text-xs font-medium text-perigo">{erro}</p>}
      <div className="sm:hidden">
        <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1}
          aria-hidden="true" onChange={(e) => { onArquivos(e.target.files); e.target.value = ''; }} />
        <Botao className="w-full" disabled={desabilitado} onClick={() => camera.current?.click()}>Tirar foto do documento</Botao>
      </div>
    </div>
  );
}

function FilaEnvio({ fila, onRemover, enviando }: { fila: ItemFila[]; onRemover: (k: string) => void; enviando: boolean }) {
  const selo: Record<EstadoFila, [Tom, string]> = {
    esperando: ['neutro', 'Pronto'], enviando: ['primaria', 'Enviando…'], ok: ['sucesso', 'Enviado'], erro: ['perigo', 'Não enviado'],
  };
  return (
    <ul className="divide-y divide-borda/70 rounded-lg border border-borda" aria-live="polite">
      {fila.map((f) => (
        <li key={f.chave} className="flex items-center gap-3 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-tinta">{f.arquivo.name}</div>
            <div className={cx('text-xs', f.erro ? 'text-perigo' : 'text-tinta-suave')}>{f.erro ?? tamanhoBR(f.arquivo.size)}</div>
          </div>
          <Selo tom={selo[f.estado][0]}>{selo[f.estado][1]}</Selo>
          {f.estado !== 'enviando' && f.estado !== 'ok' && (
            <BotaoIcone rotulo={`Tirar ${f.arquivo.name} da lista`} title="Tirar da lista" tom="apagado" tamanho="sm" disabled={enviando} onClick={() => onRemover(f.chave)}>
              <IconeExcluir size={14} />
            </BotaoIcone>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Diálogo de um texto (motivo da devolução, observação do "não tenho"): erro no campo, foco nele. */
function DialogoTexto({ titulo, descricao, rotulo, placeholder, max, obrigatorio = false, textoConfirmar, validar, onCancelar, onConfirmar }: {
  titulo: string; descricao: React.ReactNode; rotulo: string; placeholder?: string; max: number; obrigatorio?: boolean;
  textoConfirmar: string; validar?: (v: string) => string | null;
  onCancelar: () => void; onConfirmar: (v: string) => Promise<void>;
}) {
  const id = useId();
  const [valor, setValor] = useState('');
  const [erro, setErro] = useState<string | undefined>();
  const [salvando, setSalvando] = useState(false);

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    const problema = validar?.(valor) ?? null;
    if (problema) { setErro(problema); document.getElementById(`${id}-campo`)?.focus(); return; }
    setSalvando(true);
    try { await onConfirmar(valor.trim()); } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível concluir. Tente de novo.');
      setSalvando(false);
    }
  }

  return (
    <Modal onFechar={onCancelar} rotuladoPor={id} largura="max-w-lg">
      <form onSubmit={confirmar} noValidate>
        <div className="space-y-4 p-5">
          <h2 id={id} className="text-base font-semibold text-tinta">{titulo}</h2>
          <p className="text-sm leading-relaxed text-tinta-suave">{descricao}</p>
          <AreaTexto id={`${id}-campo`} rotulo={rotulo} value={valor} maxLength={max} rows={3} placeholder={placeholder}
            required={obrigatorio} erro={erro} data-foco-inicial=""
            onChange={(e) => { setValor(e.target.value); setErro(undefined); }} />
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-borda bg-superficie-suave px-5 py-3 sm:flex-row sm:justify-end">
          <Botao onClick={onCancelar}>Cancelar</Botao>
          <Botao type="submit" variante="primaria" carregando={salvando}>{textoConfirmar}</Botao>
        </div>
      </form>
    </Modal>
  );
}

function DialogoPendencia({ pendencia, empresaId, competencias, onCancelar, onSalvo, onErro }: {
  pendencia: Pendencia | null; empresaId: string; competencias: string[];
  onCancelar: () => void; onSalvo: (texto: string) => void; onErro: (m: string) => void;
}) {
  const id = useId();
  const [titulo, setTitulo] = useState(pendencia?.titulo ?? '');
  const [descricao, setDescricao] = useState(pendencia?.descricao ?? '');
  const [categoria, setCategoria] = useState<string>(pendencia?.categoria ?? '');
  const [competencia, setCompetencia] = useState(pendencia?.competencia ?? '');
  const [prazo, setPrazo] = useState(pendencia?.prazo ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erroTitulo, setErroTitulo] = useState<string | undefined>();

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim()) { setErroTitulo('Diga o que a empresa precisa enviar.'); return; }
    setSalvando(true);
    try {
      const campos = { titulo, descricao, categoria: categoria || null, competencia: competencia || null, prazo: prazo || null };
      await fetch('/api/pendencias', {
        method: pendencia ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pendencia ? { id: pendencia.id, acao: 'editar', ...campos } : { empresa: empresaId, ...campos }),
      }).then(lerJson);
      onSalvo(pendencia ? 'Pendência atualizada.' : 'Pendência aberta. A empresa já vê o pedido.');
    } catch (err) {
      onErro(err instanceof Error ? err.message : 'Falha ao salvar.');
      setSalvando(false);
    }
  }

  return (
    <Modal onFechar={onCancelar} rotuladoPor={id} largura="max-w-lg">
      <form onSubmit={salvar}>
        <div className="space-y-4 p-5">
          <h2 id={id} className="text-base font-semibold text-tinta">{pendencia ? 'Editar pendência' : 'Nova pendência'}</h2>
          <Entrada rotulo="O que a empresa precisa enviar" value={titulo} maxLength={200} erro={erroTitulo} data-foco-inicial=""
            placeholder="Ex.: extrato de outubro do Banco do Brasil"
            onChange={(e) => { setTitulo(e.target.value); setErroTitulo(undefined); }} />
          <AreaTexto rotulo="Detalhes (opcional)" value={descricao} maxLength={2000} rows={3}
            onChange={(e) => setDescricao(e.target.value)} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Selecao rotulo="Categoria" valor={categoria} onChange={setCategoria}
              opcoes={[{ valor: '', rotulo: 'Qualquer' }, ...opcoesCategoria]} />
            <Selecao rotulo="Competência" valor={competencia} onChange={setCompetencia}
              opcoes={[{ valor: '', rotulo: 'Qualquer' }, ...competencias.map((c) => ({ valor: c, rotulo: competenciaBR(c) }))]} />
            <Entrada rotulo="Prazo" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-borda bg-superficie-suave px-5 py-3 sm:flex-row sm:justify-end">
          <Botao onClick={onCancelar}>Cancelar</Botao>
          <Botao type="submit" variante="primaria" carregando={salvando}>{pendencia ? 'Salvar' : 'Abrir pendência'}</Botao>
        </div>
      </form>
    </Modal>
  );
}
