// "Conferido pela contadora" do Resumo do ponto (migração 0022).
//
// Só de servidor. Uma linha por empresa × mês, com a assinatura (hash) dos números
// conferidos: se a folha mudar depois, a assinatura não bate e a tela avisa.
// Sem a 0022 as funções lançam `ErroBancoPendente`; a rota do resumo segue
// funcionando e só o carimbo fica indisponível.
import { createHash } from 'node:crypto';
import { getDb } from './db';
import { ehTabelaInexistente, ErroBancoPendente } from './pontoDb';

export interface Conferencia {
  por: string;
  em: string;
  assinatura: string;
}

export const assinar = (texto: string) => createHash('sha256').update(texto).digest('hex').slice(0, 32);

export async function lerConferencia(escritorioId: string, empresaId: string, ano: number, mes: number): Promise<Conferencia | null> {
  const { data, error } = await getDb().from('ponto_resumo_conferido')
    .select('conferido_por, conferido_em, assinatura')
    .eq('escritorio_id', escritorioId).eq('empresa_id', empresaId).eq('ano', ano).eq('mes', mes).maybeSingle();
  if (error) {
    if (ehTabelaInexistente(error)) throw new ErroBancoPendente();
    throw new Error(error.message);
  }
  return data ? { por: String(data.conferido_por), em: String(data.conferido_em), assinatura: String(data.assinatura) } : null;
}

export async function salvarConferencia(escritorioId: string, empresaId: string, ano: number, mes: number, por: string, assinatura: string): Promise<void> {
  const { error } = await getDb().from('ponto_resumo_conferido').upsert({
    escritorio_id: escritorioId, empresa_id: empresaId, ano, mes, conferido_por: por, conferido_em: new Date().toISOString(), assinatura,
  }, { onConflict: 'empresa_id,ano,mes' });
  if (error) {
    if (ehTabelaInexistente(error)) throw new ErroBancoPendente();
    throw new Error(error.message);
  }
}

export async function removerConferencia(escritorioId: string, empresaId: string, ano: number, mes: number): Promise<void> {
  const { error } = await getDb().from('ponto_resumo_conferido').delete()
    .eq('escritorio_id', escritorioId).eq('empresa_id', empresaId).eq('ano', ano).eq('mes', mes);
  if (error) {
    if (ehTabelaInexistente(error)) throw new ErroBancoPendente();
    throw new Error(error.message);
  }
}
