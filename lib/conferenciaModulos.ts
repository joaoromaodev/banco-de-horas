// Conferência entre módulos (Sprint 9, Frente A). Puro, sem I/O: cruza o cadastro do
// Departamento Pessoal, o ponto, os contratos de experiência e as férias programadas
// e aponta o que NÃO bate. Só alerta — nunca corrige nada; cada achado leva à tela
// onde se corrige. Ver docs/departamento-pessoal.md ("Conferência entre módulos").
//
// Cada fonte pode estar indisponível (`null`: tabela sem migração, erro de leitura):
// as regras que dependem dela são puladas e a fonte é listada em `indisponiveis` —
// o que dá para conferir com o resto é conferido.
import type { Marcador } from './tipos';
import { vencimento1, vencimento2, isoValida, type ContratoSalvo } from './contratos';
import { br, cpfValido, nomeChave, soDigitos, type Empregado } from './dp';
import { linkPonto } from './pontoUrl';
import { fimDoGozo, type FeriasProgramada } from './ferias';

export type CodigoConferencia =
  | 'ativo_sem_admissao'
  | 'ponto_sem_vinculo'
  | 'contrato_encerrado_com_ponto'
  | 'desligado_com_ponto'
  | 'ferias_marcador_sem_programacao'
  | 'ferias_com_ponto';

export type FonteConferencia = 'dp' | 'ponto' | 'contratos' | 'ferias';

export const ROTULO_FONTE: Record<FonteConferencia, string> = {
  dp: 'Departamento Pessoal', ponto: 'Folha de Ponto', contratos: 'Contratos de experiência', ferias: 'Férias do DP',
};

/** Um dia lançado no ponto. `trabalhado` = tem algum horário preenchido. */
export interface PontoDiaConf { data: string; marcador: Marcador | null; trabalhado: boolean }

export interface PontoFuncionarioConf {
  empresaId: string;
  /** Nome como está no Timesheet. */
  funcionario: string;
  /** Vínculo explícito com o DP (`ponto_funcionarios.empregado_id`), quando houver. */
  empregadoId?: string | null;
  dias: PontoDiaConf[];
}

export type ContratoConf = Pick<ContratoSalvo, 'id' | 'empresa' | 'situacao' | 'dados'>;

export interface FontesConferencia {
  /** `null` = indisponível. */
  empregados: Empregado[] | null;
  contratos: ContratoConf[] | null;
  ferias: FeriasProgramada[] | null;
  ponto: PontoFuncionarioConf[] | null;
}

export interface AchadoConferencia {
  /** Estável (para `key` da lista). */
  chave: string;
  codigo: CodigoConferencia;
  nivel: 'perigo' | 'aviso' | 'info';
  empresaId: string;
  empresaNome: string;
  empregado: string;
  empregadoId: string | null;
  titulo: string;
  texto: string;
  /** Onde corrigir. */
  href: string;
  rotuloLink: string;
}

export interface ResultadoConferencia {
  achados: AchadoConferencia[];
  /** Fontes que não puderam ser lidas — as regras que dependem delas ficaram de fora. */
  indisponiveis: FonteConferencia[];
}

export const TITULO_CODIGO: Record<CodigoConferencia, string> = {
  ativo_sem_admissao: 'Empregado ativo sem data de admissão',
  ponto_sem_vinculo: 'Ponto sem admissão nem contrato',
  contrato_encerrado_com_ponto: 'Ponto depois do fim do contrato',
  desligado_com_ponto: 'Ponto depois do desligamento',
  ferias_marcador_sem_programacao: 'FÉRIAS no ponto sem programação no DP',
  ferias_com_ponto: 'Férias programadas com ponto trabalhado',
};

const ORDEM_NIVEL = { perigo: 0, aviso: 1, info: 2 } as const;

/** Quantos meses para trás o ponto é conferido (o do mês corrente conta como 1). */
export const MESES_CONFERIDOS = 3;

/** (ano, mês) dos `n` últimos meses até `hoje`, do mais antigo ao mais novo. */
export function mesesDaJanela(hoje: string, n = MESES_CONFERIDOS): { ano: number; mes: number }[] {
  let ano = Number(hoje.slice(0, 4));
  let mes = Number(hoje.slice(5, 7));
  const r: { ano: number; mes: number }[] = [];
  for (let i = 0; i < n; i++) {
    r.unshift({ ano, mes });
    mes -= 1;
    if (mes < 1) { mes = 12; ano -= 1; }
  }
  return r;
}

/** Fim do contrato: a data do término (se válida) ou o vencimento da prorrogação/do 1º período. */
export function terminoDoContrato(d: ContratoConf['dados']): string | null {
  if (isoValida(d.termino) && d.termino) return d.termino;
  if (!isoValida(d.admissao) || !d.admissao || !(d.diasPeriodo > 0)) return null;
  return vencimento2(d) ?? vencimento1(d);
}

function intervalo(datas: string[]): string {
  const o = [...datas].sort();
  return o.length === 1 || o[0] === o[o.length - 1] ? br(o[0]) : `${br(o[0])} a ${br(o[o.length - 1])}`;
}

const dias = (n: number) => (n === 1 ? '1 dia' : `${n} dias`);

export function conferirModulos(
  fontes: FontesConferencia,
  empresas: ReadonlyMap<string, string>,
): ResultadoConferencia {
  const { empregados, contratos, ferias, ponto } = fontes;
  const indisponiveis: FonteConferencia[] = [];
  if (!empregados) indisponiveis.push('dp');
  if (!ponto) indisponiveis.push('ponto');
  if (!contratos) indisponiveis.push('contratos');
  if (!ferias) indisponiveis.push('ferias');

  const achados: AchadoConferencia[] = [];
  const nomeEmpresa = (id: string) => empresas.get(id) ?? '';
  const linkDp = (empresaId: string, empregadoId: string | null) =>
    empregadoId ? `/dp?empresa=${encodeURIComponent(empresaId)}&empregado=${encodeURIComponent(empregadoId)}` : linkPonto(empresaId);
  const add = (a: Omit<AchadoConferencia, 'chave' | 'empresaNome' | 'titulo'> & { sufixo?: string }) => {
    const { sufixo, ...resto } = a;
    achados.push({
      ...resto,
      chave: `${a.codigo}|${a.empresaId}|${a.empregadoId ?? a.empregado}${sufixo ? `|${sufixo}` : ''}`,
      empresaNome: nomeEmpresa(a.empresaId),
      titulo: TITULO_CODIGO[a.codigo],
    });
  };

  // ---- índices de pessoas ----
  const empPorId = new Map((empregados ?? []).map((e) => [e.id, e]));
  const empPorNome = new Map<string, Empregado[]>();
  for (const e of empregados ?? []) {
    const k = `${e.empresaId}|${nomeChave(e.nome)}`;
    empPorNome.set(k, [...(empPorNome.get(k) ?? []), e]);
  }
  /** Empregado do DP de uma linha do ponto: pelo vínculo; senão pelo nome (se único). */
  const empDoPonto = (p: PontoFuncionarioConf): Empregado | undefined => {
    if (p.empregadoId && empPorId.has(p.empregadoId)) return empPorId.get(p.empregadoId);
    const l = empPorNome.get(`${p.empresaId}|${nomeChave(p.funcionario)}`);
    return l && l.length === 1 ? l[0] : undefined;
  };
  const contratosDaPessoa = (empresaId: string, nome: string, cpf: string | null): ContratoConf[] =>
    (contratos ?? []).filter((c) => {
      if (c.empresa !== empresaId) return false;
      const cpfC = cpfValido(c.dados.cpf) ? soDigitos(c.dados.cpf) : null;
      if (cpf && cpfC) return cpf === cpfC;
      return nomeChave(c.dados.nome) === nomeChave(nome);
    });

  // 1) empregado ativo sem admissão
  const jaSemAdmissao = new Set<string>();
  for (const e of empregados ?? []) {
    if (e.situacao === 'ativo' && !e.admissao) {
      jaSemAdmissao.add(e.id);
      add({
        codigo: 'ativo_sem_admissao', nivel: 'aviso', empresaId: e.empresaId, empregado: e.nome, empregadoId: e.id,
        texto: 'Sem a admissão não dá para calcular férias nem 13º. Preencha a data na ficha.',
        href: linkDp(e.empresaId, e.id), rotuloLink: 'Abrir a ficha',
      });
    }
  }

  // 2) no ponto, sem admissão (DP) e sem contrato de experiência
  if (ponto && empregados && contratos) {
    for (const p of ponto) {
      if (!p.dias.length) continue;
      const e = empDoPonto(p);
      if (e?.admissao) continue;
      if (e && jaSemAdmissao.has(e.id)) continue; // já apontado em (1)
      if (contratosDaPessoa(p.empresaId, p.funcionario, e?.cpf ?? null).length) continue;
      add({
        codigo: 'ponto_sem_vinculo', nivel: 'aviso', empresaId: p.empresaId, empregado: p.funcionario, empregadoId: e?.id ?? null,
        texto: e
          ? 'Tem ponto lançado, mas o cadastro não traz a admissão e não há contrato de experiência. Informe a admissão na ficha.'
          : 'Tem ponto lançado, mas não está no Departamento Pessoal nem tem contrato de experiência. Cadastre o empregado com a admissão.',
        href: linkDp(p.empresaId, e?.id ?? null), rotuloLink: e ? 'Abrir a ficha' : 'Abrir a Folha de Ponto',
      });
    }
  }

  // 3) contrato encerrado, mas ponto trabalhado depois do término
  //    (efetivado segue trabalhando: não é divergência; o desligado vem em (6)).
  if (ponto && contratos) {
    for (const p of ponto) {
      const e = empDoPonto(p);
      const meus = contratosDaPessoa(p.empresaId, p.funcionario, e?.cpf ?? null);
      if (!meus.length) continue;
      // Recontratado ou efetivado depois: o contrato encerrado antigo não vale mais.
      if (meus.some((c) => c.situacao !== 'encerrado')) continue;
      const termino = meus.map((c) => terminoDoContrato(c.dados)).filter((t): t is string => Boolean(t)).sort().pop();
      if (!termino) continue;
      if (e?.admissao && e.admissao > termino) continue; // nova admissão depois do contrato
      const depois = p.dias.filter((d) => d.trabalhado && d.data > termino).map((d) => d.data);
      if (!depois.length) continue;
      add({
        codigo: 'contrato_encerrado_com_ponto', nivel: 'perigo', empresaId: p.empresaId, empregado: p.funcionario, empregadoId: e?.id ?? null,
        texto: `Contrato de experiência encerrado em ${br(termino)}, mas há ponto trabalhado em ${dias(depois.length)} depois disso (${intervalo(depois)}). Confira se o contrato foi efetivado ou o ponto está errado.`,
        href: '/contratos', rotuloLink: 'Abrir os contratos',
      });
    }
  }

  // 6) desligado, mas ponto trabalhado depois da data
  if (ponto && empregados) {
    for (const p of ponto) {
      const e = empDoPonto(p);
      if (!e || e.situacao !== 'desligado' || !e.situacaoDesde) continue;
      const depois = p.dias.filter((d) => d.trabalhado && d.data > e.situacaoDesde!).map((d) => d.data);
      if (!depois.length) continue;
      add({
        codigo: 'desligado_com_ponto', nivel: 'perigo', empresaId: p.empresaId, empregado: p.funcionario, empregadoId: e.id,
        texto: `Desligado em ${br(e.situacaoDesde)}, mas há ponto trabalhado em ${dias(depois.length)} depois disso (${intervalo(depois)}). Corrija a data do desligamento ou o ponto.`,
        href: linkDp(p.empresaId, e.id), rotuloLink: 'Abrir a ficha',
      });
    }
  }

  // 4) marcador FÉRIAS no ponto sem férias programadas, e 5) férias programadas com ponto trabalhado
  if (ponto && empregados && ferias) {
    const feriasPorEmp = new Map<string, FeriasProgramada[]>();
    for (const f of ferias) feriasPorEmp.set(f.empregadoId, [...(feriasPorEmp.get(f.empregadoId) ?? []), f]);

    for (const p of ponto) {
      const e = empDoPonto(p);
      if (!e) continue; // sem empregado no DP não há onde programar: cai em (2)
      const programadas = feriasPorEmp.get(e.id) ?? [];
      const cobre = (data: string) => programadas.some((f) => data >= f.inicio && data <= fimDoGozo(f));

      const soltas = p.dias.filter((d) => d.marcador === 'FÉRIAS' && !cobre(d.data)).map((d) => d.data);
      if (soltas.length) {
        add({
          codigo: 'ferias_marcador_sem_programacao', nivel: 'aviso', empresaId: p.empresaId, empregado: p.funcionario, empregadoId: e.id,
          texto: `FÉRIAS lançado em ${dias(soltas.length)} (${intervalo(soltas)}) sem férias programadas no DP para esses dias. Programe as férias na ficha ou corrija o ponto.`,
          href: linkDp(p.empresaId, e.id), rotuloLink: 'Programar férias',
        });
      }

      for (const f of programadas) {
        const fim = fimDoGozo(f);
        const trabalhados = p.dias.filter((d) => d.trabalhado && d.marcador !== 'FÉRIAS' && d.data >= f.inicio && d.data <= fim).map((d) => d.data);
        if (!trabalhados.length) continue;
        add({
          codigo: 'ferias_com_ponto', nivel: 'aviso', empresaId: p.empresaId, empregado: p.funcionario, empregadoId: e.id, sufixo: f.id,
          texto: `Férias programadas de ${br(f.inicio)} a ${br(fim)}, mas há ponto trabalhado em ${dias(trabalhados.length)} nesse período (${intervalo(trabalhados)}). Ajuste as férias ou o ponto.`,
          href: linkDp(p.empresaId, e.id), rotuloLink: 'Abrir a ficha',
        });
      }
    }
  }

  achados.sort((a, b) =>
    ORDEM_NIVEL[a.nivel] - ORDEM_NIVEL[b.nivel]
    || a.empresaNome.localeCompare(b.empresaNome, 'pt-BR')
    || a.empregado.localeCompare(b.empregado, 'pt-BR')
    || a.codigo.localeCompare(b.codigo));
  return { achados, indisponiveis };
}

/** Resumo de uma linha ("3 divergências em 2 empregados"). */
export function fraseConferencia(r: ResultadoConferencia): string {
  const n = r.achados.length;
  if (!n) return r.indisponiveis.length ? 'Nenhuma divergência nas fontes disponíveis' : 'Cadastro, ponto, contratos e férias batem entre si';
  const pessoas = new Set(r.achados.map((a) => `${a.empresaId}|${a.empregadoId ?? a.empregado}`)).size;
  return `${n} ${n === 1 ? 'divergência' : 'divergências'} em ${pessoas} ${pessoas === 1 ? 'empregado' : 'empregados'}`;
}
