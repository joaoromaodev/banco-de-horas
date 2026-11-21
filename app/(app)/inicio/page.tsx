'use client';

// Início do cliente (empresa): só o que pede ação dele. Ver docs/portal-cliente.md.
// As regras de montagem estão em lib/inicioCliente.ts e a rota é /api/inicio-cliente
// (sempre da empresa da própria sessão). Cada bloco leva à tela certa em um clique.
import { useCallback, useEffect, useState } from 'react';
import { saudacaoDaHora, type Bloco, type InicioCliente } from '@/lib/inicioCliente';
import { Aviso, botaoCls, CabecalhoPagina, Carregando, Conteudo, EstadoVazio, FalhaCarregamento, Secao, Selo } from '@/components/ui';
import { lerJson } from '@/lib/carga';
import { IconeConfirmar } from '../icones';

const ROTULO_FONTE: Record<Bloco['id'], string> = {
  movimento: 'o movimento do caixa',
  pendencias: 'os pedidos da contabilidade',
  folhas: 'as folhas de ponto',
  demonstrativo: 'o Demonstrativo de caixa',
};

const horaBelem = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Belem', hour: '2-digit', hour12: false }).format(new Date())) % 24;

export default function InicioCliente() {
  const [dados, setDados] = useState<InicioCliente | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [hora, setHora] = useState<number | null>(null);

  const [tentando, setTentando] = useState(false);
  const carregar = useCallback(() => {
    setTentando(true);
    lerJson<InicioCliente>('/api/inicio-cliente')
      .then((d) => { setDados(d); setFalhou(false); })
      .catch(() => setFalhou(true))
      .finally(() => setTentando(false));
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hora do relógio do navegador, após hidratar (no useState inicial divergiria do HTML do servidor)
    setHora(horaBelem());
    carregar();
  }, [carregar]);

  const saudacao = dados ? `${hora === null ? 'Olá' : saudacaoDaHora(hora)}, ${dados.saudacao.replace(/^Olá,?\s*/, '') || 'tudo bem?'}` : 'Início';
  const primeiroDePedido = dados?.blocos.findIndex((b) => b.pedeAcao) ?? -1;

  return (
    <>
      <CabecalhoPagina titulo={saudacao}
        subtitulo={dados?.tudoEmDia ? 'Está tudo em dia por aqui.' : 'Veja o que a sua contabilidade precisa de você.'} />
      <Conteudo largura="estreita">
        {!dados && !falhou && <Carregando>Buscando o que precisa de você…</Carregando>}
        {falhou && (
          <FalhaCarregamento titulo="Não foi possível carregar esta página agora." onTentar={carregar} tentando={tentando}>
            Você ainda pode usar o menu para lançar o caixa, enviar documentos e folhas de ponto.
          </FalhaCarregamento>
        )}

        {dados && dados.indisponiveis.length > 0 && (
          <Aviso tom="neutro">
            Não conseguimos conferir {dados.indisponiveis.map((i) => ROTULO_FONTE[i]).join(', ').replace(/, ([^,]*)$/, ' e $1')} agora. O resto está atualizado.
          </Aviso>
        )}

        {dados?.tudoEmDia && (
          <EstadoVazio icone={<IconeConfirmar size={28} className="text-sucesso" />}
            titulo="Tudo em dia. Obrigado!"
            descricao="Não há nada esperando por você. Quando a contabilidade pedir um documento ou uma folha voltar para ajuste, aparece aqui." />
        )}

        {dados?.blocos.map((b, i) => (
          <Secao key={b.id} titulo={b.titulo}
            acoes={!b.pedeAcao ? <Selo tom="sucesso">Novo</Selo> : undefined}>
            {b.itens.length > 0 && (
              <ul className="mb-4 divide-y divide-borda">
                {b.itens.map((it) => (
                  <li key={it.chave} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-sm first:pt-0 last:pb-0">
                    <span className="min-w-0 break-words font-medium text-tinta">{it.texto}</span>
                    {it.detalhe && (
                      <span className={it.urgencia === 'atrasada' ? 'text-perigo' : it.urgencia === 'hoje' ? 'text-aviso' : 'text-tinta-suave'}>
                        {it.detalhe}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {b.alemDoLimite > 0 && <p className="mb-4 text-[13px] text-tinta-suave">e mais {b.alemDoLimite}</p>}
            <a href={b.acao.href}
              className={botaoCls({ variante: i === primeiroDePedido ? 'primaria' : 'secundaria', tamanho: 'lg', className: 'w-full sm:w-auto' })}>
              {b.acao.rotulo}
            </a>
          </Secao>
        ))}
      </Conteudo>
    </>
  );
}
