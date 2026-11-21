'use client';

// Peças comuns das telas da agenda: abas, carga dos dados e marcar/desfazer feita.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Abas } from '@/components/ui';
import { chaveConclusao, Conclusao, Obrigacao } from '@/lib/agenda';

export function AbasAgenda({ ativa }: { ativa: 'visao' | 'obrigacoes' }) {
  return (
    <Abas rotulo="Agenda" itens={[
      { rotulo: 'Visão geral', href: '/agenda', ativa: ativa === 'visao' },
      { rotulo: 'Obrigações por empresa', href: '/agenda/obrigacoes', ativa: ativa === 'obrigacoes' },
    ]} />
  );
}

export interface EmpresaLista { id: string; nome: string }
export interface Membro { email: string; nome: string; admin?: boolean }

/** Obrigações, conclusões, empresas e equipe do escritório. */
export function useAgenda() {
  const [obrigacoes, setObrigacoes] = useState<Obrigacao[]>([]);
  const [conclusoes, setConclusoes] = useState<Conclusao[]>([]);
  const [empresas, setEmpresas] = useState<EmpresaLista[]>([]);
  const [equipe, setEquipe] = useState<Membro[]>([]);
  const [semTabela, setSemTabela] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const recarregar = useCallback(async () => {
    try {
      const [ra, re] = await Promise.all([fetch('/api/agenda'), fetch('/api/empresas')]);
      const a = await ra.json().catch(() => ({}));
      const e = await re.json().catch(() => ({}));
      if (!ra.ok) throw new Error(a.erro ?? 'Falha ao carregar a agenda.');
      setObrigacoes(a.obrigacoes ?? []);
      setConclusoes(a.conclusoes ?? []);
      setEquipe(a.equipe ?? []);
      setSemTabela(Boolean(a.semTabela));
      setEmpresas((e.empresas ?? []).map((x: EmpresaLista) => ({ id: x.id, nome: x.nome })));
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Falha ao carregar a agenda.');
    } finally {
      setCarregando(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial (o setState acontece depois do fetch)
  useEffect(() => { recarregar(); }, [recarregar]);

  const feitas = useMemo(
    () => new Map(conclusoes.map((c) => [chaveConclusao(c.obrigacaoId, c.competencia), c])),
    [conclusoes],
  );
  const nomeEmpresa = useMemo(() => new Map(empresas.map((e) => [e.id, e.nome])), [empresas]);
  const nomeMembro = useMemo(() => new Map(equipe.map((m) => [m.email, m.nome])), [equipe]);

  /** Marca (ou desmarca) uma competência; atualiza a lista na hora e devolve a mensagem de erro, se houver. */
  async function alternarFeita(obrigacaoId: string, competencia: string, feita: boolean): Promise<string | null> {
    const r = feita
      ? await fetch('/api/agenda/conclusoes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ obrigacaoId, competencia }),
      })
      : await fetch(`/api/agenda/conclusoes?obrigacao=${encodeURIComponent(obrigacaoId)}&competencia=${encodeURIComponent(competencia)}`, { method: 'DELETE' });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) return x.erro ?? 'Falha ao salvar.';
    setConclusoes((lista) => {
      const sem = lista.filter((c) => !(c.obrigacaoId === obrigacaoId && c.competencia === competencia));
      return feita && x.conclusao ? [...sem, x.conclusao] : sem;
    });
    return null;
  }

  return {
    obrigacoes, setObrigacoes, conclusoes, empresas, equipe, semTabela, carregando, erro, setErro,
    feitas, nomeEmpresa, nomeMembro, recarregar, alternarFeita,
  };
}

export const AVISO_MIGRACAO = 'As tabelas da agenda ainda não existem no banco. Assim que a migração 0014 for aplicada, a agenda passa a funcionar.';
