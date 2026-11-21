import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PLANOS, PLANOS_PAGOS } from '@/lib/cobranca';
import { COTA_POR_PLANO, limiteDoPlano } from '@/lib/cotaOcr';

// O site (app/(site)/planos) não pode ter preço, limite ou cota próprios: tudo
// vem de PLANOS (cobrança) e COTA_POR_PLANO (ponto). Estes testes seguram isso.
const ler = (f: string) => readFileSync(f, 'utf8');
const FONTES = ['app/(site)/planos/Precos.tsx', 'app/(site)/planos/page.tsx'];

describe('preços do site x cobrança', () => {
  it('as páginas leem PLANOS e a cota por plano', () => {
    expect(ler(FONTES[0])).toContain("from '@/lib/cobranca'");
    expect(ler(FONTES[0])).toContain("from '@/lib/cotaOcr'");
    expect(ler(FONTES[1])).toContain("from '@/lib/cobranca'");
    expect(ler(FONTES[1])).toContain("from '@/lib/cotaOcr'");
  });

  it('nenhum valor de plano fica escrito à mão nas páginas de preço', () => {
    for (const f of FONTES) {
      const src = ler(f);
      for (const id of PLANOS_PAGOS) {
        const { mensal, anual } = PLANOS[id];
        expect(src, `${f}: mensal ${mensal}`).not.toMatch(new RegExp(`\b(mensal|anual):\s*(${mensal}|${anual})\b`));
        expect(src, `${f}: R$ ${mensal}`).not.toMatch(new RegExp(`R\$\s?${mensal}\b`));
      }
      expect(src, f).not.toMatch(/'(150|600|2\.000)'/);
    }
  });

  it('o plano anual é 10 mensalidades (a promessa "2 meses grátis")', () => {
    for (const id of PLANOS_PAGOS) expect(PLANOS[id].anual).toBe(PLANOS[id].mensal * 10);
  });

  it('todo plano pago tem cota de leitura, crescente', () => {
    const cotas = PLANOS_PAGOS.map((id) => limiteDoPlano(id));
    expect(cotas).toEqual(PLANOS_PAGOS.map((id) => COTA_POR_PLANO[id]));
    expect([...cotas].sort((a, b) => a - b)).toEqual(cotas);
  });
});
