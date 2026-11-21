'use client';

// Conferência entre módulos (DP × ponto × contratos × férias): só alerta, com link para
// corrigir. Carrega sozinha — se falhar, só este bloco avisa e a tela segue. Regras em
// lib/conferenciaModulos.ts. Três usos: bloco do /painel (todas as empresas), lista do
// /dp (uma empresa) e ficha do empregado (`empregadoId`).
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ROTULO_FONTE, type AchadoConferencia, type FonteConferencia } from '@/lib/conferenciaModulos';
import { Aviso, Botao, Carregando, Secao, Selo, type Tom } from '@/components/ui';
import { IconeCheck } from './icones';

interface Dados { disponivel?: boolean; achados: AchadoConferencia[]; indisponiveis: FonteConferencia[]; frase: string }

const TOM: Record<AchadoConferencia['nivel'], Tom> = { perigo: 'perigo', aviso: 'aviso', info: 'neutro' };
const LIMITE = 6;

function Lista({ achados, mostrarEmpresa }: { achados: AchadoConferencia[]; mostrarEmpresa: boolean }) {
  return (
    <ul className="divide-y divide-borda">
      {achados.map((a) => (
        <li key={a.chave} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 py-2.5">
          <div className="min-w-0 flex-1 basis-60">
            <p className="text-sm font-medium text-tinta">
              {a.empregado}
              {mostrarEmpresa && a.empresaNome && <span className="font-normal text-tinta-suave"> · {a.empresaNome}</span>}
            </p>
            <p className="mt-0.5 text-[13px] text-tinta-suave">{a.texto}</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Selo tom={TOM[a.nivel]}>{a.titulo}</Selo>
            <Link href={a.href} className="text-[13px] font-medium text-primaria-texto underline">{a.rotuloLink}</Link>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function ConferenciaModulos({ url, empregadoId, mostrarEmpresa = false, titulo = 'Conferência entre módulos' }: {
  /** Endpoint (`/api/painel/conferencia` ou `/api/dp/conferencia?empresa=…`). */
  url: string;
  /** Na ficha: só os achados desse empregado (e some quando não há nenhum). */
  empregadoId?: string;
  mostrarEmpresa?: boolean;
  titulo?: string;
}) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [tudo, setTudo] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const x = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(x.erro || 'Não foi possível conferir os módulos.');
      setDados(x as Dados);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível conferir os módulos.');
    } finally {
      setCarregando(false);
    }
  }, [url]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial (o setState acontece depois do fetch)
  useEffect(() => { carregar(); }, [carregar]);

  if (dados && dados.disponivel === false) return null; // sem o módulo de ponto
  const achados = (dados?.achados ?? []).filter((a) => !empregadoId || a.empregadoId === empregadoId);

  // Na ficha só aparece quando há o que apontar; erro e carga ficam em silêncio (não atrapalham a ficha).
  if (empregadoId) {
    if (!dados || !achados.length) return null;
    return (
      <Aviso tom="aviso" titulo="Não bate com outro módulo">
        <Lista achados={achados} mostrarEmpresa={false} />
      </Aviso>
    );
  }

  const visiveis = tudo ? achados : achados.slice(0, LIMITE);
  return (
    <Secao titulo={titulo} descricao="Cadastro do DP, ponto, contratos de experiência e férias: o que não bate entre eles."
      acoes={dados ? <Selo tom={achados.length ? 'aviso' : 'sucesso'}>{achados.length}</Selo> : undefined}>
      {carregando && !dados && <Carregando>Conferindo os módulos…</Carregando>}
      {erro && (
        <Aviso tom="aviso" titulo="Não foi possível conferir os módulos"
          acao={<Botao variante="secundaria" tamanho="sm" onClick={carregar} disabled={carregando}>Tentar de novo</Botao>}>
          O resto da tela não foi afetado.
        </Aviso>
      )}
      {dados && (
        <>
          <p className="mb-2 text-sm font-medium text-tinta" aria-live="polite">{dados.frase}.</p>
          {dados.indisponiveis.length > 0 && (
            <p className="mb-2 text-[13px] text-tinta-suave">
              Não deu para ler agora: {dados.indisponiveis.map((f) => ROTULO_FONTE[f]).join(', ')}. As conferências que dependem delas ficaram de fora.
            </p>
          )}
          {achados.length === 0 ? (
            dados.indisponiveis.length === 0 && (
              <p className="flex items-center gap-2 text-sm text-tinta-suave">
                <IconeCheck size={16} className="shrink-0 text-sucesso" />Nada para corrigir nos últimos meses.
              </p>
            )
          ) : (
            <Lista achados={visiveis} mostrarEmpresa={mostrarEmpresa} />
          )}
          {achados.length > LIMITE && (
            <div className="mt-3">
              <Botao variante="secundaria" tamanho="sm" onClick={() => setTudo((v) => !v)}>
                {tudo ? 'Mostrar menos' : `Ver as ${achados.length} divergências`}
              </Botao>
            </div>
          )}
        </>
      )}
    </Secao>
  );
}
