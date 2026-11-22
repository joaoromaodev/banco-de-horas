// Cálculo do "Resumo para a folha" a partir das folhas salvas (só de servidor).
// Saiu de app/api/resumo-folha/route.ts para o fechamento do mês (Sprint 17,
// frente C) usar exatamente a mesma conta. Regras em lib/resumoFolha.ts.
import { lerFeriados, lerFrequenciasParaRevisao, lerFuncionarios } from './pontoDb';
import { lerJornadaEmpresa } from './cadastro';
import { listarEmpregados } from './dpServidor';
import { temBancoDeHoras } from './dp';
import { regrasDoEmpregado, resumirMes, type ResumoFolhaMes } from './resumoFolha';

/** Percentual vindo da tela: número entre 0 e 300, senão o padrão. */
export function pct(v: string | null | undefined): number | undefined {
  if (v === null || v === undefined || String(v).trim() === '') return undefined;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 300 ? n : undefined;
}

/**
 * Resumo do mês com os ajustes da tela (`banco` repetido, `extra`, `dom`, `noturno`).
 * `g` já passou por exigirEmpresaPonto: o escritório é o da empresa.
 */
export async function calcularResumo(g: { escritorioId: string; empresa: { id: string } }, ano: number, mes: number, p: URLSearchParams): Promise<ResumoFolhaMes> {
  const [freqs, feriadosArr, funcs, jornadaEmpresa, empregados] = await Promise.all([
    lerFrequenciasParaRevisao(g.escritorioId, g.empresa.id, ano, mes),
    lerFeriados(g.escritorioId),
    lerFuncionarios(g.escritorioId, g.empresa.id),
    lerJornadaEmpresa(g.empresa.id),
    // Cadastro do DP (0021): acordo de banco de horas. Sem a tabela, segue sem ele.
    listarEmpregados(g.escritorioId, [g.empresa.id]).catch(() => []),
  ]);
  const fimDoMes = `${ano}-${String(mes).padStart(2, '0')}-28`;
  const empregadoPorNome = new Map(empregados.map((e) => [e.nome, e]));
  const feriados = new Set(feriadosArr.map((f) => f.data));
  const porNome = new Map(funcs.map((f) => [f.nome, f]));
  const banco = new Set(p.getAll('banco'));
  const ordem = (nome: string) => { const i = funcs.findIndex((f) => f.nome === nome); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  const doMes = [...freqs.doMes].sort((a, b) => ordem(a.funcionario) - ordem(b.funcionario) || a.funcionario.localeCompare(b.funcionario));
  return resumirMes(doMes.map((f) => ({
    funcionario: f.funcionario,
    dias: f.dias,
    anteriores: freqs.anteriores.get(f.funcionario),
    regras: regrasDoEmpregado(porNome.get(f.funcionario), jornadaEmpresa, f.funcionario, banco,
      temBancoDeHoras(empregadoPorNome.get(f.funcionario), fimDoMes)),
  })), {
    ano, mes, feriados,
    percentuais: { extraUtil: pct(p.get('extra')), extraDomFeriado: pct(p.get('dom')), adicionalNoturno: pct(p.get('noturno')) },
  });
}
