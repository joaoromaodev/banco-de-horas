// Importação da Folha de Ponto do Google Sheets para o Postgres (migração 0012).
//
// Regra PURA: recebe as linhas das abas e as empresas do banco e devolve o que
// gravar e o que ficou de fora (com o motivo). Quem lê a planilha e grava é o
// script `scripts/importar-ponto.mjs`. Este arquivo é carregado direto pelo Node
// (type stripping), por isso não importa nada em tempo de execução — só tipos.

/** Valores legados da coluna `empresa` (antes do multiempresa). Ver lib/cadastro.ts. */
export const EMPRESA_LEGADA_ID = 'empresa-vaz-e-vouzela';
export const EMPRESA_LEGADA_NOME = 'VAZ E VOUZELA';

const MARCADORES = ['FERIADO', 'BANCO DE HORAS', 'ATESTADO', 'FOLGA', 'FALTA', 'FÉRIAS'];
const HORA = /^\d{2}:\d{2}$/;
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

export interface EmpresaDb { id: string; nome: string; escritorio_id: string | null }

export interface FuncionarioLinha {
  escritorio_id: string;
  empresa_id: string;
  nome: string;
  cargo: string | null;
  jornada_util_min: number | null;
  jornada_sabado_min: number | null;
  ordem: number | null;
}

export interface FrequenciaLinha {
  escritorio_id: string;
  empresa_id: string;
  funcionario: string;
  ano: number;
  mes: number;
  dia: number;
  entrada_manha: string | null;
  saida_almoco: string | null;
  retorno_almoco: string | null;
  saida_tarde: string | null;
  marcador: string | null;
  atualizado_em: string;
}

export interface FeriadoLinha { escritorio_id: string; data: string; descricao: string }

export interface PlanoImportacao {
  funcionarios: FuncionarioLinha[];
  frequencias: FrequenciaLinha[];
  feriados: FeriadoLinha[];
  /** Linhas da planilha que NÃO entram, agrupadas por motivo. */
  ignorados: Record<string, number>;
  /** Entram, mas merecem um olhar (horário fora do padrão, vínculo legado...). */
  avisos: string[];
  /** Frequências que vieram do vínculo legado (empresa antiga → empresa atual). */
  frequenciasLegadas: number;
}

type Celula = string | number | null | undefined;
type Linha = Celula[];

const txt = (v: Celula) => String(v ?? '').trim();
const inteiro = (v: Celula): number | null => {
  const s = txt(v);
  if (!/^-?\d+$/.test(s)) return null;
  return Number(s);
};
const minutos = (v: Celula): number | null => {
  const n = inteiro(v);
  return n !== null && n >= 0 && n <= 1440 ? n : null;
};
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  .replace(/[^A-Z0-9]+/g, ' ').trim();

/** Linha da planilha sem cabeçalho: se a primeira célula for o nome da coluna, pula. */
function corpo(linhas: Linha[] | undefined, primeiraColuna: string): Linha[] {
  const l = linhas ?? [];
  return l.length && txt(l[0]?.[0]) === primeiraColuna ? l.slice(1) : l;
}

/**
 * Resolve o valor da coluna `empresa` para uma empresa do escritório de destino:
 *  - id atual ou razão social exata → essa empresa;
 *  - vazio, o id legado ou o nome legado → a empresa "Vaz & Vouzela" do destino
 *    (única cujo nome normalizado contém VAZ e VOUZELA), marcada como legada.
 * Empresa que não existe mais, ou que é de outro escritório, não resolve.
 */
export function resolverEmpresa(valor: Celula, empresasDestino: EmpresaDb[]): { id: string; legada: boolean } | null {
  const v = txt(valor);
  const porId = empresasDestino.find((e) => e.id === v);
  if (porId) return { id: porId.id, legada: false };
  const porNome = v ? empresasDestino.find((e) => e.nome.trim() === v) : undefined;
  if (porNome) return { id: porNome.id, legada: false };
  if (!v || v === EMPRESA_LEGADA_ID || v === EMPRESA_LEGADA_NOME) {
    const vaz = empresasDestino.filter((e) => {
      const n = normalizar(e.nome);
      return n.includes('VAZ') && n.includes('VOUZELA');
    });
    return vaz.length === 1 ? { id: vaz[0].id, legada: true } : null;
  }
  return null;
}

function contar(m: Record<string, number>, motivo: string) {
  m[motivo] = (m[motivo] ?? 0) + 1;
}

/**
 * Monta o plano de importação para UM escritório (o da Edilse, na prática).
 *
 * - Funcionários: só os vinculados a uma empresa ATUAL do escritório. As linhas
 *   com vínculo legado ou de empresa apagada já não aparecem no app hoje (são
 *   cópias antigas, algumas com erro de digitação) e ficam de fora.
 * - Frequências: as de empresa atual entram; as do vínculo legado são
 *   RECUPERADAS para a Vaz & Vouzela (o app as perdeu de vista quando a empresa
 *   ganhou id novo), desde que não colidam com um dia já lançado.
 * - Feriados: todos com data AAAA-MM-DD válida.
 */
export function planejarImportacao(opts: {
  escritorioId: string;
  empresas: EmpresaDb[];
  funcionarios?: Linha[];
  frequencias?: Linha[];
  feriados?: Linha[];
}): PlanoImportacao {
  const destino = opts.empresas.filter((e) => e.escritorio_id === opts.escritorioId);
  const ignorados: Record<string, number> = {};
  const avisos: string[] = [];

  // ---- Funcionários: nome, cargo, jornadaUtilMin, jornadaSabadoMin, ordem, empresa
  const funcionarios = new Map<string, FuncionarioLinha>();
  for (const r of corpo(opts.funcionarios, 'nome')) {
    const nome = txt(r[0]);
    if (!nome) { contar(ignorados, 'funcionário sem nome'); continue; }
    const emp = resolverEmpresa(r[5], destino);
    if (!emp) { contar(ignorados, 'funcionário de empresa que não existe mais (ou de outro escritório)'); continue; }
    if (emp.legada) { contar(ignorados, 'funcionário com vínculo legado (cópia antiga, não aparece no app)'); continue; }
    const chave = `${emp.id}|${nome}`;
    if (funcionarios.has(chave)) { contar(ignorados, 'funcionário repetido na mesma empresa'); continue; }
    funcionarios.set(chave, {
      escritorio_id: opts.escritorioId,
      empresa_id: emp.id,
      nome,
      cargo: txt(r[1]) || null,
      jornada_util_min: minutos(r[2]),
      jornada_sabado_min: minutos(r[3]),
      ordem: inteiro(r[4]),
    });
  }

  // ---- Frequências: funcionario, ano, mes, dia, 4 horários, marcador, atualizadoEm, empresa
  const frequencias = new Map<string, FrequenciaLinha & { legada: boolean }>();
  for (const r of corpo(opts.frequencias, 'funcionario')) {
    const funcionario = txt(r[0]);
    const ano = inteiro(r[1]);
    const mes = inteiro(r[2]);
    const dia = inteiro(r[3]);
    if (!funcionario || ano === null || mes === null || dia === null
      || ano < 2000 || ano > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) {
      contar(ignorados, 'frequência com funcionário, ano, mês ou dia inválido');
      continue;
    }
    const emp = resolverEmpresa(r[10], destino);
    if (!emp) { contar(ignorados, 'frequência de empresa que não existe mais (ou de outro escritório)'); continue; }

    const horas = [txt(r[4]), txt(r[5]), txt(r[6]), txt(r[7])].map((h) => h || null);
    let marcador: string | null = txt(r[8]).toUpperCase() || null;
    if (marcador && !MARCADORES.includes(marcador)) {
      avisos.push(`Marcador desconhecido "${marcador}" descartado (${funcionario}, ${dia}/${mes}/${ano}).`);
      marcador = null;
    }
    if (!horas.some(Boolean) && !marcador) { contar(ignorados, 'frequência sem horário nem marcador'); continue; }
    for (const h of horas) {
      if (h && !HORA.test(h)) avisos.push(`Horário fora do padrão "${h}" mantido como está (${funcionario}, ${dia}/${mes}/${ano}) — conferir na tela.`);
    }

    const linha = {
      escritorio_id: opts.escritorioId,
      empresa_id: emp.id,
      funcionario,
      ano, mes, dia,
      entrada_manha: horas[0],
      saida_almoco: horas[1],
      retorno_almoco: horas[2],
      saida_tarde: horas[3],
      marcador,
      atualizado_em: txt(r[9]) && !Number.isNaN(Date.parse(txt(r[9]))) ? new Date(txt(r[9])).toISOString() : new Date(0).toISOString(),
      legada: emp.legada,
    };
    const chave = `${emp.id}|${funcionario}|${ano}|${mes}|${dia}`;
    const atual = frequencias.get(chave);
    if (atual) {
      // Colisão: o lançamento do vínculo atual vence o legado; entre iguais, o mais recente.
      const fica = atual.legada !== linha.legada
        ? (atual.legada ? linha : atual)
        : (linha.atualizado_em > atual.atualizado_em ? linha : atual);
      frequencias.set(chave, fica);
      contar(ignorados, 'frequência repetida (mesmo funcionário e dia)');
      continue;
    }
    frequencias.set(chave, linha);
  }

  // ---- Feriados: data, descricao
  const feriados = new Map<string, FeriadoLinha>();
  for (const r of corpo(opts.feriados, 'data')) {
    const data = txt(r[0]);
    if (!DATA_ISO.test(data) || Number.isNaN(Date.parse(`${data}T00:00:00Z`))) {
      contar(ignorados, 'feriado com data inválida');
      continue;
    }
    if (feriados.has(data)) { contar(ignorados, 'feriado repetido'); continue; }
    feriados.set(data, { escritorio_id: opts.escritorioId, data, descricao: txt(r[1]) });
  }

  const listaFreq = [...frequencias.values()];
  const frequenciasLegadas = listaFreq.filter((f) => f.legada).length;
  if (frequenciasLegadas) {
    avisos.push(`${frequenciasLegadas} frequência(s) do vínculo legado ("${EMPRESA_LEGADA_ID}") recuperadas para a Vaz & Vouzela.`);
  }

  return {
    funcionarios: [...funcionarios.values()],
    frequencias: listaFreq.map(({ legada: _legada, ...f }) => f), // eslint-disable-line @typescript-eslint/no-unused-vars
    feriados: [...feriados.values()],
    ignorados,
    avisos,
    frequenciasLegadas,
  };
}
