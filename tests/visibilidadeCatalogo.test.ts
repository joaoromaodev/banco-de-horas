// Regras puras de visibilidade do catálogo do Livro Caixa por escritório (0013).
import { describe, it, expect } from 'vitest';
import {
  donoDaCriacao, filtrarCatalogo, itemVisivel, proximoCodigo, visaoDoCatalogo,
} from '@/lib/visibilidadeCatalogo';

const EDILSE = '00000000-0000-4000-8000-000000000001';
const BIANCA = 'c007e525-b126-4418-963a-ef57563ae9e6';

const base = { escritorioId: null };
const daEdilse = { escritorioId: EDILSE };
const daBianca = { escritorioId: BIANCA };

describe('visaoDoCatalogo', () => {
  it('master vê tudo', () => {
    expect(visaoDoCatalogo({ role: 'master' })).toEqual({ todos: true });
  });
  it('contador e cliente: base + o próprio escritório', () => {
    expect(visaoDoCatalogo({ role: 'usuario', escritorioId: EDILSE })).toEqual({ todos: false, escritorioId: EDILSE });
    expect(visaoDoCatalogo({ role: 'cliente', escritorioId: EDILSE })).toEqual({ todos: false, escritorioId: EDILSE });
  });
  it('sem escritório falha fechada: só o base', () => {
    expect(visaoDoCatalogo({ role: 'usuario' })).toEqual({ todos: false, escritorioId: null });
    expect(visaoDoCatalogo({ role: 'usuario', escritorioId: '' })).toEqual({ todos: false, escritorioId: null });
  });
});

describe('itemVisivel', () => {
  const edilse = visaoDoCatalogo({ role: 'usuario', escritorioId: EDILSE });
  const bianca = visaoDoCatalogo({ role: 'usuario', escritorioId: BIANCA });
  const semEsc = visaoDoCatalogo({ role: 'usuario' });
  const master = visaoDoCatalogo({ role: 'master' });

  it('o base vale para todos', () => {
    for (const v of [edilse, bianca, semEsc, master]) expect(itemVisivel(v, base)).toBe(true);
    expect(itemVisivel(edilse, {})).toBe(true); // ausente = base
  });
  it('a extensão é só do escritório dono', () => {
    expect(itemVisivel(edilse, daEdilse)).toBe(true);
    expect(itemVisivel(bianca, daEdilse)).toBe(false);
    expect(itemVisivel(edilse, daBianca)).toBe(false);
  });
  it('sem escritório nunca vê extensão', () => {
    expect(itemVisivel(semEsc, daEdilse)).toBe(false);
  });
  it('o master vê as extensões de todos', () => {
    expect(itemVisivel(master, daEdilse)).toBe(true);
    expect(itemVisivel(master, daBianca)).toBe(true);
  });
});

describe('filtrarCatalogo', () => {
  const catalogo = [
    { codigo: '2.02.01', ...base },
    { codigo: '2.03.15', ...daEdilse },
    { codigo: '2.03.15', ...daBianca },
    { codigo: '2.03.99', ...daBianca },
  ];
  it('cada escritório vê o base e as suas, nunca as de outro', () => {
    const edilse = filtrarCatalogo(visaoDoCatalogo({ role: 'usuario', escritorioId: EDILSE }), catalogo);
    expect(edilse).toEqual([catalogo[0], catalogo[1]]);
    const bianca = filtrarCatalogo(visaoDoCatalogo({ role: 'usuario', escritorioId: BIANCA }), catalogo);
    expect(bianca).toEqual([catalogo[0], catalogo[2], catalogo[3]]);
  });
  it('master recebe tudo', () => {
    expect(filtrarCatalogo(visaoDoCatalogo({ role: 'master' }), catalogo)).toHaveLength(4);
  });
});

describe('donoDaCriacao', () => {
  it('contador grava no escritório da sessão', () => {
    expect(donoDaCriacao({ role: 'usuario', escritorioId: EDILSE })).toBe(EDILSE);
  });
  it('master grava no catálogo base (null)', () => {
    expect(donoDaCriacao({ role: 'master' })).toBeNull();
    expect(donoDaCriacao({ role: 'master', escritorioId: EDILSE })).toBeNull();
  });
  it('contador sem escritório e cliente não criam', () => {
    expect(donoDaCriacao({ role: 'usuario' })).toBeUndefined();
    expect(donoDaCriacao({ role: 'cliente', escritorioId: EDILSE })).toBeUndefined();
  });
});

describe('proximoCodigo', () => {
  it('é o maior CC do grupo + 1, mantendo o prefixo N.GG', () => {
    expect(proximoCodigo(['2.03.01', '2.03.02', '2.03.15'])).toBe('2.03.16');
    expect(proximoCodigo(['1.02.05'])).toBe('1.02.06');
  });
  it('não depende da ordem e zera à esquerda', () => {
    expect(proximoCodigo(['2.11.04', '2.11.01'])).toBe('2.11.05');
    expect(proximoCodigo(['2.01.08'])).toBe('2.01.09');
  });
  it('grupo vazio (invisível) não gera código', () => {
    expect(proximoCodigo([])).toBeNull();
  });
});
