import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Regressão da QA visual (Sprint 11): sem `relative`, o `sr-only` (position:absolute) do
// cabeçalho da tabela escapa da rolagem e a página inteira ganha rolagem horizontal no celular.
describe('moldura de tabela', () => {
  it('é posicionada para conter os filhos absolutos (sr-only)', () => {
    const ui = readFileSync('components/ui.tsx', 'utf8');
    const m = ui.match(/moldura: '([^']+)'/);
    expect(m?.[1]).toContain('relative');
    expect(m?.[1]).toContain('overflow-x-auto');
  });
  it('Marcacao nasce como checkbox quando o tipo não é informado', () => {
    const ui = readFileSync('components/ui.tsx', 'utf8');
    expect(ui).toMatch(/type = 'checkbox'/);
  });
});
