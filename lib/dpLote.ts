// Departamento Pessoal — edição em lote ("Completar cadastro" em grade e importação
// por planilha). Puro (sem I/O): roda no navegador (validação por célula) e no
// servidor (que refaz tudo antes de gravar — nunca confia no que o navegador diz).
//
// Regra de ouro: **só preenche e atualiza, nunca apaga**. Célula vazia = "não mexer".
// Um valor igual ao que já está no cadastro também não é mudança. Ver
// docs/departamento-pessoal.md ("Edição em lote").
import {
  ESCALAS, isoOk, lerDinheiro, nomeChave, validarEmpregado,
  type DadosEmpregado, type Empregado, type Escala,
} from './dp';

export const CAMPOS_LOTE = ['admissao', 'cargo', 'salarioBase', 'horasSemanais', 'escala', 'bancoHoras', 'bancoHorasDesde'] as const;
export type CampoLote = (typeof CAMPOS_LOTE)[number];

/** O que a contadora digitou, célula por célula (texto cru; vazio = não mexer). */
export type EntradaLote = Partial<Record<CampoLote, string>>;

export type ValorLote = string | number | boolean | null;
export interface MudancaLote { antes: ValorLote; depois: ValorLote }

export const ROTULO_CAMPO: Record<CampoLote, string> = {
  admissao: 'Admissão',
  cargo: 'Cargo',
  salarioBase: 'Salário base',
  horasSemanais: 'Horas por semana',
  escala: 'Escala',
  bancoHoras: 'Banco de horas',
  bancoHorasDesde: 'Banco desde',
};

/** Limite de linhas por gravação (a rota recusa mais que isso). */
export const MAX_LINHAS_LOTE = 300;

/** Campos do empregado que o lote enxerga (o resto do cadastro não é tocado). */
export type EmpregadoDoLote = Pick<Empregado, 'id' | 'nome' | 'situacao'> & DadosEmpregado;

// ------------------------------------------------------------------ células

type Lida = { vazio: true } | { vazio: false; ok: true; valor: ValorLote } | { vazio: false; ok: false; erro: string };

const vazio = (t: unknown) => String(t ?? '').trim() === '';

/** "10/03/2025" ou "2025-03-10" → "2025-03-10"; senão null. */
export function lerDataLote(v: unknown): string | null {
  const t = String(v ?? '').trim();
  let iso: string | null = null;
  const br = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const colado = t.match(/^(\d{2})(\d{2})(\d{4})$/); // 01062026: quem digita sem as barras
  if (br) iso = `${br[3]}-${br[2].padStart(2, '0')}-${br[1].padStart(2, '0')}`;
  else if (colado) iso = `${colado[3]}-${colado[2]}-${colado[1]}`;
  else if (/^\d{4}-\d{2}-\d{2}/.test(t)) iso = t.slice(0, 10);
  return iso && isoOk(iso) && Number(iso.slice(0, 4)) >= 1950 ? iso : null;
}

function lerSimNao(v: unknown): boolean | null {
  const t = String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (['sim', 's', 'x', '1', 'true', 'verdadeiro', 'yes'].includes(t)) return true;
  if (['nao', 'n', '0', 'false', 'falso', 'no'].includes(t)) return false;
  return null;
}

function lerEscala(v: unknown): Escala | null {
  const t = String(v ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const achada = ESCALAS.find((e) => e.valor === t || e.rotulo.toLowerCase().replace(/\s+/g, '') === t);
  if (achada) return achada.valor;
  const inicio = ESCALAS.find((e) => e.valor !== 'outra' && t.startsWith(e.valor));
  return inicio ? inicio.valor : null;
}

/** Interpreta uma célula. Vazio → "não mexer"; inválido → mensagem para a célula. */
export function lerCelula(campo: CampoLote, texto: unknown): Lida {
  if (vazio(texto)) return { vazio: true };
  const t = String(texto).trim();
  const ok = (valor: ValorLote): Lida => ({ vazio: false, ok: true, valor });
  const erro = (m: string): Lida => ({ vazio: false, ok: false, erro: m });
  switch (campo) {
    case 'admissao':
    case 'bancoHorasDesde': {
      const d = lerDataLote(t);
      return d ? ok(d) : erro('Data inválida. Use dd/mm/aaaa.');
    }
    case 'cargo':
      return ok(t.replace(/\s+/g, ' ').slice(0, 80));
    case 'salarioBase': {
      const n = lerDinheiro(t);
      if (n === null || Number.isNaN(n) || n < 0 || n > 9_999_999) return erro('Salário inválido. Ex.: 1.518,00');
      return ok(n);
    }
    case 'horasSemanais': {
      const n = Number(t.replace(',', '.'));
      if (!Number.isFinite(n) || n <= 0 || n > 70) return erro('Horas por semana inválidas (1 a 70).');
      return ok(Math.round(n * 10) / 10);
    }
    case 'escala': {
      const e = lerEscala(t);
      return e ? ok(e) : erro('Escala inválida. Use 5x2, 6x1, 12x36 ou Outra.');
    }
    case 'bancoHoras': {
      const b = lerSimNao(t);
      return b === null ? erro('Responda Sim ou Não.') : ok(b);
    }
  }
}

// ------------------------------------------------------------------ plano de uma linha

export interface PlanoLinha {
  mudancas: Partial<Record<CampoLote, MudancaLote>>;
  /** Erro por célula (campo → mensagem). */
  erros: Partial<Record<CampoLote, string>>;
  /** Erro que não é de uma célula só (ex.: a nova admissão contradiz a situação). */
  erroLinha: string | null;
  avisos: string[];
  status: 'muda' | 'igual' | 'erro';
}

const igual = (a: ValorLote, b: ValorLote) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : a === b);

/**
 * O que a linha vai mudar no cadastro. Valida célula a célula e, no conjunto, com a
 * mesma regra da ficha (`validarEmpregado`) sobre o cadastro já com as mudanças.
 */
export function planejarLinha(atual: DadosEmpregado, entrada: EntradaLote, hoje?: string): PlanoLinha {
  const erros: PlanoLinha['erros'] = {};
  const avisos: string[] = [];
  const novos: Partial<Record<CampoLote, ValorLote>> = {};

  for (const campo of CAMPOS_LOTE) {
    const l = lerCelula(campo, entrada[campo]);
    if (l.vazio) continue;
    if (!l.ok) erros[campo] = l.erro;
    else novos[campo] = l.valor;
  }

  const bancoFinal = novos.bancoHoras !== undefined ? Boolean(novos.bancoHoras) : atual.bancoHoras;
  if (novos.bancoHorasDesde !== undefined && !bancoFinal && !erros.bancoHorasDesde) {
    erros.bancoHorasDesde = 'Só vale com banco de horas = Sim.';
  }

  let erroLinha: string | null = null;
  const mudancas: PlanoLinha['mudancas'] = {};
  if (!Object.keys(erros).length) {
    const candidato = { ...atual, ...novos } as Record<string, unknown>;
    const v = validarEmpregado(candidato);
    if (!v.ok) {
      erroLinha = v.erros.join(' ');
    } else {
      for (const campo of CAMPOS_LOTE) {
        if (novos[campo] === undefined) continue;
        const antes = atual[campo] as ValorLote;
        const depois = v.dados[campo] as ValorLote;
        if (!igual(antes, depois)) mudancas[campo] = { antes, depois };
      }
      const horas = v.dados.horasSemanais;
      if (novos.horasSemanais !== undefined && horas != null && horas > 44) avisos.push('Jornada acima de 44h semanais (CLT art. 58).');
      if (novos.admissao !== undefined && hoje && String(v.dados.admissao) > hoje) avisos.push('A admissão está no futuro.');
      if (novos.bancoHoras === true && !v.dados.bancoHorasDesde) avisos.push('Banco de horas sem data de início.');
    }
  }

  const status: PlanoLinha['status'] = Object.keys(erros).length || erroLinha ? 'erro' : Object.keys(mudancas).length ? 'muda' : 'igual';
  return { mudancas, erros, erroLinha, avisos, status };
}

/** Texto curto de um valor, para a prévia ("10/03/2025", "R$ 1.518,00", "Sim"). */
export function mostrarValor(campo: CampoLote, v: ValorLote): string {
  if (v === null || v === '') return '—';
  if (campo === 'admissao' || campo === 'bancoHorasDesde') return String(v).split('-').reverse().join('/');
  if (campo === 'salarioBase') return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (campo === 'horasSemanais') return `${String(v).replace('.', ',')} h`;
  if (campo === 'bancoHoras') return v ? 'Sim' : 'Não';
  return String(v);
}

/** Resumo: "3 empregados mudam, 1 sem mudança, 2 com erro". */
export function resumoPlanos(planos: { status: PlanoLinha['status'] }[]): { muda: number; igual: number; erro: number } {
  return {
    muda: planos.filter((p) => p.status === 'muda').length,
    igual: planos.filter((p) => p.status === 'igual').length,
    erro: planos.filter((p) => p.status === 'erro').length,
  };
}

// ------------------------------------------------------------------ planilha

/** Cabeçalhos do modelo, na ordem. A importação aceita variações (sem acento, maiúsculas). */
export const CABECALHOS_MODELO = ['Nome', 'Admissão', 'Cargo', 'Salário base', 'Horas semanais', 'Escala', 'Banco de horas', 'Banco de horas desde'] as const;

const ALIAS: Record<string, 'nome' | CampoLote> = {
  nome: 'nome', empregado: 'nome', funcionario: 'nome', colaborador: 'nome',
  admissao: 'admissao', 'data de admissao': 'admissao', 'data admissao': 'admissao',
  cargo: 'cargo', funcao: 'cargo',
  'salario base': 'salarioBase', salario: 'salarioBase',
  'horas semanais': 'horasSemanais', 'horas por semana': 'horasSemanais', 'horas/semana': 'horasSemanais', 'carga horaria semanal': 'horasSemanais',
  escala: 'escala',
  'banco de horas': 'bancoHoras', banco: 'bancoHoras',
  'banco de horas desde': 'bancoHorasDesde', 'banco desde': 'bancoHorasDesde', 'inicio do banco de horas': 'bancoHorasDesde',
};

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export interface LinhaPlanilha { linha: number; nome: string; entrada: EntradaLote }
export interface LeituraPlanilha { linhas: LinhaPlanilha[]; ignoradas: string[]; erro: string | null }

/**
 * Matriz de células (texto) → linhas do lote. A primeira linha que tem a coluna "Nome"
 * é o cabeçalho; colunas desconhecidas (CPF, por exemplo) são ignoradas e listadas —
 * nunca lidas. `linha` é o número da linha na planilha, para a mensagem de erro.
 */
export function lerPlanilha(matriz: string[][]): LeituraPlanilha {
  let cab = -1;
  let mapa: ('nome' | CampoLote | null)[] = [];
  for (let i = 0; i < Math.min(matriz.length, 15); i++) {
    const m = matriz[i].map((c) => ALIAS[norm(c)] ?? null);
    if (m.includes('nome')) { cab = i; mapa = m; break; }
  }
  if (cab < 0) return { linhas: [], ignoradas: [], erro: 'Não achei a coluna "Nome". Use o modelo para baixar.' };
  if (!mapa.some((c) => c && c !== 'nome')) return { linhas: [], ignoradas: [], erro: 'A planilha não tem nenhuma coluna para preencher (admissão, cargo, salário…). Use o modelo para baixar.' };
  const ignoradas = matriz[cab].map((c, i) => (mapa[i] === null && !vazio(c) ? String(c).trim() : '')).filter(Boolean);
  const linhas: LinhaPlanilha[] = [];
  for (let i = cab + 1; i < matriz.length; i++) {
    const cel = matriz[i];
    const nome = String(cel[mapa.indexOf('nome')] ?? '').replace(/\s+/g, ' ').trim();
    if (!nome) continue;
    const entrada: EntradaLote = {};
    mapa.forEach((c, j) => { if (c && c !== 'nome' && !vazio(cel[j])) entrada[c] = String(cel[j]).trim(); });
    linhas.push({ linha: i + 1, nome, entrada });
  }
  return { linhas, ignoradas, erro: null };
}

export interface LinhaPrevia {
  linha: number;
  nomePlanilha: string;
  empregadoId: string | null;
  nome: string | null;
  entrada: EntradaLote;
  plano: PlanoLinha | null;
  /** Por que não casou com ninguém (ou foi descartada). */
  problema: string | null;
}

/** Casa cada linha da planilha com um empregado da empresa (pelo nome) e planeja. */
export function previaPlanilha(linhas: LinhaPlanilha[], empregados: EmpregadoDoLote[], hoje?: string): LinhaPrevia[] {
  const porNome = new Map<string, EmpregadoDoLote[]>();
  for (const e of empregados) porNome.set(nomeChave(e.nome), [...(porNome.get(nomeChave(e.nome)) ?? []), e]);
  const vistos = new Map<string, number>();
  return linhas.map((l) => {
    const chave = nomeChave(l.nome);
    const base = { linha: l.linha, nomePlanilha: l.nome, entrada: l.entrada };
    const achados = porNome.get(chave) ?? [];
    if (vistos.has(chave)) {
      return { ...base, empregadoId: null, nome: null, plano: null, problema: `Nome repetido (já aparece na linha ${vistos.get(chave)}).` };
    }
    vistos.set(chave, l.linha);
    if (achados.length === 0) return { ...base, empregadoId: null, nome: null, plano: null, problema: 'Não há empregado com este nome na empresa (a importação não cadastra).' };
    if (achados.length > 1) return { ...base, empregadoId: null, nome: null, plano: null, problema: 'Há mais de um empregado com este nome. Complete pela grade.' };
    const e = achados[0];
    return { ...base, empregadoId: e.id, nome: e.nome, plano: planejarLinha(e, l.entrada, hoje), problema: null };
  });
}

// ------------------------------------------------------------------ desfazer

/** O que o servidor devolve ao gravar e o navegador devolve ao desfazer. */
export interface AplicadoLote {
  id: string;
  nome: string;
  campos: Partial<Record<CampoLote, MudancaLote>>;
}

/**
 * Desfazer só volta o campo que **ainda está como foi gravado** (`depois`): se alguém
 * editou de novo no meio-tempo, essa edição vale mais que o desfazer. Devolve o que
 * restaurar e o que ficou de fora.
 */
export function planejarDesfazer(
  atual: DadosEmpregado, campos: AplicadoLote['campos'],
): { restaurar: Partial<Record<CampoLote, ValorLote>>; ignorados: CampoLote[] } {
  const restaurar: Partial<Record<CampoLote, ValorLote>> = {};
  const ignorados: CampoLote[] = [];
  for (const campo of CAMPOS_LOTE) {
    const m = campos[campo];
    if (!m) continue;
    if (igual(atual[campo] as ValorLote, m.depois)) restaurar[campo] = m.antes;
    else ignorados.push(campo);
  }
  return { restaurar, ignorados };
}
