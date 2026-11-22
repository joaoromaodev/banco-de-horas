'use client';

// "Ler documento com IA" (Sprint 12, Frente A): escolhe um documento — enviado
// agora ou já enviado em Documentos — e pede à IA uma PROPOSTA de lançamento.
// O diálogo não grava nada no livro: devolve a proposta para a tela preencher o
// formulário como rascunho (quem lança confere e clica em Lançar).
//
// O envio reaproveita o portal de documentos (0015): POST /api/documentos (URL
// assinada) → PUT direto no Storage → PATCH confirmar (o servidor confere os bytes).
import { useEffect, useId, useState } from 'react';
import { Aviso, Botao, CampoArquivo, Carregando, Marcacao } from '@/components/ui';
import { Selecao } from '@/components/selecao';
import { Modal } from '../Dialogo';
import { ROTULO_CATEGORIA, competenciaBR, validarArquivo, type Categoria } from '@/lib/documentos';
import { categoriaLidaPelaIa, tipoLidoPelaIa, type PropostaDocumento } from '@/lib/documentoLancamento';

export interface DocumentoLido { id: string; nome: string }

interface DocumentoLista { id: string; nome: string; tipo: string; categoria: Categoria; competencia: string }

/** Só foto e PDF (o que a IA lê). */
const ACCEPT_IA = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';
const CATEGORIAS_IA: Categoria[] = ['nota', 'recibo', 'outros'];

export async function lerJson(r: Response) {
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.erro || 'Falha na operação.');
  return d;
}

/**
 * Envia o arquivo ao portal (fica em Documentos, na competência do mês aberto):
 * POST (URL assinada) → PUT no Storage → PATCH confirmar. Usado pela leitura por
 * IA e pela leitura sem IA (LerNota.tsx).
 */
export async function enviarAoPortal(f: File, p: {
  empresaId: string; competencia: string; categoria: Categoria; aceita: (mime: string) => boolean; erroTipo: string;
}): Promise<DocumentoLido> {
  const v = validarArquivo({ nome: f.name, tamanho: f.size, tipo: f.type });
  if (!v.ok) throw new Error(v.erro);
  if (!p.aceita(v.tipo.mime)) throw new Error(p.erroTipo);
  const ini = await fetch('/api/documentos', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ empresa: p.empresaId, competencia: p.competencia, categoria: p.categoria, nome: f.name, tamanho: f.size, tipo: f.type, observacao: 'Enviado pelo Livro Caixa' }),
  }).then(lerJson);
  const corpo = new FormData();
  corpo.append('cacheControl', '3600');
  corpo.append('', new File([f], v.nome, { type: ini.mime }));
  const up = await fetch(ini.url, { method: 'PUT', body: corpo, headers: { 'x-upsert': 'false' } });
  if (!up.ok) throw new Error('O arquivo não subiu. Confira a conexão e tente de novo.');
  await fetch('/api/documentos', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: ini.id, acao: 'confirmar' }),
  }).then(lerJson);
  return { id: ini.id, nome: v.nome };
}

export default function LerDocumento({ empresaId, ano, mes, onLido, onFechar }: {
  empresaId: string; ano: number; mes: number;
  onLido: (r: { proposta: PropostaDocumento; documento: DocumentoLido }) => void;
  onFechar: () => void;
}) {
  const titulo = useId();
  const [origem, setOrigem] = useState<'enviar' | 'existente'>('enviar');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [categoria, setCategoria] = useState<Categoria>('nota');
  const [direcao, setDirecao] = useState<'saida' | 'entrada' | ''>('saida');
  const [docs, setDocs] = useState<DocumentoLista[] | null>(null);
  const [docSel, setDocSel] = useState('');
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Os documentos já enviados que a IA pode ler (foto ou PDF; nota, recibo ou outros), mais novos primeiro.
  useEffect(() => {
    fetch(`/api/documentos?empresa=${encodeURIComponent(empresaId)}`)
      .then(lerJson)
      .then((d) => setDocs(((d.documentos ?? []) as DocumentoLista[]).filter((x) => tipoLidoPelaIa(x.tipo) && categoriaLidaPelaIa(x.categoria)).slice(0, 40)))
      .catch(() => setDocs([]));
  }, [empresaId]);

  const competencia = `${ano}-${String(mes).padStart(2, '0')}`;

  /** Envia o arquivo ao portal (fica em Documentos, na competência do mês aberto). */
  const enviar = (f: File) => enviarAoPortal(f, {
    empresaId, competencia, categoria, aceita: tipoLidoPelaIa, erroTipo: 'A IA lê foto (JPG, PNG, WEBP) ou PDF.',
  });

  async function ler() {
    setErro(null);
    setLendo(true);
    try {
      let documentoId: string;
      if (origem === 'enviar') {
        if (!arquivo) throw new Error('Escolha a foto ou o PDF do documento.');
        documentoId = (await enviar(arquivo)).id;
      } else {
        if (!docSel) throw new Error('Escolha um dos documentos já enviados.');
        documentoId = docSel;
      }
      const d = await fetch('/api/caixa/documento-ia', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa: empresaId, documento: documentoId, ano, direcao: direcao || null }),
      }).then(lerJson);
      if (!d.proposta) throw new Error(d.aviso || 'A IA não conseguiu ler este documento.');
      onLido({ proposta: d.proposta, documento: d.documento });
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
          <h2 id={titulo} className="text-base font-semibold text-tinta">Ler documento com IA</h2>
          <p className="mt-1 text-[13px] text-tinta-suave">
            A IA lê a nota, o recibo, o boleto ou o comprovante e preenche um rascunho do lançamento.
            Nada entra no livro antes de você conferir e clicar em <strong>Lançar</strong>.
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-medium text-tinta-suave">Documento</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            <Marcacao type="radio" name="origem" checked={origem === 'enviar'} onChange={() => setOrigem('enviar')} data-foco-inicial="">
              Enviar agora
            </Marcacao>
            <Marcacao type="radio" name="origem" checked={origem === 'existente'} onChange={() => setOrigem('existente')}>
              Já enviado em Documentos
            </Marcacao>
          </div>

          {origem === 'enviar' ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <CampoArquivo accept={ACCEPT_IA} nome={arquivo?.name} onArquivo={setArquivo}
                texto="Foto ou PDF do documento" dica={`Fica também em Documentos, em ${competenciaBR(competencia)}.`} />
              <Selecao aria-label="Categoria do documento" largura="w-full sm:w-40" busca={false} valor={categoria}
                onChange={(v) => setCategoria(v as Categoria)}
                opcoes={CATEGORIAS_IA.map((c) => ({ valor: c, rotulo: ROTULO_CATEGORIA[c] }))} />
            </div>
          ) : docs === null ? (
            <Carregando />
          ) : docs.length === 0 ? (
            <p className="text-[13px] text-tinta-suave">Nenhuma nota, recibo ou outro documento em foto ou PDF enviado ainda para esta empresa.</p>
          ) : (
            <Selecao aria-label="Documento já enviado" valor={docSel} onChange={setDocSel} placeholder="Escolha o documento"
              opcoes={docs.map((d) => ({ valor: d.id, rotulo: d.nome, detalhe: `${ROTULO_CATEGORIA[d.categoria] ?? d.categoria} · ${competenciaBR(d.competencia)}` }))} />
          )}
        </fieldset>

        <fieldset>
          <legend className="mb-1.5 text-xs font-medium text-tinta-suave">O que é este documento?</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            <Marcacao type="radio" name="direcao" checked={direcao === 'saida'} onChange={() => setDirecao('saida')}>
              Um pagamento (saída)
            </Marcacao>
            <Marcacao type="radio" name="direcao" checked={direcao === 'entrada'} onChange={() => setDirecao('entrada')}>
              Um recebimento (entrada)
            </Marcacao>
            <Marcacao type="radio" name="direcao" checked={direcao === ''} onChange={() => setDirecao('')}>
              Não sei
            </Marcacao>
          </div>
        </fieldset>

        <p className="text-xs text-tinta-suave">
          O arquivo é lido pela IA do Google (Gemini) só para montar a proposta: do PDF vão as duas primeiras páginas, e a foto vai sem a localização e os dados do celular.
          Cada leitura conta na cota mensal de IA do escritório.
        </p>

        {erro && <Aviso tom="perigo">{erro}</Aviso>}
      </div>
      <div className="flex flex-col-reverse gap-2 border-t border-borda bg-superficie-suave px-5 py-3 sm:flex-row sm:justify-end">
        <Botao variante="fantasma" onClick={onFechar} disabled={lendo}>Cancelar</Botao>
        <Botao variante="primaria" onClick={ler} carregando={lendo}>
          {lendo ? 'Lendo…' : 'Ler com IA'}
        </Botao>
      </div>
    </Modal>
  );
}
