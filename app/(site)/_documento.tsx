import { Aviso } from '@/components/ui';

export interface SecaoDoc {
  titulo: string;
  paragrafos?: string[];
  itens?: string[];
}

/** Moldura de um documento legal: aviso de rascunho no topo, sumário e seções numeradas. */
export function Documento({ titulo, atualizado, intro, secoes }: {
  titulo: string; atualizado: string; intro: string; secoes: SecaoDoc[];
}) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <Aviso tom="aviso" titulo="Rascunho — revisar com advogado antes do lançamento">
        Este texto ainda não foi validado por um profissional de direito e não deve ser tratado como versão final.
      </Aviso>
      <h1 className="mt-8 text-3xl font-semibold tracking-tight text-tinta">{titulo}</h1>
      <p className="mt-2 text-[13px] text-tinta-suave">Última atualização: {atualizado}</p>
      <p className="mt-5 text-[15px] leading-relaxed text-tinta">{intro}</p>

      <nav aria-label="Sumário" className="mt-8 rounded-xl border border-borda bg-superficie p-4 sm:p-5">
        <p className="text-[13px] font-semibold text-tinta">Neste documento</p>
        <ol className="mt-2 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
          {secoes.map((s, i) => (
            <li key={s.titulo}><a href={`#s${i + 1}`} className="text-primaria-texto hover:underline">{i + 1}. {s.titulo}</a></li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 space-y-9">
        {secoes.map((s, i) => (
          <section key={s.titulo} id={`s${i + 1}`} className="scroll-mt-20">
            <h2 className="text-lg font-semibold tracking-tight text-tinta">{i + 1}. {s.titulo}</h2>
            {s.paragrafos?.map((p) => <p key={p} className="mt-3 text-[15px] leading-relaxed text-tinta-suave">{p}</p>)}
            {s.itens && (
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-tinta-suave marker:text-tinta-fraca">
                {s.itens.map((it) => <li key={it}>{it}</li>)}
              </ul>
            )}
          </section>
        ))}
      </div>
    </article>
  );
}
