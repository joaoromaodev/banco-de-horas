// Contrato de experiência — parte de servidor: preencher os modelos .docx e
// persistir no Postgres (tabela `contratos_experiencia`, migração 0009).
import { readFile } from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { emLotes, getDb, lerTudo } from './db';
import {
  camposDoDocumento, ContratoSalvo, DadosContrato, Documento, normalizarDados, Situacao,
} from './contratos';

export class ErroContrato extends Error {
  constructor(msg: string, readonly status = 400) {
    super(msg);
  }
}

// ------------------------------------------------------------------ .docx

const PASTA_MODELOS = path.join(process.cwd(), 'modelos', 'contrato-experiencia');
const PARTES = /^word\/(document|header\d*|footer\d*)\.xml$/;

const escaparXml = (s: string) =>
  s.replace(/[\r\n\t]+/g, ' ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Preenche um modelo. Os placeholders foram gravados inteiros dentro de um
 * único <w:t> por `modelos/contrato-experiencia/preparar_modelos.py` — se
 * alguém editar o .docx no Word e ele quebrar um {{X}} em vários trechos, o
 * placeholder sai literal no documento (e a verificação abaixo acusa).
 */
export async function gerarDocx(doc: Documento, dados: DadosContrato): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await readFile(path.join(PASTA_MODELOS, `${doc}.docx`)));
  const valores = camposDoDocumento(doc, dados);
  for (const nome of Object.keys(zip.files).filter((n) => PARTES.test(n))) {
    const xml = await zip.file(nome)!.async('string');
    const cheio = xml.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, k: string) => escaparXml(valores[k] ?? ''));
    if (cheio.includes('{{')) throw new ErroContrato(`Modelo "${doc}" tem placeholder quebrado — rode preparar_modelos.py de novo.`, 500);
    zip.file(nome, cheio);
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ------------------------------------------------------------------ banco

const TABELA = 'contratos_experiencia';

interface Linha {
  id: string; empresa_id: string; situacao: Situacao; dados: Partial<DadosContrato>;
  criado_por: string; criado_em: string; atualizado_em: string | null;
}

const deLinha = (l: Linha): ContratoSalvo => ({
  id: l.id, empresa: l.empresa_id, situacao: l.situacao, criadoPor: l.criado_por,
  criadoEm: l.criado_em, atualizadoEm: l.atualizado_em, dados: normalizarDados(l.dados ?? {}),
});

/** Erro do PostgREST quando a migração 0009 ainda não foi aplicada. */
function traduzir(e: { code?: string; message?: string } | null): never {
  if (e?.code === '42P01' || e?.code === 'PGRST205' || /contratos_experiencia/.test(e?.message ?? '')) {
    throw new ErroContrato('A tabela de contratos ainda não existe no banco — aplique a migração 0009 (supabase db push).', 503);
  }
  throw new ErroContrato(e?.message ?? 'Falha no banco.', 502);
}

/** Colunas indexáveis derivadas do formulário (o resto vai em `dados`). */
const colunas = (d: DadosContrato) => ({
  nome: d.nome.trim(),
  cpf: d.cpf.trim() || null,
  admissao: d.admissao,
  dias_periodo: d.diasPeriodo,
  dias_prorrogacao: d.diasProrrogacao,
  dados: d,
});

export async function listarContratos(empresa: string): Promise<ContratoSalvo[]> {
  const db = getDb();
  const data = await lerTudo<Linha>((de, ate) => db.from(TABELA)
    .select('id, empresa_id, situacao, dados, criado_por, criado_em, atualizado_em')
    .eq('empresa_id', empresa).is('excluido_em', null)
    .order('admissao', { ascending: false }).order('criado_em', { ascending: false }).order('id').range(de, ate), { falhar: traduzir });
  return data.map(deLinha);
}

export async function empresaDoContrato(id: string): Promise<string | null> {
  const { data, error } = await getDb().from(TABELA).select('empresa_id').eq('id', id).maybeSingle();
  if (error) traduzir(error);
  return (data as { empresa_id: string } | null)?.empresa_id ?? null;
}

export async function criarContrato(empresa: string, d: DadosContrato, por: string): Promise<ContratoSalvo> {
  const { data, error } = await getDb().from(TABELA)
    .insert({ empresa_id: empresa, ...colunas(d), criado_por: por })
    .select('id, empresa_id, situacao, dados, criado_por, criado_em, atualizado_em').single();
  if (error) traduzir(error);
  return deLinha(data as Linha);
}

export async function atualizarContrato(
  id: string, mudancas: { dados?: DadosContrato; situacao?: Situacao }, por: string,
): Promise<ContratoSalvo> {
  const patch: Record<string, unknown> = { atualizado_por: por, atualizado_em: new Date().toISOString() };
  if (mudancas.dados) Object.assign(patch, colunas(mudancas.dados));
  if (mudancas.situacao) patch.situacao = mudancas.situacao;
  const { data, error } = await getDb().from(TABELA).update(patch).eq('id', id)
    .select('id, empresa_id, situacao, dados, criado_por, criado_em, atualizado_em').single();
  if (error) traduzir(error);
  return deLinha(data as Linha);
}

/** Exclusão lógica; `restaurar` desfaz. */
export async function excluirContrato(id: string, restaurar = false): Promise<void> {
  const { error } = await getDb().from(TABELA)
    .update({ excluido_em: restaurar ? null : new Date().toISOString() }).eq('id', id);
  if (error) traduzir(error);
}

/** Todos os contratos (qualquer situação) de várias empresas, para a conferência entre módulos. */
export async function listarContratosDeEmpresas(empresas: string[]): Promise<ContratoSalvo[]> {
  if (!empresas.length) return [];
  const db = getDb();
  const data = await emLotes(empresas, (lote) => lerTudo<Linha>((de, ate) => db.from(TABELA)
    .select('id, empresa_id, situacao, dados, criado_por, criado_em, atualizado_em')
    .in('empresa_id', lote).is('excluido_em', null).order('id').range(de, ate), { falhar: traduzir }));
  return data.map(deLinha);
}

/**
 * Contratos em experiência de várias empresas de uma vez (faixa de alertas do
 * topo). O chamador passa só as empresas que a sessão pode ver.
 */
export async function listarEmExperiencia(empresas: string[]): Promise<ContratoSalvo[]> {
  if (!empresas.length) return [];
  const db = getDb();
  const data = await emLotes(empresas, (lote) => lerTudo<Linha>((de, ate) => db.from(TABELA)
    .select('id, empresa_id, situacao, dados, criado_por, criado_em, atualizado_em')
    .in('empresa_id', lote).eq('situacao', 'experiencia').is('excluido_em', null).order('id').range(de, ate), { falhar: traduzir }));
  return data.map(deLinha);
}
