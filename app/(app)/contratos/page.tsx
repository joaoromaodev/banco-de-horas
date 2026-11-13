'use client';

// Contratos de experiência — a contadora cadastra a admissão uma vez e tira os
// três documentos (contrato, declaração de vale-transporte e aviso de término)
// a partir dos modelos dela. Os contratos ficam salvos para lembrar dos
// vencimentos. Ver docs/contratos-experiencia.md.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  alertaDe, avisos, br, ContratoSalvo, DadosContrato, dadosVazios, Dia, DIAS, diasEntre, Documento,
  formatarValor, horarioPadrao, HorarioDia, hojeBelem, lerValor, minutosSemana, reaisExtenso,
  retornoSugerido, Situacao, Trajeto, validar, vencimento1, vencimento2,
} from '@/lib/contratos';
import { DialogoConfirmacao } from '../Dialogo';
import { IconeDesfazer, IconeExcluir } from '../icones';

interface Empresa { id: string; nome: string; trabalhaSabado: boolean; jornadaUtilMin?: number; jornadaSabadoMin?: number }
interface Funcionario { nome: string; cargo?: string | null }

const ROTULO_SITUACAO: Record<Situacao, string> = {
  experiencia: 'Em experiência', efetivado: 'Efetivado', encerrado: 'Encerrado',
};
const COR_SITUACAO: Record<Situacao, string> = {
  experiencia: 'bg-amber-50 text-amber-800', efetivado: 'bg-emerald-50 text-emerald-700', encerrado: 'bg-slate-100 text-slate-600',
};
const NOME_DIA: Record<Dia, string> = { SEG: 'Segunda', TER: 'Terça', QUA: 'Quarta', QUI: 'Quinta', SEX: 'Sexta', SAB: 'Sábado' };
const ESTADOS_CIVIS = ['Solteiro(a)', 'Casado(a)', 'Divorciado(a)', 'Viúvo(a)', 'União estável'];

const inp = 'w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-petroleo-500 focus:ring-2 focus:ring-petroleo-100';

function Campo({ rotulo, children, className = '' }: { rotulo: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{rotulo}</span>
      {children}
    </label>
  );
}

function Secao({ titulo, children, extra }: { titulo: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-800">{titulo}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

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
    if (reiniciar) novo(empresasRef.current.find((e) => e.id === id), lista);
  }

  // `empresas` vista de dentro de callbacks assíncronos
  const empresasRef = useRef<Empresa[]>([]);
  // endereço/cidade da sede vindos do cadastro fiscal da empresa
  const empregadoraRef = useRef<{ endereco: string; cidade: string } | null>(null);

  function trocarEmpresa(id: string, lista = empresasRef.current) {
    setEmpresaSel(id);
    setDesfazer(null); setErro(null); setMsg(null);
    if (!id) return;
    try { localStorage.setItem('contratos.empresa', id); } catch {}
    novo(lista.find((e) => e.id === id), []);
    fetch(`/api/funcionarios?empresa=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : null)).then((x) => setFuncionarios(x?.funcionarios ?? [])).catch(() => setFuncionarios([]));
    carregar(id, true).catch((e) => setErro(e.message));
  }

  useEffect(() => {
    fetch('/api/empresas').then((r) => (r.ok ? r.json() : null)).then((x) => {
      const lista: Empresa[] = x?.empresas ?? [];
      empresasRef.current = lista;
      setEmpresas(lista);
      let salva = '';
      try { salva = localStorage.getItem('contratos.empresa') ?? ''; } catch {}
      trocarEmpresa(lista.some((e) => e.id === salva) ? salva : lista[0]?.id || '', lista);
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
        body: JSON.stringify({ empresa: empresaSel, documento: doc, dados: d }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro ?? 'Falha ao gerar.');
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = nomeDoArquivo(r.headers.get('Content-Disposition'), doc === 'todos' ? 'documentos.zip' : `${doc}.docx`);
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

  const alertas = useMemo(() => contratos
    .map((c) => ({ c, a: alertaDe(c.dados, c.situacao, hoje) }))
    .filter((x): x is { c: ContratoSalvo; a: NonNullable<ReturnType<typeof alertaDe>> } => x.a != null)
    .sort((x, y) => x.a.dias - y.a.dias), [contratos, hoje]);

  const filtrados = contratos.filter((c) => !busca.trim() || c.dados.nome.toLowerCase().includes(busca.trim().toLowerCase()));

  return (
    <div className="text-sm">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Contrato de Experiência</h1>
          <p className="text-xs text-slate-500">Contrato, declaração de vale-transporte e aviso de término a partir de um cadastro só</p>
        </div>
        <select value={empresaSel} onChange={(e) => trocarEmpresa(e.target.value)} className="rounded-lg border border-slate-300 px-2 py-1">
          {empresas.length === 0 && <option value="">— nenhuma empresa —</option>}
          {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
      </header>

      <div className="space-y-4 p-6">
        {semTabela && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            O banco ainda não tem a tabela de contratos (migração <code>0009</code> pendente). Os documentos já podem ser
            gerados normalmente; salvar e os alertas de vencimento ficam disponíveis depois da migração.
          </p>
        )}
        {erro && <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{erro}</p>}
        {msg && <p className="rounded-lg bg-green-50 px-3 py-2 text-green-700">{msg}</p>}

        {desfazer && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
            <span>Contrato excluído — {desfazer.dados.nome}.</span>
            <button onClick={desfazerExclusao}
              className="inline-flex items-center gap-1.5 rounded-lg border border-petroleo-300 bg-white px-2.5 py-1 font-medium text-petroleo-700 hover:border-petroleo-500">
              <IconeDesfazer size={15} /> Desfazer
            </button>
          </div>
        )}

        {alertas.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            <div className="mb-1 font-medium">Vencimentos de experiência</div>
            <ul className="space-y-0.5">
              {alertas.map(({ c, a }) => (
                <li key={c.id}>
                  <button onClick={() => abrir(c)} className="text-left underline-offset-2 hover:underline">
                    <strong>{c.dados.nome}</strong> — {a.marco} {a.tipo === 'vencido'
                      ? <span className="font-semibold text-red-700">venceu em {br(a.data)}: marque como efetivado ou encerrado</span>
                      : <>vence em {br(a.data)} ({a.dias === 0 ? 'hoje' : a.dias === 1 ? 'amanhã' : `em ${a.dias} dias`})</>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          {/* ---------------------------------------------------- lista */}
          <aside className="space-y-2">
            <button onClick={() => { novo(); setMsg(null); setErro(null); }}
              className="w-full rounded-lg bg-petroleo-900 px-3 py-2 font-medium text-white hover:bg-petroleo-800">
              + Novo contrato
            </button>
            {contratos.length > 5 && (
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pelo nome…" className={inp} />
            )}
            <div className="space-y-1.5">
              {filtrados.length === 0 && (
                <p className="rounded-lg border border-dashed border-slate-300 px-3 py-4 text-center text-xs text-slate-500">
                  {semTabela ? 'Salvar ainda indisponível.' : 'Nenhum contrato salvo para esta empresa.'}
                </p>
              )}
              {filtrados.map((c) => (
                <div key={c.id}
                  className={`group rounded-lg border bg-white px-3 py-2 ${editandoId === c.id ? 'border-petroleo-600 ring-2 ring-petroleo-100' : 'border-slate-200 hover:border-petroleo-300'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <button onClick={() => abrir(c)} className="min-w-0 flex-1 text-left">
                      <div className="truncate font-medium text-slate-800">{c.dados.nome}</div>
                      <div className="text-xs text-slate-500">
                        {c.dados.funcao || '—'} · adm. {br(c.dados.admissao)}
                      </div>
                      <div className="text-xs text-slate-500">
                        vence {br(vencimento1(c.dados))}{vencimento2(c.dados) ? ` · prorr. ${br(vencimento2(c.dados)!)}` : ''}
                      </div>
                    </button>
                    <button onClick={() => setExcluindo(c)} title="Excluir contrato" aria-label="Excluir contrato"
                      className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
                      <IconeExcluir size={15} />
                    </button>
                  </div>
                  <select value={c.situacao} onChange={(e) => mudarSituacao(c, e.target.value as Situacao)}
                    className={`mt-1.5 rounded px-1.5 py-0.5 text-xs ${COR_SITUACAO[c.situacao]}`}>
                    {(Object.keys(ROTULO_SITUACAO) as Situacao[]).map((s) => <option key={s} value={s}>{ROTULO_SITUACAO[s]}</option>)}
                  </select>
                </div>
              ))}
            </div>
          </aside>

          {/* ---------------------------------------------------- formulário */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-slate-600">
                {editandoId ? <>Editando <strong>{d.nome || 'contrato'}</strong></> : 'Novo contrato'}
                {sujo && <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">alterações não salvas</span>}
              </div>
            </div>

            <Secao titulo="Empregadora">
              <div className="grid gap-3 md:grid-cols-[2fr_3fr_1fr]">
                <Campo rotulo="Razão social"><input className={inp} value={d.empresaNome} onChange={(e) => mudar('empresaNome', e.target.value)} /></Campo>
                <Campo rotulo="Endereço da sede (vai no contrato)">
                  <input className={inp} value={d.empresaEndereco} placeholder="Rua Três de Maio, nº 253 – Bairro de São Brás – Belém/PA"
                    onChange={(e) => mudar('empresaEndereco', e.target.value)} />
                </Campo>
                <Campo rotulo="Cidade da assinatura"><input className={inp} value={d.cidade} onChange={(e) => mudar('cidade', e.target.value)} /></Campo>
              </div>
            </Secao>

            <Secao titulo="Empregado">
              <div className="grid gap-3 md:grid-cols-4">
                <Campo rotulo="Nome completo" className="md:col-span-2">
                  <input className={inp} list="lista-funcionarios" value={d.nome} onChange={(e) => escolherNome(e.target.value)} />
                  <datalist id="lista-funcionarios">
                    {funcionarios.map((f) => <option key={f.nome} value={f.nome} />)}
                  </datalist>
                </Campo>
                <Campo rotulo="Tratamento">
                  <select className={inp} value={d.sexo} onChange={(e) => mudar('sexo', e.target.value as 'M' | 'F')}>
                    <option value="M">Sr. (masculino)</option>
                    <option value="F">Sra. (feminino)</option>
                  </select>
                </Campo>
                <Campo rotulo="CPF"><input className={inp} value={d.cpf} onChange={(e) => mudar('cpf', e.target.value)} placeholder="000.000.000-00" /></Campo>
                <Campo rotulo="CTPS digital nº"><input className={inp} value={d.ctps} onChange={(e) => mudar('ctps', e.target.value)} /></Campo>
                <Campo rotulo="UF da CTPS"><input className={inp} maxLength={2} value={d.ctpsUf} onChange={(e) => mudar('ctpsUf', e.target.value.toUpperCase())} /></Campo>
                <Campo rotulo="Estado civil">
                  <input className={inp} list="lista-estado-civil" value={d.estadoCivil} onChange={(e) => mudar('estadoCivil', e.target.value)} />
                  <datalist id="lista-estado-civil">{ESTADOS_CIVIS.map((x) => <option key={x} value={x} />)}</datalist>
                </Campo>
                <Campo rotulo="Nacionalidade">
                  <input className={inp} value={d.nacionalidade} placeholder={d.sexo === 'F' ? 'Brasileira' : 'Brasileiro'}
                    onChange={(e) => mudar('nacionalidade', e.target.value)} />
                </Campo>
              </div>
            </Secao>

            <Secao titulo="Contrato">
              <div className="grid gap-3 md:grid-cols-4">
                <Campo rotulo="Função" className="md:col-span-2"><input className={inp} value={d.funcao} onChange={(e) => mudar('funcao', e.target.value)} /></Campo>
                <Campo rotulo="Salário (R$)">
                  <input className={inp} inputMode="decimal" value={d.salario} onChange={(e) => mudar('salario', e.target.value)} onBlur={sairDoSalario} placeholder="1.518,00" />
                </Campo>
                <Campo rotulo="Profissão (declaração de VT)">
                  <input className={inp} value={d.profissao} placeholder={d.funcao || 'igual à função'} onChange={(e) => mudar('profissao', e.target.value)} />
                </Campo>
                <Campo rotulo="Salário por extenso" className="md:col-span-4">
                  <input className={inp} value={d.salarioExtenso} onChange={(e) => mudar('salarioExtenso', e.target.value)} />
                </Campo>
                <Campo rotulo="Admissão (= assinatura)"><input type="date" className={inp} value={d.admissao} onChange={(e) => mudar('admissao', e.target.value)} /></Campo>
                <Campo rotulo="1º período (dias)">
                  <input type="number" min={1} max={90} className={inp} value={d.diasPeriodo} onChange={(e) => mudar('diasPeriodo', Number(e.target.value))} />
                </Campo>
                <Campo rotulo="Prorrogação (dias, 0 = sem)">
                  <input type="number" min={0} max={89} className={inp} value={d.diasProrrogacao} onChange={(e) => mudar('diasProrrogacao', Number(e.target.value))} />
                </Campo>
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <div>Vence em <strong className="text-slate-800">{br(v1) || '—'}</strong></div>
                  <div>Prorrogado até <strong className="text-slate-800">{v2 ? br(v2) : '—'}</strong></div>
                  <div>Total {d.diasPeriodo + d.diasProrrogacao} de 90 dias</div>
                </div>
              </div>
            </Secao>

            <Secao titulo="Horário de trabalho"
              extra={<button onClick={copiarSegunda} className="text-xs text-petroleo-700 hover:underline">Copiar segunda para os dias úteis</button>}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-slate-500">
                    <tr><th className="pb-1 text-left font-medium">Dia</th><th className="pb-1 text-left font-medium">Folga</th>
                      <th className="pb-1 text-left font-medium">Entrada</th><th className="pb-1 text-left font-medium">Saída</th>
                      <th className="pb-1 text-left font-medium">Intervalo</th></tr>
                  </thead>
                  <tbody>
                    {DIAS.map((dia) => {
                      const h = d.horario[dia];
                      return (
                        <tr key={dia} className="border-t border-slate-100">
                          <td className="py-1 pr-3 text-slate-700">{NOME_DIA[dia]}</td>
                          <td className="py-1 pr-3"><input type="checkbox" checked={h.folga} onChange={(e) => mudarDia(dia, 'folga', e.target.checked)} /></td>
                          <td className="py-1 pr-2"><input type="time" disabled={h.folga} className={`${inp} w-28`} value={h.entrada} onChange={(e) => mudarDia(dia, 'entrada', e.target.value)} /></td>
                          <td className="py-1 pr-2"><input type="time" disabled={h.folga} className={`${inp} w-28`} value={h.saida} onChange={(e) => mudarDia(dia, 'saida', e.target.value)} /></td>
                          <td className="py-1">
                            <div className="flex items-center gap-1">
                              <input type="time" disabled={h.folga} className={`${inp} w-28`} value={h.intervaloInicio} onChange={(e) => mudarDia(dia, 'intervaloInicio', e.target.value)} />
                              <span className="text-slate-400">–</span>
                              <input type="time" disabled={h.folga} className={`${inp} w-28`} value={h.intervaloFim} onChange={(e) => mudarDia(dia, 'intervaloFim', e.target.value)} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <label className="flex items-center gap-1">Repouso semanal
                  <input className={`${inp} w-20 py-1`} value={d.repouso} onChange={(e) => mudar('repouso', e.target.value.toUpperCase())} />
                </label>
                {sem != null && <span>Total semanal: <strong className="text-slate-700">{Math.floor(sem / 60)}h{sem % 60 ? String(sem % 60).padStart(2, '0') : ''}</strong></span>}
              </div>
            </Secao>

            <Secao titulo="Vale-transporte">
              <div className="mb-3 flex flex-wrap gap-4">
                {([['nao', 'Não recebe'], ['sim', 'Recebe vale-transporte'], ['', 'Deixar em branco (marca à mão)']] as const).map(([v, r]) => (
                  <label key={v} className="flex items-center gap-1.5">
                    <input type="radio" name="vt" checked={d.vt === v} onChange={() => mudar('vt', v)} /> {r}
                  </label>
                ))}
              </div>
              <div className="grid gap-3 md:grid-cols-6">
                <Campo rotulo="Endereço residencial" className="md:col-span-3"><input className={inp} value={d.endRua} onChange={(e) => mudar('endRua', e.target.value)} /></Campo>
                <Campo rotulo="Nº"><input className={inp} value={d.endNum} onChange={(e) => mudar('endNum', e.target.value)} /></Campo>
                <Campo rotulo="Bairro" className="md:col-span-2"><input className={inp} value={d.endBairro} onChange={(e) => mudar('endBairro', e.target.value)} /></Campo>
                <Campo rotulo="Cidade" className="md:col-span-3"><input className={inp} value={d.endCidade} onChange={(e) => mudar('endCidade', e.target.value)} /></Campo>
                <Campo rotulo="CEP" className="md:col-span-2"><input className={inp} value={d.endCep} onChange={(e) => mudar('endCep', e.target.value)} /></Campo>
                <Campo rotulo="UF"><input className={inp} maxLength={2} value={d.endUf} onChange={(e) => mudar('endUf', e.target.value.toUpperCase())} /></Campo>
              </div>
              {d.vt === 'sim' && (
                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  {(['ida', 'volta'] as const).map((qual) => (
                    <div key={qual}>
                      <div className="mb-1 text-xs font-medium text-slate-600">{qual === 'ida' ? 'Residência → trabalho' : 'Trabalho → residência'}</div>
                      {d[qual].map((t, i) => (
                        <div key={i} className="mb-1 grid grid-cols-[1fr_1.4fr_0.8fr] gap-1">
                          <input className={inp} placeholder="Linha" value={t.linha} onChange={(e) => mudarTrajeto(qual, i, 'linha', e.target.value)} />
                          <input className={inp} placeholder="Empresa operadora" value={t.operadora} onChange={(e) => mudarTrajeto(qual, i, 'operadora', e.target.value)} />
                          <input className={inp} placeholder="Tarifa" value={t.tarifa} onChange={(e) => mudarTrajeto(qual, i, 'tarifa', e.target.value)} />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </Secao>

            <Secao titulo="Aviso de término (quando não for efetivar)">
              <div className="grid gap-3 md:grid-cols-3">
                <Campo rotulo="Término do contrato">
                  <input type="date" className={inp} value={d.termino} onChange={(e) => mudar('termino', e.target.value)} />
                  <div className="mt-1 flex flex-wrap gap-2 text-xs">
                    <button onClick={() => mudar('termino', v1)} className="text-petroleo-700 hover:underline">fim do 1º período</button>
                    {v2 && <button onClick={() => mudar('termino', v2)} className="text-petroleo-700 hover:underline">fim da prorrogação</button>}
                  </div>
                </Campo>
                <Campo rotulo="Retorno para receber a rescisão">
                  <input type="date" className={inp} value={d.retorno} onChange={(e) => mudar('retorno', e.target.value)} />
                  <div className="mt-1 text-xs text-slate-500">Até 10 dias após o término (CLT art. 477 §6).</div>
                </Campo>
                <Campo rotulo="Data do aviso"><input type="date" className={inp} value={d.dataAviso} onChange={(e) => mudar('dataAviso', e.target.value)} /></Campo>
              </div>
            </Secao>

            {listaAvisos.length > 0 && (
              <ul className="list-disc space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 py-2 pl-7 pr-3 text-amber-900">
                {listaAvisos.map((a) => <li key={a}>{a}</li>)}
              </ul>
            )}

            {/* ---------------------------------------------------- ações */}
            <div className="sticky bottom-0 -mx-6 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white/95 px-6 py-3 backdrop-blur">
              <button onClick={salvar} disabled={!!ocupado || semTabela}
                title={semTabela ? 'Aguardando a migração 0009 no banco' : undefined}
                className="rounded-lg bg-petroleo-900 px-4 py-2 font-medium text-white hover:bg-petroleo-800 disabled:opacity-50">
                {ocupado === 'salvar' ? 'Salvando…' : editandoId ? 'Salvar alterações' : 'Salvar contrato'}
              </button>
              <span className="mx-1 h-6 w-px bg-slate-200" />
              {([['contrato', 'Contrato'], ['vale', 'Declaração de VT'], ['encerramento', 'Aviso de término']] as const).map(([doc, r]) => (
                <button key={doc} onClick={() => baixar(doc)} disabled={!!ocupado}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700 hover:border-petroleo-500 disabled:opacity-50">
                  {ocupado === doc ? 'Gerando…' : `⬇ ${r}`}
                </button>
              ))}
              <button onClick={() => baixar('todos')} disabled={!!ocupado}
                className="rounded-lg border border-petroleo-300 bg-petroleo-50 px-3 py-2 font-medium text-petroleo-700 hover:border-petroleo-500 disabled:opacity-50">
                {ocupado === 'todos' ? 'Gerando…' : '⬇ Admissão completa (.zip)'}
              </button>
            </div>
          </div>
        </div>
      </div>

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
