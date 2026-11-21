'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Empresa } from '@/lib/tipos';
import { lerMe } from '@/lib/meCliente';
import { lerJson, mensagemDeCarga } from '@/lib/carga';
import { IconeExcluir, IconeMais } from '../icones';
import { Alternador, Botao, botaoCls, BotaoIcone, CabecalhoPagina, celulaCls, Conteudo, Entrada, EstadoVazio, FalhaCarregamento, Secao, Selo, tb } from '@/components/ui';
import { Selecao } from '@/components/selecao';
import { Toast, Toasts } from '@/components/retorno';
import { DialogoConfirmacao } from '../Dialogo';
import { SENHA_MIN } from '@/lib/auth';

interface Administrador { email: string; nome: string; role: string; empresa: string | null; }

/**
 * Módulo Cadastro (lado da contabilidade). Guarda o que é transversal aos dois
 * módulos: a identidade das empresas-clientes e os administradores (papel
 * `cliente`) de cada uma. Os dados específicos de cada módulo — jornada,
 * funcionários e feriados (Folha de Ponto) e o fiscal (Livro Caixa) — vivem
 * dentro do próprio módulo, na aba "Cadastros".
 */
export default function Cadastro() {
  const [ehMaster, setEhMaster] = useState(false);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [admins, setAdmins] = useState<Administrador[]>([]);
  const [novo, setNovo] = useState({ nome: '', email: '', senha: '', empresa: '' });
  const [salvandoAdmin, setSalvandoAdmin] = useState(false);
  const [aExcluir, setAExcluir] = useState<Administrador | null>(null);
  const [desfazer, setDesfazer] = useState<{ nome: string; ficha: string } | null>(null);
  const [arquivadas, setArquivadas] = useState<Empresa[]>([]);
  const [aArquivar, setAArquivar] = useState<Empresa | null>(null);
  const [desfazerEmpresa, setDesfazerEmpresa] = useState<Empresa | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Falha da lista de empresas: fica na tela com "Tentar de novo" (a tabela vazia
  // pareceria "nenhuma empresa cadastrada").
  const [falhaEmpresas, setFalhaEmpresas] = useState<string | null>(null);
  async function carregarEmpresas() {
    setFalhaEmpresas(null);
    try {
      const d = await lerJson<{ empresas?: Empresa[] }>('/api/empresas');
      setEmpresas(d.empresas ?? []);
    } catch (e) { setFalhaEmpresas(mensagemDeCarga(e)); }
  }

  async function carregarArquivadas() {
    try {
      const r = await fetch('/api/empresas?arquivadas=1');
      const d = await r.json();
      if (r.ok) setArquivadas(d.empresas ?? []);
    } catch { /* a seção de arquivadas é acessória: falhar em silêncio não atrapalha o resto */ }
  }

  async function mudarArquivamento(e: Empresa, acao: 'arquivar' | 'reativar') {
    setMsg(null); setErro(null); setAArquivar(null);
    try {
      const res = await fetch('/api/empresas', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: e.id, acao }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      if (acao === 'arquivar') {
        // tira só a linha: edições não salvas das outras empresas continuam na tela
        setEmpresas((p) => p.filter((x) => x.id !== e.id));
        setDesfazerEmpresa(e);
      } else {
        setDesfazerEmpresa(null);
        setMsg(`${e.nome} voltou para a lista de empresas.`);
        carregarEmpresas();
      }
      carregarArquivadas();
    } catch (er) { setErro(er instanceof Error ? er.message : String(er)); }
  }

  async function carregarAdmins() {
    try {
      const r = await fetch('/api/usuarios');
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      // A rota já escopa para o contador; para o master, filtramos só os clientes.
      setAdmins((d.usuarios ?? []).filter((u: Administrador) => u.role === 'cliente'));
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  useEffect(() => {
    lerMe().then((d) => {
      if (d) setEhMaster(d.role === 'master');
    }).catch(() => {});
    carregarEmpresas();
    carregarAdmins();
    carregarArquivadas();
  }, []);

  async function salvarEmpresas() {
    setMsg(null); setErro(null);
    try {
      const res = await fetch('/api/empresas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresas }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsg(`${d.total} empresa(s) salvas.`);
      carregarEmpresas();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  async function addAdmin() {
    setMsg(null); setErro(null); setSalvandoAdmin(true);
    try {
      const res = await fetch('/api/usuarios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...novo, role: 'cliente' }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsg('Administrador salvo.');
      setNovo({ nome: '', email: '', senha: '', empresa: '' });
      carregarAdmins();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setSalvandoAdmin(false); }
  }

  async function removerAdmin(u: Administrador) {
    setMsg(null); setErro(null); setAExcluir(null);
    try {
      const res = await fetch(`/api/usuarios?email=${encodeURIComponent(u.email)}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setDesfazer({ nome: u.nome, ficha: d.desfazer });
      carregarAdmins();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  async function desfazerRemocao() {
    if (!desfazer) return;
    setErro(null);
    try {
      const res = await fetch('/api/usuarios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurar: desfazer.ficha }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsg(`${desfazer.nome} voltou a ter acesso.`);
      setDesfazer(null);
      carregarAdmins();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  const setE = (i: number, campo: keyof Empresa, v: string) =>
    setEmpresas((p) => p.map((e, j) => j === i ? { ...e, [campo]: v } : e));

  const nomeEmpresa = (id: string | null) => empresas.find((e) => e.id === id)?.nome ?? 'empresa removida';
  const cell = `${celulaCls} w-full`;
  const colsEmpresa = 4 + (ehMaster ? 1 : 0) + 1; // razão + tipo + doc + pagador (+contador) + ações

  return (
    <div className="text-sm">
      <CabecalhoPagina titulo="Cadastro"
        subtitulo="Empresas-clientes e seus administradores. Os dados de cada módulo (jornada, funcionários, feriados, fiscal) ficam dentro da Folha de Ponto e do Livro Caixa." />

      <Toasts>
        {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
        {msg && <Toast onFechar={() => setMsg(null)}>{msg}</Toast>}
        {desfazer && (
          <Toast tom="info" onFechar={() => setDesfazer(null)}
            acao={<Botao tamanho="sm" variante="tonal" onClick={desfazerRemocao}>Desfazer</Botao>}>
            {desfazer.nome} foi removido.
          </Toast>
        )}
        {desfazerEmpresa && (
          <Toast tom="info" onFechar={() => setDesfazerEmpresa(null)}
            acao={<Botao tamanho="sm" variante="tonal" onClick={() => mudarArquivamento(desfazerEmpresa, 'reativar')}>Desfazer</Botao>}>
            {desfazerEmpresa.nome} foi arquivada.
          </Toast>
        )}
      </Toasts>

      <Conteudo largura="media">
        {falhaEmpresas && (
          <FalhaCarregamento titulo="Não foi possível carregar as empresas." onTentar={() => { void carregarEmpresas(); }}>{falhaEmpresas}</FalhaCarregamento>
        )}
        {/* Identidade das empresas (compartilhada pelos dois módulos) */}
        <Secao titulo="Empresas-clientes"
          descricao={<>
            A razão social aparece no cabeçalho da planilha e no Termo.
            {ehMaster
              ? ' Como administrador da plataforma, você vê as empresas de todos os escritórios e define o contador responsável de cada uma.'
              : ' Você vê e edita as empresas do seu escritório.'}
          </>}>
          <div className={`${tb.moldura} shadow-none`}>
            <table className={tb.tabela}>
              <thead className={tb.cabeca}>
                <tr>
                  <th className={tb.th}>Razão social / Nome</th>
                  <th className={tb.th}>Tipo</th>
                  <th className={tb.th}>CNPJ / CPF</th>
                  <th className={`${tb.th} text-center`}>
                    <span tabIndex={0} className="cursor-help underline decoration-dotted underline-offset-4"
                      data-dica="Identificar o pagador/paciente (nome + CPF/CNPJ) nas entradas do Livro Caixa — para Carnê-Leão/DMED. Ligue em clínicas e profissionais de saúde.">
                      Identifica pagador
                    </span>
                  </th>
                  {ehMaster && <th className={tb.th}>Contador responsável</th>}
                  <th className={`${tb.th} w-12`}><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody className={tb.corpo}>
                {empresas.map((e, i) => (
                  <tr key={i} className={tb.linha}>
                    <td className={tb.tdCampo}><input className={`${cell} min-w-48`} value={e.nome} aria-label="Razão social ou nome"
                      onChange={(ev) => setE(i, 'nome', ev.target.value)} /></td>
                    <td className={tb.tdCampo}>
                      <Selecao aparencia="celula" largura="w-28" aria-label={`Tipo de pessoa de ${e.nome || 'empresa'}`}
                        valor={e.tipoPessoa ?? 'juridica'} onChange={(v) => setE(i, 'tipoPessoa', v)}
                        opcoes={[{ valor: 'juridica', rotulo: 'Jurídica' }, { valor: 'fisica', rotulo: 'Física' }]} />
                    </td>
                    <td className={tb.tdCampo}><input className={`${cell} min-w-40`} value={e.cnpj ?? ''}
                      aria-label={`${e.tipoPessoa === 'fisica' ? 'CPF' : 'CNPJ'} de ${e.nome || 'empresa'}`}
                      placeholder={e.tipoPessoa === 'fisica' ? 'CPF' : 'CNPJ'}
                      onChange={(ev) => setE(i, 'cnpj', ev.target.value)} /></td>
                    <td className={`${tb.tdCampo} text-center`}>
                      <Alternador checked={!!e.identificaPagador}
                        aria-label="Identifica pagador/paciente nas entradas"
                        onChange={(ev) => setEmpresas((p) => p.map((x, j) => j === i ? { ...x, identificaPagador: ev.target.checked } : x))} />
                    </td>
                    {ehMaster && (
                      <td className={tb.tdCampo}><input className={`${cell} min-w-44`} value={e.contador ?? ''}
                        aria-label={`Contador responsável por ${e.nome || 'empresa'}`}
                        placeholder="e-mail do contador" onChange={(ev) => setE(i, 'contador', ev.target.value)} /></td>
                    )}
                    <td className={`${tb.tdCampo} text-center`}>
                      <BotaoIcone rotulo={`Arquivar ${e.nome || 'empresa'}`} title="Arquivar" tom="perigo"
                        onClick={() => (e.id ? setAArquivar(e) : setEmpresas((p) => p.filter((_, j) => j !== i)))}>
                        <IconeExcluir size={16} />
                      </BotaoIcone>
                    </td>
                  </tr>
                ))}
                {empresas.length === 0 && (
                  <tr><td colSpan={colsEmpresa} className={tb.vazio}>Nenhuma empresa cadastrada.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Botao variante="primaria" onClick={salvarEmpresas}>Salvar empresas</Botao>
            <Botao icone={<IconeMais />}
              onClick={() => setEmpresas((p) => [...p, { id: '', nome: '', tipoPessoa: 'juridica', cnpj: '', trabalhaSabado: false }])}>
              Empresa
            </Botao>
          </div>
          <p className="mt-3 text-xs text-tinta-suave">Arquivar tira a empresa das listas sem apagar nada — dá para reativar logo abaixo.</p>
          <p className="mt-1 text-xs text-tinta-suave">Dica: evite renomear uma empresa depois de cadastrar funcionários — o vínculo é pelo id interno.</p>
        </Secao>

        {arquivadas.length > 0 && (
          <Secao titulo="Empresas arquivadas"
            descricao="Ficam fora das listas, do painel e da agenda, e o administrador delas não consegue entrar. Todos os dados (ponto, caixa, contratos, documentos) ficam guardados: dá para consultar e exportar sem reativar. Reativar traz tudo de volta.">
            <ul className="divide-y divide-borda rounded-xl border border-borda">
              {arquivadas.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-tinta">{e.nome}</div>
                    <div className="truncate text-xs text-tinta-suave">
                      Arquivada{e.arquivadaEm ? ` em ${new Date(e.arquivadaEm).toLocaleDateString('pt-BR')}` : ''}
                      {e.arquivadaPor ? ` por ${e.arquivadaPor}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-tinta-suave">Consultar:</span>
                    {[['Livro caixa', '/caixa'], ['Ponto', '/ponto'], ['Contratos', '/contratos'], ['Documentos', '/documentos']].map(([rotulo, href]) => (
                      <Link key={href} href={`${href}?empresa=${encodeURIComponent(e.id)}`} className={botaoCls({ variante: 'tonal', tamanho: 'sm' })}>{rotulo}</Link>
                    ))}
                    <Botao tamanho="sm" onClick={() => mudarArquivamento(e, 'reativar')}>Reativar</Botao>
                  </div>
                </li>
              ))}
            </ul>
          </Secao>
        )}

        {/* Administradores da empresa (papel cliente) */}
        <Secao titulo="Administradores da empresa"
          descricao={<>Você cadastra quem administra o <strong>Livro Caixa</strong> de cada empresa-cliente. O administrador acessa só o caixa da empresa vinculada.</>}>
          {admins.length === 0 ? (
            <EstadoVazio titulo="Nenhum administrador cadastrado" descricao="Adicione o primeiro pelo formulário abaixo." />
          ) : (
            <ul className="divide-y divide-borda rounded-xl border border-borda">
              {admins.map((u) => (
                <li key={u.email} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-tinta">{u.nome}</div>
                    <div className="truncate text-xs text-tinta-suave">{u.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Selo>{nomeEmpresa(u.empresa)}</Selo>
                    <BotaoIcone rotulo={`Remover ${u.nome}`} title="Remover" tom="perigo" onClick={() => setAExcluir(u)}>
                      <IconeExcluir size={16} />
                    </BotaoIcone>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h3 className="mb-3 mt-6 text-[13px] font-semibold text-tinta">Novo administrador</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Entrada rotulo="Nome" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
            <Entrada rotulo="E-mail" type="email" autoComplete="off" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} />
            <Entrada rotulo="Senha" dica={`Mínimo de ${SENHA_MIN} caracteres.`} type="password" autoComplete="new-password" value={novo.senha}
              onChange={(e) => setNovo({ ...novo, senha: e.target.value })} />
            <Selecao rotulo="Empresa" valor={novo.empresa} onChange={(v) => setNovo({ ...novo, empresa: v })}
              placeholder="Escolha a empresa…"
              opcoes={empresas.map((e) => ({ valor: e.id, rotulo: e.nome }))} />
          </div>
          <div className="mt-5">
            <Botao variante="primaria" onClick={addAdmin} carregando={salvandoAdmin} disabled={!novo.empresa}>
              {salvandoAdmin ? 'Salvando…' : 'Adicionar administrador'}
            </Botao>
          </div>
        </Secao>
      </Conteudo>

      {aArquivar && (
        <DialogoConfirmacao
          titulo="Arquivar empresa"
          mensagem={<>Arquivar <strong>{aArquivar.nome}</strong>? Ela some das listas, do painel e da agenda, e o administrador dela deixa de conseguir entrar. Nenhum dado é apagado e você pode reativar depois.</>}
          textoConfirmar="Arquivar"
          onConfirmar={() => mudarArquivamento(aArquivar, 'arquivar')}
          onCancelar={() => setAArquivar(null)}
        />
      )}

      {aExcluir && (
        <DialogoConfirmacao
          titulo="Remover administrador"
          mensagem={<>Deseja realmente remover <strong>{aExcluir.nome}</strong> ({aExcluir.email})? Ele perde o acesso ao sistema.</>}
          textoConfirmar="Remover"
          onConfirmar={() => removerAdmin(aExcluir)}
          onCancelar={() => setAExcluir(null)}
        />
      )}
    </div>
  );
}
