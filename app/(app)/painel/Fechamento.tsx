'use client';

// Checklist de fechamento do mês anterior, por empresa (painel). Carrega sozinho:
// se falhar, só esta seção avisa e o resto do painel segue. Regras em
// lib/fechamento.ts; ver docs/painel.md.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { competenciaBR } from '@/lib/documentos';
import { EmpresaFechamento, ResumoFechamento, ResultadoEtapa, SituacaoEmpresa } from '@/lib/fechamento';
import { Aviso, Botao, Carregando, cx, Secao, Selo, Tom } from '@/components/ui';
import { IconeCheck } from '../icones';

interface Dados { competencia: string; resumo: ResumoFechamento; empresas: EmpresaFechamento[] }

const ROTULO: Record<SituacaoEmpresa, string> = {
  fechada: 'Fechada', aberta: 'Em aberto', incompleta: 'Dados incompletos', sem_etapas: 'Sem etapas',
};
const TOM: Record<SituacaoEmpresa, Tom> = { fechada: 'sucesso', aberta: 'aviso', incompleta: 'neutro', sem_etapas: 'neutro' };
const LIMITE = 8;

function Etapa({ e }: { e: ResultadoEtapa }) {
  const cor = e.estado === 'ok' ? 'text-sucesso' : e.estado === 'falta' ? 'text-aviso' : 'text-tinta-fraca';
  const marca = e.estado === 'ok' ? '✓' : e.estado === 'falta' ? '•' : e.estado === 'na' ? '–' : '?';
  const texto = (
    <>
      <span className={cx('w-3 shrink-0 text-center font-semibold', cor)} aria-hidden="true">{marca}</span>
      <span className="min-w-0">
        <span className="font-medium text-tinta">{e.rotulo}</span>
        <span className="text-tinta-suave"> · {e.detalhe}</span>
      </span>
    </>
  );
  // Só o que falta leva à tela de origem; o resto é leitura.
  return e.estado === 'falta' ? (
    <Link href={e.href} className="flex items-start gap-2 rounded-md py-0.5 text-[13px] hover:underline">{texto}</Link>
  ) : (
    <div className={cx('flex items-start gap-2 py-0.5 text-[13px]', e.estado === 'na' && 'opacity-70')}>{texto}</div>
  );
}

export default function Fechamento() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [tudo, setTudo] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const r = await fetch('/api/painel/fechamento', { cache: 'no-store' });
      const x = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(x.erro || 'Não foi possível carregar o fechamento.');
      setDados(x as Dados);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o fechamento.');
    } finally {
      setCarregando(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial (o setState acontece depois do fetch)
  useEffect(() => { carregar(); }, [carregar]);

  const titulo = dados ? `Fechamento de ${competenciaBR(dados.competencia)}` : 'Fechamento do mês';
  const lista = dados?.empresas.filter((e) => e.situacao !== 'sem_etapas') ?? [];
  const visiveis = tudo ? lista : lista.slice(0, LIMITE);

  return (
    <Secao titulo={titulo} descricao="O mês anterior de cada empresa: caixa, conferência, confirmação, documentos pedidos e obrigações."
      acoes={dados ? <Selo tom={dados.resumo.total > 0 && dados.resumo.fechadas === dados.resumo.total ? 'sucesso' : 'primaria'}>{dados.resumo.fechadas} de {dados.resumo.total}</Selo> : undefined}>
      {carregando && !dados && <Carregando>Conferindo o fechamento…</Carregando>}
      {erro && (
        <Aviso tom="aviso" titulo="Não foi possível carregar o fechamento"
          acao={<Botao variante="secundaria" tamanho="sm" onClick={carregar} disabled={carregando}>Tentar de novo</Botao>}>
          O resto do painel não foi afetado.
        </Aviso>
      )}
      {dados && (
        <>
          <p className="mb-3 text-sm font-medium text-tinta" aria-live="polite">{dados.resumo.frase}.</p>
          {lista.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-tinta-suave">
              <IconeCheck size={16} className="shrink-0 text-sucesso" />Nenhuma empresa com etapas para fechar neste mês.
            </p>
          ) : (
            <ul className="divide-y divide-borda">
              {visiveis.map((emp) => (
                <li key={emp.empresaId} className="py-2.5">
                  <details open={emp.situacao === 'aberta' && emp.faltam > 0 && visiveis.indexOf(emp) < 3}>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 basis-44 truncate text-sm font-medium text-tinta">{emp.nome}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {emp.faltam > 0 && <span className="text-xs text-tinta-suave">{emp.faltam === 1 ? 'falta 1 etapa' : `faltam ${emp.faltam} etapas`}</span>}
                        <Selo tom={TOM[emp.situacao]}>{ROTULO[emp.situacao]}</Selo>
                      </span>
                    </summary>
                    <div className="mt-2 space-y-0.5 pl-1">
                      {emp.etapas.map((e) => <Etapa key={e.chave} e={e} />)}
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
          {lista.length > LIMITE && (
            <div className="mt-3">
              <Botao variante="secundaria" tamanho="sm" onClick={() => setTudo((v) => !v)}>
                {tudo ? 'Mostrar menos' : `Ver todas as ${lista.length} empresas`}
              </Botao>
            </div>
          )}
          <p className="mt-3 text-[13px] text-tinta-suave">
            Documentos pedidos todo mês: <Link href="/fechamento" className="underline">configurar por empresa</Link>.
          </p>
        </>
      )}
    </Secao>
  );
}
