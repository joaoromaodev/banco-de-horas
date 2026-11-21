// Painel da marca à esquerda das telas de entrada (login e criar conta).
import { BRAND } from '@/lib/brand';

export function PainelMarca() {
  return (
    <div className="hero relative hidden w-[46%] max-w-2xl flex-col justify-between overflow-hidden p-12 lg:flex xl:p-16">
      {/* A marca ampliada, como marca-d'água */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-mark.svg" alt="" aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 -right-24 h-[26rem] w-[26rem] opacity-[0.07] brightness-0 invert" />

      <div className="relative flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-mark.svg" alt="" className="h-10 w-10" />
        <div className="leading-tight">
          <div className="text-base font-semibold tracking-tight">{BRAND.nome}</div>
          <div className="text-xs text-petroleo-200">{BRAND.subtitulo}</div>
        </div>
      </div>

      <div className="relative">
        <span className="mb-6 block h-1 w-10 rounded-full bg-verde-500" aria-hidden="true" />
        <p className="whitespace-pre-line text-3xl font-semibold leading-tight tracking-tight xl:text-4xl">{BRAND.chamada}</p>
        <p className="mt-5 max-w-sm text-sm leading-relaxed text-petroleo-100">{BRAND.descricao}</p>
      </div>

      <div className="relative text-xs text-petroleo-200">© {new Date().getFullYear()} · {BRAND.nome}</div>
    </div>
  );
}
