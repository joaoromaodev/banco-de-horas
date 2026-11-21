'use client';

// Escritório — dados, responsável técnico e preferências do escritório.
// O administrador edita; os demais contadores veem (somente leitura). Regras em
// lib/escritorioConfig.ts; ver docs/multi-escritorio.md ("Configurações do escritório").
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Alternador, Aviso, Botao, botaoCls, CabecalhoPagina, Carregando, Conteudo, Entrada, Marcacao, Secao } from '@/components/ui';
import { Toast, Toasts } from '@/components/retorno';
import { DialogoConfirmacao } from '../Dialogo';
import { cnpjValido, crcValido, formatarCnpj } from '@/lib/escritorioConfig';
import { DIA_PRAZO_MAX, DIA_PRAZO_MIN } from '@/lib/fechamento';

interface Esc {
  id: string; nome: string; cnpj: string | null;
  contabilistaNome: string; contabilistaCrc: string; prazoPedidosPadrao: number;
}
interface Contagem { total: number; semContabilista: number }
interface Aplicada { empresaId: string; crcAnterior: string }
type Freq = 'diario' | 'semanal' | 'desligado';
interface ConfigAviso { frequencia: Freq; destinatarios: string[] }
interface Membro { email: string; nome: string; admin: boolean }
interface DadosAviso { aviso: ConfigAviso; equipe: Membro[]; efetivos: string[]; podeEditar: boolean; provedor: 'resend' | 'nenhum' }

async function chamar(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro ?? 'Algo deu errado. Tente de novo.');
  return d;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export default function EscritorioPage() {
  const [esc, setEsc] = useState<Esc | null>(null);
  const [podeEditar, setPodeEditar] = useState(false);
  const [empresas, setEmpresas] = useState<Contagem>({ total: 0, semContabilista: 0 });
  const [form, setForm] = useState({ nome: '', cnpj: '', contabilistaNome: '', contabilistaCrc: '', prazo: '10' });
  const [aviso, setAviso] = useState<DadosAviso | null>(null);
  const [freq, setFreq] = useState<Freq>('semanal');
  const [dest, setDest] = useState<Set<string>>(new Set());
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [desfazer, setDesfazer] = useState<{ nome: string; aplicadas: Aplicada[]; n: number } | null>(null);
  const [tocou, setTocou] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function preencher(e: Esc) {
    setEsc(e);
    setForm({ nome: e.nome, cnpj: e.cnpj ? formatarCnpj(e.cnpj) : '', contabilistaNome: e.contabilistaNome, contabilistaCrc: e.contabilistaCrc, prazo: String(e.prazoPedidosPadrao) });
  }
  function preencherAviso(d: DadosAviso) {
    setAviso(d);
    setFreq(d.aviso.frequencia === 'desligado' ? 'semanal' : d.aviso.frequencia);
    setDest(new Set(d.aviso.destinatarios));
  }

  useEffect(() => {
    Promise.all([
      chamar('/api/escritorio'),
      chamar('/api/agenda/avisos').catch(() => null),
    ]).then(([e, a]) => {
      preencher(e.escritorio); setPodeEditar(e.podeEditar); setEmpresas(e.empresas);
      if (a) preencherAviso(a);
    }).catch((err) => setErro(err instanceof Error ? err.message : 'Não foi possível carregar.'))
      .finally(() => setCarregando(false));
  }, []);

  const erros = useMemo(() => {
    const e: Record<string, string> = {};
    if (!form.nome.trim()) e.nome = 'Informe o nome do escritório.';
    if (form.cnpj.trim() && !cnpjValido(form.cnpj)) e.cnpj = 'Esse CNPJ não confere. Veja se digitou todos os números.';
    if (form.contabilistaCrc.trim() && !crcValido(form.contabilistaCrc)) e.contabilistaCrc = 'Esse CRC parece incompleto. Exemplo: PA-012345/O-1.';
    if (form.contabilistaCrc.trim() && !form.contabilistaNome.trim()) e.contabilistaNome = 'Diga o nome de quem assina junto com o CRC.';
    const p = Number(form.prazo);
    if (!Number.isInteger(p) || p < DIA_PRAZO_MIN || p > DIA_PRAZO_MAX) e.prazo = `O dia vai de ${DIA_PRAZO_MIN} a ${DIA_PRAZO_MAX}.`;
    return e;
  }, [form]);
  const ver = (c: string) => (tocou[c] ? erros[c] : undefined);
  const campo = (c: keyof typeof form) => ({
    value: form[c], disabled: !podeEditar,
    onChange: (ev: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [c]: ev.target.value })),
    onBlur: () => setTocou((t) => ({ ...t, [c]: true })),
  });
  const sujo = esc != null && (
    form.nome.trim() !== esc.nome || form.cnpj.replace(/\D/g, '') !== (esc.cnpj ?? '') ||
    form.contabilistaNome.trim() !== esc.contabilistaNome || form.contabilistaCrc.trim() !== esc.contabilistaCrc ||
    Number(form.prazo) !== esc.prazoPedidosPadrao
  );

  async function salvar() {
    setTocou({ nome: true, cnpj: true, contabilistaNome: true, contabilistaCrc: true, prazo: true });
    if (Object.keys(erros).length) return;
    setErro(null); setMsg(null); setSalvando('dados');
    try {
      const d = await chamar('/api/escritorio', json('PATCH', {
        nome: form.nome, cnpj: form.cnpj, contabilistaNome: form.contabilistaNome,
        contabilistaCrc: form.contabilistaCrc, prazoPedidosPadrao: Number(form.prazo),
      }));
      preencher(d.escritorio); setEmpresas(d.empresas); setTocou({});
      setMsg('Configurações salvas.');
    } catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível salvar.'); }
    finally { setSalvando(null); }
  }

  async function aplicar() {
    setConfirmando(false); setErro(null); setMsg(null); setSalvando('aplicar');
    try {
      const d = await chamar('/api/escritorio/responsavel', json('POST', {}));
      setEmpresas(d.empresas);
      if (!d.aplicadas.length) setMsg('Todas as empresas já tinham contabilista. Nada mudou.');
      else setDesfazer({ nome: d.nome, aplicadas: d.aplicadas, n: d.aplicadas.length });
    } catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível aplicar.'); }
    finally { setSalvando(null); }
  }

  async function desfazerAplicacao() {
    if (!desfazer) return;
    const d = desfazer; setDesfazer(null); setErro(null);
    try {
      const r = await chamar('/api/escritorio/responsavel', json('PATCH', { nome: d.nome, aplicadas: d.aplicadas }));
      setEmpresas(r.empresas); setMsg('Desfeito. As empresas voltaram a ficar sem contabilista.');
    } catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível desfazer.'); }
  }

  async function salvarAviso(proximo: ConfigAviso) {
    setErro(null); setMsg(null); setSalvando('aviso');
    try {
      const d = await chamar('/api/agenda/avisos', json('PUT', proximo));
      setAviso((a) => (a ? { ...a, aviso: d.aviso, efetivos: d.efetivos } : a));
      setMsg(proximo.frequencia === 'desligado' ? 'Resumo por e-mail desligado.' : 'Resumo por e-mail salvo.');
    } catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível salvar o aviso.'); }
    finally { setSalvando(null); }
  }

  if (carregando) return <div className="p-6"><Carregando /></div>;
  if (!esc) return <Conteudo largura="estreita"><Aviso tom="perigo">{erro ?? 'Não foi possível carregar o escritório.'}</Aviso></Conteudo>;

  const ligado = aviso?.aviso.frequencia !== 'desligado';
  const podeAviso = podeEditar && aviso?.podeEditar;

  return (
    <div className="text-sm">
      <CabecalhoPagina titulo="Escritório" subtitulo={esc.nome} />

      <Toasts>
        {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
        {msg && <Toast onFechar={() => setMsg(null)}>{msg}</Toast>}
        {desfazer && (
          <Toast tom="info" onFechar={() => setDesfazer(null)}
            acao={<Botao tamanho="sm" variante="tonal" onClick={desfazerAplicacao}>Desfazer</Botao>}>
            {desfazer.nome} agora consta em {desfazer.n} {desfazer.n === 1 ? 'empresa' : 'empresas'}.
          </Toast>
        )}
      </Toasts>

      <Conteudo largura="estreita">
        {!podeEditar && (
          <Aviso tom="info">Só quem administra o escritório pode alterar estas configurações. Você pode consultá-las aqui.</Aviso>
        )}

        <Secao titulo="Dados do escritório" descricao="Como o escritório aparece no sistema e nos e-mails enviados.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Entrada rotulo="Nome do escritório" classeCampo="sm:col-span-2" autoComplete="organization" erro={ver('nome')} {...campo('nome')} />
            <Entrada rotulo="CNPJ" inputMode="numeric" placeholder="00.000.000/0000-00" dica="Opcional."
              erro={ver('cnpj')} {...campo('cnpj')} />
          </div>
        </Secao>

        <Secao titulo="Responsável técnico"
          descricao="Quem assina como contabilista nos documentos das empresas, como o Termo de Abertura do Livro Caixa. Vale para empresas que ainda não têm contabilista próprio. As que já têm o seu continuam como estão.">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Entrada rotulo="Contabilista" autoComplete="name" erro={ver('contabilistaNome')} {...campo('contabilistaNome')} />
            <Entrada rotulo="CRC" placeholder="PA-012345/O-1" erro={ver('contabilistaCrc')} {...campo('contabilistaCrc')} />
          </div>
          {podeEditar && (
            <div className="mt-5 rounded-lg border border-borda bg-superficie-suave p-3.5">
              <p className="text-tinta">
                {empresas.semContabilista === 0
                  ? 'Todas as empresas já têm contabilista preenchido.'
                  : `${empresas.semContabilista} de ${empresas.total} ${empresas.total === 1 ? 'empresa está' : 'empresas estão'} sem contabilista.`}
              </p>
              <p className="mt-1 text-[13px] text-tinta-suave">
                Elas já saem com o responsável acima nos documentos. Se preferir, grave o nome no cadastro de cada uma, para ele não mudar caso você troque o responsável depois.
              </p>
              <Botao className="mt-3" variante="secundaria" tamanho="sm"
                disabled={sujo || !esc.contabilistaNome || empresas.semContabilista === 0 || salvando !== null}
                onClick={() => setConfirmando(true)}>
                Gravar nas empresas sem contabilista
              </Botao>
              {sujo && <p className="mt-2 text-[13px] text-tinta-suave">Salve as alterações antes de gravar nas empresas.</p>}
              {!sujo && !esc.contabilistaNome && <p className="mt-2 text-[13px] text-tinta-suave">Preencha e salve o nome do responsável primeiro.</p>}
            </div>
          )}
        </Secao>

        <Secao titulo="Preferências" descricao="Valores que o sistema usa por padrão para o seu escritório.">
          <Entrada rotulo="Prazo padrão dos pedidos mensais" type="number" min={DIA_PRAZO_MIN} max={DIA_PRAZO_MAX} largura="w-28"
            dica={`Dia do mês, de ${DIA_PRAZO_MIN} a ${DIA_PRAZO_MAX}. Aparece já preenchido ao criar um pedido mensal novo. Pedidos que você já configurou não mudam.`}
            erro={ver('prazo')} {...campo('prazo')} />
        </Secao>

        {podeEditar && (
          <div className="flex justify-end">
            <Botao variante="primaria" onClick={salvar} disabled={!sujo || salvando !== null}>
              {salvando === 'dados' ? 'Salvando…' : 'Salvar alterações'}
            </Botao>
          </div>
        )}

        <Secao titulo="Resumo da agenda por e-mail"
          descricao="Um e-mail com o que está atrasado, vence hoje e vem aí nos próximos dias. Só chega para quem for da equipe.">
          {!aviso ? <p className="text-tinta-suave">Não foi possível carregar esta preferência agora.</p> : (
            <div className="space-y-4">
              {aviso.provedor === 'nenhum' && (
                <Aviso tom="aviso">O envio de e-mails ainda não está ligado neste ambiente. A preferência fica guardada para quando estiver.</Aviso>
              )}
              <Alternador checked={ligado} disabled={!podeAviso || salvando !== null}
                onChange={(e) => salvarAviso({ frequencia: e.target.checked ? freq : 'desligado', destinatarios: [...dest] })}>
                Receber o resumo por e-mail
              </Alternador>
              {ligado && (
                <>
                  <fieldset className="space-y-2" disabled={!podeAviso || salvando !== null}>
                    <legend className="mb-1.5 text-[13px] font-medium text-tinta">Com que frequência</legend>
                    {([['semanal', 'Toda semana (segunda-feira)'], ['diario', 'Todo dia útil']] as const).map(([v, t]) => (
                      <Marcacao key={v} type="radio" name="freq" className="block" checked={freq === v}
                        onChange={() => { setFreq(v); salvarAviso({ frequencia: v, destinatarios: [...dest] }); }}>{t}</Marcacao>
                    ))}
                  </fieldset>
                  <fieldset className="space-y-2" disabled={!podeAviso || salvando !== null}>
                    <legend className="mb-1.5 text-[13px] font-medium text-tinta">Quem recebe</legend>
                    {aviso.equipe.map((m) => (
                      <Marcacao key={m.email} type="checkbox" className="block" checked={dest.has(m.email)}
                        onChange={(ev) => {
                          const n = new Set(dest); if (ev.target.checked) n.add(m.email); else n.delete(m.email);
                          setDest(n); salvarAviso({ frequencia: freq, destinatarios: [...n] });
                        }}>
                        {m.nome}{m.nome !== m.email && <span className="text-tinta-suave"> · {m.email}</span>}{m.admin && <span className="text-tinta-suave"> · administrador</span>}
                      </Marcacao>
                    ))}
                    <p className="text-[13px] text-tinta-suave">
                      {dest.size === 0
                        ? 'Ninguém marcado: o resumo vai para os administradores do escritório.'
                        : `O resumo vai para ${aviso.efetivos.length} ${aviso.efetivos.length === 1 ? 'pessoa' : 'pessoas'}.`}
                    </p>
                  </fieldset>
                </>
              )}
            </div>
          )}
        </Secao>

        {podeEditar && (
          <Secao titulo="Equipe" descricao="Quem trabalha no escritório e o que cada pessoa acessa."
            acoes={<Link href="/equipe" className={botaoCls({ variante: 'secundaria', tamanho: 'sm' })}>Abrir equipe</Link>}>
            <p className="text-tinta-suave">Adicione contadores, ajuste os módulos de cada um ou remova quem saiu.</p>
          </Secao>
        )}
      </Conteudo>

      {confirmando && (
        <DialogoConfirmacao perigo={false} titulo="Gravar o responsável nas empresas?" textoConfirmar="Gravar"
          mensagem={<>
            {esc.contabilistaNome}{esc.contabilistaCrc ? ` (CRC ${esc.contabilistaCrc})` : ''} será gravado como contabilista de {empresas.semContabilista}{' '}
            {empresas.semContabilista === 1 ? 'empresa' : 'empresas'} que ainda não têm. Quem já tem contabilista não muda. Você poderá desfazer logo em seguida.
          </>}
          onConfirmar={aplicar} onCancelar={() => setConfirmando(false)} />
      )}
    </div>
  );
}
