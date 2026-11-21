'use client';

// Medição própria no navegador (Sprint 15, frente A). Montado UMA vez no layout
// raiz: nenhuma tela precisa mudar.
//
//  - tempo das chamadas a /api (método, rota, status, ms até a resposta chegar —
//    o tempo que a pessoa sente, rede incluída), por um embrulho único do `fetch`;
//  - LCP, TTFB e INP da carga da tela (`useReportWebVitals`) e as visitas por tela.
//
// Amostra: cada carga de página sorteia se entra (TAXA_AMOSTRA); fora dela só os
// erros (status ≥ 400 ou falha de rede) são enviados. Antes de sair do navegador a
// rota passa por `normalizarRota` (sem query, sem id). O envio é em lote, para
// POST /api/medicao, com `sendBeacon` ao sair da tela; falhar aqui nunca afeta a tela.
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useReportWebVitals } from 'next/web-vitals';
import {
  ehErro, ehRotaDaApi, METODOS_HTTP, normalizarRota, TAXA_AMOSTRA, TELAS_PUBLICAS,
  type ItemMedicao, type MetodoHttp,
} from '@/lib/medicao';

// Mesmo valor de ROTA_ENVIO (lib/medicao.ts); literal aqui para a varredura do proxy enxergar a chamada.
const ROTA_ENVIO = '/api/medicao';
const LOTE = 20;
const ESPERA_MS = 15_000;

let amostrado: boolean | null = null;
let rotaDaCarga = '/';
const fila: ItemMedicao[] = [];
let relogio: ReturnType<typeof setTimeout> | null = null;
let fetchOriginal: typeof fetch | null = null;

const naAmostra = () => (amostrado ??= Math.random() < TAXA_AMOSTRA);
const telaPublica = () => TELAS_PUBLICAS.includes(normalizarRota(location.pathname));

function enviar(saindo = false) {
  if (relogio) { clearTimeout(relogio); relogio = null; }
  if (!fila.length) return;
  const corpo = JSON.stringify({ itens: fila.splice(0, 50) });
  try {
    if (saindo && navigator.sendBeacon?.(ROTA_ENVIO, new Blob([corpo], { type: 'application/json' }))) return;
    void (fetchOriginal ?? fetch)(ROTA_ENVIO, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: corpo, keepalive: true,
    }).catch(() => {});
  } catch { /* medição nunca quebra a tela */ }
  if (fila.length) enviar(saindo);
}

function registrar(item: ItemMedicao) {
  try {
    if (telaPublica()) return; // site público e login: sem sessão, nada a medir
    fila.push(item);
    if (fila.length >= LOTE) enviar();
    else if (!relogio) relogio = setTimeout(() => enviar(), ESPERA_MS);
  } catch { /* idem */ }
}

function registrarApi(caminho: string, metodo: string, status: number, ms: number, erro?: string) {
  const m = METODOS_HTTP.find((x) => x === metodo) as MetodoHttp | undefined;
  const amostra = naAmostra();
  if (!m || (!amostra && !ehErro(status, erro))) return;
  registrar({ tipo: 'api', rota: normalizarRota(caminho), metodo: m, status, ms: Math.round(ms), erro, amostra });
}

/** Embrulha o `fetch` uma vez por janela: mede só as chamadas à própria /api. */
function embrulharFetch() {
  const w = window as typeof window & { __medicaoFetch?: boolean };
  if (w.__medicaoFetch) return;
  w.__medicaoFetch = true;
  const original = window.fetch.bind(window);
  fetchOriginal = original;
  window.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
    let caminho: string | null = null;
    let metodo = 'GET';
    try {
      const bruto = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      const url = new URL(bruto, location.href);
      if (url.origin === location.origin && ehRotaDaApi(url.pathname)) {
        caminho = url.pathname;
        metodo = (init?.method ?? (entrada instanceof Request ? entrada.method : 'GET')).toUpperCase();
      }
    } catch { /* URL estranha: segue sem medir */ }
    if (!caminho) return original(entrada, init);
    const t0 = performance.now();
    try {
      const r = await original(entrada, init);
      registrarApi(caminho, metodo, r.status, performance.now() - t0);
      return r;
    } catch (e) {
      const abortado = e instanceof DOMException && e.name === 'AbortError';
      if (!abortado) registrarApi(caminho, metodo, 0, performance.now() - t0, 'rede');
      throw e;
    }
  };
}

// Referência estável (o hook reporta de novo se a função mudar).
function aoMedirVital(m: { name: string; value: number }) {
  if (!naAmostra()) return;
  if (m.name !== 'LCP' && m.name !== 'TTFB' && m.name !== 'INP') return;
  // Os vitais são da CARGA da tela (o INP fecha ao sair): ficam com a rota em que ela abriu.
  registrar({ tipo: 'pagina', rota: rotaDaCarga, metrica: m.name, ms: Math.round(m.value), amostra: true });
}

export function Medicao() {
  const pathname = usePathname();
  useReportWebVitals(aoMedirVital);

  useEffect(() => {
    rotaDaCarga = normalizarRota(location.pathname);
    embrulharFetch();
    const sair = () => enviar(true);
    const oculta = () => { if (document.visibilityState === 'hidden') setTimeout(sair, 0); };
    window.addEventListener('pagehide', sair);
    document.addEventListener('visibilitychange', oculta);
    return () => {
      window.removeEventListener('pagehide', sair);
      document.removeEventListener('visibilitychange', oculta);
    };
  }, []);

  useEffect(() => {
    if (pathname && naAmostra()) registrar({ tipo: 'pagina', rota: normalizarRota(pathname), metrica: 'VISITA', amostra: true });
  }, [pathname]);

  return null;
}
