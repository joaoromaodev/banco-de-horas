'use client';

// Erro inesperado numa tela do app (fronteira de erro do Next — docs em
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md).
// Mostra uma mensagem humana e "Tentar de novo" (`unstable_retry` refaz a busca e a
// renderização do trecho). Nunca mostra a mensagem técnica: só o código de
// referência (`digest`), que casa com o log do servidor quando o suporte precisa.
// A barra lateral (layout de (app)) continua de pé: a pessoa pode ir a outra tela.
import { useEffect } from 'react';
import Link from 'next/link';
import { Aviso, Botao, botaoCls, Conteudo } from '@/components/ui';

export default function ErroDaTela({ error, unstable_retry }: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error('[tela] erro inesperado:', error);
  }, [error]);

  return (
    <Conteudo largura="estreita">
      <div className="pt-6">
        <Aviso tom="perigo" titulo="Algo deu errado ao abrir esta tela.">
          <p>Nada do que você já salvou foi perdido. Tente de novo; se continuar, volte ao início e avise o suporte.</p>
          {error.digest && <p className="mt-1 text-xs text-tinta-suave">Código para o suporte: {error.digest}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Botao variante="primaria" tamanho="sm" onClick={() => unstable_retry()}>Tentar de novo</Botao>
            <Link href="/" className={botaoCls({ tamanho: 'sm' })}>Voltar ao início</Link>
          </div>
        </Aviso>
      </div>
    </Conteudo>
  );
}
