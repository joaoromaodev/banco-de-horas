// Persistência no Google Sheets. Abas: "Frequencias" (registro por dia),
// "Funcionarios", "Feriados" e "Config" (chave/valor).
import { google, sheets_v4 } from 'googleapis';
import { getContaServico, getSpreadsheetId } from './config';
import { Frequencia, Funcionario } from './tipos';
import { Jornada, JORNADA_PADRAO } from './calendario';

const ABA = 'Frequencias';
const HEADER = [
  'funcionario', 'ano', 'mes', 'dia',
  'entradaManha', 'saidaAlmoco', 'retornoAlmoco', 'saidaTarde',
  'marcador', 'atualizadoEm',
];

const ABA_FUNC = 'Funcionarios';
const HEADER_FUNC = ['nome', 'cargo', 'jornadaUtilMin', 'jornadaSabadoMin', 'ordem'];
const ABA_FER = 'Feriados';
const HEADER_FER = ['data', 'descricao'];
const ABA_CFG = 'Config';
const HEADER_CFG = ['chave', 'valor'];
const ABA_USERS = 'Usuarios';
const HEADER_USERS = ['email', 'nome', 'role', 'salt', 'hash'];

export interface Feriado {
  data: string; // AAAA-MM-DD
  descricao: string;
}

export interface UsuarioRec {
  email: string;
  nome: string;
  role: 'master' | 'usuario';
  salt: string;
  hash: string;
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
    range: `${ABA}!A1:J1`,
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
  const res = await ctx.sheets.spreadsheets.values.get({
    spreadsheetId: ctx.spreadsheetId,
    range: `${ABA}!A2:J`,
  });
  const atuais = res.data.values ?? [];

  // Remove linhas do mesmo funcionário+ano+mês
  const mantidas = atuais.filter(
    (r) => !(r[0] === freq.funcionario && Number(r[1]) === freq.ano && Number(r[2]) === freq.mes),
  );

  // Novas linhas (só dias com algum dado ou marcador)
  const carimbo = new Date().toISOString();
  const novas = freq.dias
    .filter((d) => d.entradaManha || d.saidaAlmoco || d.retornoAlmoco || d.saidaTarde || d.marcador)
    .map((d) => [
      freq.funcionario, freq.ano, freq.mes, d.dia,
      d.entradaManha ?? '', d.saidaAlmoco ?? '', d.retornoAlmoco ?? '', d.saidaTarde ?? '',
      d.marcador ?? '', carimbo,
    ]);

  const todas = [...mantidas, ...novas].sort((a, b) => {
    const fa = String(a[0]).localeCompare(String(b[0]));
    if (fa !== 0) return fa;
    return (Number(a[1]) - Number(b[1])) || (Number(a[2]) - Number(b[2])) || (Number(a[3]) - Number(b[3]));
  });

  // Limpa e reescreve o corpo
  await ctx.sheets.spreadsheets.values.clear({ spreadsheetId: ctx.spreadsheetId, range: `${ABA}!A2:J` });
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

/** Lê todas as frequências de um mês, agrupadas por funcionário. */
export async function lerFrequenciasDoMes(ano: number, mes: number): Promise<Frequencia[]> {
  const ctx = getSheets();
  await garantirAba(ctx);
  const res = await ctx.sheets.spreadsheets.values.get({
    spreadsheetId: ctx.spreadsheetId,
    range: `${ABA}!A2:J`,
  });
  const linhas = (res.data.values ?? []).filter(
    (r) => Number(r[1]) === ano && Number(r[2]) === mes,
  );
  const porFunc = new Map<string, Frequencia>();
  for (const r of linhas) {
    const nome = String(r[0]);
    if (!porFunc.has(nome)) porFunc.set(nome, { funcionario: nome, ano, mes, dias: [] });
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
export async function lerFuncionarios(): Promise<Funcionario[]> {
  const ctx = getSheets();
  await garantirAbaHeader(ctx, ABA_FUNC, HEADER_FUNC);
  const res = await ctx.sheets.spreadsheets.values.get({ spreadsheetId: ctx.spreadsheetId, range: `${ABA_FUNC}!A2:E` });
  return (res.data.values ?? []).map((r) => ({
    nome: String(r[0] ?? ''),
    cargo: r[1] ? String(r[1]) : null,
    jornadaUtilMin: r[2] ? Number(r[2]) : undefined,
    jornadaSabadoMin: r[3] ? Number(r[3]) : undefined,
    ordem: r[4] ? Number(r[4]) : null,
  })).filter((f) => f.nome);
}

export async function salvarFuncionarios(lista: Funcionario[]): Promise<number> {
  const ctx = getSheets();
  await garantirAbaHeader(ctx, ABA_FUNC, HEADER_FUNC);
  const linhas = lista
    .filter((f) => f.nome?.trim())
    .map((f, i) => [f.nome.trim(), f.cargo ?? '', f.jornadaUtilMin ?? '', f.jornadaSabadoMin ?? '', f.ordem ?? i + 1]);
  await reescreverCorpo(ctx, ABA_FUNC, HEADER_FUNC.length, linhas);
  return linhas.length;
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
export async function lerUsuarios(): Promise<UsuarioRec[]> {
  const ctx = getSheets();
  await garantirAbaHeader(ctx, ABA_USERS, HEADER_USERS);
  const res = await ctx.sheets.spreadsheets.values.get({ spreadsheetId: ctx.spreadsheetId, range: `${ABA_USERS}!A2:E` });
  return (res.data.values ?? []).map((r) => ({
    email: String(r[0] ?? '').toLowerCase(),
    nome: String(r[1] ?? ''),
    role: (r[2] === 'master' ? 'master' : 'usuario') as 'master' | 'usuario',
    salt: String(r[3] ?? ''),
    hash: String(r[4] ?? ''),
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
  const linhas = [...mantidos, { ...u, email }].map((x) => [x.email, x.nome, x.role, x.salt, x.hash]);
  await reescreverCorpo(ctx, ABA_USERS, HEADER_USERS.length, linhas);
}

export async function removerUsuario(email: string): Promise<void> {
  const ctx = getSheets();
  await garantirAbaHeader(ctx, ABA_USERS, HEADER_USERS);
  const alvo = email.trim().toLowerCase();
  const linhas = (await lerUsuarios()).filter((x) => x.email !== alvo).map((x) => [x.email, x.nome, x.role, x.salt, x.hash]);
  await reescreverCorpo(ctx, ABA_USERS, HEADER_USERS.length, linhas);
}

/** Lê a jornada da empresa (aba Config). Padrão: não trabalha aos sábados. */
export async function lerJornada(): Promise<Jornada> {
  try {
    const cfg = await lerConfig();
    const trabalhaSabado = cfg['trabalha_sabado'] === 'true' || cfg['trabalha_sabado'] === '1';
    const utilMin = cfg['jornada_util_min'] ? Number(cfg['jornada_util_min']) : JORNADA_PADRAO.utilMin;
    const sabadoMin = cfg['jornada_sabado_min'] ? Number(cfg['jornada_sabado_min']) : JORNADA_PADRAO.sabadoMin;
    return {
      utilMin: Number.isFinite(utilMin) ? utilMin : JORNADA_PADRAO.utilMin,
      sabadoMin: Number.isFinite(sabadoMin) ? sabadoMin : JORNADA_PADRAO.sabadoMin,
      trabalhaSabado,
    };
  } catch {
    return { ...JORNADA_PADRAO };
  }
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
