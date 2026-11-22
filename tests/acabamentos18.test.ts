// Sprint 18 · Frente A ("Acabamentos") — guarda estática do que é só de tela: a dica
// de foto nas duas telas que escolhem a foto da folha, os cartões da lista de documentos
// do cliente no celular e a edição de lançamento do caixa num diálogo no celular.
// (Não há teste de tela no projeto; a lógica está nos testes de cada módulo.)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(process.cwd(), 'app', '(app)');
const ler = (...p: string[]) => readFileSync(join(APP, ...p), 'utf8');

describe('dica de foto da folha', () => {
  it('aparece no envio do cliente e na Timesheet, com o texto combinado', () => {
    expect(ler('DicaFotoFolha.tsx')).toContain("'Fotografe a folha reta, inteira e com luz'");
    for (const tela of [['enviar-ponto', 'page.tsx'], ['ponto', 'page.tsx']]) {
      const src = ler(...tela);
      expect(src, tela.join('/')).toMatch(/import \{ DicaFotoFolha \} from '\.\.\/DicaFotoFolha'/);
      expect(src, tela.join('/')).toMatch(/<DicaFotoFolha\b/);
    }
  });
});

describe('celular', () => {
  it('documentos do cliente: cartões abaixo de 640 px e a tabela só a partir de sm', () => {
    const src = ler('documentos', 'page.tsx');
    expect(src).toMatch(/<ul className="[^"]*sm:hidden[^"]*" aria-label="Documentos que você já enviou"/);
    expect(src).toMatch(/!gestor && 'hidden sm:block'/);
    // As mesmas ações nos cartões, com o nome do arquivo no rótulo.
    expect(src).toMatch(/aria-label=\{`Excluir \$\{d\.nome\}`\}/);
    expect(src).toMatch(/aria-label=\{`Enviar de novo: \$\{d\.nome\}`\}/);
  });

  it('caixa: no celular a edição abre o formulário empilhado num diálogo (mesma rota, sem mês fechado)', () => {
    const src = ler('caixa', 'page.tsx');
    expect(src).toMatch(/editandoId === l\.id && !celular \?/);
    expect(src).toMatch(/\{celular && editandoId && !fechado && \(\s*<Modal/);
    expect(src).toMatch(/<Celulas empilhado campos=\{edicao\}/);
    // Uma só gravação para os dois jeitos de editar.
    expect(src.match(/method: 'PATCH', body: JSON\.stringify\(\{ id: editandoId, \.\.\.edicao \}\)/g)).toHaveLength(1);
  });
});
