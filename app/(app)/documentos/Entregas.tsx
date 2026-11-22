'use client';

// Documentos que o ESCRITÓRIO publica para a empresa (guia, DAS, holerite, declaração…),
// com protocolo de leitura. Migração 0032; ver docs/documentos.md (Sprint 17 · Frente A).
//
// - Cliente: vê, baixa (o primeiro download dele grava "aberto em …") — `Entregas`.
// - Contabilidade: publica, vê quem abriu e quem não abriu (com destaque perto do
//   vencimento), exclui com confirmação + desfazer — `Entregas` com `gestor`; e o
//   resumo do escritório inteiro ("ainda não abertos") — `NaoAbertas`.
// A tela só esconde botões; quem decide de verdade são as rotas (/api/entregas).
import { useCallback, useEffect, useId, useState } from 'react';
import { ACCEPT, competenciaBR, LIMITE_TEXTO, tamanhoBR, TIPOS_TEXTO, validarArquivo } from '@/lib/documentos';
import {
  nomeEntrega, ROTULO_TIPO_ENTREGA, situacaoEntrega, TIPOS_ENTREGA, type ErrosEntrega, type SituacaoEntrega,
  type TipoEntrega,
} from '@/lib/entregas';
import { DialogoConfirmacao, Modal } from '../Dialogo';
import { IconeBaixar, IconeDocumento, IconeExcluir, IconeMais } from '../icones';
import { Aviso, Botao, BotaoIcone, CampoArquivo, Carregando, EstadoVazio, Entrada, Secao, Selo, type Tom } from '@/components/ui';
import { Selecao } from '@/components/selecao';

export interface EntregaTela {
  id: string; empresaId: string; tipo: TipoEntrega; titulo: string | null; competencia: string; vencimento: string | null;
  observacao: string | null; nome: string; tamanho: number; publicadoPor: string; publicadoEm: string;
  abertoEm: string | null; abertoPor: string | null; empresaNome?: string;
}

/** O que desfazer depois de uma ação (a página mostra o toast com o botão). */
export interface Desfazivel { texto: string; url: string; corpo: Record<string, unknown> }

const diaBR = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const quandoBR = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Belem', dateStyle: 'short', timeStyle: 'short' });

const SELO_SITUACAO: Record<SituacaoEntrega, Tom> = { aberta: 'sucesso', 'nao-aberta': 'neutro', 'vence-logo': 'aviso', vencida: 'perigo' };

/** "Vence em 20/11" / "Venceu em 10/11" — o vencimento como o cliente lê. */
function textoVencimento(e: Pick<EntregaTela, 'vencimento'>, hoje: string): string | null {
  if (!e.vencimento) return null;
  return e.vencimento < hoje ? `Venceu em ${diaBR(e.vencimento)}` : e.vencimento === hoje ? 'Vence hoje' : `Vence em ${diaBR(e.vencimento)}`;
}

async function lerResposta(r: Response) {
  const x = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(x.erro ?? 'Não foi possível concluir. Tente de novo.'), { status: r.status, campos: x.campos });
  return x;
}

/** Sem a migração 0032 a rota responde 503 com este recado. */
const semMigracao = (e: unknown) => (e as { status?: number })?.status === 503;

export function Entregas({ gestor, empresaId, somenteLeitura, hoje, competencias, onMsg, onErro, onDesfazivel }: {
  gestor: boolean; empresaId: string; somenteLeitura: boolean; hoje: string; competencias: string[];
  onMsg: (m: string) => void; onErro: (m: string) => void; onDesfazivel: (d: Desfazivel) => void;
}) {
  const [lista, setLista] = useState<EntregaTela[] | null>(null);
  const [indisponivel, setIndisponivel] = useState<string | null>(null);
  const [falhou, setFalhou] = useState<string | null>(null);
  const [publicando, setPublicando] = useState(false);
  const [excluindo, setExcluindo] = useState<EntregaTela | null>(null);

  const carregar = useCallback(async () => {
    try {
      const d = await fetch(`/api/entregas?empresa=${encodeURIComponent(empresaId)}`).then(lerResposta);
      setLista(d.entregas ?? []); setIndisponivel(null); setFalhou(null);
    } catch (e) {
      if (semMigracao(e)) { setIndisponivel(e instanceof Error ? e.message : ''); setLista([]); return; }
      setFalhou(e instanceof Error ? e.message : 'Não foi possível carregar.');
    }
  }, [empresaId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga da API ao montar/trocar de empresa
  useEffect(() => { void carregar(); }, [carregar]);

  async function excluir(e: EntregaTela) {
    setExcluindo(null);
    try {
      await fetch(`/api/entregas?id=${encodeURIComponent(e.id)}`, { method: 'DELETE' }).then(lerResposta);
      onDesfazivel({ texto: `"${nomeEntrega(e)}" excluído. A empresa deixa de ver.`, url: '/api/entregas', corpo: { id: e.id, acao: 'restaurar' } });
      void carregar();
    } catch (err) { onErro(err instanceof Error ? err.message : 'Falha.'); }
  }

  /** O cliente abriu: a tela já mostra como aberto (o servidor grava na mesma hora). */
  function abriu(e: EntregaTela) {
    if (gestor || e.abertoEm) return;
    setLista((l) => (l ?? []).map((x) => (x.id === e.id ? { ...x, abertoEm: new Date().toISOString() } : x)));
  }

  // Cliente sem a migração: a seção simplesmente não existe ainda.
  if (!gestor && indisponivel !== null) return null;

  const naoAbertas = (lista ?? []).filter((e) => !e.abertoEm).length;
  return (
    <Secao
      titulo={gestor ? 'Enviados à empresa' : 'Da contabilidade para você'}
      descricao={lista === null || indisponivel !== null ? undefined : gestor
        ? (lista.length ? `${lista.length} ${lista.length === 1 ? 'documento' : 'documentos'}${naoAbertas ? `, ${naoAbertas} ainda não ${naoAbertas === 1 ? 'baixado' : 'baixados'} pela empresa` : ', todos já baixados'}.` : 'Guias, DAS, holerites e declarações que você publicar aparecem aqui.')
        : (naoAbertas ? `${naoAbertas} ${naoAbertas === 1 ? 'documento novo' : 'documentos novos'} para baixar.` : 'Guias, holerites e declarações que a contabilidade enviar.')}
      acoes={gestor && indisponivel === null && !somenteLeitura ? (
        <Botao variante="tonal" tamanho="sm" icone={<IconeMais />} onClick={() => setPublicando(true)}>Publicar documento</Botao>
      ) : undefined}>
      {indisponivel !== null ? (
        <Aviso tom="aviso" titulo="Ainda não instalado">{indisponivel}</Aviso>
      ) : falhou ? (
        <Aviso tom="perigo" acao={<Botao tamanho="sm" onClick={() => void carregar()}>Tentar de novo</Botao>}>{falhou}</Aviso>
      ) : lista === null ? <Carregando className="p-4" /> : lista.length === 0 ? (
        <EstadoVazio moldura={false} icone={<IconeDocumento size={22} />}
          titulo={gestor ? 'Nada publicado para esta empresa' : 'Nenhum documento da contabilidade ainda'}
          descricao={gestor ? 'Publique a guia, o DAS ou o holerite: a empresa vê no portal e você sabe quando ela baixou.' : 'Quando a contabilidade enviar uma guia, um holerite ou uma declaração, aparece aqui.'} />
      ) : (
        <ul className="divide-y divide-borda/70">
          {lista.map((e) => {
            const sit = situacaoEntrega(e, hoje);
            const venc = textoVencimento(e, hoje);
            return (
              <li key={e.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                <div className="min-w-0 flex-1">
                  <a href={`/api/entregas/arquivo?id=${encodeURIComponent(e.id)}`} onClick={() => abriu(e)}
                    className="inline-flex min-h-11 max-w-full items-center gap-1.5 font-medium text-primaria-texto hover:underline sm:min-h-0">
                    <IconeBaixar size={14} className="shrink-0" />
                    <span className="break-words">Baixar {nomeEntrega(e)}</span>
                  </a>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-tinta-suave">
                    <span>{competenciaBR(e.competencia)}</span>
                    {venc && <Selo tom={sit === 'vencida' ? 'perigo' : sit === 'vence-logo' ? 'aviso' : 'neutro'}>{venc}</Selo>}
                    <span>· {e.nome} · {tamanhoBR(e.tamanho)}</span>
                  </div>
                  {e.observacao && <p className="mt-1 whitespace-pre-line text-[13px] text-tinta-suave">{e.observacao}</p>}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {gestor ? (
                    e.abertoEm
                      ? <Selo tom="sucesso">Baixado pela empresa em {quandoBR(e.abertoEm)}</Selo>
                      : <Selo tom={SELO_SITUACAO[sit]}>{sit === 'vencida' ? 'Não baixado · vencido' : sit === 'vence-logo' ? 'Não baixado · vence logo' : 'Ainda não baixado'}</Selo>
                  ) : !e.abertoEm && <Selo tom="primaria">Novo</Selo>}
                  {gestor && !somenteLeitura && (
                    <BotaoIcone rotulo={`Excluir ${nomeEntrega(e)}`} title="Excluir" tom="perigo" onClick={() => setExcluindo(e)}>
                      <IconeExcluir />
                    </BotaoIcone>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {excluindo && (
        <DialogoConfirmacao titulo="Excluir documento enviado?"
          mensagem={<><strong>{nomeEntrega(excluindo)}</strong> sai do portal da empresa. Você poderá desfazer logo em seguida.</>}
          onConfirmar={() => excluir(excluindo)} onCancelar={() => setExcluindo(null)} />
      )}
      {publicando && (
        <DialogoPublicar empresaId={empresaId} competencias={competencias}
          onCancelar={() => setPublicando(false)}
          onPublicado={() => { setPublicando(false); onMsg('Documento publicado. A empresa já vê no portal e recebe o aviso.'); void carregar(); }} />
      )}
    </Secao>
  );
}

function DialogoPublicar({ empresaId, competencias, onCancelar, onPublicado }: {
  empresaId: string; competencias: string[]; onCancelar: () => void; onPublicado: () => void;
}) {
  const id = useId();
  const [tipo, setTipo] = useState<TipoEntrega | ''>('');
  const [titulo, setTitulo] = useState('');
  const [competencia, setCompetencia] = useState(competencias[1] ?? competencias[0] ?? '');
  const [vencimento, setVencimento] = useState('');
  const [observacao, setObservacao] = useState('');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erros, setErros] = useState<ErrosEntrega & { arquivo?: string; geral?: string }>({});
  const [enviando, setEnviando] = useState(false);

  async function publicar(ev: React.FormEvent) {
    ev.preventDefault();
    const faltando: typeof erros = {};
    if (!tipo) faltando.tipo = 'Escolha o tipo do documento.';
    if (!arquivo) faltando.arquivo = 'Escolha o arquivo.';
    else {
      const v = validarArquivo({ nome: arquivo.name, tamanho: arquivo.size, tipo: arquivo.type });
      if (!v.ok) faltando.arquivo = v.erro;
    }
    setErros(faltando);
    if (Object.keys(faltando).length) {
      document.getElementById(faltando.tipo ? `${id}-tipo` : `${id}-arquivo`)?.focus();
      return;
    }
    setEnviando(true);
    try {
      const v = validarArquivo({ nome: arquivo!.name, tamanho: arquivo!.size, tipo: arquivo!.type });
      if (!v.ok) throw new Error(v.erro);
      // 1. o servidor valida, grava e devolve a URL de upload assinada
      const ini = await fetch('/api/entregas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empresa: empresaId, tipo, titulo, competencia, vencimento: vencimento || null, observacao,
          nome: arquivo!.name, tamanho: arquivo!.size, mime: arquivo!.type,
        }),
      }).then(lerResposta);
      // 2. o arquivo vai direto ao Storage, com o tipo que o servidor definiu
      const corpo = new FormData();
      corpo.append('cacheControl', '3600');
      corpo.append('', new File([arquivo!], v.nome, { type: ini.mime }));
      const up = await fetch(ini.url, { method: 'PUT', body: corpo, headers: { 'x-upsert': 'false' } });
      if (!up.ok) throw new Error('O arquivo não subiu. Confira a conexão e tente de novo.');
      // 3. o servidor confere os bytes e publica
      await fetch('/api/entregas', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ini.id, acao: 'confirmar' }),
      }).then(lerResposta);
      onPublicado();
    } catch (e) {
      const campos = (e as { campos?: typeof erros })?.campos;
      setErros(campos && Object.keys(campos).length ? campos : { geral: e instanceof Error ? e.message : 'Falha ao publicar.' });
      setEnviando(false);
    }
  }

  return (
    <Modal onFechar={onCancelar} rotuladoPor={id} largura="max-w-lg">
      <form onSubmit={publicar} noValidate>
        <div className="space-y-4 p-5">
          <h2 id={id} className="text-base font-semibold text-tinta">Publicar documento para a empresa</h2>
          <p className="text-[13px] text-tinta-suave">A empresa vê no portal, recebe o aviso no sino e você fica sabendo quando ela baixar.</p>
          {erros.geral && <Aviso tom="perigo">{erros.geral}</Aviso>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Selecao id={`${id}-tipo`} rotulo="Tipo" valor={tipo} placeholder="Escolha o tipo" erro={erros.tipo}
              onChange={(v) => { setTipo(v as TipoEntrega); setErros((x) => ({ ...x, tipo: undefined })); }}
              opcoes={TIPOS_ENTREGA.map((t) => ({ valor: t, rotulo: ROTULO_TIPO_ENTREGA[t] }))} />
            <Selecao rotulo="Competência" valor={competencia} onChange={setCompetencia} erro={erros.competencia}
              opcoes={competencias.map((c) => ({ valor: c, rotulo: competenciaBR(c) }))} />
            <Entrada rotulo="Título (opcional)" value={titulo} maxLength={200} classeCampo="sm:col-span-2" erro={erros.titulo}
              placeholder="Ex.: DAS de outubro" dica="Aparece só no portal da empresa, não no aviso."
              onChange={(e) => setTitulo(e.target.value)} />
            <Entrada rotulo="Vencimento (opcional)" type="date" value={vencimento} erro={erros.vencimento}
              onChange={(e) => { setVencimento(e.target.value); setErros((x) => ({ ...x, vencimento: undefined })); }} />
            <Entrada rotulo="Observação (opcional)" value={observacao} maxLength={500}
              onChange={(e) => setObservacao(e.target.value)} />
          </div>
          <div>
            <CampoArquivo rotulo="Arquivo" accept={ACCEPT} nome={arquivo?.name}
              dica={`${TIPOS_TEXTO}. Até ${LIMITE_TEXTO}.`}
              onArquivo={(f) => { setArquivo(f); setErros((x) => ({ ...x, arquivo: undefined })); }} />
            {erros.arquivo && <p id={`${id}-arquivo`} role="alert" tabIndex={-1} className="mt-1 text-xs font-medium text-perigo">{erros.arquivo}</p>}
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-borda bg-superficie-suave px-5 py-3 sm:flex-row sm:justify-end">
          <Botao onClick={onCancelar}>Cancelar</Botao>
          <Botao type="submit" variante="primaria" carregando={enviando}>Publicar</Botao>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Contabilidade: o que as empresas ainda não abriram, no escritório inteiro — só
 * aparece quando há algo vencido ou vencendo em até 3 dias. Clicar leva à empresa.
 */
export function NaoAbertas({ hoje, onEscolherEmpresa, recarregar }: {
  hoje: string; onEscolherEmpresa: (empresaId: string) => void; recarregar: number;
}) {
  const [lista, setLista] = useState<EntregaTela[]>([]);
  useEffect(() => {
    let vivo = true;
    // Resumo auxiliar: se falhar (ou sem a 0032), a tela segue sem ele.
    fetch('/api/entregas?visao=nao-abertas').then(lerResposta)
      .then((d) => { if (vivo) setLista(d.entregas ?? []); })
      .catch(() => { if (vivo) setLista([]); });
    return () => { vivo = false; };
  }, [recarregar]);

  const urgentes = lista.filter((e) => {
    const s = situacaoEntrega(e, hoje);
    return s === 'vencida' || s === 'vence-logo';
  });
  if (!urgentes.length) return null;
  return (
    <Aviso tom="aviso" titulo={urgentes.length === 1
      ? '1 documento perto do vencimento ainda não foi baixado pela empresa'
      : `${urgentes.length} documentos perto do vencimento ainda não foram baixados pelas empresas`}>
      <ul className="mt-1 space-y-1">
        {urgentes.slice(0, 5).map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => onEscolherEmpresa(e.empresaId)}
              className="min-h-11 text-left font-medium text-primaria-texto underline-offset-2 hover:underline sm:min-h-0">
              {e.empresaNome || 'Empresa'} · {nomeEntrega(e)} · {textoVencimento(e, hoje)}
            </button>
          </li>
        ))}
        {urgentes.length > 5 && <li className="text-tinta-suave">e mais {urgentes.length - 5}</li>}
      </ul>
    </Aviso>
  );
}
