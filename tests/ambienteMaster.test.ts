// "O que está desligado" (Sprint 14): GET /api/config/ambiente só para o master, e
// nunca devolve o valor de uma variável — só se está configurada e o que destrava.
// Guardas REAIS de lib/acesso.ts; só a sessão e o cadastro são simulados.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { Sessao } from '@/lib/auth';
import { situacaoDoAmbiente, resumoDoAmbiente } from '@/lib/ambiente';

const exp = Date.now() + 3_600_000;
const S: Record<string, Sessao> = {
  master: { email: 'm@x.com', nome: 'M', role: 'master', exp },
  contador: { email: 'c@a.com', nome: 'C', role: 'usuario', escritorioId: 'esc-a', adminEscritorio: true, exp },
  cliente: { email: 'e@a.com', nome: 'E', role: 'cliente', escritorioId: 'esc-a', empresa: 'emp-a1', exp },
};
let sessao: Sessao | null = null;

vi.mock('@/lib/auth', async (orig) => ({ ...(await orig<typeof import('@/lib/auth')>()), lerSessao: async () => sessao }));
vi.mock('@/lib/cadastro', () => ({ lerEmpresas: async () => [], lerEmpresasComArquivadas: async () => [], buscarUsuario: async () => null }));
vi.mock('@/lib/cobrancaServidor', () => ({ situacaoDoEscritorio: async () => null }));

const { GET } = await import('@/app/api/config/ambiente/route');
const get = () => GET(new NextRequest('http://localhost/api/config/ambiente'));

const SEGREDOS = {
  CRON_SECRET: 'segredo-do-cron-123',
  RESEND_API_KEY: 're_chave_secreta_456',
  EMAIL_REMETENTE: 'ClickContas <avisos@exemplo.com.br>',
  MASTER_PASSWORD: 'uma-senha-bem-forte-789',
  GEMINI_API_KEY: 'AIza-chave-gemini-000',
  CAIXA_IA_DOCUMENTO: 'ligada',
  CAIXA_IA_SUGESTAO: 'ligada',
  AVISOS_CLIENTE_EMAIL: 'ligado',
  APP_URL: 'https://app.exemplo.com.br',
};
const NOMES = [...Object.keys(SEGREDOS), 'GEMINI_API_KEY_CAIXA', 'IA_PROVEDOR', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_AI_TOKEN', 'IA_COTA_DIARIA'];
let guardado: Record<string, string | undefined> = {};

beforeEach(() => {
  guardado = Object.fromEntries(NOMES.map((k) => [k, process.env[k]]));
  for (const k of NOMES) delete process.env[k];
});
afterEach(() => {
  for (const [k, v] of Object.entries(guardado)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

describe('GET /api/config/ambiente — guarda', () => {
  it('sem sessão → 401', async () => {
    sessao = null;
    expect((await get()).status).toBe(401);
  });
  it('contador (mesmo admin do escritório) → 403', async () => {
    sessao = S.contador;
    expect((await get()).status).toBe(403);
  });
  it('cliente → 403', async () => {
    sessao = S.cliente;
    expect((await get()).status).toBe(403);
  });
  it('master → 200, com a situação de cada item e sem nenhum valor de variável', async () => {
    sessao = S.master;
    Object.assign(process.env, SEGREDOS);
    const r = await get();
    expect(r.status).toBe(200);
    const texto = await r.text();
    for (const v of Object.values(SEGREDOS)) {
      if (v === 'ligada' || v === 'ligado') continue; // o valor da trava é público (está na doc)
      expect(texto).not.toContain(v);
    }
    const d = JSON.parse(texto);
    expect(d.itens.every((i: { situacao: string }) => i.situacao === 'ligado')).toBe(true);
    expect(d.resumo).toEqual({ desligados: 0, parciais: 0 });
  });
});

describe('situacaoDoAmbiente', () => {
  const porId = (env: NodeJS.ProcessEnv) => new Map(situacaoDoAmbiente(env).map((i) => [i.id, i]));

  it('nada configurado: tudo desligado, cada item diz o que destrava', () => {
    const itens = situacaoDoAmbiente({} as unknown as NodeJS.ProcessEnv);
    expect(itens.map((i) => i.id)).toEqual(['cron', 'email', 'master', 'ia', 'caixa_documento', 'caixa_sugestao', 'avisos_email']);
    expect(itens.every((i) => i.situacao === 'desligado' && i.destrava && i.agora)).toBe(true);
    expect(resumoDoAmbiente(itens).desligados).toBe(7);
    // o cron desligado avisa que os pedidos mensais ainda abrem na visita
    expect(itens[0].agora).toMatch(/primeira visita do mês/);
  });

  it('e-mail com chave e sem remetente é "parcial"', () => {
    expect(porId({ RESEND_API_KEY: 'x' } as unknown as NodeJS.ProcessEnv).get('email')?.situacao).toBe('parcial');
  });

  it('senha do master fraca ou da lista proibida conta como desligada', () => {
    expect(porId({ MASTER_PASSWORD: 'curta' } as unknown as NodeJS.ProcessEnv).get('master')?.situacao).toBe('desligado');
    expect(porId({ MASTER_PASSWORD: 'admin1234' } as unknown as NodeJS.ProcessEnv).get('master')?.situacao).toBe('desligado');
    expect(porId({ MASTER_PASSWORD: 'uma-senha-bem-forte' } as unknown as NodeJS.ProcessEnv).get('master')?.situacao).toBe('ligado');
  });

  it('travas da IA do caixa: ligadas sem chave do Gemini continuam desligadas', () => {
    const m = porId({ CAIXA_IA_DOCUMENTO: 'ligada', CAIXA_IA_SUGESTAO: 'ligada' } as unknown as NodeJS.ProcessEnv);
    expect(m.get('caixa_documento')?.situacao).toBe('desligado');
    expect(m.get('caixa_sugestao')?.situacao).toBe('desligado');
    expect(m.get('caixa_documento')?.agora).toMatch(/falta uma chave/);
    // a leitura de documento aceita a chave própria do caixa
    expect(porId({ CAIXA_IA_DOCUMENTO: 'ligada', GEMINI_API_KEY_CAIXA: 'k' } as unknown as NodeJS.ProcessEnv).get('caixa_documento')?.situacao).toBe('ligado');
  });

  it('IA: Cloudflare quando as duas variáveis existem (padrão), Gemini quando escolhido ou sem a Cloudflare', () => {
    const cf = porId({ CLOUDFLARE_ACCOUNT_ID: 'conta', CLOUDFLARE_AI_TOKEN: 'tok' } as unknown as NodeJS.ProcessEnv).get('ia')!;
    expect(cf.situacao).toBe('ligado');
    expect(cf.titulo).toMatch(/Cloudflare Workers AI/);
    expect(cf.agora).toMatch(/10\.000 neurônios/);
    expect(cf.agora).not.toMatch(/conta|tok/);
    const so = porId({ CLOUDFLARE_ACCOUNT_ID: 'conta' } as unknown as NodeJS.ProcessEnv).get('ia')!;
    expect(so.situacao).toBe('desligado'); // só uma das duas: cai no Gemini, sem chave
    const gem = porId({ GEMINI_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv).get('ia')!;
    expect(gem.titulo).toMatch(/Gemini/);
    expect(gem.agora).toMatch(/Google pode usar/);
    const forcado = porId({ IA_PROVEDOR: 'cloudflare', GEMINI_API_KEY: 'k' } as unknown as NodeJS.ProcessEnv).get('ia')!;
    expect(forcado.situacao).toBe('desligado');
    expect(forcado.agora).toMatch(/CLOUDFLARE_ACCOUNT_ID/);
    // travas do caixa ligadas só com a Cloudflare: ligadas
    const caixa = porId({ CAIXA_IA_DOCUMENTO: 'ligada', CAIXA_IA_SUGESTAO: 'ligada', CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_AI_TOKEN: 'b' } as unknown as NodeJS.ProcessEnv);
    expect(caixa.get('caixa_documento')?.situacao).toBe('ligado');
    expect(caixa.get('caixa_sugestao')?.situacao).toBe('ligado');
  });

  it('e-mail dos avisos ao cliente exige a trava, o envio de e-mail e o APP_URL', () => {
    expect(porId({ AVISOS_CLIENTE_EMAIL: 'ligado', RESEND_API_KEY: 'x' } as unknown as NodeJS.ProcessEnv).get('avisos_email')?.situacao).toBe('desligado');
    expect(porId({ AVISOS_CLIENTE_EMAIL: 'ligado', RESEND_API_KEY: 'x', APP_URL: 'https://a.b' } as unknown as NodeJS.ProcessEnv).get('avisos_email')?.situacao).toBe('ligado');
  });
});
