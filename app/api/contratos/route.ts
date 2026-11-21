// /api/contratos — contratos de experiência salvos de uma empresa.
//
// Exclusivo da contabilidade: `exigirGestor` + acesso à empresa. O `cliente`
// já é barrado no proxy (a rota não está em CLIENTE_PODE).
import { NextRequest } from 'next/server';
import { exigirGestor, podeAcessarEmpresa } from '@/lib/acesso';
import { lerFiscal } from '@/lib/caixa';
import { DadosContrato, normalizarDados, Situacao, validar } from '@/lib/contratos';
import {
  atualizarContrato, criarContrato, empresaDoContrato, ErroContrato, excluirContrato, listarContratos,
} from '@/lib/contratosServidor';
import { lerEmpresa } from '@/lib/cadastro';
import { ligarEmpregadoDoContrato } from '@/lib/dpServidor';

export const runtime = 'nodejs';

const SITUACOES: Situacao[] = ['experiencia', 'efetivado', 'encerrado'];

function falha(e: unknown) {
  if (e instanceof ErroContrato) return Response.json({ erro: e.message }, { status: e.status });
  return Response.json({ erro: e instanceof Error ? e.message : 'Falha.' }, { status: 502 });
}

/** O contrato cria/liga o empregado no Departamento Pessoal (0021); falha sem derrubar o contrato. */
async function ligarAoDp(empresa: string, contratoId: string, dados: DadosContrato, por: string) {
  const escritorioId = (await lerEmpresa(empresa).catch(() => null))?.escritorioId;
  if (escritorioId) await ligarEmpregadoDoContrato(escritorioId, empresa, contratoId, dados, por);
}

const negado = () => Response.json({ erro: 'Acesso restrito a esta empresa.' }, { status: 403 });

function dadosValidos(bruto: unknown): DadosContrato {
  const d = normalizarDados((bruto ?? {}) as Partial<DadosContrato>);
  const erros = validar(d);
  if (erros.length) throw new ErroContrato(erros.join(' '));
  return d;
}

export async function GET(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  const empresa = req.nextUrl.searchParams.get('empresa') ?? '';
  if (!(await podeAcessarEmpresa(g.sessao, empresa))) return negado();
  try {
    // Endereço da sede: do cadastro fiscal da empresa (Fase 5, Parte C), se houver.
    const empregadora = await lerFiscal(empresa).then((f) => ({
      endereco: [
        [f.endereco, f.numeroEndereco && `nº ${f.numeroEndereco}`].filter(Boolean).join(', '),
        [f.municipio, f.estado].filter(Boolean).join('/'),
      ].filter(Boolean).join(' – '),
      cidade: f.municipio || f.cidadeTermo || '',
    })).catch(() => null);
    // Sem a tabela (migração 0009 pendente) a tela ainda gera os documentos.
    const contratos = await listarContratos(empresa).catch((e) => {
      if (e instanceof ErroContrato && e.status === 503) return null;
      throw e;
    });
    return Response.json({ contratos: contratos ?? [], semTabela: contratos === null, empregadora });
  } catch (e) { return falha(e); }
}

export async function POST(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json();
    const empresa = String(body.empresa ?? '');
    if (!(await podeAcessarEmpresa(g.sessao, empresa))) return negado();
    const contrato = await criarContrato(empresa, dadosValidos(body.dados), g.sessao.email);
    await ligarAoDp(empresa, contrato.id, contrato.dados, g.sessao.email);
    return Response.json({ contrato });
  } catch (e) { return falha(e); }
}

/** Edita os dados e/ou a situação; `restaurar: true` desfaz uma exclusão. */
export async function PATCH(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const body = await req.json();
    const id = String(body.id ?? '');
    const empresa = await empresaDoContrato(id);
    if (!empresa) return Response.json({ erro: 'Contrato não encontrado.' }, { status: 404 });
    if (!(await podeAcessarEmpresa(g.sessao, empresa))) return negado();

    if (body.restaurar) {
      await excluirContrato(id, true);
      return Response.json({ ok: true });
    }
    const situacao = body.situacao as Situacao | undefined;
    if (situacao && !SITUACOES.includes(situacao)) throw new ErroContrato('Situação inválida.');
    const contrato = await atualizarContrato(id, {
      dados: body.dados ? dadosValidos(body.dados) : undefined, situacao,
    }, g.sessao.email);
    if (body.dados) await ligarAoDp(empresa, contrato.id, contrato.dados, g.sessao.email);
    return Response.json({ contrato });
  } catch (e) { return falha(e); }
}

export async function DELETE(req: NextRequest) {
  const g = await exigirGestor(req);
  if (!g.ok) return g.resposta;
  try {
    const id = req.nextUrl.searchParams.get('id') ?? '';
    const empresa = await empresaDoContrato(id);
    if (!empresa) return Response.json({ erro: 'Contrato não encontrado.' }, { status: 404 });
    if (!(await podeAcessarEmpresa(g.sessao, empresa))) return negado();
    await excluirContrato(id);
    return Response.json({ ok: true });
  } catch (e) { return falha(e); }
}
