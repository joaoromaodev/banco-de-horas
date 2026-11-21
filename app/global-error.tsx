'use client';

// Erro no layout raiz (raro): substitui o layout inteiro, então precisa do próprio
// <html>/<body> e do CSS global (docs: .../03-file-conventions/error.md, "Global Error").
// Mensagem humana, "Tentar de novo" e nenhum detalhe técnico além do código de referência.
import './globals.css';
import Link from 'next/link';

export default function ErroGeral({ error, unstable_retry }: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body className="min-h-full bg-fundo text-tinta antialiased">
        <title>Algo deu errado — ClickContas</title>
        <main className="mx-auto max-w-md px-4 py-16 text-sm">
          <h1 className="text-xl font-semibold tracking-tight">Algo deu errado.</h1>
          <p className="mt-2 text-tinta-suave">
            O ClickContas não conseguiu abrir agora. Nada do que você já salvou foi perdido. Tente de novo em instantes.
          </p>
          {error.digest && <p className="mt-2 text-xs text-tinta-suave">Código para o suporte: {error.digest}</p>}
          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" onClick={() => unstable_retry()}
              className="inline-flex items-center rounded-lg bg-primaria px-4 py-2 font-medium text-sobre-primaria hover:bg-primaria-hover">
              Tentar de novo
            </button>
            <Link href="/" className="inline-flex items-center rounded-lg border border-borda-forte/50 bg-superficie px-4 py-2 font-medium text-tinta hover:bg-superficie-realce">
              Voltar ao início
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
