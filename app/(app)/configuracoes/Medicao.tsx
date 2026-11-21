'use client';

// "Como o app está respondendo" — seção do master em /configuracoes (Sprint 15,
// frente A). Lê GET /api/config/medicao: a amostra dos últimos 7 dias, sem dado
// pessoal (só rota normalizada, papel e código de erro).
import { useEffect, useState } from 'react';
import { Aviso, Carregando, cx, EstadoVazio, FalhaCarregamento, Secao, Selo, tb } from '@/components/ui';
import { lerJson, mensagemDeCarga } from '@/lib/carga';
import type { ErroFrequente, Lenta, PaginaLenta, VolumeTela } from '@/lib/medicao';

interface Resposta {
  semTabela?: boolean;
  taxa: number;
  dias?: number;
  truncado?: boolean;
  linhas?: number;
  rotasLentas?: Lenta[];
  paginasLentas?: PaginaLenta[];
  erros?: ErroFrequente[];
  volume?: VolumeTela[];
}

const ms = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v >= 1000 ? `${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s` : `${v} ms`);
const ORIGEM_ERRO: Record<ErroFrequente['tipo'], string> = { api: 'Chamada', pagina: 'Tela', erro: 'Servidor' };

function Tabela({ titulo, vazio, cabecas, children }: { titulo: string; vazio: string; cabecas: string[]; children: React.ReactNode[] }) {
  return (
    <div className="mt-5 first:mt-0">
      <h3 className="mb-2 text-[13px] font-semibold text-tinta">{titulo}</h3>
      {children.length === 0 ? <EstadoVazio titulo={vazio} /> : (
        <div className={tb.moldura}>
          <table className={tb.tabela}>
            <thead className={tb.cabeca}>
              <tr>{cabecas.map((c, i) => <th key={c} className={cx(tb.th, i > 0 && 'text-right')}>{c}</th>)}</tr>
            </thead>
            <tbody className={tb.corpo}>{children}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const Rota = ({ metodo, rota }: { metodo?: string; rota: string }) => (
  <span className="break-all font-mono text-[12px] text-tinta">{metodo && <span className="text-tinta-suave">{metodo} </span>}{rota}</span>
);

export function MedicaoApp() {
  const [d, setD] = useState<Resposta | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const buscar = () => lerJson<Resposta>('/api/config/medicao', { cache: 'no-store' })
    .then(setD).catch((e) => setFalha(mensagemDeCarga(e)));
  const carregar = () => { setFalha(null); void buscar(); };
  useEffect(() => { void buscar(); }, []);

  const pct = d ? Math.round(d.taxa * 100) : 25;
  return (
    <Secao titulo="Como o app está respondendo"
      descricao={`Medição feita pelo próprio app nos últimos 7 dias, numa amostra de ${pct}% das visitas (os erros entram sempre). Os tempos são os que a pessoa sente no navegador, com a rede incluída. Nada identifica ninguém: só a rota, o papel e o código do erro.`}>
      {falha ? (
        <FalhaCarregamento titulo="Não foi possível ler a medição." onTentar={carregar}>{falha}</FalhaCarregamento>
      ) : !d ? <Carregando /> : d.semTabela ? (
        <Aviso tom="aviso" titulo="Medição ainda não ligada">
          Falta aplicar a migração 0031 (tabela de medição) no banco. Até lá o app não grava nada e segue funcionando normalmente.
        </Aviso>
      ) : (
        <>
          <p className="mb-4 text-[13px] text-tinta-suave" aria-live="polite">
            {(d.linhas ?? 0) === 0 ? 'Ainda não há medições nos últimos 7 dias.' : `${(d.linhas ?? 0).toLocaleString('pt-BR')} medições lidas.`}
            {d.truncado && ' Volume acima do teto: o resumo usa só as mais recentes.'}
          </p>

          <Tabela titulo="Chamadas mais lentas" vazio="Nenhuma chamada medida ainda" cabecas={['Rota', 'Medições', 'Típico (p50)', 'Lento (p95)']}>
            {(d.rotasLentas ?? []).map((r) => (
              <tr key={`${r.metodo} ${r.rota}`} className={tb.linha}>
                <td className={tb.td}><Rota metodo={r.metodo} rota={r.rota} /></td>
                <td className={cx(tb.td, tb.num)}>{r.n}</td>
                <td className={cx(tb.td, tb.num)}>{ms(r.p50)}</td>
                <td className={cx(tb.td, tb.num, 'font-medium')}>{ms(r.p95)}</td>
              </tr>
            ))}
          </Tabela>

          <Tabela titulo="Telas mais lentas para abrir (maior conteúdo visível, LCP)" vazio="Nenhuma tela medida ainda"
            cabecas={['Tela', 'Medições', 'Típico (p50)', 'Lento (p95)', 'Servidor (TTFB p50)', 'Resposta ao clique (INP p95)']}>
            {(d.paginasLentas ?? []).map((p) => (
              <tr key={p.rota} className={tb.linha}>
                <td className={tb.td}><Rota rota={p.rota} /></td>
                <td className={cx(tb.td, tb.num)}>{p.n}</td>
                <td className={cx(tb.td, tb.num)}>{ms(p.p50)}</td>
                <td className={cx(tb.td, tb.num, 'font-medium')}>{ms(p.p95)}</td>
                <td className={cx(tb.td, tb.num)}>{ms(p.ttfbP50)}</td>
                <td className={cx(tb.td, tb.num)}>{ms(p.inpP95)}</td>
              </tr>
            ))}
          </Tabela>

          <Tabela titulo="Erros mais frequentes" vazio="Nenhum erro nos últimos 7 dias" cabecas={['Onde', 'Código', 'Vezes']}>
            {(d.erros ?? []).map((e) => (
              <tr key={`${e.tipo}|${e.metodo}|${e.rota}|${e.codigo}`} className={tb.linha}>
                <td className={tb.td}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Selo tom={e.tipo === 'erro' || /^5|^rede$/.test(e.codigo) ? 'perigo' : 'aviso'}>{ORIGEM_ERRO[e.tipo]}</Selo>
                    <Rota metodo={e.metodo} rota={e.rota} />
                  </div>
                </td>
                <td className={cx(tb.td, tb.num, 'font-mono text-[12px]')}>{e.codigo === 'rede' ? 'sem rede' : e.codigo}</td>
                <td className={cx(tb.td, tb.num)}>{e.n}</td>
              </tr>
            ))}
          </Tabela>

          <Tabela titulo="Visitas por tela (estimativa)" vazio="Nenhuma visita medida ainda" cabecas={['Tela', 'Visitas']}>
            {(d.volume ?? []).map((v) => (
              <tr key={v.rota} className={tb.linha}>
                <td className={tb.td}><Rota rota={v.rota} /></td>
                <td className={cx(tb.td, tb.num)}>{v.visitas.toLocaleString('pt-BR')}</td>
              </tr>
            ))}
          </Tabela>
        </>
      )}
    </Secao>
  );
}
