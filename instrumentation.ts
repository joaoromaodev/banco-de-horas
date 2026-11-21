// Instrumentação do servidor (Next): registra as exceções não tratadas das rotas
// e telas na medição própria (Sprint 15, frente A; tabela `medicoes`, migração 0031).
//
// Só o que não identifica ninguém: a rota (do ARQUIVO da rota, conferida contra a
// lista fechada) e um código curto (`TypeError`, `Error:23505`). Nunca a mensagem,
// o stack, a URL com query, os cabeçalhos ou o cookie. Sem a 0031, não grava e não
// quebra; qualquer falha aqui é engolida.
import type { Instrumentation } from 'next';

export const onRequestError: Instrumentation.onRequestError = async (err, _request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const [{ codigoDoErro }, { rotaDoArquivo }, { gravarMedicoes }] = await Promise.all([
      import('./lib/medicao'), import('./lib/medicaoRotas'), import('./lib/medicaoServidor'),
    ]);
    // Erro de proxy é do próprio proxy, não da rota pedida: fica com a rota genérica.
    const rota = context.routeType === 'proxy' ? '/[proxy]' : rotaDoArquivo(context.routePath);
    // Exceção entra sempre (não é amostra): taxa 1.
    await gravarMedicoes([{ tipo: 'erro', rota, erro: codigoDoErro(err), taxa: 1, amostra: false }]);
  } catch {
    /* medição nunca derruba nada */
  }
};
