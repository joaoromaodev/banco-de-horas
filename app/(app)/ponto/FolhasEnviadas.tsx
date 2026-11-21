'use client';

// Fila "Folhas enviadas pelos clientes" na Timesheet (Sprint 10 · Frente A).
//
// A empresa-cliente manda a foto em /enviar-ponto; a IA lê em fila e deixa um
// RASCUNHO. Aqui a contadora vê o que chegou da empresa escolhida, abre a foto ao
// lado do rascunho no editor da Timesheet (onde a revisão CLT roda ao vivo) e
// aplica à frequência — ou devolve com motivo. Nada daqui grava na frequência por
// conta própria. Ver docs/folha-de-ponto.md, "Folha enviada pelo cliente".
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MESES } from '@/lib/calendario';
import type { DiaFreq } from '@/lib/tipos';
import { diasPreenchidos, ehPendente, motivoValido, type MotivoEspera, situacaoParaContador, type SituacaoEnvio } from '@/lib/envioPonto';
import { Modal } from '../Dialogo';
import { Alternador, AreaTexto, Botao, Carregando, EstadoVazio, Secao, Selo } from '@/components/ui';

export interface EnvioGestor {
  id: string; empresaId: string; funcionario: string; ano: number; mes: number; situacao: SituacaoEnvio;
  aguardando: MotivoEspera | null; motivo: string | null; enviadoEm: string; enviadoPor: string;
  lidoEm: string | null; aplicadoEm: string | null; temFoto: boolean; tipo: string; tentativas: number;
  rascunho: { dias: DiaFreq[]; incertos: { dia: number; campo: string }[]; funcionarioLido: string | null } | null;
}

async function lerJson(r: Response) {
  const x = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(x.erro ?? 'Não foi possível concluir. Tente de novo.'), { aguardandoBanco: Boolean(x.aguardandoBanco) });
  return x;
}

/** PATCH /api/envio-ponto — as ações da contabilidade sobre um envio. */
export async function acaoEnvio(id: string, acao: string, extra: Record<string, unknown> = {}) {
  return fetch('/api/envio-ponto', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, acao, ...extra }),
  }).then(lerJson);
}

const mesCurto = (ano: number, mes: number) => `${MESES[mes].slice(0, 3).toLowerCase()}/${ano}`;
const quando = (iso: string | null) => (iso
  ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Belem', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '');

/** Motivo para o cliente (ele vê). Substitui o `prompt()`. */
export function DialogoDevolver({ envio, onConfirmar, onCancelar }: {
  envio: Pick<EnvioGestor, 'funcionario' | 'ano' | 'mes'>; onConfirmar: (motivo: string) => void; onCancelar: () => void;
}) {
  const id = useId();
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  return (
    <Modal onFechar={onCancelar} rotuladoPor={id}>
      <form onSubmit={(e) => {
        e.preventDefault();
        const m = motivoValido(motivo);
        if (!m) { setErro('Escreva o motivo para o cliente.'); return; }
        onConfirmar(m);
      }}>
        <div className="p-5">
          <h2 id={id} className="text-base font-semibold text-tinta">Devolver ao cliente?</h2>
          <p className="mt-2 text-sm leading-relaxed text-tinta-suave">
            A folha de {envio.funcionario} ({mesCurto(envio.ano, envio.mes)}) volta para a empresa com o motivo abaixo, e ela
            pode enviar outra foto. Nada é gravado na frequência.
          </p>
          <AreaTexto classeCampo="mt-4" rotulo="Motivo (o cliente vê)" rows={3} maxLength={500} value={motivo} data-foco-inicial
            erro={erro ?? undefined} onChange={(e) => { setMotivo(e.target.value); setErro(null); }}
            placeholder="Ex.: a foto cortou os dias 25 a 31; fotografe a folha inteira." />
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-borda bg-superficie-suave px-5 py-3 sm:flex-row sm:justify-end">
          <Botao onClick={onCancelar}>Cancelar</Botao>
          <Botao type="submit" variante="perigo">Devolver</Botao>
        </div>
      </form>
    </Modal>
  );
}

export function FolhasEnviadas({ empresa, ano, mes, envioAberto, versao, onAbrir, onDevolver, onMensagem }: {
  empresa: string; ano: number; mes: number;
  /** Envio aberto no editor (a linha fica marcada). */
  envioAberto: string | null;
  /** Muda quando a tela aplicou/devolveu algo: recarrega a lista. */
  versao: number;
  onAbrir: (e: EnvioGestor) => void;
  onDevolver: (e: EnvioGestor) => void;
  onMensagem: (texto: string, tom: 'sucesso' | 'perigo') => void;
}) {
  const [envios, setEnvios] = useState<EnvioGestor[] | null>(null);
  const [semBanco, setSemBanco] = useState(false);
  const [verConcluidas, setVerConcluidas] = useState(false);
  const [lendo, setLendo] = useState<string | null>(null);
  const chave = useRef('');
  const consultas = useRef(0);

  const carregar = useCallback(async () => {
    if (!empresa) return;
    const k = empresa;
    chave.current = k;
    try {
      const d = await fetch(`/api/envio-ponto?empresa=${encodeURIComponent(empresa)}`).then(lerJson);
      if (chave.current === k) { setEnvios(d.envios ?? []); setSemBanco(false); }
    } catch (e) {
      if (chave.current !== k) return;
      if ((e as { aguardandoBanco?: boolean }).aguardandoBanco) { setSemBanco(true); setEnvios([]); return; }
      setEnvios([]);
    }
  }, [empresa]);

  // A tela remonta este componente ao trocar de empresa (key), então a lista começa vazia.
  useEffect(() => { consultas.current = 0; carregar(); }, [carregar, versao]);

  // Enquanto a IA lê, atualiza de tempos em tempos (no máximo ~5 min por abertura).
  const naFila = (envios ?? []).some((e) => e.situacao === 'lendo' || (e.situacao === 'recebida' && !e.aguardando));
  useEffect(() => {
    if (!naFila || consultas.current >= 40) return;
    const t = setTimeout(() => { consultas.current += 1; carregar(); }, 8000);
    return () => clearTimeout(t);
  }, [naFila, envios, carregar]);

  async function ler(e: EnvioGestor) {
    setLendo(e.id);
    try {
      const r = await acaoEnvio(e.id, 'ler');
      onMensagem(r.mensagem ?? 'Pronto.', r.resultado === 'lida' ? 'sucesso' : 'perigo');
      await carregar();
    } catch (x) {
      onMensagem(x instanceof Error ? x.message : 'Falha ao ler.', 'perigo');
    } finally {
      setLendo(null);
    }
  }

  if (!empresa || semBanco) return null;

  const pendentes = (envios ?? []).filter((e) => ehPendente(e.situacao))
    .sort((a, b) => a.ano - b.ano || a.mes - b.mes || a.enviadoEm.localeCompare(b.enviadoEm));
  const concluidas = (envios ?? []).filter((e) => !ehPendente(e.situacao) && e.ano === ano && e.mes === mes);
  const lista = verConcluidas ? [...pendentes, ...concluidas] : pendentes;
  const lidas = pendentes.filter((e) => e.situacao === 'lida').length;

  return (
    <Secao titulo="Folhas enviadas pelos clientes"
      descricao={envios === null ? undefined : pendentes.length
        ? `${pendentes.length} aguardando conferência${lidas ? ` · ${lidas} já lida(s) pela IA` : ''}. Abra, confira ao lado da foto e aplique à frequência.`
        : 'Nenhuma folha aguardando conferência desta empresa.'}
      acoes={concluidas.length > 0 ? (
        <span className="text-[13px] text-tinta-suave">
          <Alternador checked={verConcluidas} onChange={(e) => setVerConcluidas(e.target.checked)}>
            Ver as conferidas de {MESES[mes].toLowerCase()} ({concluidas.length})
          </Alternador>
        </span>
      ) : undefined}>
      {envios === null ? <Carregando className="p-1" /> : lista.length === 0 ? (
        <EstadoVazio moldura={false} titulo="Nada para conferir"
          descricao="Quando a empresa enviar a foto da folha pelo celular, ela aparece aqui já lida pela IA." />
      ) : (
        <ul className="divide-y divide-borda rounded-xl border border-borda">
          {lista.map((e) => {
            const s = situacaoParaContador(e.situacao, e.aguardando);
            const aberto = e.id === envioAberto;
            const nDias = e.rascunho ? diasPreenchidos(e.rascunho.dias) : 0;
            const nIncertos = e.rascunho?.incertos.length ?? 0;
            const outroNome = e.rascunho?.funcionarioLido
              && e.rascunho.funcionarioLido.trim().toUpperCase() !== e.funcionario.trim().toUpperCase();
            return (
              <li key={e.id} className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2.5 sm:px-4 ${aberto ? 'bg-superficie-realce' : ''}`}>
                <div className="min-w-0">
                  <p className="font-medium text-tinta">
                    {e.funcionario} <span className="font-normal text-tinta-suave">· {mesCurto(e.ano, e.mes)}</span>
                  </p>
                  <p className="text-xs text-tinta-suave">
                    Enviada em {quando(e.enviadoEm)}
                    {e.rascunho && ` · ${nDias} dia(s) lido(s)`}
                    {nIncertos > 0 && ` · ${nIncertos} campo(s) com dúvida`}
                    {e.situacao === 'devolvida' && e.motivo && ` · Motivo: ${e.motivo}`}
                  </p>
                  {outroNome && (
                    <p className="text-xs text-aviso">No cabeçalho da folha a IA leu “{e.rascunho?.funcionarioLido}”. Confira se é a pessoa certa.</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span data-dica={s.dica}><Selo tom={s.tom}>{s.rotulo}</Selo></span>
                  {(e.situacao === 'recebida' || e.situacao === 'falhou') && (
                    <Botao tamanho="sm" onClick={() => ler(e)} carregando={lendo === e.id} disabled={lendo !== null}>
                      {e.situacao === 'falhou' ? 'Tentar ler de novo' : 'Ler'}
                    </Botao>
                  )}
                  {ehPendente(e.situacao) && e.situacao !== 'lendo' && (
                    <>
                      <Botao tamanho="sm" variante="tonal" onClick={() => onAbrir(e)} disabled={aberto}>
                        {aberto ? 'Aberta abaixo' : 'Abrir'}
                      </Botao>
                      <Botao tamanho="sm" variante="fantasma" onClick={() => onDevolver(e)}>Devolver</Botao>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Secao>
  );
}
