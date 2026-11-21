import { describe, it, expect } from 'vitest';
import {
  EPOCA, hrefInterno, montarNotificacoes, notifCaixa, notifConferencia, notifDocumentos, notifEventos, notifPendencias,
  quandoRelativo, rotuloSino, type ItemNotificacao,
} from '@/lib/notificacoes';
import type { AchadoConferencia } from '@/lib/conferenciaModulos';

const AGORA = new Date('2026-11-21T15:00:00.000Z');
const NOMES = new Map([['e1', 'Padaria Sol'], ['e2', 'Oficina Lua']]);

describe('notificações derivadas', () => {
  it('documentos: agrupa por empresa, ignora empresa fora do recorte; a chave leva o envio mais recente', () => {
    const r = notifDocumentos([
      { empresaId: 'e1', enviadoEm: '2026-11-20T10:00:00.000Z' },
      { empresaId: 'e1', enviadoEm: '2026-11-21T09:00:00.000Z' },
      { empresaId: 'e2', enviadoEm: '2026-11-19T09:00:00.000Z' },
      { empresaId: 'outra', enviadoEm: '2026-11-21T09:00:00.000Z' },
    ], NOMES);
    expect(r).toHaveLength(2);
    const e1 = r.find((i) => i.empresa === 'Padaria Sol')!;
    expect(e1.titulo).toBe('2 documentos novos enviados pelo cliente');
    expect(e1.quando).toBe('2026-11-21T09:00:00.000Z');
    expect(e1.chave).toBe('doc|e1|2026-11-21T09:00:00.000Z');
    expect(r.find((i) => i.empresa === 'Oficina Lua')!.titulo).toBe('Documento novo enviado pelo cliente');
  });
  it('pendência atendida: o que o próprio usuário fechou não é novidade', () => {
    const r = notifPendencias([
      { id: 'p1', empresaId: 'e1', titulo: 'Extrato de outubro', atendidaEm: '2026-11-21T10:00:00.000Z', atendidaPor: 'cli@x.com' },
      { id: 'p2', empresaId: 'e1', titulo: 'Notas', atendidaEm: '2026-11-21T10:00:00.000Z', atendidaPor: 'Eu@Esc.com' },
    ], NOMES, 'eu@esc.com');
    expect(r.map((i) => i.texto)).toEqual(['Extrato de outubro']);
  });
  it('caixa: conta por empresa e ignora o que o usuário lançou', () => {
    const r = notifCaixa([
      { empresaId: 'e1', criadoEm: '2026-11-21T08:00:00.000Z', criadoPor: 'cli@x.com' },
      { empresaId: 'e1', criadoEm: '2026-11-21T09:00:00.000Z', criadoPor: 'cli@x.com' },
      { empresaId: 'e1', criadoEm: '2026-11-21T10:00:00.000Z', criadoPor: 'eu@esc.com' },
    ], NOMES, 'eu@esc.com');
    expect(r).toHaveLength(1);
    expect(r[0].titulo).toBe('2 lançamentos novos do cliente');
    expect(r[0].quando).toBe('2026-11-21T09:00:00.000Z');
  });
  it('eventos genéricos: href de fora vira painel; conferência é ignorada aqui; empresa fora do recorte some', () => {
    const base = { texto: null, empresaId: 'e1', criadoEm: '2026-11-21T09:00:00.000Z' };
    const r = notifEventos([
      { ...base, chave: 'folha|1', tipo: 'folha_ponto_cliente', titulo: 'Folha enviada', href: '/ponto?empresa=e1&ano=2026&mes=10' },
      { ...base, chave: 'x', tipo: 'outro', titulo: 'Golpe', href: 'https://mau.example/' },
      { ...base, chave: 'y', tipo: 'outro', titulo: 'Rede', href: '//mau.example/' },
      { ...base, chave: 'conf|a', tipo: 'conferencia', titulo: 'interno', href: null },
      { ...base, chave: 'z', tipo: 'outro', titulo: 'De outro escritório', href: null, empresaId: 'zzz' },
      { ...base, chave: 'g', tipo: 'outro', titulo: 'Geral', href: null, empresaId: null },
    ], NOMES);
    expect(r.map((i) => i.titulo)).toEqual(['Folha enviada', 'Golpe', 'Rede', 'Geral']);
    expect(r[0].href).toBe('/ponto?empresa=e1&ano=2026&mes=10');
    expect(r[1].href).toBe('/painel');
    expect(r[2].href).toBe('/painel');
    expect(hrefInterno(null)).toBe('/painel');
  });
  it('conferência: usa o instante da primeira vista; sem registro, é agora', () => {
    const a = { chave: 'k1', codigo: 'ativo_sem_admissao', nivel: 'aviso', empresaId: 'e1', empresaNome: 'Padaria Sol', empregado: 'ANA', empregadoId: 'x', titulo: 'Sem admissão', texto: 'Preencha.', href: '/dp?empresa=e1', rotuloLink: 'Abrir' } as AchadoConferencia;
    const b = { ...a, chave: 'k2' } as AchadoConferencia;
    const r = notifConferencia([a, b], new Map([['conf|k1', EPOCA]]), '2026-11-21T15:00:00.000Z');
    expect(r[0].quando).toBe(EPOCA);
    expect(r[1].quando).toBe('2026-11-21T15:00:00.000Z');
    expect(r[1].texto).toBe('ANA: Preencha.');
  });
});

const item = (chave: string, quando: string): ItemNotificacao => ({ chave, tipo: 'evento', titulo: chave, href: '/painel', quando });

describe('montagem da lista', () => {
  const itens = [
    item('velho', '2026-11-01T10:00:00.000Z'), // fora da janela de 14 dias
    item('visto', '2026-11-18T10:00:00.000Z'),
    item('novo1', '2026-11-20T10:00:00.000Z'),
    item('novo2', '2026-11-21T10:00:00.000Z'),
    item('seed', EPOCA),
  ];
  it('só a janela, do mais novo ao mais velho; lido = até a última visita', () => {
    const r = montarNotificacoes(itens, { lidasAte: '2026-11-19T00:00:00.000Z', lidas: [] }, AGORA);
    expect(r.itens.map((i) => i.chave)).toEqual(['novo2', 'novo1', 'visto']);
    expect(r.itens.map((i) => i.lida)).toEqual([false, false, true]);
    expect(r.naoLidas).toBe(2);
  });
  it('marcar um como lido não mexe nos outros; "todas" (lidasAte = agora) zera', () => {
    const um = montarNotificacoes(itens, { lidasAte: '2026-11-19T00:00:00.000Z', lidas: ['novo1'] }, AGORA);
    expect(um.naoLidas).toBe(1);
    expect(um.itens.find((i) => i.chave === 'novo1')!.lida).toBe(true);
    const todas = montarNotificacoes(itens, { lidasAte: AGORA.toISOString(), lidas: [] }, AGORA);
    expect(todas.naoLidas).toBe(0);
  });
  it('primeira visita: nada é "não lido" (o sino começa limpo)', () => {
    expect(montarNotificacoes(itens, { lidasAte: null, lidas: [] }, AGORA).naoLidas).toBe(0);
  });
  it('limita a quantidade, mas a contagem de não lidas vale para tudo o que cabe na janela', () => {
    const muitos = Array.from({ length: 40 }, (_, i) => item(`n${i}`, `2026-11-21T${String(i % 10).padStart(2, '0')}:00:00.000Z`));
    const r = montarNotificacoes(muitos, { lidasAte: '2026-11-20T00:00:00.000Z', lidas: [] }, AGORA, 30);
    expect(r.itens).toHaveLength(30);
    expect(r.naoLidas).toBe(40);
  });
  it('rótulos', () => {
    expect(rotuloSino(0)).toBe('Notificações');
    expect(rotuloSino(1)).toBe('1 novidade não lida');
    expect(rotuloSino(3)).toBe('3 novidades não lidas');
    expect(quandoRelativo('2026-11-21T14:59:50.000Z', AGORA)).toBe('agora');
    expect(quandoRelativo('2026-11-21T14:30:00.000Z', AGORA)).toBe('há 30 min');
    expect(quandoRelativo('2026-11-21T10:00:00.000Z', AGORA)).toBe('há 5 h');
    expect(quandoRelativo('2026-11-20T10:00:00.000Z', AGORA)).toBe('ontem');
    expect(quandoRelativo('2026-11-18T10:00:00.000Z', AGORA)).toBe('há 3 dias');
  });
});
