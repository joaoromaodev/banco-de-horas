'use client';

// Folha de ponto enviada pelo cliente (Sprint 10 · Frente A). Ver a seção
// "Folha enviada pelo cliente" em docs/folha-de-ponto.md.
//
// A empresa escolhe o mês e o funcionário, tira a foto da folha no celular (ou
// escolhe o arquivo) e envia — pode mandar várias. A IA lê em fila e a
// contabilidade confere na Timesheet; aqui o cliente acompanha a situação de
// cada envio e vê o motivo quando a folha volta. Quem decide de verdade são as
// rotas (/api/envio-ponto).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MESES } from '@/lib/calendario';
import { competenciaPadrao, competenciasRecentes } from '@/lib/documentos';
import { hojeBelem } from '@/lib/contratos';
import { lerMe } from '@/lib/meCliente';
import { ACCEPT_FOTO, LIMITE_FOTO_TEXTO, situacaoParaCliente, type SituacaoEnvio, validarFoto } from '@/lib/envioPonto';
import { DialogoConfirmacao } from '../Dialogo';
import { IconeCamera, IconeDesfazer, IconeExcluir, IconeMais } from '../icones';
import { Aviso, Botao, BotaoIcone, botaoCls, CabecalhoPagina, Carregando, Conteudo, EstadoVazio, Secao, Selo } from '@/components/ui';
import { Selecao } from '@/components/selecao';
import { Toast, Toasts } from '@/components/retorno';

interface EnvioCliente {
  id: string; funcionario: string; ano: number; mes: number; situacao: SituacaoEnvio; motivo: string | null;
  enviadoEm: string; devolvidoEm: string | null; aplicadoEm: string | null;
}

type EstadoItem = 'esperando' | 'enviando' | 'ok' | 'erro';
interface Item { chave: string; arquivo: File; previa: string; estado: EstadoItem; erro?: string }

const mesNome = (ano: number, mes: number) => `${MESES[mes].charAt(0)}${MESES[mes].slice(1).toLowerCase()} de ${ano}`;
const quandoBR = (iso: string | null) => (iso
  ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Belem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '');

async function lerJson(r: Response) {
  const x = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(x.erro ?? 'Não foi possível concluir. Tente de novo.'), { aguardandoBanco: Boolean(x.aguardandoBanco) });
  return x;
}

/**
 * Foto grande de celular vira JPEG de até 2.400 px (a letra continua legível e o
 * envio fica rápido no 4G). Se o navegador não souber abrir (HEIC no Android, por
 * exemplo), vai a original — o servidor confere os bytes de qualquer jeito.
 */
async function prepararFoto(f: File): Promise<File> {
  if (f.type === 'image/jpeg' && f.size <= 2.5 * 1024 * 1024) return f;
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
    const escala = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * escala);
    canvas.height = Math.round(bmp.height * escala);
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85));
    if (blob && blob.size > 0 && blob.size < f.size) {
      const base = (f.name || 'folha').replace(/\.[^.]+$/, '');
      return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
    }
  } catch { /* fica a original */ }
  return f;
}

export default function EnviarPontoPage() {
  const hoje = useMemo(() => hojeBelem(), []);
  const competencias = useMemo(() => competenciasRecentes(hoje, 14), [hoje]);

  const [papel, setPapel] = useState<string | null>(null);
  const [envios, setEnvios] = useState<EnvioCliente[] | null>(null);
  const [funcionarios, setFuncionarios] = useState<string[]>([]);
  const [semBanco, setSemBanco] = useState(false);
  const [competencia, setCompetencia] = useState(() => competenciaPadrao(hoje));
  const [funcionario, setFuncionario] = useState('');
  const [itens, setItens] = useState<Item[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [desfazer, setDesfazer] = useState<{ id: string; texto: string } | null>(null);
  const [excluindo, setExcluindo] = useState<EnvioCliente | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    try {
      const d = await fetch('/api/envio-ponto').then(lerJson);
      setEnvios(d.envios ?? []);
      setFuncionarios((d.funcionarios ?? []).map((f: { nome: string }) => f.nome));
      setSemBanco(false);
    } catch (e) {
      if ((e as { aguardandoBanco?: boolean }).aguardandoBanco) { setSemBanco(true); setEnvios([]); return; }
      setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
    }
  }, []);

  useEffect(() => {
    lerMe().then((m) => {
      if (!m?.autenticado) return;
      setPapel(m.role);
      if (m.role === 'cliente') carregar();
    });
  }, [carregar]);

  // Enquanto alguma folha está na fila da IA, atualiza a lista de tempos em tempos
  // (no máximo por 5 minutos depois do último envio).
  const naFila = (envios ?? []).some((e) => e.situacao === 'recebida' || e.situacao === 'lendo');
  const ultimoEnvio = useRef(0);
  useEffect(() => {
    if (!naFila || Date.now() - ultimoEnvio.current > 5 * 60_000) return;
    const t = setTimeout(carregar, 8000);
    return () => clearTimeout(t);
  }, [naFila, envios, carregar]);

  // Libera as prévias ao sair.
  const itensRef = useRef(itens);
  useEffect(() => { itensRef.current = itens; }, [itens]);
  useEffect(() => () => itensRef.current.forEach((i) => URL.revokeObjectURL(i.previa)), []);

  function adicionar(lista: FileList | null) {
    if (!lista?.length) return;
    const novos = Array.from(lista).map((arquivo, i): Item => {
      // Antes de reduzir, só o tipo importa (o tamanho é conferido depois de preparar).
      const v = validarFoto({ nome: arquivo.name, tamanho: Math.min(arquivo.size, 1), tipo: arquivo.type });
      return {
        chave: `${Date.now()}-${i}-${arquivo.name}`, arquivo, previa: URL.createObjectURL(arquivo),
        estado: v.ok ? 'esperando' : 'erro', erro: v.ok ? undefined : v.erro,
      };
    });
    setItens((atual) => [...atual.filter((x) => x.estado !== 'ok'), ...novos].slice(-12));
  }

  function remover(chave: string) {
    setItens((atual) => {
      const it = atual.find((x) => x.chave === chave);
      if (it) URL.revokeObjectURL(it.previa);
      return atual.filter((x) => x.chave !== chave);
    });
  }

  async function enviarUm(item: Item) {
    const foto = await prepararFoto(item.arquivo);
    const v = validarFoto({ nome: foto.name, tamanho: foto.size, tipo: foto.type });
    if (!v.ok) throw new Error(v.erro);
    const [ano, mes] = competencia.split('-').map(Number);
    const ini = await fetch('/api/envio-ponto', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ano, mes, funcionario, nome: v.nome, tamanho: foto.size, tipo: foto.type || v.tipo.mime }),
    }).then(lerJson);
    const corpo = new FormData();
    corpo.append('cacheControl', '3600');
    corpo.append('', new File([foto], v.nome, { type: ini.mime }));
    const up = await fetch(ini.url, { method: 'PUT', body: corpo, headers: { 'x-upsert': 'false' } });
    if (!up.ok) throw new Error('A foto não subiu. Confira a conexão e tente de novo.');
    await fetch('/api/envio-ponto', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ini.id, acao: 'confirmar' }),
    }).then(lerJson);
  }

  async function enviar() {
    setErro(null);
    if (!funcionario) { setErro('Escolha o funcionário da folha.'); return; }
    const pendentes = itens.filter((i) => i.estado === 'esperando' || (i.estado === 'erro' && validarFoto({ nome: i.arquivo.name, tamanho: 1, tipo: i.arquivo.type }).ok));
    if (!pendentes.length) { setErro('Tire uma foto ou escolha a imagem da folha.'); return; }
    setEnviando(true);
    let ok = 0;
    for (const item of pendentes) {
      setItens((a) => a.map((x) => (x.chave === item.chave ? { ...x, estado: 'enviando', erro: undefined } : x)));
      try {
        await enviarUm(item);
        ok++;
        setItens((a) => a.map((x) => (x.chave === item.chave ? { ...x, estado: 'ok' } : x)));
      } catch (e) {
        const m = e instanceof Error ? e.message : 'Falha no envio.';
        setItens((a) => a.map((x) => (x.chave === item.chave ? { ...x, estado: 'erro', erro: m } : x)));
      }
    }
    setEnviando(false);
    if (ok) {
      ultimoEnvio.current = Date.now();
      setMsg(ok === 1 ? `Folha de ${funcionario} enviada à contabilidade.` : `${ok} fotos da folha de ${funcionario} enviadas à contabilidade.`);
      carregar();
    }
    if (ok < pendentes.length) setErro('Algumas fotos não foram enviadas. Veja o motivo na lista.');
  }

  function reenviar(e: EnvioCliente) {
    setCompetencia(`${e.ano}-${String(e.mes).padStart(2, '0')}`);
    if (funcionarios.includes(e.funcionario)) setFuncionario(e.funcionario);
    formRef.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  async function excluir(e: EnvioCliente) {
    setExcluindo(null);
    try {
      await fetch(`/api/envio-ponto?id=${encodeURIComponent(e.id)}`, { method: 'DELETE' }).then(lerJson);
      setDesfazer({ id: e.id, texto: `Envio da folha de ${e.funcionario} excluído.` });
      carregar();
    } catch (x) { setErro(x instanceof Error ? x.message : 'Falha.'); }
  }

  async function desfazerExclusao() {
    if (!desfazer) return;
    const alvo = desfazer;
    setDesfazer(null);
    try {
      await fetch('/api/envio-ponto', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: alvo.id, acao: 'restaurar' }),
      }).then(lerJson);
      setMsg('Exclusão desfeita.');
      carregar();
    } catch (x) { setErro(x instanceof Error ? x.message : 'Falha.'); }
  }

  // Agrupa por mês (mais recente primeiro).
  const porMes = useMemo(() => {
    const m = new Map<string, EnvioCliente[]>();
    for (const e of envios ?? []) {
      const k = `${e.ano}-${String(e.mes).padStart(2, '0')}`;
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [envios]);
  const devolvidas = (envios ?? []).filter((e) => e.situacao === 'devolvida').length;
  const aEnviar = itens.filter((i) => i.estado !== 'ok').length;

  if (papel && papel !== 'cliente') {
    return (
      <div className="text-sm">
        <CabecalhoPagina titulo="Folha de ponto" subtitulo="Envio da folha pela empresa-cliente" />
        <Conteudo largura="estreita">
          <EstadoVazio titulo="Esta tela é da empresa-cliente"
            descricao="As folhas que os clientes enviam chegam na Timesheet, na seção “Folhas enviadas pelos clientes”."
            acao={<a href="/ponto" className={botaoCls({ variante: 'tonal' })}>Ir para a Timesheet</a>} />
        </Conteudo>
      </div>
    );
  }

  return (
    <div className="text-sm">
      <CabecalhoPagina titulo="Folha de ponto" subtitulo="Fotografe a folha de cada funcionário e envie à contabilidade." />

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
        {!papel && <Carregando />}
        {semBanco && (
          <Aviso tom="aviso" titulo="Ainda não disponível">
            O envio de folhas está aguardando uma atualização do sistema. Enquanto isso, mande a foto à contabilidade
            como de costume.
          </Aviso>
        )}
        {devolvidas > 0 && (
          <Aviso tom="aviso" titulo={devolvidas === 1 ? '1 folha voltou para você' : `${devolvidas} folhas voltaram para você`}>
            A contabilidade pediu uma nova foto. Veja o motivo na lista abaixo e use “Enviar de novo”.
          </Aviso>
        )}

        {papel === 'cliente' && !semBanco && (
          <div ref={formRef} className="scroll-mt-4">
            <Secao titulo="Enviar folha"
              descricao={`Uma foto por folha, de frente e com boa luz, mostrando todos os dias. JPG, PNG, WEBP ou HEIC, até ${LIMITE_FOTO_TEXTO}.`}>
              {envios !== null && funcionarios.length === 0 ? (
                <Aviso tom="info" titulo="Nenhum funcionário cadastrado">
                  A contabilidade ainda não cadastrou os funcionários desta empresa. Peça para cadastrarem e volte aqui.
                </Aviso>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Selecao rotulo="Mês da folha" busca={false} valor={competencia} onChange={setCompetencia}
                      opcoes={competencias.map((c) => ({ valor: c, rotulo: mesNome(Number(c.slice(0, 4)), Number(c.slice(5, 7))) }))} />
                    <Selecao rotulo="Funcionário" valor={funcionario} onChange={setFuncionario} placeholder="Escolha o funcionário"
                      opcoes={funcionarios.map((n) => ({ valor: n, rotulo: n }))} />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {/* No celular abre direto a câmera traseira; no computador, o seletor de arquivo. */}
                    <label className={`${botaoCls({ variante: 'tonal' })} cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-foco`}>
                      <IconeCamera />
                      Tirar foto
                      <input type="file" accept="image/*" capture="environment" className="sr-only"
                        onChange={(e) => { adicionar(e.target.files); e.target.value = ''; }} />
                    </label>
                    <label className={`${botaoCls()} cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-foco`}>
                      <IconeMais />
                      Escolher arquivo
                      <input type="file" accept={ACCEPT_FOTO} multiple className="sr-only"
                        onChange={(e) => { adicionar(e.target.files); e.target.value = ''; }} />
                    </label>
                  </div>

                  {itens.length > 0 && (
                    <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Fotos para enviar">
                      {itens.map((i) => (
                        <li key={i.chave} className="overflow-hidden rounded-lg border border-borda bg-superficie-suave">
                          {/* eslint-disable-next-line @next/next/no-img-element -- prévia local (blob:) */}
                          <img src={i.previa} alt={`Prévia de ${i.arquivo.name || 'foto'}`} className="aspect-[3/4] w-full object-cover" />
                          <div className="flex items-start justify-between gap-1 p-2">
                            <span className="min-w-0 text-xs" role="status">
                              {i.estado === 'esperando' && <span className="text-tinta-suave">Pronta</span>}
                              {i.estado === 'enviando' && <span className="text-primaria-texto">Enviando…</span>}
                              {i.estado === 'ok' && <span className="font-medium text-sucesso">Enviada</span>}
                              {i.estado === 'erro' && <span className="text-perigo">{i.erro}</span>}
                            </span>
                            {i.estado !== 'enviando' && i.estado !== 'ok' && (
                              <BotaoIcone rotulo="Tirar da lista" tom="apagado" onClick={() => remover(i.chave)}><IconeExcluir size={14} /></BotaoIcone>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="mt-5">
                    <Botao variante="primaria" onClick={enviar} carregando={enviando} disabled={!aEnviar || !funcionario}>
                      {enviando ? 'Enviando…' : aEnviar > 1 ? `Enviar ${aEnviar} fotos` : 'Enviar folha'}
                    </Botao>
                  </div>
                </>
              )}
            </Secao>
          </div>
        )}

        {papel === 'cliente' && !semBanco && (
          <Secao titulo="Folhas enviadas" descricao="Acompanhe o que a contabilidade já recebeu e conferiu.">
            {envios === null ? <Carregando className="p-4" /> : envios.length === 0 ? (
              <EstadoVazio moldura={false} titulo="Nenhuma folha enviada ainda" descricao="As folhas que você enviar aparecem aqui, com a situação de cada uma." />
            ) : (
              <div className="space-y-5">
                {porMes.map(([k, lista]) => (
                  <div key={k}>
                    <h3 className="mb-2 text-[13px] font-semibold text-tinta-suave">{mesNome(Number(k.slice(0, 4)), Number(k.slice(5, 7)))}</h3>
                    <ul className="divide-y divide-borda rounded-xl border border-borda">
                      {lista.map((e) => {
                        const s = situacaoParaCliente(e.situacao);
                        const podeExcluir = e.situacao !== 'aplicada' && e.situacao !== 'lendo';
                        return (
                          <li key={e.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-3 py-3 sm:px-4">
                            <div className="min-w-0">
                              <p className="font-medium text-tinta">{e.funcionario}</p>
                              <p className="text-xs text-tinta-suave">Enviada em {quandoBR(e.enviadoEm)}</p>
                              {e.situacao === 'devolvida' && e.motivo && (
                                <p className="mt-1 text-[13px] text-perigo"><span className="font-medium">Motivo:</span> {e.motivo}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span data-dica={s.explicacao}><Selo tom={s.tom}>{s.rotulo}</Selo></span>
                              {(e.situacao === 'devolvida' || e.situacao === 'rejeitada') && (
                                <Botao tamanho="sm" variante="tonal" onClick={() => reenviar(e)}>Enviar de novo</Botao>
                              )}
                              {podeExcluir && (
                                <BotaoIcone rotulo="Excluir envio" tom="perigo" onClick={() => setExcluindo(e)}><IconeExcluir /></BotaoIcone>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Secao>
        )}
      </Conteudo>

      {excluindo && (
        <DialogoConfirmacao titulo="Excluir este envio?"
          mensagem={`A foto da folha de ${excluindo.funcionario} (${mesNome(excluindo.ano, excluindo.mes)}) sai da conferência da contabilidade. Dá para desfazer logo em seguida.`}
          textoConfirmar="Excluir" perigo onConfirmar={() => excluir(excluindo)} onCancelar={() => setExcluindo(null)} />
      )}
    </div>
  );
}
