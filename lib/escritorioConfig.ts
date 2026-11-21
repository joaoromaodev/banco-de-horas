// Configurações do escritório — regras puras (sem I/O, testadas em
// tests/escritorioConfig.test.ts). Banco em lib/escritorioServidor.ts.
import type { Sessao } from './auth';
import { DIA_PRAZO_MAX, DIA_PRAZO_MIN, DIA_PRAZO_PADRAO, diaPrazoValido } from './fechamento';

export const NOME_MAX = 120;
export const CONTABILISTA_MAX = 120;
export const CRC_MAX = 30;

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** CNPJ com os dois dígitos verificadores corretos. */
export function cnpjValido(v: unknown): boolean {
  const c = soDigitos(v);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base: string) => {
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(c.slice(0, 12)) === Number(c[12]) && dv(c.slice(0, 13)) === Number(c[13]);
}

export function formatarCnpj(v: unknown): string {
  const d = soDigitos(v);
  return d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : String(v ?? '');
}

/**
 * CRC: aceita os formatos que os conselhos usam ("PA-012345/O-1", "CRC PA 012345/O",
 * "1SP123456/O-8"). Não tenta adivinhar o formato de cada estado: exige ao menos
 * um dígito e só letras, números, espaço e `- / . º`.
 */
export function crcValido(v: unknown): boolean {
  const s = String(v ?? '').trim();
  return s.length >= 4 && s.length <= CRC_MAX && /\d/.test(s) && /^[\p{L}\d\s\-/.º]+$/u.test(s);
}

export interface ConfigEscritorio {
  nome: string;
  cnpj: string | null;
  contabilistaNome: string;
  contabilistaCrc: string;
  prazoPedidosPadrao: number;
}

export type ResultadoConfig =
  | { ok: true; config: ConfigEscritorio }
  | { ok: false; erros: Partial<Record<keyof ConfigEscritorio, string>> };

/** Valida e normaliza o corpo da tela. CNPJ, contabilista e CRC podem ficar em branco; o nome não. */
export function validarConfig(b: Record<string, unknown> | null | undefined): ResultadoConfig {
  const erros: Partial<Record<keyof ConfigEscritorio, string>> = {};
  const nome = String(b?.nome ?? '').trim().replace(/\s+/g, ' ');
  if (!nome) erros.nome = 'Informe o nome do escritório.';
  else if (nome.length > NOME_MAX) erros.nome = `O nome pode ter até ${NOME_MAX} letras.`;

  const cnpjBruto = String(b?.cnpj ?? '').trim();
  let cnpj: string | null = null;
  if (cnpjBruto) {
    if (!cnpjValido(cnpjBruto)) erros.cnpj = 'Esse CNPJ não confere. Veja se digitou todos os números.';
    else cnpj = soDigitos(cnpjBruto);
  }

  const contabilistaNome = String(b?.contabilistaNome ?? '').trim().replace(/\s+/g, ' ');
  if (contabilistaNome.length > CONTABILISTA_MAX) erros.contabilistaNome = `O nome pode ter até ${CONTABILISTA_MAX} letras.`;

  const contabilistaCrc = String(b?.contabilistaCrc ?? '').trim().replace(/\s+/g, ' ');
  if (contabilistaCrc && !crcValido(contabilistaCrc)) erros.contabilistaCrc = 'Esse CRC parece incompleto. Exemplo: PA-012345/O-1.';
  if (contabilistaCrc && !contabilistaNome) erros.contabilistaNome = 'Diga o nome de quem assina junto com o CRC.';

  const prazo = Number(b?.prazoPedidosPadrao ?? DIA_PRAZO_PADRAO);
  if (!diaPrazoValido(prazo)) erros.prazoPedidosPadrao = `O dia vai de ${DIA_PRAZO_MIN} a ${DIA_PRAZO_MAX}.`;

  if (Object.keys(erros).length) return { ok: false, erros };
  return { ok: true, config: { nome, cnpj, contabilistaNome, contabilistaCrc, prazoPedidosPadrao: prazo } };
}

// ------------------------------------------------------------------ quem pode o quê
export type Acesso = 'editar' | 'ler' | null;

/**
 * Acesso de uma sessão às configurações de um escritório. Só o administrador do
 * PRÓPRIO escritório grava; os demais contadores dele só leem; o master só lê
 * (age pelo painel da plataforma, não por esta tela); cliente e escritório
 * alheio, nada.
 */
export function acessoAoEscritorio(s: Pick<Sessao, 'role' | 'escritorioId' | 'adminEscritorio'> | null | undefined, escritorioId: string): Acesso {
  if (!s || !escritorioId) return null;
  if (s.role === 'master') return 'ler';
  if (s.role !== 'usuario' || s.escritorioId !== escritorioId) return null;
  return s.adminEscritorio ? 'editar' : 'ler';
}

// ------------------------------------------------------------------ aplicar às empresas
export interface FiscalLinha { empresaId: string; contabilista: string | null; crc: string | null }

/**
 * Empresas (ids) que ainda não têm contabilista: sem linha fiscal ou com o campo
 * em branco. Quem já tem, mesmo que diferente do padrão, fica de fora.
 */
export function empresasSemContabilista(empresaIds: string[], fiscais: FiscalLinha[]): string[] {
  const comNome = new Set(fiscais.filter((f) => String(f.contabilista ?? '').trim()).map((f) => f.empresaId));
  return empresaIds.filter((id) => !comNome.has(id));
}
