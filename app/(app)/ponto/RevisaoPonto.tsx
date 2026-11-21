'use client';

// Revisão inteligente da Folha de Ponto na Timesheet (lib/revisaoPonto.ts).
// Só alerta: os selos e a lista nunca bloqueiam nem alteram o dado — corrigir
// continua sendo abrir a folha e editar o dia.
import { useState } from 'react';
import type { DiaFreq } from '@/lib/tipos';
import type { Achado, NivelAchado, ResultadoRevisaoPonto, ResumoFuncionario } from '@/lib/revisaoPonto';
import { horas } from '@/lib/revisaoPonto';
import { MESES } from '@/lib/calendario';
import { Alternador, Aviso, Botao, Carregando, EstadoVazio, Secao, Selo, seloCls, Tom } from '@/components/ui';

export const TOM_NIVEL: Record<NivelAchado, Tom> = { alto: 'perigo', medio: 'aviso', baixo: 'neutro' };
const NOME_NIVEL: Record<NivelAchado, string> = { alto: 'alto', medio: 'médio', baixo: 'baixo' };

/** O que a rota devolve: a revisão + os dias e o fim do mês anterior de cada funcionário. */
export interface RevisaoDoMes extends ResultadoRevisaoPonto {
  folhas: { funcionario: string; dias: DiaFreq[]; anteriores?: DiaFreq[] }[];
  /** empresa|ano|mês da consulta (só na tela). */
  chave?: string;
}

/** Selo do dia: o achado mais grave (+N); todos os motivos no balão (mouse e teclado). */
export function SeloAchados({ achados }: { achados: Achado[] | undefined }) {
  if (!achados || achados.length === 0) return null;
  const [primeiro, ...resto] = achados; // já vêm do mais grave para o mais leve
  const motivos = achados.map((a) => a.motivo).join(' · ');
  return (
    <span tabIndex={0} role="note" aria-label={`Pede atenção: ${motivos}`} data-dica={motivos}
      className={`${seloCls(TOM_NIVEL[primeiro.nivel])} cursor-help`}>
      {primeiro.rotulo}{resto.length > 0 ? ` +${resto.length}` : ''}
    </span>
  );
}

/** Achados do mês inteiro (sem dia) de um funcionário, em lista. */
export function AchadosDoMes({ achados }: { achados: Achado[] }) {
  if (!achados.length) return null;
  return (
    <ul className="space-y-1">
      {achados.map((a, i) => (
        <li key={`${a.codigo}-${i}`} className="flex items-start gap-2 text-[13px] text-tinta-suave">
          <Selo tom={TOM_NIVEL[a.nivel]} className="shrink-0">{a.rotulo}</Selo>
          <span>{a.motivo}</span>
        </li>
      ))}
    </ul>
  );
}

const dd = (n: number) => String(n).padStart(2, '0');
const VISIVEIS = 4;

function LinhaFuncionario({ f, mes, aberto, onAbrir }: {
  f: ResumoFuncionario; mes: number; aberto: boolean; onAbrir: () => void;
}) {
  const [todos, setTodos] = useState(false);
  const lista = todos ? f.achados : f.achados.slice(0, VISIVEIS);
  const info = [
    f.alemDaJornadaMin > 0 ? `Além da jornada: ${horas(f.alemDaJornadaMin)} em ${f.diasAlemDaJornada} dia(s)` : null,
    f.faltas > 0 ? `${f.faltas} falta(s)` : null,
  ].filter(Boolean).join(' · ');
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-tinta">{f.funcionario}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[13px] text-tinta-suave">
            {f.achados.length === 0
              ? <Selo tom="sucesso">tudo certo</Selo>
              : (
                <>
                  {f.diasAtencao > 0 && <span>{f.diasAtencao} dia(s) pede(m) atenção</span>}
                  {(['alto', 'medio', 'baixo'] as NivelAchado[]).filter((n) => f[n] > 0).map((n) => (
                    <Selo key={n} tom={TOM_NIVEL[n]}>{f[n]} {NOME_NIVEL[n]}</Selo>
                  ))}
                </>
              )}
            {info && <span>{info}</span>}
          </p>
        </div>
        <Botao tamanho="sm" variante={aberto ? 'tonal' : 'secundaria'} onClick={onAbrir}>
          {aberto ? 'Aberta abaixo' : 'Abrir folha'}
        </Botao>
      </div>
      {lista.length > 0 && (
        <ul className="mt-2 space-y-1">
          {lista.map((a, i) => (
            <li key={`${a.codigo}-${a.dia}-${i}`} className="flex items-start gap-2 text-[13px] text-tinta-suave">
              <span className="w-11 shrink-0 font-medium tabular-nums text-tinta">{a.dia ? `${dd(a.dia)}/${dd(mes)}` : 'mês'}</span>
              <Selo tom={TOM_NIVEL[a.nivel]} className="shrink-0">{a.rotulo}</Selo>
              <span>{a.motivo}</span>
            </li>
          ))}
        </ul>
      )}
      {f.achados.length > VISIVEIS && (
        <Botao tamanho="sm" variante="fantasma" className="mt-1" onClick={() => setTodos(!todos)}>
          {todos ? 'Mostrar menos' : `Ver todos os ${f.achados.length}`}
        </Botao>
      )}
    </li>
  );
}

/** Seção "Revisão do mês": todos os funcionários da empresa, do maior risco para o menor. */
export function PainelRevisaoMes({ revisao, carregando, ano, mes, funcionarioAberto, onAbrir }: {
  revisao: RevisaoDoMes | null; carregando: boolean; ano: number; mes: number;
  funcionarioAberto: string; onAbrir: (funcionario: string) => void;
}) {
  const [soAtencao, setSoAtencao] = useState(true);
  const periodo = `${MESES[mes]}/${ano}`;
  const funcs = revisao?.funcionarios ?? [];
  const visiveis = soAtencao ? funcs.filter((f) => f.achados.length > 0) : funcs;
  const r = revisao?.resumo;

  return (
    <Secao titulo="Revisão do mês"
      descricao="Alertas das folhas salvas, do maior risco para o menor. Só alerta: nada é bloqueado nem alterado — para corrigir, abra a folha e edite o dia.">
      {carregando && !revisao && <Carregando />}
      {revisao && funcs.length === 0 && (
        <EstadoVazio moldura={false} titulo="Nenhuma folha salva neste mês"
          descricao={`Quando houver folhas de ${periodo} salvas no banco, a revisão aparece aqui.`} />
      )}
      {revisao && funcs.length > 0 && (
        <div className="space-y-4">
          {revisao.gerais.map((g) => <Aviso key={g.codigo} tom="neutro">{g.motivo}</Aviso>)}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[13px] text-tinta-suave">
            <span role="status">
              {r && r.funcionariosAtencao > 0
                ? `${r.funcionariosAtencao} de ${funcs.length} funcionário(s) com ${r.diasAtencao} dia(s) pedindo atenção em ${periodo}.`
                : `A revisão não viu nada fora do comum em ${periodo}.`}
            </span>
            <Alternador checked={soAtencao} onChange={(e) => setSoAtencao(e.target.checked)}>
              Só os que pedem atenção
            </Alternador>
          </div>
          {visiveis.length > 0 ? (
            <ul className="divide-y divide-borda">
              {visiveis.map((f) => (
                <LinhaFuncionario key={f.funcionario} f={f} mes={mes}
                  aberto={f.funcionario === funcionarioAberto} onAbrir={() => onAbrir(f.funcionario)} />
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-tinta-suave">Ninguém pede atenção. Desligue o filtro para ver todos.</p>
          )}
        </div>
      )}
    </Secao>
  );
}
