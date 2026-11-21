// Departamento Pessoal — parte de servidor: persistência no Postgres (migração 0021).
// Só de servidor (secret key, ignora RLS). A autorização é de quem chama (rotas em
// app/api/dp, com lib/pontoAcesso.ts): aqui toda leitura e escrita é recortada pelo
// escritório informado, junto com a empresa (defesa em profundidade, como no ponto).
//
// Dado pessoal (CPF, salário): só sai daqui para as rotas da contabilidade. Nunca
// para log (os erros vão sem o corpo), e-mail ou IA.
import { emLotes, getDb, lerTudo } from './db';
import type { DadosContrato } from './contratos';
import {
  lerDinheiro, nomeChave, soDigitos, cpfValido, type DadosEmpregado, type Empregado,
} from './dp';
import type { FeriasProgramada } from './ferias';

export class ErroDp extends Error {
  constructor(msg: string, readonly status = 400) {
    super(msg);
  }
}

export const MENSAGEM_DP_PENDENTE = 'O Departamento Pessoal está aguardando a atualização do banco de dados (migração 0021).';

interface ErroPg { code?: string; message?: string }

/** Tabela ou coluna da 0021 ainda não existe. */
export function ehDpPendente(e: ErroPg | null | undefined): boolean {
  if (!e) return false;
  if (e.code === '42P01' || e.code === 'PGRST205' || e.code === '42703' || e.code === 'PGRST204') return true;
  return /dp_empregados|dp_ferias|empregado_id/.test(e.message ?? '');
}

function falhar(e: ErroPg): never {
  if (ehDpPendente(e)) throw new ErroDp(MENSAGEM_DP_PENDENTE, 503);
  if (e.code === '23505') throw new ErroDp('Já existe um empregado com este nome nesta empresa.', 409);
  // Sem o detalhe do banco na resposta (pode citar valores); vai só para o log, sem dados.
  console.error('[dp] banco:', e.code ?? '', (e.message ?? '').slice(0, 120));
  throw new ErroDp('Falha ao acessar o banco.', 502);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const deLinha = (r: any): Empregado => ({
  id: String(r.id),
  escritorioId: String(r.escritorio_id),
  empresaId: String(r.empresa_id),
  nome: String(r.nome ?? ''),
  cpf: r.cpf ?? null,
  cargo: r.cargo ?? null,
  admissao: r.admissao ?? null,
  salarioBase: r.salario_base == null ? null : Number(r.salario_base),
  horasSemanais: r.horas_semanais == null ? null : Number(r.horas_semanais),
  escala: r.escala ?? null,
  dsr: Number(r.dsr ?? 0),
  bancoHoras: Boolean(r.banco_horas),
  bancoHorasDesde: r.banco_horas_desde ?? null,
  situacao: r.situacao ?? 'ativo',
  situacaoDesde: r.situacao_desde ?? null,
  afastamentoTipo: r.afastamento_tipo ?? null,
  aquisitivoBase: r.aquisitivo_base ?? null,
  origem: r.origem ?? 'manual',
  atualizadoEm: r.atualizado_em ?? null,
  atualizadoPor: r.atualizado_por ?? null,
});

const paraLinha = (d: DadosEmpregado) => ({
  nome: d.nome,
  cpf: d.cpf,
  cargo: d.cargo,
  admissao: d.admissao,
  salario_base: d.salarioBase,
  horas_semanais: d.horasSemanais,
  escala: d.escala,
  dsr: d.dsr,
  banco_horas: d.bancoHoras,
  banco_horas_desde: d.bancoHorasDesde,
  situacao: d.situacao,
  situacao_desde: d.situacaoDesde,
  afastamento_tipo: d.afastamentoTipo,
  aquisitivo_base: d.aquisitivoBase,
});

const deFerias = (r: any): FeriasProgramada => ({
  id: String(r.id),
  empregadoId: String(r.empregado_id),
  empresaId: String(r.empresa_id),
  aquisitivoInicio: String(r.aquisitivo_inicio),
  inicio: String(r.inicio),
  dias: Number(r.dias),
  abonoDias: Number(r.abono_dias ?? 0),
  avisoEm: r.aviso_em ?? null,
  pagamentoEm: r.pagamento_em ?? null,
  observacao: r.observacao ?? null,
});

// ------------------------------------------------------------------ empregados

/** Empregados do escritório (por empresa, se informada). `null` = plataforma (master). */
export async function listarEmpregados(escritorioId: string | null, empresas?: string[]): Promise<Empregado[]> {
  const db = getDb();
  const ler = (lote?: string[]) => lerTudo<any>((de, ate) => {
    let q = db.from('dp_empregados').select('*');
    if (escritorioId) q = q.eq('escritorio_id', escritorioId);
    if (lote) q = q.in('empresa_id', lote);
    return q.order('nome').order('id').range(de, ate);
  }, { falhar });
  const linhas = empresas ? await emLotes(empresas, ler) : await ler();
  return linhas.map(deLinha);
}

export async function lerEmpregado(id: string): Promise<Empregado | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await getDb().from('dp_empregados').select('*').eq('id', id).maybeSingle();
  if (error) falhar(error);
  return data ? deLinha(data) : null;
}

export async function criarEmpregado(escritorioId: string, empresaId: string, d: DadosEmpregado, por: string, origem: Empregado['origem'] = 'manual'): Promise<Empregado> {
  const { data, error } = await getDb().from('dp_empregados')
    .insert({ escritorio_id: escritorioId, empresa_id: empresaId, ...paraLinha(d), origem, atualizado_por: por })
    .select('*').single();
  if (error) falhar(error);
  return deLinha(data);
}

export async function atualizarEmpregado(escritorioId: string, id: string, d: DadosEmpregado, por: string): Promise<Empregado> {
  const { data, error } = await getDb().from('dp_empregados')
    .update({ ...paraLinha(d), atualizado_por: por, atualizado_em: new Date().toISOString() })
    .eq('id', id).eq('escritorio_id', escritorioId).select('*').single();
  if (error) falhar(error);
  return deLinha(data);
}

const VAZIO_DADOS: DadosEmpregado = {
  nome: '', cpf: null, cargo: null, admissao: null, salarioBase: null, horasSemanais: null, escala: null, dsr: 0,
  bancoHoras: false, bancoHorasDesde: null, situacao: 'ativo', situacaoDesde: null, afastamentoTipo: null, aquisitivoBase: null,
};

const COLUNA_LOTE: Record<string, string> = {
  admissao: 'admissao', cargo: 'cargo', salarioBase: 'salario_base', horasSemanais: 'horas_semanais', escala: 'escala',
  bancoHoras: 'banco_horas', bancoHorasDesde: 'banco_horas_desde',
};

/**
 * Grava só as colunas pedidas (edição em lote e desfazer): uma edição simultânea em
 * outro campo do mesmo empregado não é pisada. `valores` usa os nomes de `DadosEmpregado`.
 */
export async function atualizarCamposEmpregado(
  escritorioId: string, empresaId: string, id: string, valores: Partial<DadosEmpregado>, por: string,
): Promise<void> {
  const linha = paraLinha({ ...VAZIO_DADOS, ...valores }) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(valores)) if (COLUNA_LOTE[k]) patch[COLUNA_LOTE[k]] = linha[COLUNA_LOTE[k]];
  if (!Object.keys(patch).length) return;
  const { error } = await getDb().from('dp_empregados')
    .update({ ...patch, atualizado_por: por, atualizado_em: new Date().toISOString() })
    .eq('id', id).eq('escritorio_id', escritorioId).eq('empresa_id', empresaId);
  if (error) falhar(error);
}

// ------------------------------------------------------------------ férias

export async function listarFerias(escritorioId: string | null, filtro: { empresas?: string[]; empregadoId?: string }): Promise<FeriasProgramada[]> {
  const db = getDb();
  const ler = (lote?: string[]) => lerTudo<any>((de, ate) => {
    let q = db.from('dp_ferias').select('*').is('excluido_em', null);
    if (escritorioId) q = q.eq('escritorio_id', escritorioId);
    if (lote) q = q.in('empresa_id', lote);
    if (filtro.empregadoId) q = q.eq('empregado_id', filtro.empregadoId);
    return q.order('inicio').order('id').range(de, ate);
  }, { falhar });
  const linhas = filtro.empresas ? await emLotes(filtro.empresas, ler) : await ler();
  return linhas.map(deFerias);
}

/** Dono da programação (para conferir o acesso antes de excluir, restaurar ou gerar documento). */
export async function lerFerias(id: string): Promise<(FeriasProgramada & { escritorioId: string; excluida: boolean }) | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await getDb().from('dp_ferias').select('*').eq('id', id).maybeSingle();
  if (error) falhar(error);
  return data ? { ...deFerias(data), escritorioId: String(data.escritorio_id), excluida: Boolean(data.excluido_em) } : null;
}

export async function criarFerias(escritorioId: string, f: Omit<FeriasProgramada, 'id'>, por: string): Promise<FeriasProgramada> {
  const { data, error } = await getDb().from('dp_ferias').insert({
    escritorio_id: escritorioId,
    empresa_id: f.empresaId,
    empregado_id: f.empregadoId,
    aquisitivo_inicio: f.aquisitivoInicio,
    inicio: f.inicio,
    dias: f.dias,
    abono_dias: f.abonoDias,
    aviso_em: f.avisoEm,
    pagamento_em: f.pagamentoEm,
    observacao: f.observacao ?? null,
    criado_por: por,
  }).select('*').single();
  if (error) falhar(error);
  return deFerias(data);
}

/** Exclusão lógica; `restaurar` desfaz. */
export async function excluirFerias(escritorioId: string, id: string, por: string, restaurar = false): Promise<void> {
  const { error } = await getDb().from('dp_ferias')
    .update({ excluido_em: restaurar ? null : new Date().toISOString(), atualizado_por: por, atualizado_em: new Date().toISOString() })
    .eq('id', id).eq('escritorio_id', escritorioId);
  if (error) falhar(error);
}

// ------------------------------------------------------------------ ponto: faltas e cobertura

/**
 * Faltas (marcador FALTA) por empregado, das empresas dadas. Liga pelo `empregado_id`;
 * linha antiga sem ele cai no nome (mesmo vínculo do Timesheet).
 */
export async function lerFaltas(escritorioId: string | null, empregados: Pick<Empregado, 'id' | 'empresaId' | 'nome'>[]): Promise<Map<string, string[]>> {
  const r = new Map<string, string[]>(empregados.map((e) => [e.id, []]));
  if (!empregados.length) return r;
  const empresas = [...new Set(empregados.map((e) => e.empresaId))];
  const porNome = new Map(empregados.map((e) => [`${e.empresaId}|${e.nome}`, e.id]));
  const db = getDb();
  const linhas = await emLotes(empresas, (lote) => lerTudo<any>((de, ate) => {
    let q = db.from('ponto_frequencias').select('id, empresa_id, funcionario, empregado_id, ano, mes, dia')
      .in('empresa_id', lote).eq('marcador', 'FALTA');
    if (escritorioId) q = q.eq('escritorio_id', escritorioId);
    return q.order('id').range(de, ate);
  }, { falhar }));
  for (const l of linhas) {
    const id = l.empregado_id ?? porNome.get(`${l.empresa_id}|${l.funcionario}`);
    if (!id || !r.has(id)) continue;
    r.get(id)!.push(`${l.ano}-${String(l.mes).padStart(2, '0')}-${String(l.dia).padStart(2, '0')}`);
  }
  return r;
}

/** Meses (AAAA-MM) com algum dia lançado no ponto para o empregado, desde `desde`. */
export async function mesesComPonto(escritorioId: string, e: Pick<Empregado, 'id' | 'empresaId' | 'nome'>, desdeAno: number): Promise<string[]> {
  const db = getDb();
  // Duas consultas com `.eq()` (pelo id e, nas linhas antigas sem id, pelo nome) — sem
  // montar filtro `.or()` com texto digitado.
  const base = () => db.from('ponto_frequencias').select('id, ano, mes')
    .eq('escritorio_id', escritorioId).eq('empresa_id', e.empresaId).gte('ano', desdeAno);
  const [porId, porNome] = await Promise.all([
    lerTudo<any>((de, ate) => base().eq('empregado_id', e.id).order('id').range(de, ate), { falhar, max: 20_000 }),
    lerTudo<any>((de, ate) => base().is('empregado_id', null).eq('funcionario', e.nome).order('id').range(de, ate), { falhar, max: 20_000 }),
  ]);
  return [...new Set([...porId, ...porNome].map((l) => `${l.ano}-${String(l.mes).padStart(2, '0')}`))].sort();
}

/** Cadastro do ponto ligado (para a jornada diária e o nome usado no Timesheet). */
export async function funcionarioDoPonto(escritorioId: string, e: Pick<Empregado, 'id' | 'empresaId' | 'nome'>) {
  const consulta = () => getDb().from('ponto_funcionarios')
    .select('nome, cargo, jornada_util_min, jornada_sabado_min')
    .eq('escritorio_id', escritorioId).eq('empresa_id', e.empresaId);
  let { data, error } = await consulta().eq('empregado_id', e.id).limit(1);
  if (error) falhar(error);
  if (!data?.length) ({ data, error } = await consulta().eq('nome', e.nome).limit(1));
  if (error) falhar(error);
  const r = data?.[0];
  return r ? { nome: String(r.nome), cargo: r.cargo ?? null, jornadaUtilMin: r.jornada_util_min ?? undefined, jornadaSabadoMin: r.jornada_sabado_min ?? undefined } : null;
}

// ------------------------------------------------------------------ para a frente B (resumo para a folha)

/**
 * Empregados de uma empresa indexados pelo nome usado no ponto (`ponto_frequencias.funcionario`).
 * Sem a 0021 aplicada devolve um mapa vazio (a frente B segue com a jornada da empresa e
 * "sem banco de horas"). Use com `jornadaDoEmpregado` e `temBancoDeHoras` de lib/dp.ts.
 */
export async function lerEmpregadosParaFolha(escritorioId: string, empresaId: string): Promise<Map<string, Empregado>> {
  try {
    const db = getDb();
    const [emps, funcs] = await Promise.all([
      listarEmpregados(escritorioId, [empresaId]),
      db.from('ponto_funcionarios').select('nome, empregado_id').eq('escritorio_id', escritorioId).eq('empresa_id', empresaId),
    ]);
    if (funcs.error) falhar(funcs.error);
    const porId = new Map(emps.map((e) => [e.id, e]));
    const r = new Map<string, Empregado>(emps.map((e) => [e.nome, e]));
    for (const f of (funcs.data ?? []) as { nome: string; empregado_id: string | null }[]) {
      const e = f.empregado_id ? porId.get(f.empregado_id) : undefined;
      if (e) r.set(f.nome, e);
    }
    return r;
  } catch (e) {
    if (e instanceof ErroDp && e.status === 503) return new Map();
    throw e;
  }
}

// ------------------------------------------------------------------ contrato de experiência → empregado

/**
 * O contrato cria ou liga o empregado: procura pelo CPF, depois pelo nome (sem
 * diferenciar caixa/espaços); sem achar, cria. Só PREENCHE o que está vazio no
 * cadastro (admissão, cargo, salário, CPF) — nunca sobrescreve o que a contadora
 * editou no DP. Falha sem derrubar o contrato (sem a 0021, simplesmente não liga).
 */
export async function ligarEmpregadoDoContrato(
  escritorioId: string, empresaId: string, contratoId: string, d: DadosContrato, por: string,
): Promise<string | null> {
  try {
    const db = getDb();
    const nome = d.nome.replace(/\s+/g, ' ').trim();
    if (!nome) return null;
    const cpf = cpfValido(d.cpf) ? soDigitos(d.cpf) : null;
    const todos = await listarEmpregados(escritorioId, [empresaId]);
    const porCpf = cpf ? todos.find((e) => e.cpf === cpf) : undefined;
    const homonimos = todos.filter((e) => nomeChave(e.nome) === nomeChave(nome));
    // Pelo nome só quando é um só e o CPF não contradiz (homônimo com outro CPF é outra pessoa).
    const porNome = homonimos.length === 1 && !(cpf && homonimos[0].cpf && homonimos[0].cpf !== cpf) ? homonimos[0] : undefined;
    // Homônimo ambíguo ou de outro CPF: não liga nem cria (o nome é único por empresa) — fica para a tela.
    if (!porCpf && !porNome && homonimos.length) return null;
    const achado = porCpf ?? porNome ?? null;
    const salario = lerDinheiro(d.salario);
    const sal = salario !== null && !Number.isNaN(salario) ? salario : null;
    let id: string;
    if (achado) {
      id = achado.id;
      const patch: Record<string, unknown> = {};
      if (!achado.admissao && d.admissao) patch.admissao = d.admissao;
      if (!achado.cargo && d.funcao.trim()) patch.cargo = d.funcao.trim();
      if (achado.salarioBase == null && sal !== null) patch.salario_base = sal;
      if (!achado.cpf && cpf && !todos.some((e) => e.cpf === cpf)) patch.cpf = cpf;
      if (Object.keys(patch).length) {
        const { error } = await db.from('dp_empregados').update({ ...patch, atualizado_por: por, atualizado_em: new Date().toISOString() })
          .eq('id', id).eq('escritorio_id', escritorioId);
        if (error) falhar(error);
      }
    } else {
      // O Timesheet usa nomes em maiúsculas; o empregado nasce com o nome como no ponto.
      const novo = await criarEmpregado(escritorioId, empresaId, {
        nome: nome.toUpperCase(), cpf, cargo: d.funcao.trim() || null, admissao: d.admissao || null, salarioBase: sal,
        horasSemanais: null, escala: null, dsr: 0, bancoHoras: false, bancoHorasDesde: null,
        situacao: 'ativo', situacaoDesde: null, afastamentoTipo: null, aquisitivoBase: null,
      }, por, 'contrato');
      id = novo.id;
    }
    const { error } = await db.from('contratos_experiencia').update({ empregado_id: id }).eq('id', contratoId).eq('empresa_id', empresaId);
    if (error) falhar(error);
    return id;
  } catch (e) {
    if (!(e instanceof ErroDp && e.status === 503)) console.error('[dp] ligar contrato:', e instanceof Error ? e.message : 'falha');
    return null;
  }
}

// ------------------------------------------------------------------ agenda / cron

/** Tudo o que a agenda precisa do DP para as empresas dadas (sem a 0021: vazio). */
export async function dadosDpParaAgenda(escritorioId: string | null, empresas: string[]): Promise<{
  empregados: Empregado[]; ferias: FeriasProgramada[]; faltas: Map<string, string[]>;
} | null> {
  if (!empresas.length) return { empregados: [], ferias: [], faltas: new Map() };
  try {
    const [empregados, ferias] = await Promise.all([
      listarEmpregados(escritorioId, empresas),
      listarFerias(escritorioId, { empresas }),
    ]);
    const ativos = empregados.filter((e) => e.situacao !== 'desligado');
    const faltas = await lerFaltas(escritorioId, ativos);
    return { empregados: ativos, ferias, faltas };
  } catch (e) {
    if (e instanceof ErroDp && e.status === 503) return null;
    throw e;
  }
}
