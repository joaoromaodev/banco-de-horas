'use client';

import { useEffect, useState } from 'react';
import { Empresa, Funcionario } from '@/lib/tipos';
import { IconeExcluir, IconeMais } from '../icones';
import { Alternador, Botao, BotaoIcone, CabecalhoPagina, celulaCls, Conteudo, Secao, tb } from '@/components/ui';
import { Selecao } from '@/components/selecao';
import { Toast, Toasts } from '@/components/retorno';
import { AbasPonto } from '../AbasPonto';

interface Feriado { data: string; descricao: string; }

/**
 * Aba "Cadastros" do módulo Folha de Ponto. Concentra o que só serve à folha:
 * a jornada de cada empresa (e se trabalha aos sábados), os funcionários e os
 * feriados. A identidade da empresa (razão social/CNPJ) e os administradores
 * ficam no módulo Cadastro; o fiscal, no Livro Caixa.
 */
export default function PontoCadastros() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaSel, setEmpresaSel] = useState('');
  const [funcs, setFuncs] = useState<Funcionario[]>([]);
  const [feriados, setFeriados] = useState<Feriado[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function carregarEmpresas() {
    setErro(null);
    try {
      const r = await fetch('/api/empresas');
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      const lista: Empresa[] = d.empresas ?? [];
      setEmpresas(lista);
      if (!empresaSel && lista.length) setEmpresaSel(lista[0].id);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  async function carregarFuncs(empresa: string) {
    if (!empresa) { setFuncs([]); return; }
    try {
      const r = await fetch(`/api/funcionarios?empresa=${encodeURIComponent(empresa)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      setFuncs(d.funcionarios ?? []);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  async function carregarFeriados() {
    try {
      const r = await fetch('/api/feriados');
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      setFeriados(d.feriados ?? []);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  useEffect(() => { carregarEmpresas(); carregarFeriados(); }, []);
  useEffect(() => { carregarFuncs(empresaSel); }, [empresaSel]);

  async function salvarEmpresas() {
    setMsg(null); setErro(null);
    try {
      const res = await fetch('/api/empresas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresas }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsg(`Jornadas salvas em ${d.total} empresa(s).`);
      carregarEmpresas();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  async function salvarFuncs() {
    setMsg(null); setErro(null);
    if (!empresaSel) { setErro('Selecione uma empresa primeiro.'); return; }
    try {
      const res = await fetch('/api/funcionarios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa: empresaSel, funcionarios: funcs }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsg(`${d.total} funcionário(s) salvos em ${empresaSel}.`);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  async function salvarFeriados() {
    setMsg(null); setErro(null);
    try {
      const res = await fetch('/api/feriados', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feriados }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsg(`${d.total} feriado(s) salvos.`);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  const setE = (i: number, campo: keyof Empresa, v: string | boolean) =>
    setEmpresas((p) => p.map((e, j) => j === i
      ? { ...e, [campo]: campo.startsWith('jornada') ? (v ? Number(v) : undefined) : v }
      : e));
  const setF = (i: number, campo: keyof Funcionario, v: string) =>
    setFuncs((p) => p.map((f, j) => j === i ? { ...f, [campo]: campo.startsWith('jornada') ? (v ? Number(v) : undefined) : v } : f));
  const setH = (i: number, campo: keyof Feriado, v: string) =>
    setFeriados((p) => p.map((f, j) => j === i ? { ...f, [campo]: v } : f));

  const cell = `${celulaCls} w-full`;
  const cellC = `${cell} text-center`;

  const seletorEmpresa = (
    <Selecao aria-label="Empresa" tamanho="sm" largura="w-56 max-w-full" valor={empresaSel} onChange={setEmpresaSel}
      placeholder="— cadastre uma empresa —"
      opcoes={empresas.map((e) => ({ valor: e.id, rotulo: e.nome }))} />
  );

  return (
    <div className="text-sm">
      <CabecalhoPagina titulo="Folha de Ponto · Cadastros" subtitulo="Jornada das empresas, funcionários e feriados"
        abas={<AbasPonto ativa="cadastros" />} />

      <Toasts>
        {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
        {msg && <Toast onFechar={() => setMsg(null)}>{msg}</Toast>}
      </Toasts>

      <Conteudo largura="media">
        {/* Jornada por empresa */}
        <Secao titulo="Jornada das empresas"
          descricao="Marque se a empresa trabalha aos sábados e defina a jornada padrão (em minutos). O funcionário pode sobrescrever a jornada individualmente abaixo.">
          <div className={`${tb.moldura} shadow-none`}>
            <table className={tb.tabela}>
              <thead className={tb.cabeca}>
                <tr>
                  <th className={tb.th}>Razão social</th>
                  <th className={`${tb.th} text-center`}>Trabalha sáb.?</th>
                  <th className={`${tb.th} text-center`}>Jornada útil (min)</th>
                  <th className={`${tb.th} text-center`}>Jornada sáb. (min)</th>
                </tr>
              </thead>
              <tbody className={tb.corpo}>
                {empresas.map((e, i) => (
                  <tr key={i} className={tb.linha}>
                    <td className={tb.td}>{e.nome || <span className="text-tinta-fraca">(sem nome)</span>}</td>
                    <td className={`${tb.td} text-center`}>
                      <Alternador checked={e.trabalhaSabado} aria-label={`${e.nome || 'Empresa'} trabalha aos sábados`}
                        onChange={(ev) => setE(i, 'trabalhaSabado', ev.target.checked)} />
                    </td>
                    <td className={tb.tdCampo}><input className={cellC} inputMode="numeric" value={e.jornadaUtilMin ?? ''}
                      aria-label={`Jornada útil de ${e.nome || 'empresa'}, em minutos`}
                      placeholder="480" onChange={(ev) => setE(i, 'jornadaUtilMin', ev.target.value)} /></td>
                    <td className={tb.tdCampo}><input className={cellC} inputMode="numeric" value={e.jornadaSabadoMin ?? ''}
                      aria-label={`Jornada de sábado de ${e.nome || 'empresa'}, em minutos`}
                      placeholder="240" onChange={(ev) => setE(i, 'jornadaSabadoMin', ev.target.value)} /></td>
                  </tr>
                ))}
                {empresas.length === 0 && (
                  <tr><td colSpan={4} className={tb.vazio}>Cadastre empresas no módulo Cadastro.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex gap-2">
            <Botao variante="primaria" onClick={salvarEmpresas} disabled={empresas.length === 0}>Salvar jornadas</Botao>
          </div>
        </Secao>

        {/* Funcionários — por empresa */}
        <Secao titulo="Funcionários" acoes={seletorEmpresa}>
          <div className={`${tb.moldura} shadow-none`}>
            <table className={tb.tabela}>
              <thead className={tb.cabeca}>
                <tr>
                  <th className={tb.th}>Nome</th>
                  <th className={tb.th}>Cargo</th>
                  <th className={`${tb.th} text-center`}>Jornada útil (min)</th>
                  <th className={`${tb.th} text-center`}>Jornada sábado (min)</th>
                  <th className={`${tb.th} w-12`}><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className={tb.corpo}>
                {funcs.map((f, i) => (
                  <tr key={i} className={tb.linha}>
                    <td className={tb.tdCampo}><input className={`${cell} min-w-40`} value={f.nome} aria-label="Nome do funcionário"
                      onChange={(e) => setF(i, 'nome', e.target.value)} /></td>
                    <td className={tb.tdCampo}><input className={`${cell} min-w-32`} value={f.cargo ?? ''} aria-label={`Cargo de ${f.nome || 'funcionário'}`}
                      onChange={(e) => setF(i, 'cargo', e.target.value)} /></td>
                    <td className={tb.tdCampo}><input className={cellC} inputMode="numeric" value={f.jornadaUtilMin ?? ''}
                      aria-label={`Jornada útil de ${f.nome || 'funcionário'}, em minutos`}
                      placeholder="480" onChange={(e) => setF(i, 'jornadaUtilMin', e.target.value)} /></td>
                    <td className={tb.tdCampo}><input className={cellC} inputMode="numeric" value={f.jornadaSabadoMin ?? ''}
                      aria-label={`Jornada de sábado de ${f.nome || 'funcionário'}, em minutos`}
                      placeholder="240" onChange={(e) => setF(i, 'jornadaSabadoMin', e.target.value)} /></td>
                    <td className={`${tb.tdCampo} text-center`}>
                      <BotaoIcone rotulo="Remover funcionário" title="Remover" tom="perigo"
                        onClick={() => setFuncs((p) => p.filter((_, j) => j !== i))}>
                        <IconeExcluir size={16} />
                      </BotaoIcone>
                    </td>
                  </tr>
                ))}
                {empresaSel && funcs.length === 0 && (
                  <tr><td colSpan={5} className={tb.vazio}>Nenhum funcionário nesta empresa.</td></tr>
                )}
                {!empresaSel && (
                  <tr><td colSpan={5} className={tb.vazio}>Selecione uma empresa para ver os funcionários.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Botao variante="primaria" onClick={salvarFuncs} disabled={!empresaSel}>Salvar funcionários</Botao>
            <Botao onClick={() => setFuncs((p) => [...p, { empresa: empresaSel, nome: '', cargo: '' }])}
              disabled={!empresaSel} icone={<IconeMais />}>Linha</Botao>
          </div>
        </Secao>

        {/* Feriados — globais */}
        <Secao titulo="Feriados"
          descricao="Valem para todas as empresas (usados na coluna “a cumprir” e na validação).">
          <div className={`${tb.moldura} shadow-none`}>
            <table className={tb.tabela}>
              <thead className={tb.cabeca}>
                <tr>
                  <th className={tb.th}>Data</th>
                  <th className={tb.th}>Descrição</th>
                  <th className={`${tb.th} w-12`}><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className={tb.corpo}>
                {feriados.map((f, i) => (
                  <tr key={i} className={tb.linha}>
                    <td className={`${tb.tdCampo} w-44`}><input type="date" className={`${celulaCls} w-40`} value={f.data} aria-label="Data do feriado"
                      onChange={(e) => setH(i, 'data', e.target.value)} /></td>
                    <td className={tb.tdCampo}><input className={`${cell} min-w-40`} value={f.descricao} aria-label="Descrição do feriado"
                      onChange={(e) => setH(i, 'descricao', e.target.value)} /></td>
                    <td className={`${tb.tdCampo} text-center`}>
                      <BotaoIcone rotulo="Remover feriado" title="Remover" tom="perigo"
                        onClick={() => setFeriados((p) => p.filter((_, j) => j !== i))}>
                        <IconeExcluir size={16} />
                      </BotaoIcone>
                    </td>
                  </tr>
                ))}
                {feriados.length === 0 && (
                  <tr><td colSpan={3} className={tb.vazio}>Nenhum feriado cadastrado.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Botao variante="primaria" onClick={salvarFeriados}>Salvar feriados</Botao>
            <Botao onClick={() => setFeriados((p) => [...p, { data: '', descricao: '' }])} icone={<IconeMais />}>Linha</Botao>
          </div>
        </Secao>
      </Conteudo>
    </div>
  );
}
