// Lista fechada das rotas do app que a medição aceita (Sprint 15, frente A).
//
// Segunda trava contra dado pessoal: depois de `normalizarRota`, só fica gravada
// a rota que existe de verdade no app; qualquer outra (404, digitada, com algo
// que escapou da normalização) vira `/[outra]` ou `/api/[outra]`.
// `tests/medicao.test.ts` confere que estas listas batem com `app/**/page.tsx` e
// `app/api/**/route.ts` — criou rota ou tela, acrescente aqui (o teste avisa).
import { normalizarRota } from './medicao';

export const ROTAS_API: readonly string[] = [
  '/api/agenda', '/api/agenda/avisos', '/api/agenda/conclusoes', '/api/agenda/modelo', '/api/agenda/proposta',
  '/api/caixa/atividade', '/api/caixa/contas', '/api/caixa/de-para', '/api/caixa/demonstrativo',
  '/api/caixa/demonstrativo/enviar', '/api/caixa/documento-ia', '/api/caixa/documento-leitura', '/api/caixa/exercicio', '/api/caixa/fiscal',
  '/api/caixa/historicos', '/api/caixa/lancamentos', '/api/caixa/limite', '/api/caixa/livro', '/api/caixa/meses',
  '/api/caixa/resumo', '/api/caixa/revisao', '/api/caixa/seed', '/api/caixa/sugestao',
  '/api/cobranca', '/api/cobranca/webhook', '/api/config', '/api/config/ambiente', '/api/config/medicao',
  '/api/contratos', '/api/contratos/alertas', '/api/contratos/documento', '/api/criar-conta', '/api/cron/agenda',
  '/api/documentos', '/api/documentos/arquivo',
  '/api/dp', '/api/dp/conferencia', '/api/dp/documento', '/api/dp/empregado', '/api/dp/ferias', '/api/dp/lote',
  '/api/dp/lote/modelo', '/api/dp/medias',
  '/api/empresas', '/api/envio-ponto', '/api/envio-ponto/aceite', '/api/envio-ponto/foto', '/api/escritorio', '/api/escritorio/responsavel',
  '/api/escritorios', '/api/extrair', '/api/feriados', '/api/folha', '/api/folha-lote', '/api/funcionarios',
  '/api/gerar', '/api/gerar-lote', '/api/inicio-cliente', '/api/login', '/api/logout', '/api/me', '/api/medicao',
  '/api/notificacoes', '/api/painel', '/api/painel/conferencia', '/api/painel/fechamento', '/api/painel/limite',
  '/api/pendencias', '/api/pendencias-recorrentes', '/api/resumo-folha', '/api/resumo-folha/fechamento', '/api/revisao-ponto', '/api/salvar',
  '/api/usuarios',
];

export const PAGINAS: readonly string[] = [
  '/', '/agenda', '/agenda/obrigacoes', '/assinatura', '/cadastros', '/caixa', '/caixa/cadastros',
  '/caixa/demonstrativo', '/caixa/resumo', '/configuracoes', '/contratos', '/documentos', '/dp', '/enviar-ponto',
  '/equipe', '/escritorio', '/fechamento', '/folhas', '/inicio', '/painel', '/ponto', '/ponto-cadastros',
  '/conheca', '/planos', '/privacidade', '/termos', '/criar-conta', '/login',
];

const API = new Set(ROTAS_API);
const TELAS = new Set(PAGINAS);
export const OUTRA_API = '/api/[outra]';
export const OUTRA_TELA = '/[outra]';

/** Rota normalizada e conferida contra a lista fechada. */
export function classificarRota(caminho: string): string {
  const r = normalizarRota(caminho);
  if (r === '/api' || r.startsWith('/api/')) return API.has(r) ? r : OUTRA_API;
  return TELAS.has(r) ? r : OUTRA_TELA;
}

/**
 * Rota a partir do `routePath` do `onRequestError` (caminho do arquivo, ex.:
 * `/app/api/dp/route`, `/(app)/painel/page`): tira `app`, grupos `(x)` e o
 * `route`/`page` do fim, e classifica.
 */
export function rotaDoArquivo(routePath: string): string {
  const segs = String(routePath ?? '').split(/[?#]/, 1)[0].split('/').filter(Boolean);
  if (segs[0] === 'app') segs.shift();
  const limpos = segs.filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@'));
  if (limpos.length && /^(route|page|layout)(\.[a-z]+)?$/.test(limpos[limpos.length - 1])) limpos.pop();
  return classificarRota('/' + limpos.join('/'));
}
