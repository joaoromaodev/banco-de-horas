// Mensagens de erro ligadas ao campo nos formulários do cliente (Sprint 16, frente A):
// lançar no caixa, enviar documentos e enviar a folha de ponto.
import { describe, expect, it } from 'vitest';
import { campoDoErro } from '@/app/(app)/caixa/formato';
import { conferirEnvioDocumentos } from '@/lib/documentos';
import { conferirEnvioFolha } from '@/lib/envioPonto';

describe('campoDoErro (Livro Caixa)', () => {
  it('as mensagens de validarLancamento caem no campo certo', () => {
    expect(campoDoErro('Informe a data no formato AAAA-MM-DD.')).toBe('data');
    expect(campoDoErro('A data tem que ser do exercício de 2026.')).toBe('data');
    expect(campoDoErro('Informe a conta analítica.')).toBe('analitica');
    expect(campoDoErro('Conta analítica não encontrada no catálogo.')).toBe('analitica');
    expect(campoDoErro('Conta titular não encontrada no catálogo.')).toBe('titular');
    expect(campoDoErro('Valor inválido.')).toBe('valor');
    expect(campoDoErro('O valor não pode ser negativo.')).toBe('valor');
    expect(campoDoErro('O lançamento é entrada ou saída, não os dois.')).toBe('valor');
    expect(campoDoErro('Informe o valor da entrada ou da saída.')).toBe('valor');
  });

  it('o atalho de cheque fala da saída', () => {
    expect(campoDoErro('O atalho de cheque vale para pagamento (saída).')).toBe('saida');
  });

  it('erro que não é de campo fica só no aviso', () => {
    expect(campoDoErro('Falha na operação.')).toBeNull();
    expect(campoDoErro('O documento anexado não é desta empresa (ou foi excluído).')).toBeNull();
    expect(campoDoErro('Sem permissão para esta empresa.')).toBeNull();
    expect(campoDoErro('lancamentos: connection refused')).toBeNull();
    expect(campoDoErro('')).toBeNull();
    expect(campoDoErro(null)).toBeNull();
  });

  it('não confunde "atualizada" ou "validade" com o campo de data', () => {
    expect(campoDoErro('A empresa foi atualizada; recarregue.')).toBeNull();
  });
});

describe('conferirEnvioFolha (enviar ponto)', () => {
  it('tudo certo: nenhum erro', () => {
    expect(conferirEnvioFolha({ funcionario: 'Maria', fotosProntas: 1 })).toEqual({});
  });
  it('aponta os dois campos de uma vez', () => {
    const e = conferirEnvioFolha({ funcionario: '  ', fotosProntas: 0 });
    expect(Object.keys(e).sort()).toEqual(['fotos', 'funcionario']);
    expect(e.funcionario).toMatch(/folha/);
    expect(e.fotos).toMatch(/foto/);
  });
  it('só o que falta', () => {
    expect(Object.keys(conferirEnvioFolha({ funcionario: '', fotosProntas: 2 }))).toEqual(['funcionario']);
    expect(Object.keys(conferirEnvioFolha({ funcionario: 'João', fotosProntas: 0 }))).toEqual(['fotos']);
  });
});

describe('conferirEnvioDocumentos (documentos)', () => {
  it('tudo certo: nenhum erro', () => {
    expect(conferirEnvioDocumentos({ categoria: 'nota', arquivosProntos: 3 })).toEqual({});
  });
  it('sem tipo e sem arquivo: os dois campos', () => {
    expect(Object.keys(conferirEnvioDocumentos({ categoria: '', arquivosProntos: 0 })).sort()).toEqual(['arquivos', 'categoria']);
  });
  it('só o que falta', () => {
    expect(Object.keys(conferirEnvioDocumentos({ categoria: '', arquivosProntos: 1 }))).toEqual(['categoria']);
    expect(Object.keys(conferirEnvioDocumentos({ categoria: 'extrato', arquivosProntos: 0 }))).toEqual(['arquivos']);
  });
});
