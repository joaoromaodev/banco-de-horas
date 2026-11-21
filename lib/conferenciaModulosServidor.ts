// Conferência entre módulos — leituras (só leitura; nada é gravado). As regras estão em
// lib/conferenciaModulos.ts. Cada fonte é lida isolada: se falhar, vira `null`
// (indisponível) e as outras seguem. O chamador passa só as empresas que a sessão vê.
import { emLotes, getDb, lerTudo } from './db';
import { listarContratosDeEmpresas } from './contratosServidor';
import { listarEmpregados, listarFerias } from './dpServidor';
import {
  conferirModulos, mesesDaJanela, type PontoFuncionarioConf, type ResultadoConferencia,
} from './conferenciaModulos';
import { MARCADORES, type Marcador } from './tipos';

/* eslint-disable @typescript-eslint/no-explicit-any */
const HORARIOS = ['entrada_manha', 'saida_almoco', 'retorno_almoco', 'saida_tarde'] as const;
const dataIso = (ano: number, mes: number, dia: number) =>
  `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

/** Dias lançados no ponto nos últimos meses, por funcionário. */
export async function lerPontoParaConferencia(
  escritorioId: string | null, empresas: string[], hoje: string,
): Promise<PontoFuncionarioConf[]> {
  const janela = mesesDaJanela(hoje);
  // Números inteiros vindos do cálculo acima: seguro montar o filtro.
  const filtro = janela.map((m) => `and(ano.eq.${m.ano},mes.eq.${m.mes})`).join(',');
  const db = getDb();
  const ler = (colunas: string) => emLotes(empresas, (lote) => lerTudo<any>((de, ate) => {
    let q = db.from('ponto_frequencias').select(colunas).in('empresa_id', lote).or(filtro);
    if (escritorioId) q = q.eq('escritorio_id', escritorioId);
    return q.order('id').range(de, ate);
  }));
  const base = 'id, empresa_id, funcionario, ano, mes, dia, entrada_manha, saida_almoco, retorno_almoco, saida_tarde, marcador';
  let linhas: any[];
  try {
    linhas = await ler(`${base}, empregado_id`);
  } catch (e) {
    // Sem a 0021 a coluna `empregado_id` não existe: segue só com o nome.
    if (/empregado_id/.test((e as Error)?.message ?? '') || (e as { code?: string })?.code === '42703') linhas = await ler(base);
    else throw e;
  }
  const mapa = new Map<string, PontoFuncionarioConf>();
  for (const r of linhas) {
    const chave = `${r.empresa_id}|${r.funcionario}`;
    if (!mapa.has(chave)) {
      mapa.set(chave, { empresaId: String(r.empresa_id), funcionario: String(r.funcionario), empregadoId: r.empregado_id ?? null, dias: [] });
    }
    const p = mapa.get(chave)!;
    if (!p.empregadoId && r.empregado_id) p.empregadoId = r.empregado_id;
    const marcador = (MARCADORES as string[]).includes(String(r.marcador ?? '')) ? (r.marcador as Marcador) : null;
    p.dias.push({
      data: dataIso(Number(r.ano), Number(r.mes), Number(r.dia)),
      marcador,
      trabalhado: HORARIOS.some((h) => String(r[h] ?? '').trim() !== ''),
    });
  }
  return [...mapa.values()];
}

async function isolada<T>(rotulo: string, f: () => Promise<T>): Promise<T | null> {
  try {
    return await f();
  } catch (e) {
    // Sem detalhe do banco (pode citar valores): só o rótulo e o código.
    console.error(`[conferencia] ${rotulo}:`, (e as { code?: string })?.code ?? '', e instanceof Error ? e.message.slice(0, 100) : '');
    return null;
  }
}

/**
 * Confere as empresas dadas. `escritorioId` null = plataforma (master). Sem
 * empresas: resultado vazio, sem consultar nada.
 */
export async function conferirEmpresas(
  escritorioId: string | null, empresas: Map<string, string>, hoje: string,
): Promise<ResultadoConferencia> {
  const ids = [...empresas.keys()];
  if (!ids.length) return { achados: [], indisponiveis: [] };
  const [empregados, ferias, contratos, ponto] = await Promise.all([
    isolada('dp', () => listarEmpregados(escritorioId, ids)),
    isolada('ferias', () => listarFerias(escritorioId, { empresas: ids })),
    isolada('contratos', async () => (await listarContratosDeEmpresas(ids))),
    isolada('ponto', () => lerPontoParaConferencia(escritorioId, ids, hoje)),
  ]);
  return conferirModulos({ empregados, ferias, contratos, ponto }, empresas);
}
