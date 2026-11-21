'use client';

// Departamento Pessoal — "Completar cadastro": edição em lote dos empregados de uma
// empresa, em grade (uma linha por empregado) ou por planilha. Só preenche e atualiza,
// nunca apaga: célula vazia = não mexer. Validação por célula na hora; o servidor
// refaz tudo ao gravar. Salvar pede confirmação e dá para Desfazer. Regras em
// lib/dpLote.ts; rotas em app/api/dp/lote. Ver docs/departamento-pessoal.md.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Aviso, Botao, CampoArquivo, Carregando, cx, EstadoVazio, Secao, Selo, tb, celulaCls } from '@/components/ui';
import { Selecao } from '@/components/selecao';
import { Toast, Toasts } from '@/components/retorno';
import { DialogoConfirmacao } from '../Dialogo';
import { br, ESCALAS } from '@/lib/dp';
import {
  CAMPOS_LOTE, mostrarValor, planejarLinha, ROTULO_CAMPO,
  type AplicadoLote, type CampoLote, type EmpregadoDoLote, type EntradaLote, type LinhaPrevia,
} from '@/lib/dpLote';

type Linha = Omit<EmpregadoDoLote, 'cpf'>;
type Rascunho = Record<string, EntradaLote>;
interface Previa { linhas: LinhaPrevia[]; ignoradas: string[]; resumo: { muda: number; igual: number; erro: number } }

const OPCOES_ESCALA = ESCALAS.map((e) => ({ valor: e.valor, rotulo: e.valor === 'outra' ? 'Outra' : e.valor }));
const OPCOES_BANCO = [{ valor: 'Não', rotulo: 'Não' }, { valor: 'Sim', rotulo: 'Sim' }];

/** Como o valor que já está no cadastro aparece na célula. */
function textoAtual(e: Linha, c: CampoLote): string {
  switch (c) {
    case 'admissao': return br(e.admissao);
    case 'bancoHorasDesde': return br(e.bancoHorasDesde);
    case 'cargo': return e.cargo ?? '';
    case 'salarioBase': return e.salarioBase != null ? e.salarioBase.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '';
    case 'horasSemanais': return e.horasSemanais != null ? String(e.horasSemanais).replace('.', ',') : '';
    case 'escala': return e.escala ?? '';
    case 'bancoHoras': return e.bancoHoras ? 'Sim' : 'Não';
  }
}

const LARGURA: Record<CampoLote, string> = {
  admissao: 'w-28', cargo: 'w-44', salarioBase: 'w-28', horasSemanais: 'w-20', escala: 'w-24', bancoHoras: 'w-24', bancoHorasDesde: 'w-28',
};
const PLACEHOLDER: Partial<Record<CampoLote, string>> = { admissao: 'dd/mm/aaaa', bancoHorasDesde: 'dd/mm/aaaa', salarioBase: '0,00', horasSemanais: '44' };

const resumirCampos = (aplicados: AplicadoLote[]) => {
  const n: Partial<Record<CampoLote, number>> = {};
  for (const a of aplicados) for (const c of Object.keys(a.campos) as CampoLote[]) n[c] = (n[c] ?? 0) + 1;
  return CAMPOS_LOTE.filter((c) => n[c]).map((c) => `${ROTULO_CAMPO[c].toLowerCase()} em ${n[c]}`).join(', ');
};

export function CompletarCadastro({ empresaId, empresaNome, somenteLeitura, hoje, onVoltar, onGravou }: {
  empresaId: string; empresaNome: string; somenteLeitura: boolean; hoje: string;
  onVoltar: () => void; onGravou: () => void;
}) {
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho>({});
  const [modo, setModo] = useState<'grade' | 'planilha'>('grade');
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [lendo, setLendo] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [desfazer, setDesfazer] = useState<{ texto: string; aplicados: AplicadoLote[] } | null>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/dp/lote?empresa=${encodeURIComponent(empresaId)}`);
      const x = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(x.erro ?? 'Falha ao carregar os empregados.');
      setLinhas((x.empregados as Linha[]).filter((e) => e.situacao !== 'desligado').sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')));
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha ao carregar.'); setLinhas([]); }
  }, [empresaId]);
  useEffect(() => { carregar(); }, [carregar]);

  const planos = useMemo(() => {
    const m = new Map<string, ReturnType<typeof planejarLinha>>();
    for (const e of linhas ?? []) if (rascunho[e.id]) m.set(e.id, planejarLinha({ ...e, cpf: null }, rascunho[e.id], hoje));
    return m;
  }, [linhas, rascunho, hoje]);

  const comMudanca = [...planos.entries()].filter(([, p]) => p.status === 'muda');
  const comErro = [...planos.values()].filter((p) => p.status === 'erro').length;

  function mudar(e: Linha, c: CampoLote, texto: string) {
    setRascunho((r) => {
      const a = { ...(r[e.id] ?? {}) };
      if (texto === textoAtual(e, c)) delete a[c]; else a[c] = texto;
      const { [e.id]: _antigo, ...resto } = r; // eslint-disable-line @typescript-eslint/no-unused-vars
      return Object.keys(a).length ? { ...resto, [e.id]: a } : resto;
    });
  }
  /** Célula esvaziada = "não mexer": ao sair, volta o valor do cadastro (apagar não existe aqui). */
  function aoSair(e: Linha, c: CampoLote) {
    if (rascunho[e.id]?.[c] === '') mudar(e, c, textoAtual(e, c));
  }

  async function aplicar(itens: { id: string; entrada: EntradaLote }[]) {
    setSalvando(true); setErro(null);
    try {
      const r = await fetch('/api/dp/lote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa: empresaId, acao: 'aplicar', itens }),
      });
      const x = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(x.erro ?? 'Falha ao gravar.');
      const aplicados = x.aplicados as AplicadoLote[];
      const falhas = x.falhas as { nome: string; erro: string }[];
      if (falhas.length) setErro(`${falhas.length} não ${falhas.length === 1 ? 'foi gravado' : 'foram gravados'}: ${falhas.slice(0, 3).map((f) => `${f.nome || 'empregado'} (${f.erro})`).join('; ')}.`);
      if (aplicados.length) {
        setDesfazer({ aplicados, texto: `${aplicados.length} ${aplicados.length === 1 ? 'empregado atualizado' : 'empregados atualizados'}: ${resumirCampos(aplicados)}.` });
      } else if (!falhas.length) setMsg('Nada mudou: os valores já estavam no cadastro.');
      const ids = new Set(aplicados.map((a) => a.id));
      setRascunho((rs) => Object.fromEntries(Object.entries(rs).filter(([id]) => !ids.has(id))));
      setPrevia(null); setArquivo(null);
      await carregar();
      onGravou();
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha ao gravar.'); }
    finally { setSalvando(false); setConfirmando(false); }
  }

  async function desfazerUltimo() {
    if (!desfazer) return;
    const { aplicados } = desfazer;
    setDesfazer(null);
    try {
      const r = await fetch('/api/dp/lote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa: empresaId, acao: 'desfazer', itens: aplicados.map((a) => ({ id: a.id, campos: a.campos })) }),
      });
      const x = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(x.erro ?? 'Falha ao desfazer.');
      const fora = (x.ignorados as unknown[]).length;
      setMsg(`Desfeito em ${x.revertidos} ${x.revertidos === 1 ? 'empregado' : 'empregados'}.${fora ? ` ${fora} já tinha${fora === 1 ? '' : 'm'} sido alterado${fora === 1 ? '' : 's'} depois e ficou${fora === 1 ? '' : 'ram'} como está.` : ''}`);
      await carregar();
      onGravou();
    } catch (e) { setErro(e instanceof Error ? e.message : 'Falha ao desfazer.'); }
  }

  async function lerPlanilha(f: File | null) {
    setArquivo(f); setPrevia(null);
    if (!f) return;
    setLendo(true); setErro(null);
    try {
      const form = new FormData();
      form.set('empresa', empresaId);
      form.set('arquivo', f);
      const r = await fetch('/api/dp/lote', { method: 'POST', body: form });
      const x = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(x.erro ?? 'Não consegui ler a planilha.');
      setPrevia(x);
    } catch (e) { setErro(e instanceof Error ? e.message : 'Não consegui ler a planilha.'); setArquivo(null); }
    finally { setLendo(false); }
  }

  const itensDaPrevia = (previa?.linhas ?? []).filter((l) => l.plano?.status === 'muda' && l.empregadoId).map((l) => ({ id: l.empregadoId!, entrada: l.entrada }));
  const itensDaGrade = comMudanca.map(([id]) => ({ id, entrada: rascunho[id] }));
  const pendentes = modo === 'grade' ? itensDaGrade : itensDaPrevia;

  return (
    <div className="space-y-4">
      <Toasts>
        {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
        {msg && <Toast onFechar={() => setMsg(null)}>{msg}</Toast>}
        {desfazer && (
          <Toast tom="sucesso" onFechar={() => setDesfazer(null)} duracao={null}
            acao={<Botao tamanho="sm" variante="tonal" onClick={desfazerUltimo}>Desfazer</Botao>}>{desfazer.texto}</Toast>
        )}
      </Toasts>

      <Secao titulo={`Completar cadastro — ${empresaNome}`}
        descricao="Preencha o que falta; o que já está no cadastro aparece na célula. Célula em branco não muda nada — aqui nada é apagado."
        acoes={<div className="flex flex-wrap items-center gap-2">
          <Botao variante={modo === 'grade' ? 'tonal' : 'fantasma'} tamanho="sm" aria-pressed={modo === 'grade'} onClick={() => setModo('grade')}>Grade</Botao>
          <Botao variante={modo === 'planilha' ? 'tonal' : 'fantasma'} tamanho="sm" aria-pressed={modo === 'planilha'} onClick={() => setModo('planilha')}>Planilha</Botao>
          <Botao tamanho="sm" onClick={onVoltar}>Voltar à lista</Botao>
        </div>}>
        {somenteLeitura && <Aviso tom="aviso" className="mb-4">Esta empresa está arquivada: dá para consultar, não para gravar.</Aviso>}

        {linhas === null ? <Carregando /> : linhas.length === 0 ? (
          <EstadoVazio moldura={false} titulo="Nenhum empregado para completar" />
        ) : modo === 'grade' ? (
          <div className={tb.moldura}>
            <table className={cx(tb.tabela, 'min-w-[1060px]')}>
              <thead className={tb.cabeca}>
                <tr>
                  <th className={cx(tb.th, 'sticky left-0 z-10 bg-superficie-suave')}>Empregado</th>
                  {CAMPOS_LOTE.map((c) => <th key={c} className={tb.th}>{ROTULO_CAMPO[c]}</th>)}
                </tr>
              </thead>
              <tbody className={tb.corpo}>
                {linhas.map((e) => {
                  const p = planos.get(e.id);
                  return (
                    <LinhaGrade key={e.id} e={e} plano={p} rascunho={rascunho[e.id]} bloqueado={somenteLeitura || salvando}
                      onMudar={(c, t) => mudar(e, c, t)} onSair={(c) => aoSair(e, c)} />
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <PainelPlanilha empresaId={empresaId} arquivo={arquivo} lendo={lendo} previa={previa} onArquivo={lerPlanilha} />
        )}
      </Secao>

      <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-borda bg-superficie px-4 py-3 shadow-flutuante">
        <p className="text-[13px] text-tinta-suave" aria-live="polite">
          {pendentes.length === 0
            ? (modo === 'grade' ? 'Nenhuma alteração ainda.' : 'Envie a planilha para ver a prévia.')
            : `${pendentes.length} ${pendentes.length === 1 ? 'empregado com alteração' : 'empregados com alterações'}`}
          {modo === 'grade' && comErro > 0 && <span className="ml-2 font-medium text-perigo">{comErro} com erro — corrija para salvar.</span>}
        </p>
        <Botao variante="primaria" disabled={somenteLeitura || pendentes.length === 0 || (modo === 'grade' && comErro > 0)} carregando={salvando}
          onClick={() => setConfirmando(true)}>
          {modo === 'grade' ? 'Salvar alterações' : 'Aplicar planilha'}
        </Botao>
      </div>

      {confirmando && (
        <DialogoConfirmacao perigo={false} titulo={`Gravar mudanças em ${pendentes.length} ${pendentes.length === 1 ? 'empregado' : 'empregados'}?`}
          mensagem="Só o que você preencheu ou trocou é gravado; nada é apagado. Logo depois aparece o botão Desfazer."
          textoConfirmar="Gravar" onCancelar={() => setConfirmando(false)} onConfirmar={() => aplicar(pendentes)} />
      )}
    </div>
  );
}

function LinhaGrade({ e, plano, rascunho, bloqueado, onMudar, onSair }: {
  e: Linha; plano?: ReturnType<typeof planejarLinha>; rascunho?: EntradaLote; bloqueado: boolean;
  onMudar: (c: CampoLote, texto: string) => void; onSair: (c: CampoLote) => void;
}) {
  const valor = (c: CampoLote) => rascunho?.[c] ?? textoAtual(e, c);
  return (
    <>
      <tr className={tb.linha}>
        <td className={cx(tb.td, 'sticky left-0 z-10 bg-superficie font-medium text-tinta')}>
          {e.nome}
          {plano?.status === 'muda' && <Selo tom="primaria" className="ml-2">alterado</Selo>}
        </td>
        {CAMPOS_LOTE.map((c) => {
          const erroCelula = plano?.erros[c];
          const mexido = rascunho?.[c] !== undefined;
          const rotulo = `${ROTULO_CAMPO[c]} de ${e.nome}`;
          return (
            <td key={c} className={tb.tdCampo}>
              {c === 'escala' || c === 'bancoHoras' ? (
                <Selecao aparencia="celula" tamanho="sm" busca={false} largura={LARGURA[c]} aria-label={rotulo} disabled={bloqueado}
                  valor={valor(c)} placeholder="—" opcoes={c === 'escala' ? OPCOES_ESCALA : OPCOES_BANCO} onChange={(v) => onMudar(c, v)} />
              ) : (
                <input aria-label={rotulo} value={valor(c)} placeholder={PLACEHOLDER[c]} disabled={bloqueado}
                  aria-invalid={erroCelula ? true : undefined} inputMode={c === 'salarioBase' || c === 'horasSemanais' ? 'decimal' : undefined}
                  onChange={(ev) => onMudar(c, ev.target.value)} onBlur={() => onSair(c)}
                  className={cx(celulaCls, LARGURA[c], mexido && 'border-primaria bg-primaria-suave', erroCelula && 'border-perigo')} />
              )}
              {erroCelula && <span role="alert" className="mt-0.5 block max-w-[11rem] text-[11px] font-medium leading-tight text-perigo">{erroCelula}</span>}
            </td>
          );
        })}
      </tr>
      {plano?.erroLinha && (
        <tr><td colSpan={CAMPOS_LOTE.length + 1} className="bg-perigo-suave px-3 py-1.5 text-[13px] font-medium text-perigo" role="alert">{e.nome}: {plano.erroLinha}</td></tr>
      )}
    </>
  );
}

function PainelPlanilha({ empresaId, arquivo, lendo, previa, onArquivo }: {
  empresaId: string; arquivo: File | null; lendo: boolean; previa: Previa | null; onArquivo: (f: File | null) => void;
}) {
  const q = `empresa=${encodeURIComponent(empresaId)}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <CampoArquivo rotulo="Planilha preenchida (.xlsx ou .csv)" classeCampo="w-full max-w-md" accept=".xlsx,.csv,text/csv"
          nome={arquivo?.name} onArquivo={onArquivo} texto="Escolher ou soltar a planilha aqui" />
        <a href={`/api/dp/lote/modelo?${q}&formato=xlsx`} className="text-[13px] font-medium text-primaria-texto underline">Baixar modelo (.xlsx)</a>
        <a href={`/api/dp/lote/modelo?${q}&formato=csv`} className="text-[13px] font-medium text-primaria-texto underline">modelo em .csv</a>
      </div>
      {lendo && <Carregando>Lendo a planilha…</Carregando>}
      {previa && (
        <>
          <p className="text-sm text-tinta">
            <strong>{previa.resumo.muda}</strong> {previa.resumo.muda === 1 ? 'empregado muda' : 'empregados mudam'}
            {' · '}{previa.resumo.igual} sem mudança{' · '}
            <span className={previa.resumo.erro ? 'font-medium text-perigo' : ''}>{previa.resumo.erro} com problema (ficam de fora)</span>
          </p>
          {previa.ignoradas.length > 0 && (
            <Aviso tom="info">Colunas ignoradas: {previa.ignoradas.join(', ')}. Só admissão, cargo, salário, horas, escala e banco de horas são lidos.</Aviso>
          )}
          <div className={tb.moldura}>
            <table className={tb.tabela}>
              <thead className={tb.cabeca}>
                <tr><th className={tb.th}>Linha</th><th className={tb.th}>Empregado</th><th className={tb.th}>O que muda</th><th className={tb.th}>Situação</th></tr>
              </thead>
              <tbody className={tb.corpo}>
                {previa.linhas.map((l) => {
                  const p = l.plano;
                  const erros = l.problema ? [l.problema] : [...Object.values(p?.erros ?? {}), p?.erroLinha].filter(Boolean) as string[];
                  return (
                    <tr key={l.linha} className={tb.linha}>
                      <td className={cx(tb.td, 'tabular-nums text-tinta-suave')}>{l.linha}</td>
                      <td className={cx(tb.td, 'font-medium text-tinta')}>{l.nome ?? l.nomePlanilha}</td>
                      <td className={tb.td}>
                        {p && Object.entries(p.mudancas).length > 0 ? (
                          <ul className="space-y-0.5 text-[13px]">
                            {(Object.entries(p.mudancas) as [CampoLote, { antes: never; depois: never }][]).map(([c, m]) => (
                              <li key={c}><span className="text-tinta-suave">{ROTULO_CAMPO[c]}:</span> {mostrarValor(c, m.antes)} → <strong>{mostrarValor(c, m.depois)}</strong></li>
                            ))}
                          </ul>
                        ) : <span className="text-tinta-fraca">—</span>}
                        {erros.map((m) => <span key={m} role="alert" className="block text-[13px] font-medium text-perigo">{m}</span>)}
                        {p?.avisos.map((m) => <span key={m} className="block text-xs text-aviso">{m}</span>)}
                      </td>
                      <td className={tb.td}>
                        {l.problema || p?.status === 'erro' ? <Selo tom="perigo">Com problema</Selo>
                          : p?.status === 'muda' ? <Selo tom="primaria">Vai mudar</Selo> : <Selo>Sem mudança</Selo>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
