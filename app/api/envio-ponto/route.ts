// /api/envio-ponto — folha de ponto enviada pelo cliente (Sprint 10 · Frente A).
//
// Acesso: `cliente` (só a própria empresa — em CLIENTE_PODE no proxy) e a
// contabilidade com o módulo ponto (em ROTAS_PONTO). Decisão fina aqui:
// lib/acesso.ts (empresa), lib/pontoAcesso.ts (escritório da empresa, gestor) e
// lib/envioPonto.ts (registro carregado, com o escritório gravado nele).
//
//   GET    ?empresa=           → envios da empresa (+ funcionários, para o cliente)
//                                 e retoma a fila de leitura depois da resposta
//   POST   (cliente)           → inicia um envio: URL de upload assinada
//   PATCH  { id, acao }        → confirmar (cliente) · ler · aplicar · desfazer-aplicacao
//                                 · devolver · desfazer-devolucao (contabilidade) · restaurar
//   DELETE ?id=                → exclusão lógica (com desfazer)
import { after, NextRequest } from 'next/server';
import { ehGestor, exigirSessao, respostaNegadaEmpresa } from '@/lib/acesso';
import { escritorioDaEmpresa as escritorioPonto } from '@/lib/pontoAcesso';
import { hojeBelem } from '@/lib/contratos';
import {
  anoMesValidos, chaveNome, MAX_ENVIOS_HORA, mesAceitoParaEnvio, motivoValido, podeAplicar, podeConferirEnvio,
  podeDevolver, podeExcluirEnvio, podeLer, podeRestaurarEnvio, podeVerEnvio, validarFoto,
} from '@/lib/envioPonto';
import {
  aplicarEnvio, confirmarEnvio, desfazerAplicacao, desfazerDevolucao, devolverEnvio, enviosNaUltimaHora, envioPublico,
  ErroEnvio, excluirEnvio, funcionariosParaEnvio, iniciarEnvio, lerEnvio, lerEnvioPelaIa, listarEnvios, processarFila,
  restaurarEnvio,
} from '@/lib/envioPontoServidor';
import { ErroBancoPendente, ErroMesFechado } from '@/lib/pontoDb';
import { ErroDoc } from '@/lib/documentosServidor';
import { escritorioDaEmpresa, guardaEmpresa } from '../documentos/comum';
import type { DiaFreq } from '@/lib/tipos';

export const runtime = 'nodejs';
// A leitura pela IA roda depois da resposta (`after`), dentro deste tempo.
export const maxDuration = 300;

const negado = () => Response.json({ erro: 'Acesso restrito.' }, { status: 403 });
const naoEncontrado = () => Response.json({ erro: 'Envio não encontrado.' }, { status: 404 });

function falha(e: unknown) {
  if (e instanceof ErroEnvio) return Response.json({ erro: e.message, ...(e.status === 503 ? { aguardandoBanco: true } : {}) }, { status: e.status });
  if (e instanceof ErroDoc) return Response.json({ erro: e.message }, { status: e.status });
  if (e instanceof ErroBancoPendente) return Response.json({ erro: e.message, aguardandoBanco: true }, { status: 503 });
  if (e instanceof ErroMesFechado) return Response.json({ erro: e.message, mesFechado: true }, { status: 409 });
  // Erros de outra natureza (inclusive do banco, via pontoDb): sem a mensagem crua.
  console.error('[envio-ponto] erro inesperado:', e instanceof Error ? e.message.slice(0, 160) : e);
  return Response.json({ erro: 'Falha inesperada. Tente de novo.' }, { status: 500 });
}

/** Leitura em segundo plano: nunca derruba a resposta já enviada. */
function emSegundoPlano(fn: () => Promise<unknown>) {
  after(async () => {
    try { await fn(); } catch (e) { console.error('[envio-ponto] fila:', e instanceof Error ? e.message.slice(0, 160) : e); }
  });
}

/** Meses mostrados: os últimos 13 (o cliente não vê o histórico inteiro de uma vez). */
function desdeTrezeMeses(hoje: string) {
  let a = Number(hoje.slice(0, 4));
  let m = Number(hoje.slice(5, 7)) - 13;
  while (m < 1) { m += 12; a -= 1; }
  return { ano: a, mes: m };
}

export async function GET(req: NextRequest) {
  const g = await guardaEmpresa(req, req.nextUrl.searchParams.get('empresa'));
  if (!g.ok) return g.resposta;
  const s = g.sessao;
  const empresaId = g.empresaId!;
  try {
    const gestor = ehGestor(s);
    // Escritório da empresa: do cadastro. Contador: tem de ser o da sessão (pontoAcesso).
    let escritorioId: string;
    if (gestor) {
      const r = await escritorioPonto(s, empresaId);
      if (!r) return negado();
      escritorioId = r.escritorioId;
    } else {
      escritorioId = await escritorioDaEmpresa(empresaId);
      if (escritorioId !== s.escritorioId) return negado();
    }
    const [envios, funcionarios] = await Promise.all([
      listarEnvios(s.role === 'master' ? null : escritorioId, empresaId, { desde: desdeTrezeMeses(hojeBelem()) }),
      gestor ? Promise.resolve(null) : funcionariosParaEnvio(escritorioId, empresaId),
    ]);
    // Retoma a fila (fotos que esperaram cota/ritmo ou leituras presas).
    if (envios.some((e) => e.situacao === 'recebida' || e.situacao === 'lendo' || e.situacao === 'falhou')) {
      emSegundoPlano(() => processarFila(escritorioId, empresaId));
    }
    return Response.json({
      envios: envios.map((e) => envioPublico(e, gestor)),
      ...(funcionarios ? { funcionarios: funcionarios.map((f) => ({ nome: f.nome })) } : {}),
    });
  } catch (e) { return falha(e); }
}

/** Inicia um envio. Só o cliente manda folha por aqui (a contabilidade usa a Timesheet). */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const g = await guardaEmpresa(req, body.empresa);
    if (!g.ok) return g.resposta;
    if (g.sessao.role !== 'cliente') {
      return Response.json({ erro: 'Para lançar a folha, use a Timesheet.' }, { status: 403 });
    }
    const empresaId = g.empresaId!;
    const ano = Number(body.ano);
    const mes = Number(body.mes);
    if (!mesAceitoParaEnvio(ano, mes, hojeBelem())) throw new ErroEnvio('Escolha um mês que já começou (até 13 meses atrás).');
    const foto = validarFoto({ nome: body.nome, tamanho: Number(body.tamanho), tipo: body.tipo });
    if (!foto.ok) throw new ErroEnvio(foto.erro);

    const escritorioId = await escritorioDaEmpresa(empresaId);
    if (escritorioId !== g.sessao.escritorioId) return negado();
    // O funcionário tem de estar no cadastro da empresa: o cliente não inventa nome
    // (a frequência liga pelo nome; um nome livre criaria um "funcionário" novo).
    const lista = await funcionariosParaEnvio(escritorioId, empresaId);
    const escolhido = lista.find((f) => chaveNome(f.nome) === chaveNome(String(body.funcionario ?? '')));
    if (!escolhido) throw new ErroEnvio('Escolha o funcionário na lista. Se ele não aparece, peça à contabilidade para cadastrá-lo.');

    if ((await enviosNaUltimaHora(empresaId)) >= MAX_ENVIOS_HORA) {
      throw new ErroEnvio('Muitas fotos na última hora. Aguarde um pouco e tente de novo.', 429);
    }
    const r = await iniciarEnvio({
      escritorioId, empresaId, funcionario: escolhido.nome, empregadoId: escolhido.empregadoId,
      ano, mes, tamanho: Number(body.tamanho), tipo: foto.tipo, autor: g.sessao.email, maxHora: MAX_ENVIOS_HORA,
    });
    return Response.json(r);
  } catch (e) { return falha(e); }
}

/** Dias que a contadora conferiu (vêm da tela); o servidor só guarda o que tem dado. */
function diasDoCorpo(v: unknown): DiaFreq[] | null {
  if (!Array.isArray(v) || v.length > 31) return null;
  return v as DiaFreq[];
}

export async function PATCH(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;
  const s = g.sessao;
  try {
    const body = await req.json().catch(() => ({}));
    const e = await lerEnvio(String(body.id ?? ''));
    if (!e || !podeVerEnvio(s, e)) return naoEncontrado();
    { const r = await respostaNegadaEmpresa(s, e.empresaId); if (r) return r; }
    const gestor = ehGestor(s);
    if (gestor && !(await escritorioPonto(s, e.empresaId))) return naoEncontrado();

    const conferir = () => {
      if (e.excluidoEm || !podeConferirEnvio(s, e)) throw new ErroEnvio('Acesso restrito.', 403);
    };

    switch (body.acao) {
      case 'confirmar': {
        // Só quem iniciou o envio o confirma.
        if (e.excluidoEm || s.role !== 'cliente' || e.enviadoPor !== s.email) return negado();
        const r = await confirmarEnvio(e);
        if (r.situacao === 'recebida') emSegundoPlano(() => lerEnvioPelaIa(r.id, 'auto', 'fila'));
        return Response.json({ envio: envioPublico(r, false) });
      }
      case 'ler': {
        conferir();
        if (!podeLer(e.situacao)) throw new ErroEnvio('Esta folha não está esperando leitura.', 409);
        const r = await lerEnvioPelaIa(e.id, 'contadora', s.email);
        const atual = await lerEnvio(e.id);
        const msg = r === 'lida' ? 'Folha lida pela IA.'
          : r === 'falhou' ? 'A IA não conseguiu ler esta foto (não contou na cota). Preencha à mão ou devolva ao cliente.'
            : r === 'ocupada' ? 'Esta folha já está sendo lida.'
              : 'A leitura ficou na fila (cota, ritmo ou IA indisponível). Veja o aviso na linha.';
        return Response.json({ resultado: r, mensagem: msg, envio: atual ? envioPublico(atual, true) : null });
      }
      case 'aplicar': {
        conferir();
        if (!podeAplicar(e.situacao)) throw new ErroEnvio('Esta folha não pode ser aplicada agora.', 409);
        const dias = diasDoCorpo(body.dias);
        if (!dias) throw new ErroEnvio('Dias da folha inválidos.');
        const digitado = String(body.funcionario ?? e.funcionario).replace(/\s+/g, ' ').trim().slice(0, 120);
        if (!digitado) throw new ErroEnvio('Informe o funcionário.');
        // Mesmo nome do cadastro, com a grafia do cadastro: "maria  silva" não vira outro funcionário.
        const cadastro = await funcionariosParaEnvio(e.escritorioId, e.empresaId);
        const funcionario = cadastro.find((f) => chaveNome(f.nome) === chaveNome(digitado))?.nome ?? digitado;
        if (!anoMesValidos(e.ano, e.mes)) throw new ErroEnvio('Mês inválido.');
        const r = await aplicarEnvio(e, funcionario, dias, s.email);
        return Response.json({ ok: true, ...r });
      }
      case 'desfazer-aplicacao': {
        conferir();
        await desfazerAplicacao(e);
        return Response.json({ ok: true });
      }
      case 'devolver': {
        conferir();
        if (!podeDevolver(e.situacao)) throw new ErroEnvio('Esta folha não pode ser devolvida agora.', 409);
        const motivo = motivoValido(body.motivo);
        if (!motivo) throw new ErroEnvio('Escreva o motivo para o cliente (ex.: "foto cortada, faltam os dias 20 a 31").');
        await devolverEnvio(e, motivo, s.email);
        return Response.json({ ok: true });
      }
      case 'desfazer-devolucao': {
        conferir();
        await desfazerDevolucao(e);
        return Response.json({ ok: true });
      }
      case 'restaurar': {
        if (!e.excluidoEm) return Response.json({ ok: true });
        if (!podeRestaurarEnvio(s, e)) return negado();
        await restaurarEnvio(e);
        return Response.json({ ok: true });
      }
      default:
        throw new ErroEnvio('Ação inválida.');
    }
  } catch (err) { return falha(err); }
}

export async function DELETE(req: NextRequest) {
  const g = await exigirSessao(req);
  if (!g.ok) return g.resposta;
  try {
    const e = await lerEnvio(req.nextUrl.searchParams.get('id') ?? '');
    if (!e || e.excluidoEm || !podeVerEnvio(g.sessao, e)) return naoEncontrado();
    { const r = await respostaNegadaEmpresa(g.sessao, e.empresaId); if (r) return r; }
    if (ehGestor(g.sessao) && !(await escritorioPonto(g.sessao, e.empresaId))) return naoEncontrado();
    if (!podeExcluirEnvio(g.sessao, e)) {
      return Response.json({ erro: 'Folha já conferida ou em leitura não pode ser excluída.' }, { status: 409 });
    }
    await excluirEnvio(e, g.sessao.email, ehGestor(g.sessao));
    return Response.json({ ok: true });
  } catch (err) { return falha(err); }
}
