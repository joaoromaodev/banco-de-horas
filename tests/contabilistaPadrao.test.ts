// Contabilista/CRC padrão do Termo de Abertura: vem do escritório (0017) ou fica em
// branco. Nunca o nome de uma pessoa fixo no produto (era o da Edilse para todos).
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { padraoContabilista } from '@/lib/caixa';

describe('padraoContabilista', () => {
  it('escritório novo (sem responsável técnico) recebe em branco', () => {
    expect(padraoContabilista({ contabilista_nome: null, contabilista_crc: null })).toEqual({ contabilista: '', crc: '' });
    expect(padraoContabilista({})).toEqual({ contabilista: '', crc: '' });
  });
  it('empresa sem escritório (ou sem a 0017) recebe em branco', () => {
    expect(padraoContabilista(null)).toEqual({ contabilista: '', crc: '' });
    expect(padraoContabilista(undefined)).toEqual({ contabilista: '', crc: '' });
  });
  it('usa o responsável do próprio escritório', () => {
    expect(padraoContabilista({ contabilista_nome: ' Fulana de Tal ', contabilista_crc: 'PA-123/O-4' }))
      .toEqual({ contabilista: 'Fulana de Tal', crc: 'PA-123/O-4' });
  });
});

describe('nenhum nome de contadora fixo no código do produto', () => {
  const arquivos = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
  it('app/ e lib/ não trazem o nome nem o CRC da Edilse como valor', () => {
    const achados = [...arquivos('app'), ...arquivos('lib')]
      .filter((f) => /Edilse Goes da Costa|01619\/0-3/.test(readFileSync(f, 'utf8')));
    expect(achados).toEqual([]);
  });
});
