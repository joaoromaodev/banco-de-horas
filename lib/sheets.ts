// Persistência no Google Sheets. Abas: "Frequencias" (registro por dia),
// "Funcionarios", "Feriados" e "Config" (chave/valor).
import { randomUUID } from 'crypto';
import { google, sheets_v4 } from 'googleapis';
import { getContaServico, getSpreadsheetId } from './config';
import { Papel } from './auth';
import { Empresa, Frequencia, Funcionario } from './tipos';
import { Jornada, JORNADA_PADRAO } from './calendario';

// Empresa/ID atribuídos às linhas antigas (antes do multiempresa), para não perder dados.
export const EMPRESA_PADRAO = 'VAZ E VOUZELA';
export const EMPRESA_PADRAO_ID = 'empresa-vaz-e-vouzela';

/** Resolve o valor gravado na coluna `empresa` para um id de empresa.
 *  Aceita: id novo, razão social (deploy anterior) ou vazio (dados originais). */
function resolverEmpresaId(valor: unknown, empresas: Empresa[]): string {
  const v = String(valor ?? '').trim();
  if (!v) return EMPRESA_PADRAO_ID;
  if (empresas.some((e) => e.id === v)) return v;
  const porNome = empresas.find((e) => e.nome === v);
  return porNome ? porNome.id : v;
}

const ABA = 'Frequencias';
// `empresa` foi ADICIONADA no fim (coluna K) para não quebrar linhas antigas:
// linhas sem K assumem EMPRESA_PADRAO na leitura.
const HEADER = [
  'funcionario', 'ano', 'mes', 'dia',
  'entradaManha', 'saidaAlmoco', 'retornoAlmoco', 'saidaTarde',
  'marcador', 'atualizadoEm', 'empresa',
];

const ABA_FUNC = 'Funcionarios';
// `empresa` também no fim (coluna F) pela mesma razão.
const HEADER_FUNC = ['nome', 'cargo', 'jornadaUtilMin', 'jornadaSabadoMin', 'ordem', 'empresa'];
const ABA_EMP = 'Empresas';
// `id` no fim (coluna G) para não quebrar a aba criada no deploy anterior.
const HEADER_EMP = ['nome', 'cnpj', 'trabalhaSabado', 'jornadaUtilMin', 'jornadaSabadoMin', 'ordem', 'id'];
const ABA_FER = 'Feriados';
const HEADER_FER = ['data', 'descricao'];
const ABA_CFG = 'Config';
const HEADER_CFG = ['chave', 'valor'];
const ABA_USERS = 'Usuarios';
// `empresa` no fim (coluna F): linhas antigas continuam válidas (vínculo vazio,
// que só importa para o papel `cliente`).
const HEADER_USERS = ['email', 'nome', 'role', 'salt', 'hash', 'empresa'];

export interface Feriado {
  data: string; // AAAA-MM-DD
  descricao: string;
}

export interface UsuarioRec {
  email: string;
  nome: string;
  role: Papel;
  salt: string;
  hash: string;
  /** Id da empresa que o usuário enxerga. Só se aplica ao papel `cliente`. */
  empresa?: string | null;
}

export interface SheetsCtx {
  sheets: sheets_v4.Sheets;
  spreadsheetId: string;
}

/** Monta o cliente autenticado. Lança erro claro se faltar configuração. */
export function getSheets(): SheetsCtx {
  const conta = getContaServico();
  const spreadsheetId = getSpreadsheetId();
  if (!conta) throw new Error('Conta de serviço do Google não configurada (service-account.json ausente).');
  if (!spreadsheetId) throw new Error('ID da planilha (GOOGLE_SHEETS_ID) não configurado.');

  const auth = new google.auth.JWT({
    email: conta.client_email,
    key: conta.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return { sheets: google.sheets({ version: 'v4', auth }), spreadsheetId };
}

/** Garante que a aba exista com o cabeçalho correto. */
async function garantirAba(ctx: SheetsCtx): Promise<void> {
  const meta = await ctx.sheets.spreadsheets.get({ spreadsheetId: ctx.spreadsheetId });
  const existe = meta.data.sheets?.some((s) => s.properties?.title === ABA);
  if (!existe) {
    await ctx.sheets.spreadsheets.batchUpdate({
      spreadsheetId: ctx.spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: ABA } } }] },
    });
  }
  // Cabeçalho (idempotente)
  await ctx.sheets.spreadsheets.values.update({
    spreadsheetId: ctx.spreadsheetId,
    range: `${ABA}!A1:K1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADER] },
  });
}

/**
 * Grava a frequência do funcionário/mês (substitui os registros anteriores
 * desse mesmo funcionário+ano+mês). Retorna quantos dias foram gravados.
 */
export async function salvarFrequencia(freq: Frequencia): Promise<number> {
  const ctx = getSheets();
  await garantirAba(ctx);

  // Lê registros atuais
  const empresas = await lerEmpresas();
  const res = await ctx.sheets.spreadsheets.values.get({
    spreadsheetId: ctx.spreadsheetId,
    range: `${ABA}!A2:K`,
  });
  const atuais = res.data.values ?? [];

  // Remove linhas da mesma empresa+funcionário+ano+mês (empresa em K, resolvida por id)
  const mantidas = atuais.filter(
    (r) => !(resolverEmpresaId(r[10], empresas) === freq.empresa && r[0] === freq.funcionario && Number(r[1]) === freq.ano && Number(r[2]) === freq.mes),
  );

  // Novas linhas (só dias com algum dado ou marcador)
  const carimbo = new Date().toISOString();
  const novas = freq.dias
    .filter((d) => d.entradaManha || d.saidaAlmoco || d.retornoAlmoco || d.saidaTarde || d.marcador)
    .map((d) => [
      freq.funcionario, freq.ano, freq.mes, d.dia,
      d.entradaManha ?? '', d.saidaAlmoco ?? '', d.retornoAlmoco ?? '', d.saidaTarde ?? '',
      d.marcador ?? '', carimbo, freq.empresa,
    ]);

  const todas = [...mantidas, ...novas].sort((a, b) => {
    const ea = String(a[10] || EMPRESA_PADRAO).localeCompare(String(b[10] || EMPRESA_PADRAO));
    if (ea !== 0) return ea;
    const fa = String(a[0]).localeCompare(String(b[0]));
    if (fa !== 0) return fa;
    return (Number(a[1]) - Number(b[1])) || (Number(a[2]) - Number(b[2])) || (Number(a[3]) - Number(b[3]));
  });

  // Limpa e reescreve o corpo
  await ctx.sheets.spreadsheets.values.clear({ spreadsheetId: ctx.spreadsheetId, range: `${ABA}!A2:K` });
  if (todas.length) {
    await ctx.sheets.spreadsheets.values.update({
      spreadsheetId: ctx.spreadsheetId,
      range: `${ABA}!A2`,
      valueInputOption: 'RAW',
      requestBody: { values: todas },
    });
  }
  return novas.length;
}

/** Lê as frequências de uma empresa (por id) num mês, agrupadas por funcionário. */
export async function lerFrequenciasDoMes(empresaId: string, ano: number, mes: number): Promise<Frequencia[]> {
  const ctx = getSheets();
  await garantirAba(ctx);
  const empresas = await lerEmpresas();
  const res = await ctx.sheets.spreadsheets.values.get({
    spreadsheetId: ctx.spreadsheetId,
    range: `${ABA}!A2:K`,
  });
  const linhas = (res.data.values ?? []).filter(
    (r) => resolverEmpresaId(r[10], empresas) === empresaId && Number(r[1]) === ano && Number(r[2]) === mes,
  );
  const porFunc = new Map<string, Frequencia>();
  for (const r of linhas) {
    const nome = String(r[0]);
    if (!porFunc.has(nome)) porFunc.set(nome, { empresa: empresaId, funcionario: nome, ano, mes, dias: [] });
    porFunc.get(nome)!.dias.push({
      dia: Number(r[3]),
      entradaManha: r[4] || null,
      saidaAlmoco: r[5] || null,
      retornoAlmoco: r[6] || null,
      saidaTarde: r[7] || null,
      marcador: (r[8] || null) as Frequencia['dias'][number]['marcador'],
    });
  }
  for (const f of porFunc.values()) f.dias.sort((a, b) => a.dia - b.dia);
  return [...porFunc.values()];
}

// ---- helper genérico ----
async function garantirAbaHeader(ctx: SheetsCtx, titulo: string, header: string[]): Promise<void> {
  const meta = await ctx.sheets.spreadsheets.get({ spreadsheetId: ctx.spreadsheetId });
  const existe = meta.data.sheets?.some((s) => s.properties?.title === titulo);
  if (!existe) {
    await ctx.sheets.spreadsheets.batchUpdate({
      spreadsheetId: ctx.spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: titulo } } }] },
    });
  }
  const colFim = String.fromCharCode(64 + header.length); // A, B, ...
  await ctx.sheets.spreadsheets.values.update({
    spreadsheetId: ctx.spreadsheetId,
    range: `${titulo}!A1:${colFim}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [header] },
  });
}

async function reescreverCorpo(ctx: SheetsCtx, titulo: string, ncols: number, linhas: (string | number)[][]): Promise<void> {
  const colFim = String.fromCharCode(64 + ncols);
  await ctx.sheets.spreadsheets.values.clear({ spreadsheetId: ctx.spreadsheetId, range: `${titulo}!A2:${colFim}` });
  if (linhas.length) {
    await ctx.sheets.spreadsheets.values.update({
      spreadsheetId: ctx.spreadsheetId,
      range: `${titulo}!A2`,
      valueInputOption: 'RAW',
      requestBody: { values: linhas },
    });
  }
}

// ---- Funcionários ----
/** Lê funcionários; se `empresaId` for informado, filtra só os dela. */
export async function lerFuncionarios(empresaId?: string): Promise<Funcionario[]> {
  const ctx = getSheets();
  await garantirAbaHeader(ctx, ABA_FUNC, HEADER_FUNC);
  const empresas = await lerEmpresas(); // para resolver o vínculo (id/nome/legado)
  const res = await ctx.sheets.spreadsheets.values.get({ spreadsheetId: ctx.spreadsheetId, range: `${ABA_FUNC}!A2:F` });
  const todos = (res.data.values ?? []).map((r) => ({
    nome: String(r[0] ?? ''),
    cargo: r[1] ? String(r[1]) : null,
    jornadaUtilMin: r[2] ? Number(r[2]) : undefined,
    jornadaSabadoMin: r[3] ? Number(r[3]) : undefined,
    ordem: r[4] ? Number(r[4]) : null,
    empresa: resolverEmpresaId(r[5], empresas), // linhas antigas → id da empresa padrão
  })).filter((f) => f.nome);
  return empresaId ? todos.filter((f) => f.empresa === empresaId) : todos;
}

/** Substitui os funcionários de UMA empresa (por id), preservando os das demais. */
export async function salvarFuncionarios(empresaId: string, lista: Funcionario[]): Promise<number> {
  const ctx = getSheets();
  await garantirAbaHeader(ctx, ABA_FUNC, HEADER_FUNC);
  const outros = (await lerFuncionarios()).filter((f) => f.empresa !== empresaId);
  const desta = lista.filter((f) => f.nome?.trim()).map((f) => ({ ...f, empresa: empresaId }));
  const combinado = [...outros, ...desta];
  const linhas = combinado.map((f, i) => [
    f.nome.trim(), f.cargo ?? '', f.jornadaUtilMin ?? '', f.jornadaSabadoMin ?? '', f.ordem ?? i + 1, f.empresa,
  ]);
  await reescreverCorpo(ctx, ABA_FUNC, HEADER_FUNC.length, linhas);
  return desta.length;
}

// ---- Empresas ----
export async function lerEmpresas(): Promise<Empresa[]> {
  const ctx = getSheets();
  await garantirAbaHeader(ctx, ABA_EMP, HEADER_EMP);
  const res = await ctx.sheets.spreadsheets.values.get({ spreadsheetId: ctx.spreadsheetId, range: `${ABA_EMP}!A2:G` });
  const lista: Empresa[] = (res.data.values ?? []).map((r) => ({
    nome: String(r[0] ?? ''),
    cnpj: r[1] ? String(r[1]) : null,
    trabalhaSabado: r[2] === 'true' || r[2] === '1',
    jornadaUtilMin: r[3] ? Number(r[3]) : undefined,
    jornadaSabadoMin: r[4] ? Number(r[4]) : undefined,
    ordem: r[5] ? Number(r[5]) : null,
    id: String(r[6] ?? '').trim(),
  })).filter((e) => e.nome);

  // Primeira execução: semeia a empresa padrão, herdando o ajuste global antigo.
  if (lista.length === 0) {
    let trabalhaSabado = false;
    try {
      const cfg = await lerConfig();
      trabalhaSabado = cfg['trabalha_sabado'] === 'true' || cfg['trabalha_sabado'] === '1';
    } catch { /* sem planilha de config ainda */ }
    const padrao: Empresa = { id: EMPRESA_PADRAO_ID, nome: EMPRESA_PADRAO, cnpj: null, trabalhaSabado, ordem: 1 };
    await salvarEmpresas([padrao]);
    return [padrao];
  }

  // Cura ids faltantes (aba criada no deploy anterior não tinha coluna id).
  let precisaSalvar = false;
  for (const e of lista) {
    if (!e.id) {
      e.id = e.nome === EMPRESA_PADRAO ? EMPRESA_PADRAO_ID : randomUUID();
      precisaSalvar = true;
    }
  }
  if (precisaSalvar) await salvarEmpresas(lista);
  return lista;
}

export async function salvarEmpresas(lista: Empresa[]): Promise<number> {
  const ctx = getSheets();
  await garantirAbaHeader(ctx, ABA_EMP, HEADER_EMP);
  const linhas = lista
    .filter((e) => e.nome?.trim())
    .map((e, i) => [
      e.nome.trim(), e.cnpj ?? '', e.trabalhaSabado ? 'true' : 'false',
      e.jornadaUtilMin ?? '', e.jornadaSabadoMin ?? '', e.ordem ?? i + 1,
      // id imutável: mantém o existente; gera para empresas novas.
      e.id?.trim() || (e.nome.trim() === EMPRESA_PADRAO ? EMPRESA_PADRAO_ID : randomUUID()),
    ]);
  await reescreverCorpo(ctx, ABA_EMP, HEADER_EMP.length, linhas);
  return linhas.length;
}

export async function lerEmpresa(id: string): Promise<Empresa | null> {
  return (await lerEmpresas()).find((e) => e.id === id) ?? null;
}

/** Jornada de uma empresa (por id; inclui "trabalha aos sábados"). */
export async function lerJornadaEmpresa(id: string): Promise<Jornada> {
  const e = await lerEmpresa(id);
  if (!e) return { ...JORNADA_PADRAO };
  return {
    utilMin: e.jornadaUtilMin ?? JORNADA_PADRAO.utilMin,
    sabadoMin: e.jornadaSabadoMin ?? JORNADA_PADRAO.sabadoMin,
    trabalhaSabado: e.trabalhaSabado,
  };
}

// ---- Feriados ----
export async function lerFeriados(): Promise<Feriado[]> {
  const ctx = getSheets();
  await garantirAbaHeader(ctx, ABA_FER, HEADER_FER);
  const res = await ctx.sheets.spreadsheets.values.get({ spreadsheetId: ctx.spreadsheetId, range: `${ABA_FER}!A2:B` });
  return (res.data.values ?? []).map((r) => ({ data: String(r[0] ?? ''), descricao: String(r[1] ?? '') })).filter((f) => f.data);
}

export async function salvarFeriados(lista: Feriado[]): Promise<number> {
  const ctx = getSheets();
  await garantirAbaHeader(ctx, ABA_FER, HEADER_FER);
  const linhas = lista.filter((f) => f.data?.trim()).map((f) => [f.data.trim(), f.descricao ?? '']);
  await reescreverCorpo(ctx, ABA_FER, HEADER_FER.length, linhas);
  return linhas.length;
}

// ---- Config (chave/valor) ----
export async function lerConfig(): Promise<Record<string, string>> {
  const ctx = getSheets();
  await garantirAbaHeader(ctx, ABA_CFG, HEADER_CFG);
  const res = await ctx.sheets.spreadsheets.values.get({ spreadsheetId: ctx.spreadsheetId, range: `${ABA_CFG}!A2:B` });
  const obj: Record<string, string> = {};
  for (const r of res.data.values ?? []) {
    if (r[0]) obj[String(r[0])] = String(r[1] ?? '');
  }
  return obj;
}

export async function salvarConfig(entradas: Record<string, string>): Promise<void> {
  const ctx = getSheets();
  await garantirAbaHeader(ctx, ABA_CFG, HEADER_CFG);
  const atual = await lerConfig();
  const merge = { ...atual, ...entradas };
  const linhas = Object.entries(merge).map(([k, v]) => [k, v]);
  await reescreverCorpo(ctx, ABA_CFG, HEADER_CFG.length, linhas);
}

// ---- Usuários ----
function linhaUsuario(u: UsuarioRec): (string | number)[] {
  return [u.email, u.nome, u.role, u.salt, u.hash, u.empresa ?? ''];
}

export async function lerUsuarios(): Promise<UsuarioRec[]> {
  const ctx = getSheets();
  await garantirAbaHeader(ctx, ABA_USERS, HEADER_USERS);
  const res = await ctx.sheets.spreadsheets.values.get({ spreadsheetId: ctx.spreadsheetId, range: `${ABA_USERS}!A2:F` });
  return (res.data.values ?? []).map((r) => ({
    email: String(r[0] ?? '').toLowerCase(),
    nome: String(r[1] ?? ''),
    role: (r[2] === 'master' ? 'master' : r[2] === 'cliente' ? 'cliente' : 'usuario') as Papel,
    salt: String(r[3] ?? ''),
    hash: String(r[4] ?? ''),
    empresa: r[5] ? String(r[5]).trim() : null,
  })).filter((u) => u.email);
}

export async function buscarUsuario(email: string): Promise<UsuarioRec | null> {
  const alvo = email.trim().toLowerCase();
  return (await lerUsuarios()).find((u) => u.email === alvo) ?? null;
}

/** Adiciona/atualiza um usuário (upsert por email). */
export async function salvarUsuario(u: UsuarioRec): Promise<void> {
  const ctx = getSheets();
  await garantirAbaHeader(ctx, ABA_USERS, HEADER_USERS);
  const atuais = await lerUsuarios();
  const email = u.email.trim().toLowerCase();
  const mantidos = atuais.filter((x) => x.email !== email);
  const linhas = [...mantidos, { ...u, email }].map(linhaUsuario);
  await reescreverCorpo(ctx, ABA_USERS, HEADER_USERS.length, linhas);
}

export async function removerUsuario(email: string): Promise<void> {
  const ctx = getSheets();
  await garantirAbaHeader(ctx, ABA_USERS, HEADER_USERS);
  const alvo = email.trim().toLowerCase();
  const linhas = (await lerUsuarios()).filter((x) => x.email !== alvo).map(linhaUsuario);
  await reescreverCorpo(ctx, ABA_USERS, HEADER_USERS.length, linhas);
}

/** Lê a chave do Gemini da aba Config (se houver planilha configurada). */
export async function getGeminiKeyDaConfig(): Promise<string | null> {
  try {
    const cfg = await lerConfig();
    return cfg['gemini_api_key']?.trim() || null;
  } catch {
    return null;
  }
}
