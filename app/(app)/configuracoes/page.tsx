'use client';

import { useEffect, useState } from 'react';
import { IconeExcluir } from '../icones';
import { Botao, BotaoIcone, CabecalhoPagina, Carregando, Conteudo, Entrada, EstadoVazio, FalhaCarregamento, Marcacao, Secao, Selo, Tom } from '@/components/ui';
import { lerJson, mensagemDeCarga } from '@/lib/carga';
import type { ItemAmbiente, SituacaoItem } from '@/lib/ambiente';
import { Selecao } from '@/components/selecao';
import { Toast, Toasts } from '@/components/retorno';
import { DialogoConfirmacao } from '../Dialogo';
import { SENHA_MIN } from '@/lib/auth';
import { MedicaoApp } from './Medicao';
import type { SituacaoIa } from '@/lib/ia/cota';

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

const SELO_SITUACAO: Record<SituacaoItem, { tom: Tom; rotulo: string }> = {
  ligado: { tom: 'sucesso', rotulo: 'Ligado' },
  parcial: { tom: 'aviso', rotulo: 'Incompleto' },
  desligado: { tom: 'perigo', rotulo: 'Desligado' },
};

/**
 * "O que está desligado" — as variáveis de ambiente da plataforma, sem valor
 * nenhum: só se estão configuradas e o que destravam (GET /api/config/ambiente).
 */
function OQueEstaDesligado() {
  const [itens, setItens] = useState<ItemAmbiente[] | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const carregar = () => {
    setFalha(null);
    lerJson<{ itens: ItemAmbiente[] }>('/api/config/ambiente', { cache: 'no-store' })
      .then((d) => setItens(d.itens)).catch((e) => setFalha(mensagemDeCarga(e)));
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga da API (zera a falha antes do fetch)
  useEffect(() => { carregar(); }, []);
  const desligados = (itens ?? []).filter((i) => i.situacao !== 'ligado').length;

  return (
    <Secao titulo="O que está desligado"
      descricao="Variáveis da plataforma configuradas na Vercel. Aqui só aparece se cada uma está configurada e o que ela destrava — nunca o valor. Para mudar, altere na Vercel e publique de novo.">
      {falha ? (
        <FalhaCarregamento titulo="Não foi possível conferir as configurações." onTentar={carregar}>{falha}</FalhaCarregamento>
      ) : !itens ? <Carregando /> : (
        <>
          <p className="mb-3 text-[13px] text-tinta-suave" aria-live="polite">
            {desligados === 0 ? 'Tudo ligado.' : desligados === 1 ? '1 item precisa de atenção.' : `${desligados} itens precisam de atenção.`}
          </p>
          <ul className="divide-y divide-borda rounded-xl border border-borda">
            {itens.map((i) => (
              <li key={i.id} className="space-y-1 px-3.5 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-tinta">{i.titulo}</span>
                  <Selo tom={SELO_SITUACAO[i.situacao].tom}>{SELO_SITUACAO[i.situacao].rotulo}</Selo>
                </div>
                <p className="text-[13px] text-tinta">{i.agora}</p>
                <p className="text-xs text-tinta-suave">Destrava: {i.destrava}</p>
                <p className="break-words font-mono text-[11px] text-tinta-fraca">{i.variaveis.join(' · ')}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </Secao>
  );
}

export default function Configuracoes() {
  // --- Leitura por IA (chave da plataforma, só consulta) ---
  const [ia, setIa] = useState<SituacaoIa | null>(null);

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

  // Falha da carga principal (usuários e escritórios): na tela, com "Tentar de novo".
  const [falhaCarga, setFalhaCarga] = useState<string | null>(null);
  async function carregarCfg() {
    try {
      const d = await lerJson('/api/config');
      setIa(d.ia ?? null);
    } catch { /* a situação da IA também aparece em "O que está desligado" */ }
  }
  async function carregarUsuarios() {
    const d = await lerJson<{ usuarios?: Usuario[] }>('/api/usuarios');
    // Os administradores (cliente) são geridos no módulo Cadastro; aqui ficam só
    // os contadores e outros administradores do sistema.
    setUsuarios((d.usuarios ?? []).filter((u: Usuario) => u.role !== 'cliente'));
  }
  async function carregarEscritorios() {
    const d = await lerJson<{ escritorios?: Escritorio[] }>('/api/escritorios');
    setEscritorios(d.escritorios ?? []);
  }
  function carregarTudo() {
    setFalhaCarga(null);
    Promise.all([carregarUsuarios(), carregarEscritorios()]).catch((e) => setFalhaCarga(mensagemDeCarga(e)));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect -- carga da API, só na montagem
  useEffect(() => { carregarCfg(); carregarTudo(); }, []);

  async function addUsuario() {
    setErro(null); setMsgUser(null); setSavingUser(true);
    try {
      const res = await fetch('/api/usuarios', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(novo) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsgUser('Usuário salvo.');
      setNovo(vazio);
      carregarUsuarios().catch((e) => setFalhaCarga(mensagemDeCarga(e)));
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
      carregarUsuarios().catch((e) => setFalhaCarga(mensagemDeCarga(e)));
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
      carregarUsuarios().catch((e) => setFalhaCarga(mensagemDeCarga(e)));
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
        {falhaCarga && (
          <FalhaCarregamento titulo="Não foi possível carregar os usuários." onTentar={carregarTudo}>{falhaCarga}</FalhaCarregamento>
        )}

        <OQueEstaDesligado />

        <MedicaoApp />

        {/* Leitura por IA */}
        <Secao titulo="Leitura por IA"
          descricao="A IA é da plataforma e vale para todos os escritórios (folhas de ponto, documentos do caixa e sugestão de conta); cada escritório consome a cota mensal do seu plano. Para trocar o provedor ou o modelo, altere IA_PROVEDOR, IA_MODELO_CLOUDFLARE ou GEMINI_MODELO na Vercel.">
          {ia && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-tinta">{ia.nome}</span>
                <Selo tom={ia.configurado ? 'sucesso' : 'perigo'}>{ia.configurado ? 'Configurada' : 'Sem credenciais'}</Selo>
                {ia.modelo && <Selo>{ia.modelo}</Selo>}
              </div>
              {ia.cota && (ia.cota.medida ? (
                <p className={`text-[13px] ${ia.cota.nivel === 'ok' ? 'text-tinta-suave' : 'font-medium text-tinta'}`} role="status">
                  Uso de hoje: {ia.cota.usados.toLocaleString('pt-BR')} de {ia.cota.limite.toLocaleString('pt-BR')} neurônios ({ia.cota.percentual}%).{' '}
                  {ia.cota.nivel === 'ok' ? 'A cota gratuita renova às 21h (horário de Brasília).' : ia.cota.mensagem}
                </p>
              ) : (
                <p className="text-[13px] text-tinta-suave">
                  O contador da cota diária ainda não está instalado (falta a migração 0036). A leitura funciona; o aviso de 80% não.
                </p>
              ))}
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
