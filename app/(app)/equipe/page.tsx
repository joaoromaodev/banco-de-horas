'use client';

// Equipe do escritório — tela do administrador do escritório (o primeiro
// contador, quem criou a conta). Ele cadastra os outros contadores; os
// administradores das empresas-clientes continuam no módulo Cadastro.
import { useEffect, useState } from 'react';
import { IconeExcluir } from '../icones';
import {
  Aviso, Botao, BotaoIcone, CabecalhoPagina, Carregando, Conteudo, Entrada, EstadoVazio, FalhaCarregamento, Marcacao, Secao, Selo,
} from '@/components/ui';
import { lerJson, mensagemDeCarga } from '@/lib/carga';
import { Toast, Toasts } from '@/components/retorno';
import { DialogoConfirmacao } from '../Dialogo';
import { SENHA_MIN } from '@/lib/auth';
import { lerMe } from '@/lib/meCliente';

type Modulo = 'ponto' | 'caixa';
interface Usuario { email: string; nome: string; role: 'master' | 'usuario' | 'cliente'; modulos: Modulo[]; adminEscritorio: boolean; }
interface Me {
  email: string; role: string; modulos: Modulo[]; adminEscritorio?: boolean;
  escritorio?: { nome: string; plano: string; situacao: 'teste' | 'ativo' | 'suspenso'; testeAte: string | null } | null;
}

const ROTULO_MODULO: Record<Modulo, string> = { caixa: 'Livro Caixa', ponto: 'Folha de Ponto' };
const ROTULO_SITUACAO = { teste: 'Em teste', ativo: 'Ativo', suspenso: 'Suspenso' } as const;
const TOM_SITUACAO = { teste: 'aviso', ativo: 'sucesso', suspenso: 'perigo' } as const;
const ROTULO_PLANO: Record<string, string> = {
  teste: 'Teste grátis', essencial: 'Essencial', escritorio: 'Escritório', ilimitado: 'Ilimitado', fundador: 'Fundador',
};

const novoVazio = (modulos: Modulo[]) => ({ nome: '', email: '', senha: '', modulos });

export default function Equipe() {
  const [me, setMe] = useState<Me | null>(null);
  const [equipe, setEquipe] = useState<Usuario[] | null>(null);
  const [novo, setNovo] = useState(novoVazio(['caixa']));
  const [salvando, setSalvando] = useState(false);
  const [aExcluir, setAExcluir] = useState<Usuario | null>(null);
  const [desfazer, setDesfazer] = useState<{ nome: string; ficha: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // Os clientes (administradores das empresas) ficam no módulo Cadastro.
  const lerEquipe = () => lerJson<{ usuarios?: Usuario[] }>('/api/usuarios')
    .then((d) => (d.usuarios ?? []).filter((u: Usuario) => u.role === 'usuario'));
  const falhou = (e: unknown) => setErro(mensagemDeCarga(e));
  const carregar = () => lerEquipe().then(setEquipe).catch(falhou);
  // Falha da carga inicial: fica no lugar da lista, com "Tentar de novo" (antes, "Carregando…" para sempre).
  const [falhaEquipe, setFalhaEquipe] = useState<string | null>(null);
  const carregarInicial = () => {
    setFalhaEquipe(null);
    lerEquipe().then(setEquipe).catch((e) => setFalhaEquipe(mensagemDeCarga(e)));
  };

  useEffect(() => {
    lerMe().then((d: Me | null) => {
      if (!d) return;
      setMe(d);
      setNovo(novoVazio(d.modulos.includes('caixa') ? ['caixa'] : d.modulos));
    }).catch(() => {}); // lerMe nunca rejeita
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga da API; zerar erro/espera/dados antigos antes do fetch é intencional
    carregarInicial();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na montagem
  }, []);

  async function adicionar() {
    setErro(null); setMsg(null); setSalvando(true);
    try {
      const r = await fetch('/api/usuarios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...novo, role: 'usuario' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      setMsg(`${novo.nome} já pode entrar com o e-mail ${novo.email}.`);
      setNovo(novoVazio(novo.modulos));
      carregar();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setSalvando(false); }
  }

  async function remover(u: Usuario) {
    setErro(null); setMsg(null); setAExcluir(null);
    try {
      const r = await fetch(`/api/usuarios?email=${encodeURIComponent(u.email)}`, { method: 'DELETE' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      setDesfazer({ nome: u.nome, ficha: d.desfazer });
      carregar();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  async function desfazerRemocao() {
    if (!desfazer) return;
    setErro(null);
    try {
      const r = await fetch('/api/usuarios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurar: desfazer.ficha }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      setMsg(`${desfazer.nome} voltou para a equipe.`);
      setDesfazer(null);
      carregar();
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  const esc = me?.escritorio;
  const ehAdmin = Boolean(me?.adminEscritorio);
  const meusModulos: Modulo[] = me?.modulos ?? [];

  return (
    <div className="text-sm">
      <CabecalhoPagina titulo="Equipe" subtitulo={esc ? esc.nome : 'Contadores do seu escritório'} />

      <Toasts>
        {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
        {msg && <Toast onFechar={() => setMsg(null)}>{msg}</Toast>}
        {desfazer && (
          <Toast tom="info" onFechar={() => setDesfazer(null)}
            acao={<Botao tamanho="sm" variante="tonal" onClick={desfazerRemocao}>Desfazer</Botao>}>
            {desfazer.nome} foi removido da equipe.
          </Toast>
        )}
      </Toasts>

      <Conteudo largura="estreita">
        {esc && (
          <Secao titulo="Escritório">
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs text-tinta-suave">Plano</dt>
                <dd className="mt-1 font-medium text-tinta">{ROTULO_PLANO[esc.plano] ?? esc.plano}</dd>
              </div>
              <div>
                <dt className="text-xs text-tinta-suave">Situação</dt>
                <dd className="mt-1"><Selo tom={TOM_SITUACAO[esc.situacao]}>{ROTULO_SITUACAO[esc.situacao]}</Selo></dd>
              </div>
              {esc.situacao === 'teste' && esc.testeAte && (
                <div>
                  <dt className="text-xs text-tinta-suave">Teste até</dt>
                  <dd className="mt-1 font-medium text-tinta">{new Date(esc.testeAte).toLocaleDateString('pt-BR')}</dd>
                </div>
              )}
            </dl>
          </Secao>
        )}

        <Secao titulo="Contadores"
          descricao={<>Todos enxergam as empresas-clientes do escritório. Os <strong>administradores das empresas</strong> (quem
            lança o Livro Caixa) são cadastrados no módulo <strong>Cadastro</strong>.</>}>
          {equipe === null && falhaEquipe ? (
            <FalhaCarregamento titulo="Não foi possível carregar a equipe." onTentar={carregarInicial}>{falhaEquipe}</FalhaCarregamento>
          ) : equipe === null ? (
            <Carregando />
          ) : equipe.length === 0 ? (
            <EstadoVazio titulo="Ninguém na equipe ainda" descricao="Adicione o primeiro contador pelo formulário abaixo." />
          ) : (
            <ul className="divide-y divide-borda rounded-xl border border-borda">
              {equipe.map((u) => {
                const souEu = u.email === me?.email;
                return (
                  <li key={u.email} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-3.5 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-tinta">{u.nome}{souEu && <span className="font-normal text-tinta-suave"> (você)</span>}</div>
                      <div className="truncate text-xs text-tinta-suave">{u.email}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {u.adminEscritorio && <Selo tom="primaria">Administrador</Selo>}
                      <span className="hidden text-xs text-tinta-suave sm:inline">
                        {u.modulos.map((m) => ROTULO_MODULO[m]).join(' · ')}
                      </span>
                      {ehAdmin && !souEu && (
                        <BotaoIcone rotulo={`Remover ${u.nome}`} tom="perigo" onClick={() => setAExcluir(u)}>
                          <IconeExcluir size={16} />
                        </BotaoIcone>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {me && !ehAdmin && (
            <Aviso tom="neutro" className="mt-5">Só o administrador do escritório cadastra contadores.</Aviso>
          )}

          {ehAdmin && (
            <>
              <h3 className="mb-3 mt-6 text-[13px] font-semibold text-tinta">Novo contador</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Entrada rotulo="Nome" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
                <Entrada rotulo="E-mail" type="email" autoComplete="off" value={novo.email}
                  onChange={(e) => setNovo({ ...novo, email: e.target.value })} />
                <Entrada rotulo="Senha inicial" dica={`Mínimo de ${SENHA_MIN} caracteres. Combine com a pessoa.`} type="password"
                  autoComplete="new-password" value={novo.senha} onChange={(e) => setNovo({ ...novo, senha: e.target.value })} />
              </div>
              {meusModulos.length > 1 && (
                <fieldset className="mt-5">
                  <legend className="text-[13px] font-medium text-tinta">Módulos liberados</legend>
                  <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-2">
                    {meusModulos.map((m) => (
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
                <Botao variante="primaria" onClick={adicionar} carregando={salvando}
                  disabled={!novo.nome.trim() || !novo.email.trim() || novo.senha.length < SENHA_MIN || novo.modulos.length === 0}>
                  {salvando ? 'Salvando…' : 'Adicionar contador'}
                </Botao>
              </div>
            </>
          )}
        </Secao>
      </Conteudo>

      {aExcluir && (
        <DialogoConfirmacao
          titulo="Remover contador"
          mensagem={<>Remover <strong>{aExcluir.nome}</strong> ({aExcluir.email}) da equipe? A pessoa perde o acesso ao sistema.</>}
          textoConfirmar="Remover"
          onConfirmar={() => remover(aExcluir)}
          onCancelar={() => setAExcluir(null)}
        />
      )}
    </div>
  );
}
