'use client';

// Pedidos mensais — os documentos que o escritório pede todo mês, por empresa.
// No dia 1º o cron diário abre a pendência do mês anterior; quando o cliente envia
// um documento da mesma categoria e competência, a pendência fecha sozinha.
// Ver docs/documentos.md.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CATEGORIAS, Categoria, ROTULO_CATEGORIA } from '@/lib/documentos';
import { DIA_PRAZO_MAX, DIA_PRAZO_MIN, DIA_PRAZO_PADRAO, MODELO_PADRAO, ModeloRecorrente } from '@/lib/fechamento';
import {
  Alternador, Aviso, Botao, BotaoIcone, CabecalhoPagina, Carregando, Conteudo, cx, Entrada, EstadoVazio, Marcacao, Secao, Selo,
} from '@/components/ui';
import { Selecao } from '@/components/selecao';
import { Toast, Toasts } from '@/components/retorno';
import { DialogoConfirmacao } from '../Dialogo';
import { IconeExcluir } from '../icones';

interface Empresa { id: string; nome: string }
type Modelo = ModeloRecorrente & { escritorioId?: string };

async function chamar(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const x = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(x.erro || 'Não foi possível concluir.');
  return x;
}
const json = (metodo: string, corpo: unknown): RequestInit => ({
  method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
});

export default function FechamentoPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [modelos, setModelos] = useState<Modelo[]>([]);
  const [semTabela, setSemTabela] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [desfazer, setDesfazer] = useState<{ ids: string[]; texto: string; acao: 'restaurar' | 'excluir' } | null>(null);
  const [excluindo, setExcluindo] = useState<Modelo | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Formulário "aplicar a várias empresas".
  const [itens, setItens] = useState(() => MODELO_PADRAO.map((i, n) => ({ ...i, marcado: n < 2, dia: i.diaPrazo })));
  const [outro, setOutro] = useState<{ titulo: string; categoria: Categoria; dia: number }>({ titulo: '', categoria: 'outros', dia: DIA_PRAZO_PADRAO });
  const [escolhidas, setEscolhidas] = useState<Set<string>>(new Set());

  const carregar = useCallback(async () => {
    try {
      const [e, m] = await Promise.all([chamar('/api/empresas'), chamar('/api/pendencias-recorrentes')]);
      setEmpresas((e.empresas ?? []).map((x: Empresa) => ({ id: x.id, nome: x.nome })));
      setModelos(m.modelos ?? []);
      setSemTabela(Boolean(m.semTabela));
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível carregar.');
    } finally {
      setCarregando(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial (o setState acontece depois do fetch)
  useEffect(() => { carregar(); }, [carregar]);

  // Prazo padrão do escritório (tela "Escritório"): troca o 10 fixo dos campos de dia novos.
  useEffect(() => {
    chamar('/api/escritorio').then((d) => {
      const dia = Number(d?.escritorio?.prazoPedidosPadrao);
      if (!Number.isInteger(dia) || dia === DIA_PRAZO_PADRAO) return;
      setItens((l) => l.map((i) => (i.diaPrazo === DIA_PRAZO_PADRAO ? { ...i, dia } : i)));
      setOutro((o) => (o.dia === DIA_PRAZO_PADRAO ? { ...o, dia } : o));
    }).catch(() => {});
  }, []);

  const nomeEmpresa = useMemo(() => new Map(empresas.map((e) => [e.id, e.nome])), [empresas]);
  const porEmpresa = useMemo(() => {
    const m = new Map<string, Modelo[]>();
    for (const x of modelos) m.set(x.empresaId, [...(m.get(x.empresaId) ?? []), x]);
    return m;
  }, [modelos]);

  const escolhidosItens = [
    ...itens.filter((i) => i.marcado).map((i) => ({ titulo: i.titulo, descricao: i.descricao, categoria: i.categoria, diaPrazo: i.dia })),
    ...(outro.titulo.trim() ? [{ titulo: outro.titulo.trim(), descricao: '', categoria: outro.categoria, diaPrazo: outro.dia }] : []),
  ];
  const diasOk = escolhidosItens.every((i) => Number.isInteger(i.diaPrazo) && i.diaPrazo >= DIA_PRAZO_MIN && i.diaPrazo <= DIA_PRAZO_MAX);

  function alternarEmpresa(id: string) {
    setEscolhidas((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  async function aplicar() {
    setOcupado(true); setErro(null); setMsg(null);
    try {
      const x = await chamar('/api/pendencias-recorrentes', json('POST', { empresas: [...escolhidas], itens: escolhidosItens }));
      const ids: string[] = x.ids ?? [];
      await carregar();
      if (ids.length) {
        setDesfazer({ ids, acao: 'excluir', texto: `${ids.length} ${ids.length === 1 ? 'pedido mensal criado' : 'pedidos mensais criados'}. O primeiro abre no dia 1º do próximo mês.` });
      } else setMsg('As empresas escolhidas já pedem tudo isso.');
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha ao aplicar.'); }
    finally { setOcupado(false); }
  }

  async function mudarAtiva(m: Modelo, ativa: boolean) {
    setErro(null);
    setModelos((l) => l.map((x) => (x.id === m.id ? { ...x, ativa } : x)));
    try { await chamar('/api/pendencias-recorrentes', json('PATCH', { id: m.id, acao: ativa ? 'ativar' : 'desativar' })); }
    catch (e) {
      setModelos((l) => l.map((x) => (x.id === m.id ? { ...x, ativa: !ativa } : x)));
      setErro(e instanceof Error ? e.message : 'Falha ao salvar.');
    }
  }

  async function excluirIds(ids: string[]) {
    await chamar(`/api/pendencias-recorrentes?${ids.map((id) => `id=${encodeURIComponent(id)}`).join('&')}`, { method: 'DELETE' });
    setModelos((l) => l.filter((x) => !ids.includes(x.id)));
  }

  async function confirmarExclusao() {
    const m = excluindo!;
    setExcluindo(null); setErro(null); setMsg(null);
    try {
      await excluirIds([m.id]);
      setDesfazer({ ids: [m.id], acao: 'restaurar', texto: `“${m.titulo}” deixou de ser pedido todo mês.` });
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha ao excluir.'); }
  }

  async function desfazerUltima() {
    if (!desfazer) return;
    const d = desfazer;
    setDesfazer(null);
    try {
      if (d.acao === 'excluir') await excluirIds(d.ids);
      else { await chamar('/api/pendencias-recorrentes', json('PATCH', { ids: d.ids, restaurar: true })); await carregar(); }
      setMsg('Desfeito.');
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha ao desfazer.'); }
  }

  const empresasComPedido = empresas.filter((e) => porEmpresa.has(e.id));

  return (
    <div className="text-sm">
      <CabecalhoPagina titulo="Pedidos mensais"
        subtitulo="Os documentos que você pede todo mês. No dia 1º o sistema abre o pedido do mês anterior e fecha sozinho quando o cliente envia." />
      <Toasts>
        {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
        {msg && <Toast onFechar={() => setMsg(null)}>{msg}</Toast>}
        {desfazer && (
          <Toast tom="info" onFechar={() => setDesfazer(null)} acao={<Botao tamanho="sm" variante="tonal" onClick={desfazerUltima}>Desfazer</Botao>}>
            {desfazer.texto}
          </Toast>
        )}
      </Toasts>

      <Conteudo largura="media">
        {semTabela && <Aviso tom="aviso" titulo="Aguardando o banco">Os pedidos mensais passam a funcionar assim que a migração 0018 for aplicada.</Aviso>}
        {carregando && <Carregando />}
        {!carregando && !empresas.length && <EstadoVazio titulo="Nenhuma empresa cadastrada" descricao="Cadastre as empresas-clientes na tela Cadastro para configurar o que pedir a cada uma." />}

        {!carregando && empresas.length > 0 && (
          <>
            <Secao titulo="Pedir todo mês"
              descricao="Marque o que vale, escolha as empresas e aplique. Só entra o que a empresa ainda não pede. O prazo é o dia do mês em que o pedido vence (de 1 a 28).">
              <div className="space-y-2">
                {itens.map((i, n) => (
                  <div key={i.titulo} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <Marcacao className="min-w-48 flex-1" checked={i.marcado}
                      onChange={(e) => setItens((l) => l.map((x, k) => (k === n ? { ...x, marcado: e.target.checked } : x)))}>
                      <span className="font-medium">{i.titulo}</span> <span className="text-tinta-suave">· {ROTULO_CATEGORIA[i.categoria]}</span>
                    </Marcacao>
                    <Entrada aria-label={`Dia do prazo de ${i.titulo}`} type="number" min={DIA_PRAZO_MIN} max={DIA_PRAZO_MAX} inputMode="numeric"
                      tamanho="sm" largura="w-24" value={i.dia} disabled={!i.marcado}
                      onChange={(e) => setItens((l) => l.map((x, k) => (k === n ? { ...x, dia: Number(e.target.value) } : x)))} />
                  </div>
                ))}
                <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-end">
                  <Entrada rotulo="Outro documento (opcional)" classeCampo="sm:w-72" value={outro.titulo} maxLength={200}
                    onChange={(e) => setOutro((o) => ({ ...o, titulo: e.target.value }))} placeholder="Ex.: Comprovante de aluguel" />
                  <Selecao rotulo="Categoria" classeCampo="sm:w-48" valor={outro.categoria} onChange={(v) => setOutro((o) => ({ ...o, categoria: v as Categoria }))}
                    opcoes={CATEGORIAS.map((c) => ({ valor: c, rotulo: ROTULO_CATEGORIA[c] }))} />
                  <Entrada rotulo="Prazo (dia)" type="number" min={DIA_PRAZO_MIN} max={DIA_PRAZO_MAX} inputMode="numeric" largura="w-24"
                    value={outro.dia} onChange={(e) => setOutro((o) => ({ ...o, dia: Number(e.target.value) }))} />
                </div>
              </div>

              <fieldset className="mt-5">
                <legend className="mb-1.5 flex w-full flex-wrap items-center justify-between gap-2 text-[13px] font-semibold text-tinta">
                  <span>Empresas ({escolhidas.size} de {empresas.length})</span>
                  <Botao tamanho="sm" variante="fantasma"
                    onClick={() => setEscolhidas(escolhidas.size === empresas.length ? new Set() : new Set(empresas.map((e) => e.id)))}>
                    {escolhidas.size === empresas.length ? 'Limpar' : 'Marcar todas'}
                  </Botao>
                </legend>
                <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
                  {empresas.map((e) => (
                    <Marcacao key={e.id} checked={escolhidas.has(e.id)} onChange={() => alternarEmpresa(e.id)}>
                      {e.nome}{porEmpresa.has(e.id) && <span className="text-tinta-fraca"> · já pede {porEmpresa.get(e.id)!.length}</span>}
                    </Marcacao>
                  ))}
                </div>
              </fieldset>

              <div className="mt-5">
                <Botao variante="primaria" carregando={ocupado} disabled={ocupado || semTabela || !escolhidas.size || !escolhidosItens.length || !diasOk} onClick={aplicar}>
                  Aplicar em {escolhidas.size} {escolhidas.size === 1 ? 'empresa' : 'empresas'}
                </Botao>
                {!diasOk && <span className="ml-3 text-[13px] text-perigo">O dia do prazo vai de {DIA_PRAZO_MIN} a {DIA_PRAZO_MAX}.</span>}
              </div>
            </Secao>

            <Secao titulo="O que cada empresa pede" descricao="Pause um pedido para não abrir no próximo mês, ou exclua (dá para desfazer). O que já foi aberto continua em Documentos.">
              {empresasComPedido.length === 0 ? (
                <EstadoVazio moldura={false} titulo="Nenhum pedido mensal ainda" descricao="Aplique o modelo acima numa ou mais empresas." />
              ) : (
                <ul className="divide-y divide-borda">
                  {empresasComPedido.map((e) => (
                    <li key={e.id} className="py-3 first:pt-0 last:pb-0">
                      <h3 className="mb-1.5 text-sm font-semibold text-tinta">{nomeEmpresa.get(e.id)}</h3>
                      <ul className="space-y-1.5">
                        {porEmpresa.get(e.id)!.map((m) => (
                          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                            <span className={cx('min-w-0 flex-1 basis-48', !m.ativa && 'opacity-60')}>
                              <span className="font-medium text-tinta">{m.titulo}</span>
                              <span className="text-tinta-suave"> · até o dia {m.diaPrazo}</span>
                            </span>
                            <span className="flex shrink-0 items-center gap-3">
                              <Selo>{ROTULO_CATEGORIA[m.categoria]}</Selo>
                              <Alternador aria-label={`${m.ativa ? 'Pausar' : 'Retomar'} ${m.titulo}`} checked={m.ativa}
                                onChange={(ev) => mudarAtiva(m, ev.target.checked)} />
                              <BotaoIcone rotulo={`Excluir ${m.titulo}`} tom="perigo" onClick={() => setExcluindo(m)}><IconeExcluir /></BotaoIcone>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
          </>
        )}
      </Conteudo>

      {excluindo && (
        <DialogoConfirmacao
          titulo="Parar de pedir todo mês?"
          mensagem={<><strong>{excluindo.titulo}</strong> deixa de ser pedido a {nomeEmpresa.get(excluindo.empresaId)}. Pedidos já abertos continuam em Documentos. Dá para desfazer logo em seguida.</>}
          onConfirmar={confirmarExclusao}
          onCancelar={() => setExcluindo(null)}
        />
      )}
    </div>
  );
}
