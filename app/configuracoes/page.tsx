'use client';

import { useEffect, useState } from 'react';

export default function Configuracoes() {
  const [temChave, setTemChave] = useState(false);
  const [chave, setChave] = useState('');
  const [modelo, setModelo] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function carregar() {
    setErro(null);
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro ?? 'Falha ao carregar.');
      setTemChave(data.temChave);
      setModelo(data.gemini_modelo || 'gemini-2.5-flash');
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { carregar(); }, []);

  async function salvar() {
    setErro(null);
    setAviso(null);
    setCarregando(true);
    try {
      const body: Record<string, string> = { gemini_modelo: modelo };
      if (chave.trim()) body.gemini_api_key = chave.trim();
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.erro ?? 'Falha ao salvar.');
      setAviso('Configurações salvas.');
      setChave('');
      carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setCarregando(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-6 text-sm">
      <h1 className="text-2xl font-bold">Configurações</h1>
      <p className="mt-1 text-gray-500">
        A chave do Gemini fica guardada na sua planilha do Google (aba Config).
        Ela é usada só para ler as folhas de ponto.
      </p>

      <section className="mt-6 space-y-4 rounded-lg border p-4">
        <div>
          <label className="font-medium">Chave da API do Gemini</label>
          <p className="mb-1 text-xs text-gray-500">
            {temChave
              ? '✅ Já existe uma chave salva. Preencha abaixo só se quiser trocar.'
              : '⚠️ Nenhuma chave salva ainda. Crie em aistudio.google.com/apikey.'}
          </p>
          <input type="password" value={chave} onChange={(e) => setChave(e.target.value)}
            placeholder={temChave ? '•••••••• (manter atual)' : 'AIza... ou AQ...'}
            className="w-full rounded border px-2 py-1" />
        </div>

        <div>
          <label className="font-medium">Modelo</label>
          <select value={modelo} onChange={(e) => setModelo(e.target.value)}
            className="mt-1 w-full rounded border px-2 py-1">
            <option value="gemini-2.5-flash">gemini-2.5-flash (rápido, grátis)</option>
            <option value="gemini-2.5-pro">gemini-2.5-pro (mais preciso)</option>
          </select>
        </div>

        <button onClick={salvar} disabled={carregando}
          className="rounded bg-blue-600 px-4 py-2 font-medium text-white disabled:opacity-50">
          {carregando ? 'Salvando…' : 'Salvar'}
        </button>

        {erro && <p className="rounded bg-red-50 p-2 text-red-700">{erro}</p>}
        {aviso && <p className="rounded bg-green-50 p-2 text-green-700">{aviso}</p>}
      </section>
    </main>
  );
}
