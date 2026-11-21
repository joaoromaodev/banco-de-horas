'use client';

// Departamento Pessoal — cadastro único do empregado, férias e 13º (migração 0021).
// Lista por empresa com situação e alertas; a ficha abre na mesma tela (?empregado=).
// Só a contabilidade (proxy.ts: ROTAS_PONTO, fora de CLIENTE_PODE). Ver
// docs/departamento-pessoal.md.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Aviso, Botao, CabecalhoPagina, Carregando, Conteudo, cx, Entrada, EstadoVazio, Indicador, Secao, Selo, tb,
} from '@/components/ui';
import { Selecao } from '@/components/selecao';
import { Toast, Toasts } from '@/components/retorno';
import { hojeBelem } from '@/lib/agenda';
import { br, SITUACOES_EMPREGADO, type DadosEmpregado, type Empregado } from '@/lib/dp';
import { alertasFerias, situacaoFerias, type FeriasProgramada } from '@/lib/ferias';
import { avosDecimo, entraNoDecimo, faltasPorMesDoAno } from '@/lib/decimoTerceiro';
import { comArquivadaDaUrl, FaixaArquivada } from '../FaixaArquivada';
import ConferenciaModulos from '../ConferenciaModulos';
import { Ficha, TOM_SITUACAO } from './Ficha';
import { FormEmpregado } from './FormEmpregado';
import { CompletarCadastro } from './CompletarCadastro';

interface EmpresaLista { id: string; nome: string; arquivadaEm?: string | null }
interface DadosLista { empregados: Empregado[]; ferias: FeriasProgramada[]; faltas: Record<string, string[]>; aguardandoBanco?: boolean }

const CHAVE_EMPRESA = 'dp.empresa';

function lerUrl(nome: string): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get(nome)?.trim() ?? '';
}

function gravarUrl(empresa: string, empregado: string | null) {
  const u = new URL(window.location.href);
  if (empresa) u.searchParams.set('empresa', empresa); else u.searchParams.delete('empresa');
  if (empregado) u.searchParams.set('empregado', empregado); else u.searchParams.delete('empregado');
  window.history.replaceState(null, '', u.toString());
}

export default function DepartamentoPessoalPage() {
  const hoje = hojeBelem();
  const ano = Number(hoje.slice(0, 4));
  const [empresas, setEmpresas] = useState<EmpresaLista[]>([]);
  const [empresaSel, setEmpresaSel] = useState('');
  const [dados, setDados] = useState<DadosLista | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState<string | null>(null);
  const [cadastrando, setCadastrando] = useState(false);
  // Edição em lote (grade e planilha) no lugar da lista.
  const [completando, setCompletando] = useState(false);
  const [busca, setBusca] = useState('');
  const [mostrarDesligados, setMostrarDesligados] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const empresasRef = useRef<EmpresaLista[]>([]);

  const carregar = useCallback(async (id: string) => {
    if (!id) { setDados(null); setCarregando(false); return; }
    setCarregando(true);
    try {
      const r = await fetch(`/api/dp?empresa=${encodeURIComponent(id)}`);
      const x = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(x.erro ?? 'Falha ao carregar os empregados.');
      setDados(x);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar.');
    } finally {
      setCarregando(false);
    }
  }, []);

  function trocarEmpresa(id: string, empregado: string | null = null) {
    setEmpresaSel(id);
    setAberto(empregado);
    setBusca('');
    setCompletando(false);
    gravarUrl(id, empregado);
    if (id && !empresasRef.current.find((e) => e.id === id)?.arquivadaEm) { try { localStorage.setItem(CHAVE_EMPRESA, id); } catch {} }
    carregar(id);
  }

  useEffect(() => {
    fetch('/api/empresas').then((r) => (r.ok ? r.json() : null)).then(async (x) => {
      const { lista, consulta } = await comArquivadaDaUrl<EmpresaLista>(x?.empresas ?? []);
      empresasRef.current = lista;
      setEmpresas(lista);
      const daUrl = lerUrl('empresa');
      let salva = '';
      try { salva = localStorage.getItem(CHAVE_EMPRESA) ?? ''; } catch {}
      const id = consulta || (lista.some((e) => e.id === daUrl) ? daUrl : '') || (lista.some((e) => e.id === salva) ? salva : lista[0]?.id || '');
      trocarEmpresa(id, lerUrl('empregado') || null);
    }).catch(() => { setErro('Falha ao carregar as empresas.'); setCarregando(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na montagem
  }, []);

  const empresa = empresas.find((e) => e.id === empresaSel);

  const linhas = useMemo(() => {
    if (!dados) return [];
    const porEmp = new Map<string, FeriasProgramada[]>();
    for (const f of dados.ferias) porEmp.set(f.empregadoId, [...(porEmp.get(f.empregadoId) ?? []), f]);
    return dados.empregados.map((e) => {
      const faltas = dados.faltas[e.id] ?? [];
      const periodos = situacaoFerias(e, faltas, porEmp.get(e.id) ?? [], hoje);
      const alertas = alertasFerias(e, periodos, hoje);
      const avos = entraNoDecimo(e, ano) ? avosDecimo(e, ano, faltasPorMesDoAno(faltas, ano), hoje) : null;
      const proxima = (porEmp.get(e.id) ?? []).filter((f) => f.inicio >= hoje).sort((a, b) => a.inicio.localeCompare(b.inicio))[0] ?? null;
      return { e, alertas, avos, proxima };
    });
  }, [dados, hoje, ano]);

  const visiveis = linhas
    .filter((l) => mostrarDesligados || l.e.situacao !== 'desligado')
    .filter((l) => !busca.trim() || l.e.nome.toLowerCase().includes(busca.trim().toLowerCase()))
    .sort((a, b) => peso(a.alertas) - peso(b.alertas) || a.e.nome.localeCompare(b.e.nome, 'pt-BR'));
  const ativos = linhas.filter((l) => l.e.situacao !== 'desligado');
  const vencidas = ativos.filter((l) => l.alertas.some((a) => a.nivel === 'perigo')).length;
  const vencendo = ativos.filter((l) => l.alertas.some((a) => a.rotulo === 'Férias vencendo')).length;
  const semAdmissao = ativos.filter((l) => !l.e.admissao).length;
  const desligados = linhas.length - ativos.length;

  async function cadastrar(d: DadosEmpregado): Promise<string | null> {
    const r = await fetch('/api/dp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ empresa: empresaSel, dados: d }) });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) return x.erro ?? 'Falha ao cadastrar.';
    setCadastrando(false);
    setMsg(`${x.empregado.nome} cadastrado.`);
    await carregar(empresaSel);
    return null;
  }

  function abrir(id: string | null) {
    setAberto(id);
    gravarUrl(empresaSel, id);
    if (!id) carregar(empresaSel);
    window.scrollTo({ top: 0 });
  }

  const opcoesEmpresa = empresas.map((e) => ({ valor: e.id, rotulo: e.nome, detalhe: e.arquivadaEm ? 'arquivada' : undefined }));

  return (
    <div className="text-sm">
      <CabecalhoPagina
        titulo="Departamento Pessoal"
        subtitulo="Cadastro dos empregados, férias e 13º — os prazos também aparecem na Agenda."
        acoes={<>
          <Selecao aria-label="Empresa" largura="w-64" valor={empresaSel} onChange={(id) => trocarEmpresa(id)} opcoes={opcoesEmpresa} placeholder="Escolha a empresa" />
          {!aberto && <Botao variante="primaria" disabled={!empresaSel || Boolean(dados?.aguardandoBanco)} onClick={() => setCadastrando(true)}>Cadastrar empregado</Botao>}
        </>}
      />
      <Toasts>
        {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
        {msg && <Toast onFechar={() => setMsg(null)}>{msg}</Toast>}
      </Toasts>

      <Conteudo>
        <FaixaArquivada empresa={empresa} />
        {dados?.aguardandoBanco && (
          <Aviso tom="aviso" titulo="Departamento Pessoal aguardando o banco">
            O cadastro dos empregados depende da migração 0021. Assim que ela for aplicada, os funcionários do ponto aparecem aqui sozinhos.
          </Aviso>
        )}

        {aberto ? (
          <Ficha key={aberto} id={aberto} hoje={hoje} onVoltar={() => abrir(null)} onMudou={() => {}} />
        ) : carregando ? <Carregando /> : !empresaSel ? (
          <EstadoVazio titulo="Nenhuma empresa" descricao="Cadastre uma empresa-cliente em Cadastro para começar." />
        ) : dados && !dados.aguardandoBanco && completando ? (
          <CompletarCadastro empresaId={empresaSel} empresaNome={empresa?.nome ?? ''} somenteLeitura={Boolean(empresa?.arquivadaEm)} hoje={hoje}
            onVoltar={() => { setCompletando(false); carregar(empresaSel); }} onGravou={() => {}} />
        ) : dados && !dados.aguardandoBanco && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Indicador rotulo="Empregados ativos" valor={ativos.length} />
              <Indicador rotulo="Férias vencidas" valor={vencidas} tom={vencidas ? 'perigo' : 'neutro'} destaque={vencidas > 0} />
              <Indicador rotulo="Férias vencendo" valor={vencendo} />
              <Indicador rotulo="Sem admissão" valor={semAdmissao} />
            </div>

            {semAdmissao > 0 && (
              <Aviso tom="info" titulo="Falta a data de admissão"
                acao={<Botao tamanho="sm" variante="tonal" onClick={() => setCompletando(true)}>Completar cadastro</Botao>}>
                {semAdmissao === 1 ? '1 empregado está' : `${semAdmissao} empregados estão`} sem data de admissão — sem ela não dá para calcular férias nem 13º. Complete tudo de uma vez em “Completar cadastro” ou abra a ficha de cada um.
              </Aviso>
            )}

            <ConferenciaModulos key={`${empresaSel}|${dados.empregados.length}|${dados.ferias.length}`} url={`/api/dp/conferencia?empresa=${encodeURIComponent(empresaSel)}`} />

            <Secao titulo="Empregados"
              acoes={<div className="flex flex-wrap items-center gap-2">
                <Entrada aria-label="Buscar empregado" placeholder="Buscar pelo nome" tamanho="sm" largura="w-48" value={busca} onChange={(e) => setBusca(e.target.value)} />
                {linhas.length > 0 && <Botao tamanho="sm" onClick={() => setCompletando(true)}>Completar cadastro</Botao>}
                {desligados > 0 && (
                  <Botao tamanho="sm" variante="fantasma" onClick={() => setMostrarDesligados((v) => !v)}>
                    {mostrarDesligados ? 'Ocultar desligados' : `Mostrar desligados (${desligados})`}
                  </Botao>
                )}
              </div>}>
              {linhas.length === 0 ? (
                <EstadoVazio moldura={false} titulo="Nenhum empregado nesta empresa"
                  descricao="Funcionários cadastrados na Folha de Ponto e contratos de experiência entram aqui sozinhos. Ou cadastre agora." />
              ) : visiveis.length === 0 ? (
                <EstadoVazio moldura={false} titulo="Nada encontrado" />
              ) : (
                <div className={tb.moldura}>
                  <table className={tb.tabela}>
                    <thead className={tb.cabeca}>
                      <tr>
                        <th className={tb.th}>Empregado</th><th className={tb.th}>Admissão</th><th className={tb.th}>Situação</th>
                        <th className={tb.th}>Férias</th><th className={tb.th}>13º {ano}</th><th className={tb.th}><span className="sr-only">Ação</span></th>
                      </tr>
                    </thead>
                    <tbody className={tb.corpo}>
                      {visiveis.map(({ e, alertas, avos, proxima }) => {
                        const principal = alertas[0];
                        return (
                          <tr key={e.id} className={tb.linha}>
                            <td className={tb.td}>
                              <button type="button" onClick={() => abrir(e.id)} className="text-left font-medium text-tinta hover:text-primaria-texto hover:underline">{e.nome}</button>
                              {e.cargo && <span className="block text-xs text-tinta-suave">{e.cargo}</span>}
                            </td>
                            <td className={cx(tb.td, 'whitespace-nowrap tabular-nums')}>{br(e.admissao) || <span className="text-tinta-fraca">—</span>}</td>
                            <td className={tb.td}><Selo tom={TOM_SITUACAO[e.situacao]}>{SITUACOES_EMPREGADO.find((s) => s.valor === e.situacao)?.rotulo}</Selo></td>
                            <td className={tb.td}>
                              {principal ? (
                                <span data-dica={alertas.map((a) => a.texto).join(' · ')}>
                                  <Selo tom={principal.nivel === 'perigo' ? 'perigo' : principal.nivel === 'aviso' ? 'aviso' : 'neutro'}>{principal.rotulo}</Selo>
                                  {alertas.length > 1 && <span className="ml-1 text-xs text-tinta-suave">+{alertas.length - 1}</span>}
                                </span>
                              ) : proxima ? (
                                <span className="text-[13px] text-tinta-suave">Programadas: {br(proxima.inicio)}</span>
                              ) : e.situacao === 'desligado' ? <span className="text-tinta-fraca">—</span> : <span className="text-[13px] text-tinta-suave">Em dia</span>}
                            </td>
                            <td className={cx(tb.td, 'tabular-nums')}>{avos ? `${avos.avos}/12` : <span className="text-tinta-fraca">—</span>}</td>
                            <td className={cx(tb.td, 'text-right')}><Botao tamanho="sm" onClick={() => abrir(e.id)}>Abrir ficha</Botao></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Secao>
          </>
        )}
      </Conteudo>

      {cadastrando && empresa && <FormEmpregado empresaNome={empresa.nome} onSalvar={cadastrar} onCancelar={() => setCadastrando(false)} />}
    </div>
  );
}

/** Ordem da lista: vencidas, vencendo, outros avisos, sem alerta. */
function peso(alertas: { nivel: string }[]): number {
  if (alertas.some((a) => a.nivel === 'perigo')) return 0;
  if (alertas.some((a) => a.nivel === 'aviso')) return 1;
  if (alertas.length) return 2;
  return 3;
}
