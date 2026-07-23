'use client';

// Os dois gráficos do resumo do exercício, em SVG puro (o projeto não tem — nem
// precisa de — biblioteca de gráfico para doze pontos).
//
// São duas figuras separadas de propósito: saldo acumulado e fluxo do mês têm
// ordens de grandeza diferentes, e enfiar os dois num só exigiria dois eixos Y —
// que é justamente a leitura enganosa que se quer evitar. Um eixo por figura.
//
// Cores: verde para entrada, vermelho para saída — a convenção contábil, a mesma
// da tabela de lançamentos. O par passa na checagem de daltonismo (ΔE 8,6 em
// deuteranopia), e ainda assim identidade nunca depende só da cor: as barras têm
// legenda, posição fixa (entrada sempre à esquerda) e a tabela ao lado.
import { useState } from 'react';
import { dinheiro, dinheiroCurto, MESES, MESES_LONGOS } from '../formato';

const ENTRADA = '#059669';
const SAIDA = '#dc2626';
const SALDO = '#4f46e5';
const GRADE = '#e2e8f0';
const EIXO = '#94a3b8';

export interface PontoMes {
  mes: number;
  entradas: number | null;
  saidas: number | null;
  saldoFinal: number | null;
}

const L = 52, R = 12, T = 14, B = 24; // margens do desenho
const W = 720, H = 200;

/** Escala linear com o cuidado de não dividir por zero quando tudo é igual. */
function escala(min: number, max: number, de: number, para: number) {
  const vao = max - min || 1;
  return (v: number) => de + ((v - min) / vao) * (para - de);
}

/** Divisões "redondas" do eixo Y. */
function marcas(min: number, max: number, quantas = 4): number[] {
  const passo = (max - min) / quantas || 1;
  const potencia = 10 ** Math.floor(Math.log10(Math.abs(passo)));
  const arredondado = Math.ceil(passo / potencia) * potencia;
  const inicio = Math.floor(min / arredondado) * arredondado;
  const valores: number[] = [];
  for (let v = inicio; v <= max + arredondado / 2; v += arredondado) valores.push(v);
  return valores;
}

/** Retângulo com a ponta de cima arredondada, ancorado na linha de base. */
function barra(x: number, y: number, largura: number, altura: number): string {
  const r = Math.min(4, largura / 2, Math.max(altura, 0));
  if (altura <= 0) return '';
  return `M${x},${y + altura} v${-(altura - r)} a${r},${r} 0 0 1 ${r},${-r} h${largura - 2 * r} a${r},${r} 0 0 1 ${r},${r} v${altura - r} z`;
}

function Legenda({ itens }: { itens: { cor: string; texto: string }[] }) {
  return (
    <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
      {itens.map((i) => (
        <span key={i.texto} className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.cor }} />
          {i.texto}
        </span>
      ))}
    </div>
  );
}

function Dica({ visivel, x, children }: { visivel: boolean; x: number; children: React.ReactNode }) {
  if (!visivel) return null;
  // Ancora pela fração horizontal para acompanhar o SVG, que é fluido.
  const pct = (x / W) * 100;
  return (
    <div className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs shadow-lg"
      style={{ left: `${pct}%` }}>
      {children}
    </div>
  );
}

// ------------------------------------------------------- evolução do saldo
/** Uma série só: o saldo no fim de cada mês. Sem legenda — o título já a nomeia. */
export function EvolucaoSaldo({ meses, saldoInicial }: { meses: PontoMes[]; saldoInicial: number }) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const pontos = meses.filter((m) => m.saldoFinal !== null) as (PontoMes & { saldoFinal: number })[];

  if (pontos.length === 0) {
    return <VazioGrafico texto="O saldo aparece aqui quando houver mês liberado." />;
  }

  const valores = [saldoInicial, ...pontos.map((p) => p.saldoFinal)];
  const min = Math.min(0, ...valores);
  const max = Math.max(0, ...valores);
  const x = escala(1, 12, L, W - R);
  const y = escala(min, max, H - B, T);

  const caminho = pontos.map((p, i) => `${i ? 'L' : 'M'}${x(p.mes)},${y(p.saldoFinal)}`).join(' ');
  const ultimo = pontos[pontos.length - 1];

  return (
    <figure className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
        aria-label={`Saldo do caixa mês a mês. Termina em ${dinheiro(ultimo.saldoFinal)} em ${MESES_LONGOS[ultimo.mes - 1]}.`}>
        {marcas(min, max).map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v === 0 ? EIXO : GRADE} strokeWidth={1} />
            <text x={L - 8} y={y(v) + 3} textAnchor="end" fontSize={10} fill={EIXO}>{dinheiroCurto(v)}</text>
          </g>
        ))}

        <path d={caminho} fill="none" stroke={SALDO} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {pontos.map((p) => (
          <circle key={p.mes} cx={x(p.mes)} cy={y(p.saldoFinal)} r={ativo === p.mes ? 5.5 : 4}
            fill={p.saldoFinal < 0 ? SAIDA : SALDO} stroke="#fff" strokeWidth={2} />
        ))}

        {/* rótulo direto só no último ponto — número em todo ponto vira poluição */}
        <text x={x(ultimo.mes)} y={y(ultimo.saldoFinal) - 12} textAnchor="end" fontSize={11} fontWeight={600} fill="#334155">
          {dinheiro(ultimo.saldoFinal)}
        </text>

        {MESES.map((rotulo, i) => (
          <text key={rotulo} x={x(i + 1)} y={H - 6} textAnchor="middle" fontSize={10}
            fill={ativo === i + 1 ? '#334155' : EIXO}>{rotulo}</text>
        ))}

        {/* faixas invisíveis: alvo de mouse bem maior que o marcador */}
        {meses.map((m) => (
          <rect key={m.mes} x={x(m.mes) - (W - L - R) / 24} y={0} width={(W - L - R) / 12} height={H}
            fill="transparent" onMouseEnter={() => setAtivo(m.mes)} onMouseLeave={() => setAtivo(null)} />
        ))}
      </svg>

      <Dica visivel={ativo !== null} x={ativo ? x(ativo) : 0}>
        <strong>{ativo ? MESES_LONGOS[ativo - 1] : ''}</strong>
        <span className="ml-2 text-slate-600">
          {(() => {
            const m = meses.find((z) => z.mes === ativo);
            return m?.saldoFinal == null ? 'não liberado' : dinheiro(m.saldoFinal);
          })()}
        </span>
      </Dica>
    </figure>
  );
}

// -------------------------------------------------------- entradas × saídas
export function EntradasSaidas({ meses }: { meses: PontoMes[] }) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const comDados = meses.filter((m) => m.entradas !== null);

  if (comDados.length === 0) {
    return <VazioGrafico texto="O movimento aparece aqui quando houver mês liberado." />;
  }

  const max = Math.max(1, ...comDados.flatMap((m) => [m.entradas ?? 0, m.saidas ?? 0]));
  const y = escala(0, max, H - B, T);
  const faixa = (W - L - R) / 12;
  const larguraBarra = Math.max(4, faixa / 2 - 3); // 2px de respiro entre as duas
  const base = H - B;

  return (
    <figure className="relative">
      <Legenda itens={[{ cor: ENTRADA, texto: 'Entradas' }, { cor: SAIDA, texto: 'Saídas' }]} />
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img"
        aria-label="Entradas e saídas do caixa por mês. Os números estão na tabela abaixo.">
        {marcas(0, max).map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v === 0 ? EIXO : GRADE} strokeWidth={1} />
            <text x={L - 8} y={y(v) + 3} textAnchor="end" fontSize={10} fill={EIXO}>{dinheiroCurto(v)}</text>
          </g>
        ))}

        {meses.map((m) => {
          const centro = L + faixa * (m.mes - 0.5);
          const xEntrada = centro - larguraBarra - 1;
          const xSaida = centro + 1;
          return (
            <g key={m.mes} opacity={ativo === null || ativo === m.mes ? 1 : 0.45}>
              <path d={barra(xEntrada, y(m.entradas ?? 0), larguraBarra, base - y(m.entradas ?? 0))} fill={ENTRADA} />
              <path d={barra(xSaida, y(m.saidas ?? 0), larguraBarra, base - y(m.saidas ?? 0))} fill={SAIDA} />
            </g>
          );
        })}

        {MESES.map((rotulo, i) => (
          <text key={rotulo} x={L + faixa * (i + 0.5)} y={H - 6} textAnchor="middle" fontSize={10}
            fill={ativo === i + 1 ? '#334155' : EIXO}>{rotulo}</text>
        ))}

        {meses.map((m) => (
          <rect key={m.mes} x={L + faixa * (m.mes - 1)} y={0} width={faixa} height={H} fill="transparent"
            onMouseEnter={() => setAtivo(m.mes)} onMouseLeave={() => setAtivo(null)} />
        ))}
      </svg>

      <Dica visivel={ativo !== null} x={L + faixa * ((ativo ?? 1) - 0.5)}>
        {(() => {
          const m = meses.find((z) => z.mes === ativo);
          if (!m) return null;
          if (m.entradas === null) return <><strong>{MESES_LONGOS[m.mes - 1]}</strong> <span className="text-slate-500">não liberado</span></>;
          return (
            <>
              <strong>{MESES_LONGOS[m.mes - 1]}</strong>
              <span className="ml-2" style={{ color: ENTRADA }}>+{dinheiro(m.entradas)}</span>
              <span className="ml-2" style={{ color: SAIDA }}>−{dinheiro(m.saidas ?? 0)}</span>
            </>
          );
        })()}
      </Dica>
    </figure>
  );
}

function VazioGrafico({ texto }: { texto: string }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-slate-200 text-xs text-slate-400">
      {texto}
    </div>
  );
}
