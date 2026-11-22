'use client';

// Criar a conta analítica ali mesmo, no extrato (Sprint 18 · A). Empresa nova não tem
// analítica nenhuma e a contadora ficava sem conta para escolher. Reaproveita o
// cadastro que já existe: POST /api/caixa/historicos (só a contabilidade, natureza
// vinda da conta titular, já vinculada à empresa) — o mesmo do "Novo lançamento".
// Sem conta titular da natureza certa, leva ao Plano de Contas em Cadastros.
import { useId, useState } from 'react';
import Link from 'next/link';
import { Aviso, Botao, Entrada } from '@/components/ui';
import { Selecao } from '@/components/selecao';
import { lerJson, mensagemDeCarga } from '@/lib/carga';
import { Modal } from '../../Dialogo';

export interface ContaTitular { id: string; codigo: string; nome: string; natureza?: 'receita' | 'despesa' }
export interface AnaliticaCriada { id: string; texto: string; contaId: string | null; natureza: 'receita' | 'despesa' }

/** Titulares que servem para a natureza da linha (entrada = receita; saída = despesa). Puro. */
export function titularesDaNatureza<C extends ContaTitular>(contas: C[], natureza: 'receita' | 'despesa'): C[] {
  return contas.filter((c) => !c.natureza || c.natureza === natureza)
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }));
}

export function NovaAnalitica({ empresa, natureza, contas, textoInicial, onCriada, onCancelar }: {
  empresa: string; natureza: 'receita' | 'despesa'; contas: ContaTitular[]; textoInicial: string;
  onCriada: (a: AnaliticaCriada) => void; onCancelar: () => void;
}) {
  const id = useId();
  const [texto, setTexto] = useState(textoInicial.slice(0, 120));
  const opcoes = titularesDaNatureza(contas, natureza);
  const [contaId, setContaId] = useState(opcoes.length === 1 ? opcoes[0].id : '');
  const [erros, setErros] = useState<{ texto?: string; conta?: string; geral?: string }>({});
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    const t = texto.trim();
    const e = { texto: t ? undefined : 'Escreva o nome da conta analítica.', conta: contaId ? undefined : 'Escolha a conta titular.' };
    if (e.texto || e.conta) { setErros(e); return; }
    setSalvando(true); setErros({});
    try {
      const d = await lerJson<{ historico?: AnaliticaCriada }>('/api/caixa/historicos', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ empresa, texto: t, contaId }),
      });
      if (d.historico) onCriada({ ...d.historico, natureza: d.historico.natureza ?? natureza });
      else setErros({ geral: 'Não foi possível criar a conta agora. Tente de novo.' });
    } catch (x) {
      setErros({ geral: mensagemDeCarga(x) });
    } finally {
      setSalvando(false);
    }
  }

  const tipo = natureza === 'receita' ? 'entrada (receita)' : 'saída (despesa)';
  return (
    <Modal onFechar={onCancelar} rotuladoPor={id} largura="max-w-lg">
      <div className="space-y-4 p-5">
        <div>
          <h2 id={id} className="text-base font-semibold text-tinta">Criar conta analítica</h2>
          <p className="mt-1 text-[13px] text-tinta-suave">
            Para esta linha de {tipo}. A conta fica no catálogo do escritório e já entra na lista desta empresa.
          </p>
        </div>
        {opcoes.length === 0 ? (
          <Aviso tom="aviso" titulo={`Falta uma conta titular de ${tipo}`}
            acao={<Link href="/caixa/cadastros" className="inline-flex min-h-11 items-center font-medium text-primaria-texto underline sm:min-h-0">Abrir o Plano de Contas</Link>}>
            A analítica fica sob uma conta titular. Cadastre a titular em Cadastros e volte ao extrato.
          </Aviso>
        ) : (
          <>
            <Entrada rotulo="Nome da conta analítica" value={texto} maxLength={120} data-foco-inicial
              placeholder="Ex.: Tarifas bancárias" erro={erros.texto}
              onChange={(ev) => { setTexto(ev.target.value); setErros((x) => ({ ...x, texto: undefined })); }} />
            <Selecao rotulo="Conta titular" valor={contaId} placeholder="Escolha a conta titular" erro={erros.conta}
              onChange={(v) => { setContaId(v); setErros((x) => ({ ...x, conta: undefined })); }}
              opcoes={opcoes.map((c) => ({ valor: c.id, rotulo: `${c.codigo} ${c.nome}` }))} />
          </>
        )}
        {erros.geral && <p className="text-[13px] text-perigo" role="alert">{erros.geral}</p>}
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-borda bg-superficie-suave px-5 py-3 sm:flex-row sm:justify-end">
        <Botao variante="fantasma" onClick={onCancelar}>Cancelar</Botao>
        {opcoes.length > 0 && <Botao variante="primaria" onClick={salvar} carregando={salvando}>Criar e usar nesta linha</Botao>}
      </div>
    </Modal>
  );
}
