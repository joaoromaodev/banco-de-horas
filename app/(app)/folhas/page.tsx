'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Empresa, Funcionario } from '@/lib/tipos';
import { MESES } from '@/lib/calendario';
import { hojeBelem } from '@/lib/agenda';
import { mesInicialPonto } from '@/lib/pontoUrl';
import { AbasPonto } from '../AbasPonto';
import { IconeBaixar } from '../icones';
import { Botao, CabecalhoPagina, Cartao, Conteudo, Entrada, FalhaCarregamento, Secao } from '@/components/ui';
import { lerJson, mensagemDeCarga } from '@/lib/carga';
import { EntradaSugestoes, Selecao } from '@/components/selecao';
import { Toast, Toasts } from '@/components/retorno';

export default function Folhas() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresa, setEmpresa] = useState('');
  const [funcList, setFuncList] = useState<Funcionario[]>([]);
  const [funcionario, setFuncionario] = useState('');
  // Mês de hoje (Belém), como a Timesheet — antes ficava fixo em junho/2026.
  const [ano, setAno] = useState(() => mesInicialPonto('', hojeBelem()).ano);
  const [mes, setMes] = useState(() => mesInicialPonto('', hojeBelem()).mes);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const [falhaEmpresas, setFalhaEmpresas] = useState<string | null>(null);
  const carregarEmpresas = useCallback(() => {
    setFalhaEmpresas(null);
    lerJson<{ empresas?: Empresa[] }>('/api/empresas').then((d) => {
      if (Array.isArray(d.empresas)) {
        const lista = d.empresas;
        setEmpresas(lista);
        if (lista.length) setEmpresa((prev) => prev || lista[0].id);
      }
    }).catch((e) => setFalhaEmpresas(mensagemDeCarga(e)));
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga da API; zerar erro/espera/dados antigos antes do fetch é intencional
  useEffect(() => { carregarEmpresas(); }, [carregarEmpresas]);

  // Sem empresa, a lista é zerada no próprio `onChange` (não aqui, no efeito).
  useEffect(() => {
    if (!empresa) return;
    fetch(`/api/funcionarios?empresa=${encodeURIComponent(empresa)}`).then((r) => r.json()).then((d) => {
      if (Array.isArray(d.funcionarios)) setFuncList(d.funcionarios);
    }).catch(() => {});
  }, [empresa]);

  const empresaSel = useMemo(() => empresas.find((e) => e.id === empresa), [empresas, empresa]);

  async function baixar(url: string, nomeArquivo: string) {
    setErro(null);
    if (!empresa) { setErro('Selecione a empresa.'); return; }
    setCarregando(true);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.erro ?? 'Falha ao gerar.');
      }
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href; a.download = nomeArquivo; a.click();
      URL.revokeObjectURL(href);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }

  function baixarFuncionario() {
    if (!funcionario) { setErro('Selecione o funcionário.'); return; }
    const url = `/api/folha?empresa=${encodeURIComponent(empresa)}&funcionario=${encodeURIComponent(funcionario)}&ano=${ano}&mes=${mes}`;
    baixar(url, `folha_${funcionario}_${MESES[mes]}_${ano}.pdf`);
  }

  function baixarLote() {
    const url = `/api/folha-lote?empresa=${encodeURIComponent(empresa)}&ano=${ano}&mes=${mes}`;
    baixar(url, `folhas_${empresaSel?.nome ?? 'empresa'}_${MESES[mes]}_${ano}.zip`);
  }

  return (
    <div className="text-sm">
      <CabecalhoPagina titulo="Folhas de ponto em branco" subtitulo="Gere as folhas para os funcionários preencherem à mão"
        abas={<AbasPonto ativa="folhas" />} />

      <Toasts>
        {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
      </Toasts>

      <Conteudo largura="media">
        {falhaEmpresas && (
          <FalhaCarregamento titulo="Não foi possível carregar as empresas." onTentar={carregarEmpresas}>{falhaEmpresas}</FalhaCarregamento>
        )}
        <Secao titulo="Empresa e período">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Selecao rotulo="Empresa" classeCampo="sm:col-span-2" valor={empresa} placeholder="— cadastre uma empresa —"
              onChange={(v) => { setEmpresa(v); setFuncionario(''); if (!v) setFuncList([]); }}
              opcoes={empresas.map((e) => ({ valor: e.id, rotulo: e.nome }))} />
            <Selecao rotulo="Mês" busca={false} valor={String(mes)} onChange={(v) => setMes(Number(v))}
              opcoes={MESES.slice(1).map((m, i) => ({ valor: String(i + 1), rotulo: m }))} />
            <Entrada rotulo="Ano" type="number" value={ano} onChange={(e) => setAno(Number(e.target.value))} />
          </div>
        </Secao>

        {/* Uma folha */}
        <Secao titulo="Folha de um funcionário" descricao="Gera o PDF da folha do mês já com o nome do funcionário.">
          <div className="flex flex-wrap items-end gap-3">
            <EntradaSugestoes rotulo="Funcionário" classeCampo="w-full sm:w-80" value={funcionario} onChange={setFuncionario}
              sugestoes={funcList.map((f) => f.nome)}
              placeholder={empresa ? 'Nome (ou selecione)' : 'Selecione a empresa primeiro'} />
            <Botao variante="primaria" onClick={baixarFuncionario} carregando={carregando} icone={<IconeBaixar />}>
              {carregando ? 'Gerando…' : 'Baixar folha (PDF)'}
            </Botao>
          </div>
        </Secao>

        {/* Em lote */}
        <Cartao className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-tinta">Em lote</h2>
            <p className="mt-0.5 text-[13px] text-tinta-suave">
              Folhas de todos os funcionários de {empresaSel?.nome || 'empresa'} em {MESES[mes]}/{ano}.
            </p>
          </div>
          <Botao onClick={baixarLote} disabled={carregando} icone={<IconeBaixar />}>Baixar todas (.zip)</Botao>
        </Cartao>
      </Conteudo>
    </div>
  );
}
