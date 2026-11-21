'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Empresa } from '@/lib/tipos';
import { AbasCaixa } from '../AbasCaixa';
import { Botao, CabecalhoPagina, Conteudo, Entrada, EstadoVazio, Secao } from '@/components/ui';
import { EntradaSugestoes, Selecao } from '@/components/selecao';
import { Toast, Toasts } from '@/components/retorno';

/** Espelha DadosFiscais de lib/caixa (camelCase). */
interface Fiscal {
  endereco: string | null; numeroEndereco: string | null;
  municipio: string | null; estado: string | null;
  inscricaoEstadual: string | null; inscricaoMunicipal: string | null;
  registroJunta: string | null; registroNumero: string | null;
  prefeitura: string | null; cidadeTermo: string | null;
  contabilista: string; crc: string;
}

const FISCAL_VAZIO: Fiscal = {
  endereco: '', numeroEndereco: '', municipio: '', estado: '',
  inscricaoEstadual: '', inscricaoMunicipal: '', registroJunta: '', registroNumero: '',
  prefeitura: '', cidadeTermo: '', contabilista: 'Edilse Goes da Costa', crc: '01619/0-3',
};

/**
 * Aba "Cadastros" do módulo Livro Caixa. Só os dados fiscais da empresa, que
 * alimentam o Termo de Abertura. Trabalho da contabilidade — o `cliente` é
 * redirecionado para os Lançamentos.
 */
export default function CaixaCadastros() {
  const router = useRouter();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaSel, setEmpresaSel] = useState('');
  const [fiscal, setFiscal] = useState<Fiscal>(FISCAL_VAZIO);
  const [msg, setMsg] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function carregarEmpresas() {
    setErro(null);
    try {
      const r = await fetch('/api/empresas');
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      const lista: Empresa[] = d.empresas ?? [];
      setEmpresas(lista);
      if (!empresaSel && lista.length) setEmpresaSel(lista[0].id);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  useEffect(() => {
    fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d && d.role === 'cliente') { router.replace('/caixa'); return; }
      carregarEmpresas();
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function carregarFiscal(empresa: string) {
    if (!empresa) { setFiscal(FISCAL_VAZIO); return; }
    try {
      const r = await fetch(`/api/caixa/fiscal?empresa=${encodeURIComponent(empresa)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.erro);
      const f = d.fiscal as Fiscal;
      setFiscal({
        endereco: f.endereco ?? '', numeroEndereco: f.numeroEndereco ?? '',
        municipio: f.municipio ?? '', estado: f.estado ?? '',
        inscricaoEstadual: f.inscricaoEstadual ?? '', inscricaoMunicipal: f.inscricaoMunicipal ?? '',
        registroJunta: f.registroJunta ?? '', registroNumero: f.registroNumero ?? '',
        prefeitura: f.prefeitura ?? '', cidadeTermo: f.cidadeTermo ?? '',
        contabilista: f.contabilista || FISCAL_VAZIO.contabilista, crc: f.crc || FISCAL_VAZIO.crc,
      });
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  useEffect(() => { carregarFiscal(empresaSel); }, [empresaSel]);

  async function salvarFiscal() {
    setMsg(null); setErro(null);
    if (!empresaSel) { setErro('Selecione uma empresa primeiro.'); return; }
    try {
      const res = await fetch('/api/caixa/fiscal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empresa: empresaSel, fiscal }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.erro);
      setMsg('Dados fiscais salvos.');
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }

  const setFi = (campo: keyof Fiscal, v: string) => setFiscal((p) => ({ ...p, [campo]: v }));
  // Pessoa física (autônomo) não tem inscrição estadual/municipal nem registro na Junta.
  const ehFisica = empresas.find((e) => e.id === empresaSel)?.tipoPessoa === 'fisica';

  return (
    <div className="text-sm">
      <CabecalhoPagina titulo="Livro Caixa · Cadastros" subtitulo="Dados fiscais da empresa para o Termo de Abertura"
        abas={<AbasCaixa ativa="cadastros" ehGestor />} />

      <Toasts>
        {erro && <Toast tom="perigo" onFechar={() => setErro(null)}>{erro}</Toast>}
        {msg && <Toast onFechar={() => setMsg(null)}>{msg}</Toast>}
      </Toasts>

      <Conteudo largura="media">
        <Secao titulo="Dados fiscais"
          descricao="Usados no Termo de Abertura do livro. Preencha uma vez por empresa — valem para todos os anos. O número do livro, o número de ordem e a data do termo são por exercício e ficam na tela do caixa."
          acoes={
            <Selecao aria-label="Empresa" tamanho="sm" largura="w-56 max-w-full" valor={empresaSel} onChange={setEmpresaSel}
              placeholder="— cadastre uma empresa —"
              opcoes={empresas.map((e) => ({ valor: e.id, rotulo: e.nome }))} />
          }>
          {!empresaSel ? (
            <EstadoVazio titulo="Nenhuma empresa selecionada" descricao="Cadastre e selecione uma empresa para preencher o fiscal." />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-6">
                <Entrada rotulo="Endereço" classeCampo="sm:col-span-4" value={fiscal.endereco ?? ''} onChange={(e) => setFi('endereco', e.target.value)} />
                <Entrada rotulo="Número" classeCampo="sm:col-span-2" value={fiscal.numeroEndereco ?? ''} onChange={(e) => setFi('numeroEndereco', e.target.value)} />
                <Entrada rotulo="Município" classeCampo="sm:col-span-4" value={fiscal.municipio ?? ''} onChange={(e) => setFi('municipio', e.target.value)} />
                <Entrada rotulo="UF" classeCampo="sm:col-span-2" maxLength={2} value={fiscal.estado ?? ''} onChange={(e) => setFi('estado', e.target.value.toUpperCase())} />
                {/* Inscrições e Junta não se aplicam a pessoa física (autônomo). */}
                {!ehFisica && (<>
                  <Entrada rotulo="Inscrição estadual" classeCampo="sm:col-span-3" value={fiscal.inscricaoEstadual ?? ''} onChange={(e) => setFi('inscricaoEstadual', e.target.value)} />
                  <Entrada rotulo="Inscrição municipal" classeCampo="sm:col-span-3" value={fiscal.inscricaoMunicipal ?? ''} onChange={(e) => setFi('inscricaoMunicipal', e.target.value)} />
                  <Entrada rotulo="Registro na Junta (órgão)" classeCampo="sm:col-span-3" placeholder="ex.: JUCEPA" value={fiscal.registroJunta ?? ''} onChange={(e) => setFi('registroJunta', e.target.value)} />
                  <Entrada rotulo="Sob o número" classeCampo="sm:col-span-3" value={fiscal.registroNumero ?? ''} onChange={(e) => setFi('registroNumero', e.target.value)} />
                </>)}
                <Entrada rotulo="Prefeitura" classeCampo="sm:col-span-3" value={fiscal.prefeitura ?? ''} onChange={(e) => setFi('prefeitura', e.target.value)} />
                <EntradaSugestoes rotulo="Cidade do termo" classeCampo="sm:col-span-3" placeholder="Belém ou Castanhal"
                  sugestoes={['Belém', 'Castanhal']} value={fiscal.cidadeTermo ?? ''} onChange={(v) => setFi('cidadeTermo', v)} />
                <Entrada rotulo="Contabilista" classeCampo="sm:col-span-3" value={fiscal.contabilista} onChange={(e) => setFi('contabilista', e.target.value)} />
                <Entrada rotulo="CRC" classeCampo="sm:col-span-3" value={fiscal.crc} onChange={(e) => setFi('crc', e.target.value)} />
              </div>
              <div className="mt-5">
                <Botao variante="primaria" onClick={salvarFiscal}>Salvar dados fiscais</Botao>
              </div>
            </>
          )}
        </Secao>
      </Conteudo>
    </div>
  );
}
