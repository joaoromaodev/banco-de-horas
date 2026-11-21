'use client';

import { useEffect, useState } from 'react';
import { IconeExcluir } from '../icones';
import { Botao, BotaoIcone, CabecalhoPagina, Conteudo, Entrada, EstadoVazio, Marcacao, Secao, Selo } from '@/components/ui';
import { Selecao } from '@/components/selecao';
import { Toast, Toasts } from '@/components/retorno';
import { DialogoConfirmacao } from '../Dialogo';
import { SENHA_MIN } from '@/lib/auth';

type Papel = 'master' | 'usuario' | 'cliente';
type Modulo = 'ponto' | 'caixa';
interface Usuario {
  email: string; nome: string; role: Papel; empresa: string | null; modulos: Modulo[];
  escritorioId: string | null; adminEscritorio: boolean;
}
interface Escritorio { id: string; nome: string; situacao: 'teste' | 'ativo' | 'suspenso'; plano: string; }

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
  // --- Leitura por IA (chave da plataforma, só consulta) ---
  const [ia, setIa] = useState<{ temChave: boolean; modelo: string } | null>(null);

  // --- Usuários ---
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [escritorios, setEscritorios] = useState<Escritorio[]>([]);
  const vazio = { nome: '', email: '', senha: '', role: 'usuario' as Papel, modulos: ['caixa'] as Modulo[], escritorioId: '' };
  const [novo, setNovo] = useState(vazio);
  const [desfazer, setDesfazer] = useState<{ nome: string; ficha: string } | null>(null);
  const [savingUser, setSavingUser] = useState(false);
  const [msgUser, setMsgUser] = useState<string | null>(null);

  const [erro, setErro] = useState<string | null>(null);
  const [aExcluir, setAExcluir] = useState<Usuario | null>(null);

  async function carregarCfg() {
    const res = await fetch('/api/config');
    const d = await res.json();
    if (res.ok) setIa({ temChave: Boolean(d.temChave), modelo: d.gemini_modelo || '' });
  }
  async function carregarUsuarios() {
    const res = await fetch('/api/usuarios');
    const d = await res.json();
    // Os administradores (cliente) são geridos no módulo Cadastro; aqui ficam só
    // os contadores e outros administradores do sistema.
    if (res.ok) setUsuarios((d.usuarios ?? []).filter((u: Usuario) => u.role !== 'cliente'));
  }
  async function carregarEscritorios() {
    const res = await fetch('/api/escritorios');
    const d = await res.json();
    if (res.ok) setEscritorios(d.escritorios ?? []);
  }
  useEffect(() => { carregarCfg(); carregarUsuarios(); carregarEscritorios(); }, []);

  async function addUsuario() {
    setErro(null); setMsgUser(null); setSavingUser(true);
    try {
      const res = await fetch('/api/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(novo) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsgUser('Usuário salvo.');
      setNovo(vazio);
      carregarUsuarios();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setSavingUser(false); }
  }

  async function removerUsuario(u: Usuario) {
    setErro(null); setMsgUser(null); setAExcluir(null);
    try {
      const res = await fetch(`/api/usuarios?email=${encodeURIComponent(u.email)}`, { method: 'DELETE' });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setDesfazer({ nome: u.nome, ficha: d.desfazer });
      carregarUsuarios();
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
      setMsgUser(`${desfazer.nome} voltou a ter acesso.`);
      setDesfazer(null);
      carregarUsuarios();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  const nomeEscritorio = (id: string | null) => escritorios.find((e) => e.id === id)?.nome ?? 'sem escritório';

  return (
    <div className="text-sm">
      <CabecalhoPagina titulo="Configurações" subtitulo="Área restrita ao administrador" />

      <Toasts>
        {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
        {msgUser && <Toast onFechar={() => setMsgUser(null)}>{msgUser}</Toast>}
        {desfazer && (
          <Toast tom="info" onFechar={() => setDesfazer(null)}
            acao={<Botao tamanho="sm" variante="tonal" onClick={desfazerRemocao}>Desfazer</Botao>}>
            {desfazer.nome} foi removido.
          </Toast>
        )}
      </Toasts>

      <Conteudo largura="estreita">
        {/* Leitura por IA */}
        <Secao titulo="Leitura das folhas por IA"
          descricao="A chave do Gemini é da plataforma e vale para todos os escritórios; cada um consome a cota mensal do seu plano. Para trocar a chave ou o modelo, altere GEMINI_API_KEY e GEMINI_MODELO na Vercel.">
          {ia && (
            <div className="flex flex-wrap items-center gap-2">
              <Selo tom={ia.temChave ? 'sucesso' : 'perigo'}>{ia.temChave ? 'Chave configurada' : 'Chave ausente'}</Selo>
              {ia.modelo && <Selo>{ia.modelo}</Selo>}
            </div>
          )}
        </Secao>

        {/* Usuários */}
        <Secao titulo="Usuários"
          descricao={<>
            Cadastre contadores em qualquer escritório e outros administradores da plataforma. Cada
            <strong> contador</strong> enxerga as empresas do escritório dele; o primeiro de um escritório vira
            o administrador do escritório e cadastra o resto da equipe na tela <strong>Equipe</strong>. Os
            <strong> administradores das empresas</strong> (papel cliente) são criados no módulo <strong>Cadastro</strong>.
          </>}>
          {usuarios.length === 0 ? (
            <EstadoVazio titulo="Nenhum usuário cadastrado" descricao="Adicione o primeiro pelo formulário abaixo." />
          ) : (
            <ul className="divide-y divide-borda rounded-xl border border-borda">
              {usuarios.map((u) => (
                <li key={u.email} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-3.5 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-tinta">{u.nome}</div>
                    <div className="truncate text-xs text-tinta-suave">
                      {u.email}{u.role === 'usuario' && <> · {nomeEscritorio(u.escritorioId)}</>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Selo tom={u.role === 'master' ? 'primaria' : 'neutro'}>
                      {u.adminEscritorio ? 'Admin. do escritório' : ROTULO_PAPEL[u.role]}
                    </Selo>
                    {u.role === 'usuario' && (
                      <span className="hidden text-xs text-tinta-suave sm:inline">
                        {u.modulos.map((m) => ROTULO_MODULO[m]).join(' · ')}
                      </span>
                    )}
                    <BotaoIcone rotulo={`Remover ${u.nome}`} tom="perigo" onClick={() => setAExcluir(u)}>
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
            <Entrada rotulo="Senha" dica={`Mínimo de ${SENHA_MIN} caracteres.`} type="password" autoComplete="new-password" value={novo.senha}
              onChange={(e) => setNovo({ ...novo, senha: e.target.value })} />
            <Selecao rotulo="Papel" valor={novo.role} onChange={(v) => setNovo({ ...novo, role: v as Papel })}
              opcoes={[{ valor: 'usuario', rotulo: 'Contabilidade' }, { valor: 'master', rotulo: 'Administrador' }]} />
            {novo.role === 'usuario' && (
              <Selecao rotulo="Escritório" valor={novo.escritorioId} onChange={(v) => setNovo({ ...novo, escritorioId: v })}
                placeholder="Escolha o escritório…" classeCampo="sm:col-span-2"
                opcoes={escritorios.map((e) => ({ valor: e.id, rotulo: e.nome, detalhe: e.situacao === 'teste' ? 'em teste' : undefined }))} />
            )}
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
          onConfirmar={() => removerUsuario(aExcluir)}
          onCancelar={() => setAExcluir(null)}
        />
      )}
    </div>
  );
}
