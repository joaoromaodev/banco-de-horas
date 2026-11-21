'use client';

// Livro Caixa — resumo do exercício (Fase 4).
//
// Escopo reduzido por decisão dela: era para ser o Balanço Financeiro em débitos
// × créditos e ela dispensou — *é um livro caixa, ela só analisa o saldo final:
// o que entrou, o que saiu e o saldo de um mês para o outro*. É exatamente essa
// a tabela abaixo.
//
// Para o cliente, o resumo só aparece depois que a contabilidade confirma o mês.
// Quem aplica esse recorte é a rota; aqui a tela só mostra o que veio.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { dinheiro, MESES_LONGOS } from '../formato';
import { EntradasSaidas, EvolucaoSaldo, PontoMes } from './Graficos';
import { AbasCaixa } from '../AbasCaixa';
import { Aviso, CabecalhoPagina, Carregando, Conteudo, Esqueleto, Indicador, Secao, Selo, tb } from '@/components/ui';
import { Selecao } from '@/components/selecao';
import { lerMe } from '@/lib/meCliente';

interface Me { nome: string; email: string; role: 'master' | 'usuario' | 'cliente'; empresa: string | null; }
interface Empresa { id: string; nome: string; }

interface MesResumo extends PontoMes {
  saldoTransportado: number | null;
  confirmado: boolean;
  liberado: boolean;
}
interface Resumo {
  ano: number;
  saldoInicial: number;
  meses: MesResumo[];
  liberadoAte: number;
  total: { entradas: number; saidas: number; saldoFinal: number };
}

const PRIMEIRO_EXERCICIO = 2026;

const faltaMigracao = (msg: string) => /could not find the table|does not exist|schema cache/i.test(msg);

export default function ResumoCaixa() {
  const [me, setMe] = useState<Me | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaSel, setEmpresaSel] = useState('');
  const [ano, setAno] = useState(() => Math.max(new Date().getFullYear(), PRIMEIRO_EXERCICIO));
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ehGestor = me?.role === 'master' || me?.role === 'usuario';
  const anos = useMemo(() => {
    const ultimo = Math.max(new Date().getFullYear() + 1, PRIMEIRO_EXERCICIO);
    return Array.from({ length: ultimo - PRIMEIRO_EXERCICIO + 1 }, (_, i) => PRIMEIRO_EXERCICIO + i);
  }, []);

  // Mantém o filtro em sincronia com a tela de Lançamentos (mesmas chaves).
  useEffect(() => {
    const a = Number(localStorage.getItem('caixa.ano'));
    if (a >= PRIMEIRO_EXERCICIO) setAno(a);
  }, []);
  // Não persiste o filtro do cliente: ele é fixo na própria empresa; salvar
  // poluiria a próxima sessão de gestor no mesmo navegador.
  useEffect(() => { if (empresaSel && me?.role !== 'cliente') localStorage.setItem('caixa.empresa', empresaSel); }, [empresaSel, me]);
  useEffect(() => { localStorage.setItem('caixa.ano', String(ano)); }, [ano]);

  useEffect(() => {
    lerMe().then((d) => {
      if (!d?.autenticado) return;
      setMe(d);
      // O cliente é fixo na própria empresa e NUNCA herda o filtro salvo de outra
      // sessão no mesmo navegador (senão a API recebe o id de outra empresa → 403).
      // O gestor, sim, retoma o último filtro.
      if (d.role === 'cliente') {
        if (d.empresa) setEmpresaSel(d.empresa);
      } else {
        const e = localStorage.getItem('caixa.empresa');
        if (e) setEmpresaSel((atual) => atual || e);
      }
    }).catch(() => {});
    fetch('/api/empresas').then((r) => (r.ok ? r.json() : null)).then((d) => {
      const lista: Empresa[] = d?.empresas ?? [];
      setEmpresas(lista);
      // Fallback: para o cliente, /api/empresas já devolve só a empresa dele.
      setEmpresaSel((atual) => atual || lista[0]?.id || '');
    }).catch(() => {});
  }, []);

  const carregar = useCallback(async () => {
    if (!empresaSel) return;
    setCarregando(true); setErro(null);
    try {
      const r = await fetch(`/api/caixa/resumo?empresa=${encodeURIComponent(empresaSel)}&ano=${ano}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      setResumo(d);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }, [empresaSel, ano]);

  useEffect(() => { carregar(); }, [carregar]);

  const meses = resumo?.meses ?? [];
  const nenhumLiberado = resumo != null && resumo.liberadoAte === 0;

  if (erro && faltaMigracao(erro)) {
    return (
      <Moldura ehGestor={ehGestor} empresas={empresas} empresaSel={empresaSel} setEmpresaSel={setEmpresaSel}
        ano={ano} setAno={setAno} anos={anos}>
        <Aviso tom="aviso" titulo="Falta aplicar a migração do banco">
          Rode <code className="rounded bg-superficie px-1 font-mono text-xs">supabase/migrations/0002_lancamentos_e_conferencia.sql</code>
          {' '}no SQL Editor do Supabase e recarregue.
        </Aviso>
      </Moldura>
    );
  }

  return (
    <Moldura ehGestor={ehGestor} empresas={empresas} empresaSel={empresaSel} setEmpresaSel={setEmpresaSel}
      ano={ano} setAno={setAno} anos={anos}>
      {erro && <Aviso tom="perigo">{erro}</Aviso>}

      {nenhumLiberado && !ehGestor && (
        <Aviso tom="info">
          O resumo aparece aqui quando a contabilidade confirmar o mês. Seus lançamentos continuam
          disponíveis em <a href="/caixa" className="font-medium text-primaria-texto underline underline-offset-2">Lançamentos</a>.
        </Aviso>
      )}

      {/* Números do exercício */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Indicador rotulo="Saldo inicial do exercício" valor={dinheiro(resumo?.saldoInicial ?? 0)}
          tom={(resumo?.saldoInicial ?? 0) < 0 ? 'perigo' : 'neutro'} />
        <Indicador rotulo="Entradas no ano" valor={dinheiro(resumo?.total.entradas ?? 0)} tom="sucesso" />
        <Indicador rotulo="Saídas no ano" valor={dinheiro(resumo?.total.saidas ?? 0)} tom="perigo" />
        <Indicador rotulo="Saldo atual" valor={dinheiro(resumo?.total.saldoFinal ?? 0)} destaque
          tom={(resumo?.total.saldoFinal ?? 0) < 0 ? 'perigo' : 'neutro'} />
      </div>

      {resumo && resumo.liberadoAte < 12 && (
        <p className="text-[13px] text-tinta-suave">
          {ehGestor
            ? 'Os totais do ano somam todos os meses — o cliente só vê até o último mês confirmado.'
            : `Totais até ${MESES_LONGOS[Math.max(resumo.liberadoAte, 1) - 1].toLowerCase()}, o último mês confirmado pela contabilidade.`}
        </p>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Secao titulo="Evolução do saldo" descricao="Saldo do caixa no fim de cada mês.">
          {carregando && !resumo ? <Esqueleto className="h-40 w-full" /> : <EvolucaoSaldo meses={meses} saldoInicial={resumo?.saldoInicial ?? 0} />}
        </Secao>

        <Secao titulo="Entradas e saídas por mês" descricao="O movimento de cada mês, sem acumular.">
          {carregando && !resumo ? <Esqueleto className="h-40 w-full" /> : <EntradasSaidas meses={meses} />}
        </Secao>
      </div>

      {/* A tabela é a versão textual dos gráficos — e o que ela confere de fato */}
      <div className={tb.moldura}>
        <table className={`${tb.tabela} text-[13px]`}>
          <caption className="sr-only">Resumo do exercício de {ano}, mês a mês</caption>
          <thead className={tb.cabeca}>
            <tr>
              <th className={tb.th}>Mês</th>
              <th className={`${tb.th} text-right`}>Saldo transportado</th>
              <th className={`${tb.th} text-right`}>Entradas</th>
              <th className={`${tb.th} text-right`}>Saídas</th>
              <th className={`${tb.th} text-right`}>Saldo do mês</th>
              <th className={`${tb.th} text-center`}>Situação</th>
            </tr>
          </thead>
          <tbody className="[&>tr]:border-b [&>tr]:border-borda/70">
            {meses.map((m) => (
              <tr key={m.mes} className={`${tb.linha} ${m.liberado ? 'text-tinta' : 'text-tinta-fraca'}`}>
                <td className={`${tb.td} font-medium`}>{MESES_LONGOS[m.mes - 1]}</td>
                <td className={`${tb.td} ${tb.num}`}>{m.saldoTransportado == null ? '—' : dinheiro(m.saldoTransportado)}</td>
                <td className={`${tb.td} ${tb.num} ${m.entradas ? 'text-sucesso' : ''}`}>{m.entradas ? dinheiro(m.entradas) : m.liberado ? '' : '—'}</td>
                <td className={`${tb.td} ${tb.num} ${m.saidas ? 'text-perigo' : ''}`}>{m.saidas ? dinheiro(m.saidas) : m.liberado ? '' : '—'}</td>
                <td className={`${tb.td} ${tb.num} font-semibold ${(m.saldoFinal ?? 0) < 0 ? 'text-perigo' : ''}`}>
                  {m.saldoFinal == null ? '—' : dinheiro(m.saldoFinal)}
                </td>
                <td className={`${tb.td} text-center`}>
                  {m.confirmado ? <Selo tom="sucesso">confirmado</Selo> : <span className="text-xs text-tinta-fraca">em aberto</span>}
                </td>
              </tr>
            ))}
            {carregando && !resumo && [0, 1, 2].map((i) => (
              <tr key={`esqueleto-${i}`}><td colSpan={6} className="px-3 py-2.5"><Esqueleto /></td></tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-superficie-suave font-semibold text-tinta">
              <td className={tb.td}>Total do exercício</td>
              <td className={`${tb.td} ${tb.num} font-medium text-tinta-suave`}>{dinheiro(resumo?.saldoInicial ?? 0)}</td>
              <td className={`${tb.td} ${tb.num} text-sucesso`}>{dinheiro(resumo?.total.entradas ?? 0)}</td>
              <td className={`${tb.td} ${tb.num} text-perigo`}>{dinheiro(resumo?.total.saidas ?? 0)}</td>
              <td className={`${tb.td} ${tb.num} ${(resumo?.total.saldoFinal ?? 0) < 0 ? 'text-perigo' : ''}`}>{dinheiro(resumo?.total.saldoFinal ?? 0)}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {carregando && <Carregando />}
    </Moldura>
  );
}

/** Cabeçalho e seletores, iguais aos da tela de lançamentos. */
function Moldura({ ehGestor, empresas, empresaSel, setEmpresaSel, ano, setAno, anos, children }: {
  ehGestor: boolean; empresas: Empresa[]; empresaSel: string; setEmpresaSel: (v: string) => void;
  ano: number; setAno: (v: number) => void; anos: number[]; children: React.ReactNode;
}) {
  return (
    <div className="text-sm">
      <CabecalhoPagina titulo="Livro Caixa — resumo" subtitulo="Entradas, saídas e o saldo de um mês para o outro"
        abas={<AbasCaixa ativa="resumo" ehGestor={ehGestor} />}
        acoes={<>
          {ehGestor && (
            <Selecao aria-label="Empresa" largura="w-56 max-w-full" valor={empresaSel} onChange={setEmpresaSel}
              placeholder="— nenhuma empresa —"
              opcoes={empresas.map((e) => ({ valor: e.id, rotulo: e.nome }))} />
          )}
          <Selecao aria-label="Exercício" largura="w-24" busca={false} valor={String(ano)} onChange={(v) => setAno(Number(v))}
            opcoes={anos.map((a) => ({ valor: String(a), rotulo: String(a) }))} />
        </>} />
      <Conteudo>{children}</Conteudo>
    </div>
  );
}
