'use client';

// Cadastro e edição do empregado (Departamento Pessoal) num diálogo. Valida com as
// mesmas regras do servidor (lib/dp.ts) antes de enviar.
import { useId, useState } from 'react';
import { Modal } from '../Dialogo';
import { Alternador, Aviso, Botao, Entrada } from '@/components/ui';
import { Selecao } from '@/components/selecao';
import {
  avisosEmpregado, cpfFormatado, DIAS_SEMANA_CURTO, ESCALAS, SITUACOES_EMPREGADO, TIPOS_AFASTAMENTO,
  validarEmpregado, type DadosEmpregado, type Empregado,
} from '@/lib/dp';

interface Rascunho {
  nome: string; cpf: string; cargo: string; admissao: string; salarioBase: string; horasSemanais: string;
  escala: string; dsr: string; bancoHoras: boolean; bancoHorasDesde: string; situacao: string; situacaoDesde: string;
  afastamentoTipo: string; aquisitivoBase: string;
}

const deEmpregado = (e?: Empregado | null): Rascunho => ({
  nome: e?.nome ?? '', cpf: cpfFormatado(e?.cpf ?? null), cargo: e?.cargo ?? '', admissao: e?.admissao ?? '',
  salarioBase: e?.salarioBase != null ? e.salarioBase.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '',
  horasSemanais: e?.horasSemanais != null ? String(e.horasSemanais).replace('.', ',') : '',
  escala: e?.escala ?? '', dsr: String(e?.dsr ?? 0), bancoHoras: e?.bancoHoras ?? false, bancoHorasDesde: e?.bancoHorasDesde ?? '',
  situacao: e?.situacao ?? 'ativo', situacaoDesde: e?.situacaoDesde ?? '', afastamentoTipo: e?.afastamentoTipo ?? '',
  aquisitivoBase: e?.aquisitivoBase ?? '',
});

export function FormEmpregado({ empregado, empresaNome, onSalvar, onCancelar }: {
  empregado?: Empregado | null;
  empresaNome: string;
  /** Devolve a mensagem de erro do servidor, se houver. */
  onSalvar: (dados: DadosEmpregado) => Promise<string | null>;
  onCancelar: () => void;
}) {
  const id = useId();
  const [r, setR] = useState<Rascunho>(() => deEmpregado(empregado));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const mudar = <K extends keyof Rascunho>(k: K, v: Rascunho[K]) => setR((a) => ({ ...a, [k]: v }));

  const v = validarEmpregado({ ...r, horasSemanais: r.horasSemanais.replace(',', '.') });
  const avisos = v.ok ? avisosEmpregado(v.dados) : [];

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!v.ok) { setErro(v.erros.join(' ')); return; }
    setSalvando(true); setErro(null);
    const e = await onSalvar(v.dados);
    setSalvando(false);
    if (e) setErro(e);
  }

  return (
    <Modal onFechar={onCancelar} rotuladoPor={id} largura="max-w-2xl">
      <form onSubmit={enviar} noValidate>
        <div className="max-h-[70vh] overflow-y-auto p-5">
          <h2 id={id} className="text-base font-semibold text-tinta">{empregado ? `Editar ${empregado.nome}` : 'Cadastrar empregado'}</h2>
          <p className="mt-1 text-[13px] text-tinta-suave">{empresaNome}</p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Entrada rotulo="Nome completo" value={r.nome} onChange={(e) => mudar('nome', e.target.value)} classeCampo="sm:col-span-2"
              dica={empregado ? 'O Timesheet identifica pelo nome do cadastro do ponto; mudar aqui não renomeia lá.' : 'Use o mesmo nome da folha de ponto para ligar as frequências.'} data-foco-inicial="" />
            <Entrada rotulo="CPF" value={r.cpf} onChange={(e) => mudar('cpf', e.target.value)} inputMode="numeric" placeholder="000.000.000-00" />
            <Entrada rotulo="Cargo / função" value={r.cargo} onChange={(e) => mudar('cargo', e.target.value)} />
            <Entrada rotulo="Admissão" type="date" value={r.admissao} onChange={(e) => mudar('admissao', e.target.value)} />
            <Entrada rotulo="Salário base (R$)" value={r.salarioBase} onChange={(e) => mudar('salarioBase', e.target.value)} inputMode="decimal" placeholder="1.518,00" />
          </div>

          <h3 className="mt-6 text-[13px] font-semibold text-tinta">Jornada contratual</h3>
          <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Entrada rotulo="Horas por semana" value={r.horasSemanais} onChange={(e) => mudar('horasSemanais', e.target.value)} inputMode="decimal" placeholder="44"
              dica="Vazio = calculado da jornada diária do ponto." />
            <Selecao rotulo="Escala" valor={r.escala} onChange={(x) => mudar('escala', x)} placeholder="Não informada"
              opcoes={[{ valor: '', rotulo: 'Não informada' }, ...ESCALAS]} />
            <Selecao rotulo="Repouso semanal" valor={r.dsr} onChange={(x) => mudar('dsr', x)}
              opcoes={DIAS_SEMANA_CURTO.map((d, i) => ({ valor: String(i), rotulo: d }))} />
          </div>
          <div className="mt-4 grid grid-cols-1 items-end gap-4 sm:grid-cols-2">
            <Alternador checked={r.bancoHoras} onChange={(e) => mudar('bancoHoras', e.target.checked)}>Acordo de banco de horas</Alternador>
            {r.bancoHoras && <Entrada rotulo="Vigente desde" type="date" value={r.bancoHorasDesde} onChange={(e) => mudar('bancoHorasDesde', e.target.value)} />}
          </div>

          <h3 className="mt-6 text-[13px] font-semibold text-tinta">Situação</h3>
          <div className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Selecao rotulo="Situação" valor={r.situacao} onChange={(x) => mudar('situacao', x)} opcoes={SITUACOES_EMPREGADO} />
            {r.situacao !== 'ativo' && (
              <Entrada rotulo={r.situacao === 'desligado' ? 'Desligado em' : 'Afastado desde'} type="date" value={r.situacaoDesde}
                onChange={(e) => mudar('situacaoDesde', e.target.value)} />
            )}
            {r.situacao === 'afastado' && (
              <Selecao rotulo="Tipo do afastamento" valor={r.afastamentoTipo} onChange={(x) => mudar('afastamentoTipo', x)} opcoes={TIPOS_AFASTAMENTO} />
            )}
          </div>

          <div className="mt-6">
            <Entrada rotulo="Início do período aquisitivo (opcional)" type="date" value={r.aquisitivoBase} largura="w-full sm:w-64"
              onChange={(e) => mudar('aquisitivoBase', e.target.value)}
              dica="Deixe vazio para usar a admissão. Preencha quando um afastamento longo ou licença zerou o período (CLT art. 133) ou na readmissão." />
          </div>

          {avisos.length > 0 && (
            <Aviso tom="aviso" className="mt-4"><ul className="list-disc pl-4">{avisos.map((a) => <li key={a}>{a}</li>)}</ul></Aviso>
          )}
          {erro && <Aviso tom="perigo" className="mt-4">{erro}</Aviso>}
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-borda bg-superficie-suave px-5 py-3 sm:flex-row sm:justify-end">
          <Botao onClick={onCancelar}>Cancelar</Botao>
          <Botao type="submit" variante="primaria" carregando={salvando}>{empregado ? 'Salvar' : 'Cadastrar'}</Botao>
        </div>
      </form>
    </Modal>
  );
}
