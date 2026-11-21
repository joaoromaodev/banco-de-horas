'use client';

// Entradas × saídas dos últimos meses confirmados — SVG puro, um eixo só. Cores dos
// tokens do design system (grafico-entrada/saida); a legenda e a tabela do
// demonstrativo carregam os mesmos números, então a cor nunca é a única pista.
import { MesDaSerie } from '@/lib/demonstrativo';
import { dinheiro, dinheiroCurto, MESES } from '../formato';

const W = 640, H = 190, L = 48, R = 8, T = 12, B = 26;

export default function Grafico({ serie, destaque }: { serie: MesDaSerie[]; destaque: { ano: number; mes: number } }) {
  if (!serie.length) return null;
  const maximo = Math.max(1, ...serie.flatMap((m) => [m.entradas, m.saidas]));
  const y = (v: number) => T + (1 - v / maximo) * (H - T - B);
  const passo = (W - L - R) / serie.length;
  const larg = Math.min(18, passo / 2.6);
  const marcas = [0, 0.5, 1].map((f) => f * maximo);
  const resumo = serie.map((m) => `${MESES[m.mes - 1]}/${String(m.ano).slice(2)}: entradas ${dinheiro(m.entradas)}, saídas ${dinheiro(m.saidas)}`).join('; ');

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Entradas e saídas por mês. ${resumo}`}>
        {marcas.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--color-borda)" strokeWidth={1} />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--color-tinta-fraca)">{dinheiroCurto(v)}</text>
          </g>
        ))}
        {serie.map((m, i) => {
          const cx0 = L + passo * i + passo / 2;
          const atual = m.ano === destaque.ano && m.mes === destaque.mes;
          return (
            <g key={`${m.ano}-${m.mes}`}>
              <rect x={cx0 - larg - 1} y={y(m.entradas)} width={larg} height={Math.max(0, H - B - y(m.entradas))} rx={2} fill="var(--color-grafico-entrada)" />
              <rect x={cx0 + 1} y={y(m.saidas)} width={larg} height={Math.max(0, H - B - y(m.saidas))} rx={2} fill="var(--color-grafico-saida)" />
              <text x={cx0} y={H - 8} textAnchor="middle" fontSize={11} fontWeight={atual ? 700 : 400}
                fill={atual ? 'var(--color-tinta)' : 'var(--color-tinta-suave)'}>
                {MESES[m.mes - 1]}{m.mes === 1 || i === 0 ? `/${String(m.ano).slice(2)}` : ''}
              </text>
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
