// Regras puras da folha enviada pelo cliente (lib/envioPonto.ts).
import { describe, expect, it } from 'vitest';
import {
  caminhoFoto, fotoValida, LIMITE_FOTO_BYTES, limiteLeiturasAutomaticas, mesAceitoParaEnvio, motivoValido,
  normalizarRascunho, podeAplicar, podeConferirEnvio, podeDevolver, podeExcluirEnvio, podeLer, podeRestaurarEnvio,
  podeVerEnvio, situacaoAoReabrir, situacaoParaCliente, situacaoParaContador, TIPOS_FOTO, validarFoto,
} from '@/lib/envioPonto';
import type { Quem } from '@/lib/visibilidade';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const ID = '11111111-2222-4333-8444-555555555555';

const contadorA: Quem = { email: 'c@a', role: 'usuario', escritorioId: A };
const contadorB: Quem = { email: 'c@b', role: 'usuario', escritorioId: B };
const clienteA1: Quem = { email: 'x@a1', role: 'cliente', escritorioId: A, empresa: 'emp-a1' };
const clienteA2: Quem = { email: 'x@a2', role: 'cliente', escritorioId: A, empresa: 'emp-a2' };
const master: Quem = { email: 'm', role: 'master' };
const envio = { empresaId: 'emp-a1', escritorioId: A, situacao: 'lida' as const };

describe('validarFoto', () => {
  it('aceita foto de câmera com ou sem extensão', () => {
    expect(validarFoto({ nome: 'image.jpg', tamanho: 1000, tipo: 'image/jpeg' }).ok).toBe(true);
    expect(validarFoto({ nome: 'IMG_0001', tamanho: 1000, tipo: 'image/heic' }).ok).toBe(true);
    expect(validarFoto({ nome: 'foto.heif', tamanho: 1000, tipo: '' }).ok).toBe(true);
  });
  it('recusa PDF, SVG, HTML e extensão que contradiz o tipo', () => {
    expect(validarFoto({ nome: 'a.pdf', tamanho: 10, tipo: 'application/pdf' }).ok).toBe(false);
    expect(validarFoto({ nome: 'a.svg', tamanho: 10, tipo: 'image/svg+xml' }).ok).toBe(false);
    expect(validarFoto({ nome: 'a.html', tamanho: 10, tipo: '' }).ok).toBe(false);
    expect(validarFoto({ nome: 'a.png', tamanho: 10, tipo: 'image/jpeg' }).ok).toBe(false);
  });
  it('limite de 8 MB e vazio', () => {
    expect(validarFoto({ nome: 'a.jpg', tamanho: LIMITE_FOTO_BYTES + 1, tipo: 'image/jpeg' }).ok).toBe(false);
    expect(validarFoto({ nome: 'a.jpg', tamanho: 0, tipo: 'image/jpeg' }).ok).toBe(false);
  });
  it('a lista anda junto com o bucket e o CHECK da 0028', () => {
    expect(TIPOS_FOTO.map((t) => t.mime)).toEqual(['image/jpeg', 'image/png', 'image/webp', 'image/heic']);
    expect(LIMITE_FOTO_BYTES).toBe(8388608);
  });
});

describe('fotoValida (bytes)', () => {
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const html = new TextEncoder().encode('<html><script>alert(1)</script>');
  it('reconhece JPG e PNG pela assinatura', () => {
    expect(fotoValida(jpg, 'jpg')).toBe(true);
    expect(fotoValida(png, 'png')).toBe(true);
  });
  it('HTML renomeado para .jpg e PNG declarado como JPG não passam', () => {
    expect(fotoValida(html, 'jpg')).toBe(false);
    expect(fotoValida(png, 'jpg')).toBe(false);
  });
  it('PDF não é foto, mesmo com bytes de PDF', () => {
    expect(fotoValida(new TextEncoder().encode('%PDF-1.7'), 'pdf')).toBe(false);
  });
});

describe('caminhoFoto', () => {
  it('só ids do servidor', () => {
    expect(caminhoFoto(A, ID, 'jpeg')).toBe(`${A}/${ID}.jpg`);
    expect(() => caminhoFoto('../x', ID, 'jpg')).toThrow();
    expect(() => caminhoFoto(A, ID, 'pdf')).toThrow();
  });
});

describe('freios', () => {
  it('teto de leituras automáticas por empresa: 3 por funcionário, entre 10 e 300', () => {
    expect(limiteLeiturasAutomaticas(0)).toBe(10);
    expect(limiteLeiturasAutomaticas(2)).toBe(10);
    expect(limiteLeiturasAutomaticas(9)).toBe(27);
    expect(limiteLeiturasAutomaticas(500)).toBe(300);
    expect(limiteLeiturasAutomaticas(Number.NaN)).toBe(10);
  });
  it('mês aceito: já começou e até 13 meses atrás', () => {
    expect(mesAceitoParaEnvio(2026, 11, '2026-11-21')).toBe(true);
    expect(mesAceitoParaEnvio(2026, 10, '2026-11-21')).toBe(true);
    expect(mesAceitoParaEnvio(2026, 12, '2026-11-21')).toBe(false);
    expect(mesAceitoParaEnvio(2025, 10, '2026-11-21')).toBe(true);
    expect(mesAceitoParaEnvio(2025, 9, '2026-11-21')).toBe(false);
    expect(mesAceitoParaEnvio(2026, 13, '2026-11-21')).toBe(false);
  });
});

describe('normalizarRascunho', () => {
  it('limpa dia inválido, repetido, marcador fora da lista e incerto de dia ou campo inexistente', () => {
    const r = normalizarRascunho({
      dias: [
        { dia: 1, entradaManha: ' 08:00 ', saidaTarde: '12>54', marcador: 'QUALQUER' },
        { dia: 1, entradaManha: '07:00' },
        { dia: 40, entradaManha: '08:00' },
        { dia: 2, marcador: 'FALTA' },
        'lixo',
      ],
      incertos: [{ dia: 1, campo: 'saidaTarde' }, { dia: 9, campo: 'entradaManha' }, { dia: 1, campo: '__proto__' }],
      funcionarioLido: '  MARIA  ',
    });
    expect(r.dias.map((d) => d.dia)).toEqual([1, 2]);
    expect(r.dias[0].entradaManha).toBe('07:00');
    expect(r.dias[1].marcador).toBe('FALTA');
    expect(r.incertos).toEqual([{ dia: 1, campo: 'saidaTarde' }]);
    expect(r.funcionarioLido).toBe('MARIA');
  });
  it('mantém o horário estranho como veio (a revisão aponta)', () => {
    const r = normalizarRascunho({ dias: [{ dia: 3, saidaAlmoco: '12>54' }], incertos: [{ dia: 3, campo: 'saidaAlmoco' }] });
    expect(r.dias[0].saidaAlmoco).toBe('12>54');
    expect(r.incertos).toEqual([{ dia: 3, campo: 'saidaAlmoco' }]);
  });
  it('lixo vira rascunho vazio', () => {
    expect(normalizarRascunho(null)).toEqual({ dias: [], incertos: [], funcionarioLido: null });
  });
});

describe('acesso ao envio', () => {
  it('contadora do escritório vê e confere; a de outro escritório, não', () => {
    expect(podeVerEnvio(contadorA, envio)).toBe(true);
    expect(podeConferirEnvio(contadorA, envio)).toBe(true);
    expect(podeVerEnvio(contadorB, envio)).toBe(false);
    expect(podeConferirEnvio(contadorB, envio)).toBe(false);
  });
  it('cliente vê só a própria empresa e nunca confere', () => {
    expect(podeVerEnvio(clienteA1, envio)).toBe(true);
    expect(podeConferirEnvio(clienteA1, envio)).toBe(false);
    expect(podeVerEnvio(clienteA2, envio)).toBe(false);
  });
  it('registro sem escritório: só o master', () => {
    const sem = { ...envio, escritorioId: null };
    expect(podeVerEnvio(contadorA, sem)).toBe(false);
    expect(podeVerEnvio(master, sem)).toBe(true);
  });
  it('aplicada ou em leitura não se exclui; cliente não desfaz exclusão da contabilidade', () => {
    expect(podeExcluirEnvio(clienteA1, { ...envio, situacao: 'aplicada' })).toBe(false);
    expect(podeExcluirEnvio(clienteA1, { ...envio, situacao: 'lendo' })).toBe(false);
    expect(podeExcluirEnvio(clienteA1, { ...envio, situacao: 'devolvida' })).toBe(true);
    expect(podeExcluirEnvio(clienteA2, envio)).toBe(false);
    expect(podeRestaurarEnvio(clienteA1, { ...envio, excluidoPorGestor: true })).toBe(false);
    expect(podeRestaurarEnvio(contadorA, { ...envio, excluidoPorGestor: true })).toBe(true);
  });
  it('transições', () => {
    expect(podeLer('recebida') && podeLer('falhou')).toBe(true);
    expect(podeLer('lida') || podeLer('aplicada') || podeLer('lendo')).toBe(false);
    expect(podeAplicar('lida') && podeAplicar('falhou') && podeAplicar('recebida')).toBe(true);
    expect(podeAplicar('aplicada') || podeAplicar('devolvida') || podeAplicar('lendo')).toBe(false);
    expect(podeDevolver('aplicada')).toBe(false);
    expect(situacaoAoReabrir({ rascunho: { dias: [] }, tentativas: 1 })).toBe('lida');
    expect(situacaoAoReabrir({ rascunho: null, tentativas: 2 })).toBe('falhou');
    expect(situacaoAoReabrir({ rascunho: null, tentativas: 0 })).toBe('recebida');
  });
});

describe('textos', () => {
  it('o cliente não vê "falhou": vê "Recebida"', () => {
    expect(situacaoParaCliente('falhou').rotulo).toBe('Recebida');
    expect(situacaoParaCliente('aplicada').rotulo).toBe('Conferida');
    expect(situacaoParaCliente('devolvida').tom).toBe('perigo');
  });
  it('a contadora vê o motivo da espera', () => {
    expect(situacaoParaContador('recebida', 'limite_empresa').rotulo).toBe('Aguardando você');
    expect(situacaoParaContador('recebida', 'cota').dica).toMatch(/cota/);
  });
  it('motivo da devolução obrigatório e curto', () => {
    expect(motivoValido('  ')).toBeNull();
    expect(motivoValido('ok')).toBeNull();
    expect(motivoValido('  foto   cortada ')).toBe('foto cortada');
    expect(motivoValido('x'.repeat(900))?.length).toBe(500);
  });
});

// Correções da revisão do escudo (21/11/2026).
describe('revisão do escudo', () => {
  it('teto automático nunca passa de 25% da cota do escritório', async () => {
    const { limiteLeiturasAutomaticas: lim } = await import('@/lib/envioPonto');
    expect(lim(100, 50)).toBe(12); // plano teste
    expect(lim(100, 150)).toBe(37); // essencial
    expect(lim(2, 10000)).toBe(10); // fundador: vale a regra por funcionário
    expect(lim(2, 0)).toBe(10); // cota desconhecida: só a regra por funcionário
  });

  it('cliente não exclui folha já lida (está na conferência da contadora)', async () => {
    const { podeExcluirEnvio: pode } = await import('@/lib/envioPonto');
    const base = { empresaId: 'emp-a1', escritorioId: '00000000-0000-4000-8000-00000000000a' };
    const cli = { email: 'x', role: 'cliente' as const, escritorioId: base.escritorioId, empresa: 'emp-a1' };
    expect(pode(cli, { ...base, situacao: 'lida' })).toBe(false);
    expect(pode(cli, { ...base, situacao: 'recebida' })).toBe(true);
    expect(pode(cli, { ...base, situacao: 'falhou' })).toBe(true);
    expect(pode({ email: 'c', role: 'usuario', escritorioId: base.escritorioId }, { ...base, situacao: 'lida' })).toBe(true);
  });

  it('mesmaFrequencia: ignora dias vazios e ordem; acusa qualquer horário mudado', async () => {
    const { mesmaFrequencia } = await import('@/lib/envioPonto');
    const d = (dia: number, e: string | null, m: null | 'FALTA' = null) =>
      ({ dia, entradaManha: e, saidaAlmoco: null, retornoAlmoco: null, saidaTarde: null, marcador: m });
    expect(mesmaFrequencia([d(2, '08:00'), d(1, '07:00'), d(3, null)], [d(1, '07:00'), d(2, '08:00')])).toBe(true);
    expect(mesmaFrequencia([d(1, '07:00')], [d(1, '07:01')])).toBe(false);
    expect(mesmaFrequencia([d(1, null, 'FALTA')], [])).toBe(false);
    expect(mesmaFrequencia([], [])).toBe(true);
  });
});
