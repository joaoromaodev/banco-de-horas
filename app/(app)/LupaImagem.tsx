'use client';

import { useRef, useState } from 'react';

/**
 * Imagem com lupa: ao passar o mouse, mostra uma lente circular ampliando a
 * região sob o cursor — para conferir a letra manuscrita da folha de ponto.
 */
export default function LupaImagem({
  src,
  zoom = 2.6,
  tam = 220,
}: {
  src: string;
  zoom?: number;
  tam?: number;
}) {
  const contRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [ativo, setAtivo] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // cursor dentro do container
  const [bg, setBg] = useState({ w: 0, h: 0, x: 0, y: 0 });

  function onMove(e: React.MouseEvent) {
    const img = imgRef.current;
    const cont = contRef.current;
    if (!img || !cont) return;

    const r = img.getBoundingClientRect();
    const x = e.clientX - r.left; // posição dentro da imagem
    const y = e.clientY - r.top;

    if (x < 0 || y < 0 || x > r.width || y > r.height) {
      setAtivo(false);
      return;
    }
    setAtivo(true);

    const c = cont.getBoundingClientRect();
    setPos({ x: e.clientX - c.left, y: e.clientY - c.top });

    setBg({
      w: r.width * zoom,
      h: r.height * zoom,
      x: -(x * zoom - tam / 2),
      y: -(y * zoom - tam / 2),
    });
  }

  return (
    <div
      ref={contRef}
      className="relative cursor-crosshair"
      onMouseMove={onMove}
      onMouseLeave={() => setAtivo(false)}
    >
      <img
        ref={imgRef}
        src={src}
        alt="Folha de ponto"
        draggable={false}
        className="block w-full select-none rounded-lg border border-slate-200"
      />

      {ativo && (
        <div
          className="pointer-events-none absolute z-20 rounded-full border-2 border-indigo-500 shadow-xl ring-2 ring-white"
          style={{
            width: tam,
            height: tam,
            left: pos.x - tam / 2,
            top: pos.y - tam / 2,
            backgroundColor: 'white',
            backgroundImage: `url(${src})`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: `${bg.w}px ${bg.h}px`,
            backgroundPosition: `${bg.x}px ${bg.y}px`,
          }}
        />
      )}

      {!ativo && (
        <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-slate-900/70 px-2.5 py-1 text-[11px] font-medium text-white">
          Passe o mouse para ampliar
        </span>
      )}
    </div>
  );
}
