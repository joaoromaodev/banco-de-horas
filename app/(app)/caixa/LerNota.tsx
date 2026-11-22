'use client';

// "Ler nota ou boleto" (Sprint 17, Frente B) — leitura SEM IA: o XML da nota, o
// PDF com texto ou a linha digitável do boleto são lidos no servidor do
// ClickContas, sem mandar nada para fora. O diálogo não grava nada no livro:
// devolve a proposta para a tela preencher o formulário como rascunho (quem lança
// confere e clica em Lançar), com os lançamentos que já vieram do mesmo documento.
import { useEffect, useId, useState } from 'react';
import { Aviso, Botao, CampoArquivo, Carregando, Entrada, Marcacao } from '@/components/ui';
import { Selecao } from '@/components/selecao';
import { Modal } from '../Dialogo';
import { ROTULO_CATEGORIA, competenciaBR, type Categoria } from '@/lib/documentos';
import { categoriaLidaPelaIa } from '@/lib/documentoLancamento';
import { tipoLidoSemIa, type LancamentoAnterior, type PropostaLeitura } from '@/lib/leituraSemIa';

import { enviarAoPortal, lerJson, type DocumentoLido } from './LerDocumento';

export interface LeituraSemIa {
  proposta: PropostaLeitura;
  documento: DocumentoLido | null;
  duplicados: LancamentoAnterior[];
  duplicidadeVerificada: boolean;
}

interface DocumentoLista { id: string; nome: string; tipo: string; categoria: Categoria; competencia: string }

const ACCEPT = '.xml,.pdf,application/xml,text/xml,application/pdf';
const CATEGORIAS: Categoria[] = ['nota', 'recibo', 'outros'];

export default function LerNota({ empresaId, ano, mes, onLido, onFechar }: {
  empresaId: string; ano: number; mes: number;
  onLido: (r: LeituraSemIa) => void;
  onFechar: () => void;
}) {
  const titulo = useId();
  const [origem, setOrigem] = useState<'enviar' | 'existente' | 'boleto'>('enviar');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [categoria, setCategoria] = useState<Categoria>('nota');
  const [codigo, setCodigo] = useState('');
  const [direcao, setDirecao] = useState<'saida' | 'entrada' | ''>('');
  const [docs, setDocs] = useState<DocumentoLista[] | null>(null);
  const [docSel, setDocSel] = useState('');
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Os documentos já enviados que dá para ler sem IA (XML ou PDF; nota, recibo ou outros).
  useEffect(() => {
    fetch(`/api/documentos?empresa=${encodeURIComponent(empresaId)}`)
      .then(lerJson)
      .then((d) => setDocs(((d.documentos ?? []) as DocumentoLista[]).filter((x) => tipoLidoSemIa(x.tipo) && categoriaLidaPelaIa(x.categoria)).slice(0, 40)))
      .catch(() => setDocs([]));
  }, [empresaId]);

  const competencia = `${ano}-${String(mes).padStart(2, '0')}`;

  async function ler() {
    setErro(null);
    setLendo(true);
    try {
      const corpo: Record<string, unknown> = { empresa: empresaId, ano, direcao: direcao || null };
      if (origem === 'boleto') {
        if (codigo.replace(/\D/g, '').length < 44) throw new Error('Digite os números da linha digitável do boleto (47 ou 48) ou do código de barras (44).');
        corpo.codigo = codigo;
      } else if (origem === 'enviar') {
        if (!arquivo) throw new Error('Escolha o XML ou o PDF da nota.');
        corpo.documento = (await enviarAoPortal(arquivo, {
          empresaId, competencia, categoria, aceita: tipoLidoSemIa,
          erroTipo: 'Sem IA dá para ler o XML da nota ou um PDF. Foto, lance à mão.',
        })).id;
      } else {
        if (!docSel) throw new Error('Escolha um dos documentos já enviados.');
        corpo.documento = docSel;
      }
      const d = await fetch('/api/caixa/documento-leitura', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
      }).then(lerJson);
      if (!d.proposta) throw new Error(d.aviso || 'Não foi possível ler este documento. Preencha à mão.');
      onLido({
        proposta: d.proposta, documento: d.documento ?? null,
        duplicados: d.duplicados ?? [], duplicidadeVerificada: !!d.duplicidadeVerificada,
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setLendo(false);
    }
  }

  return (
    <Modal onFechar={() => { if (!lendo) onFechar(); }} rotuladoPor={titulo} largura="max-w-lg">
      <div className="space-y-4 p-5">
        <div>
          <h2 id={titulo} className="text-base font-semibold text-tinta">Ler nota ou boleto</h2>
          <p className="mt-1 text-[13px] text-tinta-suave">
            Lemos o XML da nota, o PDF ou o código do boleto e preenchemos um rascunho do lançamento.
            Nada entra no livro antes de você conferir e clicar em <strong>Lançar</strong>.
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-tinta-suave">O que você tem?</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            <Marcacao type="radio" name="origem-nota" checked={origem === 'enviar'} onChange={() => setOrigem('enviar')} data-foco-inicial="">
              Arquivo da nota (XML ou PDF)
            </Marcacao>
            <Marcacao type="radio" name="origem-nota" checked={origem === 'existente'} onChange={() => setOrigem('existente')}>
              Já enviado em Documentos
            </Marcacao>
            <Marcacao type="radio" name="origem-nota" checked={origem === 'boleto'} onChange={() => setOrigem('boleto')}>
              Código do boleto
            </Marcacao>
          </div>

          {origem === 'enviar' ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <CampoArquivo accept={ACCEPT} nome={arquivo?.name} onArquivo={setArquivo}
                texto="XML ou PDF da nota" dica={`Fica também em Documentos, em ${competenciaBR(competencia)}.`} />
              <Selecao aria-label="Categoria do documento" largura="w-full sm:w-40" busca={false} valor={categoria}
                onChange={(v) => setCategoria(v as Categoria)}
                opcoes={CATEGORIAS.map((c) => ({ valor: c, rotulo: ROTULO_CATEGORIA[c] }))} />
            </div>
          ) : origem === 'boleto' ? (
            <Entrada rotulo="Linha digitável ou código de barras" value={codigo} onChange={(e) => setCodigo(e.target.value)}
              inputMode="numeric" autoComplete="off" spellCheck={false} placeholder="Os números embaixo do código de barras"
              dica="Pode colar com pontos e espaços. Conferimos todos os dígitos." />
          ) : docs === null ? (
            <Carregando />
          ) : docs.length === 0 ? (
            <p className="text-[13px] text-tinta-suave">Nenhum XML ou PDF de nota, recibo ou outros enviado ainda para esta empresa.</p>
          ) : (
            <Selecao aria-label="Documento já enviado" valor={docSel} onChange={setDocSel} placeholder="Escolha o documento"
              opcoes={docs.map((d) => ({ valor: d.id, rotulo: d.nome, detalhe: `${ROTULO_CATEGORIA[d.categoria] ?? d.categoria} · ${competenciaBR(d.competencia)}` }))} />
          )}
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-tinta-suave">É um pagamento ou um recebimento?</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            <Marcacao type="radio" name="direcao-nota" checked={direcao === 'saida'} onChange={() => setDirecao('saida')}>
              Pagamento (saída)
            </Marcacao>
            <Marcacao type="radio" name="direcao-nota" checked={direcao === 'entrada'} onChange={() => setDirecao('entrada')}>
              Recebimento (entrada)
            </Marcacao>
            <Marcacao type="radio" name="direcao-nota" checked={direcao === ''} onChange={() => setDirecao('')}>
              Descobrir pelo documento
            </Marcacao>
          </div>
          <p className="mt-1.5 text-xs text-tinta-suave">
            Na nota, o CNPJ da empresa diz: emitida por ela é venda (entrada); recebida por ela é compra (saída). Boleto é pagamento.
          </p>
        </fieldset>

        <p className="text-xs text-tinta-suave">
          A leitura é feita aqui mesmo, no ClickContas: o arquivo não vai para nenhuma IA nem serviço de fora e não conta na cota de IA.
        </p>

        {erro && <Aviso tom="perigo">{erro}</Aviso>}
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-borda bg-superficie-suave px-5 py-3 sm:flex-row sm:justify-end">
        <Botao variante="fantasma" onClick={onFechar} disabled={lendo}>Cancelar</Botao>
        <Botao variante="primaria" onClick={ler} carregando={lendo}>
          {lendo ? 'Lendo…' : 'Ler'}
        </Botao>
      </div>
    </Modal>
  );
}
