// Varredura de guarda: todo handler exportado de `app/api/**/route.ts` tem de
// chamar uma guarda de `lib/acesso.ts` (direto ou por um helper local/importado
// que a chame) — ou estar na lista de exceções abaixo, com o motivo e a prova de
// que se protege sozinho. Rota nova sem guarda quebra o CI aqui, com o caminho e
// o que fazer. Ver docs/testes.md → "Rota nova".
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  cadeiaAteGuarda, corpoDoHandler, guardasBase, handlers, RAIZ, rel, rotasDaApi,
} from './varreduraRotas';

vi.mock('@/lib/cobrancaServidor', () => ({ situacaoDoEscritorio: vi.fn(async () => null) }));
const { proxy } = await import('@/proxy');

/**
 * Exceções legítimas: rotas sem sessão por natureza. Cada uma diz por quê e traz
 * `prova` — um trecho que TEM de aparecer no handler (o que a protege). Se a prova
 * sumir, o teste acusa. Todas precisam estar em PUBLICO no proxy.ts.
 */
const EXCECOES: Record<string, { motivo: string; prova: RegExp | null }> = {
  'app/api/login/route.ts#POST': {
    motivo: 'Login: é onde a sessão nasce. Freio por IP e por e-mail (Limitador).',
    prova: /\.tentar\(/,
  },
  'app/api/logout/route.ts#POST': {
    motivo: 'Logout: só apaga o cookie da própria requisição; não lê nem grava dado.',
    prova: /maxAge:\s*0/,
  },
  'app/api/criar-conta/route.ts#POST': {
    motivo: 'Cadastro self-service do escritório (público). Freio por IP; e-mail único.',
    prova: /limitador\.tentar\(/,
  },
  'app/api/cobranca/webhook/route.ts#POST': {
    motivo: 'Webhook do Asaas: sem sessão; autenticado pelo token no header, em tempo constante.',
    prova: /tokenWebhookValido\(/,
  },
  'app/api/cron/agenda/route.ts#GET': {
    motivo: 'Cron da Vercel: sem cookie; exige Authorization: Bearer CRON_SECRET (recusa tudo sem a variável).',
    prova: /CRON_SECRET/,
  },
};

const BASE = guardasBase();
const ROTAS = rotasDaApi();

describe('varredura de guarda das rotas de API', () => {
  it('acha as rotas e as guardas (a varredura não está cega)', () => {
    expect(ROTAS.length).toBeGreaterThan(50);
    for (const g of ['exigirSessao', 'exigirGestor', 'exigirMaster', 'exigirEmpresa', 'exigirClienteDaEmpresa', 'exigirAdminEscritorio', 'sessaoDe']) {
      expect(BASE.has(g), `lib/acesso.ts deixou de exportar ${g}`).toBe(true);
    }
    // Guardas indiretas conhecidas são reconhecidas (helper local, de outro arquivo, em cadeia).
    const envio = join(RAIZ, 'app/api/envio-ponto/route.ts');
    expect(cadeiaAteGuarda(envio, corpoDoHandler(envio, 'GET'), BASE)?.[0]).toBe('guardaEmpresa (app/api/documentos/comum.ts)');
    expect(cadeiaAteGuarda(envio, corpoDoHandler(envio, 'GET'), new Set(['exigirEmpresa']))).toEqual(['guardaEmpresa (app/api/documentos/comum.ts)', 'exigirEmpresa']);
    const ferias = join(RAIZ, 'app/api/dp/ferias/route.ts');
    expect(cadeiaAteGuarda(ferias, corpoDoHandler(ferias, 'PATCH'), BASE)).not.toBeNull();
  });

  it('acusa handler sem guarda: comentário e homônimo local não contam', () => {
    const f = join(RAIZ, 'tests/fixtures/rotaVarredura.ts');
    expect(handlers(f).sort()).toEqual(['DELETE', 'GET', 'POST']);
    expect(cadeiaAteGuarda(f, corpoDoHandler(f, 'GET'), BASE)).toEqual(['interno', 'exigirGestor']);
    expect(cadeiaAteGuarda(f, corpoDoHandler(f, 'POST'), BASE)).toBeNull();
    expect(cadeiaAteGuarda(f, corpoDoHandler(f, 'DELETE'), BASE)).toBeNull();
  });

  it('todo handler exportado chama uma guarda de lib/acesso.ts (ou é exceção documentada)', () => {
    const semGuarda: string[] = [];
    for (const { arquivo, caminho } of ROTAS) {
      for (const metodo of handlers(arquivo)) {
        const chave = `${rel(arquivo)}#${metodo}`;
        if (EXCECOES[chave]) continue;
        if (!cadeiaAteGuarda(arquivo, corpoDoHandler(arquivo, metodo), BASE)) semGuarda.push(`${metodo} ${caminho} (${rel(arquivo)})`);
      }
    }
    expect(semGuarda, [
      'Handler sem guarda de lib/acesso.ts:',
      ...semGuarda.map((s) => `  - ${s}`),
      'O que fazer: comece o handler com a guarda que corresponde (exigirSessao / exigirGestor / exigirEmpresa /',
      'exigirClienteDaEmpresa / exigirMaster / exigirAdminEscritorio) e responda `g.resposta` quando `!g.ok`.',
      'Se a rota é pública de verdade (webhook com assinatura, cron com segredo), ponha em PUBLICO no proxy.ts',
      'e em EXCECOES neste teste, com o motivo e a prova.',
    ].join('\n')).toEqual([]);
  });

  it('as exceções continuam válidas: existem, não têm guarda, trazem a prova e são públicas no proxy', async () => {
    for (const [chave, { motivo, prova }] of Object.entries(EXCECOES)) {
      const [arq, metodo] = chave.split('#');
      const arquivo = join(RAIZ, arq);
      expect(existsSync(arquivo), `${chave}: arquivo sumiu — tire de EXCECOES`).toBe(true);
      expect(handlers(arquivo), `${chave}: o handler sumiu — tire de EXCECOES`).toContain(metodo);
      const corpo = corpoDoHandler(arquivo, metodo);
      expect(cadeiaAteGuarda(arquivo, corpo, BASE), `${chave}: agora chama guarda — tire de EXCECOES`).toBeNull();
      if (prova) expect(corpo, `${chave}: perdeu a proteção esperada (${motivo})`).toMatch(prova);
      // Sem sessão, o proxy deixa passar (senão a exceção não teria razão de ser).
      const caminho = '/' + arq.replace(/^app\//, '').replace(/\/route\.ts$/, '');
      const r = await proxy(new NextRequest(new URL(caminho, 'http://localhost'), { method: metodo }));
      expect(r.status, `${caminho} é exceção mas o proxy não a deixa pública (PUBLICO)`).toBe(200);
    }
  });

  it('sem sessão, toda rota que não é exceção leva 401 no proxy (defesa em profundidade)', async () => {
    const publicas = new Set(Object.keys(EXCECOES).map((k) => k.split('#')[0]));
    for (const { arquivo, caminho } of ROTAS) {
      if (publicas.has(rel(arquivo))) continue;
      const r = await proxy(new NextRequest(new URL(caminho, 'http://localhost')));
      expect(r.status, `${caminho} responde sem sessão`).toBe(401);
    }
  });
});
