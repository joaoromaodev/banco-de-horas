'use client';

// Contratos de experiência — a contadora cadastra a admissão uma vez e tira os
// três documentos (contrato, declaração de vale-transporte e aviso de término)
// a partir dos modelos dela. Os contratos ficam salvos para lembrar dos
// vencimentos. Ver docs/contratos-experiencia.md.
import { useEffect, useRef, useState } from 'react';
import {
  AlertaConsolidado, avisos, br, ContratoSalvo, DadosContrato, dadosVazios, Dia, DIAS, diasEntre, Documento,
  formatarValor, horarioPadrao, HorarioDia, hojeBelem, lerValor, minutosSemana, reaisExtenso,
  retornoSugerido, Situacao, Trajeto, validar, vencimento1, vencimento2,
} from '@/lib/contratos';
import { DialogoConfirmacao } from '../Dialogo';
import { comArquivadaDaUrl, FaixaArquivada } from '../FaixaArquivada';
import { IconeBaixar, IconeDesfazer, IconeExcluir, IconeMais } from '../icones';
import {
  Aviso, Botao, BotaoIcone, CabecalhoPagina, Conteudo, Entrada, EstadoVazio, Marcacao, Secao, Selo, Tom,
} from '@/components/ui';
import { EntradaSugestoes, Selecao } from '@/components/selecao';
import { Toast, Toasts } from '@/components/retorno';

interface Empresa { id: string; nome: string; trabalhaSabado: boolean; jornadaUtilMin?: number; jornadaSabadoMin?: number; arquivadaEm?: string | null }
interface Funcionario { nome: string; cargo?: string | null }

const ROTULO_SITUACAO: Record<Situacao, string> = {
  experiencia: 'Em experiência', efetivado: 'Efetivado', encerrado: 'Encerrado',
};
const TOM_SITUACAO: Record<Situacao, Tom> = { experiencia: 'aviso', efetivado: 'sucesso', encerrado: 'neutro' };
const NOME_DIA: Record<Dia, string> = { SEG: 'Segunda', TER: 'Terça', QUA: 'Quarta', QUI: 'Quinta', SEX: 'Sexta', SAB: 'Sábado' };
const ESTADOS_CIVIS = ['Solteiro(a)', 'Casado(a)', 'Divorciado(a)', 'Viúvo(a)', 'União estável'];

function nomeDoArquivo(cd: string | null, padrao: string) {
  const m = cd && /filename\*=UTF-8''([^;]+)/i.exec(cd);
  return m ? decodeURIComponent(m[1]) : padrao;
}

export default function ContratosPage() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaSel, setEmpresaSel] = useState('');
  const [funcionarios, setFuncionarios] = useState<Funcionario[]>([]);
  const [contratos, setContratos] = useState<ContratoSalvo[]>([]);
  const [semTabela, setSemTabela] = useState(false);
  const [alertas, setAlertas] = useState<AlertaConsolidado[]>([]);
  const [formato, setFormato] = useState<'docx' | 'pdf'>('docx');

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [situacao, setSituacao] = useState<Situacao>('experiencia');
  const [d, setD] = useState<DadosContrato>(() => dadosVazios());
  const [sujo, setSujo] = useState(false);

  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<ContratoSalvo | null>(null);
  const [desfazer, setDesfazer] = useState<ContratoSalvo | null>(null);
  const [busca, setBusca] = useState('');

  const empresa = empresas.find((e) => e.id === empresaSel);

  // ------------------------------------------------------------------ carga
  /** Formulário em branco para a empresa, com o que dá para pré-preencher. */
  function formNovo(emp: Empresa | undefined, lista: ContratoSalvo[]): DadosContrato {
    const base = dadosVazios();
    if (emp) {
      base.empresaNome = emp.nome;
      base.horario = horarioPadrao({ utilMin: emp.jornadaUtilMin, sabadoMin: emp.jornadaSabadoMin, trabalhaSabado: emp.trabalhaSabado });
      // Endereço/cidade da empregadora: do último contrato salvo; senão, do cadastro fiscal; senão, do navegador.
      const ultimo = lista[0]?.dados;
      let local: { endereco?: string; cidade?: string } = {};
      try { local = JSON.parse(localStorage.getItem(`contratos.empregadora.${emp.id}`) ?? '{}'); } catch {}
      const fiscal = empregadoraRef.current;
      base.empresaEndereco = ultimo?.empresaEndereco || fiscal?.endereco || local.endereco || '';
      base.cidade = ultimo?.cidade || fiscal?.cidade || local.cidade || base.cidade;
    }
    base.termino = vencimento1(base);
    base.retorno = retornoSugerido(base.termino);
    return base;
  }

  function novo(emp = empresa, lista = contratos) {
    setD(formNovo(emp, lista));
    setEditandoId(null);
    setSituacao('experiencia');
    setSujo(false);
  }

  /** Carrega a lista; com `reiniciar`, abre um formulário novo já com o pré-preenchimento dela. */
  async function carregar(id = empresaSel, reiniciar = false) {
    if (!id) return;
    const r = await fetch(`/api/contratos?empresa=${encodeURIComponent(id)}`);
    const x = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(x.erro ?? 'Falha ao carregar.');
    const lista: ContratoSalvo[] = x.contratos ?? [];
    setSemTabela(Boolean(x.semTabela));
    empregadoraRef.current = x.empregadora ?? null;
    setContratos(lista);
    carregarAlertas();
    const alvo = abrirPendente.current ? lista.find((c) => c.id === abrirPendente.current) : undefined;
    abrirPendente.current = null;
    if (alvo) abrir(alvo);
    else if (reiniciar) novo(empresasRef.current.find((e) => e.id === id), lista);
  }

  /** Faixa do topo: vencimentos de TODAS as empresas que o usuário enxerga. */
  async function carregarAlertas() {
    try {
      const r = await fetch('/api/contratos/alertas');
      const x = await r.json();
      if (r.ok) setAlertas(x.alertas ?? []);
    } catch { /* a faixa é só um lembrete: sem ela a tela segue funcionando */ }
  }

  /** Clique num alerta: troca para a empresa dele (se preciso) e abre o contrato. */
  function abrirAlerta(a: AlertaConsolidado) {
    const c = a.empresa === empresaSel ? contratos.find((k) => k.id === a.id) : undefined;
    if (c) { abrir(c); return; }
    abrirPendente.current = a.id;
    trocarEmpresa(a.empresa);
  }

  // `empresas` vista de dentro de callbacks assíncronos
  const empresasRef = useRef<Empresa[]>([]);
  // contrato a abrir assim que a lista da empresa escolhida pelo alerta chegar
  const abrirPendente = useRef<string | null>(null);
  // endereço/cidade da sede vindos do cadastro fiscal da empresa
  const empregadoraRef = useRef<{ endereco: string; cidade: string } | null>(null);

  function trocarEmpresa(id: string, lista = empresasRef.current) {
    setEmpresaSel(id);
    setDesfazer(null); setErro(null); setMsg(null);
    if (!id) return;
    // Arquivada (consulta) não vira a empresa lembrada.
    if (!lista.find((e) => e.id === id)?.arquivadaEm) { try { localStorage.setItem('contratos.empresa', id); } catch {} }
    novo(lista.find((e) => e.id === id), []);
    fetch(`/api/funcionarios?empresa=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null)).then((x) => setFuncionarios(x?.funcionarios ?? [])).catch(() => setFuncionarios([]));
    carregar(id, true).catch((e) => setErro(e.message));
  }

  useEffect(() => {
    try { if (localStorage.getItem('contratos.formato') === 'pdf') setFormato('pdf'); } catch {}
    fetch('/api/empresas').then((r) => (r.ok ? r.json() : null)).then(async (x) => {
      // `?empresa=` de uma arquivada (consulta, só leitura): entra na lista e é a selecionada.
      const { lista, consulta } = await comArquivadaDaUrl<Empresa>(x?.empresas ?? []);
      empresasRef.current = lista;
      setEmpresas(lista);
      let salva = '';
      try { salva = localStorage.getItem('contratos.empresa') ?? ''; } catch {}
      trocarEmpresa(consulta || (lista.some((e) => e.id === salva) ? salva : lista[0]?.id || ''), lista);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na montagem
  }, []);

  // ------------------------------------------------------------------ edição
  function mudar<K extends keyof DadosContrato>(campo: K, valor: DadosContrato[K]) {
    setSujo(true);
    setD((ant) => {
      const prox = { ...ant, [campo]: valor };
      // Datas encadeadas: se o término estava num vencimento, acompanha o vencimento;
      // se o retorno era o sugerido, acompanha o término.
      if (campo === 'admissao' || campo === 'diasPeriodo' || campo === 'diasProrrogacao') {
        if (ant.termino === vencimento1(ant)) prox.termino = vencimento1(prox);
        else if (ant.termino === vencimento2(ant)) prox.termino = vencimento2(prox) ?? vencimento1(prox);
      }
      if (prox.termino !== ant.termino && ant.retorno === retornoSugerido(ant.termino)) {
        prox.retorno = retornoSugerido(prox.termino);
      }
      return prox;
    });
  }

  function mudarDia(dia: Dia, campo: keyof HorarioDia, valor: string | boolean) {
    setSujo(true);
    setD((ant) => ({ ...ant, horario: { ...ant.horario, [dia]: { ...ant.horario[dia], [campo]: valor } } }));
  }

  /** Replica o horário de segunda para os outros dias úteis. */
  function copiarSegunda() {
    setSujo(true);
    setD((ant) => {
      const h = { ...ant.horario };
      for (const dia of ['TER', 'QUA', 'QUI', 'SEX'] as Dia[]) h[dia] = { ...ant.horario.SEG };
      return { ...ant, horario: h };
    });
  }

  function mudarTrajeto(qual: 'ida' | 'volta', i: number, campo: keyof Trajeto, valor: string) {
    setSujo(true);
    setD((ant) => ({ ...ant, [qual]: ant[qual].map((t, j) => (j === i ? { ...t, [campo]: valor } : t)) }));
  }

  function escolherNome(nome: string) {
    mudar('nome', nome);
    const f = funcionarios.find((x) => x.nome.toLowerCase() === nome.trim().toLowerCase());
    if (f?.cargo && !d.funcao) mudar('funcao', f.cargo);
  }

  function sairDoSalario() {
    const v = lerValor(d.salario);
    if (v == null) return;
    setD((ant) => ({ ...ant, salario: formatarValor(v), salarioExtenso: reaisExtenso(v) }));
  }

  function abrir(c: ContratoSalvo) {
    setD(c.dados);
    setEditandoId(c.id);
    setSituacao(c.situacao);
    setSujo(false);
    setErro(null); setMsg(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ------------------------------------------------------------------ ações
  async function salvar() {
    setErro(null); setMsg(null);
    const erros = validar(d);
    if (erros.length) { setErro(erros.join(' ')); return; }
    setOcupado('salvar');
    try {
      const r = await fetch('/api/contratos', {
        method: editandoId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editandoId ? { id: editandoId, dados: d, situacao } : { empresa: empresaSel, dados: d }),
      });
      const x = await r.json();
      if (!r.ok) throw new Error(x.erro);
      try { localStorage.setItem(`contratos.empregadora.${empresaSel}`, JSON.stringify({ endereco: d.empresaEndereco, cidade: d.cidade })); } catch {}
      setEditandoId(x.contrato.id);
      setSujo(false);
      setMsg(editandoId ? 'Contrato atualizado.' : 'Contrato salvo.');
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao salvar.');
    } finally { setOcupado(null); }
  }

  async function mudarSituacao(c: ContratoSalvo, s: Situacao) {
    setErro(null);
    const r = await fetch('/api/contratos', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, situacao: s }),
    });
    const x = await r.json();
    if (!r.ok) { setErro(x.erro); return; }
    if (editandoId === c.id) setSituacao(s);
    await carregar();
  }

  async function baixar(doc: Documento | 'todos') {
    setErro(null); setMsg(null);
    const erros = validar(d);
    if (erros.length) { setErro(erros.join(' ')); return; }
    setOcupado(doc);
    try {
      try { localStorage.setItem(`contratos.empregadora.${empresaSel}`, JSON.stringify({ endereco: d.empresaEndereco, cidade: d.cidade })); } catch {}
      const r = await fetch('/api/contratos/documento', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa: empresaSel, documento: doc, dados: d, formato }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro ?? 'Falha ao gerar.');
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nomeDoArquivo(r.headers.get('Content-Disposition'), doc === 'todos' ? 'documentos.zip' : `${doc}.${formato}`);
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao gerar.');
    } finally { setOcupado(null); }
  }

  async function confirmarExclusao() {
    const c = excluindo;
    setExcluindo(null);
    if (!c) return;
    const r = await fetch(`/api/contratos?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' });
    const x = await r.json();
    if (!r.ok) { setErro(x.erro); return; }
    setDesfazer(c);
    if (editandoId === c.id) novo(empresa, contratos.filter((k) => k.id !== c.id));
    await carregar();
  }

  async function desfazerExclusao() {
    const c = desfazer;
    setDesfazer(null);
    if (!c) return;
    const r = await fetch('/api/contratos', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, restaurar: true }),
    });
    const x = await r.json();
    if (!r.ok) { setErro(x.erro); return; }
    await carregar();
    setMsg('Contrato restaurado.');
  }

  // ------------------------------------------------------------------ derivados
  const hoje = hojeBelem();
  const v1 = d.admissao ? vencimento1(d) : '';
  const v2 = d.admissao ? vencimento2(d) : null;
  const sem = minutosSemana(d.horario);
  const listaAvisos = avisos(d);

  // CLT art. 452: novo contrato por prazo determinado com o mesmo empregado
  // antes de 6 meses do fim do anterior vira prazo indeterminado.
  const cpfLimpo = d.cpf.replace(/\D/g, '');
  const anterior = cpfLimpo.length === 11
    ? contratos.find((c) => c.id !== editandoId && c.dados.cpf.replace(/\D/g, '') === cpfLimpo
        && Math.abs(diasEntre(c.dados.admissao, d.admissao)) < 270)
    : undefined;
  if (anterior) listaAvisos.push(`Já existe contrato de experiência com este CPF (admissão em ${br(anterior.dados.admissao)}). A CLT (art. 452) exige 6 meses entre contratos a prazo.`);

  const filtrados = contratos.filter((c) => !busca.trim() || c.dados.nome.toLowerCase().includes(busca.trim().toLowerCase()));

  return (
    <div className="text-sm">
      <CabecalhoPagina titulo="Contrato de Experiência"
        subtitulo="Contrato, declaração de vale-transporte e aviso de término a partir de um cadastro só"
        acoes={
          <Selecao aria-label="Empresa" largura="w-60 max-w-full" valor={empresaSel} onChange={(v) => trocarEmpresa(v)}
            placeholder="— nenhuma empresa —"
            opcoes={empresas.map((e) => ({ valor: e.id, rotulo: e.nome }))} />
        } />

      <Toasts>
        {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
        {msg && <Toast onFechar={() => setMsg(null)}>{msg}</Toast>}
        {desfazer && (
          <Toast tom="info" onFechar={() => setDesfazer(null)}
            acao={<Botao tamanho="sm" variante="tonal" icone={<IconeDesfazer size={15} />} onClick={desfazerExclusao}>Desfazer</Botao>}>
            Contrato excluído — {desfazer.dados.nome}.
          </Toast>
        )}
      </Toasts>

      <Conteudo>
        <FaixaArquivada empresa={empresa} />
        {semTabela && (
          <Aviso tom="aviso">
            O banco ainda não tem a tabela de contratos (migração <code className="font-mono text-xs">0009</code> pendente). Os documentos já podem ser
            gerados normalmente; salvar e os alertas de vencimento ficam disponíveis depois da migração.
          </Aviso>
        )}

        {alertas.length > 0 && (
          <Aviso tom={alertas.some((a) => a.tipo === 'vencido') ? 'perigo' : 'aviso'} titulo="Vencimentos de experiência — todas as empresas">
            <ul className="mt-1 space-y-1">
              {alertas.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => abrirAlerta(a)} className="rounded text-left underline-offset-2 hover:underline">
                    <strong>{a.nome}</strong> <span className="text-tinta-suave">({a.empresaNome || 'empresa'})</span> — {a.marco}{' '}
                    {a.tipo === 'vencido'
                      ? <span className="font-semibold text-perigo">venceu em {br(a.data)}: marque como efetivado ou encerrado</span>
                      : <>vence em {br(a.data)} ({a.dias === 0 ? 'hoje' : a.dias === 1 ? 'amanhã' : `em ${a.dias} dias`})</>}
                  </button>
                </li>
              ))}
            </ul>
          </Aviso>
        )}

        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          {/* ---------------------------------------------------- lista */}
          <aside className="space-y-3" aria-label="Contratos salvos">
            <Botao className="w-full" icone={<IconeMais />} onClick={() => { novo(); setMsg(null); setErro(null); }}>
              Novo contrato
            </Botao>
            {contratos.length > 5 && (
              <Entrada aria-label="Buscar contrato pelo nome" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome…" />
            )}
            <div className="space-y-2">
              {filtrados.length === 0 && (
                <EstadoVazio titulo={semTabela ? 'Salvar ainda indisponível.' : 'Nenhum contrato salvo para esta empresa.'} />
              )}
              {filtrados.map((c) => (
                <div key={c.id}
                  className={`rounded-xl border bg-superficie px-3 py-2.5 shadow-cartao transition-colors ${editandoId === c.id ? 'border-primaria ring-2 ring-primaria-borda' : 'border-borda hover:border-borda-forte'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <button type="button" onClick={() => abrir(c)} aria-current={editandoId === c.id ? 'true' : undefined}
                      className="min-w-0 flex-1 rounded text-left">
                      <div className="truncate font-medium text-tinta">{c.dados.nome}</div>
                      <div className="text-xs text-tinta-suave">
                        {c.dados.funcao || '—'} · adm. {br(c.dados.admissao)}
                      </div>
                      <div className="text-xs text-tinta-suave">
                        vence {br(vencimento1(c.dados))}{vencimento2(c.dados) ? ` · prorr. ${br(vencimento2(c.dados)!)}` : ''}
                      </div>
                    </button>
                    <BotaoIcone tamanho="sm" tom="perigo" rotulo="Excluir contrato" onClick={() => setExcluindo(c)}>
                      <IconeExcluir size={15} />
                    </BotaoIcone>
                  </div>
                  <div className="mt-2">
                    <Selecao aparencia="selo" tom={TOM_SITUACAO[c.situacao]} aria-label={`Situação do contrato de ${c.dados.nome}`}
                      valor={c.situacao} onChange={(v) => mudarSituacao(c, v as Situacao)}
                      opcoes={(Object.keys(ROTULO_SITUACAO) as Situacao[]).map((s) => ({ valor: s, rotulo: ROTULO_SITUACAO[s] }))} />
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {/* ---------------------------------------------------- formulário */}
          <div className="min-w-0 space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-tinta-suave">
              <span>{editandoId ? <>Editando <strong className="text-tinta">{d.nome || 'contrato'}</strong></> : 'Novo contrato'}</span>
              {sujo && <Selo tom="aviso">alterações não salvas</Selo>}
            </div>

            <Secao titulo="Empregadora">
              <div className="grid gap-4 md:grid-cols-[2fr_3fr_1fr]">
                <Entrada rotulo="Razão social" value={d.empresaNome} onChange={(e) => mudar('empresaNome', e.target.value)} />
                <Entrada rotulo="Endereço da sede (vai no contrato)" value={d.empresaEndereco}
                  placeholder="Rua Três de Maio, nº 253 – Bairro de São Brás – Belém/PA"
                  onChange={(e) => mudar('empresaEndereco', e.target.value)} />
                <Entrada rotulo="Cidade da assinatura" value={d.cidade} onChange={(e) => mudar('cidade', e.target.value)} />
              </div>
            </Secao>

            <Secao titulo="Empregado">
              <div className="grid gap-4 md:grid-cols-4">
                <EntradaSugestoes rotulo="Nome completo" classeCampo="md:col-span-2" value={d.nome} onChange={escolherNome}
                  sugestoes={funcionarios.map((f) => f.nome)} />
                <Selecao rotulo="Tratamento" valor={d.sexo} onChange={(v) => mudar('sexo', v as 'M' | 'F')}
                  opcoes={[{ valor: 'M', rotulo: 'Sr. (masculino)' }, { valor: 'F', rotulo: 'Sra. (feminino)' }]} />
                <Entrada rotulo="CPF" value={d.cpf} onChange={(e) => mudar('cpf', e.target.value)} placeholder="000.000.000-00" inputMode="numeric" />
                <Entrada rotulo="CTPS digital nº" value={d.ctps} onChange={(e) => mudar('ctps', e.target.value)} />
                <Entrada rotulo="UF da CTPS" maxLength={2} value={d.ctpsUf} onChange={(e) => mudar('ctpsUf', e.target.value.toUpperCase())} />
                <EntradaSugestoes rotulo="Estado civil" value={d.estadoCivil} onChange={(v) => mudar('estadoCivil', v)} sugestoes={ESTADOS_CIVIS} />
                <Entrada rotulo="Nacionalidade" value={d.nacionalidade} placeholder={d.sexo === 'F' ? 'Brasileira' : 'Brasileiro'}
                  onChange={(e) => mudar('nacionalidade', e.target.value)} />
              </div>
            </Secao>

            <Secao titulo="Contrato">
              <div className="grid gap-4 md:grid-cols-4">
                <Entrada rotulo="Função" classeCampo="md:col-span-2" value={d.funcao} onChange={(e) => mudar('funcao', e.target.value)} />
                <Entrada rotulo="Salário (R$)" inputMode="decimal" value={d.salario} onChange={(e) => mudar('salario', e.target.value)}
                  onBlur={sairDoSalario} placeholder="1.518,00" />
                <Entrada rotulo="Profissão (declaração de VT)" value={d.profissao} placeholder={d.funcao || 'igual à função'}
                  onChange={(e) => mudar('profissao', e.target.value)} />
                <Entrada rotulo="Salário por extenso" classeCampo="md:col-span-4" value={d.salarioExtenso}
                  onChange={(e) => mudar('salarioExtenso', e.target.value)} />
                <Entrada rotulo="Admissão (= assinatura)" type="date" value={d.admissao} onChange={(e) => mudar('admissao', e.target.value)} />
                <Entrada rotulo="1º período (dias)" type="number" min={1} max={90} value={d.diasPeriodo}
                  onChange={(e) => mudar('diasPeriodo', Number(e.target.value))} />
                <Entrada rotulo="Prorrogação (dias, 0 = sem)" type="number" min={0} max={89} value={d.diasProrrogacao}
                  onChange={(e) => mudar('diasProrrogacao', Number(e.target.value))} />
                <dl className="grid grid-cols-[auto_1fr] content-center gap-x-2 gap-y-0.5 rounded-lg bg-superficie-suave px-3 py-2 text-xs text-tinta-suave ring-1 ring-inset ring-borda">
                  <dt>Vence em</dt><dd className="font-semibold text-tinta">{br(v1) || '—'}</dd>
                  <dt>Prorrogado até</dt><dd className="font-semibold text-tinta">{v2 ? br(v2) : '—'}</dd>
                  <dt>Total</dt><dd>{d.diasPeriodo + d.diasProrrogacao} de 90 dias</dd>
                </dl>
              </div>
            </Secao>

            <Secao titulo="Horário de trabalho"
              acoes={<Botao tamanho="sm" variante="fantasma" onClick={copiarSegunda}>Copiar segunda para os dias úteis</Botao>}>
              <div className="relative overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-wider text-tinta-suave">
                    <tr>
                      <th className="pb-2 pr-3 font-semibold">Dia</th><th className="pb-2 pr-3 font-semibold">Folga</th>
                      <th className="pb-2 pr-2 font-semibold">Entrada</th><th className="pb-2 pr-2 font-semibold">Saída</th>
                      <th className="pb-2 font-semibold">Intervalo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {DIAS.map((dia) => {
                      const h = d.horario[dia];
                      return (
                        <tr key={dia} className="border-t border-borda/70">
                          <td className="py-1.5 pr-3 font-medium text-tinta">{NOME_DIA[dia]}</td>
                          <td className="py-1.5 pr-3">
                            <input type="checkbox" aria-label={`Folga na ${NOME_DIA[dia].toLowerCase()}`} checked={h.folga}
                              onChange={(e) => mudarDia(dia, 'folga', e.target.checked)} />
                          </td>
                          <td className="py-1.5 pr-2"><Entrada type="time" tamanho="sm" largura="w-28" disabled={h.folga} aria-label={`Entrada, ${NOME_DIA[dia]}`}
                            value={h.entrada} onChange={(e) => mudarDia(dia, 'entrada', e.target.value)} /></td>
                          <td className="py-1.5 pr-2"><Entrada type="time" tamanho="sm" largura="w-28" disabled={h.folga} aria-label={`Saída, ${NOME_DIA[dia]}`}
                            value={h.saida} onChange={(e) => mudarDia(dia, 'saida', e.target.value)} /></td>
                          <td className="py-1.5">
                            <div className="flex items-center gap-1.5">
                              <Entrada type="time" tamanho="sm" largura="w-28" disabled={h.folga} aria-label={`Início do intervalo, ${NOME_DIA[dia]}`}
                                value={h.intervaloInicio} onChange={(e) => mudarDia(dia, 'intervaloInicio', e.target.value)} />
                              <span className="text-tinta-fraca" aria-hidden="true">–</span>
                              <Entrada type="time" tamanho="sm" largura="w-28" disabled={h.folga} aria-label={`Fim do intervalo, ${NOME_DIA[dia]}`}
                                value={h.intervaloFim} onChange={(e) => mudarDia(dia, 'intervaloFim', e.target.value)} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3 text-[13px] text-tinta-suave">
                <Entrada rotulo="Repouso semanal" tamanho="sm" largura="w-24" value={d.repouso} onChange={(e) => mudar('repouso', e.target.value.toUpperCase())} />
                {sem != null && <span className="pb-1.5">Total semanal: <strong className="text-tinta">{Math.floor(sem / 60)}h{sem % 60 ? String(sem % 60).padStart(2, '0') : ''}</strong></span>}
              </div>
            </Secao>

            <Secao titulo="Vale-transporte">
              <div role="radiogroup" aria-label="Vale-transporte" className="mb-4 flex flex-wrap gap-x-6 gap-y-2">
                {([['nao', 'Não recebe'], ['sim', 'Recebe vale-transporte'], ['', 'Deixar em branco (marca à mão)']] as const).map(([v, r]) => (
                  <Marcacao key={v} type="radio" name="vt" checked={d.vt === v} onChange={() => mudar('vt', v)}>{r}</Marcacao>
                ))}
              </div>
              <div className="grid gap-4 md:grid-cols-6">
                <Entrada rotulo="Endereço residencial" classeCampo="md:col-span-3" value={d.endRua} onChange={(e) => mudar('endRua', e.target.value)} />
                <Entrada rotulo="Nº" value={d.endNum} onChange={(e) => mudar('endNum', e.target.value)} />
                <Entrada rotulo="Bairro" classeCampo="md:col-span-2" value={d.endBairro} onChange={(e) => mudar('endBairro', e.target.value)} />
                <Entrada rotulo="Cidade" classeCampo="md:col-span-3" value={d.endCidade} onChange={(e) => mudar('endCidade', e.target.value)} />
                <Entrada rotulo="CEP" classeCampo="md:col-span-2" value={d.endCep} onChange={(e) => mudar('endCep', e.target.value)} />
                <Entrada rotulo="UF" maxLength={2} value={d.endUf} onChange={(e) => mudar('endUf', e.target.value.toUpperCase())} />
              </div>
              {d.vt === 'sim' && (
                <div className="mt-5 grid gap-5 md:grid-cols-2">
                  {(['ida', 'volta'] as const).map((qual) => {
                    const sentido = qual === 'ida' ? 'Residência → trabalho' : 'Trabalho → residência';
                    return (
                      <fieldset key={qual}>
                        <legend className="mb-1.5 text-[13px] font-medium text-tinta">{sentido}</legend>
                        {d[qual].map((t, i) => (
                          <div key={i} className="mb-1.5 grid grid-cols-[1fr_1.4fr_0.8fr] gap-1.5">
                            <Entrada tamanho="sm" placeholder="Linha" aria-label={`${sentido}: linha ${i + 1}`} value={t.linha} onChange={(e) => mudarTrajeto(qual, i, 'linha', e.target.value)} />
                            <Entrada tamanho="sm" placeholder="Empresa operadora" aria-label={`${sentido}: operadora ${i + 1}`} value={t.operadora} onChange={(e) => mudarTrajeto(qual, i, 'operadora', e.target.value)} />
                            <Entrada tamanho="sm" placeholder="Tarifa" aria-label={`${sentido}: tarifa ${i + 1}`} value={t.tarifa} onChange={(e) => mudarTrajeto(qual, i, 'tarifa', e.target.value)} />
                          </div>
                        ))}
                      </fieldset>
                    );
                  })}
                </div>
              )}
            </Secao>

            <Secao titulo="Aviso de término (quando não for efetivar)">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <Entrada rotulo="Término do contrato" type="date" value={d.termino} onChange={(e) => mudar('termino', e.target.value)} />
                  <div className="-ml-2 mt-1 flex flex-wrap">
                    <Botao tamanho="sm" variante="fantasma" onClick={() => mudar('termino', v1)}>fim do 1º período</Botao>
                    {v2 && <Botao tamanho="sm" variante="fantasma" onClick={() => mudar('termino', v2)}>fim da prorrogação</Botao>}
                  </div>
                </div>
                <Entrada rotulo="Retorno para receber a rescisão" type="date" value={d.retorno} onChange={(e) => mudar('retorno', e.target.value)}
                  dica="Até 10 dias após o término (CLT art. 477 §6)." />
                <Entrada rotulo="Data do aviso" type="date" value={d.dataAviso} onChange={(e) => mudar('dataAviso', e.target.value)} />
              </div>
            </Secao>

            {listaAvisos.length > 0 && (
              <Aviso tom="aviso" titulo="Confira antes de gerar">
                <ul className="list-disc space-y-0.5 pl-4">
                  {listaAvisos.map((a) => <li key={a}>{a}</li>)}
                </ul>
              </Aviso>
            )}

            {/* ---------------------------------------------------- ações */}
            <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-borda bg-superficie/95 p-3 shadow-flutuante backdrop-blur">
              <span data-dica={semTabela ? 'Aguardando a migração 0009 no banco' : undefined}>
                <Botao variante="primaria" onClick={salvar} carregando={ocupado === 'salvar'} disabled={!!ocupado || semTabela}>
                  {ocupado === 'salvar' ? 'Salvando…' : editandoId ? 'Salvar alterações' : 'Salvar contrato'}
                </Botao>
              </span>
              <span className="mx-1 hidden h-6 w-px bg-borda sm:block" aria-hidden="true" />
              <div role="radiogroup" aria-label="Formato do documento" className="flex items-center gap-3">
                {([['docx', 'Word'], ['pdf', 'PDF']] as const).map(([v, r]) => (
                  <Marcacao key={v} type="radio" name="formato" checked={formato === v}
                    onChange={() => { setFormato(v); try { localStorage.setItem('contratos.formato', v); } catch {} }}>{r}</Marcacao>
                ))}
              </div>
              {([['contrato', 'Contrato'], ['vale', 'Declaração de VT'], ['encerramento', 'Aviso de término']] as const).map(([doc, r]) => (
                <Botao key={doc} onClick={() => baixar(doc)} carregando={ocupado === doc} disabled={!!ocupado} icone={<IconeBaixar />}>
                  {ocupado === doc ? 'Gerando…' : r}
                </Botao>
              ))}
              <Botao variante="tonal" onClick={() => baixar('todos')} carregando={ocupado === 'todos'} disabled={!!ocupado} icone={<IconeBaixar />}>
                {ocupado === 'todos' ? 'Gerando…' : 'Admissão completa (.zip)'}
              </Botao>
            </div>
          </div>
        </div>
      </Conteudo>

      {excluindo && (
        <DialogoConfirmacao
          titulo="Excluir contrato?"
          mensagem={<>O contrato de <strong>{excluindo.dados.nome}</strong> sai da lista. Dá para desfazer logo em seguida.</>}
          onConfirmar={confirmarExclusao}
          onCancelar={() => setExcluindo(null)}
        />
      )}
    </div>
  );
}
