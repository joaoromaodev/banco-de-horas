'use client';

import { useEffect, useState } from 'react';
import { IconeExcluir } from '../icones';
import { Botao, BotaoIcone, CabecalhoPagina, Conteudo, Entrada, EstadoVazio, Marcacao, Secao, Selo } from '@/components/ui';
import { Selecao } from '@/components/selecao';
import { Toast, Toasts } from '@/components/retorno';
import { DialogoConfirmacao } from '../Dialogo';

type Papel = 'master' | 'usuario' | 'cliente';
type Modulo = 'ponto' | 'caixa';
interface Usuario { email: string; nome: string; role: Papel; empresa: string | null; modulos: Modulo[]; }

const ROTULO_PAPEL: Record<Papel, string> = {
  master: 'Administrador',
  usuario: 'Contabilidade',
  cliente: 'Empresa cliente',
};

const ROTULO_MODULO: Record<Modulo, string> = {
  ponto: 'Folha de Ponto',
  caixa: 'Livro Caixa',
};

export default function Configuracoes() {
  // --- Gemini ---
  const [temChave, setTemChave] = useState(false);
  const [chave, setChave] = useState('');
  const [modelo, setModelo] = useState('gemini-2.5-flash');
  const [savingCfg, setSavingCfg] = useState(false);
  const [msgCfg, setMsgCfg] = useState<string | null>(null);

  // --- Usuários ---
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [novo, setNovo] = useState({ nome: '', email: '', senha: '', role: 'usuario' as Papel, modulos: ['caixa'] as Modulo[] });
  const [savingUser, setSavingUser] = useState(false);
  const [msgUser, setMsgUser] = useState<string | null>(null);

  const [erro, setErro] = useState<string | null>(null);
  const [aExcluir, setAExcluir] = useState<Usuario | null>(null);

  async function carregarCfg() {
    const res = await fetch('/api/config');
    const d = await res.json();
    if (res.ok) { setTemChave(d.temChave); setModelo(d.gemini_modelo || 'gemini-2.5-flash'); }
  }
  async function carregarUsuarios() {
    const res = await fetch('/api/usuarios');
    const d = await res.json();
    // Os administradores (cliente) são geridos no módulo Cadastro; aqui ficam só
    // os contadores e outros administradores do sistema.
    if (res.ok) setUsuarios((d.usuarios ?? []).filter((u: Usuario) => u.role !== 'cliente'));
  }
  useEffect(() => { carregarCfg(); carregarUsuarios(); }, []);

  async function salvarCfg() {
    setErro(null); setMsgCfg(null); setSavingCfg(true);
    try {
      const body: Record<string, string> = { gemini_modelo: modelo };
      if (chave.trim()) body.gemini_api_key = chave.trim();
      const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsgCfg('Configurações salvas.'); setChave(''); carregarCfg();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setSavingCfg(false); }
  }

  async function addUsuario() {
    setErro(null); setMsgUser(null); setSavingUser(true);
    try {
      const res = await fetch('/api/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(novo) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsgUser('Usuário salvo.');
      setNovo({ nome: '', email: '', senha: '', role: 'usuario', modulos: ['caixa'] });
      carregarUsuarios();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setSavingUser(false); }
  }

  async function removerUsuario(email: string) {
    setErro(null); setMsgUser(null); setAExcluir(null);
    try {
      const res = await fetch(`/api/usuarios?email=${encodeURIComponent(email)}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      carregarUsuarios();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="text-sm">
      <CabecalhoPagina titulo="Configurações" subtitulo="Área restrita ao administrador" />

      <Toasts>
        {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
        {msgCfg && <Toast onFechar={() => setMsgCfg(null)}>{msgCfg}</Toast>}
        {msgUser && <Toast onFechar={() => setMsgUser(null)}>{msgUser}</Toast>}
      </Toasts>

      <Conteudo largura="estreita">
        {/* Gemini */}
        <Secao titulo="Leitura das folhas (Gemini)"
          descricao="A chave fica guardada na planilha do Google e é usada só para ler as folhas de ponto.">
          <div className="space-y-4">
            <Entrada rotulo="Chave da API" type="password" autoComplete="off" value={chave} onChange={(e) => setChave(e.target.value)}
              placeholder={temChave ? 'manter atual' : 'AIza... ou AQ...'}
              dica={temChave ? 'Já existe uma chave salva. Preencha apenas para trocar.' : 'Nenhuma chave salva. Crie em aistudio.google.com/apikey.'} />
            <Selecao rotulo="Modelo" valor={modelo} onChange={setModelo}
              opcoes={[
                { valor: 'gemini-2.5-flash', rotulo: 'gemini-2.5-flash', detalhe: 'rápido, grátis' },
                { valor: 'gemini-2.5-pro', rotulo: 'gemini-2.5-pro', detalhe: 'mais preciso' },
              ]} />
          </div>
          <div className="mt-5">
            <Botao variante="primaria" onClick={salvarCfg} carregando={savingCfg}>
              {savingCfg ? 'Salvando…' : 'Salvar'}
            </Botao>
          </div>
        </Secao>

        {/* Usuários */}
        <Secao titulo="Usuários"
          descricao={<>
            Cadastre contadores e outros administradores. <strong>Contabilidade</strong> enxerga apenas as
            empresas que cadastrar. Os <strong>administradores das empresas</strong> (papel cliente) são
            criados pelo próprio contador no módulo <strong>Cadastro</strong>.
          </>}>
          {usuarios.length === 0 ? (
            <EstadoVazio titulo="Nenhum usuário cadastrado" descricao="Adicione o primeiro pelo formulário abaixo." />
          ) : (
            <ul className="divide-y divide-borda rounded-xl border border-borda">
              {usuarios.map((u) => (
                <li key={u.email} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-tinta">{u.nome}</div>
                    <div className="truncate text-xs text-tinta-suave">{u.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Selo tom={u.role === 'master' ? 'primaria' : 'neutro'}>{ROTULO_PAPEL[u.role]}</Selo>
                    {u.role === 'usuario' && (
                      <span className="hidden text-xs text-tinta-suave sm:inline">
                        {u.modulos.map((m) => ROTULO_MODULO[m]).join(' · ')}
                      </span>
                    )}
                    <BotaoIcone rotulo={`Remover ${u.nome}`} title="Remover" tom="perigo" onClick={() => setAExcluir(u)}>
                      <IconeExcluir size={16} />
                    </BotaoIcone>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h3 className="mb-3 mt-6 text-[13px] font-semibold text-tinta">Novo usuário</h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Entrada rotulo="Nome" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
            <Entrada rotulo="E-mail" type="email" autoComplete="off" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} />
            <Entrada rotulo="Senha" dica="Mínimo de 4 caracteres." type="password" autoComplete="new-password" value={novo.senha}
              onChange={(e) => setNovo({ ...novo, senha: e.target.value })} />
            <Selecao rotulo="Papel" valor={novo.role} onChange={(v) => setNovo({ ...novo, role: v as Papel })}
              opcoes={[{ valor: 'usuario', rotulo: 'Contabilidade' }, { valor: 'master', rotulo: 'Administrador' }]} />
          </div>

          {/* Módulos — só para a contabilidade. Master tem tudo; cliente é só caixa. */}
          {novo.role === 'usuario' && (
            <fieldset className="mt-5">
              <legend className="text-[13px] font-medium text-tinta">Módulos liberados</legend>
              <p className="mb-2.5 mt-1 text-xs text-tinta-suave">O que este contador enxerga. A Folha de Ponto só faz sentido para quem usa timesheet.</p>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {(['caixa', 'ponto'] as Modulo[]).map((m) => (
                  <Marcacao key={m} type="checkbox" checked={novo.modulos.includes(m)}
                    onChange={(e) => setNovo({
                      ...novo,
                      modulos: e.target.checked ? [...novo.modulos, m] : novo.modulos.filter((x) => x !== m),
                    })}>
                    {ROTULO_MODULO[m]}
                  </Marcacao>
                ))}
              </div>
            </fieldset>
          )}
          <div className="mt-5">
            <Botao variante="primaria" onClick={addUsuario} carregando={savingUser}>
              {savingUser ? 'Salvando…' : 'Adicionar usuário'}
            </Botao>
          </div>
        </Secao>
      </Conteudo>

      {aExcluir && (
        <DialogoConfirmacao
          titulo="Remover usuário"
          mensagem={<>Deseja realmente remover <strong>{aExcluir.nome}</strong> ({aExcluir.email})? Ele perde o acesso ao sistema.</>}
          textoConfirmar="Remover"
          onConfirmar={() => removerUsuario(aExcluir.email)}
          onCancelar={() => setAExcluir(null)}
        />
      )}
    </div>
  );
}
