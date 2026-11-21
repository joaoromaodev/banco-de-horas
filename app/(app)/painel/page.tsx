'use client';

// Painel do contador — "o que precisa de atenção hoje". Reúne, num só lugar, o
// que está atrasado ou esperando conferência nas outras telas. Cada bloco leva
// à tela de origem; quem falhar (ou ainda esperar migração) aparece sozinho como
// indisponível. Ver docs/painel.md.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { fraseResumo, textoRestante, Bloco, ItemPainel, ResumoPainel } from '@/lib/painel';
import { br } from '@/lib/agenda';
import { lerJson, mensagemDeCarga } from '@/lib/carga';
import {
  Aviso, Botao, botaoCls, CabecalhoPagina, Carregando, Conteudo, cx, EstadoVazio, FalhaCarregamento, Indicador, Secao, Selo, Tom,
} from '@/components/ui';
import { IconeCheck } from '../icones';
import ConferenciaModulos from '../ConferenciaModulos';
import Fechamento from './Fechamento';
import LimiteFaturamento from './LimiteFaturamento';

interface Dados { hoje: string; resumo: ResumoPainel; blocos: Bloco[] }

const TOM: Record<ItemPainel['tom'], Tom> = { perigo: 'perigo', aviso: 'aviso', neutro: 'neutro' };

const VAZIO: Record<Bloco['chave'], string> = {
  agenda: 'Nenhuma obrigação atrasada nem vencendo esta semana.',
  documentos: 'Nenhum documento esperando conferência.',
  pendencias: 'Nenhuma pendência com prazo vencido ou perto de vencer.',
  contratos: 'Nenhum contrato de experiência vencendo.',
  caixa: 'Nenhum lançamento esperando conferência.',
};

function Itens({ bloco }: { bloco: Bloco }) {
  return (
    <ul className="-my-1 divide-y divide-borda">
      {bloco.itens.map((i) => (
        <li key={i.id}>
          <Link href={bloco.href}
            className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg py-2.5 transition-colors hover:bg-superficie-realce sm:-mx-2 sm:px-2">
            <span className="min-w-0 flex-1 basis-44">
              <span className="block truncate text-sm font-medium text-tinta">{i.titulo}</span>
              <span className="block truncate text-[13px] text-tinta-suave">
                {i.empresa}{i.detalhe ? ` · ${i.detalhe}` : ''}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {i.quando && bloco.chave !== 'caixa' && bloco.chave !== 'documentos' && (
                <span className="text-xs tabular-nums text-tinta-fraca">{br(i.quando)}</span>
              )}
              <Selo tom={TOM[i.tom]}>{i.rotuloPrazo}</Selo>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function CartaoBloco({ bloco }: { bloco: Bloco }) {
  const indisponivel = bloco.estado !== 'ok';
  const contagem = bloco.chave === 'documentos' || bloco.chave === 'caixa' ? bloco.conferir : bloco.total;
  return (
    <Secao titulo={bloco.titulo}
      acoes={indisponivel ? <Selo>Indisponível</Selo> : (
        <>
          {bloco.atrasados > 0 && <Selo tom="perigo">{bloco.atrasados} {bloco.atrasados === 1 ? 'atrasado' : 'atrasados'}</Selo>}
          <Selo tom={contagem > 0 ? 'primaria' : 'neutro'}>{contagem}{bloco.truncado ? '+' : ''}</Selo>
        </>
      )}>
      {bloco.estado === 'migracao' && (
        <Aviso tom="info" titulo="Ainda não instalado">
          Esta parte do painel passa a aparecer assim que o banco for atualizado. O resto continua funcionando.
        </Aviso>
      )}
      {bloco.estado === 'erro' && (
        <Aviso tom="aviso" titulo="Não foi possível carregar este bloco">
          Tente atualizar em instantes. Os outros blocos não foram afetados.
        </Aviso>
      )}
      {!indisponivel && bloco.itens.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-tinta-suave">
          <IconeCheck size={16} className="shrink-0 text-sucesso" />{VAZIO[bloco.chave]}
        </p>
      )}
      {!indisponivel && bloco.itens.length > 0 && (
        <>
          <Itens bloco={bloco} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] text-tinta-suave">
              {textoRestante(bloco)}
            </span>
            <Link href={bloco.href} className={botaoCls({ variante: 'secundaria', tamanho: 'sm' })}>Abrir tela</Link>
          </div>
        </>
      )}
    </Secao>
  );
}

export default function PainelPage() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      setDados(await lerJson<Dados>('/api/painel', { cache: 'no-store' }));
    } catch (e) {
      setErro(mensagemDeCarga(e));
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const r = dados?.resumo;
  return (
    <>
      <CabecalhoPagina titulo="Painel"
        subtitulo={dados ? `O que precisa de atenção hoje · ${br(dados.hoje)}` : 'O que precisa de atenção hoje'}
        acoes={<Botao variante="secundaria" tamanho="sm" onClick={carregar} disabled={carregando}>Atualizar</Botao>} />
      <Conteudo largura="media">
        {erro && <FalhaCarregamento titulo="Não foi possível carregar o painel." onTentar={carregar} tentando={carregando}>{erro}</FalhaCarregamento>}
        {!dados && carregando && <Carregando>Juntando o que precisa de atenção…</Carregando>}

        {dados && r && (
          <>
            {r.tudoEmDia ? (
              <EstadoVazio icone={<IconeCheck size={28} className="text-sucesso" />}
                titulo="Tudo em dia por aqui"
                descricao="Nada atrasado, nada esperando conferência. Aproveite para tomar um café — o painel avisa quando algo aparecer." />
            ) : (
              <>
                <p className={cx('text-base font-medium', r.atrasadas ? 'text-perigo' : 'text-tinta')} aria-live="polite">
                  {fraseResumo(r)}.
                </p>
                {/* Três números curtos: lado a lado também no celular (antes, um por linha). */}
                <div className="grid grid-cols-3 gap-2 sm:gap-3">
                  <Indicador rotulo="Atrasadas" valor={r.atrasadas} tom={r.atrasadas ? 'perigo' : 'neutro'} destaque={r.atrasadas > 0} />
                  <Indicador rotulo="Esta semana" valor={r.semana} />
                  <Indicador rotulo="Para conferir" valor={r.conferir} />
                </div>
              </>
            )}
            {r.incompleto && (
              <Aviso tom="info">Alguns blocos estão indisponíveis agora, então o resumo pode estar incompleto.</Aviso>
            )}
            <Fechamento />
            <LimiteFaturamento />
            <ConferenciaModulos url="/api/painel/conferencia" mostrarEmpresa />
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {dados.blocos.map((b) => <CartaoBloco key={b.chave} bloco={b} />)}
            </div>
          </>
        )}
      </Conteudo>
    </>
  );
}
