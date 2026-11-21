'use client';

// Entradas × saídas dos últimos meses confirmados — SVG puro, um eixo só. Cores dos
// tokens do design system (grafico-entrada/saida); a legenda e a tabela do
// demonstrativo carregam os mesmos números, então a cor nunca é a única pista.
//
// Desenhado na largura MEDIDA do contêiner (como os gráficos do resumo, ver
// `../resumo/geometria.ts`): antes o viewBox fixo de 640 px escalava para caber e,
// no celular, as letras de 11 unidades viravam ~6 px. Agora eixo e meses saem em
// 12 px de verdade e, se faltar espaço, os meses aparecem um sim, um não.
import { MesDaSerie } from '@/lib/demonstrativo';
import { dinheiro, dinheiroCurto, MESES } from '../formato';
import { geometria, mostraPosicao } from '../resumo/geometria';
import { useLargura } from '../resumo/Graficos';

export default function Grafico({ serie, destaque }: { serie: MesDaSerie[]; destaque: { ano: number; mes: number } }) {
  const [ref, largura] = useLargura();
  // O rótulo pode levar o ano ("jan/26"): pede mais espaço por mês antes de mostrar todos.
  const { W, H, L, R, T, B, fonte, passoMes } = geometria(largura, { meses: Math.max(1, serie.length), minFaixa: 40 });
  if (!serie.length) return null;
  const maximo = Math.max(1, ...serie.flatMap((m) => [m.entradas, m.saidas]));
  const y = (v: number) => T + (1 - v / maximo) * (H - T - B);
  const passo = (W - L - R) / serie.length;
  const larg = Math.max(3, Math.min(18, passo / 2.6));
  const marcas = [0, 0.5, 1].map((f) => f * maximo);
  const ehDestaque = (m: MesDaSerie) => m.ano === destaque.ano && m.mes === destaque.mes;
  // O mês do demonstrativo sempre tem rótulo; os outros alternam se faltar espaço.
  const comRotulo = (m: MesDaSerie, i: number) => ehDestaque(m) || mostraPosicao(i, serie.length, passoMes);
  const primeiroRotulo = serie.findIndex(comRotulo);
  const resumo = serie.map((m) => `${MESES[m.mes - 1]}/${String(m.ano).slice(2)}: entradas ${dinheiro(m.entradas)}, saídas ${dinheiro(m.saidas)}`).join('; ');

  return (
    <figure ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={`Entradas e saídas por mês. ${resumo}`}>
        {marcas.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--color-borda)" strokeWidth={1} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize={fonte} fill="var(--color-tinta-fraca)">{dinheiroCurto(v)}</text>
          </g>
        ))}
        {serie.map((m, i) => {
          const cx0 = L + passo * i + passo / 2;
          const atual = ehDestaque(m);
          // O ano vai em janeiro e no primeiro rótulo que aparece.
          const comAno = m.mes === 1 || i === primeiroRotulo;
          return (
            <g key={`${m.ano}-${m.mes}`}>
              <rect x={cx0 - larg - 1} y={y(m.entradas)} width={larg} height={Math.max(0, H - B - y(m.entradas))} rx={2} fill="var(--color-grafico-entrada)" />
              <rect x={cx0 + 1} y={y(m.saidas)} width={larg} height={Math.max(0, H - B - y(m.saidas))} rx={2} fill="var(--color-grafico-saida)" />
              {comRotulo(m, i) && (
                <text x={cx0} y={H - 8} textAnchor="middle" fontSize={fonte} fontWeight={atual ? 700 : 400}
                  fill={atual ? 'var(--color-tinta)' : 'var(--color-tinta-suave)'}>
                  {MESES[m.mes - 1]}{comAno ? `/${String(m.ano).slice(2)}` : ''}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-tinta-suave">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--color-grafico-entrada)' }} />Entradas (esquerda)</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--color-grafico-saida)' }} />Saídas (direita)</span>
      </figcaption>
    </figure>
  );
}
