// Sugestão de conta do Livro Caixa (lib/sugestaoConta.ts) — regra pura, sem banco nem IA.
import { describe, it, expect } from 'vitest';
import {
  AnaliticaSugerivel, chavePagador, compactarExemplos, complementoParaIa, ContaSugerivel, exemploDe,
  interpretarRespostaIa, LancamentoParaExemplo, montarPromptIa, normalizarTexto, opcoesParaIa,
  sugerirConta, sugestaoAceita, tokenizar,
} from '@/lib/sugestaoConta';

const contas: ContaSugerivel[] = [
  { id: 'c-atend', codigo: '1.02.05', nome: 'Receita de Atendimento', natureza: 'receita', daEmpresa: true },
  { id: 'c-luz', codigo: '2.02.02', nome: 'Energia Elétrica', natureza: 'despesa', daEmpresa: true },
  { id: 'c-exp', codigo: '2.02.06', nome: 'Material de Expediente', natureza: 'despesa', daEmpresa: true },
  { id: 'c-pj', codigo: '2.06.02', nome: 'Serviços Prestados por PJ', natureza: 'despesa', daEmpresa: true },
  { id: 'c-tel', codigo: '2.03.14', nome: 'Telefone', natureza: 'despesa', daEmpresa: false },
];
const analiticas: AnaliticaSugerivel[] = [
  { id: 'h-atend', texto: 'Recebido Atendimento', contaId: 'c-atend', natureza: 'receita', daEmpresa: true },
  { id: 'h-luz', texto: 'Pago conta de luz', contaId: 'c-luz', natureza: 'despesa', daEmpresa: true },
  { id: 'h-exp', texto: 'Pago material de expediente', contaId: 'c-exp', natureza: 'despesa', daEmpresa: true },
  { id: 'h-prot', texto: 'Prótese', contaId: 'c-pj', natureza: 'despesa', daEmpresa: true },
];

const l = (historico: string, contaId: string | null, complemento: string, v: number, extra: Partial<LancamentoParaExemplo> = {}): LancamentoParaExemplo => ({
  historico, contaId, complemento, entrada: 0, saida: v, ...extra,
});
// Um "livro" pequeno no formato do NÉLIO.
const conferidos = [
  l('Pago conta de luz', 'c-luz', 'REF 03/2026', 648.29), l('Pago conta de luz', 'c-luz', 'REF 05/2026', 725.24),
  l('Pago conta de luz', 'c-luz', 'REF 07/2026', 901.9), l('Pago conta de luz', 'c-luz', '04/2026', 927.12),
  l('Prótese', 'c-pj', 'NF 608', 12463), l('Prótese', 'c-pj', 'NF 1123', 7070), l('Prótese', 'c-pj', 'NF 1590', 6167),
  l('Prótese', 'c-pj', 'NF 1741', 8454), l('Prótese', 'c-pj', 'NF 1304', 4687),
  l('Pago material de expediente', 'c-exp', 'NF 33406', 1200), l('Pago material de expediente', 'c-exp', 'NF 40490', 113.8),
  l('Pago material de expediente', 'c-exp', 'NF 40574', 864), l('Pago material de expediente', 'c-exp', 'NF 41896', 153),
  l('Recebido Atendimento', 'c-atend', '', 0, { entrada: 800, pagadorNome: 'Maria', pagadorDocumento: '52998224725' }),
  l('Recebido Atendimento', 'c-atend', '', 0, { entrada: 600, pagadorNome: 'João', pagadorDocumento: '11144477735' }),
  l('Recebido Atendimento', 'c-atend', '', 0, { entrada: 1500, pagadorNome: 'Ana' }),
].map(exemploDe);
const base = { exemplos: compactarExemplos(conferidos), contas, analiticas };

describe('texto', () => {
  it('normaliza acento e caixa', () => {
    expect(normalizarTexto('  PRÓTESE  Dentária ')).toBe('protese dentaria');
  });
  it('números viram formas: NF 1590 e NF 1741 dão os mesmos tokens', () => {
    expect(tokenizar('NF 1590')).toEqual(['nf', '#num']);
    expect(tokenizar('NF 1741')).toEqual(tokenizar('NF 1590'));
    expect(tokenizar('REF 07/2026')).toEqual(['ref', '#data']);
    expect(tokenizar('Pago a conta de luz')).toEqual(['pago', 'conta', 'luz']);
  });
  it('chave do pagador é opaca e estável; CPF vence o nome', () => {
    const a = chavePagador('Maria da Silva', '529.982.247-25');
    expect(a).toBe(chavePagador('Outro nome', '52998224725'));
    expect(a).not.toContain('52998224725');
    expect(chavePagador('MARIA da silva', null)).toBe(chavePagador('maria DA SILVA', ''));
    expect(chavePagador('', '')).toBeNull();
  });
  it('exemplo usa a saída efetiva (com juros e multa) e não guarda o nome', () => {
    const e = exemploDe(l('Pago conta de luz', 'c-luz', 'REF', 100, { juros: 5, multa: 2, pagadorNome: 'Fulano' }));
    expect(e).toMatchObject({ direcao: 'saida', valor: 107 });
    expect(JSON.stringify(e)).not.toContain('Fulano');
  });
  it('compacta exemplos iguais com peso', () => {
    const ex = compactarExemplos([...Array(5)].map(() => exemploDe(l('Prótese', 'c-pj', 'NF 1', 1000))));
    expect(ex).toHaveLength(1);
    expect(ex[0].peso).toBe(5);
  });
});

describe('sugerirConta', () => {
  it('(a) o complemento cita a analítica', () => {
    const r = sugerirConta({ complemento: 'luz de agosto', direcao: 'saida', valor: 700 }, base);
    expect(r.sugestao).toMatchObject({ contaId: 'c-luz', historico: 'Pago conta de luz', historicoId: 'h-luz', origem: 'analitica' });
    expect(r.sugestao!.motivo).toContain('luz');
  });
  it('(a) casa plural/prefixo ("proteses")', () => {
    expect(sugerirConta({ complemento: 'proteses do mes', direcao: 'saida', valor: null }, base).sugestao?.historico).toBe('Prótese');
  });
  it('(a) respeita a natureza: receita não serve para saída', () => {
    const r = sugerirConta({ complemento: 'atendimento', direcao: 'saida', valor: 50 }, base);
    expect(r.sugestao?.origem).not.toBe('analitica');
  });
  it('(b) pelo histórico: "REF 08/2026" de ~700 é conta de luz, com o porquê', () => {
    const r = sugerirConta({ complemento: 'REF 08/2026', direcao: 'saida', valor: 684.43 }, base);
    expect(r.sugestao).toMatchObject({ contaId: 'c-luz', origem: 'historico', historicoId: 'h-luz' });
    expect(r.sugestao!.motivo).toMatch(/como em \d+ lançamentos? conferidos? de "Pago conta de luz"/);
    expect(r.sugestao!.apoio).toBeGreaterThan(0);
  });
  it('(b) o valor separa NF grande (prótese) de NF pequena (expediente)', () => {
    expect(sugerirConta({ complemento: 'NF 2000', direcao: 'saida', valor: 7000 }, base).sugestao?.historico).toBe('Prótese');
    expect(sugerirConta({ complemento: 'NF 2001', direcao: 'saida', valor: 140 }, base).sugestao?.historico).toBe('Pago material de expediente');
  });
  it('(b) entrada com pagador cai em atendimento', () => {
    const r = sugerirConta({ complemento: '', direcao: 'entrada', valor: 700, pagadorNome: 'Nova Paciente' }, base);
    expect(r.sugestao).toMatchObject({ contaId: 'c-atend', historico: 'Recebido Atendimento' });
  });
  it('nunca sugere conta fora da lista visível', () => {
    const r = sugerirConta({ complemento: 'REF 08/2026', direcao: 'saida', valor: 700 },
      { ...base, contas: contas.filter((c) => c.id !== 'c-luz'), analiticas: [] });
    expect(r.sugestao?.contaId).not.toBe('c-luz');
    for (const a of r.alternativas) expect(a.contaId).not.toBe('c-luz');
  });
  it('sem nada digitado não sugere nem pede IA', () => {
    expect(sugerirConta({ complemento: '', direcao: 'saida', valor: null }, base)).toEqual({ sugestao: null, alternativas: [], precisaIa: false });
  });
  it('sem histórico e texto desconhecido: pede a IA', () => {
    const r = sugerirConta({ complemento: 'conserto da cadeira', direcao: 'saida', valor: 300 }, { ...base, exemplos: [] });
    expect(r.sugestao).toBeNull();
    expect(r.precisaIa).toBe(true);
  });
  it('aceita = mesma conta + analítica (sem diferença de caixa/acento)', () => {
    expect(sugestaoAceita({ contaId: 'c-pj', historico: 'Prótese' }, { contaId: 'c-pj', historico: 'protese' })).toBe(true);
    expect(sugestaoAceita({ contaId: 'c-pj', historico: 'Prótese' }, { contaId: 'c-exp', historico: 'Prótese' })).toBe(false);
  });
});

describe('IA: só escolhe entre as contas da empresa', () => {
  it('opções = analíticas da empresa, na natureza da direção', () => {
    const o = opcoesParaIa('saida', contas, analiticas);
    expect(o.map((x) => x.historicoId)).toEqual(['h-luz', 'h-exp', 'h-prot']);
    expect(o[0].rotulo).toBe('2.02.02 Energia Elétrica › Pago conta de luz');
  });
  it('sem analítica da empresa, cai nas titulares da empresa (nunca no catálogo todo)', () => {
    const o = opcoesParaIa('saida', contas, []);
    expect(o.map((x) => x.contaId)).toEqual(['c-luz', 'c-exp', 'c-pj']); // c-tel não é da empresa
  });
  it('o complemento vai sem números de documento nem e-mail; o pagador não vai', () => {
    expect(complementoParaIa('Paciente CPF 529.982.247-25 fulano@x.com NF 12')).toBe('Paciente CPF [número] [e-mail] NF 12');
    const p = montarPromptIa({ complemento: 'NF 1590', direcao: 'saida', valor: 6167 }, opcoesParaIa('saida', contas, analiticas));
    expect(p).toContain('0. 2.02.02 Energia Elétrica › Pago conta de luz');
    expect(p).toContain('R$ 6167.00');
  });
  it('resposta: índice válido vira sugestão com teto de confiança; fora da lista ou torta vira null', () => {
    const o = opcoesParaIa('saida', contas, analiticas);
    expect(interpretarRespostaIa('{"indice":2,"confianca":0.95}', o)).toMatchObject({ historicoId: 'h-prot', origem: 'ia', confianca: 0.6 });
    expect(interpretarRespostaIa('{"indice":9,"confianca":1}', o)).toBeNull();
    expect(interpretarRespostaIa('{"indice":null}', o)).toBeNull();
    expect(interpretarRespostaIa('{"indice":-1}', o)).toBeNull();
    expect(interpretarRespostaIa('não é json', o)).toBeNull();
  });
});

describe('não conferidos: entram com freio', () => {
  const nao = (v: number, n: string) => exemploDe({ ...l('Prótese', 'c-pj', `NF ${n}`, v), conferido: false });
  it('sugere com o rótulo "como você lançou antes" e confiança no máximo 0,6', () => {
    const r = sugerirConta({ complemento: 'NF 9', direcao: 'saida', valor: 6000 },
      { contas, analiticas, exemplos: compactarExemplos([1, 2, 3, 4, 5, 6, 7, 8].map((i) => nao(5000 + i * 300, String(i)))) });
    expect(r.sugestao?.historico).toBe('Prótese');
    expect(r.sugestao!.motivo).toMatch(/como você lançou antes .*ainda não conferidos/);
    expect(r.sugestao!.confianca).toBeLessThanOrEqual(0.6);
  });
  it('um conferido vale mais que vários não conferidos', () => {
    const conf = [1, 2, 3].map((i) => exemploDe(l('Pago material de expediente', 'c-exp', `NF ${i}`, 5000)));
    const r = sugerirConta({ complemento: 'NF 9', direcao: 'saida', valor: 5000 },
      { contas, analiticas, exemplos: compactarExemplos([...conf, ...[4, 5, 6, 7, 8, 9].map((i) => nao(5000, String(i)))]) });
    expect(r.sugestao?.historico).toBe('Pago material de expediente');
    expect(r.sugestao!.motivo).toContain('3 lançamentos conferidos');
  });
  it('não conferido com natureza trocada (receita como saída) não ensina', () => {
    const errado = exemploDe({ ...l('Recebido Atendimento', 'c-atend', 'NF 1', 700), conferido: false });
    const r = sugerirConta({ complemento: 'NF 2', direcao: 'saida', valor: 700 }, { contas, analiticas, exemplos: [errado, errado, errado] });
    expect(r.sugestao?.contaId).not.toBe('c-atend');
  });
});

describe('IA desligada por padrão (escudo)', () => {
  it('só com CAIXA_IA_SUGESTAO=ligada, chave do Gemini e empresa que não identifica pagador', async () => {
    const { iaPermitida } = await import('@/lib/caixaInteligente');
    const env = { CAIXA_IA_SUGESTAO: 'ligada', GEMINI_API_KEY: 'x' } as unknown as NodeJS.ProcessEnv;
    expect(iaPermitida({ identificaPagador: false }, env)).toBe(true);
    expect(iaPermitida({ identificaPagador: true }, env)).toBe(false); // clínica: dado de saúde
    expect(iaPermitida({ identificaPagador: false }, { ...env, CAIXA_IA_SUGESTAO: '' })).toBe(false);
    expect(iaPermitida({ identificaPagador: false }, { ...env, GEMINI_API_KEY: '' })).toBe(false);
    expect(iaPermitida(null, env)).toBe(false);
  });
  it('sugestão "ia" sem o id da chamada não é aceita como registro válido de IA', async () => {
    const { lerRegistroSugestao } = await import('@/lib/caixaInteligente');
    expect(lerRegistroSugestao({ origem: 'ia', historico: 'X', contaId: null })).toMatchObject({ origem: 'ia', id: null });
    expect(lerRegistroSugestao({ origem: 'outra', historico: 'X' })).toBeNull();
    expect(lerRegistroSugestao({ origem: 'historico', historico: 'X', contaId: 'não-uuid' })).toBeNull();
  });
});
